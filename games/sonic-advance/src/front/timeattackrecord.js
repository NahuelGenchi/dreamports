// The Time Attack records screen (SAT-R decompilation, src/game/sa1/ui/time_attack_record.c: CreateTimeAttackRecord and
// its tasks), which the course select shows for an act when the Time Attack menu asked for the records: the character's
// card over bands that slide to and fro, the zone's name and the act's, the course's name, and the character's three best
// times on the act. Left and Right change the character, wrapping round the four; B goes back to the course select.

import { createSprite, updateSprite, displaySprite, SPRITE } from '../gba/sprite.js';
import { REG } from '../../../../kit/gba/video.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, uiGfxStackInit, uiGraphics, loadUiGfx, drawUiGlyphs, createFade, fadeStep } from './ui.js';
import { createCourseSelect } from './courseselect.js';
import { put16 } from '../gba/lines.js';
import { KEY } from '../gba/engine.js';
import { timeCodes } from './timeattackcard.js';

const OBJ_VRAM = 0x10000;
const UIGFX_TIMER_DIGITS = 32, UIGFX_OPTIONS = 0x80;
const TIMES_PER_COURSE = 3, FIRST_FRAMES = 8;
// the USA ROM numbers the course's name (884 in the decompilation) 882; the cursor keeps its 857
const ANIM_NAME = 882, ANIM_CURSOR = 857;
// the tables in the ROM from `tables`: the zones' names and the acts' (an animation and its variant each), the cursor's
// eight offsets in turn, and the characters' names
const ZONES_AT = 0, ACTS_AT = 0x18, WOBBLE_AT = 0x20, NAMES_AT = 0x28;
// by character, the sizes of the card's back layer's tiles and of its front's (the layout of both is 0x500 bytes)
const BACK_SIZES = [0x1900, 0x1C40, 0x1800, 0x1880], FRONT_SIZES = [0x9C0, 0x680, 0x7C0, 0x4C0];
const MAP_SIZE = 0x500, PALETTE_SIZE = 0x200, CARD_SIZE = 16;
const NO_LAYOUT = { unk4: 0, unk8: 0, unk9: 0, unkA: 0, unkB: 0 };

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, oamFlags: 0, prevVariant: 0xFF, animSpeed: 0x10, frameFlags: 0x2000, ...fields });

// the card's two layers for `who`, as sub_8060C88 and sub_8061480 load them: the back, only this screen's, on layer 1,
// and the front, the one the card before the act has, on layer 0
function loadCard(ctx, who) {
  const e = ctx.engine, rom = e.rom, at = ctx.offsets.timeAttackRecord, front = ctx.offsets.timeAttackCards + who * 2 * CARD_SIZE;
  const [tiles, layout] = at.backs[who];
  loadUiGfx(e, { uiGfxID: UIGFX_OPTIONS, unk2B: 1, unk0: NO_LAYOUT, tiles, tilesSize: BACK_SIZES[who], layout, layoutSize: MAP_SIZE, unk29: 1, unk2A: 0x11 });
  loadUiGfx(e, {
    uiGfxID: UIGFX_OPTIONS, unk2B: 0, unk0: NO_LAYOUT, tiles: rom.requirePtr(front, 'card tiles'), tilesSize: FRONT_SIZES[who],
    palette: rom.requirePtr(front + 8, 'card colours'), paletteSize: PALETTE_SIZE, layout: rom.requirePtr(front + 12, 'card map'), layoutSize: MAP_SIZE,
    unk28: 0, unk29: 0, unk2A: 0x15,
  });
}

/** CreateTimeAttackRecord for the act `course` (the row's number less one). `ctx` is the course select's (engine, sprites, save, offsets). */
export function createTimeAttackRecord(ctx, course) {
  const e = ctx.engine, rom = e.rom, at = ctx.offsets.timeAttackRecord, tables = at.tables;
  createUiTask(e);
  e.dispCnt = 0x1340;
  e.playSong(SONG.VS_RECORD);
  e.bgCnt[0] = 0x1D83;
  e.bgCnt[1] = 0x1886;
  e.bgScroll.fill(0, 0, 4);
  // sub_8060C88
  uiGfxStackInit(e);
  loadCard(ctx, 0);
  const digits = uiGraphics(rom, ctx.offsets.uiGraphics, UIGFX_TIMER_DIGITS);
  loadUiGfx(e, { uiGfxID: UIGFX_TIMER_DIGITS, unk2B: 2, unk0: digits.unk0, tiles: digits.tiles, tilesSize: 0x580, palette: digits.palette, paletteSize: 0x20, unk28: 2, vramC: OBJ_VRAM + 0x20, unk2A: 0xD });

  const record = {
    ctx, at, course, frame: 0, wait: FIRST_FRAMES, leaving: false, shown: 0, previous: 0,   // unkD4, unkDE, unkDF, unkDC, unkDD
    fade: createFade(0, 1, 2, 0, 0x100, 8),
    text: { unk8: 0, unkA: 0, unkC: 0, unkE: 0, unk10: 2, unk12: 2, unk16: 1 },
  };
  record.task = e.createTask(run, record, 0x2000, 0, null);
  record.tasks = [];
  const zone = at.tables + ZONES_AT + (course >> 1) * 4, act = tables + ACTS_AT + (course & 1) * 4;
  record.sprites = [
    sprite(rom.u16(zone), OBJ_VRAM + 0xC80, { variant: rom.u16(zone + 2), x: 17, y: 24 }),
    sprite(rom.u16(act), OBJ_VRAM + 0x1900, { variant: rom.u16(act + 2), x: 85, y: 27 }),
    sprite(ANIM_NAME, OBJ_VRAM + 0x2580, { variant: 2, x: 21, y: 81 }),
  ];
  record.cursor = sprite(ANIM_CURSOR, OBJ_VRAM + 0x3200, { variant: 0, x: 20, y: 80 });
  for (const s of [...record.sprites, record.cursor]) updateSprite(e, ctx.sprites, s);
  record.tasks.push(e.createTask(showTimes, record, 0x2030, 0, null));
  record.name = sprite(0, OBJ_VRAM + 0x8E0, { variant: 8, x: 20, y: 61 });
  record.tasks.push(e.createTask(showName, record, 0x2080, 0, null));
  fadeStep(e, record.fade);
  e.playSongOrContinue(SONG.VS_RECORD);
}

