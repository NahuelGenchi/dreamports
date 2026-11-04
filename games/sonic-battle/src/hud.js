// The fight's HUD and the choice of special attacks, rewritten from the original's instructions. A mode byte says
// which screen of the fight's frame is showing: 10 to 12 the choice of the three specials, 20 and 40 banners that slide
// across, 30 the bars, timer and scores of the fight itself, 50 a blinking line, and 60 the question after a fight.
// 0x08012b98 starts a mode and 0x08013214 draws it once a frame, as sprites queued for the next V-blank.
//
// Their state stays in work RAM at the original's address, the block at 0x030030d0, which the fight's other parts read
// too. Every picture and colour is read from the cartridge by its address as the original reads it.

import { decompress, queueCopy } from './core.js';
import { read8, read16, read32, reads16, write8, write16, copy16, copy32 } from './bus.js';
import { fn08015924 } from './fighters.js';

// gUnknown_030030d0: the HUD's state
const HUD = 0x030030D0;
const MODE = 0, CHOICE = 1, BOUNCE = 2, STEP = 3, TIMER = 4, PICKS = 6, TAKEN = 9;
const X1 = 12, X2 = 14, X3 = 16, Y1 = 18, Y2 = 20, Y3 = 22;
const X1_GOAL = 24, X2_GOAL = 26, X3_GOAL = 28, Y1_GOAL = 30, Y2_GOAL = 32, Y3_GOAL = 34;

// set once a mode has started, so that nothing is drawn in the frame before it
const STARTED = 0x03002CC0;
// gUnknown_03001620: the fight's rules and scores, gUnknown_03002110: the save, with the language at 119
const FIGHT = 0x03001620, SAVE = 0x03002110, LANGUAGE = SAVE + 119;
// gUnknown_03001c40: the fighters' records, 252 bytes each, and gUnknown_03001380: which is this console's player
const RECORDS = 0x03001C40, RECORD_SIZE = 252, PLAYER = 0x03001380;
// gUnknown_03001b30: each player's rings of keys, 64 bytes each, with the keys at 20 and where the ring is at 60
const RINGS = 0x03001B30, RING_SIZE = 64, RING_KEYS = 20, RING_AT = 60;
// gUnknown_03003100 and gUnknown_03003118: how far each player's picture is pushed
const PUSH_X = 0x03003100, PUSH_Y = 0x03003118;
// gUnknown_030033e0 and gUnknown_030017cc: the queue of sprites, 16 bytes each, and how many it holds
const SPRITE_QUEUE = 0x030033E0, SPRITE_COUNT = 0x030017CC;

const SINE = 0x0804DF7C;
const PALETTE_14 = 0x050003C0, PALETTE_15 = 0x050003E0;
const KEY_A = 0x1, KEY_B = 0x2, KEY_START = 0x8, KEY_RIGHT = 0x10, KEY_LEFT = 0x20, KEY_UP = 0x40, KEY_DOWN = 0x80;
const SOUND_MOVE = 600, SOUND_YES = 601, SOUND_BACK = 602, SOUND_DONE = 603, SOUND_BANNER = 46;

const u8 = v => v & 0xFF;
const u16 = v => v & 0xFFFF;
const s16 = v => (v << 16) >> 16;

// 0x0804afa4 and 0x0804b03c, the compiler's signed division and remainder, which give 0 for a division by 0
// (0x0804b100, 0x0804b038)
const sdiv = (n, d) => d === 0 ? 0 : Math.trunc(n / d) | 0;
const smod = (n, d) => d === 0 ? 0 : (n % d) | 0;
// 0x0804b4e4 and 0x0804b55c, the same for numbers that aren't signed, here only numbers at most 16 bits long
const udiv = (n, d) => d === 0 ? 0 : Math.trunc(n / d);
const umod = (n, d) => d === 0 ? 0 : n % d;

const byte = (c, at) => read8(c, HUD + at);
const setByte = (c, at, value) => write8(c, HUD + at, value);
const half = (c, at) => read16(c, HUD + at);
const shalf = (c, at) => reads16(c, HUD + at);
const setHalf = (c, at, value) => write16(c, HUD + at, value);

const playSound = (c, sound) => c.sound?.play(sound);
// 0x0804a594 is the BIOS's CpuFastSet: a copy of `words` 32-bit words
const fastCopy = (c, from, to, words) => copy32(c, from, to, words);
// the player's record, by the 252 bytes each takes
const record = c => RECORDS + read32(c, PLAYER) * RECORD_SIZE;
// gUnknown_03001378: the V-blanks counted, which the core keeps, as the halfword the original reads
const vblanks = c => c.vblanks & 0xFFFF;

/** The keys the ring has as the player's newest. */
function ringKeys(c) {
  const base = read32(c, PLAYER) * RING_SIZE;
  const at = read8(c, RINGS + base + RING_AT);
  return read16(c, RINGS + RING_KEYS + base + at * 2);
}

