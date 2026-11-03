// The title screen, after the intro and before the main menu (the decompilation's src/unknown_0803d748.cpp:
// 0x0803e1b0, and the fades 0x0803e6e8 and 0x0803e74c). It shows four background layers and six sprites over
// them, the two largest turned by one matrix that pulses smaller every 15 frames, with the layers' scrolls
// easing into place. Start after frame 80 fades the palette to black; left alone past frame 600 it fades out to
// the game's attract mode. Neither screen after it is ported yet.
//
// The original queues its sprites and their one affine matrix for the V-blank, which copies the queue into OAM, so
// they show a frame after the layers' scrolls, which it writes directly. Their priority, 3, puts them behind the
// fourth layer, whose priority is 1: the logo's pulse reaches up behind it.

import { REG } from '../../../kit/gba/video.js';
import { KEY, clearSprites, copyAtVblank, copyToVram, fadeToBlack, queueRegister, setBlend } from './core.js';

const CARTRIDGE = 0x08000000, PALETTE = 0x05000000, SINE = 0x0804DF7C;
// gSongTable: eight bytes for each song, with the number of the player it plays on at the fifth
const SONG_TABLE = 0x08BF7244;
// the display registers the kit's REG doesn't name: BG0VOFS through BG2VOFS, BG2PC and BG2PD, and BG3's scroll
const BG0VOFS = REG.BG0HOFS + 2, BG1HOFS = REG.BG0HOFS + 4, BG1VOFS = REG.BG0HOFS + 6;
const BG2HOFS = REG.BG0HOFS + 8, BG2VOFS = REG.BG0HOFS + 10, BG2PC = REG.BG2PA + 4, BG2PD = REG.BG2PA + 6;
const BG3HOFS = REG.BG2PA - 4, BG3VOFS = REG.BG2PA - 2;

// The language byte the save holds on a first start. The original's start-up, finding no valid save, writes a
// default one (0x080215a8), whose byte 119 is 1: English in the USA copy. The title picks one of two tile sets
// by it, and 0 would pick the other.
const LANGUAGE = 1;

// The two choices of background tiles: the map goes to the same place either way.
const TILE_SETS = [
  { tiles: 0x0841A418, words: 0x1BE0, map: 0x0841DBD8 },
  { tiles: 0x0841E5D8, words: 0x1CA0, map: 0x08421F18 },
];

// The four background layers' tile and map blocks, which the original copies into VRAM at frame 0: source,
// destination and 16-bit words. The first layer's tiles are the tile set above; these are the other blocks.
const LAYERS = [
  [0x08423FD8, 0x06004000, 0x300],
  [0x084245D8, 0x06007800, 0x400],
  [0x08424DF8, 0x06008000, 0x300],
  [0x084253F8, 0x0600B800, 0x400],
  [0x08425C18, 0x0600C000, 0x210],
  [0x08426038, 0x0600F800, 0x400],
];

// The sprites' tiles, at 0x06010000 and 0x06011000, with the 1D object mapping DISPCNT gives them.
const SPRITE_TILES = [
  [0x08422738, 0x06010000, 0xC40],
  [0x08426858, 0x06011000, 0x800],
];

// The palette loads of frame 1: two 16-colour sprite palettes, then the backgrounds' 256 colours.
const PALETTES = [
  [0x08422718, 0x05000200, 0x10],
  [0x08426838, 0x05000220, 0x10],
  [0x0841A218, 0x05000000, 0x100],
];

// The six sprites, as 0x0803e1b0 queues them: x, y, tile, palette and the engine's sprite type. Types 106 and
// 117 are the engine's: 106 is the big affine sprite (0x4300 in its first word: shape and double size), 117 a
// normal 64x32 one. The affine two share matrix 0, which the matrix upload below fills.
const SPRITES = [
  { x: 32, y: 110, tile: 0, palette: 0, type: 106 },
  { x: 88, y: 110, tile: 32, palette: 0, type: 106 },
  { x: 0, y: 128, tile: 128, palette: 1, type: 117 },
  { x: 64, y: 128, tile: 160, palette: 1, type: 117 },
  { x: 128, y: 128, tile: 192, palette: 1, type: 117 },
  { x: 192, y: 128, tile: 224, palette: 1, type: 117 },
];

