// The Time Attack lobby (SAT-R decompilation, src/game/sa1/ui/time_attack_lobby.c: CreateTimeAttackLobbyScreen and its
// tasks), where a run ends: after the results, a life lost, the time running out, or A in the pause menu. Four choices
// in the save's language over a picture, with a marker beside the chosen one and the character beside them: Retry (the
// same act again), the character select, the course select and the title screen. Up and Down move the marker, wrapping
// round, with the key repeat of 20 frames and then 8. A makes the character run off to the right (all but for the title
// screen), then the screen fades out to black and the choice's screen comes.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, uiGfxStackInit, loadUiGfx, createFade, fadeStep } from './ui.js';
import { createCharacterSelect } from './charselect.js';
import { createCourseSelect } from './courseselect.js';

const CHOICES = 4, RETRY = 0, TITLE = 3;
// by the save's language (0 Japanese, 1 English) and choice: the text's animation and variant, and by choice the room its
// tiles take in sprite memory (the USA ROM numbers animations two lower than the decompilation's European one)
const ANIM_MARKER = 857;
const SCREEN_CENTRE = 120, RUN_STEP = 32;

// the tables in the ROM from `tables`: the four choices' animations and variants by language, their sizes, and by
// character the three animations and variants of the figure beside them
const ANIMS = 0, VARIANTS = 0x10, SIZES = 0x18, FIGURE_ANIMS = 0x1C, FIGURE_VARIANTS = 0x34;
// the picture, from `picture`: 256 colours, then its tiles and its map of 0x500 bytes each
const PICTURE_TILES = 0x200, PICTURE_MAP = 0x500;

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, oamFlags: 0x480, frameFlags: 0x2000, ...fields });

/** CreateTimeAttackLobbyScreen. `ctx` has the engine, the sprite tables, the save, the ROM's offsets and `character`. */
export function createTimeAttackLobby(ctx) {
  const e = ctx.engine, rom = e.rom, { character, save } = ctx, lang = save.uiLanguage !== 0 ? 1 : 0;
  const at = ctx.offsets.timeAttackLobby, tables = at.tables;
  e.playSong(SONG.TIME_ATTACK_LOBBY);
  e.firstRepeat.fill(0x14);
  e.nextRepeat.fill(8);
  createUiTask(e);
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E83;
  uiGfxStackInit(e);
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;

  const lobby = { ctx, tables, choice: 0, x: 0, speed: 0, fade: createFade(0, 1, 2, 0, 0x100, 0x10) };   // unk134, qUnk12C, qUnk130
  lobby.task = e.createTask(handleInput, lobby, 0x2000, 0, destroyed);
  lobby.texts = [];
  for (let i = 0; i < CHOICES; i++) {
    const s = sprite(rom.u16(tables + ANIMS + (i * 2 + lang) * 2), e.vramMalloc(rom.u8(tables + SIZES + i)), { variant: rom.u8(tables + VARIANTS + i * 2 + lang), x: 47, y: i * 16 + 33 });
    updateSprite(e, ctx.sprites, s);
    lobby.texts.push(s);
  }
  lobby.marker = sprite(ANIM_MARKER, e.vramMalloc(4), { variant: 0, x: 33, y: 25 });
  updateSprite(e, ctx.sprites, lobby.marker);
  lobby.figure = sprite(rom.u16(tables + FIGURE_ANIMS + character * 6), e.vramMalloc(64), { variant: rom.u8(tables + FIGURE_VARIANTS + character * 3), x: 0x78, y: 0x82, frameFlags: 0x2400, animSpeed: 0x10 });
  fadeStep(e, lobby.fade);
  loadUiGfx(e, {
    uiGfxID: 128, unk2B: 0, tiles: at.picture + PICTURE_TILES, tilesSize: 0x500, layout: at.picture + PICTURE_TILES + 0x300, layoutSize: PICTURE_MAP,
    palette: at.picture, paletteSize: 0x200, unk28: 0, unk29: 0, unk2A: 0x15,
  });
}

// Task_HandleInput: once it has faded in, Up and Down choose, and A leaves
function handleInput(t) {
  const lobby = t.data, { ctx, fade } = lobby, e = ctx.engine, rom = e.rom, character = ctx.character;
  if (fadeStep(e, fade)) {
    if (e.repeated & KEY.DOWN) {
      e.playSong(SONG.MENU_CURSOR);
      lobby.choice = lobby.choice < CHOICES - 1 ? lobby.choice + 1 : 0;
    } else if (e.repeated & KEY.UP) {
      e.playSong(SONG.MENU_CURSOR);
      lobby.choice = lobby.choice !== 0 ? lobby.choice - 1 : CHOICES - 1;
    }
    if (e.pressed & KEY.A) {
      e.playSong(SONG.SELECT);
      if (lobby.choice !== CHOICES - 1) changeFigure(lobby, rom, character);
      fade.unk4 = 1;
      fade.unk6 = 0;
      t.main = leaving;
    }
  }
  show(lobby);
}

function changeFigure(lobby, rom, character) {
  const s = lobby.figure, tables = lobby.tables;
  s.graphics.anim = rom.u16(tables + FIGURE_ANIMS + character * 6 + 2);
  s.variant = rom.u8(tables + FIGURE_VARIANTS + character * 3 + 1);
  s.prevVariant = 0xFF;
}

// Task_806A508: the character runs off to the right, faster and faster; then the fade out, and the choice's screen
function leaving(t) {
  const lobby = t.data, { ctx, fade } = lobby, e = ctx.engine;
  if (lobby.x < 160 * 0x100 && lobby.choice !== TITLE) {
    lobby.speed += RUN_STEP;
    lobby.x += lobby.speed;
  } else if (fadeStep(e, fade)) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    e.stopSong(SONG.TIME_ATTACK_LOBBY);
    e.destroyTask(t);
    CHOICE_SCREENS[lobby.choice](ctx);
    return;
  }
  show(lobby);
}

// sub_806A5BC: the four texts, the marker beside the chosen one and the character, who goes on to the second animation
// once the first has ended
function show(lobby) {
  const { ctx } = lobby, e = ctx.engine, rom = e.rom, tables = lobby.tables;
  for (const s of lobby.texts) displaySprite(e, ctx.sprites, s);
  lobby.marker.y = lobby.choice * 16 + 25;
  displaySprite(e, ctx.sprites, lobby.marker);
  const s = lobby.figure;
  s.x = (lobby.x >> 8) + SCREEN_CENTRE;
  if (!updateSprite(e, ctx.sprites, s)) {
    s.graphics.anim = rom.u16(tables + FIGURE_ANIMS + ctx.character * 6 + 2);
    s.variant = rom.u8(tables + FIGURE_VARIANTS + ctx.character * 3 + 1);
    s.prevVariant = 0xFF;
  }
  displaySprite(e, ctx.sprites, s);
}

// the choices (gUnknown_0868B6C4): the act again, the character select, the course select, and the title screen
const CHOICE_SCREENS = [
  ctx => ctx.play(ctx.level),
  ctx => createCharacterSelect(ctx, ctx.character),
  ctx => createCourseSelect(ctx),
  ctx => ctx.title(true),
];

// TaskDestructor_806A698
function destroyed(t) {
  const lobby = t.data, e = lobby.ctx.engine;
  for (const s of lobby.texts) e.vramFree(s.graphics.dest);
  e.vramFree(lobby.marker.graphics.dest);
  e.vramFree(lobby.figure.graphics.dest);
}
