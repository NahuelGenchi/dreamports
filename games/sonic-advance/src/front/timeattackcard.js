// The card before a Time Attack run (SAT-R decompilation, src/game/sa1/ui/time_attack_records.c:
// CreateTimeAttackRecords and its task): the course select's A on an act shows the character's card over bands that
// slide to and fro, the zone's name and the act's, the course's name rolling along under them, and the character's three best
// times there, for 240 frames, the music of the course select still playing. A or B cut it short, to the frame
// before it fades out. The act starts as the card ends.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { REG } from '../../../../kit/gba/video.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, uiGfxStackInit, uiGraphics, loadUiGfx, drawUiText, createFade, fadeStep } from './ui.js';
import { put16 } from '../gba/lines.js';
import { KEY } from '../gba/engine.js';

const OBJ_VRAM = 0x10000;
const UIGFX_TIMER_DIGITS = 32, UIGFX_OPTIONS = 0x80;
const CARD_SIZE = 16, TIMES_PER_COURSE = 3, MAX_COURSE_TIME = 10 * 3600;
// the table of cards (gCharacterCards): by character a front picture (layer 0) and a back one (layer 1), each with its
// tiles, their size, colours and map; the zones' names, the acts' and the courses', each with the room its tiles take in
// sprite memory, its animation and its variant (gUnknown_0868B814, 0868B838, 0868B844)
const ZONES_AT = 0x80, ACTS_AT = 0xA4, COURSES_AT = 0xB0, COURSES_PER_LANGUAGE = 12;
const SPRITE_FLAGS = { oamFlags: 0x480, frameFlags: 0x2000, animSpeed: 0x10, prevVariant: 0xFF };
const COLON = 0x2A, NINE = 0x29, FIVE = 0x25, ZERO = 0x20;
const FIRST_FRAMES = 0x20, LAST_FRAMES = 0xCF, FADE_AT = 0xD0, END_AT = 0xF0;

const div = (a, b) => Math.trunc(a / b);

/**
 * sub_806A02C and sub_806BDC4: the seven characters of a time, M:SS:CC, as the UI font has them (the digits start at
 * 0x20, the colon is 0x2A); 10:00 and over, which no run has set, reads 9:59:99.
 */
export function timeCodes(time) {
  if (time >= MAX_COURSE_TIME) return [NINE, COLON, FIVE, NINE, COLON, NINE, NINE];
  const seconds = div(time, 60), minutes = div(seconds, 60), second = seconds - minutes * 60;
  const hundredths = Math.floor((time - seconds * 60) * 100 / 60 + 0.5);   // gMillisUnpackTable
  return [ZERO + minutes, COLON, ZERO + div(second, 10), ZERO + (second % 10), COLON, ZERO + div(hundredths, 10), ZERO + (hundredths % 10)];
}

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, ...SPRITE_FLAGS, ...fields });

/** The sprite of a table's row at `at` (its room, animation and variant), and the room taken in sprite memory for it. */
export function tableSprite(e, at, fields) {
  const rom = e.rom;
  return sprite(rom.u16(at + 2), e.vramMalloc(rom.u16(at)), { variant: rom.u16(at + 4), ...fields });
}

/** TimeAttackRecordsInitUI: the digits' tiles in sprite memory at `vram`, and the character's two cards. */
function loadGraphics(ctx, vram) {
  const { offsets, character } = ctx, e = ctx.engine, rom = e.rom;
  const gfx = uiGraphics(rom, offsets.uiGraphics, UIGFX_TIMER_DIGITS);
  loadUiGfx(e, { uiGfxID: UIGFX_TIMER_DIGITS, unk2B: 1, unk0: gfx.unk0, tiles: gfx.tiles, tilesSize: 0x580, palette: gfx.palette, paletteSize: 0x20, unk28: 6, vramC: vram, unk2A: 0xD });
  const card = layer => {
    const at = offsets.timeAttackCards + (character * 2 + layer) * CARD_SIZE;
    return { tiles: rom.requirePtr(at, 'card tiles'), tilesSize: rom.u32(at + 4), palette: rom.requirePtr(at + 8, 'card colours'), layout: rom.requirePtr(at + 12, 'card map') };
  };
  const back = card(1), front = card(0);
  loadUiGfx(e, { uiGfxID: UIGFX_OPTIONS, unk2B: 0, unk0: gfx.unk0, ...back, paletteSize: 0x200, layoutSize: 0x600, unk28: 0, unk29: 1, unk2A: 0x11 });
  loadUiGfx(e, { uiGfxID: UIGFX_OPTIONS, unk2B: 2, unk0: gfx.unk0, ...front, paletteSize: 0x200, layoutSize: 0x600, unk28: 0, unk29: 0, unk2A: 0x15 });
}

