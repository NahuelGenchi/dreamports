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
  ctx.link.enable(ctx.id, true);
  t.main = waitMultiPak;
}

// what the GBA says on the link (mp_mode_select.c): the waiting screen's packet kinds
const HELLO = 0x10, START = 0x11, ACK = 0x12;
const HEARTBEATS = 0xB5;   // frames a GBA may be missing from the link

// a packet to send: its kind, the GBA ids taking part, the save's id, the player's name and the frame count
function say(ctx, kind, mask, frameCount) {
  const packet = ctx.link.send(ctx.id), v = new DataView(packet.bytes.buffer, packet.bytes.byteOffset, packet.bytes.length);
  packet.kind = kind;
  if (kind !== HELLO) v.setUint16(2, mask, true);
  v.setUint32(4, ctx.save.unk4, true);
  packet.bytes.set(ctx.save.playerName, 8);
  if (frameCount !== undefined) v.setUint32(0x10, frameCount, true);
}
const kindOf = packet => packet?.kind ?? 0;
const u32At = (packet, at) => new DataView(packet.bytes.buffer, packet.bytes.byteOffset, packet.bytes.length).getUint32(at, true);
const maskOf = packet => new DataView(packet.bytes.buffer, packet.bytes.byteOffset, packet.bytes.length).getUint16(2, true);

// sub_800FD9C: the player whose packet this is goes to the front of the save's ten records of players, which move down a
// place. A record is the same when its id and its name, from the second byte of the id, are those of the packet; that one
// moves to the front as it is. Otherwise the id and name are copied to a new first record, with no wins, losses or draws.
// Returns the place `place`
function registerPlayer(save, packet, place) {
  const scores = save.multiplayerScores;
  for (let i = 0; i < 10; i++) {
    let same = scores[i * 16] === packet[4];
    for (let c = 1; same && c < 12; c++) if (packet[4 + c] !== scores[i * 16 + c]) same = false;
    if (same) {
      const own = scores.slice(i * 16, i * 16 + 16);
      scores.copyWithin(16, 0, i * 16);
      scores.set(own, 0);
      return place;
    }
  }
  scores.copyWithin(16, 0, 9 * 16);
  scores.set(packet.subarray(4, 16), 0);
  scores.fill(0, 12, 15);
  return place;
}

// MultiSioStop, MultiSioInit(0) and the packet sent cleared: the GBA leaves the link
function leaveLink(ctx) {
  ctx.link.enable(ctx.id, false);
  ctx.link.send(ctx.id).kind = 0;
}

// the link was lost (LinkCommunicationError)
function linkLost(ctx, t) {
  leaveLink(ctx);
  ctx.engine.destroyTask(t);
  ctx.linkError();
}

// back to the modes, as B does from the waiting screens
function backToModes(ctx, t) {
  const e = ctx.engine;
  leaveLink(ctx);
  e.stopSong(SONG.CHARACTER_SELECTION);
  e.playSong(SONG.RETURN);
  clearMap(e);
  e.destroyTask(t);
  createModeSelect(ctx);
}

// the frames' fade and the count of the screen's sprites, as every waiting task has them
function showWaiting(screen, count, extra) {
  const { ctx } = screen, e = ctx.engine;
  screen.s[2].variant = count + 3;
  for (let i = 0; i < 3; i++) { updateSprite(e, ctx.sprites, screen.s[i]); displaySprite(e, ctx.sprites, screen.s[i]); }
  extra?.();
}

