// The VS continue screen (SAT-R decompilation, src/game/sa1/ui/multiplayer_continue_screen.c: CreateMultiplayerContinueScreen
// and its tasks): after a round's results, the first GBA, the parent, picks with Left and Right whether the players go on to
// play another round or stop, and A once every other GBA has answered. The others wait with a "please wait" text in the
// middle and follow the choice. Going on leads back to the game choice (gameselect.js); stopping closes the link, which
// the lobby's closed-link mode shows (lobby.js) before the title screen.
//
// The GBAs tell each other over the link: 0xA0 with the choice they show (0 go on, 1 stop), and 0xA1 from the parent once
// it has pressed A, which the others answer with the same choice shown.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, createFade, fadeStep } from './ui.js';
import { linkLost } from './heartbeat.js';

// the USA copy's numbers (from 883 on the decompilation's are 2 higher), and its tables at 0x08684648 (the decompilation's
// gUnknown_0868B76C to gUnknown_0868B790): the three texts, each in Japanese and English, and their tiles, variants and places;
// the marker's x for each choice; the choice's own text, and its variants
const TEXTS = {
  anim: [[890, 889], [890, 889], [890, 889]], variant: [[1, 1], [2, 2], [3, 3]], tiles: [0x2A, 0xC, 0xC],
  at: [[120, 33], [49, 73], [191, 73]],
};
const MARKER_X = [23, 165];
const ANIM_MARKER = 858, ANIM_CHOICE = [886, 886], VARIANT_CHOICE = [2, 1], ANIM_WAIT = 903;
const TILEMAP = 0x50;
const OBJ_VRAM = 0x10000, TILE_SIZE = 0x20;
const CHOOSING = 0xA0, CHOSEN = 0xA1;
const PLAYERS_MAX = 4;
const SETTLE = 120;   // the frames before the link is watched

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0, oamFlags: 0x480, ...fields });

/** CreateMultiplayerContinueScreen. */
export function createContinueScreen(ctx) {
  const e = ctx.engine, lang = ctx.save.uiLanguage;
  ctx.missing.fill(0);
  e.playSong(SONG.VS_CONTINUE);
  e.firstRepeat.fill(0x14);
  e.nextRepeat.fill(8);
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E00;
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;

  // VramMalloc: the sprites' tiles one after the other
  let at = OBJ_VRAM;
  const alloc = tiles => { const a = at; at += tiles * TILE_SIZE; return a; };
  const texts = TEXTS.tiles.map((tiles, i) => sprite(TEXTS.anim[i][lang], alloc(tiles), { variant: TEXTS.variant[i][lang], x: TEXTS.at[i][0], y: TEXTS.at[i][1] }));
  const marker = sprite(ANIM_MARKER, alloc(0x1C), { variant: 0, x: 23, y: 57 });
  const choice = sprite(ANIM_CHOICE[0], alloc(0x23), { variant: VARIANT_CHOICE[1], x: 101, y: 81 });
  const wait = sprite(ANIM_WAIT, alloc(0xC), { variant: 0, x: 120, y: 80, oamFlags: 0x80 });
  const screen = {
    ctx, texts, marker, choice, wait, fade: createFade(0, 1, 2, 0, 0x100, 0x10),
    choosing: 0, frames: 0, chosen: 0,   // unk16C, unk16E, unk170
  };
  e.createTask(run, screen, 0x2000);
  drawBackground(e, ctx.tilemaps, createBackground({ graphics: { src: 0, dest: 0, size: 0, anim: 0 }, layoutVram: 0xF000, tilemapId: TILEMAP, targetTilesX: 30, targetTilesY: 20 }));
  updateSprite(e, ctx.sprites, wait);
}

// Task_MultiplayerContinueScreen
function run(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx, view = link.view(id);
  if (screen.frames > SETTLE) {
    if (linkLost(ctx)) return;
  } else screen.frames++;

  if (fadeStep(e, screen.fade)) {
    e.dispCnt &= 0x9FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    const parent = view.slot(0), kind = parent?.kind ?? 0;
    if (kind === CHOOSING) {
      if (screen.choosing !== parent.bytes[2]) {
        e.playSong(SONG.MENU_CURSOR);
        if (!(view.flags & 0x80)) screen.choosing = parent.bytes[2];
      }
    } else if (kind === CHOSEN) {
      if (screen.choosing !== parent.bytes[2]) {
        e.playSong(SONG.MENU_CURSOR);
        screen.choosing = parent.bytes[2];
      }
      e.playSong(SONG.SELECT);
      screen.fade.unk4 = 1;
      screen.fade.unk6 = 0;
      t.main = leave;
    }

    const send = link.send(id);
    send.kind = CHOOSING;
    send.bytes[2] = screen.choosing;
    if (view.flags & 0x80) {
      if (screen.chosen === 0) {
        if (e.repeated & KEY.RIGHT) screen.choosing = 1;
        else if (e.repeated & KEY.LEFT) screen.choosing = 0;
        send.bytes[2] = screen.choosing;
        if (e.pressed & KEY.A) {
          let everyone = true;
          for (let i = 0; i < PLAYERS_MAX; i++) {
            if (i === id) continue;
            if (!(ctx.vsLink.connections >> i & 1)) break;
            if ((view.slot(i)?.kind ?? 0) !== CHOOSING) everyone = false;
          }
          if (everyone) {
            send.kind = CHOSEN;
            screen.chosen = 1;
          }
        }
      } else send.kind = CHOSEN;
    } else {
      updateSprite(e, ctx.sprites, screen.wait);
      displaySprite(e, ctx.sprites, screen.wait);
    }
  }

  const c = screen.choice;
  c.graphics.anim = ANIM_CHOICE[screen.choosing];
  c.variant = VARIANT_CHOICE[screen.choosing];
  show(screen);
}

// sub_806B534: the picture fades out, then the players go on to the game choice, or stop
function leave(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  if (fadeStep(e, screen.fade)) {
    e.dispCnt &= ~0xE000;
    e.bldCnt = 0;
    e.bldY = 0;
    const choosing = screen.choosing;
    e.stopSong(SONG.VS_CONTINUE);
    e.destroyTask(t);
    if (choosing === 0) ctx.gameSelect();
    else ctx.lobby(2);
  } else show(screen);
}

// sub_806B5A4
function show(screen) {
  const { ctx } = screen, e = ctx.engine;
  for (const s of screen.texts) {
    s.prevVariant = 0xFF;
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  }
  screen.marker.x = MARKER_X[screen.choosing];
  updateSprite(e, ctx.sprites, screen.marker);
  displaySprite(e, ctx.sprites, screen.marker);
  updateSprite(e, ctx.sprites, screen.choice);
  displaySprite(e, ctx.sprites, screen.choice);
}
