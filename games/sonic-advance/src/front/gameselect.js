// The VS game choice (SAT-R decompilation, src/game/sa1/stage/mp_results.c: sub_8018538 and Task_801874C): after the lobby,
// the first GBA, the parent, picks Race or Chao Hunt with Up and Down and A, and the others wait with a "please wait" text
// in the middle. The chosen row has a bar behind it and a band of texts running across it. The GBAs tell each other over the
// link: the parent sends 0x30 with the row it is on, and 0x31 once every other GBA has answered 0x30 and it presses A; the
// others follow whatever row the parent shows and, on 0x31, go on to the character select.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';

// the USA copy's numbers (from 883 on the decompilation's are 2 higher): the texts in Japanese and English (895 and 894 in
// the decompilation), the bar (860) and the waiting text (905); and the band's widths, from the table at 0x080B8494
// (gUnknown_080BB48C): for each language the width of the band of the Race row and of the Chao Hunt row
const ANIM_TEXTS = [893, 892], ANIM_BAR = 860, ANIM_WAIT = 903;
const BAND_WIDTH = [[56, 92], [64, 104]];
const TILEMAP = 84;
const OBJ_VRAM = 0x10000;
const PLAYERS_MAX = 4, HEARTBEATS = 0xB5;
const CHOOSING = 0x30, CHOSEN = 0x31;

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0x2000, ...fields });

/** sub_8018538. */
export function createGameSelect(ctx) {
  const e = ctx.engine, lang = ctx.save.uiLanguage;
  ctx.missing.fill(0);
  e.dispCnt = 0x1141;
  e.bgCnt[0] = 0x1E03;
  e.bldCnt = 0;
  e.bldY = 0;
  const screen = {
    ctx, mode: 0, qBand: 0, chosen: 0,   // unk203, unk1FC, unk213
    s: sprite(ANIM_TEXTS[lang], OBJ_VRAM, { x: 232, y: 64, oamFlags: 0x3C0 }),
    bar: sprite(ANIM_BAR, OBJ_VRAM + 0x2C0, { x: 0, y: 64, oamFlags: 0x400 }),
    wait: sprite(ANIM_WAIT, OBJ_VRAM + 0x2C0 + 0x180, { x: 120, y: 80, oamFlags: 0x80 }),
  };
  e.createTask(choose, screen, 0x2000);
  for (const s of [screen.s, screen.bar, screen.wait]) updateSprite(e, ctx.sprites, s);
  drawBackground(e, ctx.tilemaps, createBackground({ layoutVram: 0xF000, tilemapId: TILEMAP + lang, targetTilesX: 30, targetTilesY: 20 }));
  e.playSongOrChange(SONG.VS_LOBBY);
}

// Task_801874C
function choose(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx, view = link.view(id), flags = view.flags;
  const connections = ctx.vsLink?.connections ?? 1;
  for (let i = 0; i < PLAYERS_MAX; i++) {
    if (!(connections >> i & 1)) break;
    if (!(flags & (1 << i))) {
      if (ctx.missing[i]++ >= HEARTBEATS) {
        e.destroyTasks();
        e.clearQueues();
        ctx.linkError();
        return;
      }
    } else ctx.missing[i] = 0;
  }

  const parent = view.slot(0), kind = parent?.kind ?? 0, shown = parent?.bytes[2];
  if (kind === CHOOSING) {
    if (screen.mode !== shown) {
      e.playSong(SONG.MENU_CURSOR);
      if (!(flags & 0x80)) screen.mode = shown;
    }
  } else if (kind === CHOSEN) {
    if (screen.mode !== shown) {
      e.playSong(SONG.MENU_CURSOR);
      screen.mode = shown;
    }
    e.playSong(SONG.SELECT);
    // GAME_MODE_RACE or GAME_MODE_CHAO_HUNT, and the character select
    ctx.gameMode = screen.mode === 0 ? 2 : 4;
    e.destroyTask(t);
    ctx.vsCharacterSelect();
    return;
  }

  const send = link.send(id);
  if (flags & 0x80) {
    let everyone = true;
    send.kind = CHOOSING;
    if (!screen.chosen) {
      if (e.repeated & KEY.UP) {
        e.playSong(SONG.MENU_CURSOR);
        screen.mode = (screen.mode - 1) & 0xFF;
        if (screen.mode > 1) screen.mode = 1;
        screen.qBand = 0;
      } else if (e.repeated & KEY.DOWN) {
        e.playSong(SONG.MENU_CURSOR);
        if (++screen.mode > 1) screen.mode = 0;
        screen.qBand = 0;
      }
    }
    send.bytes[2] = screen.mode;
    for (let i = 1; i < PLAYERS_MAX; i++) {
      if (!(connections >> i & 1)) break;
      if ((view.slot(i)?.kind ?? 0) !== CHOOSING) everyone = false;
    }
    // Race isn't in the game yet, so A on its row does nothing, as Single-Pak's does in the mode select
    if ((everyone && (e.pressed & KEY.A) && screen.mode === 1) || screen.chosen) {
      screen.chosen = 1;
      send.kind = CHOSEN;
    }
  } else {
    send.kind = CHOOSING;
    updateSprite(e, ctx.sprites, screen.wait);
    displaySprite(e, ctx.sprites, screen.wait);
  }

  // the band of texts runs across the row, half a pixel a frame
  const s = screen.s, width = BAND_WIDTH[ctx.save.uiLanguage][screen.mode];
  screen.qBand += 0x80;
  if (screen.qBand > width * 0x100) screen.qBand -= width * 0x100;
  s.y = screen.mode * 24 + 64;
  s.variant = screen.mode;
  updateSprite(e, ctx.sprites, s);
  for (let x = (screen.qBand >> 8) - width; 232 - x > 0; x += width) {
    s.x = 232 - x;
    displaySprite(e, ctx.sprites, s);
  }
  const bar = screen.bar;
  bar.y = screen.mode * 24 + 54;
  for (let i = 0; i < 8; i++) {
    bar.x = i * 32;
    displaySprite(e, ctx.sprites, bar);
  }
}
