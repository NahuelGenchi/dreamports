// Sonic Battle's engine core, rewritten from how the original does it. The cypressru decompilation
// (src/main.cpp, src/core.cpp and the units around them) is the guide; where it has no C yet, the original's
// own instructions are. Its functions have no names yet, so each is named here by its address in the USA copy,
// the way the decompilation labels them (FUN_08000210 is 0x08000210 here).
//
// AgbMain (0x08000778) starts the console up, then runs its main loop once a frame: it reads the keys, runs the
// screen's callback, waits for the V-blank, whose interrupt applies the display registers the callback queued,
// and copies what the callback queued for VRAM. A callback writes the palette, VRAM and most registers
// directly, while the V-blank is still on, so they show in the next frame; the registers it queues show a frame
// later. Here a frame is step(): the V-blank's work comes first, then the callback, then the kit draws.
//
// The video hardware is the kit's (kit/gba/video.js), and the cartridge is the player's copy, which every copy
// reads from at the address the original reads.

import { REG } from '../../../kit/gba/video.js';

// the GBA's buttons, a bit each, as KEYINPUT has them
export const KEY = { A: 0x1, B: 0x2, SELECT: 0x4, START: 0x8, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80, R: 0x100, L: 0x200 };

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, VRAM = 0x06000000;

// The frames the console takes from power-on to the first frame of the main loop's work, with the screen white
// (DISPCNT's forced blank) all along: clearing the work RAM (0x08017c74), reading the save from flash a sector
// at a time and checking each (0x080216e4, 0x080218ac, 0x08021a40), starting the sound engine (0x0801f5ec),
// and the first callback, 0x08000210, which clears the whole of VRAM by DMA and runs on into the frame after.
// None of it shows; only how long it takes does, which is the console's timing, as mGBA measures it.
const START_UP_FRAMES = 45;

/** The core's state on `video` (createVideo), reading the cartridge from `rom` (rom.js). */
export function createCore(video, rom) {
  const c = {
    video, rom,
    // gUnknown_03002030: the screen's callback, which the main loop runs once a frame
    callback: null,
    // gUnknown_030048e0: the keys (0x08020198)
    keys: { held: 0, inverted: 0xFFFF, pressed: 0, released: 0, repeated: 0, timer: 0, delay: 0, interval: 0 },
    // gUnknown_03000070 and gUnknown_030000c0: display registers queued for the next V-blank (0x0801fba0)
    queue: [],
    // gUnknown_03003178: the copies of BG0CNT to BG3CNT
    bgCnt: new Uint16Array(4),
    // gUnknown_03003380 and gUnknown_03003140: the rotating layers' parameters, in two halves, the one being
    // written and the one the V-blank copies
    affine: [new Uint16Array(16), new Uint16Array(16)], affineHalf: 0,
    // gUnknown_030013a0: set when the V-blank should copy the parameters and the sprites (nothing here sets it)
    vblankCopies: 0,
    // gUnknown_03001b08, gUnknown_030016c0 and gUnknown_03001b2c: the logos' frame count, the cross-fade's
    // target and where it is (logos.js)
    counter: 0, blendTarget: 0, blend: 0,
    // gUnknown_03001378 and gUnknown_03002610: V-blanks and main loop frames counted
    vblanks: 0, frames: 0,
    startUp: START_UP_FRAMES,
    main: null,
  };
  // the console after its start-up program: the screen white (forced blank) until the game shows it
  video.write(REG.DISPCNT, 0x80);
  return c;
}

/** One frame: the console's start-up, then the main loop (AgbMain, 0x08000778), with `held` the keys down. */
export function step(c, held) {
  if (c.startUp > 0) {
    if (--c.startUp === 0) {
      // the end of AgbMain's start-up: every colour white (CpuFastSet of 0x7FFF7FFF), then the first callback
      c.video.pal.fill(0x7FFF);
      c.callback = c.main;
      readKeys(c, held);
      c.callback(c);
    }
    return;
  }
  vblank(c);
  // 0x08020244: the copies queued for VRAM; nothing queues one yet
  readKeys(c, held);
  // 0x080005ac: a link cable game's reset, which needs a second console
  c.callback(c);
}

