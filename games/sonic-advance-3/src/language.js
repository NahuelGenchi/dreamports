// The language screen, which a game with nothing saved starts with (0x08000390 calls it). Six buttons, the one for the
// language chosen in the bright colours and the rest in the dim, the title and the line along the bottom in that
// language, over a layer that scrolls up and to the right a pixel and a half a frame. Up and Down move through the
// languages, going round at either end. A or Start keeps it and goes on to the name entry.

import { KEY, FLAGS, defaultDisplay } from './core.js';
import { createSprite, updateSprite, displaySprite } from './sprite.js';
import { drawBackground } from './background.js';
import { nameEntry } from './name-entry.js';

const OBJ_VRAM = 0x10000;
const LANGUAGES = 6;
// the language a game with nothing saved starts on: English (the save 0x08001DDC clears)
const FIRST_LANGUAGE = 1;
const SE_SELECT = 0x6A, SE_DPAD_SELECT = 0x6C;
// where the buttons start, with the layer's scroll of -10 taken in (0x0808FF8C)
const BUTTON_X = 40, BUTTON_Y = 48, TITLE_X = 120, TITLE_Y = 36, LINE_X = 120, LINE_Y = 150;

// the tables the sprites come from: the title by language, and the buttons with their tiles (0x0808FA44)
const titleAt = i => 0xD6D70 + i * 8, buttonAt = i => 0xD6D40 + i * 8, lineAt = i => 0xD6D30 + i * 8, CURSOR = 0xD6C90;
const COLOURS = 0xD6890;

/** 0x08000390, then 0x0808F82C: the screen's task, its sprites and its layers. */
export function languageScreen(c) {
  defaultDisplay(c);
  const { rom } = c;
  const screen = { c, choice: FIRST_LANGUAGE, scrollX: 0, scrollY: 0 };
  c.bgScroll[2] = 0;
  c.bgScroll[3] = 0xFFF6;
  // 0x0808FA44: the sprites' tiles one after the other, and the window that covers the screen
  let tiles = OBJ_VRAM;
  const take = count => { const at = tiles; tiles += count * 32; return at; };
  const shown = (anim, variant, count, oamFlags = 0) => {
    const s = createSprite({ tiles: take(count), anim, variant, oamFlags });
    updateSprite(c, s);
    return s;
  };
  screen.title = shown(rom.u16(titleAt(FIRST_LANGUAGE)), rom.u8(titleAt(FIRST_LANGUAGE) + 2), 50);
  screen.buttons = [];
  for (let i = 0; i < LANGUAGES; i++) screen.buttons.push(shown(rom.u16(buttonAt(i)), rom.u8(buttonAt(i) + 2), rom.u32(buttonAt(i) + 4), 0x40));
  screen.line = shown(rom.u16(lineAt(1)), rom.u8(lineAt(1) + 2), 42);
  screen.cursor = shown(rom.u16(CURSOR), rom.u8(CURSOR + 2), rom.u32(CURSOR + 4));
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] |= 0x3F;
  c.winRegs[5] |= 0x1F;
  c.bldCnt = 0x3FFF;
  c.bldY = 0;
  // 0x0808F96C: mode 1 with layers 0 and 1, and each layer's picture
  c.dispCnt = 0x1341;
  c.bgCnt[0] = 0x0603;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  drawBackground(c, { id: 349, dest: 0, layoutVram: 0x3000, targetTilesX: 32, targetTilesY: 32, flags: 0 });
  c.bgCnt[1] = 0x5E06;
  drawBackground(c, { id: 350, dest: 0x4000, layoutVram: 0xF000, targetTilesX: 30, targetTilesY: 20, flags: 1 });
  // the sprites' colours (0x080C7194, CpuFastSet), all of them
  for (let i = 0; i < 256; i++) c.objPalette[i] = rom.u16(COLOURS + i * 2);
  c.flags |= FLAGS.UPDATE_OBJ_PALETTES;
  c.createTask(choose, screen);
}

// 0x0808FC64: the keys, the layer's scroll and the sprites
function choose(t) {
  const screen = t.data, { c } = screen;
  if (c.pressed & (KEY.A | KEY.START)) {
    c.playSong(SE_SELECT);
    c.save.language = screen.choice;
    nameEntry(c, 0);
    c.destroyTask(t);
    return;
  }
  if (c.repeated & (KEY.UP | KEY.DOWN)) {
    c.playSong(SE_DPAD_SELECT);
    if (c.repeated & KEY.UP) screen.choice = screen.choice === 0 ? LANGUAGES - 1 : screen.choice - 1;
    else if (c.repeated & KEY.DOWN) screen.choice = screen.choice === LANGUAGES - 1 ? 0 : screen.choice + 1;
  }
  screen.scrollX += 0x180;
  screen.scrollY -= 0x180;
  c.bgScroll[0] = screen.scrollX >> 8;
  c.bgScroll[1] = screen.scrollY >> 8;
  showButtons(c, screen);
  showTitle(c, screen);
  showLine(c, screen);
  showCursor(c, screen);
}

// 0x0808FDC4: the buttons, each at its place, the one chosen with the first palette and the rest the second
function showButtons(c, screen) {
  screen.buttons.forEach((s, i) => {
    s.x = BUTTON_X;
    s.y = BUTTON_Y + i * 16;
    s.palId = i === screen.choice ? 0 : 1;
    updateSprite(c, s);
    displaySprite(c, s);
  });
}

// 0x0808FEBC: the title, in the language chosen
function showTitle(c, screen) {
  const s = screen.title;
  s.anim = c.rom.u16(titleAt(screen.choice));
  s.variant = c.rom.u8(titleAt(screen.choice) + 2);
  s.x = TITLE_X;
  s.y = TITLE_Y;
  updateSprite(c, s);
  displaySprite(c, s);
}

// 0x0808FE4C: the line along the bottom, the first for Japanese and the second for the rest
function showLine(c, screen) {
  const s = screen.line, at = lineAt(screen.choice ? 1 : 0);
  s.anim = c.rom.u16(at);
  s.variant = c.rom.u8(at + 2);
  s.x = LINE_X;
  s.y = LINE_Y;
  updateSprite(c, s);
  displaySprite(c, s);
}

// 0x0808FF08: the cursor around the button chosen
function showCursor(c, screen) {
  const s = screen.cursor;
  s.x = BUTTON_X - 1;
  s.y = BUTTON_Y + screen.choice * 16 + 1;
  displaySprite(c, s);
}
