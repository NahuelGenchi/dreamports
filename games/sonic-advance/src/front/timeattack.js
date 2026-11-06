// The Time Attack menu (SAT-R decompilation, src/game/sa1/menus/time_attack.c: CreateTimeAttackMenu and its tasks),
// from the main menu's Time Attack. It fades in from black over 16 frames to the character select's song: a
// picture in the save's language with two entries, one to start a run and one to see the records, and a bar of
// sprites behind the chosen one that slides left along it, half a pixel a frame. Up and Down move the bar
// between the entries, wrapping round, with the main menu's key repeat. B fades the screen out to black over 16
// frames, the song going on, stops the song and opens the main menu again, which fades in with Game Start chosen.
// A fades out too, and leaves for the character select, in Time Attack mode (Start), or the course select
// (Records), the song going on.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, uiGfxStackInit, loadUiGfx, createFade, fadeStep } from './ui.js';
import { createMainMenu } from './title.js';
import { createCharacterSelect } from './charselect.js';
import { createCourseSelect } from './courseselect.js';

const OBJ_VRAM = 0x10000;
// by the save's language (0 Japanese, 1 English): the choice bar's animation, which the USA ROM numbers two lower
// than the decompilation's European one (882 and 881)
const ANIM_BAR = [880, 879];
const ANIM_FRAME = 860;
// the bar's variant by entry, then language
const BAR_VARIANTS = [[1, 1], [0, 0]];
const ENTRIES = 2;
const BAR_SPEED = 0x80, BAR_WRAP = 0x8000, BAR_SPACE = 128, SCREEN_RIGHT = 224;
// the picture's blocks in the ROM from where its colours start: the Japanese one's colours (256), tiles (113 of 8
// bits a pixel) and 32 × 20 map, then the English one's with 131 tiles
const PICTURES = [
  { palette: 0, paletteSize: 0x200, tiles: 0x200, tilesSize: 0x1C40, layout: 0x1E40, layoutSize: 0x500 },
  { palette: 0x2340, paletteSize: 0x200, tiles: 0x2540, tilesSize: 0x20C0, layout: 0x4600, layoutSize: 0x500 },
];
const s16 = v => (v << 16) >> 16;
const s32 = v => v | 0;

// a sprite of the menu: its animation from the start, at normal speed
const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, ...fields });

/**
 * CreateTimeAttackMenu. `ctx` has the engine, the sprite tables, the save (`save`, for its language) and the ROM's
 * offsets (`offsets`, with the picture's at `timeAttackMenu`).
 */
export function createTimeAttackMenu(ctx) {
  const e = ctx.engine, lang = ctx.save.uiLanguage;
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0xF84;
  e.bgScroll[1] = 0;

  const menu = {
    ctx, unk70: 0, entry: 0, unk76: 0,   // unk74
    s: sprite(ANIM_BAR[lang], OBJ_VRAM, { x: 0xE0, y: 0x40, oamFlags: 0x3C0, variant: BAR_VARIANTS[0][lang] }),
    s2: sprite(ANIM_FRAME, OBJ_VRAM + 0x2000, { x: 0, y: 0x40, oamFlags: 0x400 }),
  };
  e.createTask(chooseEntry, menu, 0x2000);
  updateSprite(e, ctx.sprites, menu.s);
  updateSprite(e, ctx.sprites, menu.s2);

  createUiTask(e);
  uiGfxStackInit(e);
  const at = ctx.offsets.timeAttackMenu, picture = PICTURES[lang !== 0 ? 1 : 0];
  loadUiGfx(e, {
    uiGfxID: 0x80, unk2B: 0, unk28: 0, unk29: 0, unk2A: 0x15,
    tiles: at + picture.tiles, tilesSize: picture.tilesSize, palette: at + picture.palette, paletteSize: picture.paletteSize,
    layout: at + picture.layout, layoutSize: picture.layoutSize,
  });
  menu.fade = createFade(0, 1, 2, 0, 0x200, 0x10);
  fadeStep(e, menu.fade);
  e.playSongOrContinue(SONG.CHARACTER_SELECTION);   // m4aSongNumStartOrContinue: nothing plays as the main menu leaves
}

