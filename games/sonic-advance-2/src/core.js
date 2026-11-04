// Sonic Advance 2's engine, rewritten from how the original does it: tasks, the graphics queue, the OAM's orders, and
// the screen update a frame ends with. The original is built on the same engine as Sonic Advance, so this keeps the
// shape of Sonic Advance Dreamport's src/gba/engine.js, with what Sonic Advance 2 does differently. SAT-R's
// decompilation of Sonic Advance 2 is the guide, built from this same USA release, and the addresses named here are those of
// the copy, as `npm run dp -- read` prints it.
//
// A frame is step(): the keys and the tasks (0x080018BC, EngineMainLoop), then what the V-blank copies (0x080019A0,
// UpdateScreenDma, and 0x08001C90, ClearOamBufferDma).

import { REG } from '../../../kit/gba/video.js';
import { copyLayer } from './stage/map.js';

// the bits of the GBA's key register
export const KEY = { A: 0x1, B: 0x2, SELECT: 0x4, START: 0x8, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80, R: 0x100, L: 0x200 };
export const FLAGS = { UPDATE_BG_PALETTES: 0x1, UPDATE_OBJ_PALETTES: 0x2 };

// The frames from power-on to the first frame the game shows, with the screen white (forced blank) all along: clearing
// the memory, starting the sound engine and looking at the save. None of it shows; only how long it takes does, which
// is the console's timing, as mGBA measures it.
const START_UP_FRAMES = 8;

const OAM_ENTRIES = 128, OAM_ORDERS = 32;
const COPY_CHUNK = 1024;