/** A halfword a share of the way to its goal, each frame: `shift` halves how far it goes. */
function ease(c, at, goal, shift) {
  const now = shalf(c, at), to = shalf(c, goal);
  if (now !== to) setHalf(c, at, half(c, at) - ((now - to) >> shift));
}

/**
 * 0x08018004: a sprite added to the queue, each argument as the original's: its place, its tile, its palette and how
 * it's drawn. The BIOS's CpuFastSet moves 32 bytes at a time, so the original also leaves stack garbage in the next
 * entry, which the next sprite writes over and nothing reads.
 */
export function queueHudSprite(c, x, y, third, tile, palette, sixth, shape, eighth, ninth) {
  const count = read8(c, SPRITE_COUNT);
  const at = SPRITE_QUEUE + count * 16;
  write16(c, at, x);
  write16(c, at + 2, y);
  write16(c, at + 4, 0);
  write16(c, at + 6, 200);
  write16(c, at + 8, tile);
  write8(c, at + 10, third);
  write8(c, at + 11, sixth);
  write8(c, at + 12, palette);
  write8(c, at + 13, shape);
  write8(c, at + 14, eighth);
  write8(c, at + 15, ninth);
  write8(c, SPRITE_COUNT, count + 1);
}

// nearly all of the HUD's sprites have the same third, sixth, eighth and ninth
const put = (c, x, y, tile, palette, shape) => queueHudSprite(c, x, y, 0, tile, palette, 0, shape, 0, 0);
// the same with the third that the scores use
const putScore = (c, x, y, tile, palette, shape) => queueHudSprite(c, x, y, 1, tile, palette, 0, shape, 0, 0);

