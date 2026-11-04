// What a stage places on its map as the camera comes near: of its interactables so far only its springs, and of its enemies
// Leaf Forest's three, as its other interactables, its item boxes and other enemies aren't made. Rewritten from 0x0800888C, CreateStageEntitiesManager, 0x080089CC,
// SpawnMapEntities, and 0x08008DCC, Task_8008DCC.

import { unRle } from './rings.js';
import { createSpring } from './spring.js';
import { createMon, createKiki, createBuzzer } from './enemies.js';

const INTERACTABLES = 0xD4C84, ENEMIES = 0xD4D94;   // gSpritePosData_interactables and gSpritePosData_enemies, for each level
const REGION = 256, TILE = 8, ENTRY = 7, DISPLAY_W = 240, DISPLAY_H = 160;
const NEAR = 128, FAR_X = 248, FAR_Y = 208;   // how far past the screen things come in, and how far the camera has to jump for all of it to be looked at again
const LIST_END = 0xFF;   // in an entry's x: MAP_ENTITY_STATE_ARRAY_END
const s8 = v => (v << 24) >> 24;

// gSpriteInits_Interactables, by an entry's index: each kind of spring, as the spring's own numbers have it
const SPRINGS = { 3: 0, 4: 1, 5: 3, 6: 2, 7: 4, 8: 5, 9: 7, 10: 6, 11: 9, 12: 8 };
// gSpriteInits_Enemies, by an entry's index
const MAKERS = { 0: createMon, 1: createKiki, 2: createBuzzer };

/** 0x0800888C, CreateStageEntitiesManager */
export function createEntities(stage) {
  const { c } = stage, { rom } = c, cam = stage.camera;
  const data = unRle(rom, rom.u32(INTERACTABLES + stage.level * 4) - 0x08000000);
  const em = {
    stage, data, enemies: unRle(rom, rom.u32(ENEMIES + stage.level * 4) - 0x08000000), regionsX: data.getUint32(4, true) & 0xFFFF, regionsY: data.getUint32(8, true) & 0xFFFF,
    prevX: cam.x, prevY: cam.y, firstTime: true,
  };
  c.createTask(entitiesFrame, em, 0x2000);
  return em;
}

// the stretch of the map from low to high, kept within the map
function clampRange(em, { lowX, highX, lowY, highY }) {
  const lastX = em.regionsX * REGION - 1, lastY = em.regionsY * REGION - 1;
  const inX = v => Math.min(Math.max(v, 0), lastX), inY = v => Math.min(Math.max(v, 0), lastY);
  return { lowX: inX(lowX), highX: inX(highX), lowY: inY(lowY), highY: inY(highY) };
}

// what a region's list has that lies within a range, each given to `place`
function eachInRegion(list, regionsX, rx, ry, { lowX, highX, lowY, highY }, place) {
  const offset = list.getUint32(12 + (regionsX * ry + rx) * 4, true);
  if (offset === 0) return;
  for (let at = 4 + offset; list.getUint8(at) !== LIST_END; at += ENTRY) {
    if (s8(list.getUint8(at)) < -2) continue;
    const x = list.getUint8(at) * TILE + rx * REGION, y = list.getUint8(at + 1) * TILE + ry * REGION;
    if (x >= lowX && x <= highX && y >= lowY && y <= highY) place(at);
  }
}

// what's listed in the regions a range touches and lies within it: in each region its interactables, then its enemies
function spawnRange(em, range) {
  const { data, enemies, regionsX, regionsY, stage } = em, { lowX, highX, lowY, highY } = range;
  for (let ry = lowY >> 8; ry * REGION < highY && ry < regionsY; ry++) {
    for (let rx = lowX >> 8; rx * REGION < highX && rx < regionsX; rx++) {
      eachInRegion(data, regionsX, rx, ry, range, at => {
        const spring = SPRINGS[data.getUint8(at + 2)];
        if (spring !== undefined) createSpring(stage, data, at, rx, ry, spring);
      });
      eachInRegion(enemies, regionsX, rx, ry, range, at => MAKERS[enemies.getUint8(at + 2)]?.(stage, enemies, at, rx, ry));
    }
  }
}

// 0x080089CC, SpawnMapEntities: everything near the camera
function spawnAround(em) {
  const cam = em.stage.camera;
  spawnRange(em, clampRange(em, { lowX: cam.x - NEAR, highX: cam.x + DISPLAY_W + NEAR, lowY: cam.y - NEAR, highY: cam.y + DISPLAY_H + NEAR }));
  em.prevX = cam.x;
  em.prevY = cam.y;
  em.firstTime = false;
}

// 0x08008DCC, Task_8008DCC: what the camera has come near since the last frame, the stretch it moved across and then the one it moved up or down
function entitiesFrame(t) {
  const em = t.data, cam = em.stage.camera;
  if (em.firstTime || Math.abs(cam.x - em.prevX) > FAR_X || Math.abs(cam.y - em.prevY) > FAR_Y) {
    spawnAround(em);
    return;
  }
  const across = clampRange(em, {
    lowX: cam.x > em.prevX ? em.prevX + DISPLAY_W + NEAR : cam.x - NEAR, highX: cam.x > em.prevX ? cam.x + DISPLAY_W + NEAR : em.prevX - NEAR,
    lowY: cam.y - NEAR, highY: cam.y + DISPLAY_H + NEAR,
  });
  const upDown = clampRange(em, {
    lowX: cam.x - NEAR, highX: cam.x + DISPLAY_W + NEAR,
    lowY: cam.y > em.prevY ? em.prevY + DISPLAY_H + NEAR : cam.y - NEAR, highY: cam.y > em.prevY ? cam.y + DISPLAY_H + NEAR : em.prevY - NEAR,
  });
  if (cam.x !== em.prevX && across.lowX !== across.highX && across.lowY !== across.highY) spawnRange(em, across);
  if (cam.y !== em.prevY && upDown.lowY !== upDown.highY && upDown.lowX !== upDown.highX) spawnRange(em, upDown);
  em.prevX = cam.x;
  em.prevY = cam.y;
}
