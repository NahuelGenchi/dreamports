// The name entry, which the language screen opens at the first start (0x0809198C). The screen fades in, a panel opens
// from its middle, and the title comes in from the left with a little bounce. A cursor moves over a grid of letters on a
// layer that scrolls: A writes one of up to six letters, B takes one away, L and R move along them, L and R together
// with the d-pad jump through the grid, and Start or the grid's edge goes to the menu beside it, whose first button
// keeps the name. Then the panel closes and the screen fades out, on to the logos, which aren't ported yet, so for now it
// goes straight to Route 99's overworld. The other ways in, from the options and the link games, aren't ported yet either.

import { KEY } from './core.js';
import { REG } from '../../../kit/gba/video.js';
import { createSprite, updateSprite, displaySprite, transformSprite } from './sprite.js';
import { drawBackground } from './background.js';
import { SINE } from './stage/trig.js';
import { startStage } from './stage/stage.js';

const OBJ_VRAM = 0x10000;
const SE_SELECT = 0x6A, SE_ABORT = 0x6B, SE_DPAD_SELECT = 0x6C;
const LETTERS = 6;
// where the title's and each sprite's anim, variant and tiles are: { anim u16, variant u8, tiles u32 }
const TITLES = 0xD7044, BANNER = 0xD703C, ROWS = 0xD70A4, SHOULDERS = 0xD70AC, HIGHLIGHT = 0xD70B4, CURSOR = 0xD70BC, BLANK = 0xD70C4, LETTER = 0xD70CC, MORE_LETTERS = 0xD70D4, ARROW = 0xD70DC;
// the grid: its holes as [column, row], the first letter of each row, the cursor's glow, the panel's corners, the title's speeds
const HOLES = 0xD70E4, HOLE_COUNT = 14, ROW_STARTS = 0xD712C, GLOW = 0xD711C, CORNERS = 0xD7142, TITLE_SPEEDS = 0xD6B48;
// the cursor's places on the screen, and the grid's scroll at its ends
const LEFT_X = 0x1A, RIGHT_X = 0xBA, TOP_Y = 0x34, BOTTOM_Y = 0x84, SCROLL_END = 0x100, ROW = 0x10;
// the panel's height and top when open and shut, and how fast they change, in 1/256ths of a pixel
const OPEN_H = 0x6C00, OPEN_TOP = 0x2A00, SHUT_TOP = 0x6000, GROW = 0x1000, RISE = 0x800;
const TITLE_REACH = 0xA00;
// the frames the screen stays black after the fade out, as the original's does until its logos start to show
const BLACK_BEFORE_THE_LOGOS = 16;
// the first button of the menu, the one that keeps the name, and its L and R below it
const MENU_KEEP = 0, MENU_L = 1, MENU_R = 2;
// the letter that's a space, which a name of nothing but can't be kept
const SPACE_VARIANT = 0x4D, SPACE_ANIM = 0x404;

const tile = (rom, at) => ({ anim: rom.u16(at), variant: rom.u8(at + 2), count: rom.u32(at + 4) });

/** 0x0809198C: the screen's task, its sprites and its layers. `from` is where it was opened from, 0 at the first start. */
export function nameEntry(c, from = 0) {
  c.dispCnt = 0x1340;
  const s = initialState(c, from);
  const t = c.createTask(fadeIn, s, 0x101);
  // layer 2's first two tiles, cleared at once
  c.video.vram.fill(0, (c.bgCnt[2] & 0xC) << 12, ((c.bgCnt[2] & 0xC) << 12) + 0x40);
  drawLayers(c, s);
  createSprites(c, s);
  return t;
}

// 0x08091A48
function initialState(c, from) {
  return {
    c, from, language: c.save.language,
    letter: 0, shoulder: 0, titleStep: 0, count: 0, caret: 0, atEdge: 0, side: 0,
    blink: 0, menu: 0, panelH: 0, panelTop: SHUT_TOP, scrollY: 0x90,
    glow: 0x100, cursorX: LEFT_X, cursorY: TOP_Y, gridX: 0,
    bg0X: 0, bg0Y: 0, fade: 0, fading: 0, panelX: -0xE00,
    bannerX: 0x96, bannerY: 0x18, blankX: 0xA0, blankY: 0x19, titleQ: -0x8C00, titleY: 0x10,
    sideX: 0xD9, sideY: 0x8C, arrowX: 5, arrowY: 0x2A,
    tiles: OBJ_VRAM,
  };
}

