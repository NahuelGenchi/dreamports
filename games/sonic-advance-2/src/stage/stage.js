// A stage as the original sets one up, so far Leaf Forest's act 1 as far as a player can start to move: its layers, where
// the camera starts, the numbers, the countdown and Sonic. Rewritten from 0x0801A838, what starts a stage, with 0x0801C068,
// InitCamera. A stage's title card isn't made yet, so it opens as a player's A or B press on its first frame leaves it.

import { backgroundFrom, drawStageBackground, animateTiles } from './map.js';
import { useCollision } from './collision.js';
import { updateCamera, cameraMemory } from './camera.js';
import { createPlayer } from './player.js';
import { createStageUi } from './ui.js';
import { createCountdown } from './countdown.js';
import { createRings } from './rings.js';
import { createRingsScatter } from './rings-scatter.js';
import { createEntities } from './entities.js';
import { createSprite, updateSprite } from '../sprite.js';

// gStageCameraBgTemplates, in the order the camera keeps them, and how each level's layers are numbered
const BG_TEMPLATES = 0xD5864, BG_SIZE = 0x40;
const tilemapOf = (level, n) => level * 3 + n;
const LEVEL_SIZE = 0xD62D8, SKY_TILEMAP = 113;
const DISPLAY_W = 240, DISPLAY_H = 160, SKY_LINES = 72, SCREEN_LINES = 159;
const CHARACTER_COLOURS = 0xD6FF5, ANIM_LEAF_FOREST_COLOURS = 897, SONG_LEAF_FOREST_1 = 13;
const SEGMENT_TILES = 4, SEGMENT_BYTES = 32 * SEGMENT_TILES, HEAP_START = 0x14000 - 48 * 32;   // gVramHeapStartAddr
// how many frames into a stage its song is first heard in the original, as prove measures it
const SONG_WAIT = 5;
const FIRST_OAM_MATRIX = 4;   // gOamMatrixIndex, each frame, as those below it are the characters'

// 0x08007C10, VramMalloc, and VramFree: sprite memory in segments of 4 tiles, the first stretch that fits each time
function createTileHeap(start, slots) {
  const used = new Uint16Array(slots);
  return {
    alloc(tiles) {
      const count = (tiles + SEGMENT_TILES - 1) >> 2;
      for (let i = 0; i + count <= slots; i++) {
        if (used[i] !== 0) {
          i += used[i] - 1;
          continue;
        }
        let j = 0;
        while (j < count && used[i + j] === 0) j++;
        if (j === count) {
          used[i] = count;
          return start + i * SEGMENT_BYTES;
        }
      }
      throw new Error('Sprite memory is full.');
    },
    free(tiles) {
      used[(tiles - start) / SEGMENT_BYTES] = 0;
    },
  };
}

/** 0x0801C068, InitCamera: the layers and where the camera starts. */
function initCamera(stage) {
  const { c, level, player } = stage, { rom } = c;
  c.dispCnt = 0x3F40;
  c.bgCnt[0] = 0x1B0F;
  c.bgCnt[1] = 0x1E01;
  c.bgCnt[2] = 0x1F02;
  c.bgCnt[3] = 0x1D0B;
  const layers = [0, 1, 2, 3].map(i => backgroundFrom(rom, BG_TEMPLATES + i * BG_SIZE));
  stage.front = layers[0];
  stage.back = layers[1];
  layers[0].tilemapId = tilemapOf(level, 0);
  layers[1].tilemapId = tilemapOf(level, 1);
  layers[2].tilemapId = tilemapOf(level, 2);
  layers[2].dest = 0x8000;
  layers[2].layoutVram = 0xE800;
  layers[2].targetTilesX = 32;
  layers[2].targetTilesY = 32;
  for (let i = 0; i < 3; i++) drawStageBackground(c, layers[i]);
  // the far background, Leaf Forest's own
  layers[3].tilemapId = SKY_TILEMAP;
  layers[3].dest = 0xC000;
  layers[3].layoutVram = 0xD800;
  layers[3].targetTilesX = 32;
  layers[3].targetTilesY = 32;
  drawStageBackground(c, layers[3]);
  useCollision(rom, level);
  const size = rom.u32(LEVEL_SIZE + level * 4) - 0x08000000, cam = stage.camera;
  cam.minX = 0;
  cam.minY = 0;
  cam.maxX = rom.u32(size + 28);
  cam.maxY = rom.u32(size + 32);
  cam.x = Math.max(0, (player.x >> 8) - DISPLAY_W / 2);
  cam.y = Math.max(0, (player.y >> 8) - (DISPLAY_H / 2 + 4));
  Object.assign(cam, cameraMemory(player));
  c.createTask(cameraFrame, stage, 0xF00);
}

