// The rings a stage has where the camera can see them. Rewritten from CreateStageRingsManager, at 0x08029B10, and
// Task_RingsMgrStage, at 0x08029E10. Taking them comes next, as its own piece.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { unRle } from './entities.js';

const RING_DATA = 0xCEBD0, ANIM_RING = 1333, OBJ_VRAM = 0x10000;
const REGION = 256, TILE = 8, DISPLAY_W = 240, DISPLAY_H = 160;

export function createRings(stage) {
  const { c } = stage, { rom } = c;
  const data = unRle(rom, rom.u32(RING_DATA + stage.level * 4) - 0x08000000);
  const s = createSprite({ tiles: OBJ_VRAM + 0x4180, frameFlags: 0x41200, anim: ANIM_RING, x: DISPLAY_W / 2, y: DISPLAY_H / 2, oamFlags: 0x280 });
  const regionsX = data.getUint32(4, true) & 0xFFFF, regionsY = data.getUint32(8, true) & 0xFFFF;
  c.createTask(() => drawRings(stage, s, data, regionsX, regionsY), null, 0x2800);
}

function drawRings(stage, s, data, regionsX, regionsY) {
  const { c, camera: cam } = stage, m = c.oamMalloc, table = 12;
  let drawn = 0;
  updateSprite(c, s);
  const offset = spriteOffset(c, s);
  for (let ry = cam.y >> 8; ry * REGION < cam.y + DISPLAY_H && ry < regionsY; ry++) {
    for (let rx = cam.x >> 8; rx * REGION < cam.x + DISPLAY_W && rx < regionsX; rx++) {
      const start = data.getUint32(table + (regionsX * ry + rx) * 4, true);
      if (start === 0) continue;
      for (let at = table + start - 8; data.getUint8(at) !== 0xFF; at += 2) {
        if (data.getUint8(at) === 0xFE) continue;
        const x = data.getUint8(at) * TILE + rx * REGION - cam.x, y = data.getUint8(at + 1) * TILE + ry * REGION - cam.y;
        if (x < -TILE || x + TILE > DISPLAY_W + 2 * TILE || y < 0 || y - 2 * TILE > DISPLAY_H) continue;
        if (drawn === 0 || s.oamBaseIndex === 0xFF) {
          s.oamBaseIndex = 0xFF;
          s.x = x;
          s.y = y;
          displaySprite(c, s);
        } else {
          // the first ring's entry, at this one's place
          const k = c.allocOam((s.oamFlags & 0x7C0) >> 6);
          if (k < 0) return;
          const from = s.oamBaseIndex * 4;
          m[k * 4] = (m[from] & 0xFF00) + ((y - offset.y) & 0xFF);
          m[k * 4 + 1] = (m[from + 1] & 0xFE00) + ((x - offset.x) & 0x1FF);
          m[k * 4 + 2] = m[from + 2];
        }
        drawn++;
      }
    }
  }
}

// what a sprite's frame says about where its anchor is
function spriteOffset(c, s) {
  const { rom } = c, tables = 0x3314F0;
  const list = rom.u32(rom.u32(tables + 4) - 0x08000000 + s.anim * 4) - 0x08000000;
  const d = list + (s.frameNum >>> 28 === 0 ? s.frameNum * 12 : (s.frameNum & 0xFFFFFFF) * 16);
  return { x: rom.s16(d + 8), y: rom.s16(d + 10) };
}
