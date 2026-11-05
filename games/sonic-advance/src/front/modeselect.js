// The VS menu's first screens (SAT-R decompilation, src/game/sa1/menus/mp_mode_select.c and mp_mode_select_2.c:
// CreateMultiplayerModeSelectScreen and its tasks), from VS on the main menu. A save whose player has no id yet
// (`unk4` 0) goes to the name input first, in game mode 2, which comes back here. The screen fades in from black
// over 32 frames to the character select's song: MULTI-PAK and SINGLE-PAK in the save's language, the chosen one
// with a bar behind it and a band of texts running across its row. Up and Down choose, wrapping round, and A or
// B fade it out to black over 32 frames: A to the chosen pak's waiting screen and B to the main menu.
//
// The Multi-Pak waiting screen (ModeSelect_InitMultiPak, Task_MultiPak) shows how many players are linked, and B
// leaves it for this screen again with the return sound. This build has it only as a GBA with no cable sees it.
//
// Not built yet: the link between GBAs, so the waiting screen never gets past one player; the Single-Pak waiting
// screen, which needs the multiboot transfer; and the screens after them.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';
import { createMainMenu } from './title.js';
import { createNameInput } from './nameinput.js';

// by the save's language (0 Japanese, 1 English): the choices' animation (gUnknown_080BB348), the waiting screen's
// texts (gUnknown_080BB34C) and its "press start" (gUnknown_080BB350), and the choices' tilemap (0x4C + language).
// These are the USA copy's numbers, from its tables at 0x080B8350, 0x080B8354 and 0x080B8358, and its code's own:
// from 886 on the decompilation's European numbers are 2 higher.
const ANIM_MODES = [899, 895], ANIM_OUTCOME = [890, 889], ANIM_PRESS_START = [891, 888];
const TM_MODES = [0x4C, 0x4D], TM_CONTINUE_SCREEN = 80;
const ANIM_BAR = 860, ANIM_PLAYER_ROWS = 886;
const OBJ_VRAM = 0x10000;
const BAND_WIDTH = 200, BAR_COLUMNS = 8;
const PAK_COUNT = 2, MULTI_PAK = 0, SINGLE_PAK = 1;
const PLAYERS_MAX = 4;
const s16 = v => (v << 16) >> 16;

// a sprite of the screen: its animation from the start, at normal speed
const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0x2000, ...fields });

/**
 * CreateMultiplayerModeSelectScreen. `ctx` has the engine, the sprite tables, the tilemaps, the save and `gameMode`
 * (2 once this screen has started the name input).
 */
export function createModeSelect(ctx) {
  const e = ctx.engine, { save } = ctx, lang = save.uiLanguage;
  if (save.unk4 === 0) {
    e.playSongOrChange(SONG.CHARACTER_SELECTION);
    ctx.gameMode = 2;
    createNameInput(ctx);
    return;
  }
  e.dispCnt = 0x1141;
  e.bgCnt[0] = 0x1E03;
  const screen = {
    ctx, mode: MULTI_PAK, qBand: 0, qFade: 0x1000, leaving: 0, frameCount: 0,   // mode, qUnk1FC, qUnk208, unk20A
    bar: sprite(ANIM_BAR, OBJ_VRAM + 0x840, { x: 0, y: 64, oamFlags: 0x400 }),
    s: [sprite(ANIM_MODES[lang], OBJ_VRAM, { x: 232, y: 64, oamFlags: 0x3C0 })],
  };
  e.createTask(fadeIn, screen, 0x2000);
  e.bldCnt = 0xFF;
  e.bldY = 0x10;
  updateSprite(e, ctx.sprites, screen.s[0]);
  updateSprite(e, ctx.sprites, screen.bar);
  drawBackground(e, ctx.tilemaps, createBackground({ layoutVram: 0xF000, tilemapId: TM_MODES[lang], targetTilesX: 30, targetTilesY: 20 }));
  e.playSongOrChange(SONG.CHARACTER_SELECTION);
}

// Task_MultiplayerModeSelectScreenInit: the fade in, half a step a frame
function fadeIn(t) {
  const screen = t.data;
  screen.qFade -= 0x80;
  if (screen.qFade <= 0) {
    screen.qFade = 0;
    t.main = chooseMode;
  }
  screen.ctx.engine.bldY = screen.qFade >> 8;
  drawMode(screen);
}

// Task_800E648: Up and Down choose, A goes on to the chosen pak and B back
function chooseMode(t) {
  const screen = t.data, e = screen.ctx.engine;
  if (e.repeated & KEY.UP) {
    e.playSong(SONG.MENU_CURSOR);
    screen.mode = (screen.mode - 1) & 0xFF;
    if (screen.mode >= PAK_COUNT) screen.mode = SINGLE_PAK;
    screen.qBand = 0;
  } else if (e.repeated & KEY.DOWN) {
    e.playSong(SONG.MENU_CURSOR);
    if (++screen.mode >= PAK_COUNT) screen.mode = MULTI_PAK;
    screen.qBand = 0;
  }
  // A on Single-Pak does nothing for now: its waiting screen needs the multiboot transfer, which isn't built, and
  // there is nothing to go on to
  if ((e.pressed & KEY.A) && screen.mode === MULTI_PAK) {
    screen.leaving = 0;
    e.playSong(SONG.SELECT);
    e.bldCnt = 0xFF;
    t.main = fadeOut;
  } else if (e.pressed & KEY.B) {
    screen.leaving = 1;
    e.playSong(SONG.RETURN);
    e.bldCnt = 0xFF;
    t.main = fadeOut;
  }
  drawMode(screen);
}

