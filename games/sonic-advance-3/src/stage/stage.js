// A stage as the original sets one up, so far Route 99's overworld and its first act: its layers, where the camera
// starts, the fade in or the title card, and the numbers. Rewritten from 0x08002988, with InitCamera at 0x0804F73C.

import { backgroundFrom, drawStageBackground, animateTiles } from './map.js';
import { createStageUi } from './ui.js';
import { createPlayer, initializePlayer, SONIC, TAILS } from './player.js';
import { useCollision } from './collision.js';
import { updateCamera, cameraMemory } from './camera.js';
import { createEntities } from './entities.js';
import { createRings } from './rings.js';
import { createTitleCard } from './title-card.js';

// gStageCameraBgTemplates, in the order the camera keeps them (0x0804F73C), and how each level's layers are numbered
const BG_TEMPLATES = 0xD0120, BG_SIZE = 0x40;
const tilemapOf = (level, n) => level * 4 + n;
const CAMERA_MAX = 0xD0220, RESPAWN = 0xD13C8;
const DISPLAY_W = 240, DISPLAY_H = 160;
const HUB = 2, FIRST_ACT = 3;
// 0x08002618: the songs of the first zone's overworld and its first act, the others of which aren't ported yet
const SONG_ROUTE_99 = 0xA, SONG_ROUTE_99_ACT_1 = 0x14;

/** 0x08050624 and 0x08051308, what Route 99's overworld does with the backgrounds. */
function overworldBackgrounds(c, layers) {
  c.bgScroll[6] = 0;
  c.bgScroll[7] = 0;
  layers[0].dest = 0x8000;
  layers[0].layoutVram = 0xE000;
  c.bgCnt[0] = 0x1C0A;
  layers[3].dest = 0xC000;
  layers[3].layoutVram = 0xE800;
  layers[3].targetTilesX = 32;
  layers[3].targetTilesY = 32;
  layers[3].flags = 3;
  c.bgCnt[3] = 0x1D0E;
}
function scrollOverworld(t) {
  const { c, camera } = t.data;
  c.bgScroll[6] = (camera.x >> 4) & 0xFF;
  let y = camera.y >> 5;
  if (y < 0) y = 0;
  if (y > 0x1F) y = 0x20;
  c.bgScroll[7] = y;
}

/** 0x08050688: what Route 99's acts do with the backgrounds. */
function actBackgrounds(c, layers) {
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  c.bgScroll[6] = 0;
  c.bgScroll[7] = 0;
  layers[3].dest = 0xC000;
  layers[3].layoutVram = 0xE800;
  c.bgCnt[3] = 0x1D0E;
  layers[0].dest = 0x8000;
  layers[0].layoutVram = 0xA000;
  layers[0].targetTilesX = 64;
  layers[0].targetTilesY = 64;
  c.bgCnt[0] = 0x940A;
}
// 0x080D05A4: how far each row of 8 lines of the sky moves against the camera
const SKY_ROWS = 0xD05A4;
const SCREEN_LINES = 160;
/** 0x080506E4 and 0x08050744: the far layer's scroll, line by line, with a shimmer low down, and the near one's. */
function scrollAct(t) {
  const { c, camera, timer } = t.data, { rom } = c;
  c.bgScroll[6] = (camera.x >> 6) & 0xFF;
  c.bgScroll[7] = camera.y >> 9;
  c.bgScroll[0] = (camera.x << 21 >>> 23);
  c.bgScroll[1] = Math.max(0, Math.min(0x160, camera.y >> 3));
  const lines = new Uint16Array(SCREEN_LINES), scrollY = c.bgScroll[7];
  let shimmer = (timer & 0x7F) >> 3;
  for (let y = 0; y < SCREEN_LINES; y++) {
    const line = y + scrollY;
    let x = (camera.x >> (7 - rom.u8(SKY_ROWS + (line >> 3)))) & 0xFF;
    if (line > 0x90) {
      if (!(shimmer & 1)) x++;
      shimmer = (shimmer + 1) & 0xF;
    } else if (line > 0x80) {
      if (!(shimmer & 2)) x++;
      shimmer = (shimmer + 1) & 0xF;
    }
    lines[y] = x;
  }
  c.lineScroll = lines;
}

