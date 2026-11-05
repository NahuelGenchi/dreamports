// The SEGA and Sonic Team logos, which come after the name entry and, on later starts, after the start-up: the game's
// intro (CreateGameIntroState) from its first state. Sonic and Tails run over a sky and a meadow, with each line of the sky
// and the meadow scaled for its distance, as "Presented by SEGA" fades in and out. A hand reaches over an emerald in a
// strip of the screen, then the two run on with "Created by Sonic Team". What comes next is the intro's characters
// (intro.js). The states the intro's other parts open with aren't ported, nor are its demos, with the colour settings of
// 0x080C4884, which the game never turns on here.

import { drawBackground } from './background.js';
import { KEY } from './core.js';
import { TORN_AT, LINES, HALVES_A_LINE, createRunners, showRunners, setLines, stopLines } from './runners.js';
import { openingCharacters } from './intro.js';
import { leaveForTheTitle } from './title.js';

const SEGA = 1, SONIC_TEAM = 2;
const MUS_INTRO = 0;
// how often the runners' pictures change
const FRAMES_A_PICTURE = 3;
// The frames, counted from each logo's first, on which it doesn't. How long the work takes is the console's timing with
// the sound engine's on top, as mGBA measures it, so these come from comparing with the original, by state.
const NOT_LATER = {
  [SEGA]: [32, 35, 38, 74, 77, 80, 83, 116, 122, 125, 161, 164],
  [SONIC_TEAM]: [32, 35, 38, 74, 77, 80, 83, 116, 122, 125, 158, 206, 209, 245, 248, 251],
};
// the frames before a logo shows, its fade in and out, and the frames after it
const BEFORE_A_LOGO = 10, LOGO = 150, AFTER_SEGA = 10, AFTER_SONIC_TEAM = 0x78;

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

// each frame has the list for the lines and the one for the next frame's, as runners.js writes them
function meadowLines(c, s, nextWrites = true) {
  const late = s.shown % FRAMES_A_PICTURE === FRAMES_A_PICTURE - 1 && !NOT_LATER[s.state].includes(s.shown);
  setLines(c, s, nextWrites, late ? TORN_AT + 1 : TORN_AT);
  s.shown++;
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

// 0x080A2A50: Start, once the logos have been seen, leaves for what comes after them
function skipped(t) {
  const s = t.data, { c } = s;
  if (!s.skippable || !(c.pressed & KEY.START)) return false;
  c.destroyTask(t);
  leaveForTheTitle(c);
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
  stopLines(c);
  if (s.state === SEGA) {
    theHand(c);
    c.destroyTask(t);
  } else {
    openingCharacters(c);
    c.destroyTask(t);
  }
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