// 0x08091AFC: the sprites' tiles one after the other
function createSprites(c, s) {
  const { rom } = c;
  const make = (at, oamFlags, x, y, fields) => {
    const { anim, variant, count } = tile(rom, at);
    const sprite = createSprite({ tiles: s.tiles, anim, variant, oamFlags, x, y, ...fields });
    s.tiles += count * 32;
    return sprite;
  };
  const shown = (...args) => {
    const sprite = make(...args);
    updateSprite(c, sprite);
    return sprite;
  };
  s.title = shown(TITLES + (s.from === 1 ? 8 : 0) + s.language * 16, 0xC0, s.titleQ >> 8, s.titleY);
  s.rows = shown(ROWS, 0xC0, s.sideX, s.sideY);
  s.shoulders = shown(SHOULDERS, 0xC0, s.sideX, s.sideY);
  s.highlight = shown(HIGHLIGHT, 0x80, s.sideX, s.sideY);
  s.banner = shown(BANNER, 0xC0, s.bannerX, s.bannerY);
  s.cursor = shown(CURSOR, 0x80, s.cursorX, s.cursorY);
  s.glowing = shown(CURSOR, 0x80, s.cursorX, s.cursorY, { frameFlags: 0xE1 });
  s.blank = shown(BLANK, 0x80, s.blankX, s.blankY);
  s.shownLetter = shown(LETTER, 0x40, 0, 0);
  s.letters = [];
  for (let i = 0; i < LETTERS; i++) {
    const saved = c.save.playerName[i], sprite = make(LETTER, 0x40, s.blankX, s.blankY);
    if (saved !== 0xFFFF) {
      sprite.variant = saved & 0xFF;
      if (saved > 0xFF) sprite.anim = tile(rom, MORE_LETTERS).anim;
      s.count++;
    } else sprite.variant = 0;
    updateSprite(c, sprite);
    s.letters.push(sprite);
  }
  s.caret = s.count;
  s.arrow = shown(ARROW, 0x40, s.arrowX, s.arrowY);
  s.letterBase = tile(rom, LETTER);
  s.moreBase = tile(rom, MORE_LETTERS);
}

// 0x08091F98: each layer's picture
function drawLayers(c, s) {
  c.bgCnt[0] = 0x0602;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  drawBackground(c, { id: 351, dest: 0, layoutVram: 0x3000, targetTilesX: 32, targetTilesY: 32, flags: 0 });
  c.bgCnt[1] = 0x9007;
  c.bgScroll[2] = 22;
  c.bgScroll[3] = 36;
  drawBackground(c, { id: 352, dest: 0x4000, layoutVram: 0x8000, targetTilesX: 32, targetTilesY: 64, flags: 1 });
  c.winRegs[2] = 0x2A2A + (s.panelH >> 8);
}

// the windows the fades start with: the panel's, and the one over the rest, which shows all but the grid
function fadeWindows(c) {
  c.bldCnt = 0x3FFF;
  c.dispCnt |= 0x6000;
  c.winRegs[1] = 0xFF;
  c.winRegs[3] = 0xFF;
  c.winRegs[4] = 0x3D32;
  c.winRegs[5] = 0;
}

// 0x08092084: the fade in
function fadeIn(t) {
  const s = t.data, { c } = s;
  if (!s.fading) {
    fadeWindows(c);
    c.bldY = 0x10;
    s.fade = 0x1000;
    s.fading = 1;
  }
  panelLines(c, s);
  scrollLayers(c, s);
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showBlanks(c, s);
  showRows(c, s);
  showLetters(c, s);
  c.winRegs[2] = 0x2A2A + s.panelH;
  if (c.bldY !== 0) {
    c.bldY = (s.fade & 0xFFFF) >> 8;
    s.fade -= 0x100;
    return;
  }
  t.main = opening;
}