/**
 * CreateTimeAttackRecords. `ctx` has the engine, the sprite tables, the save, the ROM's offsets (`uiGraphics`,
 * `timeAttackCards`), `character`, `level` (the act's, gCurrentLevel) and `play(level)`, which starts the act.
 */
export function createTimeAttackCard(ctx) {
  const e = ctx.engine, rom = e.rom, { offsets, character, level, save } = ctx;
  createUiTask(e);
  uiGfxStackInit(e);
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1E83;
  e.bgCnt[1] = 0x1C86;
  e.bgScroll.fill(0, 0, 4);
  const vram = e.vramMalloc(44);
  loadGraphics(ctx, vram);

  const at = offsets.timeAttackCards;
  const card = {
    ctx, vram, frame: 0, scroll: 0, y: -90 * 0x100,   // unk104, unk108, qUnkY
    ranks: [0x21, 0x22, 0x23],
    times: [0, 1, 2].map(rank => timeCodes(save.timeRecord(character, level, rank))),
    fade: createFade(0, 1, 2, 0, 0x100, 0x10),
    text: { unk8: 0x18, unkA: 0xF0, unkC: 0x8C, unkE: 8, unk10: 1, unk12: 6, unk16: 1 },
  };
  card.task = e.createTask(run, card, 0x2000, 0, destroyed);
  const zone = level >> 1, act = level & 1;
  card.sprites = [
    tableSprite(e, at + ZONES_AT + zone * 6, { x: 25, y: 24 }),
    tableSprite(e, at + ACTS_AT + act * 6, { x: 93, y: 27 }),
    sprite(rom.u16(at + ACTS_AT + 2), e.vramMalloc(0xC), { variant: 2, x: 25, y: 80 }),
  ];
  card.name = tableSprite(e, at + COURSES_AT + (save.uiLanguage * COURSES_PER_LANGUAGE + level) * 6, { x: -90, y: 48 });
  for (const s of [...card.sprites, card.name]) updateSprite(e, ctx.sprites, s);
  fadeStep(e, card.fade);
  e.playSongOrContinue(SONG.COURSE_SELECTION);
}

// Task_806BBC0: a frame; at its 241st the card goes and the act starts
function run(t) {
  const card = t.data, { ctx, fade } = card, e = ctx.engine;
  let frame = card.frame + 1;
  card.scroll++;
  if (frame > END_AT) {
    e.flags &= ~0x4;
    e.stopSong(SONG.COURSE_SELECTION);
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    e.destroyTask(t);
    ctx.play(ctx.level);
    return;
  }
  if (frame === FADE_AT) {
    fade.unk4 = 1;
    fade.unk6 = 0;
  } else if (e.pressed & (KEY.A | KEY.B) && frame > FIRST_FRAMES && frame <= LAST_FRAMES) frame = LAST_FRAMES;
  e.setHBlankCopy(REG.BG0HOFS, 4);
  // bands of 24 lines, each way round in turn
  let offset = card.scroll & 0xFF, line = 0;
  while (line < 160) {
    for (let i = 0; i < 24 && line < 160; i++, line++) {
      put16(e, e.primary + line * 4, offset & 0x1FF);
      put16(e, e.primary + line * 4 + 2, 0);
    }
    offset = -offset & 0xFFFF;
  }
  card.frame = frame;
  fadeStep(e, fade);
  card.y -= 2 * 0x100;
  if (card.y < -200 * 0x100) card.y += 200 * 0x100;
  show(card);
}

// sub_806BD24: the three sprites, the course's name rolling along, and the records' lines
function show(card) {
  const { ctx } = card, e = ctx.engine, o = card.text;
  for (const s of card.sprites) displaySprite(e, ctx.sprites, s);
  const s = card.name;
  s.x = card.y >> 8;
  while (s.x < 500) {
    displaySprite(e, ctx.sprites, s);
    s.x += 200;
  }
  for (let i = 0; i < TIMES_PER_COURSE; i++) {
    o.unkE = 1;
    o.unkA = 0x2C;
    o.unkC = i * 0x10 + 0x5C;
    drawUiText(e, () => card.ranks[i], o);
    o.unkE = 7;
    o.unkA = 0x50;
    drawUiText(e, j => card.times[i][j], o);
  }
}

// TaskDestructor_806BF38
function destroyed(t) {
  const card = t.data, e = card.ctx.engine;
  for (const s of [...card.sprites, card.name]) e.vramFree(s.graphics.dest);
  e.vramFree(card.vram);
}