// sub_8061144: the frame counter, Left and Right changing the character and B leaving; the bands; the sprites
function run(t) {
  const record = t.data, { ctx, fade } = record, e = ctx.engine;
  record.frame++;
  if (record.wait === 0 && !record.leaving) {
    if (e.repeated & KEY.RIGHT) {
      e.playSong(SONG.MENU_CURSOR);
      record.wait = 2;
      record.previous = record.shown;
      record.shown = (record.shown + 1) & 3;
    } else if (e.repeated & KEY.LEFT) {
      e.playSong(SONG.MENU_CURSOR);
      record.wait = 2;
      record.previous = record.shown;
      record.shown = (record.shown - 1) & 3;
    }
    if (e.pressed & KEY.B) {
      e.playSong(SONG.RETURN);
      record.leaving = true;
      fade.unk4 = 1;
      fade.unk6 = 0x2000 - (fade.unk6 & 0xFFFF);
    }
  } else if (record.wait !== 0) record.wait--;
  fadeStep(e, fade);
  if (record.leaving && fade.unk6 > 0x1800 && fade.unk4 === 1) {
    e.flags &= ~0x4;
    e.stopSong(SONG.VS_RECORD);
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    for (const task of record.tasks) e.destroyTask(task);
    e.destroyTask(t);
    createCourseSelect(ctx, true);
    return;
  }
  e.flags |= 0x4;
  e.setHBlankCopy(REG.BG0HOFS, 4);
  // bands of 24 lines, each way round in turn
  let offset = record.frame & 0xFFFF, line = 0;
  while (line < 160) {
    for (let i = 0; i < 24 && line < 160; i++, line++) {
      put16(e, e.primary + line * 4, offset & 0x1FF);
      put16(e, e.primary + line * 4 + 2, 0);
    }
    offset = -offset & 0xFFFF;
  }
  show(record);
}

// sub_80613D0: the zone's name and the act's, the course's, and the cursor either side, going in and out
function show(record) {
  const { ctx } = record, e = ctx.engine, rom = e.rom, tables = record.at.tables;
  for (const s of record.sprites) {
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
  const s = record.cursor;
  updateSprite(e, ctx.sprites, s);
  const offset = rom.u8(tables + WOBBLE_AT + (Math.trunc(record.frame / 10) & 0xFF) % 8);
  s.frameFlags |= SPRITE.X_FLIP;
  s.x = offset + 15;
  displaySprite(e, ctx.sprites, s);
  s.frameFlags &= ~SPRITE.X_FLIP;
  s.x = 240 - (offset + 15);
  displaySprite(e, ctx.sprites, s);
}

// the character whose card and times are up: the one before, for the first frame after Left or Right
const whoShows = record => (record.wait < 2 ? record.shown : record.previous);

// sub_8061480: once a change has been made, the new character's card; then the three times
function showTimes(t) {
  const record = t.data, { ctx } = record, e = ctx.engine, o = record.text, who = whoShows(record);
  if (record.wait === 1) {
    uiGfxStackInit(e);
    loadCard(ctx, record.shown);
  }
  for (let i = 0; i < TIMES_PER_COURSE; i++) {
    o.unkE = 1;
    o.unkA = 0x2C;
    o.unkC = (i << 4) + 92;
    drawUiGlyphs(e, () => 0x21 + i, o);
    o.unkE = 7;
    o.unkA = 0x54;
    o.unkC = (i << 4) + 92;
    const codes = timeCodes(ctx.save.timeRecord(who, record.course, i));
    drawUiGlyphs(e, j => codes[j], o);
  }
}

// Task_8061830: the character's name
function showName(t) {
  const record = t.data, { ctx } = record, e = ctx.engine, s = record.name, rom = e.rom;
  const at = record.at.tables + NAMES_AT + whoShows(record) * 4;
  s.graphics.anim = rom.u16(at);
  s.variant = rom.u16(at + 2);
  s.prevVariant = 0xFF;
  updateSprite(e, ctx.sprites, s);
  displaySprite(e, ctx.sprites, s);
}