// sub_800E798: the band of texts moves half a pixel a frame and runs round every 200; the bar sits behind the
// chosen row
function drawMode(screen) {
  const { ctx } = screen, e = ctx.engine, s = screen.s[0];
  screen.qBand += 0x80;
  if (screen.qBand > BAND_WIDTH * 0x100) screen.qBand -= BAND_WIDTH * 0x100;
  s.y = screen.mode * 24 + 64;
  s.variant = screen.mode;
  updateSprite(e, ctx.sprites, s);
  for (let x = (screen.qBand >> 8) - BAND_WIDTH; 232 - x > 0; x += BAND_WIDTH) {
    s.x = 232 - x;
    displaySprite(e, ctx.sprites, s);
  }
  const bar = screen.bar;
  bar.y = screen.mode * 24 + 54;
  for (let i = 0; i < BAR_COLUMNS; i++) {
    bar.x = i * 32;
    displaySprite(e, ctx.sprites, bar);
  }
}

// Task_800E868: the fade out, half a step a frame; at black B stops the music and starts the main menu again, and
// A starts the chosen pak's waiting screen
function fadeOut(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.qFade += 0x80;
  if (screen.qFade >= 0x1000) {
    screen.qFade = 0x1000;
    clearMap(e);
    if (screen.leaving) {
      e.bldCnt = 0;
      e.bldY = 0;
      e.stopSong(SONG.CHARACTER_SELECTION);
      e.destroyTask(t);
      createMainMenu(ctx, true);
    } else {
      t.main = initMultiPak;
    }
  } else {
    e.bldY = screen.qFade >> 8;
    drawMode(screen);
    // CreateMainMenu's DmaFill32 over the first layer's and the sprites' first tiles already shows in the original's
    // picture on the frame before the main menu is made, as it does leaving the Time Attack menu. The 64 pixels
    // of the first four lines above the first tile still differ in the picture; why isn't known
    if (screen.leaving && screen.qFade + 0x80 >= 0x1000) {
      e.video.vram.fill(0, 0, 0x40);
      e.video.vram.fill(0, OBJ_VRAM, OBJ_VRAM + 0x40);
    }
  }
}

// the first layer's map cleared in the next V-blank (gBgSprites_Unknown1[0] and 2[0])
function clearMap(e) {
  e.mapFill[0].value = 0;
  e.mapFill[0].rect.set([0, 0, 0xFF, 0x20]);
}

// ModeSelect_InitMultiPak: the waiting screen's texts, the number of players and "press start", over its picture
function initMultiPak(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, lang = ctx.save.uiLanguage;
  e.playSong(SONG.VS_PLEASE_WAIT);
  screen.frameCount = ctx.save.unk4 + e.frameCount;
  screen.joined = [new Uint8Array(PLAYERS_MAX), new Uint8Array(PLAYERS_MAX)];   // unk20B
  let vram = OBJ_VRAM;
  screen.s = [
    sprite(ANIM_OUTCOME[lang], vram, { x: 120, y: 33, oamFlags: 0x3C0 }),
    sprite(ANIM_PLAYER_ROWS, vram += 0x540, { x: 101, y: 41, oamFlags: 0x3C0 }),
    sprite(ANIM_OUTCOME[1], vram += 0x460, { x: 120, y: 109, oamFlags: 0x3C0, variant: 4 }),
  ];
  screen.pressStart = sprite(ANIM_PRESS_START[lang], vram += 0x80, { x: 120, y: 125, oamFlags: 0x3C0 });
  for (const s of [...screen.s, screen.pressStart]) updateSprite(e, ctx.sprites, s);
  drawBackground(e, ctx.tilemaps, createBackground({ layoutVram: 0xF000, tilemapId: TM_CONTINUE_SCREEN, targetTilesX: 30, targetTilesY: 20 }));
  screen.unk206 = 0;
  screen.checked = 0;   // unk218
  t.main = waitMultiPak;
}

// Task_MultiPak, for a GBA with no cable: it is the only player, and B goes back
function waitMultiPak(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.qFade = s16(screen.qFade - 0x80);
  if (screen.qFade < 0) screen.qFade = 0;
  e.bldY = screen.qFade >> 8;
  const joined = screen.joined;
  for (let i = 0; i < PLAYERS_MAX; i++) {
    joined[0][i] = (joined[0][i] << 1) & 0xFF;
    joined[1][i] = (joined[1][i] << 1) & 0xFF;
  }
  joined[0][0] |= 1;   // this GBA, whose id is 0
  let players = 1;
  screen.checked = 1;
  if (e.pressed & KEY.B) {
    e.stopSong(SONG.CHARACTER_SELECTION);
    e.playSong(SONG.RETURN);
    clearMap(e);
    e.destroyTask(t);
    createModeSelect(ctx);
    return;
  }
  screen.s[2].variant = players + 3;
  for (const s of screen.s) {
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
}