// the bar, repeated along the screen as it slides left, and the frame round the chosen entry
function drawMenu(menu) {
  const { ctx } = menu, e = ctx.engine, lang = ctx.save.uiLanguage;
  menu.unk70 += BAR_SPEED;
  if (menu.unk70 > BAR_WRAP) menu.unk70 -= BAR_WRAP;
  let s = menu.s;
  s.y = menu.entry * 24 + 64;
  s.variant = BAR_VARIANTS[menu.entry][lang];
  updateSprite(e, ctx.sprites, s);
  for (let x = (s32(menu.unk70) >> 8) - BAR_SPACE; SCREEN_RIGHT - x > 0; x += BAR_SPACE) {
    s.x = SCREEN_RIGHT - x;
    displaySprite(e, ctx.sprites, s);
  }
  s = menu.s2;
  s.y = menu.entry * 24 + 54;
  for (let i = 0; i < 8; i++) {
    s.x = i * 32;
    displaySprite(e, ctx.sprites, s);
  }
}

// Task_TimeAttackMenu: the menu shown while it fades in; once it has, the windows and the blend off
function chooseEntry(t) {
  const menu = t.data, e = menu.ctx.engine;
  drawMenu(menu);
  if (fadeStep(e, menu.fade)) {
    e.dispCnt &= ~0xE000;
    e.bldCnt = 0;
    e.bldY = 0;
    t.main = choose;
  }
}

// Task_80103C4: Up and Down choose, A fades the menu out and, once black, leaves for the entry's screen, and B for the main
// menu
function choose(t) {
  const menu = t.data, { ctx } = menu, e = ctx.engine, fade = menu.fade;
  if (fade.unk4 !== 1) {
    if (e.repeated & KEY.UP) {
      menu.unk70 = 0;
      e.playSong(SONG.MENU_CURSOR);
      menu.entry = (menu.entry - 1) & 0xFF;
      if (menu.entry > ENTRIES - 1) menu.entry = ENTRIES - 1;
    } else if (e.repeated & KEY.DOWN) {
      menu.unk70 = 0;
      e.playSong(SONG.MENU_CURSOR);
      if (++menu.entry > ENTRIES - 1) menu.entry = 0;
    }
    if (e.pressed & KEY.A) {
      fade.unk4 = 1;
      fade.unk6 = 0;
      menu.unk76 = 1;
      e.playSong(SONG.SELECT);
    } else if (e.pressed & KEY.B) {
      fade.unk4 = 1;
      fade.unk6 = 0;
      menu.unk76 = 2;
      e.playSong(SONG.RETURN);
    }
  } else if (fadeStep(e, fade)) {
    if (menu.unk76 & 1) {
      ENTRY_SCREENS[menu.entry](t);
      return;
    }
    leaveMenu(t);
    return;
  }
  drawMenu(menu);
  // CreateMainMenu's DmaFill32 over the sprites' first tiles (BG_CHAR_ADDR_FROM_BGCNT(2) + 0x3FC0 overflowing) already
  // shows in the original's picture on the frame before the leave, with the rest of the screen as it was
  if (menu.unk76 === 2 && fade.unk4 === 1 && fade.unk6 + fade.unk8 >= 0x2000) e.video.vram.fill(0, OBJ_VRAM, OBJ_VRAM + 0x40);
}

// TimeAttack_CreateStartMenu: the character select, in Time Attack mode
function startRun(t) {
  const { ctx } = t.data;
  ctx.gameMode = 1;
  ctx.engine.destroyTask(t);
  createCharacterSelect(ctx);
}

// TimeAttack_CreateRecordsMenu: the course select that shows the records
function showRecords(t) {
  const { ctx } = t.data;
  ctx.gameMode = 0;
  ctx.engine.destroyTask(t);
  createCourseSelect(ctx, true);
}

// gUnknown_080BB364
const ENTRY_SCREENS = [startRun, showRecords];

// sub_8010580: the windows and the blend off, the layer's map cleared, and the main menu, fading in; then the song
// stops
function leaveMenu(t) {
  const { ctx } = t.data, e = ctx.engine;
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0;
  e.bldY = 0;
  e.mapFill[0].value = 0;
  e.mapFill[0].rect.set([0, 0, 0xFF, 0x20]);
  e.destroyTask(t);
  createMainMenu(ctx, true);
  e.stopSong(SONG.CHARACTER_SELECTION);
}
