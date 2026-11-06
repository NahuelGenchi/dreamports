// The VS lobby (SAT-R decompilation, src/game/sa1/multiplayer/chao_message.c: CreateMultiplayerResultsScreen, with the
// modes that need no round before them): once the GBAs are linked, a strip for each player slides in from alternate
// sides, out of white, with a Chao and a message for how the player stands against the others, and the player's name.
// Mode 0, the lobby, plays its song, holds the strips for 240 frames (a sound 45 frames in) and slides them out, and
// the game choice follows (gameselect.js). Mode 2, a link that was closed, does the same and goes to the title screen.
//
// Each Chao and message is a task of its own, and the names another, all children of the screen's task.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { fillLines } from '../gba/lines.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, uiGfxStackInit, uiGraphics, loadUiGfx, drawUiText } from './ui.js';

// the USA copy's numbers (from 883 on the decompilation's are 2 higher): the Chao and the messages in English and Japanese,
// the player rows' tilemap, and the colours the names take from the UI graphics
const ANIM_AVATAR = 885, ANIM_MESSAGE = [897, 883], TILEMAP = 88;
const UIGFX_FONT = 0, UIGFX_FONT_COLOURS = 60;
const STRIP = 0x28, BACKGROUND_COLOUR = 0x7B60, HOLD = 240, SOUND_AT = 0x2D;
const SLIDE = 0x10, PLAYERS_MAX = 4;
const NAME_X = 10, NAME_Y = 0x14, NAME_STEP = 8, NAME_CHARS = 6;
const s16 = v => (v << 16) >> 16;

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0x3000, oamFlags: 0x400, ...fields });

// the record of the player in GBA `i`'s place, in the save: its wins, losses and name, or null
export function recordOf(ctx, i) {
  const at = ctx.vsLink?.records[i] ?? 0xFF;
  return at < 10 ? ctx.save.multiplayerScores.subarray(at * 16, at * 16 + 16) : null;
}

// sub_803AB60, for the modes with no round: each strip's Chao and message
function variantsOf(screen) {
  const { ctx, mode, count } = screen, id = ctx.id, v = new Uint8Array(PLAYERS_MAX);
  if (mode === 2) {
    v.fill(5, 0, count);
    return v;
  }
  let better = 0, worse = 0;
  for (let i = 0; i < count; i++) {
    if (i === id) continue;
    const r = recordOf(ctx, i), wins = r ? r[12] : 0, losses = r ? r[13] : 0;
    if (wins > losses) { v[i] = 6; better++; } else if (wins < losses) { v[i] = 1; worse++; } else v[i] = 0;
  }
  v[id] = better > worse ? 1 : better < worse ? 6 : 0;
  return v;
}

/** CreateMultiplayerResultsScreen: `mode` 0 for the lobby, 2 for a closed link. */
export function createLobby(ctx, mode = 0) {
  const e = ctx.engine, connections = ctx.vsLink?.connections ?? 1;
  ctx.missing.fill(0);
  let count = 0;
  for (let i = 0; i < PLAYERS_MAX; i++) count += connections >> i & 1;
  const screen = { ctx, mode, count, top: count === 2 ? 0x28 : count === 3 ? 0x14 : 0, slide: [-240, 240, -240, 240], frame: 0 };   // unk54, unk50, unk48, unk52
  screen.variants = variantsOf(screen);
  e.createTask(init, screen, 0x2000);
  e.dispCnt = 0x3140;
  e.bgCnt[0] = 0x4803;
  e.bgScroll[0] = 256;
  e.bgScroll[1] = 0;
  e.winRegs[0] = (0 << 8) | 240;
  e.winRegs[2] = (0 << 8) | 160;
  e.winRegs[4] = 0x31;
  e.winRegs[5] = 0x31;
  e.bldCnt = 0xBF;
  e.bldY = 0x10;
  e.video.vram.fill(0, 0x1FE0, 0x2020);
  e.mapFill[0].value = 0xFF;
  e.mapFill[0].rect.set([0, 0, 0xFF, 0x40]);
  drawBackground(e, ctx.tilemaps, createBackground({ graphics: { src: 0, dest: 0, size: 0, anim: 0xFF }, layoutVram: 0x4000, tilemapId: TILEMAP, targetTilesX: 30, targetTilesY: 20 }));
  e.bgPalette[0] = BACKGROUND_COLOUR;
  e.flags |= 0x1;
  if (mode === 0) e.playSong(SONG.VS_LOBBY);
  else e.playSong(SONG.CONNECTION_CLOSED);
}

// LINK_HEARTBEAT: a GBA of the round not heard from for too long is a lost link; true when it was
function lost(screen) {
  const { ctx } = screen, e = ctx.engine, view = ctx.link.view(ctx.id), connections = ctx.vsLink?.connections ?? 1;
  for (let i = 0; i < PLAYERS_MAX && connections >> i & 1; i++) {
    if (!(view.flags & (1 << i))) {
      if (ctx.missing[i]++ > 180) {
        e.destroyTasks();
        e.clearQueues();
        ctx.linkError();
        return true;
      }
    } else ctx.missing[i] = 0;
  }
  return false;
}

// Task_ChaoMessageInit: the Chao, the messages and the names, and then the strips slide in
function init(t) {
  const screen = t.data, { ctx, count } = screen, e = ctx.engine, lang = ctx.save.uiLanguage;
  if (lost(screen)) return;
  for (let i = 0; i < count; i++) {
    for (const [x, y, anim, variant, tiles] of [[0x2D, i * STRIP + 2, ANIM_AVATAR, screen.variants[i], 40], [0xA9, i * STRIP + 0x14, ANIM_MESSAGE[lang === 0 ? 0 : 1], screen.variants[i], 26]]) {
      const s = sprite(anim, e.vramMalloc(tiles), { variant });
      e.createTask(moveSprite, { s, x, y, i }, 0x2100, 0, task => e.vramFree(task.data.s.graphics.dest));
    }
  }
  createUiTask(e);
  makeNames(screen);
  screen.frame = 0;
  t.main = slideIn;
  slideIn(t);
}

