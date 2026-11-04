// What stands in a stage: its map lists objects by regions of 256 pixels, and those near the camera get a task
// (entities_manager.c: CreateStageEntitiesManager, 0x0802B7B8, and its tasks). So far the overworld's big rings and Omochao, its breakable walls, and springs.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { isArriving, hitWallRebound, thrownBySpring, FLAG } from './player.js';
import { SINE } from './trig.js';

const INTERACTABLES = 0xD0E9C;
const ANIM_FACTORY_RING = 911, ANIM_OMOCHAO = 977, ANIM_ACT_RING = 983;
const REGION = 256, TILE = 8, BREAKABLE_WALLS = 0xCF208, WALL_CRACKS = 0xCF250, WALL_DEBRIS = 0xCF2B0, PUSH_OUT = 0x400;
const FIRST_ACT = 3, BONUS_CAPSULE = 8, ANIM_SPRING = 866, ANIM_SPRING_4 = 987, ANIM_SPRING_6 = 936, SPRING_TILES = 20, SPRING_TILES_6 = 15, SE_SPRING = 0x94, X_FLIP = 0x400, Y_FLIP = 0x800;
const SE_WALL_HOLDS = 0x25B, SE_WALL_CRACKS = 0x24B, SE_WALL_BREAKS = 0x24A;
const DEBRIS_PIECES = 6, DEBRIS_SPEED = 0x200, DEBRIS_GRAVITY = 32, DEBRIS_FRAMES = 30, DEBRIS_ONCE = 1 << 19, WALL_GONE_AFTER = 40;

