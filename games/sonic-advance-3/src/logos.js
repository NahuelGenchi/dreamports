// The SEGA and Sonic Team logos, which come after the name entry and, on later starts, after the start-up: the game's
// intro (CreateGameIntroState) from its first state. Sonic and Tails run over a sky and a meadow, with each line of the sky
// and the meadow scaled for its distance, as "Presented by SEGA" fades in and out. A hand reaches over an emerald in a
// strip of the screen, then the two run on with "Created by Sonic Team". What comes next, the intro's characters, isn't
// ported yet, so for now the game goes straight to Route 99's overworld. The states the intro's other parts open with
// aren't ported either, nor are its demos, with the colour settings of 0x080C4884, which the game never turns on here.

import { REG } from '../../../kit/gba/video.js';
import { createSprite, updateSprite, displaySprite, transformSprite } from './sprite.js';
import { drawBackground } from './background.js';
import { KEY } from './core.js';
import { SINE } from './stage/trig.js';
import { startStage } from './stage/stage.js';

const SEGA = 1, SONIC_TEAM = 2;
const MUS_INTRO = 0;
const OBJ_VRAM = 0x10000, LINES = 160, HALVES_A_LINE = 8;
// each character has this many animations, running towards the camera being the 161st, with Tails the third character
const ANIMS_A_CHARACTER = 163, PERSPECTIVE_RUN = 161, TAILS = 2;
// the line the sky and the meadow meet on, and how fast the meadow comes towards the camera, in 1/16ths of a line
const HORIZON = 0x8C, MEADOW_X = -240, MEADOW_SPEED = -48;
// the line the next frame's work catches the drawing on, and how often the runners' pictures change
const TORN_AT = 6, FRAMES_A_PICTURE = 3;
// The frames, counted from each logo's first, on which it doesn't. How long the work takes is the console's timing with
// the sound engine's on top, as mGBA measures it, so these come from comparing with the original, by state.
const NOT_LATER = {
  [SEGA]: [32, 35, 38, 74, 77, 80, 83, 116, 122, 125, 161, 164],
  [SONIC_TEAM]: [32, 35, 38, 74, 77, 80, 83, 116, 122, 125, 158, 206, 209, 245, 248, 251],
};
// the frames before a logo shows, its fade in and out, and the frames after it
const BEFORE_A_LOGO = 10, LOGO = 150, AFTER_SEGA = 10, AFTER_SONIC_TEAM = 0x78;
// how far each line's scale goes, by its distance from the horizon
const SCALES = Uint32Array.from({ length: 256 }, (_, i) => Math.trunc(0x100000 / (i * 0x10 + 0x400)));

/** 0x080A1D14, CreateGameIntroState. */
export function gameIntro(c, state) {
  const s = {
    c, state, skippable: false, meadowScroll: 0, count: 0, shown: 0,
    lines: new Uint16Array(LINES * HALVES_A_LINE), nextLines: new Uint16Array(LINES * HALVES_A_LINE),
    sonic: null, tails: null, sonicTurn: null, tailsTurn: null,
  };
  c.bldCnt = 0xFF;
  c.bldAlpha = 0;
  c.bldY = 0x10;
  c.createTask(init, s, 0x1000);
}

// 0x080A1DF4: the sky and the meadow, and this state's logo
function drawLayers(c, s) {
  c.dispCnt = 0x42;
  c.bgCnt[0] = 0x1F0C;
  c.bgCnt[1] = 0x1708;
  c.bgCnt[2] = 0x6B81;
  c.bgScroll.fill(0);
  c.bgScroll[2] = 16;
  c.bgScroll[3] = 116;
  drawBackground(c, { id: 424, dest: 0, layoutVram: 0x5800, targetTilesX: 32, targetTilesY: 32, flags: 6 });
  drawBackground(c, { id: s.state === SEGA ? 425 : 426, dest: 0xC000, layoutVram: 0xF800, targetTilesX: 32, targetTilesY: 32, flags: 0 });
}

