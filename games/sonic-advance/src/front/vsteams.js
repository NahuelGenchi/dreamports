// The VS play choice for three or four players (SAT-R decompilation, src/game/sa1/stage/mp_results_b.c: sub_8018AE0,
// Task_8018ECC, Task_8019348 and Task_80196FC): after the overview, each player against all the others or the players
// in two teams. The first GBA, the parent, picks with Left and Right and A, and the others wait with a "please wait"
// text in the middle. The pick shows on a marker over the two texts, with two pictures turning behind. All against all
// (the right one, as the screen starts) goes on to the Chao Hunt stage choice (vschao.js). The teams open the screen
// where each player picks their team with Left and Right and A, and B takes the choice back; the round starts once both
// teams have someone and every player has answered, and goes on to the same stage choice.
//
// The GBAs tell each other over the link: the parent sends 0x34 with the pick, and 0x35 once every other GBA has
// answered and it presses A; the others follow the pick and, on 0x35, go on. The team screen has every GBA send 0x40
// with its team, or 0x41 once it has answered.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { createBackground, drawBackground } from '../gba/background.js';
import { windowLeft } from '../gba/lines.js';
import { KEY } from '../gba/engine.js';
import { SINE } from '../engine/trig.js';
import { SONG } from '../sound/songs.js';
import { linkLost } from './heartbeat.js';

