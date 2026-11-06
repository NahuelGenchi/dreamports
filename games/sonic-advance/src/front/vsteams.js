// The VS play choice for three or four players (SAT-R decompilation, src/game/sa1/stage/mp_results_b.c: sub_8018AE0 and
// Task_8018ECC): after the overview, each player against all the others or the players in two teams. The first GBA, the
// parent, picks with Left and Right and A, and the others wait with a "please wait" text in the middle. The pick shows on a
// marker over the two texts, with two pictures turning behind. All against all (the right one, as the screen starts) goes on
// to the Chao Hunt stage choice (vschao.js). The teams (the original's GAME_MODE 5 and its choice of who is in which) are not
// built, so A on them does nothing, as on Race in the game choice (gameselect.js).
//
// The GBAs tell each other over the link: the parent sends 0x34 with the pick, and 0x35 once every other GBA has answered and
// it presses A; the others follow the pick and, on 0x35, go on.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { KEY } from '../gba/engine.js';
import { SINE } from '../engine/trig.js';
import { SONG } from '../sound/songs.js';
import { linkLost } from './heartbeat.js';

// the USA copy's numbers (from 883 on the decompilation's are 2 higher): the texts' band, the bar (860), the messages
// (variants 2 and 3, the two picks), the marker (858) and the waiting text (903)
const ANIM_TEXTS = 892, ANIM_BAR = 860, ANIM_MESSAGES = 889, ANIM_MARKER = 858, ANIM_WAIT = 903;
const OBJ_VRAM = 0x10000;
const PLAYERS_MAX = 4;
const CHOOSING = 0x34, CHOSEN = 0x35;
const TILEMAPS = [81, 82];
const CHAO_HUNT = 4;   // gGameMode
const s16 = v => (v << 16) >> 16;

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0, ...fields });

/** sub_8018AE0. */
export function createVsTeams(ctx) {
  const e = ctx.engine;
  ctx.missing.fill(0);
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1E03;
  e.bgCnt[1] = 0x1F06;
  const screen = {
    ctx, frame: 0, speed: 0, angle: 0, band: 0, pick: 1, chosen: 0,   // unk234, unk236, unk238, unk230, unk246, unk247
    scroll: [0, 0],   // unk23E, unk240
    s: sprite(ANIM_TEXTS, OBJ_VRAM, { x: 0, y: 0x19, oamFlags: 15 << 6, variant: 2 }),
    bar: sprite(ANIM_BAR, OBJ_VRAM + 0x340, { x: 0, y: 0xE, oamFlags: 0x400, prevVariant: -1 }),
    messages: [
      sprite(ANIM_MESSAGES, OBJ_VRAM + 0x4C0, { x: 0x35, y: 0x58, oamFlags: 0x400, variant: 2, prevVariant: -1 }),
      sprite(ANIM_MESSAGES, OBJ_VRAM + 0x640, { x: 0xB7, y: 0x58, oamFlags: 0x400, variant: 3, prevVariant: -1 }),
      sprite(ANIM_MARKER, OBJ_VRAM + 0x740, { x: 25, y: 73, oamFlags: 0x400, prevVariant: -1 }),
    ],
    wait: sprite(ANIM_WAIT, OBJ_VRAM + 0xAC0, { x: 120, y: 80, oamFlags: 0x80, prevVariant: -1, frameFlags: 0x2000 }),
  };
  e.createTask(choose, screen, 0x2000);
  for (const s of [screen.s, screen.bar, ...screen.messages, screen.wait]) updateSprite(e, ctx.sprites, s);
  drawBackground(e, ctx.tilemaps, createBackground({ layoutVram: 0xF000, tilemapId: TILEMAPS[0], targetTilesX: 30, targetTilesY: 20 }));
  drawBackground(e, ctx.tilemaps, createBackground({ graphics: { src: 0, dest: 0x4000, size: 0, anim: 0 }, layoutVram: 0xF800, tilemapId: TILEMAPS[1], targetTilesX: 32, targetTilesY: 32, flags: 1 }));
  e.playSongOrChange(SONG.CHARACTER_SELECTION);
  e.repeated = 0;
  e.pressed = 0;
  e.keys = 0;
  e.winRegs[5] = 0x3F;
  e.bldCnt = 0x3F46;
  e.bldAlpha = 0xA10;
  e.winRegs[2] = 0xA0;
}