export function createCore(video, rom, sound) {
  const c = {
    video, rom,
    playSong: song => sound?.play(song),   // 0x0809532C, m4aSongNumStart
    runSound: () => sound?.call('frame'),   // a frame of the sound engine, which comes with no frame of the game's
    flags: 0, flagsPreVBlank: 0,
    dispCnt: 0x80, bgCnt: new Uint16Array(4), bgScroll: new Uint16Array(8), winRegs: new Uint16Array(6), bldCnt: 0, bldAlpha: 0, bldY: 0,
    bgPalette: new Uint16Array(256), objPalette: new Uint16Array(256),
    oamBuffer: new Uint16Array(OAM_ENTRIES * 4).fill(0x200),
    input: 0, prevInput: 0, pressed: 0, released: 0, repeated: 0,
    repeatCounters: new Uint8Array(10), firstRepeat: new Uint8Array(10).fill(20), nextRepeat: new Uint8Array(10).fill(8),
    startUp: START_UP_FRAMES, main: null, tasks: [],
    lineScroll: null, shownLineScroll: null,   // what the H-blank writes to layer 3's scroll, x and y for each line (FLAGS_EXECUTE_HBLANK_COPY)
  };
  const graphics = [], backgrounds = [], layers = [];
  let nextTask = null;

  /** 0x080025E4, TaskCreate: a task running `main(task)` each frame, after every task of the same or lower priority. */
  c.createTask = (main, data, priority = 0x100) => {
    const t = { main, data, priority };
    const at = c.tasks.findIndex(other => other.priority > priority);
    c.tasks.splice(at < 0 ? c.tasks.length : at, 0, t);
    return t;
  };
  /** 0x08002690, TaskDestroy */
  c.destroyTask = t => {
    const at = c.tasks.indexOf(t);
    if (t === nextTask) nextTask = c.tasks[at + 1];
    c.tasks.splice(at, 1);
  };
  /** ADD_TO_GRAPHICS_QUEUE: `size` bytes from `src` in the ROM copied to `dest` in VRAM in the next V-blank. */
  c.queueGraphics = (src, dest, size) => { graphics.push({ src, dest, size }); };
  c.queueBackground = bg => { backgrounds.push(bg); };
  /** A stage's layer for the V-blank (stage/map.js). */
  c.queueLayer = bg => { layers.push(bg); };

  const copy16 = (src, dest, bytes) => video.vram.set(rom.bytes.subarray(src, src + (bytes & ~1)), dest);
  // 0x080021C4, ProcessVramGraphicsCopyQueue, COPY_CHUNK at a time in the original, which comes to the same here
  function copyGraphics() {
    for (const { src, dest, size } of graphics) {
      for (let offset = 0; offset < size; offset += COPY_CHUNK) copy16(src + offset, dest + offset, Math.min(COPY_CHUNK, size - offset));
    }
    graphics.length = 0;
  }
  // sa2__sub_8002B20, for a text layer's map: each row of the map's rectangle to the layer's map; on a layer two
  // blocks wide the part of a row past column 32 goes to the next block
  function copyBackgrounds() {
    for (const bg of backgrounds) {
      const size = c.bgCnt[bg.flags & 3] >> 14, nextBlock = size === 1 || size === 3 ? 0x800 : 0;
      const w = bg.targetTilesX;
      let src = bg.layout, dest = bg.layoutVram;
      for (let row = 0; row < bg.targetTilesY; row++) {
        const left = Math.min(w, 32);
        copy16(src, dest, left * 2);
        if (w > 32) copy16(src + left * 2, dest + nextBlock, (w - left) * 2);
        dest += 64;
        src += bg.xTiles * 2;
      }
    }
    backgrounds.length = 0;
  }

  // each entry's three attributes, and in its fourth half-word the next entry of the same order (0xFF: the last)
  const oamMalloc = new Uint16Array(OAM_ENTRIES * 4).fill(0x200);
  const orderStart = new Uint8Array(OAM_ORDERS).fill(0xFF), orderEnd = new Uint8Array(OAM_ORDERS).fill(0xFF);
  let oamFree = 0;
  c.oamMalloc = oamMalloc;
  /** 0x080058B4, OamMalloc: the index of a new entry of `order` (0 in front, 31 at the back), or -1 if OAM is full. */
  c.allocOam = order => {
    if (order > 31) order = 31;
    if (oamFree > OAM_ENTRIES - 1) return -1;
    const i = oamFree++;
    oamMalloc[i * 4 + 3] = 0xFF;
    if (orderStart[order] === 0xFF) orderStart[order] = i;
    else oamMalloc[orderEnd[order] * 4 + 3] = i;
    orderEnd[order] = i;
    return i;
  };
  // 0x0800594C, ProcessOamBuffers
  function processOam() {
    let to = 0;
    for (let order = 0; order < OAM_ORDERS; order++) {
      for (let i = orderStart[order]; i !== 0xFF; i = oamMalloc[i * 4 + 3]) {
        c.oamBuffer.set(oamMalloc.subarray(i * 4, i * 4 + 3), to * 4);
        to++;
      }
    }
    oamFree = 0;
    orderStart.fill(0xFF);
    orderEnd.fill(0xFF);
  }

  // 0x0800227C, GetInput
  function readKeys(held) {
    c.input = held & 0x3FF;
    c.pressed = (c.input ^ c.prevInput) & c.input;
    c.released = (c.input ^ c.prevInput) & c.prevInput;
    c.prevInput = c.input;
    c.repeated = c.pressed;
    for (let i = 0; i < 10; i++) {
      if (!(c.input & (1 << i))) c.repeatCounters[i] = c.firstRepeat[i];
      else if (c.repeatCounters[i] > 0) c.repeatCounters[i]--;
      else {
        c.repeated |= 1 << i;
        c.repeatCounters[i] = c.nextRepeat[i];
      }
    }
  }

  // 0x080019A0, UpdateScreenDma, and 0x08001C90, ClearOamBufferDma
  function vblank() {
    video.write(REG.DISPCNT, c.dispCnt);
    for (let i = 0; i < 4; i++) video.write(REG.BG0CNT + i * 2, c.bgCnt[i]);
    if (c.flags & FLAGS.UPDATE_BG_PALETTES) {
      video.pal.set(c.bgPalette, 0);
      c.flags ^= FLAGS.UPDATE_BG_PALETTES;
    }
    if (c.flags & FLAGS.UPDATE_OBJ_PALETTES) {
      video.pal.set(c.objPalette, 256);
      c.flags ^= FLAGS.UPDATE_OBJ_PALETTES;
    }
    for (let i = 0; i < 6; i++) video.write(REG.WIN0H + i * 2, c.winRegs[i]);
    video.write(REG.BLDCNT, c.bldCnt);
    video.write(REG.BLDALPHA, c.bldAlpha);
    video.write(REG.BLDY, c.bldY);
    for (let i = 0; i < 8; i++) video.write(REG.BG0HOFS + i * 2, c.bgScroll[i]);
    processOam();
    video.oam.set(c.oamBuffer);
    copyGraphics();
    copyBackgrounds();
    for (const bg of layers) copyLayer(c, bg);
    layers.length = 0;
    c.shownLineScroll = c.lineScroll;
    scrollLine(0);
    c.oamBuffer.fill(0x200);
  }

  /** One frame, with `held` the keys down: the start-up, then the keys, the tasks and the V-blank. */
  c.step = held => {
    if (c.startUp > 0 && --c.startUp > 0) return;
    if (c.main) {
      c.main(c);
      c.main = null;
    }
    readKeys(held);
    // 0x08002724, TasksExec: the next task is fixed before each one runs, so a task made just after the one running waits
    // for the next frame, and one made later in the list runs in this one
    for (let t = c.tasks[0]; t;) {
      nextTask = c.tasks[c.tasks.indexOf(t) + 1];
      t.main(t);
      t = nextTask;
    }
    c.flagsPreVBlank = c.flags;
    vblank();
  };
  // layer 3's scroll for line `y`, from the list the H-blank copies, if there is one
  const scrollLine = y => {
    const lines = c.shownLineScroll;
    if (!lines || y * 2 >= lines.length) return;
    video.write(REG.BG0HOFS + 12, lines[y * 2]);
    video.write(REG.BG0HOFS + 14, lines[y * 2 + 1]);
  };
  /** What the H-blank does after line `y`, which the page's drawing calls. */
  c.hblank = y => scrollLine(y + 1);
  // the screen white (forced blank) until the game shows it
  video.write(REG.DISPCNT, 0x80);
  return c;
}