/** 0x08012b98 with 0x08013100: starts mode `mode`, setting where things begin and copying its pictures. */
export function startHud(c, mode) {
  mode = u8(mode);
  setByte(c, MODE, mode);
  write8(c, STARTED, 0);
  switch (mode) {
    case 10:
    case 11: {
      const rec = record(c);
      write8(c, rec + 142, read8(c, rec + 141));
      write8(c, rec + 141, 0);
      setHalf(c, X1, 0xFF10);
      setHalf(c, X2, 0xFF10);
      setHalf(c, X1_GOAL, 0);
      setHalf(c, X2_GOAL, 0);
      setByte(c, CHOICE, 0);
      setByte(c, BOUNCE, 0);
      setByte(c, STEP, 0);
      setHalf(c, TIMER, 0);
      setByte(c, PICKS, 0);
      setByte(c, PICKS + 1, 0);
      setByte(c, PICKS + 2, 0);
      queueCopy(c, PALETTE_14, 0x083DFF34, 32);
      queueCopy(c, PALETTE_15, 0x083DFF54, 32);
      fastCopy(c, read8(c, LANGUAGE) === 0 ? 0x083DFF74 : 0x083E1174, 0x06016300, 320);
      fastCopy(c, 0x083E3274, 0x06016800, 32);
      fastCopy(c, 0x083E3274 + 128, 0x06016880, 32);
      fastCopy(c, 0x083E3274 + 128, 0x06016900, 32);
      fastCopy(c, 0x083E3974, 0x06016980, 672);
      fastCopy(c, 0x083E2374, 0x06017400, 640);
      fastCopy(c, (read8(c, FIGHT + 4) << 9) + 0x083E3374, 0x06016100, 128);
      fastCopy(c, 0x0831EB14, 0x06017E00, 128);
      clearPushes(c);
      break;
    }
    case 20: {
      setHalf(c, TIMER, 0);
      setHalf(c, X1, 0);
      setHalf(c, X2, 0);
      setHalf(c, X3, 0);
      setByte(c, STEP, 4);
      setHalf(c, X1_GOAL, 0);
      setHalf(c, Y1_GOAL, 0);
      setHalf(c, X2_GOAL, 0);
      setHalf(c, Y2_GOAL, 0);
      queueCopy(c, PALETTE_14, 0x0831ED14, 32);
      const from = 0x0831FD34;
      fastCopy(c, from, 0x06016800, 128);
      fastCopy(c, from + 0x200, 0x06016A00, 128);
      fastCopy(c, from + 0x400, 0x06016C00, 128);
      fastCopy(c, from + 0x600, 0x06016E00, 128);
      fastCopy(c, from + 0x800, 0x06017000, 128);
      fastCopy(c, from + 0xA00, 0x06017200, 128);
      fastCopy(c, from + 0xC00, 0x06017800, 32);
      fastCopy(c, from + 0xC80, 0x06017900, 32);
      fastCopy(c, from + 0x1000, 0x06017A00, 128);
      fastCopy(c, from + 0xD00, 0x06017C00, 128);
      fastCopy(c, 0x0831EB14, 0x06017E00, 128);
      break;
    }
    case 30: {
      setHalf(c, Y1, 0xFFC0);
      setHalf(c, Y2, 64);
      setHalf(c, Y1_GOAL, 0);
      setHalf(c, Y2_GOAL, 0);
      queueCopy(c, PALETTE_14, 0x08321D54, 32);
      queueCopy(c, PALETTE_15, 0x08321D74, 32);
      fastCopy(c, 0x08321DD4, 0x06016800, 192);
      fastCopy(c, (read8(c, record(c) + 196) << 10) + 0x08322054, 0x06016A80, 256);
      fastCopy(c, 0x08322054 + 0x2800, 0x06016E80, 256);
      fastCopy(c, 0x08324C54, 0x06017280, 336);
      for (let i = 0; i < 4; i++) {
        const fighter = read8(c, FIGHT + 20 + i), to = 0x06017800 + (i << 7);
        let from;
        if (fighter <= 8 && read8(c, FIGHT + 24 + i) === 0) from = (fighter << 7) + 0x083251D4;
        else if (u8(fighter - 17) <= 1) from = 0x08325554;
        else if (fighter === 19) from = 0x083256D4;
        else from = 0x08325654;
        fastCopy(c, from, to, 32);
      }
      fastCopy(c, 0x08326FB4, 0x06017B60, 64);
      fastCopy(c, 0x08326954, 0x06017A00, 32);
      fastCopy(c, 0x08326954, 0x06017A80, 32);
      fastCopy(c, 0x08326E54, 0x06017B00, 8);
      fastCopy(c, 0x08326E54, 0x06017B20, 8);
      fastCopy(c, 0x08326E54 + 320, 0x06017B40, 8);
      break;
    }
    case 40: {
      setHalf(c, TIMER, 0);
      setHalf(c, X1, 128);
      setHalf(c, X2, 32);
      setHalf(c, X3, 56);
      setHalf(c, Y1, 0xFFE0);
      setHalf(c, Y2, 160);
      setHalf(c, Y3, 102);
      setHalf(c, X1_GOAL, 32);
      setHalf(c, X2_GOAL, 128);
      setHalf(c, Y1_GOAL, 64);
      setHalf(c, Y2_GOAL, 64);
      queueCopy(c, PALETTE_14, 0x08320F34, 32);
      const from = 0x08320F54;
      fastCopy(c, from, 0x06016800, 384);
      fastCopy(c, from + 0x600, 0x06016E00, 384);
      fastCopy(c, from + 0xC00, 0x06017C00, 128);
      fastCopy(c, 0x0831EB14, 0x06017E00, 128);
      break;
    }
    case 50:
      setHalf(c, TIMER, 0);
      queueCopy(c, PALETTE_14, 0x08422718, 32);
      // DMA 3, with the control word 0x80000C40: 0xC40 16-bit words
      copy16(c, 0x08422738, 0x06016800, 0xC40);
      break;
    case 60: {
      playSound(c, SOUND_YES);
      setHalf(c, X1, 16);
      setHalf(c, X1_GOAL, 0);
      setHalf(c, Y3, 0);
      setHalf(c, Y3_GOAL, 20);
      setByte(c, CHOICE, 0);
      setByte(c, BOUNCE, 0);
      setByte(c, STEP, 0);
      setHalf(c, TIMER, 0);
      queueCopy(c, PALETTE_14, 0x0831ED14, 32);
      queueCopy(c, PALETTE_15, 0x083F15F4, 32);
      // the question's words, by language
      const words = [0x083F170C, 0x083F1DA4, 0x083F24D0, 0x083F2CC8, 0x083F3500, 0x083F3CC4];
      decompress(c, words[read8(c, LANGUAGE)] ?? 0x083F1DA4, 0x06016800);
      decompress(c, 0x083F1614, 0x06017400);
      fastCopy(c, 0x0831EB14, 0x06017E00, 128);
      break;
    }
  }
}

/**
 * 0x08013214 with 0x080135f4, 0x08014e7e, 0x08015000 and 0x08015370, one function the code map cuts in pieces: mode
 * `mode`'s sprites for this frame. A frame before its start draws nothing and only marks that it's started, which
 * 0x08015370 does, except for modes 12 and 20.
 */
export function drawHud(c, mode) {
  mode = u8(mode);
  if (read8(c, STARTED) === 0 && mode !== 12 && mode !== 20) {
    write8(c, STARTED, 1);
    return;
  }
  switch (mode) {
    case 10:
    case 11:
    case 12: drawChoice(c, mode); break;
    case 20: drawBanner(c); break;
    case 30: drawBars(c); break;
    case 40: drawSlides(c); break;
    case 50: drawBlink(c); break;
    case 60: drawQuestion(c); break;
  }
}