// The scene's counters and the values they ease, named after the original's gUnknown_030016bc, its pulse
// counter gUnknown_03001b08, x gUnknown_03001b2c, y gUnknown_030016c0, scale gUnknown_03001b24 and targets.
const s16 = v => (v << 16) >> 16;

/** 0x08016b30's cases 106 and 117: a sprite's type and its place as the three words of an OAM entry. 0x08017690
 *  gives every sprite priority 3 here. */
function oamEntry({ x, y, tile, palette, type }) {
  const base = type === 106 ? 0x4300 : 0x4000;
  return [base | y, 0xC000 | (x & 0x1FF), (tile & 0x3FF) | (3 << 10) | ((palette & 0xF) << 12)];
}
const ENTRIES = SPRITES.map(oamEntry);

/** One of the palette loads of frame 1, into the kit's palette. */
function copyToPalette(c, from, to, words) {
  const at = from - CARTRIDGE, out = (to - PALETTE) >> 1;
  for (let i = 0; i < words; i++) c.video.pal[out + i] = c.rom.u16(at + i * 2);
}

/** 0x0803e1b0's frame 0: the display off, the four layers and their pictures, the sprites' tiles, the BG2
 *  matrix at its start, and where the scene's counters begin. */
function firstFrame(c) {
  queueRegister(c, REG.DISPCNT, 0x40);
  c.video.write(REG.BG0CNT, 0x0F07);
  c.video.write(REG.BG1CNT, 0x170B);
  c.video.write(REG.BG2CNT, 0x1F0F);
  c.video.write(REG.BG3CNT, 0x1E81);
  const tiles = TILE_SETS[LANGUAGE];
  copyToVram(c, tiles.tiles, 0x06000000, tiles.words);
  copyToVram(c, tiles.map, 0x0600F000, 0x400);
  for (const [from, to, words] of LAYERS) copyToVram(c, from, to, words);
  c.titleX = -16;
  c.titleY = 0;
  c.titleTargetX = 36;
  c.titleTargetY = 0;
  c.titleScale = 256;
  c.titleScaleTarget = 256;
  // BG3's scroll, then BG2's matrix (the identity) and reference point
  c.video.write(BG3HOFS, 0);
  c.video.write(BG3VOFS, 0);
  c.video.write(REG.BG2PA, 256);
  c.video.write(REG.BG2PA + 2, 0);
  c.video.write(BG2PC, 0);
  c.video.write(BG2PD, 256);
  c.video.write(REG.BG2X, 0);
  c.video.write(REG.BG2X + 2, 0);
  c.video.write(REG.BG2Y, 0);
  c.video.write(REG.BG2Y + 2, 0);
  for (const [from, to, words] of SPRITE_TILES) copyToVram(c, from, to, words);
}

/** 0x0803e1b0's frame 1: the palettes, and the display on again, queued for the next V-blank. */
function secondFrame(c) {
  for (const [from, to, words] of PALETTES) copyToPalette(c, from, to, words);
  queueRegister(c, REG.DISPCNT, 0x1F40);
}

/** The matrix the two affine sprites share: a scale from the angle's cosine over the scene's scale, no turn. */
function matrix(c) {
  const cosine = c.rom.s16(SINE - CARTRIDGE + 0x800 * 2) << 3;
  const sine = c.rom.s16(SINE - CARTRIDGE) << 3;
  const over = value => Math.trunc(value / c.titleScale);
  return [over(cosine) & 0xFFFF, over(sine) & 0xFFFF, -over(sine) & 0xFFFF, over(cosine) & 0xFFFF];
}

/** The six sprites and their matrix, queued for the V-blank (0x08018004 and 0x08017f34), which it asks to copy. */
function queueSprites(c) {
  clearSprites(c);
  c.sprites.push(...ENTRIES);
  c.matrices.push(matrix(c));
  copyAtVblank(c);
}

