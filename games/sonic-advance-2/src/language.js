// The language screen, which a game with nothing saved starts with (0x0801A51C, GameInit, calls it). The six languages,
// the one chosen in the bright colours with an outline around it and the rest in the dim, with the title and the line along
// the bottom in that language. Up and Down move through them, going round at either end. A or Start keeps it and fades out,
// and the name entry comes next.

import { nameEntry } from './name-entry.js';
import { KEY } from './core.js';
import { updateSprite, displaySprite } from './sprite.js';
import { entry, place as placeSprite } from './menu.js';
import { drawBackground } from './background.js';
import { createFade, updateFade } from './fade.js';

const LANGUAGES = 6;
// the language a game with nothing saved starts on, as an empty save's language is out of range: English
const FIRST_LANGUAGE = 1;
const SE_SELECT = 106, SE_MENU_CURSOR_MOVE = 108;
const TILEMAP = 134;
const PRIORITY_LOW = 0x3000;
// the tables the sprites come from, each entry of animation, variant and how many tiles it takes
const TITLES = 0xD9A80, CONTROLS = 0xD9AE0, OPTIONS = 0xD9B10;
const OUTLINE = 0x3BD, OUTLINE_VARIANT = 5, OUTLINE_TILES = 0x3F;
const optionY = i => 40 + i * 15;

/** 0x08063940, CreateNewProfileScreen: the screen's task, its layer, its fade and its sprites. */
export function languageScreen(c) {
  const screen = { c, choice: FIRST_LANGUAGE };
  initRegisters(c, screen);
  // 0x0806B0AC, LanguageScreenCreateBackgroundsUI, with 0x0806B854, OptionsInitBackground
  drawBackground(c, { id: TILEMAP, dest: 0, layoutVram: 0x3800, targetTilesX: 30, targetTilesY: 20, flags: 0 });
  createUi(c, screen);
  c.createTask(fadeIn, screen);
}

// 0x080668A8, LanguageScreenInitRegisters
function initRegisters(c, screen) {
  c.dispCnt = 0x1740;
  c.bgCnt[0] = 0x0703;
  c.bgCnt[2] = 0x4E05;
  c.bgCnt[3] = 0xDC0E;
  c.bgScroll[5] = 0xFFFD;
  screen.fade = createFade();
  updateFade(c, screen.fade);
}

const place = (c, screen, tiles, anim, x, y, order, variant) => placeSprite(c, screen, tiles, anim, x, y, order, variant, PRIORITY_LOW);

// 0x0806B8D4, MaxSpriteSize: the most tiles any language's entry takes
const mostTiles = (rom, table) => {
  let most = 0;
  for (let i = 0; i < LANGUAGES; i++) most = Math.max(most, entry(rom, table, i).tiles);
  return most;
};

// 0x08066930, LanguageScreenCreateUI
function createUi(c, screen) {
  const { rom } = c, { choice } = screen;
  const titleTiles = mostTiles(rom, TITLES), controlsTiles = mostTiles(rom, CONTROLS);
  const title = entry(rom, TITLES, choice), controls = entry(rom, CONTROLS, choice);
  screen.title = place(c, screen, titleTiles, title.anim, 0x78, 0x1A, 13, title.variant);
  screen.controls = place(c, screen, controlsTiles, controls.anim, 0x78, 0x8A, 13, controls.variant);
  screen.options = [];
  for (let i = 0; i < LANGUAGES; i++) {
    const option = entry(rom, OPTIONS, i), s = place(c, screen, option.tiles, option.anim, 0x28, optionY(i), 13, option.variant);
    s.palId = i === choice ? 0 : 1;
    screen.options.push(s);
  }
  screen.outline = place(c, screen, OUTLINE_TILES, OUTLINE, 0x26, optionY(choice), 12, OUTLINE_VARIANT);
  // three sprites that are never shown, for the colours their animations load
  place(c, screen, 0, 0x3C4, 0, 0, 0, 0);
  place(c, screen, 0, 0x3C4, 0, 0, 0, 1);
  place(c, screen, 0, 0x3C3, 0, 0, 0, 12);
}

// 0x0806B1F8, LanguageScreenRenderUI
function render(c, screen) {
  displaySprite(c, screen.title);
  displaySprite(c, screen.controls);
  for (const s of screen.options) displaySprite(c, s);
  displaySprite(c, screen.outline);
}

// 0x0806B0D8, Task_LanguageScreenFadeIn
function fadeIn(t) {
  const screen = t.data, { c } = screen;
  render(c, screen);
  if (updateFade(c, screen.fade)) t.main = choose;
}

// 0x08066C2C, LanguageScreenHandleLanguageChanged
function changed(c, screen) {
  const { rom } = c, { choice } = screen;
  screen.outline.y = optionY(choice);
  screen.options.forEach((s, i) => { s.palId = i === choice ? 0 : 1; });
  const title = entry(rom, TITLES, choice), controls = entry(rom, CONTROLS, choice);
  screen.title.variant = title.variant;
  screen.title.anim = title.anim;
  updateSprite(c, screen.title);
  screen.controls.variant = controls.variant;
  screen.controls.anim = controls.anim;
  updateSprite(c, screen.controls);
}

// 0x08066B0C, Task_LanguageScreenMain
function choose(t) {
  const screen = t.data, { c } = screen;
  if (c.repeated & KEY.DOWN) {
    c.playSong(SE_MENU_CURSOR_MOVE);
    screen.choice = screen.choice >= LANGUAGES - 1 ? 0 : screen.choice + 1;
    changed(c, screen);
  } else if (c.repeated & KEY.UP) {
    c.playSong(SE_MENU_CURSOR_MOVE);
    screen.choice = screen.choice < 1 ? LANGUAGES - 1 : screen.choice - 1;
    changed(c, screen);
  }
  render(c, screen);
  if (c.repeated & (KEY.DOWN | KEY.UP)) return;
  if (c.pressed & (KEY.A | KEY.START)) {
    c.playSong(SE_SELECT);
    // 0x0806B110, LanguageScreenHandleExit
    screen.fade = createFade({ lighten: true });
    updateFade(c, screen.fade);
    t.main = fadeOut;
  }
}

// 0x0806B14C, Task_LanguageScreenFadeOutAndExit: the name entry comes next (0x08063A00, CreateNewProfileNameScreen)
function fadeOut(t) {
  const screen = t.data, { c } = screen;
  if (!updateFade(c, screen.fade)) render(c, screen);
  else {
    nameEntry(c, screen.choice);
    c.destroyTask(t);
  }
}