// the two rows of eight sprites along the top and the bottom, at `top` and `bottom`
function drawEdges(c, top, bottom) {
  for (let i = 0; i < 8; i++) {
    put(c, i << 5, top, 0x3F0, 14, 113);
    put(c, i << 5, bottom, 0x3F0, 14, 113);
  }
}

// a row of eight sprites across the screen
function drawRow(c, y, tile, shape) {
  for (let i = 0; i < 8; i++) put(c, i << 5, y, tile, 14, shape);
}

// 0x0801334c: the choice of special attacks
function drawChoice(c, mode) {
  if (read8(c, FIGHT + 125) !== 4 && umod(vblanks(c), 60) > 15) {
    put(c, 168, 146, 0x308, 14, 111);
    put(c, 200, 146, 0x310, 14, 111);
  }
  // the cursor, around the attack it's on, a little wider just after moving
  if (byte(c, STEP) <= 2) {
    const bounce = byte(c, BOUNCE);
    const x = byte(c, CHOICE) * 40 + half(c, X1);
    put(c, x - (bounce - 15), 76 - bounce, 0x3E8, 15, 114);
    put(c, x + bounce + 41, 76 - bounce, 0x3E9, 15, 114);
    put(c, x - (bounce - 15), bounce + 102, 0x3EA, 15, 114);
    put(c, x + bounce + 41, bounce + 102, 0x3EB, 15, 114);
  }
  // the number on each attack already taken
  for (let i = 0; i < 3; i++) {
    const taken = byte(c, TAKEN + i);
    if (taken === 0) continue;
    const x = half(c, X1) + i * 40;
    put(c, x, 95, (taken << 3) + 0x3C8, 15, 116);
    put(c, x + 32, 95, (taken << 3) + 0x3CC, 15, 116);
  }
  // the words at the top
  const words = half(c, X2);
  put(c, words, 58, 0x318, 14, 111);
  put(c, words + 32, 58, 0x320, 14, 111);
  put(c, words + 64, 58, 0x328, 14, 111);
  put(c, words + 96, 58, 0x330, 14, 111);
  put(c, words + 128, 58, 0x338, 14, 111);
  // the three attacks
  const x = half(c, X1);
  put(c, x + 16, 77, 0x3A0, 15, 113);
  put(c, x + 56, 77, 0x3B0, 15, 113);
  put(c, x + 96, 77, 0x3C0, 15, 113);
  // the frames still left, in two digits copied to the tiles
  if (mode !== 10 && read16(c, FIGHT + 128) !== 0 && read8(c, FIGHT + 10) !== 0) {
    const seconds = sdiv(read16(c, FIGHT + 128) - read16(c, FIGHT + 130), 30);
    fastCopy(c, (u8(sdiv(seconds, 10)) << 7) + 0x083E2D74, 0x06016880, 32);
    fastCopy(c, (u8(smod(seconds, 10)) << 7) + 0x083E2D74, 0x06016900, 32);
  }
  put(c, x + 194, 68, 0x340, 14, 116);
  put(c, x + 196, 82, 0x344, 14, 110);
  put(c, x + 208, 82, 0x348, 14, 110);
  // the panel's top and bottom edges, the same tiles but for four at their right
  const edge = [0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x34C, 0x35C, 0x36C, 0x37C, 0x34C, 0x34C, 0x38C];
  edge.forEach((tile, i) => put(c, x + i * 16, 52, tile, 14, 112));
  const lower = [0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x354, 0x364, 0x374, 0x384, 0x354, 0x354, 0x394];
  lower.forEach((tile, i) => put(c, x + i * 16, 84, tile, 14, 112));
  // the picture of the attack under the cursor, unless this is mode 12
  if (byte(c, MODE) !== 12) {
    const player = read32(c, PLAYER);
    const face = read8(c, record(c) + 196), to = u16(player * 36);
    const step = byte(c, STEP), choice = byte(c, CHOICE);
    const show = which => fn08015924(c, face, which, 8, to, u8(player));
    if (step === 0) {
      if (choice === 0) show(19);
      else if (choice === 1) { if (u8(show(21)) === 255) show(0); }
      else if (choice === 2) show(23);
    } else if (step === 1) {
      if (choice === 0) show(20);
      else if (choice === 1) { if (u8(show(22)) === 255) show(0); }
      else if (choice === 2) show(24);
    } else {
      show(53);
    }
    drawPicture(c, s16(half(c, X1) + 146), 61, u8(player * 36), u8(player), u8(player));
  }
  // the picture's frame
  const right = half(c, X1);
  for (const y of [61, 77, 93]) {
    put(c, right + 144, y, 0x39C, 14, 110);
    put(c, right + 160, y, 0x39C, 14, 110);
    put(c, right + 176, y, 0x39C, 14, 110);
  }
  drawEdges(c, -12, 140);
}