// 0x0801E0A8, then RenderMetatileLayers and Leaf Forest's backgrounds
function cameraFrame(t) {
  const stage = t.data, { c, camera: cam } = stage;
  stage.oamMatrix = FIRST_OAM_MATRIX;
  updateCamera(stage);
  c.bgScroll[2] = cam.x % 8;
  c.bgScroll[3] = cam.y % 8;
  stage.front.scrollX = cam.x;
  stage.front.scrollY = cam.y;
  drawStageBackground(c, stage.front);
  animateTiles(c, stage.front);
  c.bgScroll[4] = cam.x % 8;
  c.bgScroll[5] = cam.y % 8;
  stage.back.scrollX = cam.x;
  stage.back.scrollY = cam.y;
  drawStageBackground(c, stage.back);
  c.bgScroll[0] = (cam.x >> 6) & 0xFF;
  c.bgScroll[1] = cam.y >> 9;
  // the sky stays still and what's below it scrolls, a line at a time
  const nearX = cam.x >> 7, nearY = cam.y >> 8;
  c.bgScroll[6] = nearX;
  // StageBgUpdate_Zone1Acts12 writes all but the screen's last line, which stays at 0, and shows when nothing covers it
  const lines = new Uint16Array((SCREEN_LINES + 1) * 2);
  for (let y = SKY_LINES; y < SCREEN_LINES; y++) {
    lines[y * 2] = nearX;
    lines[y * 2 + 1] = nearY;
  }
  c.lineScroll = lines;
}

// Task_StagePaletteLoader: an animation that only sets colours, until it ends
function createColourLoader(c, anim) {
  const s = createSprite({ anim, variant: 0, backgroundColours: true });
  c.createTask(t => {
    if (updateSprite(c, s) === 0) c.destroyTask(t);
  }, null, 0x2000);
}

// 0x0802F75C, with a button pressed, and what the title card's other tasks do as that ends them: the numbers and the
// countdown, the character's colours, and the windows off. The card itself isn't made
function leaveTitleCard(t) {
  const stage = t.data, { c } = stage, { rom } = c;
  c.destroyTask(t);
  createCountdown(stage);
  createStageUi(stage);
  for (let i = 0; i < 16; i++) {
    const at = CHARACTER_COLOURS + i * 3;
    c.objPalette[i] = rom.u8(at) | rom.u8(at + 1) << 5 | rom.u8(at + 2) << 10;
  }
  c.flags |= 0x2;
  c.bldCnt = 0;
  c.bldAlpha = 0;
  c.bldY = 0;
  c.winRegs[0] = 0xF0F0;
  c.winRegs[1] = 0xF0F0;
  c.winRegs[2] = 0xA0A0;
  c.winRegs[3] = 0xA0A0;
  c.winRegs[4] = 0;
  c.winRegs[5] = 0;
  c.dispCnt &= ~0xE000;
  c.lineScroll = null;
  c.bgPalette[0] = 0x7C00;   // the character's colour, behind everything
  c.flags |= 0x1;
}

// the song, by the task that looks after a stage's music
function startSong(c) {
  let wait = SONG_WAIT;
  c.createTask(t => {
    if (wait-- > 0) return;
    c.playSong(SONG_LEAF_FOREST_1);
    c.destroyTask(t);
  }, null, 0x4000);
}

/** 0x0801A838: what a stage has so far, from its first frame. */
export function startStage(c, level) {
  const stage = {
    c, level, time: 0, timeRuns: false, frames: 0, rings: 0, score: 0, lives: 3, oamMatrix: FIRST_OAM_MATRIX, seed: 0, animalTurn: 0,
    camera: { x: 0, y: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }, front: null, back: null, player: null, ui: null,
  };
  // sprite memory past what the character, the rings and the water keep for themselves
  const heap = createTileHeap(HEAP_START, 140);
  stage.allocTiles = heap.alloc;
  stage.freeTiles = heap.free;
  // PSEUDO_RANDOM_32
  stage.random = () => {
    stage.seed = (Math.imul(stage.seed, 0x196225) + 0x3C6EF35F) | 0;
    return stage.seed;
  };
  // 0x0801AB3C: the frames the stage has run, and the time, once a player can move
  c.createTask(() => {
    stage.frames++;
    if (stage.timeRuns) stage.time++;
  }, null, 0xFF00);
  stage.player = createPlayer(stage, level);
  createRingsScatter(stage);
  c.createTask(leaveTitleCard, stage, 0x2200);
  initCamera(stage);
  stage.ringsManager = createRings(stage);
  // the entities manager comes after the rings: a ring's sparkle comes after it, and so runs in the frame the ring is taken,
  // rather than right after the rings, which would wait for the next
  createEntities(stage);
  createColourLoader(c, ANIM_LEAF_FOREST_COLOURS);
  startSong(c);
  return stage;
}