// Task_8018ECC
function choose(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx, view = link.view(id), flags = view.flags;
  const connections = ctx.vsLink.connections;
  screen.frame++;
  if (linkLost(ctx)) return;

  const parent = view.slot(0), kind = parent?.kind ?? 0, shown = parent?.bytes[2];
  const send = link.send(id);
  if (kind === CHOOSING) {
    if (screen.pick !== shown) {
      e.playSong(SONG.MENU_CURSOR);
      if (!(flags & 0x80)) screen.pick = shown;
    }
  } else if (kind === CHOSEN) {
    let everyone = true;
    if (flags & 0x80) {
      for (let i = 1; i < PLAYERS_MAX; i++) {
        if (!(connections >> i & 1)) break;
        if ((view.slot(i)?.kind ?? 0) < CHOSEN) everyone = false;
      }
    } else send.kind = kind;
    if (everyone) {
      if (screen.pick !== shown) {
        e.playSong(SONG.MENU_CURSOR);
        screen.pick = shown;
      }
      e.playSong(SONG.SELECT);
      // the Chao Hunt stage choice (sub_8062F90); the teams aren't in the game yet, so A on them does nothing
      ctx.gameMode = CHAO_HUNT;
      e.destroyTask(t);
      ctx.vsChaoSelect();
      return;
    }
  } else if (kind > CHOSEN) {
    e.destroyTasks();
    e.clearQueues();
    ctx.linkError();
    return;
  }

  if (flags & 0x80) {
    send.kind = CHOOSING;
    if (!screen.chosen) {
      if (e.keys & KEY.RIGHT) screen.pick = 1;
      else if (e.keys & KEY.LEFT) screen.pick = 0;
    }
    send.bytes[2] = screen.pick;
    let everyone = true;
    for (let i = 1; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) break;
      if ((view.slot(i)?.kind ?? 0) < CHOOSING) everyone = false;
    }
    if ((everyone && (e.pressed & KEY.A) && screen.pick === 1) || screen.chosen) {
      send.kind = CHOSEN;
      send.bytes[2] = screen.pick;
      screen.chosen = 1;
    }
  } else {
    send.kind = CHOOSING;
    updateSprite(e, ctx.sprites, screen.wait);
    displaySprite(e, ctx.sprites, screen.wait);
  }

  // the marker under the pick, and the two pictures behind turning one way or the other with it
  screen.messages[2].x = screen.pick * 0x83 + 0x19;
  screen.speed = Math.min(screen.speed + 0x10, 0x400);
  screen.angle = (screen.angle + (screen.pick === 0 ? 1 : -1)) & 0x3FF;
  const dx = (screen.speed * (SINE[screen.angle + 256] >> 6)) >> 8, dy = (screen.speed * (SINE[screen.angle] >> 6)) >> 8;
  screen.scroll[0] = (screen.scroll[0] + dx) & 0xFFFF;
  screen.scroll[1] = (screen.scroll[1] + dy) & 0xFFFF;
  e.bgScroll[2] = s16(screen.scroll[0]) >> 8;
  e.bgScroll[3] = s16(screen.scroll[1]) >> 8;

  // the band of texts runs across, half a pixel a frame
  screen.band += 0x80;
  if (screen.band > 136 << 8) screen.band -= 136 << 8;
  for (let x = s16(-screen.band >> 8); x < 240; x += 136) {
    screen.s.x = x;
    displaySprite(e, ctx.sprites, screen.s);
  }
  for (const s of screen.messages) {
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
  for (let i = 0; i < 8; i++) {
    screen.bar.x = i * 32;
    displaySprite(e, ctx.sprites, screen.bar);
  }
}
