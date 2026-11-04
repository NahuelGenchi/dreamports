// The name entry, which the language screen leads to at the first start. A grid of eleven columns and seven rows in view of
// twenty-two, on a layer that scrolls, with the arrows and the end button in a twelfth column from its fifth row down, and the
// six letters of the name above it. The d-pad moves round the grid. A takes a letter, or one of the two marks, which change the
// kana before them. B deletes a letter, L and R move along the name, and Start goes to the end button, where it keeps the name
// and fades out as A does. A name needs at least one letter that isn't a space.
//
// The title screen comes next, which isn't ported yet, so for now Leaf Forest does.

import { startStage } from './stage/stage.js';
import { KEY } from './core.js';
import { updateSprite, displaySprite } from './sprite.js';
import { drawBackground } from './background.js';
import { createFade, updateFade } from './fade.js';
import { entry, place as placeSprite } from './menu.js';

const JAPANESE = 0;
const SE_SELECT = 106, SE_RETURN = 107, SE_MENU_CURSOR_MOVE = 108;
const TILEMAP_NAME = 135, TILEMAP_LETTERS = 136, TILEMAP_BEHIND = 137;
const PRIORITY = 0x1000;
// the tables the sprites come from, each entry of animation, variant and how many tiles it takes
const TITLES = 0xD9D50, ARROWS = 0xD9DB0, END_BUTTON = 0xD9DC0, SCROLL_ARROWS = 0xD9DF0;
const CELL = 0x3BA, CELL_LETTER = 7, CELL_CONTROL = 8, CELL_CURSOR = 6;
const LETTERS = 0x3BB, LETTERS_MORE = 0x3C3, LETTER_TILES = 4, BLANK = 0x11;
const NOT_LETTERS = 0x10C;
// the end of a name, and of the tables of letters: 0x080D95A4, those that count as nothing in a name; 0x080D95C4 and 0x080D95C8, the
// first of each five letters that the marks change, one list for each mark; 0x080D95D2 and 0x080D95D6, where those letters go
const END = 0xFFFF, BLANKS = 0xD95A4, FIRST_OF_FIVE_ROUND = 0xD95C4, FIRST_OF_FIVE_DOTS = 0xD95C8, TO_ROUND = 0xD95D2, TO_DOTS = 0xD95D6;
const NAME_LENGTH = 6;
const COLUMNS = 11, ROWS = 22, ROWS_SHOWN = 7, ROW_HEIGHT = 16, COLUMN_WIDTH = 16, LAST_PAGE = COLUMNS * (ROWS - ROWS_SHOWN);
const CONTROLS = COLUMNS, BACK = 4, FORWARD = 5, DONE = 6;
const DOTS_MARK = COLUMNS - 1, ROUND_MARK = COLUMNS * 2 - 1;
const SCROLL_FIRST_PAGE = 0xFFD9, SCROLL_LAST_PAGE = 201, SCROLL_LETTERS = 0x69, LETTER_WIDTH = 12;
const LATIN_PAGE = 99;
const DOTS = 1, ROUND = 2, DOTS_ON_TSU = 2, DOTTED_TSU = 0x10B;

/** 0x08063A00, CreateNewProfileNameScreen: the screen's task, its layers and its sprites. */
export function nameEntry(c, language) {
  const page = language === JAPANESE ? 0 : LATIN_PAGE;
  const screen = { c, language, col: 0, row: 0, page, cell: page, name: new Array(NAME_LENGTH).fill(END), cursor: 0 };
  initRegisters(c, language);
  // 0x08067484, ProfileNameScreenCreateUIBackgrounds, with 0x0806B854, OptionsInitBackground
  screen.fade = createFade();
  drawBackground(c, { id: TILEMAP_NAME, dest: 0, layoutVram: 0x3800, targetTilesX: 30, targetTilesY: 20, flags: 0 });
  drawBackground(c, { id: TILEMAP_BEHIND, dest: 0xC000, layoutVram: 0xF800, targetTilesX: 30, targetTilesY: 20, flags: 2 });
  drawBackground(c, { id: TILEMAP_LETTERS, dest: 0x4000, layoutVram: 0xB000, targetTilesX: 22, targetTilesY: 44, flags: 1 });
  createUi(c, screen);
  c.createTask(fadeIn, screen, 0x2000);
}