// 0x08013e14: a banner that slides in and shakes apart
function drawBanner(c) {
  const t = half(c, TIMER);
  if (t <= 27) {
    // nothing moves yet
  } else if (t <= 39) {
    setHalf(c, X1, half(c, X1) + 32);
    setHalf(c, X2, half(c, X2) + 4);
  } else if (t <= 87) {
    setHalf(c, X1, half(c, X1) + 1);
    setHalf(c, X2, half(c, X2) + 4);
  } else if (t <= 91) {
    setHalf(c, X3, half(c, X3) + 18);
  } else if (t <= 99) {
    // each half shakes by an amount worked out from the V-blank count
    const v = vblanks(c), step = byte(c, STEP);
    const shake = (a, b) => smod(Math.imul(a, b), step << 3) - (step << 2);
    setHalf(c, X1_GOAL, shake(v + 5, v + 1));
    setHalf(c, Y1_GOAL, shake(v + 1, v + 2));
    setHalf(c, X2_GOAL, shake(v + 8, v));
    setHalf(c, Y2_GOAL, shake(v + 7, v + 4));
    if (step !== 0) setByte(c, STEP, step - 1);
  } else {
    setHalf(c, X3_GOAL, 0);
    setHalf(c, Y3_GOAL, 0);
    setHalf(c, X3, half(c, X3) - 64);
  }
  if (shalf(c, X1) > 240) setHalf(c, X1, 0);
  if (shalf(c, X2) > 240) setHalf(c, X2, 0);
  if (shalf(c, X3) > 240) setHalf(c, X3, 0);

  if (u16(t - 29) <= 58) {
    const a = half(c, X1);
    put(c, 240 - a, 63, 0x340, 14, 113);
    put(c, 272 - a, 63, 0x350, 14, 113);
    put(c, 304 - a, 63, 0x360, 14, 113);
    put(c, a - 96, 66, 0x370, 14, 113);
    put(c, a - 64, 66, 0x380, 14, 113);
    put(c, a - 32, 66, 0x390, 14, 113);
    for (let i = 0; i < 9; i++) put(c, i << 5, 64, 0x3D0, 14, 113);
    for (let i = 0; i < 8; i++) {
      put(c, i << 5, 61, 0x3C0, 14, 116);
      put(c, i << 5, 96, 0x3C0, 14, 116);
    }
    // the stripes that run past, only those on the screen
    for (let i = 0; i < 8; i++) {
      const left = shalf(c, X2) + (i << 5) - 256;
      if (((left + 31) >>> 0) <= 302) put(c, left, 61, 0x3C8, 14, 116);
      const away = (i << 5) + 240 - shalf(c, X2);
      if (((away + 31) >>> 0) <= 302) put(c, away, 96, 0x3C8, 14, 116);
    }
  } else if (u16(t - 89) <= 14) {
    const slide = half(c, X3);
    put(c, half(c, X1_GOAL) - 12 + slide, half(c, Y1_GOAL) + 44, 0x340, 14, 115);
    put(c, half(c, X2_GOAL) + 188 - slide, half(c, Y2_GOAL) + 52, 0x380, 14, 115);
  }
  if (t === 28 || t === 89 || t === 101 || t === 29 || t === 90 || t === 102) drawRow(c, 64, 0x3E0, 113);
  if (t === 27 || t === 88 || t === 100 || t === 30 || t === 91 || t === 103) drawRow(c, 76, 0x3E0, 116);
  const out = t - 100 > 0 ? (t - 100) << 1 : 0;
  drawEdges(c, -12 - out, 140 + out);
}

