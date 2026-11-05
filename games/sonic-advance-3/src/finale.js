// The intro's last scene (CreateGameIntroState with state 3): Sonic and Tails run towards the camera over the sky and the
// meadow of the logos' scene, but further on, as the emerald's glow comes up and the screen fades out into the title.

import { drawBackground, tilemapColours } from './background.js';
import { KEY } from './core.js';
import { LINES, HALVES_A_LINE, createRunners, showRunners, setLines, stopLines } from './runners.js';
import { leaveForTheTitle } from './title.js';

const SKY = 424, GLOW = 423;
// music players: the music, then the three of the sound effects
const PLAYERS = [0, 1, 2, 3], FADE_SPEED = 5;
// the sound fades out on this frame of the last stretch, which ends 10 frames later
const FADE_AT = 0x95, ENDS_AT = 0x9F;
// The line the drawing is at when a frame's work ends, and how many of that line's values the work had written, by the
// frames counted from the scene's first, when it isn't the usual. How long the work takes is the console's timing with
// the sound engine's on top, as mGBA measures it, so these come from comparing with the original, as logos.js's do.
const DEFAULT_TORN = 10;
const TORN_FRAMES = {
  23: [10, 1], 30: [9, 3], 31: [9, 3], 33: [9, 3], 34: [9, 3], 36: [9, 3], 37: [9, 3], 39: [9, 3], 40: [9, 3],
  47: [10, 1], 64: [9, 3], 65: [9, 3], 66: [9, 3], 67: [9, 3], 69: [9, 3], 70: [9, 3], 72: [9, 3], 73: [9, 3],
  74: [9, 3], 75: [9, 3], 76: [9, 3], 77: [9, 3], 78: [9, 3], 79: [9, 3], 80: [9, 3], 81: [9, 3], 82: [9, 3],
  83: [9, 3], 84: [9, 3], 85: [9, 3], 87: [9, 3], 88: [9, 3], 90: [9, 3], 91: [9, 3], 93: [9, 3], 94: [9, 3],
  96: [9, 3], 97: [9, 3], 99: [9, 3], 100: [9, 3], 102: [9, 3], 103: [9, 3], 105: [9, 3], 106: [9, 3], 108: [9, 3],
  109: [9, 3], 111: [9, 3], 112: [9, 3], 114: [9, 3], 115: [9, 3], 117: [9, 3], 118: [9, 3], 120: [9, 3],
  121: [9, 3], 123: [9, 3], 124: [9, 3], 126: [9, 3], 127: [9, 3], 129: [9, 3], 130: [9, 3], 132: [9, 3],
  133: [9, 3], 135: [9, 3], 136: [9, 3], 138: [9, 3], 139: [9, 3], 141: [9, 3], 142: [9, 3], 144: [9, 3],
  145: [9, 3], 147: [9, 3], 148: [9, 3],
};


/** 0x080A1D14, CreateGameIntroState(3). */
export function introFinale(c) {
  const s = {
    c, count: 0, runX: 0, glow: 0, glowColours: new Array(16).fill(0), meadowScroll: 0, shown: 0,
    lines: new Uint16Array(LINES * HALVES_A_LINE), nextLines: new Uint16Array(LINES * HALVES_A_LINE),
    sonic: null, tails: null, sonicTurn: null, tailsTurn: null,
  };
  c.bldCnt = 0xFF;
  c.bldAlpha = 0;
  c.bldY = 0x10;
  c.createTask(init, s, 0x1000);
}

// 0x080A217C and 0x080A22E0: the sky, the glow in front of it, and the two running
function init(t) {
  const s = t.data, { c } = s;
  c.dispCnt = 0x42;
  c.bgCnt[0] = 0x1F0C;
  c.bgCnt[1] = 0x1708;
  c.bgCnt[2] = 0x6B81;
  c.bgScroll.fill(0);
  c.bgScroll[2] = 16;
  c.bgScroll[3] = 116;
  drawBackground(c, { id: SKY, dest: 0, layoutVram: 0x5800, targetTilesX: 32, targetTilesY: 32, flags: 4 | 2 });
  drawBackground(c, { id: GLOW, dest: 0x8000, layoutVram: 0xB800, targetTilesX: 32, targetTilesY: 32, flags: 0x10 | 1 });
  createRunners(s);
  c.bgPalette.fill(0, 0x50, 0x60);
  c.flags |= 0x1;
  c.bldCnt = 0x1D42;
  c.bldAlpha = 0x1010;
  c.bldY = 0;
  t.main = starts;
}