// 0x08067420, ProfileNameScreenInitRegisters
function initRegisters(c, language) {
  c.dispCnt = 0x1740;
  c.bgCnt[0] = 0x701;
  c.bgCnt[1] = 0x9606;
  c.bgCnt[2] = 0x1F0F;
  c.bgScroll.fill(0);
  c.bgScroll[2] = 0xFFE8;
  c.bgScroll[3] = language === JAPANESE ? SCROLL_FIRST_PAGE : SCROLL_LETTERS;
}

const place = (c, screen, tiles, anim, x, y, order, variant) => placeSprite(c, screen, tiles, anim, x, y, order, variant, PRIORITY);

// 0x0806B908, sub_806B908: the sprite of a letter
const letterSprite = letter => letter >= NOT_LETTERS ? { anim: LETTERS, variant: BLANK } : { anim: letter & 0x100 ? LETTERS_MORE : LETTERS, variant: letter & 0xFF };

// 0x0806751C, ProfileNameScreenCreateUIText, 0x08067610, ProfileNameScreenCreateUIContextElements and 0x08067710,
// ProfileNameScreenCreateInputDisplayUI
function createUi(c, screen) {
  const { rom } = c, title = entry(rom, TITLES, screen.language), back = entry(rom, ARROWS, 0), forward = entry(rom, ARROWS, 1), done = entry(rom, END_BUTTON, screen.language);
  screen.title = place(c, screen, title.tiles, title.anim, 3, 0x15, 13, title.variant);
  screen.controls = [
    place(c, screen, back.tiles, back.anim, 0xDB, 0x70, 13, back.variant),
    place(c, screen, forward.tiles, forward.anim, 0xDB, 0x80, 13, forward.variant),
    place(c, screen, done.tiles, done.anim, 0xDB, 0x8F, 13, done.variant),
  ];
  const first = letterSprite(screen.cell), up = entry(rom, SCROLL_ARROWS, 0), down = entry(rom, SCROLL_ARROWS, 1);
  screen.cellBack = place(c, screen, 10, CELL, 0x21, 0x2F, 8, CELL_LETTER);
  screen.cellLetter = place(c, screen, LETTER_TILES, first.anim, 0x21, 0x2F, 7, first.variant);
  screen.scrollArrows = [place(c, screen, up.tiles, up.anim, 8, 0x2C, 13, up.variant), place(c, screen, down.tiles, down.anim, 8, 0x82, 13, down.variant)];
  const blank = letterSprite(BLANK);
  screen.letters = screen.name.map((_, i) => place(c, screen, LETTER_TILES, blank.anim, 160 + i * LETTER_WIDTH, 22, 8, blank.variant));
  screen.nameCursor = place(c, screen, 2, CELL, screen.cursor * LETTER_WIDTH + 161, 21, 5, CELL_CURSOR);
}

const show = (c, s, anim, variant, x, y) => {
  s.anim = anim;
  s.variant = variant;
  s.x = x;
  s.y = y;
  updateSprite(c, s);
  displaySprite(c, s);
};

// 0x08067F84, ProfileNameScreenRenderUI
function render(c, screen) {
  displaySprite(c, screen.title);
  for (const s of screen.controls) displaySprite(c, s);
  if (screen.col < CONTROLS) {
    const x = screen.col * COLUMN_WIDTH + 32, y = screen.row * ROW_HEIGHT + 47;
    show(c, screen.cellBack, CELL, CELL_LETTER, x, y);
    screen.cell = screen.page + screen.row * COLUMNS + screen.col;
    const { anim, variant } = letterSprite(screen.cell);
    show(c, screen.cellLetter, anim, variant, x, y);
  } else show(c, screen.cellBack, CELL, CELL_CONTROL, 0xCB, screen.row * ROW_HEIGHT + 39);
  const [up, down] = screen.scrollArrows;
  updateSprite(c, up);
  updateSprite(c, down);
  if (screen.col < CONTROLS) {
    if (screen.cell > COLUMNS - 1) displaySprite(c, up);
    if (screen.cell < COLUMNS * (ROWS - 1)) displaySprite(c, down);
  }
  if (screen.cursor < NAME_LENGTH) {
    screen.nameCursor.x = screen.cursor * LETTER_WIDTH + 161;
    displaySprite(c, screen.nameCursor);
  }
  for (let i = 0; i < NAME_LENGTH && screen.name[i] !== END; i++) {
    const s = screen.letters[i], { anim, variant } = letterSprite(screen.name[i]);
    s.anim = anim;
    s.variant = variant;
    updateSprite(c, s);
    displaySprite(c, s);
  }
}

