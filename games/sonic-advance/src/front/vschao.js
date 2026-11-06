// The Chao Hunt stage choice of the VS menus (SAT-R decompilation, src/game/sa1/ui/game_2_3.c: sub_8062F90 and its tasks):
// after the overview, the picture of the course select with the four stages in a list. The first GBA, the parent, picks
// the stage with Up and Down and A, and the others wait with a "please wait" text in the middle and follow the stage it
// shows. Once the parent has chosen, every GBA answers, and the parent, hearing all of them, sends the stage and the places
// of the Chao (three of the stage's eight, different from each other) and the round starts.
//
// The GBAs tell each other over the link: 0x50 with the stage they show, 0x51 once chosen (the parent) or once they know
// (the others), and 0x52 from the parent, with the stage and the Chao's places.

import { createSprite, updateSprite, displaySprite } from '../gba/sprite.js';
import { KEY } from '../gba/engine.js';
import { SONG } from '../sound/songs.js';
import { createUiTask, uiGfxStackInit, loadUiGfx, createFade, fadeStep } from './ui.js';
import { linkLost } from './heartbeat.js';

// the USA copy's numbers (from 883 on the decompilation's are 2 higher): the acts' list, and the waiting text
const ANIM_ACTS = 724, ANIM_WAIT = 903;
const OBJ_VRAM = 0x10000;
// the acts' sprites: their tiles in sprite VRAM (gUnknown_0868B240) and the variant of each. A fifth is made and never
// shown, with the first act's variant's colours for a chosen row (the sprites' palette row 3), and its tiles are the waiting text's
const ACTS = [[0x20, 15], [0x360, 16], [0x6A0, 17], [0x9E0, 18], [0xF00, 0]], WAIT_TILES_AT = 0xF00;
const STAGES = 4, FIRST_STAGE_LEVEL = 14;   // NUM_LEVEL_IDS_SP: the first Chao Hunt stage's level
const SHOWN = 0x40;   // the frames the fade takes
const CHOOSING = 0x50, CHOSEN = 0x51, STARTING = 0x52;
const PLAYERS_MAX = 4;
// the picture, as the course select's (courseselect.js) is, one thing after the other from offsets.courseSelectBackground:
// the front layer's tiles and map, the same as the course select has, then this screen's own colours, back layer tiles and map
const BACKGROUND = {
  frontTiles: 0, frontTilesSize: 0xE00, frontLayout: 0xD40, frontLayoutSize: 0x500,
  palette: 0x35C0, paletteSize: 0x200,
  tiles: 0x37C0, tilesSize: 0x1CC0, layout: 0x4040, layoutSize: 0x1000,
};
const div = (a, b) => Math.trunc(a / b);

const sprite = (anim, dest, fields) => createSprite({ graphics: { src: 0, dest, size: 0, anim }, prevVariant: 0xFF, animSpeed: 0x10, palId: 0, frameFlags: 0x2000, ...fields });

// sub_8062EDC: the picture's two layers
function loadBackground(e, at) {
  uiGfxStackInit(e);
  const noLayout = { unk4: 0, unk8: 0, unk9: 0, unkA: 0, unkB: 0 }, b = BACKGROUND;
  loadUiGfx(e, {
    uiGfxID: 0x80, unk2B: 1, unk0: noLayout, unk29: 1, unk2A: 0x11,
    tiles: at + b.frontTiles, tilesSize: b.frontTilesSize, layout: at + b.frontLayout, layoutSize: b.frontLayoutSize,
  });
  loadUiGfx(e, {
    uiGfxID: 0x80, unk2B: 0, unk0: noLayout, unk28: 0, unk29: 0, unk2A: 0x15,
    tiles: at + b.tiles, tilesSize: b.tilesSize, palette: at + b.palette, paletteSize: b.paletteSize, layout: at + b.layout, layoutSize: b.layoutSize,
  });
}

/** sub_8062F90. */
export function createVsChaoSelect(ctx) {
  const e = ctx.engine;
  ctx.missing.fill(0);
  e.playSong(SONG.COURSE_SELECTION);
  createUiTask(e);
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1D83;
  e.bgCnt[1] = 0x1886;
  e.bgScroll.fill(0, 0, 4);
  loadBackground(e, ctx.offsets.courseSelectBackground);

  const screen = {
    ctx, frame: 0, scroll: 0x14, stage: 0, chosen: 0, chao: 0,   // unk4C, unk52, unk55, unk57
    fade: createFade(0, 1, 2, 0, 0x200, 1),
    acts: ACTS.map(([at, variant]) => {
      const s = sprite(ANIM_ACTS, OBJ_VRAM + at, { variant, oamFlags: 0x480 });
      updateSprite(e, ctx.sprites, s);
      return s;
    }),
    wait: sprite(ANIM_WAIT, OBJ_VRAM + WAIT_TILES_AT, { x: 120, y: 80, oamFlags: 0x80 }),
  };
  const t = e.createTask(fadeIn, screen, 0x2000);
  screen.task = t;
  screen.list = e.createTask(showActs, screen, 0x2030);
  updateSprite(e, ctx.sprites, screen.wait);
  fadeStep(e, screen.fade);
}