// Start leaves for the title (0x080A2DD8)
function skipped(t) {
  const { c } = t.data;
  if (!(c.pressed & KEY.START)) return false;
  stopLines(c);
  c.destroyTask(t);
  leaveForTheTitle(c);
  return true;
}

// 0x080A2978: the two further along their way for how far on the scene is, Sonic coming to the front and Tails going off
function place(s, along) {
  if (along >= 256) return;
  const sonic = s.sonic, sonicTurn = s.sonicTurn, tails = s.tails, tailsTurn = s.tailsTurn;
  sonic.y = sonicTurn.y = 0x8C - (((along + 32) >> 4) - 4);
  tails.y = tailsTurn.y = 0x8C - ((along >> 4) - 4);
  const half = along >> 1;
  sonic.x = sonicTurn.x = half + 0x82 + along;
  const shrunk = half + along;
  const sonicScale = 0xE0 - shrunk;
  if (sonicScale > 0) {
    sonicTurn.scaleX = -sonicScale;
    sonicTurn.scaleY = sonicScale;
  }
  tails.x = tailsTurn.x = along * 2 - ((along >> 2) - 100);
  const tailsScale = 0x100 - shrunk;
  if (tailsScale > 0) {
    tailsTurn.scaleX = -tailsScale;
    tailsTurn.scaleY = tailsScale;
  }
}

// 0x080A2A40: the sky's colours as the glow has them at step `step`, 0 to 7
function glowColours(s, step) {
  const { c } = s, at = tilemapColours(c, SKY) + Math.min(Math.max(step, 0), 7) * 64;
  for (let i = 0; i < 32; i++) c.bgPalette[i] = c.rom.u16(at + i * 2);
  c.flags |= 0x1;
}

// 0x080A2D80 and 0x080A23A4: the two running, and the lines the H-blank scales for them
function show(s) {
  showRunners(s.c, s);
  const [torn, fields] = TORN_FRAMES[s.shown] ?? [DEFAULT_TORN, 3];
  setLines(s.c, s, true, torn, fields);
  s.shown++;
}

// 0x080A2700: the first frame, with the sky as it is at first
function starts(t) {
  const s = t.data, { c } = s;
  c.dispCnt = 0x1641;
  if (skipped(t)) return;
  place(s, s.runX);
  glowColours(s, 0);
  show(s);
  s.count = 0;
  t.main = comingOn;
}

// 0x080A2774: the glow coming up, a step every 8 frames, with the two running on once it is half way
function comingOn(t) {
  const s = t.data, { c } = s;
  if (skipped(t)) return;
  place(s, s.runX >> 1);
  glowColours(s, s.count >> 3);
  show(s);
  if (++s.count <= 0x3F) {
    if (s.count > 0x20) s.runX = (s.runX + 1) & 0xFFFF;
    return;
  }
  s.runX = (s.runX + 1) & 0xFFFF;
  glowColours(s, 7);
  t.main = lastStretch;
}

// 0x080A27EC: the glow's colours going up one after another to white, and then the screen fading out with the sound
function lastStretch(t) {
  const s = t.data, { c } = s;
  s.glow = (s.glow + 1) & 0xFF;
  if (skipped(t)) return;
  place(s, s.runX >> 1);
  s.count++;
  s.runX = (s.runX + 1) & 0xFFFF;
  if (s.glow === 0) s.glowColours.fill(0);
  for (let i = 0; i < 16; i++) {
    if (s.glow > i * 4) s.glowColours[i] = Math.min(s.glow - i * 4, 31);
  }
  for (let i = 0; i < 16; i++) {
    const v = s.glowColours[i] & 31;
    c.bgPalette[0x50 + i] = v | (v << 5) | (v << 10);
  }
  c.flags |= 0x1;
  show(s);
  if (s.glow === FADE_AT) for (const player of PLAYERS) c.fadeOutPlayer(player, FADE_SPEED);
  if (s.glow > ENDS_AT) {
    c.bldCnt = 0xBF;
    c.bldAlpha = 0;
    c.bldY = 0x10;
    c.flags &= ~4;
    t.main = leaves;
  }
}

// 0x080A2D34: on to the title, with the H-blank's copies stopped as the task's destructor does
function leaves(t) {
  stopLines(t.data.c);
  t.data.c.destroyTask(t);
  leaveForTheTitle(t.data.c);
}