// 0x08092154: the fade out, and on to what comes next
function fadeOut(t) {
  const s = t.data, { c } = s;
  if (s.fading) {
    fadeWindows(c);
    s.fade = 0;
    s.fading = 0;
  }
  scrollLayers(c, s);
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showRows(c, s);
  showLetters(c, s);
  if (c.bldY < 0x10) {
    panelLines(c, s);
    c.bldY = (s.fade & 0xFFFF) >> 8;
    s.fade += 0x100;
    return;
  }
  c.bldY = 0x10;
  if (c.save.playerId === 0) c.save.playerId = c.random();
  s.black = BLACK_BEFORE_THE_LOGOS;
  t.main = beforeTheLogos;
}

// The black the logos start from. They and all that comes before the overworld aren't ported yet, nor is writing the save
// (0x08001E58), so after it the game goes straight to Route 99's overworld.
function beforeTheLogos(t) {
  const s = t.data, { c } = s;
  if (--s.black > 0) return;
  c.destroyTask(t);
  c.lineScroll = null;
  c.lineRegister = REG.BG0HOFS + 12;
  c.dispCnt = 0x80;
  c.bgCnt.fill(0);
  c.bldCnt = 0;
  c.bldY = 0;
  startStage(c, 2);
}

// 0x0809227C: the panel opening and the title coming in
function opening(t) {
  const s = t.data, { c } = s;
  panelLines(c, s);
  scrollLayers(c, s);
  let done = titleBounce(c, s) ? 1 : 0;
  if (panelMoves(s, true)) done++;
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showBlanks(c, s);
  showRows(c, s);
  showLetters(c, s);
  panelWindow(c, s);
  if (done === 2) t.main = choosing;
}

const panelWindow = (c, s) => { c.winRegs[2] = s.panelTop + (s.panelTop >> 8) + (s.panelH >> 8); };

/** The frame's numbers that look random, which only roll on: one, then as many more as its last four bits say. */
function rollNumbers(c) {
  for (let n = c.random() & 0xF; n > 0; n--) c.random();
}

// 0x08092740: the grid, with the cursor over a letter
function choosing(t) {
  const s = t.data, { c } = s;
  rollNumbers(c);
  if (c.pressed & KEY.B) {
    c.playSong(SE_ABORT);
    takeLetter(c, s);
  }
  panelLines(c, s);
  scrollLayers(c, s);
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showBlanks(c, s);
  showRows(c, s);
  showLetters(c, s);
  showArrows(c, s);
  if (c.repeated & 0xF0) {
    const jumping = (c.input & (KEY.L | KEY.R)) === (KEY.L | KEY.R);
    if (jumping) jumpCursor(c, s);
    else {
      c.playSong(SE_DPAD_SELECT);
      if (moveCursor(c, s, t)) return;
    }
  }
  s.letter = (((s.cursorX - LEFT_X) >> 4) + c.rom.u8(ROW_STARTS + rowOf(s))) & 0xFF;
  if (c.pressed & KEY.L) {
    s.shoulder = 1;
    moveCaret(s);
  }
  if (c.pressed & KEY.R) {
    s.shoulder = 2;
    moveCaret(s);
  }
  showCursor(c, s);
  showGlow(c, s);
  glowOn(c, s);
  if (c.pressed & KEY.A && s.caret <= LETTERS) {
    c.playSong(SE_SELECT);
    if (s.letter === 0xA) softenLetter(s);
    else if (s.letter === 0x15) softenMore(s);
    else if (s.caret <= LETTERS - 1) writeLetter(s);
  }
  const shoulders = c.input & (KEY.L | KEY.R);
  if (shoulders !== (KEY.L | KEY.R) && shoulders !== 0) showHighlight(c, s);
  if (c.pressed & KEY.START) {
    c.playSong(SE_SELECT);
    s.shoulder = 0;
    s.menu = MENU_KEEP;
    t.main = inMenu;
  }
}

const rowOf = s => ((s.scrollY << 16 >> 20) + ((s.cursorY - TOP_Y) >> 4)) & 0xFF;
const columnOf = s => ((s.cursorX - LEFT_X) >> 4) & 0xFF;
/** Whether the cursor's place is one of the grid's holes. */
function onHole(c, s) {
  const column = columnOf(s), row = rowOf(s);
  for (let i = 0; i < HOLE_COUNT; i++) if (c.rom.u16(HOLES + i * 4) === column && c.rom.u16(HOLES + i * 4 + 2) === row) return true;
  return false;
}

