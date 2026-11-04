// The enemies of a stage, each a task that moves it, draws it and sees what touches it, as the original's are (its
// enemies folder, with what they share in enemy_unknown_code.c). So far Akatento, the red ladybird.

import { createSprite, updateSprite, displaySprite, SPRITE } from '../sprite.js';
import { hurtPlayer, reboundFromEnemy } from './player.js';
import { rewardRing } from './rings.js';
import { tileUpDown } from './collision.js';

const PX = 256, TILE = 8, GROUND_LAYER = 1;
const ANIM_POOF = 1338, SE_POOF = 0x8A, POOF_ORDER = 18 << 6;
const AKATENTO_ANIMS = 0xD1A98, AKATENTO_TILES = 16;

const emptyBox = () => ({ index: 0, left: 0, top: 0, right: 0, bottom: 0 });

// HB_COLLISION
function boxesTouch(ax, ay, a, bx, by, b) {
  const across = (ax + a.left <= bx + b.left && ax + a.right >= bx + b.left) || (ax + a.left >= bx + b.left && bx + b.right >= ax + a.left);
  const upDown = (ay + a.top <= by + b.top && ay + a.bottom >= by + b.top) || (ay + a.top >= by + b.top && by + b.bottom >= ay + a.top);
  return across && upDown;
}
// sub_8020700: an object's box touching a character's body, by the size it has now, or its hitting part
function touches(s, x, y, box, p, attacking) {
  const own = s.hitboxes?.[box], theirs = p.sprite.hitboxes?.[attacking ? 1 : 0];
  if (!own || own.index === -1 || !theirs || theirs.index === -1) return false;
  const body = attacking ? theirs : { left: -p.halfWidth, top: -p.halfHeight, right: p.halfWidth, bottom: p.halfHeight };
  return boxesTouch(x, y, own, p.x >> 8, p.y >> 8, body);
}

// sub_805C63C: whether a character has beaten it, and otherwise it hurts them. Being invincible comes with what makes them
// so, and what sub_8004D68 keeps for the moves that aim at an enemy comes with those moves
function beatenBy(s, x, y, stage) {
  let beaten = false;
  for (const p of stage.players) {
    if (touches(s, x, y, 1, p, false)) {
      hurtPlayer(p);
    } else if (touches(s, x, y, 0, p, true)) {
      reboundFromEnemy(p);
      beaten = true;
    } else if (touches(s, x, y, 0, p, false)) {
      hurtPlayer(p);
    } else if (touches(s, x, y, 1, p, true)) {
      hurtPlayer(p);
    }
  }
  return beaten;
}

// sub_805CEBC and Task_40_805C198: the cloud a beaten enemy goes up in, which from its first frame gives a ring
function poof(stage, x, y) {
  const { c } = stage, partner = stage.players[1];
  const s = createSprite({ tiles: stage.allocTiles(28), anim: ANIM_POOF, oamFlags: POOF_ORDER, hitboxes: [{ index: -1 }] });
  updateSprite(c, s);
  c.playSong(SE_POOF);
  let first = true;
  c.createTask(t => {
    if (first) {
      first = false;
      c.createTask(ring => {
        rewardRing(stage, partner, x, y);
        c.destroyTask(ring);
      }, null, 0x4040);
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    const running = updateSprite(c, s);
    displaySprite(c, s);
    if (!running) {
      stage.freeTiles(s.tiles);
      c.destroyTask(t);
    }
  }, null, 0x4040);
}

// sub_805CF90: whether both where it started and where it is now are too far from the camera
function farFromCamera(stage, homeX, homeY, s) {
  const { camera: cam } = stage, far = (x, y) => (x + 128) >>> 0 > 240 + 256 || y + 128 < 0 || y > 160 + 128;
  return far(homeX - cam.x, homeY - cam.y) && far(s.x, s.y);
}

// sub_805CD70: on to the ground under it, a tile at a time, and where it started with it
function ontoGround(e) {
  const x = e.qX >> 8, y = e.qY >> 8, gap = tileUpDown(y, x, GROUND_LAYER, 8);
  if (e.gap !== 1 || gap !== -1 || tileUpDown(y - 1, x, GROUND_LAYER, 8) !== 1) {
    e.gap = gap;
    e.qY += gap * PX;
    e.homeY += gap * PX;
  }
}

// CreateEntity_Akatento and its tasks: a red ladybird, walking between the two ends of its stretch and turning round at each
function createAkatento(m, at, startX, startY) {
  const { stage } = m, { c } = stage, { rom } = c, meX = m.data.getUint8(at);
  const row = i => ({ anim: rom.u16(AKATENTO_ANIMS + i * 8), variant: rom.u8(AKATENTO_ANIMS + i * 8 + 2) });
  const leftEnd = (startX + m.data.getInt8(at + 3) * TILE) * PX, rightEnd = leftEnd + m.data.getUint8(at + 5) * TILE * PX;
  const e = { qX: startX * PX, qY: startY * PX, homeX: startX, homeY: startY * PX, gap: 0 };
  const s = createSprite({
    tiles: stage.allocTiles(AKATENTO_TILES), ...row(0), oamFlags: 18 << 6, x: startX - stage.camera.x, y: startY - stage.camera.y,
    frameFlags: 0x1000 | (m.data.getUint8(at + 7) & 8 ? SPRITE.X_FLIP : 0), hitboxes: [{ index: -1, left: 0, top: 0, right: 0, bottom: 0 }, emptyBox()],
  });
  updateSprite(c, s);
  m.data.setInt8(at, -2);
  const draw = () => {   // sub_80584A8
    s.x = (e.qX >> 8) - stage.camera.x;
    s.y = (e.qY >> 8) - stage.camera.y;
    const running = updateSprite(c, s);
    displaySprite(c, s);
    return running;
  };
  // sub_8058518 and sub_805C280: what touches it, and whether it's gone, beaten or out of the camera's reach
  const gone = t => {
    const beaten = beatenBy(s, e.qX >> 8, e.qY >> 8, stage);
    if (beaten) poof(stage, s.x + stage.camera.x, s.y + stage.camera.y);
    else if (farFromCamera(stage, e.homeX, e.homeY >> 8, s)) m.data.setUint8(at, meX);
    else return false;
    stage.freeTiles(s.tiles);
    c.destroyTask(t);
    return true;
  };
  const playing = () => ![1, 2, 4].includes(stage.state);
  // Task_Akatento and sub_8058464
  const walking = t => {
    ontoGround(e);
    if (playing()) {
      if (s.frameFlags & SPRITE.X_FLIP) {
        if (e.qX <= rightEnd) e.qX = Math.min(e.qX + PX, rightEnd);
      } else if (e.qX >= leftEnd) e.qX = Math.max(e.qX - PX, leftEnd);
    }
    if (gone(t)) return;
    draw();
    if (e.qX <= leftEnd || e.qX >= rightEnd) {
      Object.assign(s, row(1));
      t.main = turning;
    }
  };
  // Task_80583D4
  const turning = t => {
    const running = draw();
    if (gone(t)) return;
    if (playing() && !running) {
      s.frameFlags ^= SPRITE.X_FLIP;
      Object.assign(s, row(0));
      t.main = walking;
    }
  };
  c.createTask(walking, null, 0x2100);
}

/** gSpriteInits_Enemies, those ported so far. */
export const ENEMIES = { 1: createAkatento };
