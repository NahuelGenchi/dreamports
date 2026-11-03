// The main menu, after the title screen (the decompilation's src/unknown_08039dd8.cpp: the initializer 0x08039e20,
// its frame wrapper 0x08039fd0 and the handlers 0x08039fe0, 0x0803a3b8, 0x0803a428, 0x0803a0f8, 0x0803a478 and
// 0x0803a260). It shows the mode select: a background of two layers, the preview of each mode's picture fading in
// over them, the animated picture on the right, and the two arrows that move the choice.
//
// The name entry between the title screen and this one isn't ported: the title's Start hands over here, and the
// recording that proves this part skips the name entry in the original (proof/recordings/menu.json, onlyInOriginal).
//
// The screen's layers, as its register table (0x0815f02c) sets them: BG0, 16 colours, its picture 0x380 up at
// 0x06007000, priority 0, shows the preview block; BG1, 16 colours, its tiles 0x292 up at 0x0600d240, the repeated
// pattern, priority 3; BG2, blank, priority 0; BG3, the 256-colour picture at 0x06000000, priority 1, whose map
// the animated block cycles through. BG3 keeps the screen base the title gave it (0x1e81: 0xf000), which is why the
// animated block goes to 0xf0a6 and not to BG0's map.

import { REG } from '../../../kit/gba/video.js';
import { KEY, decompress, copyTileBlock, fadeToward, fadeToBlack, queueRegister, copyAtVblank, clearSprites } from './core.js';

const CARTRIDGE = 0x08000000;

// 0x0815f02c: the display registers the initializer writes, in its order, each as the offset the original writes
// it at in 0x04000000 and its value. The kit keeps some registers at offsets of its own (its BG1CNT is 0x0a where
// the console's is 0x0e, and its scrolls follow BG0HOFS at 0x10), so each console offset is the kit's here.
// The name entry between the title screen and this one leaves BG3's control as the title set it (0x1e81: the
// 256-colour layer at 0xf000), and this screen doesn't touch it, so the Dreamport sets it as the title did.
const REG_OF = {
  0x00: REG.DISPCNT, 0x08: REG.BG0CNT, 0x0A: REG.BG0HOFS, 0x0C: REG.BG0HOFS + 2,
  0x0E: REG.BG1CNT, 0x10: REG.BG0HOFS + 4, 0x12: REG.BG0HOFS + 6,
  0x14: REG.BG2CNT, 0x16: REG.BG0HOFS + 8, 0x18: REG.BG0HOFS + 10,
  0x1A: REG.BG2PA, 0x1C: REG.BG2PA + 2, 0x1E: REG.BG2PA + 4,
  0x50: REG.BLDCNT, 0x52: REG.BLDALPHA, 0x54: REG.BLDY,
};
const REGISTERS = [
  [0x00, 0x0000], [0x08, 0x1F00], [0x10, 0x0000], [0x12, 0x0000], [0x0A, 0x1E0B], [0x14, 0x0000],
  [0x16, 0x0000], [0x0C, 0x1D03], [0x18, 0x0000], [0x1A, 0x0000], [0x0E, 0x1C0B], [0x1C, 0x0000],
  [0x1E, 0x0000], [0x50, 0x3F41], [0x52, 0x1000], [0x54, 0x0000],
].map(([offset, value]) => [REG_OF[offset], value]);
// BG3's control, which the title set and the name entry leaves as it is
const BG3CNT = REG.BG3CNT, BG3CNT_VALUE = 0x1E01;

// the pictures the initializer decompresses: the 256-colour one BG3 shows, BG1's tiles, BG3's own tiles, and the
// language's sprite tiles (0x08edd314 picks one of six)
const PICTURES = [[0x0815F06C, 0x06000000], [0x0815C4B4, 0x06008000], [0x08132544, 0x0600D240]];
const SPRITE_PICTURES = [0x0815FAFC, 0x08160244, 0x08160244, 0x08160244, 0x08160244, 0x08160244];

// the palette each fade steps toward, and where it is
const FADES = [
  [0x05000000, 0x0815F7F8], [0x050001C0, 0x0815E67C], [0x050001E0, 0x081326F4], [0x05000200, 0x081609C4],
];

