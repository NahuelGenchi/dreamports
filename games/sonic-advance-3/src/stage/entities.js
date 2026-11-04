// What stands in a stage: its map lists objects by regions of 256 pixels, and those near the camera get a task
// (entities_manager.c: CreateStageEntitiesManager, 0x0802B7B8, and its tasks). So far the overworld's big rings and Omochao.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { isArriving, FLAG } from './player.js';

const INTERACTABLES = 0xD0E9C;
const ANIM_FACTORY_RING = 911, ANIM_OMOCHAO = 977, ANIM_ACT_RING = 983;
const REGION = 256, TILE = 8, BREAKABLE_WALLS = 0xCF208, PUSH_OUT = 0x400;

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
function leave(t, m, at, meX, s) {   // SET_MAP_ENTITY_NOT_INITIALIZED, and the task goes, with the sprite's tiles
  m.data.setUint8(at, meX);
  if (s) m.stage.freeTiles(s.tiles);
  m.stage.c.destroyTask(t);
}

// 0x0804.. CreateEntity_ActRing: a big ring, which when you've come out of it pushes you away until the stage starts
function createActRing(m, at, x, y) {
  const { stage } = m, { c } = stage, meX = m.data.getUint8(at), bits = m.data.getUint8(at + 7);
  let act = 0;
  for (; act < 3; act++) if ((bits >> act) & 1) break;
  const s = createSprite({ tiles: stage.allocTiles(16), anim: ANIM_ACT_RING, variant: act, oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    if (isArriving(stage.players[stage.playerIndex]) && stage.warpId === act + 1) {
      for (const p of stage.players) {
        if (bits >> 7) {
          p.velX = -PUSH_OUT;
          p.flags |= FLAG.FACING_LEFT;
        } else {
          p.velX = PUSH_OUT;
          p.flags &= ~FLAG.FACING_LEFT;
        }
      }
    }
    if (!active(stage.camera, x, y)) {
      leave(t, m, at, meX, s);
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
        p.velX = PUSH_OUT;
        p.flags &= ~FLAG.FACING_LEFT;
      }
    }
    if (!active(stage.camera, x, y)) {
      leave(t, m, at, meX, s);
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
      leave(t, m, at, meX, s);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x2100);
}

const s8 = v => (v << 24) >> 24;

// sub_8020A58: which side of an object's box a character's body has run into, and how far to go to come out of it, or
// null if they don't touch. The side it comes out by is the one with the least to go, by a measure that favours the top.
function touching(box, boxX, boxY, p) {
  const x = p.x >> 8, y = p.y >> 8, { halfWidth: w, halfHeight: h } = p;
  if (boxX + box.left > x + w || boxX + box.right < x - w || boxY + box.top > y + h || boxY + box.bottom < y - h) return null;
  const onRight = boxX + ((box.left + box.right) >> 1) <= x, above = boxY + ((box.top + box.bottom) >> 1) > y;
  const pushX = onRight ? boxX + box.right - (x - w) : boxX + box.left - (x + w);
  const pushY = above ? boxY + box.top - (y + h) : boxY + box.bottom - (y - h);
  if (Math.abs(pushX) < Math.abs(above ? Math.min(pushY + 5, 0) : Math.max(pushY + 2, 0))) {
    return s8(pushX) === 0 ? null : { side: onRight ? 'right' : 'left', push: s8(pushX) };
  }
  if (above) {
    if (p.velY < 0) return null;
    if (!(p.flags & FLAG.IN_AIR) && (p.angle + 0x20) & 0x40) p.groundSpeed = 0;
  }
  return { side: above ? 'top' : 'bottom', push: s8(pushY) };
}
// sub_8020950: an object a character can stand on and can't go through
function touchSolid(s, x, y, p) {
  const box = s.hitboxes?.[0];
  if (box === undefined || box.index === -1) return null;
  const wasOn = p.flags & FLAG.ON_OBJECT && p.standingOn === s;
  if (wasOn) p.flags = (p.flags & ~FLAG.ON_OBJECT) | FLAG.IN_AIR;
  const touch = touching(box, x, y, p);
  if (touch?.side === 'top') {
    p.flags = (p.flags | FLAG.ON_OBJECT) & ~FLAG.IN_AIR;
    p.standingOn = s;
  } else if (!touch && wasOn) {
    p.flags = (p.flags & ~FLAG.AT_WALL) | FLAG.IN_AIR;
    p.standingOn = null;
  }
  return touch;
}

// CreateEntity_BreakableWall and Task_BreakableWall: a wall that stops a character, which breaking isn't ported yet
function createBreakableWall(m, at, x, y) {
  const { stage } = m, { c } = stage, { rom } = c, meX = m.data.getUint8(at), side = m.data.getUint8(at + 7) >> 7;
  const row = BREAKABLE_WALLS + (stage.zone * 2 + side) * 6;
  const s = createSprite({ tiles: stage.allocTiles(rom.u16(row + 4)), anim: rom.u16(row), variant: rom.u16(row + 2), oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    for (const p of stage.players) {
      const touch = touchSolid(s, x, y, p);
      if (touch?.side === 'top') {
        p.y += touch.push << 8;
        p.velY = 0;
      } else if (touch?.side === 'bottom') {
        p.y += (touch.push + 1) << 8;
        p.velY = 0;
      } else if (touch) {
        p.x += touch.push << 8;
        p.velX = 0;
        p.groundSpeed = 0;
        // still pressing against it, it keeps pushing
        const towards = touch.side === 'right' ? 0x20 : 0x10;
        if (p.held & towards) {
          p.x += touch.side === 'right' ? -0x100 : 0x100;
          p.flags |= FLAG.AT_WALL;
        }
      }
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    if (!active(stage.camera, x, y)) {
      for (const p of stage.players) if (p.standingOn === s) {
        p.flags = (p.flags & ~FLAG.ON_OBJECT) | FLAG.IN_AIR;
        p.standingOn = null;
      }
      leave(t, m, at, meX, s);
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
        const px = p.x >> 8, py = p.y >> 8;
        if (x <= px && x + w >= px && y <= py && y + h >= py) p.layer = layer;
      }
    }, null, 0x2000);
  };
}

// gSpriteInits_Interactables, those ported so far
const OBJECTS = { 1: layerToggle(0), 2: layerToggle(1), 57: createBreakableWall, 66: createOmochao, 96: createActRing, 98: createFactoryRing };
