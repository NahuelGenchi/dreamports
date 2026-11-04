// What stands in a stage: its map lists objects by regions of 256 pixels, and those near the camera get a task
// (entities_manager.c: CreateStageEntitiesManager, 0x0802B7B8, and its tasks). So far the overworld's big rings and Omochao.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { isArriving } from './player.js';

const INTERACTABLES = 0xD0E9C;
const ANIM_FACTORY_RING = 911, ANIM_OMOCHAO = 977, ANIM_ACT_RING = 983;
const REGION = 256, TILE = 8, BREAKABLE_WALLS = 0xCF208;

// RLUnCompWram, the BIOS's run-length decompression
function unRle(rom, at) {
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

/** Task_EntitiesManagerInit and SpawnMapEntities, for the objects near the camera. */
export function createEntities(stage) {
  const { c } = stage, { rom, } = c;
  const data = unRle(rom, rom.u32(INTERACTABLES + stage.level * 4) - 0x08000000);
  const regionsX = data.getUint32(4, true) & 0xFFFF, regionsY = data.getUint32(8, true) & 0xFFFF, table = 12;
  const manager = { stage, data, regionsX, regionsY, table, prevX: 0, prevY: 0, first: true };
  c.createTask(spawnNear, manager, 0x2000);
  stage.entities = manager;
  return manager;
}

function spawnNear(t) {
  const m = t.data, { stage } = m, cam = stage.camera;
  const near = { xLow: cam.x - 128, xHigh: cam.x + 368, yLow: cam.y - 128, yHigh: cam.y + 288 };
  if (m.first) {
    m.first = false;
    spawn(m, near);
    m.prevX = cam.x;
    m.prevY = cam.y;
    return;
  }
  if (cam.x === m.prevX && cam.y === m.prevY) return;
  // a band in x as the camera moves, and another in y, as Task_EntitiesManagerInit has them
  const bandX = cam.x > m.prevX ? { xLow: m.prevX + 368, xHigh: cam.x + 368 } : { xLow: cam.x - 128, xHigh: m.prevX - 128 };
  const bandY = cam.y > m.prevY ? { yLow: m.prevY + 288, yHigh: cam.y + 288 } : { yLow: cam.y - 128, yHigh: m.prevY - 128 };
  if (cam.x !== m.prevX) spawn(m, { ...bandX, yLow: near.yLow, yHigh: near.yHigh });
  if (cam.y !== m.prevY) spawn(m, { ...bandY, xLow: near.xLow, xHigh: near.xHigh });
  m.prevX = cam.x;
  m.prevY = cam.y;
}

function spawn(m, range) {
  const lim = (v, regions) => Math.max(0, Math.min(v, regions * REGION - 1));
  const xLow = lim(range.xLow, m.regionsX), xHigh = lim(range.xHigh, m.regionsX);
  const yLow = lim(range.yLow, m.regionsY), yHigh = lim(range.yHigh, m.regionsY);
  for (let ry = yLow >> 8; ry * REGION < yHigh && ry < m.regionsY; ry++) {
    for (let rx = xLow >> 8; rx * REGION < xHigh && rx < m.regionsX; rx++) {
      const start = m.data.getUint32(m.table + (m.regionsX * ry + rx) * 4, true);
      if (start === 0) continue;
      for (let at = m.table + start - 8; ; at += 8) {
        const raw = m.data.getInt8(at);
        if (raw === -1) break;
        if (raw < -2) continue;
        const x = m.data.getUint8(at) * TILE + rx * REGION, y = m.data.getUint8(at + 1) * TILE + ry * REGION;
        if (x < xLow || x > xHigh || y < yLow || y > yHigh) continue;
        const create = OBJECTS[m.data.getUint8(at + 2)];
        if (create) create(m, at, x, y);
      }
    }
  }
}

const active = (cam, x, y) => {   // IsWorldPtActive
  const sx = x - cam.x, sy = y - cam.y;
  return !(sx < -128 || sx > 240 + 128 || sy + 128 < 0 || sy > 160 + 128);
};
function leave(t, m, at, meX) {   // SET_MAP_ENTITY_NOT_INITIALIZED, and the task goes
  m.data.setUint8(at, meX);
  m.stage.c.destroyTask(t);
}

// 0x0804.. CreateEntity_ActRing: a big ring, which when you've come out of it pushes you away until the stage starts
function createActRing(m, at, x, y) {
  const { stage } = m, { c } = stage, meX = m.data.getUint8(at), bits = m.data.getUint8(at + 7);
  let act = 0;
  for (; act < 3; act++) if ((bits >> act) & 1) break;
  const s = createSprite({ tiles: stage.allocTiles(64), anim: ANIM_ACT_RING, variant: act, oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    if (isArriving(stage.players[stage.playerIndex]) && stage.warpId === act + 1) {
      for (const p of stage.players) {
        if (bits >> 7) {
          p.qSpeedAirX = -0x400;
          p.moveState |= 1;
        } else {
          p.qSpeedAirX = 0x400;
          p.moveState &= ~1;
        }
      }
    }
    if (!active(stage.camera, x, y)) {
      leave(t, m, at, meX);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x2100);
}

// CreateEntity_FactoryRing and Task_FactoryRingMain: the big ring you come out of when a game starts, which pushes you
// away from it until the stage starts
function createFactoryRing(m, at, x, y) {
  const { stage } = m, { c } = stage, meX = m.data.getUint8(at);
  const s = createSprite({ tiles: stage.allocTiles(36), anim: ANIM_FACTORY_RING, variant: 0, oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    if (isArriving(stage.players[stage.playerIndex]) && stage.warpId === 0) {
      for (const p of stage.players) {
        p.qSpeedAirX = 0x400;
        p.moveState &= ~1;
      }
    }
    if (!active(stage.camera, x, y)) {
      leave(t, m, at, meX);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x2100);
}

// 0x0803.. CreateEntity_Omochao and sub_8038548: Omochao hovering, which picking up isn't ported yet
function createOmochao(m, at, x, y) {
  const { stage } = m, { c } = stage, meX = m.data.getUint8(at);
  const s = createSprite({ tiles: stage.allocTiles(9), anim: ANIM_OMOCHAO, variant: 1, oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    if (!active(stage.camera, x, y)) {
      leave(t, m, at, meX);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x2100);
}

// sub_8020A58: whether a character's box meets the sprite's, and how far it has to go to leave it
function meets(s, worldX, worldY, p, param6) {
  const box = s.hitboxes?.[0];
  const pb = { left: -p.spriteOffsetX, top: -p.spriteOffsetY, right: p.spriteOffsetX, bottom: p.spriteOffsetY };
  const x = p.qWorldX >> 8, y = p.qWorldY >> 8;
  const overlap = worldX + box.left <= x + pb.right && worldX + box.right >= x + pb.left && worldY + box.top <= y + pb.bottom && worldY + box.bottom >= y + pb.top;
  if (!overlap) return 0;
  let r = 0, dx, dy, limit;
  if (((box.left + box.right) >> 1) + worldX <= x) {
    dx = worldX + box.right - (pb.left + x);
    r |= 0x40000;
  } else {
    dx = worldX + box.left - (pb.right + x);
    r |= 0x80000;
  }
  if (worldY + ((box.top + box.bottom) >> 1) > y) {
    dy = worldY + box.top - (y + pb.bottom);
    limit = Math.min(dy + 5, 0);
    r |= 0x10000;
  } else {
    dy = worldY + box.bottom - (y + pb.top);
    limit = Math.max(dy + 2, 0);
    r |= 0x20000;
  }
  if (Math.abs(dx) < Math.abs(limit)) r &= 0xC0000;
  else {
    r &= 0x30000;
    if (r & 0x10000) {
      if (p.qSpeedAirY < 0 && param6 === 0) return 0;
      if (!(p.moveState & 4) && (p.angle + 0x20) & 0x40) p.qSpeedGround = 0;
    }
  }
  r |= ((dx << 8) & 0xFF00) | (dy & 0xFF);
  if (r & 0xC0000) {
    if (!(r & 0xFF00)) r &= 0xFFF300FF;
  } else r &= 0xFFFF00FF;
  if (!(r & 0x30000)) r &= 0xFFFFFF00;
  return r;
}
// sub_8020950: a sprite as something solid
function solid(s, worldX, worldY, p) {
  if (s.hitboxes?.[0] === undefined || s.hitboxes[0].index === -1 || p.moveState & 0x100) return 0;
  let wasOn = false;
  if (p.moveState & 0x20 && p.sprColliding === s) {
    wasOn = true;
    p.moveState &= ~0x20;
    p.moveState |= 4;
  }
  const r = meets(s, worldX, worldY, p, 0);
  if (r) {
    if (r & 0x10000) {
      p.moveState |= 0x20;
      p.moveState &= ~4;
      p.sprColliding = s;
    }
  } else if (wasOn && !(p.moveState & 0x20)) {
    p.moveState &= ~0x40;
    p.moveState |= 4;
    p.sprColliding = null;
  }
  return r;
}
const s8 = v => (v << 24) >> 24;

// CreateEntity_BreakableWall and Task_BreakableWall: a wall that stops a character, which breaking isn't ported yet
function createBreakableWall(m, at, x, y) {
  const { stage } = m, { c } = stage, { rom } = c, meX = m.data.getUint8(at), side = m.data.getUint8(at + 7) >> 7;
  const row = BREAKABLE_WALLS + (stage.zone * 2 + side) * 6;
  const s = createSprite({ tiles: stage.allocTiles(rom.u16(row + 4)), anim: rom.u16(row), variant: rom.u16(row + 2), oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    for (const p of stage.players) {
      if (p.moveState & (0x10000000 | 0x1000000 | 0x100)) continue;
      const r = solid(s, x, y, p);
      if (r & 0x10000) {
        p.qWorldY += s8(r) << 8;
        p.qSpeedAirY = 0;
      } else if (r & 0x20000) {
        p.qWorldY += (s8(r) << 8) + 0x100;
        p.qSpeedAirY = 0;
      }
      if (r & 0xC0000) {
        p.qWorldX += ((r << 16) >> 24) << 8;
        p.qSpeedAirX = 0;
        p.qSpeedGround = 0;
        if (r & 0x40000 && p.keyInput & 0x20) {
          p.qWorldX -= 0x100;
          p.moveState |= 0x40;
        } else if (r & 0x80000 && p.keyInput & 0x10) {
          p.qWorldX += 0x100;
          p.moveState |= 0x40;
        }
      }
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    if (!active(stage.camera, x, y)) {
      for (const p of stage.players) if (p.sprColliding === s) {
        p.moveState = (p.moveState & ~0x20) | 4;
        p.sprColliding = null;
      }
      leave(t, m, at, meX);
      return;
    }
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x2100);
}

// CreateEntity_Toggle_PlayerLayer: an area that puts a character on the front layer of the ground, or the back
function layerToggle(layer) {
  return (m, at, x, y) => {
    const { stage } = m, { c } = stage, meX = m.data.getUint8(at), w = m.data.getUint8(at + 5) * TILE, h = m.data.getUint8(at + 6) * TILE;
    m.data.setInt8(at, -2);
    c.createTask(t => {
      if (!active(stage.camera, x, y)) {
        leave(t, m, at, meX);
        return;
      }
      for (const p of stage.players) {
        const px = p.qWorldX >> 8, py = p.qWorldY >> 8;
        if (x <= px && x + w >= px && y <= py && y + h >= py) p.layer = layer;
      }
    }, null, 0x2000);
  };
}

// gSpriteInits_Interactables, those ported so far
const OBJECTS = { 1: layerToggle(0), 2: layerToggle(1), 57: createBreakableWall, 66: createOmochao, 96: createActRing, 98: createFactoryRing };