// 0x08014228: the fight itself: the bars and the timer at the top, the scores at the bottom
function drawBars(c) {
  ease(c, Y1, Y1_GOAL, 2);
  ease(c, Y2, Y2_GOAL, 2);
  const top = half(c, Y1), rec = record(c);
  put(c, 0, top - 8, 0x354, 14, 117);
  put(c, 64, top - 8, 0x374, 14, 117);
  // the life bar, which ends where the record says
  const life = read16(c, rec + 194);
  put(c, 0xFF95 + life, top + 13, 0x344, 14, 116);
  put(c, 0xFFB5 + life, top + 13, 0x344, 14, 116);
  put(c, 0xFFD5 + life, top + 13, 0x344, 14, 116);
  put(c, 0xFFF5 + life, top + 13, 0x340, 14, 116);
  // the other bar
  const power = read8(c, rec + 148);
  put(c, 0xFFD0 + power, top + 5, 0x348, 14, 116);
  put(c, 0xFFF0 + power, top + 5, 0x348, 14, 116);
  put(c, power + 16, top + 5, 0x348, 14, 116);
  for (const x of [-6, 26, 58, 90]) put(c, x, top + 5, 0x34C, 14, 111);

  if (read8(c, FIGHT + 4) === 1) {
    // the time left, whose digits are copied to the tiles: minutes in two, seconds in two
    const left = read16(c, FIGHT + 126) - read16(c, FIGHT + 114);
    const minuteTens = u8(smod(sdiv(left, 0x4650), 10));
    const minuteOnes = u8(smod(sdiv(left, 0x708), 10));
    const seconds = smod(sdiv(left, 30), 60);
    fastCopy(c, (minuteTens << 7) + 0x08326954, 0x06017A00, 32);
    fastCopy(c, (minuteOnes << 7) + 0x08326954, 0x06017A80, 32);
    fastCopy(c, (u8(sdiv(seconds, 10)) << 5) + 0x08326E54, 0x06017B00, 8);
    fastCopy(c, (u8(smod(seconds, 10)) << 5) + 0x08326E54, 0x06017B20, 8);
    put(c, 208, top + 5, 0x3D0, 14, 110);
    put(c, 217, top + 5, 0x3D4, 14, 110);
    put(c, 228, top + 13, 0x3D8, 14, 114);
    put(c, 233, top + 13, 0x3D9, 14, 114);
    if (smod(left, 30) > 15) put(c, 225, top + 13, 0x3DA, 14, 114);
    put(c, 192, top + 8, 0x3DB, 14, 110);
    put(c, 208, top + 8, 0x3DF, 14, 110);
    put(c, 224, top + 8, 0x3DF, 14, 110);
  }

  // each player's score, with their mark, if they're in the fight
  const bottom = half(c, Y2);
  for (let i = 0; i < 4; i++) {
    if (read8(c, FIGHT + 20 + i) === 255) continue;
    let tens, ones;
    if (read8(c, FIGHT + 4) === 2) {
      const score = read8(c, FIGHT + 6) - read8(c, FIGHT + 51 + i);
      ones = u8(smod(score, 10));
      tens = u8(sdiv(score, 10));
    } else {
      if (read8(c, FIGHT + 39 + i) > 99) write8(c, FIGHT + 39 + i, 99);
      const score = read8(c, FIGHT + 39 + i);
      ones = u8(umod(score, 10));
      tens = u8(udiv(score, 10));
    }
    const x = 4 + i * 60;
    putScore(c, x, bottom + 140, 0x3C0 + (i << 2), i, 110);
    const marked = read8(c, FIGHT + 8) !== 0 && read8(c, FIGHT + 32 + i) === 0;
    const palette = marked ? 15 : 14;
    putScore(c, x + 16, bottom + 140, (tens << 2) + 0x394, palette, 110);
    putScore(c, x + 28, bottom + 140, (ones << 2) + 0x394, palette, 110);
    // the first player's mark takes another palette and its sixth, as the original has it
    if (marked && i === 0) queueHudSprite(c, x + 38, bottom + 148, 1, 0x3BC, 14, 1, 118, 0, 0);
    else putScore(c, x + 38, bottom + 148, 0x3BC, palette, 118);
  }
}

// 0x08014d18: the two halves of a line sliding together, and apart at its end
function drawSlides(c) {
  const t = half(c, TIMER);
  if (t <= 45) {
    if (t <= 39) {
      for (const [at, goal] of [[X1, X1_GOAL], [X2, X2_GOAL], [Y1, Y1_GOAL], [Y2, Y2_GOAL]]) {
        if (shalf(c, at) < shalf(c, goal)) setHalf(c, at, half(c, at) + 24);
        else if (shalf(c, at) > shalf(c, goal)) setHalf(c, at, half(c, at) - 24);
      }
    } else {
      setHalf(c, X1, half(c, X1) - 32);
      setHalf(c, X2, half(c, X2) + 32);
    }
    const x1 = half(c, X1), x2 = half(c, X2), y1 = half(c, Y1), y2 = half(c, Y2);
    put(c, x1, y1, 0x340, 14, 113);
    put(c, x1 + 32, y1, 0x350, 14, 113);
    put(c, x1 + 64, y1, 0x360, 14, 113);
    put(c, x2, y2, 0x370, 14, 113);
    put(c, x2 + 32, y2, 0x380, 14, 113);
    put(c, x2 + 64, y2, 0x390, 14, 113);
  }
  if (u16(t - 5) <= 1 || t === 41 || t === 42) drawRow(c, 64, 0x3E0, 113);
  if (t === 4 || t === 7 || t === 40 || t === 43) drawRow(c, 76, 0x3E0, 116);
  const out = t <= 9 ? (10 - t) << 1 : 0;
  drawEdges(c, -12 - out, 140 + out);
}

// 0x08014f74: a line that blinks with the timer
function drawBlink(c) {
  if ((half(c, TIMER) & 24) <= 8) return;
  put(c, 66, 128, 0x340, 14, 117);
  put(c, 120, 128, 0x360, 14, 117);
}