// 0x08092308: the menu beside the grid
function inMenu(t) {
  const s = t.data, { c } = s;
  rollNumbers(c);
  panelLines(c, s);
  scrollLayers(c, s);
  if (c.pressed & KEY.B) {
    c.playSong(SE_ABORT);
    takeLetter(c, s);
  }
  if (c.pressed & KEY.L) {
    s.shoulder = MENU_L;
    s.menu = MENU_L;
    moveCaret(s);
  }
  if (c.pressed & KEY.R) {
    s.shoulder = MENU_R;
    s.menu = MENU_R;
    moveCaret(s);
  }
  showHighlight(c, s);
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showBlanks(c, s);
  showRows(c, s);
  showLetters(c, s);
  if (c.pressed & KEY.A) {
    c.playSong(SE_SELECT);
    if (s.menu === MENU_KEEP) {
      let spaces = 0;
      for (let i = 0; i < s.count; i++) if (s.letters[i].variant === SPACE_VARIANT && s.letters[i].anim === SPACE_ANIM) spaces++;
      if (s.count !== 0 && spaces < s.count) {
        t.main = keeping;
        return;
      }
    } else if (s.menu === MENU_L) {
      if (s.caret !== 0) s.caret--;
    } else if (s.menu === MENU_R) {
      if (s.caret !== s.count) s.caret++;
    }
  }
  if (!(c.repeated & 0xF0)) return;
  c.playSong(SE_DPAD_SELECT);
  if (c.repeated & KEY.UP) s.menu = s.menu === MENU_R ? MENU_KEEP : s.menu + 1;
  if (c.repeated & KEY.DOWN) s.menu = s.menu === MENU_KEEP ? MENU_R : s.menu - 1;
  if (c.repeated & KEY.LEFT) {
    s.cursorX = RIGHT_X;
    if (s.side === 0) rowUp(s);
    while (onHole(c, s)) s.cursorX -= ROW;
  } else if (c.repeated & KEY.RIGHT) {
    s.cursorX = LEFT_X;
    if (s.side === 1) rowDown(s);
    while (onHole(c, s)) s.cursorX += ROW;
  } else {
    s.shoulder = s.menu;
    return;
  }
  s.atEdge = 0;
  t.main = choosing;
}

// 0x08092684: the name into the save
function keeping(t) {
  const s = t.data, { c } = s;
  panelLines(c, s);
  scrollLayers(c, s);
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showRows(c, s);
  showLetters(c, s);
  for (let i = 0; i < s.count; i++) {
    const sprite = s.letters[i];
    c.save.playerName[i] = sprite.variant + (sprite.anim !== s.letterBase.anim ? 0x100 : 0);
  }
  for (let i = s.count; i < LETTERS; i++) c.save.playerName[i] = 0xFFFF;
  t.main = closing;
}

// 0x08093388: the panel closing
function closing(t) {
  const s = t.data, { c } = s;
  panelLines(c, s);
  scrollLayers(c, s);
  const done = panelMoves(s, false);
  showTitle(c, s);
  showBanner(c, s);
  showShoulders(c, s);
  showRows(c, s);
  showLetters(c, s);
  panelWindow(c, s);
  if (done) t.main = fadeOut;
}

// 0x08092940: the letter under the cursor, written at the caret
function writeLetter(s) {
  const sprite = s.letters[s.caret];
  s.caret = Math.min(s.caret + 1, LETTERS);
  if (s.caret > s.count) s.count = Math.min(s.count + 1, LETTERS);
  sprite.anim = s.letterBase.anim;
  sprite.variant = (s.letterBase.variant + s.letter) & 0xFF;
}