// Task_MultiPak: who is on the link, and the first GBA's Start, which sends the others to Task_800F058
function waitMultiPak(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx;
  const view = link.view(id), flags = view.flags, missing = ctx.missing;
  if (flags & 0x81) {
    if (!(flags & (1 << id))) {
      if (missing[id]++ >= HEARTBEATS) return linkLost(ctx, t);
    } else missing[id] = 0;
  }
  screen.qFade = s16(screen.qFade - 0x80);
  if (screen.qFade < 0) screen.qFade = 0;
  e.bldY = screen.qFade >> 8;

  let present = 0, seen = 0, mask = 0, gap = 0, notReady = 0, steady = 1;
  const joined = screen.joined;
  for (let i = 0; i < PLAYERS_MAX; i++) {
    joined[0][i] = (joined[0][i] << 1) & 0xFF;
    joined[1][i] = (joined[1][i] << 1) & 0xFF;
    const there = view.slot(i);
    if (i === id || (flags & (1 << i) && kindOf(there) >= HELLO)) {
      joined[0][i] |= 1;
      present++;
      mask |= 1 << i;
      if (gap) notReady = 1;
    } else {
      gap = 1;
      if (!(flags & (1 << i)) && view.data(i) === 0) {
        notReady = 1;
        joined[1][i] |= 1;
        if (joined[0][i] === 0) steady = 0;
      } else if (joined[1][i] !== 0) {
        notReady = 1;
        steady = 0;
      } else if ((flags & (1 << i)) && kindOf(there) < HELLO) {
        notReady = 1;
        steady = 0;
      }
    }
    if (joined[0][i] !== 0) seen++;
  }
  if (seen === 0) seen = 1;

  const parent = kindOf(view.slot(0));
  if (!screen.checked) {
    if ((flags & 0x81) === 1 && parent > HELLO) return linkLost(ctx, t);
    screen.checked = 1;
  }
  if (!notReady && parent === START && screen.checked) {
    // the parent's Start: the seed and who is playing come with it, and the GBAs answer
    ctx.vsLink = { seed: u32At(view.slot(0), 0x10), connections: maskOf(view.slot(0)), records: [0xFF, 0xFF, 0xFF, 0xFF] };
    // each of the other GBAs goes to the front of the save's records of players, and keeps its place there (from 2 down)
    for (let i = 3, place = 2; i >= 0; i--) {
      if (i !== id && (flags & (1 << i))) ctx.vsLink.records[i] = registerPlayer(ctx.save, view.slot(i).bytes, place--);
      else if (i !== id) place--;
    }
    screen.unk206 = 0;
    for (let i = 0; i < 4; i++) missing[i] = 0;
    screen.unk219 = 0;
    t.main = startAnswer;
    startAnswer(t);
    return;
  }
  if (parent > ACK) return linkLost(ctx, t);
  if (e.pressed & KEY.B) {
    backToModes(ctx, t);
    return;
  }
  showWaiting(screen, seen);
  if (flags & 0x80) {
    if (seen > 1 && steady) { updateSprite(e, ctx.sprites, screen.pressStart); displaySprite(e, ctx.sprites, screen.pressStart); }
    if ((!notReady && present > 1 && (e.pressed & KEY.START)) || (screen.unk206 && !notReady && present > 1)) {
      say(ctx, START, mask, screen.frameCount);
      screen.unk206 = 1;
      return;
    }
  }
  screen.unk206 = 0;
  say(ctx, HELLO);
}

// Task_800F058: the GBAs have each other's Start; the parent waits for them all to answer, and then everyone goes on
function startAnswer(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx;
  const view = link.view(id), flags = view.flags, missing = ctx.missing, joined = screen.joined;
  const connections = ctx.vsLink.connections;
  for (let i = 0; i < 4; i++) {
    if (!(connections >> i & 1)) break;
    if (!(flags & (1 << i))) {
      if (missing[i]++ >= HEARTBEATS) return linkLost(ctx, t);
    } else missing[i] = 0;
  }
  const parent = kindOf(view.slot(0));
  if (parent === ACK) {
    ctx.gameMode = 2;   // GAME_MODE_RACE
    e.destroyTask(t);
    ctx.multipackOutcome(0);
    return;
  }
  if (parent === HELLO) { backToModes(ctx, t); return; }
  if (flags & 0x80) {
    if (e.pressed & KEY.B) { backToModes(ctx, t); return; }
    if (screen.unk219++ > 60) return linkLost(ctx, t);
  }
  let seen = 0, mask = 0;
  for (let i = 0; i < PLAYERS_MAX; i++) {
    joined[0][i] = (joined[0][i] << 1) & 0xFF;
    if (id === i || kindOf(view.slot(i)) > HELLO) mask |= 1 << i;
    if (joined[0][i] !== 0) seen++;
  }
  if (seen === 0) seen = 1;
  showWaiting(screen, seen);
  if (flags & 0x80) {
    say(ctx, ACK, mask);
    for (let i = 1; i < 4; i++) {
      if (!(connections >> i & 1)) continue;
      if (!(flags & (1 << i)) || kindOf(view.slot(i)) !== START) { say(ctx, START, mask); return; }
    }
  } else say(ctx, START, mask);
}
