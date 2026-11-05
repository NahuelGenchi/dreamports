// Sonic and Tails running towards the camera over a sky and a meadow, which the intro's first and last scenes share
// (CreateGameIntroState, 0x080A1D14): each line of the layer behind them is scaled for its distance from the horizon, by
// what the H-blank writes to layer 2's registers for it.

import { REG } from '../../../kit/gba/video.js';
import { createSprite, updateSprite, displaySprite, transformSprite } from './sprite.js';
import { SINE } from './stage/trig.js';

const OBJ_VRAM = 0x10000;
export const LINES = 160, HALVES_A_LINE = 8;
// each character has this many animations, running towards the camera being the 161st, with Tails the third character
const ANIMS_A_CHARACTER = 163, PERSPECTIVE_RUN = 161, TAILS = 2;
// the line the sky and the meadow meet on, and how fast the meadow comes towards the camera, in 1/16ths of a line
export const HORIZON = 0x8C;
const MEADOW_X = -240, MEADOW_SPEED = -48;
// the line the next frame's work catches the drawing on
export const TORN_AT = 6;
// how far each line's scale goes, by its distance from the horizon
const SCALES = Uint32Array.from({ length: 256 }, (_, i) => Math.trunc(0x100000 / (i * 0x10 + 0x400)));

/** 0x080A1F58: Sonic and Tails, each with the turn that scales and moves them. */
export function createRunners(s) {
  s.sonic = createSprite({ tiles: OBJ_VRAM, frameFlags: 0x1020, anim: PERSPECTIVE_RUN, variant: 3, palId: 0, x: 130, y: 140, oamFlags: 17 << 6 });
  s.sonicTurn = { rotation: 0, scaleX: -0xE0, scaleY: 0xE0, x: 130, y: 140 };
  s.tails = createSprite({ tiles: OBJ_VRAM + 64 * 32, frameFlags: 0x1021, anim: TAILS * ANIMS_A_CHARACTER + PERSPECTIVE_RUN, variant: 4, palId: 1, x: 100, y: 140, oamFlags: 16 << 6 });
  s.tailsTurn = { rotation: 0, scaleX: -0x100, scaleY: 0x100, x: 100, y: 140 };
}

/** 0x080A29F8: the two running, on the sprites' scale */
export function showRunners(c, s) {
  updateSprite(c, s.sonic);
  transformSprite(c, s.sonic, s.sonicTurn, SINE);
  displaySprite(c, s.sonic);
  updateSprite(c, s.tails);
  transformSprite(c, s.tails, s.tailsTurn, SINE);
  displaySprite(c, s.tails);
}

// 0x080A201C: what the H-blank writes to layer 2's registers for each line, so that the lines further from the horizon
// are drawn larger, with the meadow moving
function writeLines(lines, meadowScroll) {
  for (let y = 0; y < LINES; y++) {
    const from = Math.abs(y - HORIZON), scale = SCALES[from], at = y * HALVES_A_LINE;
    let v = (Math.imul(scale, from * 2) + meadowScroll * 0x10) & 0xFFFF;
    if (y < HORIZON) {
      if (v & 0x8000) v = (v - 0x8000) & 0xFFFF;
    } else if (!(v & 0x8000)) v = (v + 0x8000) & 0xFFFF;
    lines[at] = scale >>> 2;
    lines[at + 3] = 0x100;
    lines[at + 4] = Math.imul(scale, MEADOW_X) >>> 2;
    lines[at + 6] = v;
  }
}

/**
 * The original has one list, which the task rewrites just after the V-blank, while the screen is being drawn: the lines
 * above the one its work catches the drawing on (`tornAt`) show this frame's list, and the rest already show the next
 * frame's. So each frame here gets both, with the next one as this one if the next frame writes none.
 */
export function setLines(c, s, nextWrites, tornAt, tornFields = 3) {
  s.meadowScroll = (s.meadowScroll + MEADOW_SPEED) & 0x7FF;
  [s.lines, s.nextLines] = [s.nextLines, s.lines];
  writeLines(s.lines, s.meadowScroll);
  writeLines(s.nextLines, nextWrites ? (s.meadowScroll + MEADOW_SPEED) & 0x7FF : s.meadowScroll);
  c.lineScroll = s.lines;
  c.lineScrollNext = s.nextLines;
  c.lineTornAt = tornAt;
  c.lineTornFields = tornFields;
  c.lineSize = HALVES_A_LINE;
  c.lineRegister = REG.BG2PA;
}

/** The H-blank's copies stop (the intro task's destructor, 0x080A2974). */
export function stopLines(c) {
  c.lineScroll = null;
  c.lineScrollNext = null;
  c.lineSize = 1;
}
