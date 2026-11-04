// The rings a stage has: drawing those the camera can see, taking those the character touches, with their sparkle, their
// sound and the number going up. Rewritten from 0x08007E10, CreateStageRingsManager, 0x08007F1C, Task_RingsMgrMain, and
// 0x0800AEA0, CreateCollectRingEffect, with 0x0800AFD0, Task_CollectRingEffect. The way the rings are read and drawn comes
// from Sonic Advance 3 Dreamport's stage/rings.js.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';

const RING_DATA = 0xD4BFC;   // gSpritePosData_rings, for each level
const ANIM_RING = 726, ANIM_COLLECT = 727, OBJ_VRAM = 0x10000;
const TAKEN = 0xFE, LIST_END = 0xFF;   // in a ring's x: MAP_ENTITY_STATE_INITIALIZED and MAP_ENTITY_STATE_ARRAY_END
const REGION = 256, TILE = 8, DISPLAY_W = 240, DISPLAY_H = 160;
const SE_RING = 117, SE1 = 1, SE2 = 2, MOST_EFFECTS = 8;   // se_ring_copy, on the two players it takes turns on
const RING_FLAGS = 0x42200;   // SPRITE_FLAG(PRIORITY, 2) | SPRITE_FLAG_MASK_18 | SPRITE_FLAG_MASK_MOSAIC

// 0x08097130, RLUnCompWram: the BIOS's run-length decompression
export function unRle(rom, at) {
  const size = rom.u32(at) >>> 8, out = new Uint8Array(size);
  let src = at + 4, dest = 0;
  while (dest < size) {
    const flag = rom.u8(src++);
    if (flag & 0x80) {
      const n = (flag & 0x7F) + 3, v = rom.u8(src++);
      out.fill(v, dest, dest + n);
      dest += n;
    } else {
      const n = (flag & 0x7F) + 1;
      out.set(rom.bytes.subarray(src, src + n), dest);
      src += n;
      dest += n;
    }
  }
  return new DataView(out.buffer);
}

/** 0x08007E10, CreateStageRingsManager */
export function createRings(stage) {
  const { c } = stage, { rom } = c;
  const data = unRle(rom, rom.u32(RING_DATA + stage.level * 4) - 0x08000000);
  const rings = {
    stage, data, regionsX: data.getUint32(4, true) & 0xFFFF, regionsY: data.getUint32(8, true) & 0xFFFF, effects: 0,
    sprite: createSprite({ tiles: OBJ_VRAM + 0x1F00, anim: ANIM_RING, frameFlags: RING_FLAGS, oamFlags: 20 << 6, oamBaseIndex: 0xFF }),
  };
  c.createTask(ringsFrame, rings, 0x2000);
  return rings;
}

// where a region's list of rings starts, or 0 if it has none: READ_START_INDEX, then DATA_START
const listOf = (rings, rx, ry) => {
  const offset = rings.data.getUint32(12 + (rings.regionsX * ry + rx) * 4, true);
  return offset === 0 ? 0 : 4 + offset;
};

// RECT_TOUCHING_RING
function touching(left, top, width, height, x, y) {
  return ((x - TILE <= left && x + TILE >= left) || (x - TILE >= left && left + width >= x - TILE))
    && ((y - 2 * TILE <= top && y >= top) || (y - 2 * TILE >= top && top + height >= y - 2 * TILE));
}

// INCREMENT_RINGS: a life every hundred rings, though the jingle that comes with it needs the music manager, which isn't made
function addRing(stage) {
  const before = stage.rings;
  stage.rings = (before + 1) & 0xFFFF;
  if (Math.trunc(stage.rings / 100) !== Math.trunc(before / 100)) stage.lives = Math.min(stage.lives + 1, 255);
}