/** 0x0804F73C, InitCamera: the layers and where the camera starts. */
function initCamera(stage) {
  const { c, level } = stage, { rom } = c;
  c.dispCnt = 0x40;
  stage.dispBits = 0x1600;
  c.bgCnt[1] = 0x1E00;
  c.bgCnt[2] = 0x1F01;
  const layers = [3, 0, 1, 2].map(i => backgroundFrom(rom, BG_TEMPLATES + i * BG_SIZE));
  stage.layers = layers;
  for (let i = 0; i < 2; i++) {
    layers[i + 1].tilemapId = tilemapOf(level, i);
    drawStageBackground(c, layers[i + 1]);
  }
  if (stage.act === HUB) {
    overworldBackgrounds(c, layers);
    c.createTask(scrollOverworld, stage, 0x1002);
  } else {
    actBackgrounds(c, layers);
    c.createTask(scrollAct, stage, 0x1002);
  }
  const tilemaps = 0xD0624;
  if (rom.u32(tilemaps + tilemapOf(level, 2) * 4)) {
    layers[3].tilemapId = tilemapOf(level, 2);
    drawStageBackground(c, layers[3]);
    stage.dispBits |= 0x800;
  }
  if (rom.u32(tilemaps + tilemapOf(level, 3) * 4)) {
    layers[0].tilemapId = tilemapOf(level, 3);
    drawStageBackground(c, layers[0]);
    stage.dispBits |= 0x100;
  }
  const camera = stage.camera;
  const spawn = rom.u32(RESPAWN + level * 4) - 0x08000000;
  stage.respawnX = rom.u16(spawn + stage.warpId * 4);
  stage.respawnY = rom.u16(spawn + stage.warpId * 4 + 2);
  camera.x = Math.max(0, stage.respawnX - DISPLAY_W / 2);
  camera.y = Math.max(0, stage.respawnY - (DISPLAY_H / 2 + 4));
  camera.maxX = rom.u16(CAMERA_MAX + level * 4);
  camera.maxY = rom.u16(CAMERA_MAX + level * 4 + 2);
  Object.assign(camera, cameraMemory());
  useCollision(rom, level);
  c.createTask(updateCamera, stage, 0x1000);
  c.createTask(showLayers, stage, 0x1001);
}

// 0x080516D4 and 0x08051704: the layers on from the first frame, then the camera's place as their scroll
function showLayers(t) {
  const stage = t.data, { c } = stage;
  c.dispCnt |= stage.dispBits;
  t.main = scrollLayers;
  scrollLayers(t);
}
function scrollLayers(t) {
  const { c, camera, layers } = t.data;
  const x = camera.x, y = camera.y;
  c.bgScroll[2] = x % 8;
  c.bgScroll[3] = y % 8;
  layers[1].scrollX = x;
  layers[1].scrollY = y;
  drawStageBackground(c, layers[1]);
  animateTiles(c, layers[1]);
  c.bgScroll[4] = x % 8;
  c.bgScroll[5] = y % 8;
  layers[2].scrollX = x;
  layers[2].scrollY = y;
  drawStageBackground(c, layers[2]);
}

// 0x08057EC8 and 0x08057F08, the fade in from white, brighter by a step every other frame
function createFade(stage) {
  const fade = { brightness: 0, speed: 0x100 };
  const { c } = stage;
  const values = () => {
    c.dispCnt |= 0x2000;
    c.winRegs[0] = 240;
    c.winRegs[2] = 160;
    c.winRegs[4] |= 0x3F;
    c.winRegs[5] |= 0x1F;
    c.bldCnt = 0xBF;
    c.bldAlpha = 0;
    c.bldY = Math.min(32, 32 - (fade.brightness >> 8)) >> 1;
  };
  values();
  c.createTask(t => {
    values();
    if (fade.brightness >= 0x2000) {
      fade.brightness = 0x2000;
      c.bldY = 0;
      stage.state = 3;
      c.destroyTask(t);
    } else {
      fade.brightness = Math.min(0x2000, fade.brightness + fade.speed);
    }
  }, fade, 0x2100);
}