// the USA copy's numbers (from 883 on the decompilation's are 2 higher): the texts' band, the bar (860), the messages
// (variants 2 and 3, the two picks), the marker (858) and the waiting text (903); and on the team screen the player
// labels (variants 5 to 8) and the hint (variant 4)
const ANIM_TEXTS = 892, ANIM_BAR = 860, ANIM_MESSAGES = 889, ANIM_MARKER = 858, ANIM_WAIT = 903, ANIM_CURSOR = 857;
const OBJ_VRAM = 0x10000;
const PLAYERS_MAX = 4;
const CHOOSING = 0x34, CHOSEN = 0x35;
const TEAM_CHOOSING = 0x40, TEAM_CHOSEN = 0x41;
const TILEMAPS = [81, 82];
const CHAO_HUNT = 4, TEAM_PLAY = 5;   // gGameMode
const s16 = v => (v << 16) >> 16;
// the team screen's four rows, and the marker on each: gUnknown_080BB484
const LABEL_Y = [61, 85, 109, 133], CURSOR_Y = [53, 77, 101, 125];
const BAND = 164;

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
    team: 0, ready: false, teamAngle: 0, teamBand: 0, teamSpeed: 0, teamScroll: [0, 0],
    s: sprite(ANIM_TEXTS, OBJ_VRAM, { x: 0, y: 0x19, oamFlags: 15 << 6, variant: 2 }),
    bar: sprite(ANIM_BAR, OBJ_VRAM + 0x340, { x: 0, y: 0xE, oamFlags: 0x400, prevVariant: -1 }),
    messages: [
      sprite(ANIM_MESSAGES, OBJ_VRAM + 0x4C0, { x: 0x35, y: 0x58, oamFlags: 0x400, variant: 2, prevVariant: -1 }),
      sprite(ANIM_MESSAGES, OBJ_VRAM + 0x640, { x: 0xB7, y: 0x58, oamFlags: 0x400, variant: 3, prevVariant: -1 }),
      sprite(ANIM_MARKER, OBJ_VRAM + 0x740, { x: 25, y: 73, oamFlags: 0x400, prevVariant: -1 }),
    ],
    wait: sprite(ANIM_WAIT, OBJ_VRAM + 0xAC0, { x: 120, y: 80, oamFlags: 0x80, prevVariant: -1, frameFlags: 0x2000 }),
  };
  const t = e.createTask(choose, screen, 0x2000);
  screen.task = t;
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
      // the teams' own choice of who is with whom (Task_8019348), or the Chao Hunt stage choice (sub_8062F90)
      if (screen.pick === 0) {
        ctx.gameMode = TEAM_PLAY;
        t.main = enterTeams;
        return;
      }
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
    if ((everyone && (e.pressed & KEY.A)) || screen.chosen) {
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

// Task_8019348: the teams' screen, on the same picture, with the four players' labels, a marker under each and a line
// of help. Every GBA starts with the players at odd and even link ids on opposite teams.
function enterTeams(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, id = ctx.id;
  // Task_8019348 is set as the task's main on the frame the pick comes in, and runs on the next one
  if ((screen.enterDelay = (screen.enterDelay ?? 0) + 1) < 2) return;
  screen.team = 1 & id;
  screen.ready = false;
  // the first screen's turn and its band carry on into this one; only the teams and their answers start over
  screen.teamAngle = screen.angle;
  screen.teamSpeed = screen.speed;
  screen.teamBand = screen.band;
  screen.teamScroll = [0, 0];
  screen.teamScroll2 = [0, 0];

  screen.bandSprite = sprite(ANIM_TEXTS, OBJ_VRAM, { x: 0, y: 0x19, oamFlags: 0x3C0, variant: 3 });
  screen.teamBar = sprite(ANIM_BAR, OBJ_VRAM + 0x400, { x: 0, y: 0xE, oamFlags: 0x400, prevVariant: -1 });
  screen.labels = [5, 6, 7, 8].map((variant, i) => sprite(ANIM_TEXTS, OBJ_VRAM + 0x580 + i * 0x100,
    { x: 0x2B, y: LABEL_Y[i], oamFlags: 0x400, variant }));
  screen.cursor = sprite(ANIM_CURSOR, OBJ_VRAM + 0x980, { x: 0x4B, y: CURSOR_Y[0], oamFlags: 0x400, prevVariant: -1 });
  screen.hint = sprite(ANIM_TEXTS, OBJ_VRAM + 0xA00, { x: 0x67, y: 0x61, oamFlags: 0x400, variant: 4 });
  for (const s of [screen.bandSprite, screen.teamBar, ...screen.labels, screen.cursor, screen.hint]) updateSprite(e, ctx.sprites, s);

  e.bgCnt[2] = 0x1F05;
  e.bgScroll[4] = e.bgScroll[2];
  e.bgScroll[5] = e.bgScroll[3];
  screen.teamScroll = [e.bgScroll[2], e.bgScroll[3]];
  screen.teamScroll2 = [e.bgScroll[2], e.bgScroll[3]];
  e.dispCnt |= 0x2400;
  e.winRegs[4] = 0x3D;
  e.winRegs[5] = 0x3B;
  e.bldCnt = 0x3F46;

  t.main = teamChoice;
}

// Task_80196FC
function teamChoice(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx, view = link.view(id);
  if (linkLost(ctx)) return;
  const connections = ctx.vsLink.connections;
  let count = 0;
  while (count < PLAYERS_MAX && connections >> count & 1) count++;

  if (!screen.ready) {
    if (e.repeated & KEY.RIGHT) {
      if (screen.team === 0) e.playSong(SONG.MENU_CURSOR);
      screen.team = 1;
    } else if (e.repeated & KEY.LEFT) {
      if (screen.team === 1) e.playSong(SONG.MENU_CURSOR);
      screen.team = 0;
    }
  }
  if (e.pressed & KEY.B) {
    e.playSong(SONG.RETURN);
    screen.ready = false;
  }

  const counts = [0, 0];
  let allAnswered = true;
  for (let i = 0; i < count; i++) {
    const packet = view.slot(i), kind = packet?.kind ?? 0;
    if (kind === TEAM_CHOOSING || kind === TEAM_CHOSEN) {
      const team = packet.bytes[2] & 1;
      const label = screen.labels[i];
      label.x = (team << 7) + 0x2B;
      displaySprite(e, ctx.sprites, label);
      const cursor = screen.cursor;
      cursor.x = team * 0x5E + 0x4B;
      cursor.y = CURSOR_Y[i];
      cursor.frameFlags = team === 0 ? (cursor.frameFlags & ~0x400) : (cursor.frameFlags | 0x400);
      displaySprite(e, ctx.sprites, cursor);
      if (team === 0) ctx.vsLink.connections &= ~(0x10 << i);
      else ctx.vsLink.connections |= 0x10 << i;
      if (kind === TEAM_CHOSEN) counts[team]++;
      else allAnswered = false;
    } else allAnswered = false;
  }

  // every player answered and both teams have someone; no waiting marker is left on
  if (allAnswered) {
    if (counts[0] === 0 || counts[1] === 0) screen.ready = false;
    else {
      e.destroyTask(t);
      e.flags &= ~4;
      ctx.vsChaoSelect();
      return;
    }
  }

  if (!(e.keys & (KEY.LEFT | KEY.RIGHT)) && (e.pressed & KEY.A)
    && ((screen.team === 0 && count - 1 !== counts[0]) || (screen.team === 1 && count - 1 !== counts[1]))) {
    if (!screen.ready) e.playSong(SONG.SELECT);
    screen.ready = true;
  }
  const send = link.send(id);
  send.kind = screen.ready ? TEAM_CHOSEN : TEAM_CHOOSING;
  send.bytes[2] = screen.team;

  for (let i = 0; i < count; i++) {
    if (i !== id && (view.slot(i)?.kind ?? 0) >= TEAM_CHOSEN + 1) {
      e.destroyTasks();
      e.clearQueues();
      ctx.linkError();
      return;
    }
  }

  // the window's left edge ripples over the picture's first 16 lines (sub_80064A8 twice)
  windowLeft(e, 0, 0x74, 0, 0x7C, 8, 0xF0);
  windowLeft(e, 0, 0x7C, 8, 0x74, 0x10, 0xF0);

  // the two halves of the picture turn in opposite ways, faster over the first second
  screen.teamSpeed = Math.min(screen.teamSpeed + 0x10, 0x400);
  screen.teamAngle = (screen.teamAngle + (screen.team === 0 ? 1 : -1)) & 0x3FF;
  const dx = (((screen.teamSpeed * (SINE[screen.teamAngle + 256] >> 6)) << 8) >> 16);
  const dy = (((screen.teamSpeed * (SINE[screen.teamAngle] >> 6)) << 8) >> 16);
  screen.teamScroll[0] = (screen.teamScroll[0] + dx) & 0xFFFF;
  screen.teamScroll[1] = (screen.teamScroll[1] + dy) & 0xFFFF;
  screen.teamScroll2[0] = (screen.teamScroll2[0] - dx) & 0xFFFF;
  screen.teamScroll2[1] = (screen.teamScroll2[1] - dy) & 0xFFFF;
  e.bgScroll[2] = s16(screen.teamScroll[0]) >> 8;
  e.bgScroll[3] = s16(screen.teamScroll[1]) >> 8;
  e.bgScroll[4] = s16(screen.teamScroll2[0]) >> 8;
  e.bgScroll[5] = s16(screen.teamScroll2[1]) >> 8;

  // the line of help runs across, half a pixel a frame
  screen.teamBand += 0x80;
  if (screen.teamBand > BAND << 8) screen.teamBand -= BAND << 8;
  for (let x = s16(-screen.teamBand >> 8); x < 240; x += BAND) {
    screen.bandSprite.x = x;
    displaySprite(e, ctx.sprites, screen.bandSprite);
  }
  displaySprite(e, ctx.sprites, screen.hint);
  for (let i = 0; i < 8; i++) {
    screen.teamBar.x = i * 32;
    displaySprite(e, ctx.sprites, screen.teamBar);
  }
}