// 0x08014fc0: the question, whose chosen answer swings along the sine table
function drawQuestion(c) {
  const swing = s16(read16(c, SINE + half(c, TIMER) * 2)) >> 11;
  const yes = byte(c, CHOICE) === 0 ? swing : 0, no = byte(c, CHOICE) === 0 ? 0 : swing;
  ease(c, X1, X1_GOAL, 1);
  const x = half(c, X1);
  put(c, yes + 70 + x, 78, 0x340, 15, 111);
  put(c, yes + 102 + x, 78, 0x348, 15, 111);
  put(c, yes + 134 + x, 78, 0x350, 15, 111);
  put(c, no + 70 + x, 100, 0x358, 15, 111);
  put(c, no + 102 + x, 100, 0x360, 15, 111);
  put(c, no + 134 + x, 100, 0x368, 15, 111);
  put(c, 72 - x, 32, 0x370, 15, 117);
  put(c, 136 - x, 32, 0x390, 15, 113);
  for (const y of [64, 80, 96]) {
    put(c, 72 - x, y, 0x3A0, 15, 111);
    put(c, 104 - x, y, 0x3A8, 15, 111);
    queueHudSprite(c, 136 - x, y, 0, 0x3A0, 15, 0, 111, 0, 3);
  }
  put(c, 72 - x, 112, 0x3B0, 15, 111);
  put(c, 104 - x, 112, 0x3B8, 15, 111);
  put(c, 136 - x, 112, 0x3C0, 15, 111);
  ease(c, Y3, Y3_GOAL, 1);
  const edge = half(c, Y3);
  drawEdges(c, edge - 32, 160 - edge);
}

/**
 * 0x08015384: counts the timer until the screen's done: 0 while it's counting, 1 after Start, which can skip it from
 * a second on, and 2 at its end.
 */
export function countUntilDone(c) {
  const before = half(c, TIMER);
  setHalf(c, TIMER, before + 1);
  if (u16(before - 60) <= 0xE9A && (c.keys.pressed & KEY_START)) setHalf(c, TIMER, 0xED8);
  const now = half(c, TIMER);
  if (now > 0xF00) return 2;
  return now <= 0xED8 ? 0 : 1;
}

/** 0x080153e0: the question's frame: the choice, once A picks it or Start picks the first; 255 until then. */
export function chooseAnswer(c) {
  const t = half(c, TIMER);
  setHalf(c, TIMER, t <= 0x1FFF ? t + 0x200 : t - 0x2000);
  const keys = ringKeys(c);
  if (keys & (KEY_UP | KEY_DOWN)) {
    setByte(c, CHOICE, byte(c, CHOICE) ^ 1);
    playSound(c, SOUND_MOVE);
  }
  if (keys & KEY_A) {
    playSound(c, SOUND_YES);
    return byte(c, CHOICE);
  }
  if (!(keys & KEY_START)) return 255;
  playSound(c, SOUND_YES);
  return 0;
}

/**
 * 0x08015498: the frame of the choice of three special attacks. Which attack each pick took (`TAKEN`), the pictures of
 * the words for this pick, A and B to pick and go back, Right and Left to move, past those already taken. Returns 1
 * once all three are chosen and in the player's record, or else 0.
 */
export function chooseSpecials(c) {
  const picks = [byte(c, PICKS), byte(c, PICKS + 1), byte(c, PICKS + 2)];
  for (let n = 1; n <= 3; n++) {
    const pick = picks.indexOf(n);
    setByte(c, TAKEN + n - 1, pick < 0 ? 0 : pick + 1);
  }

  if (half(c, TIMER) > 5) {
    const words = read8(c, LANGUAGE) === 0 ? [0x083DFF74, 0x083E0574, 0x083E0B74] : [0x083E1174, 0x083E1774, 0x083E1D74];
    const step = byte(c, STEP);
    if (step <= 2) fastCopy(c, words[step], 0x06016300, 320);
  }

  const timer = half(c, TIMER);
  if (timer >= 2) {
    setHalf(c, TIMER, timer - 1);
  } else if (timer === 1) {
    setHalf(c, TIMER, 0);
    if (byte(c, STEP) === 3) setByte(c, STEP, 4);
  } else if (byte(c, STEP) <= 2) {
    const keys = ringKeys(c), step = byte(c, STEP);
    const nextPick = () => {
      setHalf(c, X2, 0xFF10);
      setHalf(c, TIMER, 6);
      clearPushes(c);
    };
    if (keys & KEY_B) {
      if (step !== 0) {
        playSound(c, SOUND_BACK);
        setByte(c, STEP, step - 1);
        setByte(c, PICKS + step - 1, 0);
        nextPick();
      }
    } else if (keys & KEY_A) {
      setByte(c, PICKS + step, byte(c, CHOICE) + 1);
      setByte(c, STEP, step + 1);
      if (u8(step + 1) <= 2) {
        playSound(c, SOUND_YES);
        nextPick();
      } else {
        playSound(c, SOUND_DONE);
        setHalf(c, TIMER, 6);
        const away = byte(c, MODE) === 10 ? 0xFF06 : 0xFF3C;
        setHalf(c, X1_GOAL, away);
        setHalf(c, X2_GOAL, away);
        clearPushes(c);
      }
    }
    // the same keys, read again: A also moves on to the next attack that's free
    if ((keys & KEY_RIGHT) || ((keys & KEY_A) && !(keys & KEY_B))) {
      moveChoice(c, 1, 3, 0);
      if (keys & KEY_RIGHT) playSound(c, SOUND_MOVE);
      clearPushes(c);
    } else if (keys & KEY_LEFT) {
      moveChoice(c, -1, 255, 2);
      playSound(c, SOUND_MOVE);
      clearPushes(c);
    }
  }

  const bounce = byte(c, BOUNCE);
  if (bounce !== 0) setByte(c, BOUNCE, bounce - 1);
  ease(c, X1, X1_GOAL, 1);
  ease(c, X2, X2_GOAL, 1);
  ease(c, X3, X3_GOAL, 1);
  if (byte(c, STEP) <= 3) return 0;
  const chosen = (byte(c, PICKS) & 3) | ((byte(c, PICKS + 1) & 3) << 2) | ((byte(c, PICKS + 2) & 3) << 4);
  write8(c, record(c) + 141, chosen);
  return 1;
}