// 0x08092994: the letter at the caret taken away, those after it moving up, the last from the sprite after them
function takeLetter(c, s) {
  s.blink = 0;
  if (s.caret !== s.count) {
    for (let i = s.caret; i < s.count; i++) {
      const next = i + 1 < LETTERS ? s.letters[i + 1] : s.arrow;
      s.letters[i].anim = next.anim;
      s.letters[i].variant = next.variant;
      updateSprite(c, s.letters[i]);
    }
  }
  if (s.caret === s.count) {
    s.caret = (s.caret - 1) & 0xFF;
    if (s.caret > LETTERS) s.caret = 0;
  }
  s.count = (s.count - 1) & 0xFF;
  if (s.count > LETTERS) s.count = 0;
}

const within = (value, first, last) => ((value - first) & 0xFFFF) <= last - first;

// 0x08092A0C: the mark that softens a kana on the letter before the caret. The sums go below zero on purpose, as the low
// byte is what's kept: カ, at 0xB, less 0x19 is 0xF2, where the letters' last variants hold ガ and those after it.
function softenLetter(s) {
  if (s.caret === 0) return;
  const sprite = s.letters[s.caret - 1], at = (sprite.variant - s.letterBase.variant) & 0xFFFF;
  const plain = sprite.anim === s.letterBase.anim, more = sprite.anim === s.moreBase.anim;
  if (within(at, 0xA, 0xF) && plain) sprite.variant = (s.letter = (at - 0x19) & 0xFF);
  else if (within(at, 0x16, 0x1A)) sprite.variant = (s.letter = (at - 0x1F) & 0xFF);
  else if (within(at, 0x21, 0x24)) sprite.variant = (s.letter = (at - 0x25) & 0xFF);
  else {
    if (at === 0x25) s.letter = 0;
    else if (within(at, 0x37, 0x3B)) s.letter = (at - 0x36) & 0xFF;
    else if (within(at, 6, 0xA) && more) s.letter = (at - 5) & 0xFF;
    else if (at === 2) s.letter = 0xB;
    else return;
    sprite.anim = s.moreBase.anim;
    sprite.variant = (s.moreBase.variant + s.letter) & 0xFF;
  }
}

// 0x08092B34: the other mark, on the letter before the caret
function softenMore(s) {
  if (s.caret === 0) return;
  const sprite = s.letters[s.caret - 1], at = (sprite.variant - s.letterBase.variant) & 0xFFFF;
  if (within(at, 0x37, 0x3B)) s.letter = (at - 0x31) & 0xFF;
  else if (within(at, 1, 5) && sprite.anim === s.moreBase.anim) s.letter = (at + 5) & 0xFF;
  else return;
  sprite.anim = s.moreBase.anim;
  sprite.variant = (s.moreBase.variant + s.letter) & 0xFF;
}

// 0x08092BD8: the d-pad on the grid. True if the cursor left the grid for the menu.
function moveCursor(c, s, t) {
  if (c.repeated & KEY.UP) stepRow(c, s, rowUp);
  else if (c.repeated & KEY.DOWN) stepRow(c, s, rowDown);
  else if (c.repeated & KEY.LEFT) return stepAcross(c, s, t, LEFT_X, -ROW, 0);
  else if (c.repeated & KEY.RIGHT) return stepAcross(c, s, t, RIGHT_X, ROW, 1);
  return false;
}

// the cursor along its row until it's on a letter, or off its edge to the menu, on that side
function stepAcross(c, s, t, edge, by, side) {
  for (;;) {
    if (s.cursorX === edge) {
      if (s.atEdge === 0) {
        s.atEdge = 1;
        s.side = side;
        t.main = inMenu;
        return true;
      }
    } else {
      s.atEdge = 0;
      s.cursorX += by;
    }
    if (!onHole(c, s)) return false;
  }
}

// 0x08092F58: the cursor up or down until it's on a letter, going round at the grid's ends
function stepRow(c, s, step) {
  do step(s);
  while (onHole(c, s));
}
function rowUp(s) {
  if (s.cursorY !== TOP_Y) s.cursorY -= ROW;
  else if (s.scrollY !== 0) s.scrollY -= ROW;
  else {
    s.cursorY = BOTTOM_Y;
    s.scrollY = SCROLL_END;
  }
}
function rowDown(s) {
  if (s.cursorY !== BOTTOM_Y) s.cursorY += ROW;
  else if (s.scrollY !== SCROLL_END) s.scrollY += ROW;
  else {
    s.cursorY = TOP_Y;
    s.scrollY = 0;
  }
}