// 0x0806B354, Task_ProfileNameScreenFadeIn
function fadeIn(t) {
  const screen = t.data, { c } = screen;
  render(c, screen);
  if (updateFade(c, screen.fade)) {
    screen.cell = 0;
    t.main = main;
  }
}

// a list of u16s in the ROM, up to END
function listHas(rom, at, test) {
  for (; rom.u16(at) !== END; at += 2) if (test(rom.u16(at))) return true;
  return false;
}

// 0x0806B9C8, sub_806B9C8: whether a letter is anything but a space
const countsInName = (rom, letter) => !listHas(rom, BLANKS, v => v === letter) && letter < NOT_LETTERS;

// 0x0806B988, sub_806B988: whether a name has a letter that counts before its end
function nameIsGood(rom, name) {
  for (const letter of name) {
    if (letter === END) return false;
    if (countsInName(rom, letter)) return true;
  }
  return false;
}

// 0x0806BA14, sub_806BA14: whether a mark changes a letter. The letter before the first is the name's cursor in the original, which
// is 0 then, and no mark changes 0
function markChanges(rom, mark, letter = 0) {
  if (mark === DOTS && letter === DOTS_ON_TSU) return true;
  return listHas(rom, mark === DOTS ? FIRST_OF_FIVE_DOTS : FIRST_OF_FIVE_ROUND, first => letter >= first && letter <= first + 4);
}

// 0x0806A664, sub_806A664: the letter a mark changes it to
function marked(rom, mark, letter) {
  if (!markChanges(rom, mark, letter)) return letter;
  if (mark === DOTS && letter === DOTS_ON_TSU) return DOTTED_TSU;
  if (mark === DOTS) {
    for (let i = 0; i < 4; i++) {
      const first = rom.u16(TO_DOTS + i * 4), to = rom.u16(TO_DOTS + i * 4 + 2);
      if (letter >= first && letter <= first + 4) return letter + to - first;
    }
  } else {
    const first = rom.u16(TO_ROUND), to = rom.u16(TO_ROUND + 2);
    if (letter >= first && letter <= first + 4) return letter + to - first;
  }
  return letter;
}

// 0x08067B90, ProfileNameScreenHandleShoulderInput
function shoulders(c, screen) {
  const { name } = screen;
  if (c.repeated & KEY.L) {
    if (screen.cursor > 0) {
      screen.cursor--;
      if (screen.cursor < NAME_LENGTH - 1 && name[screen.cursor + 1] === END && !countsInName(c.rom, name[screen.cursor])) name[screen.cursor] = END;
      c.playSong(SE_MENU_CURSOR_MOVE);
    }
    return true;
  }
  if (c.repeated & KEY.R) {
    if (screen.cursor < NAME_LENGTH - 1) {
      if (name[screen.cursor] === END) name[screen.cursor] = BLANK;
      screen.cursor++;
      c.playSong(SE_MENU_CURSOR_MOVE);
    }
    return true;
  }
  return false;
}

// 0x08067C50, ProfileNameScreenHandleDpadInput
function dpad(c, screen) {
  if (!(c.repeated & (KEY.UP | KEY.DOWN | KEY.LEFT | KEY.RIGHT))) return false;
  c.playSong(SE_MENU_CURSOR_MOVE);
  if (c.repeated & KEY.UP) {
    if (screen.col < CONTROLS) {
      if (screen.row !== 0) screen.row--;
      else if (screen.page > 0) {
        c.bgScroll[3] -= ROW_HEIGHT;
        screen.page -= COLUMNS;
      } else {
        screen.row = ROWS_SHOWN - 1;
        c.bgScroll[3] = SCROLL_LAST_PAGE;
        screen.page = LAST_PAGE;
      }
    } else screen.row = screen.row > BACK ? screen.row - 1 : DONE;
  } else if (c.repeated & KEY.DOWN) {
    if (screen.col < CONTROLS) {
      if (screen.row < NAME_LENGTH) screen.row++;
      else if (screen.page < LAST_PAGE) {
        c.bgScroll[3] += ROW_HEIGHT;
        screen.page += COLUMNS;
      } else {
        c.bgScroll[3] = SCROLL_FIRST_PAGE;
        screen.row = 0;
        screen.page = 0;
      }
    } else screen.row = screen.row < DONE ? screen.row + 1 : BACK;
  } else if (c.repeated & KEY.LEFT) {
    if (screen.col !== 0) screen.col--;
    else screen.col = screen.row < BACK ? COLUMNS - 1 : CONTROLS;
  } else if (screen.row < BACK) screen.col = screen.col < COLUMNS - 1 ? screen.col + 1 : 0;
  else screen.col = screen.col < CONTROLS ? screen.col + 1 : 0;
  return true;
}