// the previews: a block of 0x1000 bytes of graphics for each choice, and 0x20 bytes of palette, by language
const PREVIEW_GRAPHICS = [0x081609E4, 0x081679E4, 0x081679E4, 0x081679E4, 0x081679E4, 0x081679E4];
const PREVIEW_PALETTE = 0x0816E9E4;
// the preview's block of BG0's map: 16 by 8 entries from 0x0816eaec, tile 0x380 on palette 13
const PREVIEW_MAP = 0x0600FA06, PREVIEW_MAP_TABLE = 0x0816EAEC, PREVIEW_MAP_TILE = 0xD380;
// the repeated pattern of BG1's map: 8 by 8 entries from 0x081327d4, four times each way, tile 0x292 on palette 15
const PATTERN = 0x081327D4, PATTERN_TILE = 0xF292;
// the animated picture's block of BG3's map: 16 frames of 12 by 17 entries from 0x0815e69c, at 0x0600f0a6
const ANIMATION = 0x0815E69C, ANIMATION_MAP = 0x0600F0A6, ANIMATION_FRAMES = 8, ANIMATION_WORDS = 12 * 17;
// the sprites' definition (the parts of one picture: tile, attributes, x and y offsets), which the engine reads
const PARTS = 0x0816EACC;

// the language byte the save keeps, which picks the pictures: English in the USA copy
const LANGUAGE = 1;
// gSongTable's first entry is the menu's song
const SONG = 1;
// the sound effects: the choice moving, the choice made, the arrows appearing, and the refused name entry's
const SOUND_MOVE = 401, SOUND_MADE = 404, SOUND_ARRIVED = 1;

/** The parts of a picture at `at`, each eight bytes, the last one's eighth byte zero (0x0801fda0's loop). */
function partsOf(c, at) {
  const parts = [];
  for (let i = 0; i < 32; i++) {
    const p = at - CARTRIDGE + i * 8;
    parts.push({
      tile: c.rom.u16(p), attr0: c.rom.u8(p + 2), attr1: c.rom.u8(p + 3), attr2: c.rom.u8(p + 4),
      x: (c.rom.u8(p + 5) << 24) >> 24, y: (c.rom.u8(p + 6) << 24) >> 24,
    });
    if (!c.rom.u8(p + 7)) break;
  }
  return parts;
}

/** One sprite's OAM entry, as 0x0801fda0 makes it from its place and its parts: three words, priority included. */
function oamEntry(c, sprite) {
  const { position, parts } = sprite;
  return parts.map(part => [
    (((part.attr0 + position.attr0) & 0xFF) << 8) | ((part.y + position.y) & 0xFF),
    (((part.attr1 + position.attr1) & 0xFF) << 8) | ((part.x + position.x) & 0x1FF),
    (((part.attr2 + position.attr2) & 0xFF) << 8) | ((part.tile + position.tile) & 0xFFFF),
  ]);
}

/** 0x0801fed8 and 0x0801fda0: the sprites that asked to be drawn this frame, highest priority first, newest
 *  first among those of one priority, each an OAM entry. */
function drawSprites(c) {
  const drawn = c.menu.sprites.filter(sprite => sprite.drawn);
  const groups = [0, 1, 2, 3].map(priority => drawn.filter(sprite => ((sprite.position.attr2 & 0x0C) >> 2) === priority));
  const entries = [];
  for (const group of groups) for (let i = group.length - 1; i >= 0; i--) entries.push(...oamEntry(c, group[i]));
  for (const sprite of drawn) sprite.drawn = false;
  clearSprites(c);
  c.sprites.push(...entries);
  copyAtVblank(c);
}

/** The palette one step nearer its colours, and whether every one of the four has arrived (0x08039fe0). */
function fadePalettes(c) {
  const pending = FADES.map(([first, from]) => fadeToward(c, first, from, 16));
  return pending.every(done => done);
}

/** 0x0803a3b8: the choice's preview picture and palette, and the blend that fades it in. */
function loadPreview(c) {
  const selection = c.menu.selection, language = LANGUAGE;
  const from = PREVIEW_GRAPHICS[language] + selection * 0x1000, to = 0x06007000;
  const at = from - CARTRIDGE, vram = c.video.vram;
  vram.set(c.rom.bytes.subarray(at, at + 0x1000), to - 0x06000000);
  const paletteAt = PREVIEW_PALETTE - CARTRIDGE + selection * 0x20, out = (0x050001A0 - 0x05000000) >> 1;
  for (let i = 0; i < 16; i++) c.video.pal[out + i] = c.rom.u16(paletteAt + i * 2);
  c.video.write(REG.BLDCNT, 0x3F41);
  c.video.write(REG.BLDALPHA, 0x1000);
  c.menu.phase = 'previewFade';
}