// RLUnCompWram, the BIOS's run-length decompression
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
function touching(box, boxX, boxY, p, body = { left: -p.halfWidth, top: -p.halfHeight, right: p.halfWidth, bottom: p.halfHeight }, evenRising = false) {
  const x = p.x >> 8, y = p.y >> 8;
  if (boxX + box.left > x + body.right || boxX + box.right < x + body.left || boxY + box.top > y + body.bottom || boxY + box.bottom < y + body.top) return null;
  const onRight = boxX + ((box.left + box.right) >> 1) <= x, above = boxY + ((box.top + box.bottom) >> 1) > y;
  const pushX = onRight ? boxX + box.right - (x + body.left) : boxX + box.left - (x + body.right);
  const pushY = above ? boxY + box.top - (y + body.bottom) : boxY + box.bottom - (y + body.top);
  if (Math.abs(pushX) < Math.abs(above ? Math.min(pushY + 5, 0) : Math.max(pushY + 2, 0))) {
    return s8(pushX) === 0 ? null : { side: onRight ? 'right' : 'left', push: s8(pushX) };
  }
  if (above) {
    if (p.velY < 0 && !evenRising) return null;
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

// sub_8020874: a character's hitting part, which some of its animations have, touching an object
function hitting(box, boxX, boxY, p) {
  const body = p.sprite.hitboxes?.[1];
  if (box === undefined || box.index === -1 || body === undefined || body.index === -1) return null;
  return touching(box, boxX, boxY, p, body, true);
}

// CreateEntity_BreakableWall and Task_BreakableWall: a wall that stops a character, and a blow from a part of it that
// hits throws it back, and cracks the wall or breaks it, if the wall isn't harder than that
function createBreakableWall(m, at, x, y) {
  const { stage } = m, { c } = stage, { rom } = c, meX = m.data.getUint8(at), side = m.data.getUint8(at + 7) >> 7;
  const hardBits = m.data.getUint8(at + 7) & 7, hardness = hardBits & 1 ? 0 : hardBits & 2 ? 1 : hardBits & 4 ? 2 : 3;
  let strength = m.data.getInt8(at + 3), cracked = 0;
  const showCrack = n => {   // sub_80351A8
    const row = WALL_CRACKS + (stage.zone * 4 + side * 2 + n) * 4;
    s.anim = rom.u16(row);
    s.variant = rom.u16(row + 2);
  };
  // sub_8034A20 and sub_8034C60: how hard the character hits goes up with its moves, and none of those it has so far is above 1
  const takeBlow = () => {
    const force = 1;
    if (hardness >= force) {
      c.playSong(SE_WALL_HOLDS);
      return;
    }
    const damage = force - hardness;
    if (strength <= damage) {
      strength = 0;
      c.playSong(SE_WALL_BREAKS);
      showCrack(1);
    } else {
      strength -= damage;
      c.playSong(SE_WALL_CRACKS);
      showCrack(cracked);
      cracked = 1;
    }
  };
  const row = BREAKABLE_WALLS + (stage.zone * 2 + side) * 6;
  const s = createSprite({ tiles: stage.allocTiles(rom.u16(row + 4)), anim: rom.u16(row), variant: rom.u16(row + 2), oamFlags: 24 << 6, frameFlags: 0x1000 });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  c.createTask(t => {
    for (const p of stage.players) {
      const blow = hitting(s.hitboxes?.[0], x, y, p);
      if (blow) {
        if (blow.side === 'top') {
          if (side === 0) {
            p.y += blow.push << 8;
            p.velY = -2 * 256;
          } else {
            p.x -= p.velX;
            p.velX = 0;
          }
        } else if (blow.side === 'bottom') {
          if (side === 0) {
            p.y += (blow.push + 1) << 8;
            p.velY = 0;
          } else {
            p.x -= p.velX;
            p.velX = 0;
          }
        } else {
          p.x += blow.push << 8;
          if (side !== 0) p.velY = -2 * 256;
        }
        takeBlow();
        hitWallRebound(p);
        continue;
      }
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
    if (strength === 0) t.main = wallBreaking;
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
  // Task_8034E44: first its pieces fly off, and the wall is gone from then on, though its tiles stay until they've landed
  const wallBreaking = t => {
    if (strength === WALL_GONE_AFTER) {
      leave(t, m, at, meX, s);
      return;
    }
    if (strength === 0) {
      for (const p of stage.players) if (p.standingOn === s) {
        p.standingOn = null;
        p.flags &= ~FLAG.ON_OBJECT;
      }
      const box = s.hitboxes[0], middleX = x + Math.trunc(box.right / 2), middleY = y + Math.trunc(box.bottom / 2);
      for (let piece = 0; piece < DEBRIS_PIECES; piece++) createDebris(stage, middleX, middleY, c.random() & 0x1FF, piece, s.tiles);
    }
    strength++;
  };
}

// CreateBreakableWallDebris and Task_Debris: a piece of a wall, thrown off at an angle, which falls for half a second.
// The first two pieces bring the tiles of the two shapes, and the others share them
function createDebris(stage, x, y, angle, piece, tiles) {
  const { c } = stage, { rom } = c, shape = piece & 1, zoneRow = WALL_DEBRIS + stage.zone * 2 * 6, row = zoneRow + shape * 6;
  const s = createSprite({
    tiles: shape === 0 ? tiles : tiles + rom.u16(zoneRow + 4) * 32, anim: rom.u16(row), variant: rom.u16(row + 2), oamFlags: 8 << 6,
    frameFlags: piece > 1 ? DEBRIS_ONCE : 0, hitboxes: [{ index: -1 }],
  });
  const speedX = (SINE[(angle & 0x3FF) + 256] * DEBRIS_SPEED) >> 14;
  let speedY = (SINE[angle & 0x3FF] * DEBRIS_SPEED) >> 14, atX = x * 256, atY = y * 256, frames = DEBRIS_FRAMES;
  updateSprite(c, s);
  c.createTask(t => {
    if (--frames === 0) {
      c.destroyTask(t);
      return;
    }
    atX += speedX;
    speedY += DEBRIS_GRAVITY;
    atY += speedY;
    s.x = (atX >> 8) - stage.camera.x;
    s.y = (atY >> 8) - stage.camera.y;
    displaySprite(c, s);
  }, null, 0x2100);
}

// sub_8020700: whether a character's body touches an object's box, on any side
function touchesBody(box, boxX, boxY, p) {
  if (box === undefined || box.index === -1 || p.sprite.hitboxes?.[0] === undefined || p.sprite.hitboxes[0].index === -1) return false;
  const x = p.x >> 8, y = p.y >> 8, overlap = (a0, a1, b0, b1) => (a0 <= b0 && a1 >= b0) || (a0 >= b0 && b1 >= a0);
  return overlap(boxX + box.left, boxX + box.right, x - p.halfWidth, x + p.halfWidth) && overlap(boxY + box.top, boxY + box.bottom, y - p.halfHeight, y + p.halfHeight);
}

// CreateEntity_Spring, sub_802DFC8, Task_SpringMain and sub_802E0D8: a spring, which throws a character that touches it its
// own way, plays its sound once each time it's touched, and shows its other variant until that has played
function spring(direction) {
  return (m, at, x, y) => {
    const { stage } = m, { c } = stage, meX = m.data.getUint8(at);
    const strength = [0, 1, 2, 3, 4, 5, 6, 7].find(bit => (m.data.getUint8(at + 7) >> bit) & 1) ?? 0;
    let variant = 0, flips = 0;
    if (direction & 8) {
      variant = 6;
      if (direction & 1) flips = X_FLIP;
    } else if (direction & 4) {
      variant = 4;
      if (direction & 2) flips = X_FLIP;
      if (direction & 1) flips |= Y_FLIP;
    } else if (direction & 2) {
      variant = 2;
      if (direction & 1) flips = X_FLIP;
    } else if (direction & 1) flips = Y_FLIP;
    const zone = stage.act >= FIRST_ACT && stage.act <= BONUS_CAPSULE ? stage.zone : -1;
    const s = createSprite({
      tiles: stage.allocTiles(zone === 6 ? SPRING_TILES_6 : SPRING_TILES), anim: zone === 6 ? ANIM_SPRING_6 : zone === 4 ? ANIM_SPRING_4 : ANIM_SPRING,
      variant, oamFlags: 24 << 6, frameFlags: flips | 0x1000, hitboxes: [{ index: -1 }],
    });
    let touched = 0;
    m.data.setInt8(at, -2);
    c.createTask(t => {
      stage.players.forEach((p, i) => {
        if (!touchesBody(s.hitboxes[0], x, y, p)) {
          touched &= ~(1 << i);
          return;
        }
        if (!(touched & (1 << i))) {
          touched |= 1 << i;
          if (p.id === stage.playerIndex) c.playSong(SE_SPRING);
        }
        if (!(s.variant & 1)) s.variant++;
        thrownBySpring(p, direction, strength);
      });
      if (!active(stage.camera, x, y)) {
        leave(t, m, at, meX, s);
        return;
      }
      s.x = x - stage.camera.x;
      s.y = y - stage.camera.y;
      if (updateSprite(c, s) === 0 && s.variant & 1) s.variant--;
      displaySprite(c, s);
    }, null, 0x2100);
  };
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
const OBJECTS = {
  1: layerToggle(0), 2: layerToggle(1),
  5: spring(0), 6: spring(1), 7: spring(3), 8: spring(2), 9: spring(6), 10: spring(7), 11: spring(4), 12: spring(5), 13: spring(8), 14: spring(9),
  57: createBreakableWall, 66: createOmochao, 96: createActRing, 98: createFactoryRing,
};