// Task_8063824: the acts, the chosen one a little to the right, and blinking once it is chosen
function showActs(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.acts.slice(0, STAGES).forEach((s, i) => {
    if (i === screen.stage) {
      s.palId = screen.chosen ? screen.frame & 1 : 1;
      s.x = 104;
    } else {
      s.x = 100;
      s.palId = 0;
    }
    s.y = (i << 5) + 24;
    updateSprite(e, ctx.sprites, s);
    displaySprite(e, ctx.sprites, s);
  });
}

// the stage the packets show, the list's scroll and the frame count, as every one of the choosing tasks keeps them
function track(screen) {
  const stage = screen.stage;
  if (stage > div(screen.scroll, 24) + 5) screen.scroll = (stage - 5) * 24 - 8;
  else if (stage <= div(screen.scroll, 24)) screen.scroll = stage * 24 - 8;
}

// Task_80631E8: the picture fades in, for 64 frames or until A
function fadeIn(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  screen.frame++;
  fadeStep(e, screen.fade);
  if (screen.frame === SHOWN || (e.pressed & KEY.A)) {
    screen.frame = SHOWN;
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    t.main = choose;
  }
}

// Task_80632B4: the parent's Up and Down and A; the others show what the parent does
function choose(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx, view = link.view(id), flags = view.flags;
  if (linkLost(ctx)) return;

  const parent = view.slot(0), kind = parent?.kind ?? 0;
  if (!(flags & 0x80)) {
    if (kind >= CHOOSING) screen.stage = parent.bytes[2];
    updateSprite(e, ctx.sprites, screen.wait);
    displaySprite(e, ctx.sprites, screen.wait);
  }
  screen.frame++;
  if ((flags & 0x80) && STAGES > 1) {
    if (e.repeated & KEY.DOWN) {
      if (screen.stage < 3) screen.stage++;
    } else if (e.repeated & KEY.UP) {
      if (screen.stage !== 0) screen.stage--;
    }
  }
  track(screen);
  fadeStep(e, screen.fade);
  const send = link.send(id);
  send.kind = CHOOSING;
  send.bytes[2] = screen.stage;
  if ((flags & 0x80) && (e.pressed & KEY.A)) send.kind = CHOSEN;

  if (kind === CHOSEN) {
    screen.chosen = 1;
    t.main = follow;
    e.playSong(SONG.SELECT);
    e.stopSong(SONG.COURSE_SELECTION);
    screen.fade.unk4 = 1;
    screen.fade.unk6 = (0x2000 - (screen.fade.unk6 & 0xFFFF)) & 0xFFFF;
  }
}

// Task_80634EC: the others follow the stage, and the picture fades out
function follow(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, view = ctx.link.view(ctx.id);
  if (linkLost(ctx)) return;
  const parent = view.slot(0);
  if (!(view.flags & 0x80) && (parent?.kind ?? 0) >= CHOOSING) screen.stage = parent.bytes[2];
  screen.frame++;
  fadeStep(e, screen.fade);
  if (screen.fade.unk6 > 0x1800 && screen.fade.unk4 === 1) t.main = answer;
}

// Task_8063638: every GBA says it knows, and the parent, once it has heard them all, sends the stage and the places
function answer(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine, { id, link } = ctx, view = link.view(id);
  if (linkLost(ctx)) return;
  const connections = ctx.vsLink.connections;

  if ((view.slot(0)?.kind ?? 0) === STARTING) {
    t.main = start;
    screen.chao = view.slot(0).bytes[3];   // gChaoTasks
  }
  const send = link.send(id);
  if (view.flags & 0x80) {
    let i = 1;
    while (i < PLAYERS_MAX && (!(connections >> i & 1) || (view.slot(i)?.kind ?? 0) === CHOSEN)) i++;
    if (i === PLAYERS_MAX) {
      send.kind = STARTING;
      send.bytes[2] = screen.stage;
      // three different places among the eight, as the game draws them
      let r = ctx.random();
      send.bytes[3] = r & 7;
      r >>>= 8;
      if (send.bytes[3] === (r & 7)) {
        do r = ctx.random(); while (send.bytes[3] === (r & 7));
      }
      send.bytes[4] = r & 7;
      r >>>= 8;
      while (send.bytes[3] === (r & 7) || send.bytes[4] === (r & 7)) r = ctx.random();
      send.bytes[5] = r & 7;
      return;
    }
  }
  send.kind = CHOSEN;
  send.bytes[2] = screen.stage;
}

// Task_80638B0: the round starts, for the stage and the places
function start(t) {
  const screen = t.data, { ctx } = screen, e = ctx.engine;
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0;
  e.bldY = 0;
  ctx.vs?.round({ level: FIRST_STAGE_LEVEL + screen.stage, seed: ctx.vsLink.seed, chaoPlace: screen.chao & 7 });
  e.destroyTask(screen.list);
  e.destroyTask(t);
}