// 0x08020198: the keys held now, those just pressed and just released, and those repeating while held
function readKeys(c, held) {
  const k = c.keys, oldHeld = k.held, oldInverted = k.inverted;
  k.inverted = (~held & 0x3FF) | 0xFC00;
  k.held = ~k.inverted & 0xFFFF;
  k.pressed = oldInverted & k.held;
  k.released = k.inverted & oldHeld;
  if (k.held === 0) { k.repeated = 0; return; }
  if (k.held > oldHeld) {
    k.repeated = oldHeld ^ k.held;
    k.timer = k.delay;
    return;
  }
  k.timer = (k.timer - 1) & 0xFF;
  if (k.timer !== 0) { k.repeated = 0; return; }
  k.repeated = k.held;
  k.timer = k.interval;
}

// 0x080185d8, the V-blank interrupt: the sound engine's frame (0x0801f60c), the V-blanks counted, the registers
// queued (0x0801fbd8), and the frame counted. Copying the rotation parameters and the sprites waits for
// gUnknown_030013a0, which nothing sets yet.
function vblank(c) {
  c.vblanks++;
  // 0x0801fbd8, 0x0801fbfc
  for (const [offset, value] of c.queue) c.video.write(offset, value);
  c.queue.length = 0;
  c.frames++;
}

/** 0x0801fba0: a display register written at the next V-blank, at most 20 a frame. */
export function queueRegister(c, offset, value) {
  if (c.queue.length <= 19) c.queue.push([offset, value]);
}

/** DMA 3 copying `count` 16-bit words from the cartridge to VRAM, as the original's copies of pictures do. */
export function copyToVram(c, from, to, count) {
  const at = from - CARTRIDGE;
  c.video.vram.set(c.rom.bytes.subarray(at, at + count * 2), to - VRAM);
}

/** The palette's colours from `first`, as 16-bit words, the way the original reads and writes 0x05000000 on. */
export const colours = (c, first = PALETTE) => c.video.pal.subarray((first - PALETTE) >> 1);

// 0x080163c0, 0x08017d78, 0x08017de8 and 0x08017e5c: a layer's BGxCNT cleared, or given more bits (its own,
// its character base's, its screen base's), in the copy and the register
const BGCNT = [REG.BG0CNT, REG.BG1CNT, REG.BG2CNT, REG.BG3CNT];
export function clearLayer(c, layer) { c.bgCnt[layer] = 0; c.video.write(BGCNT[layer], 0); }
export function layerBits(c, layer, bits) { c.bgCnt[layer] |= bits; c.video.write(BGCNT[layer], c.bgCnt[layer]); }
export const layerCharBase = (c, layer, base) => layerBits(c, layer, (base << 2) & 0xFFFF);
export const layerScreenBase = (c, layer, base) => layerBits(c, layer, (base << 8) & 0xFFFF);

/** 0x080183d0: the colour effect, BLDCNT, BLDALPHA and BLDY. */
export function setBlend(c, effect, first, second, a, b, y) {
  c.video.write(REG.BLDCNT, first | (second << 8) | (effect << 6));
  c.video.write(REG.BLDALPHA, a | (b << 8));
  c.video.write(REG.BLDY, y);
}

// the BIOS's division (DivArm, 0x0804a5a0): the numerator over the denominator, rounded toward zero
const divArm = (denominator, numerator) => Math.trunc(numerator / denominator);
const s16 = v => (v << 16) >> 16;

/**
 * 0x08016438: rotating layer `layer`'s parameters (2 or 3), scaled and turned about `originX`, `originY`, into
 * the half of gUnknown_03003380 the V-blank doesn't copy. The angle reads the cartridge's sine table
 * (gUnknown_0804df7c), whose 0x800 is a quarter turn.
 */