const toEndButton = screen => {
  screen.col = CONTROLS;
  screen.row = DONE;
};

// what A does on a mark, the part of 0x080677EC, Task_ProfileNameScreenMain, for the last two columns of the first two rows
function takeMark(c, screen, mark) {
  const { rom } = c, { name } = screen, i = screen.cursor;
  if (i < NAME_LENGTH) {
    if (name[i] === END) {
      c.playSong(SE_SELECT);
      if (markChanges(rom, mark, name[i - 1])) name[i - 1] = marked(rom, mark, name[i - 1]);
      else {
        name[i] = screen.cell;
        if (i < NAME_LENGTH - 1) screen.cursor++;
        else {
          screen.cursor = NAME_LENGTH;
          toEndButton(screen);
        }
      }
    } else {
      c.playSong(SE_SELECT);
      name[i] = markChanges(rom, mark, name[i]) ? marked(rom, mark, name[i]) : screen.cell;
    }
  } else {
    if (markChanges(rom, mark, name[i - 1])) {
      c.playSong(SE_SELECT);
      name[i - 1] = marked(rom, mark, name[i - 1]);
    }
    screen.cursor = NAME_LENGTH;
    toEndButton(screen);
  }
}

// 0x08067E24, ProfileNameScreenInputComplete
function finish(t, screen) {
  screen.fade = createFade({ lighten: true });
  t.main = fadeOut;
}

// the end button, from A or Start
function tryFinish(t, c, screen) {
  if (!nameIsGood(c.rom, screen.name)) {
    c.playSong(SE_RETURN);
    return;
  }
  c.playSong(SE_SELECT);
  finish(t, screen);
}

// 0x080677EC, Task_ProfileNameScreenMain
function main(t) {
  const screen = t.data, { c } = screen, { name } = screen;
  render(c, screen);
  if (shoulders(c, screen) || dpad(c, screen)) return;
  if (c.repeated & KEY.A) {
    if (screen.col < CONTROLS) {
      const isMark = screen.cell === DOTS_MARK || screen.cell === ROUND_MARK;
      if (isMark) takeMark(c, screen, screen.cell === DOTS_MARK ? DOTS : ROUND);
      if (screen.cursor < NAME_LENGTH && !isMark) {
        c.playSong(SE_SELECT);
        name[screen.cursor] = screen.cell;
        if (screen.cursor < NAME_LENGTH - 1) screen.cursor++;
      }
      return;
    }
    if (screen.row === BACK) {
      if (screen.cursor === 0) return;
      screen.cursor--;
      c.playSong(SE_MENU_CURSOR_MOVE);
    } else if (screen.row === FORWARD) {
      if (screen.cursor > NAME_LENGTH - 2) return;
      if (name[screen.cursor] === END) name[screen.cursor] = BLANK;
      screen.cursor++;
      c.playSong(SE_MENU_CURSOR_MOVE);
    } else if (screen.row === DONE) tryFinish(t, c, screen);
    return;
  }
  if (c.pressed & KEY.START) {
    if (screen.col === CONTROLS && screen.row === DONE) tryFinish(t, c, screen);
    else {
      c.playSong(SE_SELECT);
      toEndButton(screen);
    }
    return;
  }
  if (c.repeated & KEY.B) {
    c.playSong(SE_RETURN);
    if ((screen.cursor > 0 && name[screen.cursor] === END) || screen.cursor > NAME_LENGTH - 1) screen.cursor--;
    for (let i = screen.cursor; i < NAME_LENGTH - 1; i++) name[i] = name[i + 1];
    name[NAME_LENGTH - 1] = END;
  }
}

// 0x08067EA4, ProfileNameScreenFadeOutAndExit: the save is written here, and the title screen comes next, which isn't ported yet
function fadeOut(t) {
  const screen = t.data, { c } = screen;
  if (!updateFade(c, screen.fade)) render(c, screen);
  else {
    c.destroyTask(t);
    startStage(c, 0);
  }
}