// 0x08066124 and 0x08065FB4: the backgrounds' colours that change on their own, by the stage's time
function createColours(stage, which) {
  const { c } = stage, { rom } = c, count = rom.u16(0xD4EC0 + which * 2), list = rom.u32(0xE2E91C + which * 4) - 0x08000000;
  const steps = new Uint8Array(16), timers = new Uint32Array(16).fill(stage.timer);
  c.createTask(() => {
    for (let i = 0; i < count; i++) {
      const at = list + i * 12, first = rom.u16(at), length = rom.u16(at + 2), total = rom.u16(at + 4), ptr = rom.u32(at + 8) - 0x08000000;
      let step = steps[i], index = step * (length + 1);
      if (((stage.timer - timers[i]) >>> 0) > rom.u16(ptr + index * 2) + 1) {
        index += 1 + length;
        if (step + 1 >= total) index = 0;
        for (let k = 0; k < length; k++) c.bgPalette[(first + k) & 0xFF] = rom.u16(ptr + (index + 1 + k) * 2);
        c.flags |= 1;
        timers[i] = stage.timer;
        if (++step >= total) step = 0;
        steps[i] = step;
      }
    }
  }, null, 0x2100);
}

const SEGMENT_TILES = 4, SEGMENT_BYTES = 32 * SEGMENT_TILES;
/** The answer of a heap with no room: past the end of video memory, where a copy to it shows nothing (core.js). */
const NO_TILES = 0x18000;

// 0x080C2E9C, VramMalloc, and 0x080C2F7C, VramFree: sprite memory in segments of 4 tiles, the first stretch that fits each time
function createTileHeap(start, slots) {
  const segments = slots >> 2, used = new Uint16Array(256);
  return {
    alloc(tiles) {
      const count = (tiles + SEGMENT_TILES - 1) >> 2;
      for (let i = 0; i < segments; i++) {
        if (used[i] !== 0) {
          i += used[i] - 1;
          continue;
        }
        let j = 0;
        for (; j < count; j++) {
          if (i + j >= segments) return NO_TILES;
          if (used[i + j] !== 0) break;
        }
        if (j === count) {
          used[i] = count;
          return start + i * SEGMENT_BYTES;
        }
      }
      return NO_TILES;
    },
    free(at) {
      if (at !== NO_TILES) used[(at - start) / SEGMENT_BYTES] = 0;
    },
  };
}

/** 0x08002988: what a stage has so far, from its first frame. An act's song starts in the white frame before its first picture. */
export function startStage(c, level) {
  if (level % 10 < FIRST_ACT) return buildStage(c, level);
  c.playSong(SONG_ROUTE_99_ACT_1);
  c.main = () => buildStage(c, level);
}
function buildStage(c, level) {
  const zone = Math.trunc((level - 1) / 10);
  const stage = { c, level, warpId: 0, playerIndex: 0, timer: 0, levelTimer: 0, rings: 0, ringEffects: 0, players: [], zone, act: level - zone * 10, camera: { x: 0, y: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }, state: 1, layers: null, dispBits: 0, keys: 0, lives: 2 };
  // 0x08003E44: the tiles sprites ask for come from here, to the end of sprite memory
  const heap = createTileHeap(0x10000 + 0x4D80, (0x8000 - 0x4D80) >> 5);
  stage.allocTiles = heap.alloc;
  stage.freeTiles = heap.free;
  createStageUi(stage, SONIC, TAILS);
  // 0x08002618 and Task_StageMusicManager: the overworld's song, as the task's first frame starts it
  if (stage.act === HUB) {
    c.createTask(t => {
      c.playSong(SONG_ROUTE_99);
      c.destroyTask(t);
    }, null, 0x4000);
  }
  const build = t => {
    const entities = () => createEntities(stage);
    if (stage.act >= FIRST_ACT) createRings(stage);
    initCamera(stage);
    // the stage draws one more of the game's numbers than the partners' two as it starts, as character-running shows,
    // though which of its functions draws it isn't known yet (notes/a-stage-draws-one-more-number.md)
    c.random();
    const sonic = createPlayer(stage, 0, SONIC, true), tails = createPlayer(stage, 1, TAILS, false);
    stage.players = [sonic, tails];
    initializePlayer(c, sonic);
    initializePlayer(c, tails);
    entities();
    if (stage.act === HUB) {
      createColours(stage, stage.zone + 9);
      createFade(stage);
    } else {
      createColours(stage, stage.zone);
      createTitleCard(stage);
    }
    // 0x08002BBC: the frames the stage has run, and the time, once a player can move
    t.main = () => {
      stage.timer++;
      if (stage.state === 3) stage.levelTimer++;
    };
    // building an act takes the original the next frame too, so it shows its first picture twice
    if (stage.act >= FIRST_ACT) c.slowFrames = 1;
  };
  c.createTask(build, stage, 0x100);
  return stage;
}