// the cursor one attack along, wrapping from `end` to `start`, and on past any already taken
function moveChoice(c, by, end, start) {
  const along = () => {
    const choice = u8(byte(c, CHOICE) + by);
    setByte(c, CHOICE, choice);
    if (choice === end) setByte(c, CHOICE, start);
  };
  along();
  setByte(c, BOUNCE, 5);
  while (byte(c, TAKEN + byte(c, CHOICE)) !== 0) along();
}

/** 0x08015858: counts the banner's frames, with its sound at 27 and its second pictures at 88; 1 from 104 on. */
export function countBanner(c) {
  const t = u16(half(c, TIMER) + 1);
  setHalf(c, TIMER, t);
  if (t === 27) {
    playSound(c, SOUND_BANNER);
  } else if (t === 88) {
    fastCopy(c, 0x0831ED34, 0x06016800, 512);
    fastCopy(c, 0x0831ED34 + 0x800, 0x06017000, 512);
  }
  return t > 103 ? 1 : 0;
}

/** 0x0801584c: the mode showing. */
export const hudMode = c => byte(c, MODE);

/** 0x080158c0: counts the timer; 1 from 120 on. */
export function countSlides(c) {
  const t = u16(half(c, TIMER) + 1);
  setHalf(c, TIMER, t);
  return t > 119 ? 1 : 0;
}

/** 0x080158e4: the four players' pushes and what moves them, all back to nothing. */
export function clearPushes(c) {
  for (const at of [0x03003108, 0x03003110, 0x030030F8]) {
    for (let i = 0; i < 4; i++) write16(c, at + i * 2, 0);
  }
  for (let i = 0; i < 4; i++) write8(c, 0x03003120 + i, 0);
}

/** 0x08015e30: a player's picture of four sprites at `x`, `y`, where its pushes put it. */
export function drawPicture(c, x, y, tile, palette, index) {
  tile = u8(tile);
  palette = u8(palette);
  index = u8(index);
  x = s16(x);
  y = s16(y);
  const pushX = PUSH_X + index * 2, pushY = PUSH_Y + index * 2;
  put(c, x - read16(c, pushX), y + read16(c, pushY), tile, palette, 113);
  put(c, x - read16(c, pushX), y + read16(c, pushY) + 32, tile + 16, palette, 111);
  put(c, x - (read16(c, pushX) - 32), y + read16(c, pushY), tile + 24, palette, 112);
  put(c, x - (read16(c, pushX) - 32), y + read16(c, pushY) + 32, tile + 32, palette, 110);
}

/** 0x08015f40: how far a player's picture is pushed across, the other way round. */
export const pushAcross = (c, index) => s16(-read16(c, PUSH_X + u8(index) * 2));

/** 0x08015f58: how far a player's picture is pushed down. */
export const pushDown = (c, index) => reads16(c, PUSH_Y + u8(index) * 2);

export {
  startHud as fn08012b98, drawHud as fn08013214, countUntilDone as fn08015384, chooseAnswer as fn080153e0,
  chooseSpecials as fn08015498, countBanner as fn08015858, hudMode as fn0801584c, countSlides as fn080158c0,
  clearPushes as fn080158e4, drawPicture as fn08015e30, pushAcross as fn08015f40, pushDown as fn08015f58,
  queueHudSprite as fn08018004,
};