// Task_803C130: a Chao or a message with its strip
function moveSprite(t) {
  const { s, x, y, i } = t.data, screen = t.parent.data, { ctx } = screen, e = ctx.engine;
  s.x = x + s16(screen.slide[i]);
  s.y = y + screen.top;
  updateSprite(e, ctx.sprites, s);
  displaySprite(e, ctx.sprites, s);
}

// sub_803BEB8: the names' glyphs, with the UI font's colours
function makeNames(screen) {
  const { ctx } = screen, e = ctx.engine, offsets = ctx.offsets;
  const font = uiGraphics(e.rom, offsets.uiGraphics, UIGFX_FONT), colours = uiGraphics(e.rom, offsets.uiGraphics, UIGFX_FONT_COLOURS);
  const vramC = e.vramMalloc(0xE0);
  uiGfxStackInit(e);
  loadUiGfx(e, { uiGfxID: UIGFX_FONT, unk2B: 1, unk0: font.unk0, tiles: font.tiles, tilesSize: 0x1C00, palette: colours.palette, paletteSize: 0x20, unk28: 1, vramC, unk2A: 0xD });
  e.createTask(drawNames, { o: { unk8: 0, unkA: 0, unkC: 0, unkE: 1, unk10: 1, unk12: 1, unk16: 1 } }, 0x2200, 0, () => e.vramFree(vramC));
}

// sub_803BFE8: each player's name, a glyph at a time
function drawNames(t) {
  const screen = t.parent.data, { ctx, count } = screen, e = ctx.engine, o = t.data.o;
  for (let i = 0; i < count; i++) {
    const name = i === ctx.id ? ctx.save.playerName : recordOf(ctx, i)?.subarray(4, 12) ?? new Uint8Array(8);
    for (let c = 0; c < NAME_CHARS; c++) {
      o.unkA = s16(screen.slide[i]) + NAME_X + c * NAME_STEP;
      o.unkC = screen.top + i * STRIP + NAME_Y;
      if (((name[c] - 0x70) & 0xFF) < 26) o.unkC += 8;
      drawUiText(e, () => name[c], o);
    }
  }
}

// sub_803BE0C: the picture seen through each strip, at its own place
function showStrips(screen) {
  const e = screen.ctx.engine;
  let y = screen.top;
  if (screen.top !== 0) fillLines(e, 0, 0, y, 240, 0);
  for (let i = 0; i < screen.count; i++) {
    fillLines(e, 0, y, y + STRIP, ~screen.slide[i] & 0x1FF, -screen.top);
    y += STRIP;
  }
  if (y < 160) fillLines(e, 0, y, 160, 240, 0);
}

// Task_803B7AC: the strips slide in one after the other, out of white
function slideIn(t) {
  const screen = t.data, { ctx, count, slide } = screen, e = ctx.engine;
  if (lost(screen)) return;
  const f = ++screen.frame;
  let done = 0;
  const move = (i, toward, step) => { if (slide[i] !== 0) slide[i] = s16(slide[i] + step); else done++; };
  switch (count) {
    case 4:
      if (f >= 0x10) move(3, 0, -SLIDE);
    // falls through
    case 3:
      if (f > 0xA) move(2, 0, SLIDE);
    // falls through
    case 2:
      if (f > 5) move(1, 0, -SLIDE);
      if (f !== 0) move(0, 0, SLIDE);
      break;
    default:
      break;
  }
  if (done === count) t.main = hold;
  if (e.bldY !== 0) e.bldY--;
  showStrips(screen);
}

// sub_803B944: the strips stay for 240 frames
function hold(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  if (lost(screen)) return;
  if (++screen.frame >= HOLD) {
    t.main = slideOut;
    screen.frame = 0;
  }
  if (screen.frame === SOUND_AT) e.playSong(screen.mode === 0 ? SONG.VS_LOBBY_HELLO : SONG.VS_LOBBY_CLOSED);
  showStrips(screen);
}

// sub_803BAD4: and slide out again, the other way round
function slideOut(t) {
  const screen = t.data, { count, slide } = screen;
  if (lost(screen)) return;
  const f = ++screen.frame;
  let done = 0;
  const move = (i, target, step) => { if (slide[i] !== target) slide[i] = s16(slide[i] + step); else done++; };
  switch (count) {
    case 4:
      if (f !== 0) move(3, 240, SLIDE);
    // falls through
    case 3:
      if (f > 5) move(2, -240, -SLIDE);
    // falls through
    case 2:
      if (f > 10) move(1, 240, SLIDE);
      if (f >= 0x10) move(0, -240, -SLIDE);
      break;
    default:
      break;
  }
  if (done === count) t.main = fadeOut;
  showStrips(screen);
}

// sub_803BC64: white again, and the screen after
function fadeOut(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  if ((e.bldY & 0x1F) < 0x10) {
    e.bldY++;
    showStrips(screen);
    return;
  }
  e.destroyTasks();
  e.clearQueues();
  if (screen.mode === 0) ctx.gameSelect();
  else {
    // MultiSioStop and MultiSioInit(0)
    ctx.link.enable(ctx.id, false);
    ctx.link.send(ctx.id).kind = 0;
    ctx.title(true);
  }
}
