// The players' overview (SAT-R decompilation, src/game/sa1/stage/mp_unk_1.c: sub_801C9D8 and its tasks), after the VS character
// select: a strip for each GBA slides in from alternate sides with the character it picked and the player's name, holds for
// 60 frames, and the screen fades to white as the music stops. A Chao Hunt of two goes on to the stage choice (vschao.js),
// and three or four players choose first whether to play in teams (vsteams.js).

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { fillLines } from '../gba/lines.js';
import { FLAGS } from '../gba/engine.js';
import { createUiTask, uiGraphics, loadUiGfx, drawUiText } from './ui.js';
import { recordOf } from './lobby.js';
import { linkLost } from './heartbeat.js';

const TILEMAP = 88, OBJ_VRAM = 0x10000;
// the characters' idle animations (gPlayerCharacterIdleAnims)
const IDLE_ANIMS = [0, 99, 199, 298];
const UIGFX_FONT = 0, UIGFX_FONT_COLOURS = 60;
const STRIP = 40, PLAYERS_MAX = 4, HOLD = 60;
const NAME_X = 10, NAME_Y = 20, NAME_STEP = 8, NAME_CHARS = 6;
const CHAO_HUNT = 4;

/** sub_801C9D8. */
export function createVsOverview(ctx) {
  const e = ctx.engine, connections = ctx.vsLink.connections;
  e.winRegs.fill(0, 0, 6);
  e.dispCnt = 0x40;
  e.bgCnt[3] = 0x5E0B;
  e.bldCnt = 0;
  e.bldY = 0;
  ctx.missing.fill(0);
  e.mapFill[3].value = 0xFF;
  e.mapFill[3].rect.set([0, 0, 0xFF, 0x40]);
  e.video.vram.fill(0, 0xA000 - 0x20, 0xA000 + 0x20);
  let count = 0;
  while (count < PLAYERS_MAX && connections >> count & 1) count++;
  const screen = { ctx, count, top: count === 3 ? 0x14 : count === 2 ? 0x28 : 0, slide: 0, frame: 0 };   // unk432, qUnk430
  screen.sprites = IDLE_ANIMS.map((anim, i) => createSprite({
    graphics: { src: 0, dest: OBJ_VRAM + (i << 11), size: 0, anim }, x: 120, y: 20 + i * 0x28, oamFlags: 0x400, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0x1000,
  }));
  e.createTask(slideIn, screen, 0x2000);
  drawBackground(e, ctx.tilemaps, createBackground({ graphics: { src: 0, dest: 0x8000, size: 0, anim: 0 }, layoutVram: 0xF000, tilemapId: TILEMAP, targetTilesX: 30, targetTilesY: 20, flags: 3 }));
  for (const s of screen.sprites) updateSprite(e, ctx.sprites, s);
  createUiTask(e);
}

// the picture seen through each strip: it slides in along the strip's line
function strips(screen, slide) {
  const { ctx, count, top } = screen, e = ctx.engine;
  if (top !== 0) fillLines(e, 3, 0, top, 240, 0);
  for (let i = 0; i < count; i++) fillLines(e, 3, top + i * STRIP, top + (i + 1) * STRIP, slide(i), -top & 0xFF);
  if (top !== 0) fillLines(e, 3, (top + count * STRIP) & 0xFF, 160, 240, 0);
}

// Task_801CB80: each strip slides in, the first from the left and the next from the right, four pixels a frame
function slideIn(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  e.dispCnt |= 0x1800;
  if (linkLost(ctx)) return;
  screen.slide += 0x400;
  if (screen.slide > 240 << 8) {
    screen.slide = 0;
    makeNames(screen);
    t.main = hold;
    hold(t);
    return;
  }
  strips(screen, i => (i & 1 ? 240 - (screen.slide >> 8) : (screen.slide >> 8) - 240));
}

// sub_801D0CC: the names' glyphs, with the UI font's colours, over the strips
function makeNames(screen) {
  const { ctx } = screen, e = ctx.engine, offsets = ctx.offsets;
  const font = uiGraphics(e.rom, offsets.uiGraphics, UIGFX_FONT), colours = uiGraphics(e.rom, offsets.uiGraphics, UIGFX_FONT_COLOURS);
  const vramC = e.vramMalloc(0xE0);
  loadUiGfx(e, { uiGfxID: UIGFX_FONT, unk2B: 1, unk0: font.unk0, tiles: font.tiles, tilesSize: 0x1C00, palette: colours.palette, paletteSize: 0x20, unk28: 4, vramC, unk2A: 0xD });
  const overBs = Array.from({ length: PLAYERS_MAX }, () => ({ unkA: NAME_X, unkC: NAME_Y, unkE: 1, unk10: 1, unk12: 4, unk16: 1, unk8: 0 }));
  e.createTask(drawNames, { overBs }, 0x2200, 0, () => e.vramFree(vramC));
}

// Task_801D200
function drawNames(t) {
  const screen = t.parent.data, { ctx, count, top } = screen, e = ctx.engine;
  for (let i = 0; i < count; i++) {
    const o = t.data.overBs[i], name = i === ctx.id ? ctx.save.playerName : recordOf(ctx, i)?.subarray(4, 12) ?? new Uint8Array(8);
    for (let c = 0; c < NAME_CHARS; c++) {
      o.unkA = c * NAME_STEP + NAME_X;
      o.unkC = i * STRIP + NAME_Y + top;
      if (((name[c] - 0x70) & 0xFF) < 26) o.unkC += 8;
      drawUiText(e, () => name[c], o);
    }
  }
}

// sub_801CF08: the strips in place, each with its character
function stay(screen) {
  const { ctx, count, top } = screen, e = ctx.engine;
  if (linkLost(ctx)) return;
  if (top !== 0) fillLines(e, 3, 0, top, 240, 0);
  let i = 0;
  for (; i < PLAYERS_MAX && ctx.vsLink.connections >> i & 1; i++) {
    fillLines(e, 3, top + i * STRIP, top + (i + 1) * STRIP, 0, -top & 0xFF);
    const s = screen.sprites[ctx.vsLink.characters[i]];
    s.x = 120;
    s.y = i * STRIP + 20 + top;
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
  if (top !== 0) fillLines(e, 3, top + i * STRIP, 0xA0, 240, 0);
}

// Task_801D34C: they stay for 60 frames, and then the screen fades to white
function hold(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  if (screen.slide++ > HOLD) {
    screen.slide = 0;
    e.bldCnt = 0xFF;
    // m4aMPlayFadeOut with a speed of 0 on the music and the three effect players starts no fade
    t.main = fadeOut;
    fadeOut(t);
  } else stay(screen);
}

// Task_801CD80: white at two units a frame, and the screen after
function fadeOut(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.slide += 0x200;
  if (screen.slide > 0x1000) {
    e.bldY = 0x10;
    e.flags &= ~FLAGS.HBLANK_COPY;
    e.destroyTasks();
    e.clearQueues();
    // Race and Chao Hunt: two players go on to the stage choice, three or four choose teams first. Only the Chao Hunt can be chosen here
    if (screen.count < 3) ctx.vsChaoSelect();
    else ctx.vsTeams();
  } else {
    stay(screen);
    e.bldY = screen.slide >> 8;
  }
}