function takeRings(rings) {
  const { stage, data, regionsX, regionsY } = rings, { player } = stage;
  const x = player.x >> 8, y = player.y >> 8, w = player.halfWidth, h = player.halfHeight;
  // regions are unsigned in the original, so near the stage's edges a first one below 0 is past the last, and none is looked at
  for (let ry = ((y - h) >> 8) & 0xFFFF; ry <= (y + h + TILE) >> 8 && ry < regionsY; ry++) {
    for (let rx = ((x - w - TILE) >> 8) & 0xFFFF; rx <= (x + w + 2 * TILE) >> 8 && rx < regionsX; rx++) {
      let at = listOf(rings, rx, ry);
      if (at === 0) continue;
      for (; data.getUint8(at) !== LIST_END; at += 2) {
        if (data.getUint8(at) === TAKEN) continue;
        const ringX = data.getUint8(at) * TILE + rx * REGION, ringY = data.getUint8(at + 1) * TILE + ry * REGION;
        if (!touching(x - w, y - h, w * 2, h * 2, ringX, ringY)) continue;
        addRing(stage);
        createEffect(rings, ringX, ringY);
        data.setUint8(at, TAKEN);
      }
    }
  }
}

function drawRings(rings) {
  const { stage, data, regionsX, regionsY, sprite: s } = rings, { c, camera: cam } = stage, m = c.oamMalloc, { rom } = c;
  const offsetX = rom.s16(s.dimensions + 8), offsetY = rom.s16(s.dimensions + 10);
  let drawn = 0;
  for (let ry = cam.y >> 8; ry * REGION < cam.y + DISPLAY_H && ry < regionsY; ry++) {
    for (let rx = cam.x >> 8; rx * REGION < cam.x + DISPLAY_W && rx < regionsX; rx++) {
      let at = listOf(rings, rx, ry);
      if (at === 0) continue;
      for (; data.getUint8(at) !== LIST_END; at += 2) {
        if (data.getUint8(at) === TAKEN) continue;
        const x = data.getUint8(at) * TILE + rx * REGION - cam.x, y = data.getUint8(at + 1) * TILE + ry * REGION - cam.y;
        if (x < -TILE || x + TILE > DISPLAY_W + 2 * TILE || y < 0 || y - 2 * TILE > DISPLAY_H) continue;
        if (drawn === 0 || s.oamBaseIndex === 0xFF) {
          s.oamBaseIndex = 0xFF;
          s.x = x;
          s.y = y;
          displaySprite(c, s);
        } else {
          // the first ring's entry, at this one's place
          const k = c.allocOam(20);
          if (k < 0) return;
          const from = s.oamBaseIndex * 4;
          m[k * 4] = (m[from] & 0xFF00) + ((y - offsetY) & 0xFF);
          m[k * 4 + 1] = (m[from + 1] & 0xFE00) + ((x - offsetX) & 0x1FF);
          m[k * 4 + 2] = m[from + 2];
        }
        drawn++;
      }
    }
  }
}

// 0x08007F1C, Task_RingsMgrMain, with one character alive on a stage that isn't a boss's or the extra one
function ringsFrame(t) {
  const rings = t.data;
  updateSprite(rings.stage.c, rings.sprite);
  takeRings(rings);
  drawRings(rings);
}

// 0x0800AEA0, CreateCollectRingEffect: it stays where the ring was, and its sound takes turns between the two sides
function createEffect(rings, x, y) {
  if (rings.effects >= MOST_EFFECTS) return;
  const { stage } = rings, { c } = stage, odd = stage.rings & 1;
  rings.effects++;
  const s = createSprite({ tiles: OBJ_VRAM + 0x2100, anim: ANIM_COLLECT, frameFlags: 2 << 12, oamFlags: 15 << 6 });
  c.playOn(odd ? SE2 : SE1, SE_RING, 128, odd ? -64 : 64);
  c.createTask(t => {
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    // 0x0800AFD0, Task_CollectRingEffect: as it ends, its last frame goes in twice
    if (updateSprite(c, s) === 0) {
      displaySprite(c, s);
      rings.effects--;
      c.destroyTask(t);
    }
    displaySprite(c, s);
  }, null, 0x2000);
}
