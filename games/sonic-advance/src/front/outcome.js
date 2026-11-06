// The Multi-Pak outcome screen (SAT-R decompilation, src/game/shared/multiplayer/communication_outcome.c:
// CreateMultipackOutcomeScreen): what came of the connection. A message runs across the screen under a black band
// and, on a success, one Chao for each GBA linked sits in the middle. It lasts 120 frames, from a fade in over 16, and
// then fades out to black: a success goes on to the lobby (lobby.js), an error leaves the link and returns to the
// main menu.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { SONG } from '../sound/songs.js';
import { createMainMenu } from './title.js';

// by the outcome (0 success, 1 error): the Chao's animation and variant, the message's width and the tilemap (78, 79).
// These are the USA copy's numbers, from its tables at 0x084A6908 of the decompilation's baserom: from 886 on its
// animations are 2 lower than the decompilation's
const ANIM_CHAO = [887, 884], VARIANT_CHAO = [0, 0], MESSAGE_WIDTH = [44, 42], TILEMAP = [78, 79];
const SONGS = [SONG.CONNECTION_SUCCESS, SONG.CONNECTION_ERROR];
const ANIM_MESSAGES = 889, ANIM_BLACK_RECT = 860;
const CHAO_X = [0, 99, 78, 57, 36], CHAO_STEP = 0x2A, HOLD = 0x78;
const OBJ_VRAM = 0x10000;
const win = (a, b) => (a << 8) | b;

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0x2000, ...fields });

/** CreateMultipackOutcomeScreen: `outcome` is 0 for a connection made and 1 for an error. */
export function createMultipackOutcome(ctx, outcome) {
  const e = ctx.engine;
  e.dispCnt = 0x3140;
  e.bgCnt[0] = 0x803;
  e.bgScroll[0] = 0x100;
  e.bgScroll[1] = 0;
  e.winRegs[0] = win(0, 240);
  e.winRegs[2] = win(0, 160);
  e.winRegs[4] = 0x31;
  e.winRegs[5] = 0x31;
  e.bldCnt = 0xBF;
  e.bldY = 0x10;

  const connections = ctx.vsLink?.connections ?? 1;
  let count = 0;
  for (let i = 0; i < 4; i++) count += connections >> i & 1;
  const screen = {
    ctx, outcome, count, qMessage: 0, hold: HOLD,
    chao: sprite(ANIM_CHAO[outcome], OBJ_VRAM + 0x300, { x: 93, y: 85, oamFlags: 0x3C0, variant: VARIANT_CHAO[outcome] }),
    message: sprite(ANIM_MESSAGES, OBJ_VRAM, { x: 0, y: 32, oamFlags: 0x3C0, variant: outcome + 8 }),
    band: sprite(ANIM_BLACK_RECT, OBJ_VRAM + 0x180, { x: 0, y: 21, oamFlags: 0x400 }),
  };
  e.createTask(run, screen, 0x2000);
  updateSprite(e, ctx.sprites, screen.chao);
  updateSprite(e, ctx.sprites, screen.message);
  updateSprite(e, ctx.sprites, screen.band);
  drawBackground(e, ctx.tilemaps, createBackground({ layoutVram: 0x4000, tilemapId: TILEMAP[outcome], targetTilesX: 30, targetTilesY: 20 }));
  e.playSong(SONGS[outcome]);
}

/** LinkCommunicationError: the error outcome. */
export function createLinkError(ctx) {
  createMultipackOutcome(ctx, 1);
}

// Task_MultipackOutcomeScreen
function run(t) {
  const screen = t.data, { ctx, outcome } = screen, e = ctx.engine, c = screen.chao;
  updateSprite(e, ctx.sprites, c);
  if (outcome === 0) {
    c.x = CHAO_X[screen.count];
    for (let n = screen.count; n > 0; n--) {
      displaySprite(e, ctx.sprites, c);
      c.x += CHAO_STEP;
    }
  } else {
    displaySprite(e, ctx.sprites, c);
  }

  const width = MESSAGE_WIDTH[outcome], m = screen.message;
  screen.qMessage += 0x80;
  if (screen.qMessage > width << 8) screen.qMessage -= width << 8;
  updateSprite(e, ctx.sprites, m);
  for (let v = (screen.qMessage >> 8) - width; 251 - v > -11; v += width) {
    m.x = 251 - v;
    displaySprite(e, ctx.sprites, m);
  }
  const band = screen.band;
  band.y = 21;
  for (let i = 0; i < 8; i++) {
    band.x = i << 5;
    displaySprite(e, ctx.sprites, band);
  }

  if (screen.hold !== 0) {
    screen.hold--;
    if (e.bldY !== 0) e.bldY--;
    return;
  }
  if (e.bldY !== 0x10) { e.bldY++; return; }

  e.destroyTasks();
  e.clearQueues();
  if (outcome === 0) {
    ctx.lobby();
  } else {
    // MultiSioStop and MultiSioInit(0): the GBA leaves the link
    ctx.link.enable(ctx.id, false);
    ctx.link.send(ctx.id).kind = 0;
    createMainMenu(ctx, true);
  }
}