/** 0x0803e6e8: the palette one step to black each frame, then the next screen; none is ported, so it stops. */
function fadeToNext(c) {
  if (fadeToBlack(c, PALETTE, 256)) {
    setBlend(c, 0, 0, 0, 0, 0, 0);
    c.video.pal.fill(0, 0, 256);
    queueRegister(c, REG.DISPCNT, 0x1F40);
    c.callback = afterTitle;
  }
}

/** 0x0803e74c: the same fade when the title screen is left alone, out to the attract mode. */
function fadeToAttract(c) {
  if (fadeToBlack(c, PALETTE, 256)) {
    setBlend(c, 0, 0, 0, 0, 0, 0);
    c.video.pal.fill(0, 0, 256);
    queueRegister(c, REG.DISPCNT, 0x1F40);
    c.callback = afterTitle;
  }
}

/** What follows neither screen is ported yet: the screen goes black and waits there. */
function afterTitle(c) {
  c.video.pal.fill(0);
  c.video.oam.fill(0x200);
}

/**
 * 0x0803e1b0: the title screen's callback. The intro hands over with both counters at -1, so its first frame
 * is this function's frame 0, which sets the screen up; frame 1 loads the palettes; from then on the scale
 * pulses and the layers ease, until Start (pressed after frame 80) or the 600-frame attraction timeout.
 */
export function title(c) {
  c.titleCounter = s16(c.titleCounter + 1);
  c.titlePulse = s16(c.titlePulse + 1);
  if (c.titleCounter === 0) firstFrame(c);
  else if (c.titleCounter === 1) secondFrame(c);
  else if (c.titleCounter === 15) c.titleTargetY = 40;
  if (c.titlePulse === 15) {
    if (++c.titlePulseCount > 3) {
      c.titlePulseCount = 0;
      c.titleScale = 448;
    } else c.titleScale = 352;
    c.titlePulse = 0;
    c.titleScaleTarget = 256;
  }
  c.titleScale = s16(c.titleScale - ((c.titleScale - c.titleScaleTarget) >> 2));
  c.titleX = s16(c.titleX - ((c.titleX - c.titleTargetX) >> 2));
  c.titleY = s16(c.titleY - ((c.titleY - c.titleTargetY) >> 2));
  // BG2 turns diagonally with the frame count, and BG0 and BG1 slide opposite ways with the eased x and y
  const scroll = (c.titleCounter & 0xFFFF) * 2;
  c.video.write(BG2HOFS, scroll);
  c.video.write(BG2VOFS, -scroll);
  c.video.write(BG1HOFS, -c.titleX);
  c.video.write(BG1VOFS, 48 - c.titleY);
  c.video.write(REG.BG0HOFS, c.titleX);
  c.video.write(BG0VOFS, 48 + c.titleY);
  queueSprites(c);
  if ((c.keys.pressed & KEY.START) && c.titleCounter > 80) {
    c.titleCounter = 0;
    c.titlePulse = 0;
    c.titleX = 0;
    c.titleY = 0;
    c.titleTargetX = 0;
    c.titleTargetY = 0;
    clearSprites(c);
    c.sound?.play(404);          // 0x0801f618
    // 0x0801f718(0, 120): the player of song 0, the title's music, a step down every 120 >> 4 frames
    c.sound?.fadeOut(c.rom.bytes[SONG_TABLE - CARTRIDGE + 4], 7);
    c.callback = fadeToNext;
  } else if (c.titleCounter > 600) {
    c.titleCounter = 0;
    c.titlePulse = 0;
    c.titleX = 0;
    c.titleY = 0;
    c.titleTargetX = 0;
    c.titleTargetY = 0;
    clearSprites(c);
    c.callback = fadeToAttract;
  }
}

/** The intro's hand-over: both frame counters start at -1, the palettes are black, and the title's frame 0 is
 *  the next one. The original's intro does this at 0x0803d860's Start and at 0x0803dd14's frame 90 and Start. */
export function toTitle(c) {
  c.video.pal.fill(0);
  c.titleCounter = -1;
  c.titlePulse = -1;
  c.titlePulseCount = 0;
  c.titleX = 0;
  c.titleY = 0;
  c.titleTargetX = 0;
  c.titleTargetY = 0;
  c.titleScale = 0;
  c.titleScaleTarget = 0;
  c.callback = title;
}
