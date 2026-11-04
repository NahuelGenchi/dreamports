// A stage as the original sets one up, so far Route 99's overworld with no characters: its layers, where the camera
// starts, the fade in and the numbers. Rewritten from 0x08002988, with InitCamera at 0x0804F73C. Nothing moves the
// camera yet, as that follows the player (UpdateCamera), who isn't ported.

import { backgroundFrom, drawStageBackground, animateTiles } from './map.js';
import { createStageUi } from './ui.js';

// gStageCameraBgTemplates, in the order the camera keeps them (0x0804F73C), and how each level's layers are numbered
const BG_TEMPLATES = 0xD0120, BG_SIZE = 0x40;
const tilemapOf = (level, n) => level * 4 + n;
const CAMERA_MAX = 0xD0220, RESPAWN = 0xD13C8;
const DISPLAY_W = 240, DISPLAY_H = 160;
const SONIC = 0, TAILS = 2;

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
  overworldBackgrounds(c, layers);
  c.createTask(scrollOverworld, stage, 0x1002);
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
  stage.respawnX = rom.u16(spawn);
  stage.respawnY = rom.u16(spawn + 2);
  camera.x = Math.max(0, stage.respawnX - DISPLAY_W / 2);
  camera.y = Math.max(0, stage.respawnY - (DISPLAY_H / 2 + 4));
  camera.maxX = rom.u16(CAMERA_MAX + level * 4);
  camera.maxY = rom.u16(CAMERA_MAX + level * 4 + 2);
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

/** 0x08002988: what a stage has so far, from its first frame. */
export function startStage(c, level) {
  const stage = { c, level, zone: Math.trunc((level - 1) / 10), camera: { x: 0, y: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 }, state: 1, layers: null, dispBits: 0, keys: 0, lives: 2 };
  // 0x08003E44: the tiles sprites ask for come from here, to the end of sprite memory (VramMalloc)
  let free = 0x10000 + 0x4D80;
  stage.allocTiles = count => {
    const at = free;
    free += count * 32;
    return at;
  };
  createStageUi(stage, SONIC, TAILS);
  c.createTask(t => {
    initCamera(stage);
    createFade(stage);
    c.destroyTask(t);
  }, stage, 0x100);
  return stage;
}