// 0x08092D30: L and R held with the d-pad, the cursor jumping
function jumpCursor(c, s) {
  if (c.repeated & KEY.UP) {
    s.scrollY -= 0x60;
    if (s.scrollY <= 0) {
      s.cursorY = TOP_Y;
      s.scrollY = 0;
    }
    if (onHole(c, s)) stepRow(c, s, rowDown);
  } else if (c.repeated & KEY.DOWN) {
    s.scrollY += 0x60;
    if (s.scrollY >= SCROLL_END) {
      s.cursorY = BOTTOM_Y;
      s.scrollY = SCROLL_END;
    }
    if (onHole(c, s)) stepRow(c, s, rowUp);
  } else if (c.repeated & KEY.LEFT) {
    s.cursorX = LEFT_X;
    while (onHole(c, s)) s.cursorX += ROW;
  } else if (c.repeated & KEY.RIGHT) {
    s.cursorX = RIGHT_X;
    while (onHole(c, s)) s.cursorX -= ROW;
  }
}

// 0x08093454: L and R along the letters
function moveCaret(s) {
  if (s.shoulder === 1) {
    if (s.caret !== 0) s.caret--;
  } else if (s.shoulder === 2) {
    if (s.caret !== s.count) s.caret++;
  }
}

// 0x08093028: the panel's sides for each line, with its corners cut, which the H-blank writes to window 0's sides
function panelLines(c, s) {
  const { rom } = c, top = (s.panelTop >> 8) & 0xFF, bottom = (top + (s.panelH >> 8)) & 0xFF, cornerStart = (bottom + 0xE8) & 0xFF;
  const by = (s.panelX << 8) >>> 16, lines = new Uint16Array(160);
  for (let i = 0; i < 160; i++) {
    let left = by + 30, right = by + 0xD3;
    if (i >= top && i < top + 12) {
      left = by + rom.u16(CORNERS + (i - top) * 4);
      right = by + rom.u16(CORNERS + (i - top) * 4 + 2);
    } else if (i >= bottom - 12 && i < bottom) {
      left = by + rom.u16(CORNERS + (i - cornerStart) * 4);
      right = by + rom.u16(CORNERS + (i - cornerStart) * 4 + 2);
    }
    lines[i] = (right & 0xFFFF) + ((left & 0xFFFF) << 8);
  }
  c.lineScroll = lines;
  c.lineRegister = REG.WIN0H;
}

// 0x08093128: the back layer drifting, and the grid at its scroll
function scrollLayers(c, s) {
  s.bg0X = (s.bg0X - 0x100) & 0xFFFF;
  s.bg0Y = (s.bg0Y + 0x100) & 0xFFFF;
  c.bgScroll[0] = -(s.bg0X >> 8);
  c.bgScroll[1] = -(s.bg0Y >> 8);
  c.bgScroll[2] = s.gridX + 0x16;
  c.bgScroll[3] = s.scrollY + 0x24;
}

// 0x08093168: the panel opening or closing. True when it has finished.
function panelMoves(s, open) {
  let done = 0;
  if (open) {
    if (s.panelH < OPEN_H) s.panelH = Math.min(s.panelH + GROW, OPEN_H);
    else done = 1;
    if (s.panelTop > OPEN_TOP) s.panelTop = Math.max(s.panelTop - RISE, OPEN_TOP);
    else done++;
  } else {
    if (s.panelH !== 0) {
      s.panelH = (s.panelH - GROW) & 0xFFFF;
      if (s.panelH >= OPEN_H) s.panelH = 0;
    } else done = 1;
    if (s.panelTop < SHUT_TOP) s.panelTop = Math.min(s.panelTop + RISE, SHUT_TOP);
    else done++;
  }
  return done === 2;
}

// 0x080933FC: the title's bounce. True when it has settled.
function titleBounce(c, s) {
  const step = s.titleStep;
  s.titleQ += c.rom.s32(TITLE_SPEEDS + step * 4);
  if (step === 0 && s.titleQ >= TITLE_REACH) s.titleStep++;
  else if (step === 1 && s.titleQ <= -TITLE_REACH) s.titleStep++;
  else if (step === 2 && s.titleQ > 0) {
    s.titleQ = 0;
    return true;
  }
  return false;
}