export function setRotation(c, originX, originY, firstDenominator, secondDenominator, scaleX, scaleY, angle, layer) {
  const sine = a => c.rom.s16(0x0804DF7C - CARTRIDGE + a * 2);
  const pa = (scaleX * divArm(s16(firstDenominator), sine(angle + 0x800) << 3)) & 0xFFFF;
  const pb = (scaleY * divArm(s16(firstDenominator), sine(angle) << 3)) & 0xFFFF;
  const pc = (scaleX * -divArm(s16(secondDenominator), sine(angle) << 3)) & 0xFFFF;
  const pd = (divArm(s16(secondDenominator), sine(angle + 0x800) << 3) * scaleY) & 0xFFFF;
  const x = (0x8000 - s16(pa) * s16(originX) - s16(pb) * s16(originY)) | 0;
  const y = (0x8000 - s16(pc) * s16(originX) - s16(pd) * s16(originY)) | 0;
  const out = c.affine[c.affineHalf ^ 1], at = layer === 2 ? 0 : layer === 3 ? 8 : -1;
  if (at < 0) return;
  out.set([pa, pb, pc, pd, x & 0xFFFF, (x & 0x0FFF0000) >>> 16, y & 0xFFFF, (y & 0x0FFF0000) >>> 16], at);
}

/**
 * 0x08020500: each of `count` colours from `first` one step nearer the cartridge's colours at `from`, in each of
 * red, green and blue. True once every colour is there.
 */
export function fadeToward(c, first, from, count) {
  const out = colours(c, first), at = from - CARTRIDGE;
  let done = true;
  for (let i = 0; i < count; i++) {
    const want = c.rom.u16(at + i * 2);
    let v = out[i];
    if ((v & 0x7FFF) !== (want & 0x7FFF)) {
      if ((v & 0x1F) > (want & 0x1F)) v--;
      if ((v & 0x1F) < (want & 0x1F)) v++;
      if ((v & 0x3E0) > (want & 0x3E0)) v -= 0x20;
      if ((v & 0x3E0) < (want & 0x3E0)) v += 0x20;
      if ((v & 0x7C00) > (want & 0x7C00)) v -= 0x400;
      if ((v & 0x7C00) < (want & 0x7C00)) v += 0x400;
      out[i] = v & 0xFFFF;
      done = false;
    }
  }
  return done;
}

/** 0x0802067c: each of `count` colours from `first` one step darker in each of red, green and blue. True once
 *  they're all black. */
export function fadeToBlack(c, first, count) {
  const out = colours(c, first);
  let done = true;
  for (let i = 0; i < count; i++) {
    let v = out[i];
    if (v & 0x7FFF) {
      if (v & 0x1F) v--;
      if (v & 0x3E0) v -= 0x20;
      if (v & 0x7C00) v -= 0x400;
      out[i] = v;
      done = false;
    }
  }
  return done;
}

/**
 * 0x08016078: a new screen's start. Every colour becomes the first one (a CpuSet of the palette onto itself, one
 * word along), VRAM is cleared, every sprite hidden with its rotation the identity, and the core's state reset.
 * `mode` 1 to 4 and 40 queue the display for rotating layers 2 and 3 with sprites (DISPCNT 0x1C62), mode 6 writes
 * it at once, and mode 5 only sets the interrupts up, which the kit's frames stand in for.
 */
export function newScreen(c, mode) {
  const { video } = c;
  video.pal.fill(video.pal[0], 1);
  video.vram.fill(0);
  for (let i = 0; i < 32; i++) {
    video.oam.set([0x200, 0, 0, 0x100, 0x200, 0, 0, 0, 0x200, 0, 0, 0, 0x200, 0, 0, 0x100], i * 16);
  }
  c.affineHalf = 0;
  c.vblankCopies = 0;
  if ((mode >= 1 && mode <= 4) || mode === 40) queueRegister(c, REG.DISPCNT, 0x1C62);
  else if (mode === 6) video.write(REG.DISPCNT, 0x1C62);
  c.blend = 0;
  c.blendTarget = 0;
  c.counter = 0;
}