/** 0x0803a428: the preview fades in, a step a frame, and then the choice can be moved. */
function previewFade(c) {
  const state = ++c.menu.state;
  if (state <= 15) c.video.write(REG.BLDALPHA, ((0x1000 - (state << 8)) & 0xFFFF) | state);
  else {
    c.menu.state = 16;
    c.video.write(REG.BLDALPHA, 16);
    c.menu.phase = 'input';
  }
  input(c);
}

/** 0x0803a0f8: A chooses, and left and right move the choice round the seven, the arrow they go past sliding. */
function input(c) {
  const pressed = c.keys.pressed;
  if (pressed & KEY.A) {
    c.menu.stored = c.menu.selection;
    c.menu.phase = 'leaving';
    c.sound?.fadeOut(1, 7);          // 0x0801f718(1, 120): the menu's song, a step down every 120 >> 4 frames
    c.sound?.play(SOUND_MADE);
  } else if (pressed & KEY.LEFT) {
    c.menu.selection = (c.menu.selection + 6) % 7;
    c.menu.phase = 'previewOut';
    slideArrow(c, c.menu.left, -1);
    c.sound?.play(SOUND_MOVE);
  } else if (pressed & KEY.RIGHT) {
    c.menu.selection = (c.menu.selection + 1) % 7;
    c.menu.phase = 'previewOut';
    slideArrow(c, c.menu.right, 1);
    c.sound?.play(SOUND_MOVE);
  }
}

/** 0x0803a478: the preview fades out, then the new one loads. */
function previewOut(c) {
  if (c.menu.state) {
    const state = --c.menu.state;
    c.video.write(REG.BLDALPHA, ((0x1000 - (state << 8)) & 0xFFFF) | state);
  } else {
    c.video.write(REG.BLDALPHA, 4096);
    c.menu.phase = 'preview';
  }
}

/** 0x0803a260: A fades every colour to black, and then the chosen mode's screen starts. */
function leaving(c) {
  if (fadeToBlack(c, 0x05000000, 512)) {
    c.menu.phase = 'black';
    c.menu.done = true;
    c.callback = black;
  }
}

/** What comes after the menu isn't ported yet: the screen stays black. */
function black(c) {
  c.video.pal.fill(0);
}

/**
 * 0x08027fb8 and 0x08028038: the arrow the choice went past slides, and 0x08028388 and 0x080283c0 hold it where it
 * belongs. The slide moves the arrow's place about its centre, four frames in, a step every three frames.
 */
function slideArrow(c, arrow, direction) {
  arrow.callback = 'slide';
  arrow.direction = direction;
  arrow.position.state = 0;
}

function arrowFrame(c, arrow) {
  if (arrow.callback === 'slide') {
    const state = arrow.position.state;
    if (state <= 15) {
      const offset = state <= 3 ? state : 4 - (Math.trunc((state - 4) / 3) % 4);
      arrow.position.attr0 = 3;
      arrow.position.x = arrow.baseX - (offset + 64) * (arrow.direction < 0 ? 1 : -1);
      arrow.position.y = arrow.baseY - 64;
      arrow.position.state = state + 1;
    } else {
      arrow.callback = 'settled';
    }
  }
  if (arrow.callback === 'settled') {
    arrow.position.x = arrow.baseX;
    arrow.position.y = arrow.baseY;
    arrow.position.attr0 = 0;
    arrow.position.attr1 = 0;
    arrow.position.state = (arrow.position.state + 4) & 0xFF;
  }
  arrow.drawn = true;
}

/** 0x08039dd8: the animated picture's block of the map, its frame a quarter of every 24 the timer counts. */
function animate(c) {
  c.menu.timer = (c.menu.timer + 1) % 24;
  const frame = (c.menu.timer >> 2) & 7;
  copyTileBlock(c, ANIMATION_MAP, ANIMATION + frame * ANIMATION_WORDS * 2, 12, 17, 0xE000);
}

/** 0x08039dd8's first frame: the timer starts at 0 before its first step. */
function firstAnimation(c) {
  copyTileBlock(c, ANIMATION_MAP, ANIMATION, 12, 17, 0xE000);
}