// 0x080A1F58: Sonic and Tails
function createRunners(s) {
  s.sonic = createSprite({ tiles: OBJ_VRAM, frameFlags: 0x1020, anim: PERSPECTIVE_RUN, variant: 3, palId: 0, x: 130, y: 140, oamFlags: 17 << 6 });
  s.sonicTurn = { rotation: 0, scaleX: -0xE0, scaleY: 0xE0, x: 130, y: 140 };
  s.tails = createSprite({ tiles: OBJ_VRAM + 64 * 32, frameFlags: 0x1021, anim: TAILS * ANIMS_A_CHARACTER + PERSPECTIVE_RUN, variant: 4, palId: 1, x: 100, y: 140, oamFlags: 16 << 6 });
  s.tailsTurn = { rotation: 0, scaleX: -0x100, scaleY: 0x100, x: 100, y: 140 };
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

// The original has one list, which the task rewrites just after the V-blank, while the screen is being drawn: the lines
// above the one its work catches the drawing on show this frame's list, and the rest already show the next frame's. So
// each frame here gets both, with the next one as this one if the next frame writes none.
function meadowLines(c, s, nextWrites = true) {
  s.meadowScroll = (s.meadowScroll + MEADOW_SPEED) & 0x7FF;
  [s.lines, s.nextLines] = [s.nextLines, s.lines];
  writeLines(s.lines, s.meadowScroll);
  writeLines(s.nextLines, nextWrites ? (s.meadowScroll + MEADOW_SPEED) & 0x7FF : s.meadowScroll);
  c.lineScroll = s.lines;
  c.lineScrollNext = s.nextLines;
  // the next frame's work takes a line longer when the runners' pictures change on it, but for those frames
  c.lineTornAt = s.shown % FRAMES_A_PICTURE === FRAMES_A_PICTURE - 1 && !NOT_LATER[s.state].includes(s.shown) ? TORN_AT + 1 : TORN_AT;
  s.shown++;
  c.lineSize = HALVES_A_LINE;
  c.lineRegister = REG.BG2PA;
}

// 0x080A21AC: the intro's first frame
function init(t) {
  const s = t.data, { c } = s;
  drawLayers(c, s);
  createRunners(s);
  c.bgPalette.fill(0, 0x50, 0x60);
  c.flags |= 0x1;
  c.bldCnt = 0x1D42;
  c.bldAlpha = 0x1010;
  c.bldY = 0;
  if (s.state === SEGA) {
    c.stopAllSongs();
    c.playSong(MUS_INTRO);
  }
  s.count = BEFORE_A_LOGO;
  t.main = beforeTheLogo;
}

// 0x080A29F8: the two running, on the sprites' scale
function showRunners(c, s) {
  updateSprite(c, s.sonic);
  transformSprite(c, s.sonic, s.sonicTurn, SINE);
  displaySprite(c, s.sonic);
  updateSprite(c, s.tails);
  transformSprite(c, s.tails, s.tailsTurn, SINE);
  displaySprite(c, s.tails);
}

// 0x080A2A50: Start, once the logos have been seen, leaves for what comes after them
function skipped(t) {
  const s = t.data, { c } = s;
  if (!s.skippable || !(c.pressed & KEY.START)) return false;
  afterTheLogos(t);
  return true;
}

// 0x080A2714
function beforeTheLogo(t) {
  const s = t.data, { c } = s;
  c.dispCnt = 0x1441;
  c.bldCnt = 0;
  c.bldAlpha = 0;
  c.bldY = 0;
  s.count--;
  if (skipped(t)) return;
  showRunners(c, s);
  meadowLines(c, s);
  if (s.count > 0) return;
  s.count = LOGO;
  c.dispCnt = 0x1541;
  c.bldCnt = 0x3F41;
  c.bldAlpha = 0x1000;
  c.bldY = 0;
  t.main = theLogo;
}

// 0x080A27CC: the logo, fading in and out by the frames left of it
function theLogo(t) {
  const s = t.data, { c } = s, left = --s.count;
  if (left > 0x8D) {
    const shown = (LOGO - left) * 2;
    c.bldAlpha = ((0x10 - shown) << 8) | shown;
  } else if (left <= 8) {
    const shown = left * 2;
    c.bldAlpha = ((0x10 - shown) << 8) | shown;
  } else c.bldAlpha = 0x10;
  if (skipped(t)) return;
  showRunners(c, s);
  meadowLines(c, s);
  if (s.count > 0) return;
  if (s.state === SEGA) s.count = AFTER_SEGA;
  else {
    s.count = AFTER_SONIC_TEAM;
    s.skippable = true;
  }
  c.dispCnt = 0x1441;
  t.main = afterTheLogo;
}

// 0x080A28D8
function afterTheLogo(t) {
  const s = t.data, { c } = s;
  s.count--;
  if (skipped(t)) return;
  if (s.count > 0) {
    showRunners(c, s);
    meadowLines(c, s, s.count > 1);
    return;
  }
  c.bldCnt = 0xFF;
  c.bldAlpha = 0;
  c.bldY = 0x10;
  // 0x080A2974, the task's destructor: the H-blank's copies stop
  c.lineScroll = null;
  c.lineScrollNext = null;
  c.lineSize = 1;
  if (s.state === SEGA) {
    theHand(c);
    c.destroyTask(t);
  } else t.main = afterTheLogos;
}

// 0x080A2AB0 and 0x080A2B84: the hand and the emerald, on two layers
function theHand(c) {
  c.dispCnt = 0x1040;
  c.mapFill[1].rect.set([0, 0, 0xFF, 0x40]);
  c.mapFill[2].rect.set([0, 0, 0xFF, 0x40]);
  c.video.vram.fill(0, ((c.bgCnt[0] >> 2) & 3) << 14, (((c.bgCnt[0] >> 2) & 3) << 14) + 0x40);
  c.dispCnt |= 0x200;
  c.bgCnt[1] = 0xC81;
  c.bgScroll[2] = 0;
  c.bgScroll[3] = 0;
  drawBackground(c, { id: 302, dest: 0, layoutVram: 0x6000, targetTilesX: 32, targetTilesY: 32, flags: 5 });
  c.dispCnt |= 0x400;
  c.bgCnt[2] = 0x5888;
  c.bgScroll[4] = 0;
  c.bgScroll[5] = 0;
  drawBackground(c, { id: 301, dest: 0x8000, layoutVram: 0xC000, targetTilesX: 32, targetTilesY: 32, flags: 6 });
  c.bgPalette[0] = 0;
  c.flags |= 0x1;
  c.createTask(theHandShows, { c, wait: 0, scroll: 0 }, 0x100);
}

// where the hand's strip of the screen starts and ends, as WIN0V holds them
const HAND_STRIP = 0x3070, HAND_END = 0x5000, HAND_SPEED = 0x200, HAND_WAIT = 4;

// 0x080A2C6C: the screen black but for the strip the hand shows in
function theHandShows(t) {
  const { c } = t.data;
  c.bldCnt = 0x3FFF;
  c.dispCnt |= 0x6000;
  c.winRegs[0] = 0xFF;
  c.winRegs[1] = 0xFF;
  c.winRegs[3] = 0xFF;
  c.winRegs[4] = 0x3117;
  c.winRegs[5] = 0;
  c.winRegs[2] = HAND_STRIP;
  c.bldAlpha = 0x1F;
  c.bldY = 0x10;
  t.main = theHandMoves;
}

// 0x080A2CEC: the layer behind it moves across, and when it has, on to Sonic Team's logo
function theHandMoves(t) {
  const s = t.data, { c } = s;
  let done = false;
  if (s.wait > HAND_WAIT || ++s.wait > HAND_WAIT) {
    if (s.scroll < HAND_END) {
      s.scroll += HAND_SPEED;
      if (s.scroll >= HAND_END) {
        s.scroll = HAND_END;
        done = true;
      }
    }
  }
  c.winRegs[2] = HAND_STRIP;
  c.bgScroll[4] = s.scroll >> 8;
  c.bgScroll[5] = 0;
  if (!done) return;
  gameIntro(c, SONIC_TEAM);
  c.destroyTask(t);
}

// What comes after the logos isn't ported yet, so the game goes straight to Route 99's overworld, a frame after the
// screen goes black when they've run their time, as the original's next part starts then.
function afterTheLogos(t) {
  const { c } = t.data;
  c.destroyTask(t);
  c.lineScroll = null;
  c.lineScrollNext = null;
  c.lineSize = 1;
  c.lineRegister = REG.BG0HOFS + 12;
  c.dispCnt = 0x80;
  c.bgCnt.fill(0);
  c.bgScroll.fill(0);
  c.winRegs.fill(0);
  c.bldCnt = 0;
  c.bldY = 0;
  startStage(c, 2);
}