// 0x08091EEC: the cursor's glow growing, and how see-through it is
function glowOn(c, s) {
  const was = s.glow;
  s.glow = was + (was <= 0x190 ? 8 : 0x10);
  if (s.glow >= 0x200) s.glow = 0x100;
  else c.bldAlpha = c.rom.u16(GLOW + ((s.glow >> 5) - 8) * 2);
}

// 0x0809321C: the glow around the cursor
function showGlow(c, s) {
  const sprite = s.glowing;
  sprite.frameFlags = 0xE1;
  transformSprite(c, sprite, { rotation: 0, scaleX: s.glow, scaleY: s.glow, x: s.cursorX, y: s.cursorY }, SINE);
  displaySprite(c, sprite);
}

// 0x0809325C: the highlight on the menu's button or on L or R
function showHighlight(c, s) {
  const sprite = s.highlight;
  sprite.x = s.sideX - 1;
  sprite.y = s.sideY - s.shoulder * 15;
  displaySprite(c, sprite);
}

// 0x080932B8: the marks where letters can go, the one at the caret blinking
function showBlanks(c, s) {
  const sprite = s.blank;
  for (let i = 0; i < LETTERS; i++) {
    sprite.x = s.blankX + i * 12;
    sprite.y = s.blankY;
    if (i === s.caret ? s.blink < 40 : i > s.caret) displaySprite(c, sprite);
  }
  if (++s.blink >= 60) s.blink = 0;
}

// 0x08093318: the arrows saying there's more of the grid above or below
function showArrows(c, s) {
  const sprite = s.arrow;
  let updated = false;
  if (s.scrollY <= 0xF0) {
    sprite.x = s.arrowX;
    sprite.y = s.arrowY + 0x6C;
    sprite.frameFlags |= 0x800;
    updateSprite(c, sprite);
    displaySprite(c, sprite);
    updated = true;
  }
  if (s.scrollY > 0) {
    sprite.x = s.arrowX;
    sprite.y = s.arrowY;
    sprite.frameFlags &= ~0x800;
    if (!updated) updateSprite(c, sprite);
    displaySprite(c, sprite);
  }
}

// 0x08093484
function showTitle(c, s) {
  s.title.x = s.titleQ >> 8;
  s.title.y = s.titleY;
  displaySprite(c, s.title);
}

// 0x080934A4
function showBanner(c, s) {
  s.banner.x = s.bannerX;
  s.banner.y = s.bannerY;
  displaySprite(c, s.banner);
}

// 0x080934C4
function showShoulders(c, s) {
  s.shoulders.x = s.sideX;
  s.shoulders.y = s.sideY;
  displaySprite(c, s.shoulders);
}

// 0x080934E4: the cursor, and the letter under it
function showCursor(c, s) {
  s.cursor.x = s.cursorX;
  s.cursor.y = s.cursorY;
  displaySprite(c, s.cursor);
  const sprite = s.shownLetter;
  sprite.x = s.cursorX;
  sprite.y = s.cursorY;
  sprite.variant = (s.letterBase.variant + s.letter) & 0xFF;
  sprite.prevVariant = -1;
  updateSprite(c, sprite);
  displaySprite(c, sprite);
}

// 0x0809352C: the menu's other two buttons, one the other flipped
function showRows(c, s) {
  const sprite = s.rows;
  sprite.x = s.sideX;
  sprite.y = s.sideY - 15;
  sprite.frameFlags |= 0x400;
  displaySprite(c, sprite);
  sprite.x = s.sideX;
  sprite.y = s.sideY - 30;
  sprite.frameFlags &= ~0x400;
  displaySprite(c, sprite);
}

// 0x0809357C: the letters written so far
function showLetters(c, s) {
  for (let i = 0; i < s.count; i++) {
    const sprite = s.letters[i];
    sprite.x = s.blankX + i * 12;
    sprite.y = s.blankY - 1;
    sprite.prevVariant = -1;
    updateSprite(c, sprite);
    displaySprite(c, sprite);
  }
}