/** 0x08039fe0: the palettes fade in; once they have, the arrows appear and the choice's preview loads. */
function controller(c) {
  if (c.menu.phase === 'fadeIn') {
    if (fadePalettes(c)) {
      c.menu.selection = c.menu.stored;
      c.menu.arrows = true;
      c.menu.left.callback = 'settled';
      c.menu.right.callback = 'settled';
      c.menu.phase = 'preview';
    }
  } else if (c.menu.phase === 'preview') loadPreview(c);
  else if (c.menu.phase === 'previewFade') previewFade(c);
  else if (c.menu.phase === 'input') input(c);
  else if (c.menu.phase === 'previewOut') previewOut(c);
  else if (c.menu.phase === 'leaving') leaving(c);
}

/**
 * 0x08039e20: the screen's first frame. The display off, the registers, the palettes black, the pictures and their
 * maps, the three sprites, and the frame wrapper that runs them; the display is queued on for the next V-blank.
 */
export function menu(c) {
  c.menu = {
    phase: 'fadeIn', timer: -1, scroll: 0, selection: 0, stored: 0, state: 0, arrows: false,
    sprites: [], left: null, right: null,
    main: {
      position: { x: 64, y: 32, tile: 128, attr0: 0, attr1: 0, attr2: 0 }, parts: partsOf(c, PARTS), drawn: false,
    },
  };
  for (const [offset, value] of REGISTERS) c.video.write(offset, value);
  c.video.write(BG3CNT, BG3CNT_VALUE);
  c.video.pal.fill(0);
  for (const [from, to] of PICTURES) decompress(c, from, to);
  decompress(c, SPRITE_PICTURES[LANGUAGE], 0x06010000);
  c.video.vram.fill(0, 0x0600F800 - 0x06000000, 0x0600F800 - 0x06000000 + 0x400);
  copyTileBlock(c, PREVIEW_MAP, PREVIEW_MAP_TABLE, 16, 8, PREVIEW_MAP_TILE);
  c.video.vram.fill(0, 0x0600F000 - 0x06000000, 0x0600F000 - 0x06000000 + 0x400);
  decompress(c, 0x0815F818, 0x0600E800);
  let at = 0x0600E000;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      copyTileBlock(c, at, PATTERN, 8, 8, PATTERN_TILE);
      at += 0x10;
    }
    at += 0x1C0;
  }
  firstAnimation(c);
  const left = { baseX: 64 - 32, baseY: 146 - 32, direction: -1, position: { x: 32, y: 114, tile: 0, attr0: 0, attr1: 0, attr2: 0 }, parts: partsOf(c, PARTS), drawn: false };
  const right = { baseX: 176 - 32, baseY: 118 - 32, direction: 1, position: { x: 144, y: 86, tile: 64, attr0: 0, attr1: 0, attr2: 0 }, parts: partsOf(c, PARTS), drawn: false };
  c.menu.left = left;
  c.menu.right = right;
  c.menu.sprites.push(c.menu.main);
  hideSprites(c);
  clearSprites(c);
  queueRegister(c, REG.DISPCNT, 0x1F40);
  c.callback = frame;
  c.sound?.play(SONG);
}

/** 0x0801ff30: every sprite hidden, so the title's don't stay on screen. */
function hideSprites(c) {
  for (let i = 0; i < 32; i++) c.video.oam.fill(0, i * 4, i * 4 + 4), (c.video.oam[i * 4] = 0x200);
}

/** 0x08039fd0: the frame wrapper. 0x0801f89c runs the nodes in their order, 0x0801fda0 draws the sprites they
 *  asked for; the animated picture's timer goes before the sprites are added. */
function frame(c) {
  c.menu.scroll = (c.menu.scroll - 1) & 0xFFFFFFFF;
  queueRegister(c, REG.BG2PA + 4, (c.menu.scroll & 0x1FE) >> 1);
  animate(c);
  c.menu.main.drawn = true;
  if (c.menu.arrows) {
    const left = c.menu.left, right = c.menu.right;
    if (!left.position.drawnOnce) { left.callback = 'settled'; left.position.drawnOnce = true; }
    if (!right.position.drawnOnce) { right.callback = 'settled'; right.position.drawnOnce = true; }
    arrowFrame(c, left);
    arrowFrame(c, right);
  }
  controller(c);
  drawSprites(c);
}
