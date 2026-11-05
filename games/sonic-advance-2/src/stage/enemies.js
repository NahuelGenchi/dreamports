// Leaf Forest's enemies, each as its task in the decompilation has it: Mon, who jumps as the character comes near, Buzzer, who
// flies to and fro and dives at it, and Kiki, who bobs and throws a bomb. Rewritten from CreateEntity_Mon, CreateEntity_Buzzer
// and CreateEntity_Kiki with their tasks, and from Coll_Player_Enemy_Attack, Coll_Player_Projectile and Coll_DamagePlayer, how
// they meet the character.

import { createSprite, updateSprite, displaySprite, SPRITE } from '../sprite.js';
import { groundInTile } from './collision.js';
import { hurtPlayer } from './player.js';
import { scatterRings } from './rings-scatter.js';
import { defeatEnemy } from './defeat.js';

const PX = 256, TILE = 8, REGION = 256, DISPLAY_W = 240, DISPLAY_H = 160, PLACED = 0xFE, BEHIND_THE_PLAYER = 0x2000;
const s8 = v => (v << 24) >> 24;
const ANIM_MON = 478, MON_TILES = 25, MON_JUMP = 5.5 * PX, MON_GRAVITY = 52, MON_SEES_X = 120, MON_SEES_Y = 50;
const ANIM_BUZZER = 482, BUZZER_TILES = 20, BUZZER_SPEED = 0xC0, BUZZER_SEES_X = 0x3C, BUZZER_SEES_Y = 0x50, BUZZER_DIVE_FRAMES = 0x20, BUZZER_RESTS = 0x3C;
const ANIM_KIKI = 479, KIKI_TILES = 0x14, KIKI_THROWS_AT = 0x12;
const ANIM_BOMB = 480, BOMB_TILES = 4, BOMB_UP = 512, BOMB_GRAVITY = 40, BOMB_MOST = 60, BOMB_WAITS = 0x60;
const ANIM_BLAST = 481, BLAST_TILES = 16;

const overlaps = (a, aSize, b, bSize) => (a <= b && a + aSize >= b) || (a >= b && b + bSize >= a);
// HB_COLLISION: two boxes, each at its own place
const boxesMeet = (x0, y0, a, x1, y1, b) => overlaps(x0 + a.left, a.right - a.left, x1 + b.left, b.right - b.left)
  && overlaps(y0 + a.top, a.bottom - a.top, y1 + b.top, b.bottom - b.top);

// Coll_DamagePlayer: unless it's blinking, it's hit and its rings go. With none it dies in the original, which isn't made, so it's only thrown back
function damagePlayer(stage) {
  const p = stage.player;
  if (p.invulnerable > 0) return;
  hurtPlayer(p);
  scatterRings(stage, p.x >> 8, p.y >> 8, stage.rings);
  stage.rings = 0;
}

// Coll_Player_Enemy_Attack: true when the character's attack beats it, and if only its body touches, the character is hit. An
// attack from above sends it back up
function beaten(stage, s, x, y) {
  const p = stage.player, box = s.hitboxes?.[0], px = p.x >> 8, py = p.y >> 8;
  if (!box) return false;
  const attack = p.sprite.hitboxes?.[1], body = p.sprite.hitboxes?.[0];
  if (attack && boxesMeet(x, y, box, px, py, attack)) {
    if (p.velY > 0) p.velY = -p.velY;   // Coll_Player_Enemy_AdjustSpeed
    defeatEnemy(stage, x, y);
    return true;
  }
  if (body && boxesMeet(x, y, box, px, py, body)) damagePlayer(stage);
  return false;
}

// Coll_Player_Projectile, for what a character can't beat
function hitByProjectile(stage, s, x, y) {
  const p = stage.player, box = s.hitboxes?.[0], body = p.sprite.hitboxes?.[0];
  if (!box || !body || !boxesMeet(x, y, box, p.x >> 8, p.y >> 8, body)) return false;
  damagePlayer(stage);
  return true;
}

// IS_OUT_OF_CAM_RANGE
const outOfRange = (x, y) => ((x + REGION / 2) & 0xFFFF) > DISPLAY_W + REGION || y + REGION / 2 < 0 || y > DISPLAY_H + REGION / 2;

// what every enemy starts with: its place in the map's list, which it takes the x of until the camera leaves it
function placeEnemy(stage, list, at, rx, ry, tiles, anim, order = 18) {
  const placedX = list.getUint8(at), worldX = placedX * TILE + rx * REGION, worldY = list.getUint8(at + 1) * TILE + ry * REGION;
  list.setUint8(at, PLACED);
  const tileAddress = stage.allocTiles(tiles);
  return {
    stage, list, at, placedX, worldX, worldY, tiles: tileAddress, behave: null,
    sprite: createSprite({ tiles: tileAddress, anim, oamFlags: order << 6, frameFlags: BEHIND_THE_PLAYER }),
  };
}

function remove(t, enemy, backOnTheMap) {
  if (backOnTheMap) enemy.list.setUint8(enemy.at, enemy.placedX);
  enemy.stage.freeTiles(enemy.tiles);
  enemy.stage.c.destroyTask(t);
}

// beaten, or gone with the camera: either is the end of its task, and what's left for its frame is only for those that stay
function goneAt(t, enemy, x, y, rangeY = enemy.sprite.y) {
  if (beaten(enemy.stage, enemy.sprite, x, y)) {
    remove(t, enemy, false);
    return true;
  }
  if (outOfRange(enemy.sprite.x, rangeY)) {
    remove(t, enemy, true);
    return true;
  }
  return false;
}

const setAnimation = (s, variant) => {
  s.variant = variant;
  s.prevVariant = 0xFF;
};
const facePlayer = (s, x, p) => {
  if (p.x < x) s.frameFlags &= ~SPRITE.X_FLIP;
  else s.frameFlags |= SPRITE.X_FLIP;
};

/** CreateEntity_Mon: he stands on the ground below where the map has him. */
export function createMon(stage, list, at, rx, ry) {
  const mon = placeEnemy(stage, list, at, rx, ry, MON_TILES, ANIM_MON);
  mon.x = mon.worldX * PX;
  mon.y = (mon.worldY + groundInTile(mon.worldY, mon.worldX, s8(list.getUint8(at + 3)) === 0 ? 0 : 1, 8)) * PX;
  mon.speedY = -MON_JUMP;
  mon.offsetY = 0;
  mon.behave = monWatching;
  stage.c.createTask(t => t.data.behave(t, t.data), mon, 0x4010);
}

function monSees(mon) {
  const p = mon.stage.player;
  return p.x > mon.x - MON_SEES_X * PX && p.x < mon.x + MON_SEES_X * PX && p.y > mon.y - MON_SEES_Y * PX && p.y < mon.y + MON_SEES_Y * PX;
}

function monAtPlace(mon, offsetY = 0) {
  const { sprite: s, stage: { camera: cam } } = mon;
  s.x = (mon.x >> 8) - cam.x;
  s.y = ((mon.y + offsetY) >> 8) - cam.y;
}

// Task_MonMain
function monWatching(t, mon) {
  const { sprite: s, stage: { c, player: p } } = mon;
  monAtPlace(mon);
  if (goneAt(t, mon, mon.x >> 8, mon.y >> 8)) return;
  if (monSees(mon)) {
    mon.behave = monCrouching;
    setAnimation(s, 2);
  }
  facePlayer(s, mon.x, p);
  updateSprite(c, s);
  displaySprite(c, s);
}

// Task_Mon_2
function monCrouching(t, mon) {
  const { sprite: s, stage: { c } } = mon;
  monAtPlace(mon);
  if (goneAt(t, mon, mon.x >> 8, mon.y >> 8)) return;
  if (updateSprite(c, s) === 0) {
    mon.speedY = -MON_JUMP;
    mon.offsetY = 0;
    setAnimation(s, 1);
    mon.behave = monJumping;
  }
  displaySprite(c, s);
}

// Task_Mon_3
function monJumping(t, mon) {
  const { sprite: s, stage: { c } } = mon;
  mon.speedY += MON_GRAVITY;
  mon.offsetY += mon.speedY;
  monAtPlace(mon, mon.offsetY);
  if (goneAt(t, mon, mon.x >> 8, (mon.y + mon.offsetY) >> 8)) return;
  if (mon.offsetY >= 0) {
    setAnimation(s, 3);
    mon.behave = monLanding;
  }
  updateSprite(c, s);
  displaySprite(c, s);
}

// Task_Mon_4
function monLanding(t, mon) {
  const { sprite: s, stage: { c, player: p } } = mon;
  monAtPlace(mon);
  if (goneAt(t, mon, mon.x >> 8, mon.y >> 8)) return;
  if (updateSprite(c, s) === 0) {
    if (monSees(mon)) {
      facePlayer(s, mon.x, p);
      setAnimation(s, 2);
      mon.behave = monCrouching;
    } else {
      setAnimation(s, 0);
      mon.behave = monWatching;
    }
  }
  displaySprite(c, s);
}

/** CreateEntity_Buzzer: he flies between the two ends the map's entry gives. */
export function createBuzzer(stage, list, at, rx, ry) {
  const buzzer = placeEnemy(stage, list, at, rx, ry, BUZZER_TILES, ANIM_BUZZER);
  Object.assign(buzzer, {
    spawnX: buzzer.worldX * PX, spawnY: buzzer.worldY * PX, offsetX: 0, diveX: 0, diveY: 0, diveStepX: 0, diveStepY: 0, diveUntil: 0, rest: 0,
    leftEnd: s8(list.getUint8(at + 3)) * TILE, rightEnd: s8(list.getUint8(at + 3)) * TILE + list.getUint8(at + 5) * TILE, behave: buzzerFlying,
  });
  stage.c.createTask(t => t.data.behave(t, t.data), buzzer, 0x4030);
}

// where it is now, on the screen too
function buzzerAt(buzzer, dx, dy) {
  const x = (buzzer.spawnX + dx) >> 8, y = (buzzer.spawnY + dy) >> 8, { sprite: s, stage: { camera: cam } } = buzzer;
  s.x = x - cam.x;
  s.y = y - cam.y;
  return { x, y };
}

// ENEMY_DESTROY_IF_PLAYER_HIT_2 and ENEMY_DESTROY_IF_OFFSCREEN: it's only gone with the camera once its spawn is far enough off too
function buzzerGone(t, buzzer, x, y) {
  const { sprite: s, stage } = buzzer, cam = stage.camera, spawnX = buzzer.spawnX >> 8, spawnY = buzzer.spawnY >> 8;
  if (beaten(stage, s, x, y)) {
    remove(t, buzzer, false);
    return true;
  }
  const spawnOff = spawnX > cam.x + DISPLAY_W + REGION / 2 || spawnX < cam.x - REGION / 2 || spawnY > cam.y + DISPLAY_H + REGION / 2 || spawnY < cam.y - REGION / 2;
  if (spawnOff && outOfRange(s.x, s.y)) {
    remove(t, buzzer, true);
    return true;
  }
  return false;
}

// Task_BuzzerMain
function buzzerFlying(t, buzzer) {
  const { sprite: s, stage: { c, player: p } } = buzzer, flipped = s.frameFlags & SPRITE.X_FLIP;
  buzzer.offsetX += flipped ? BUZZER_SPEED : -BUZZER_SPEED;
  const { x, y } = buzzerAt(buzzer, buzzer.offsetX, 0);
  if (buzzerGone(t, buzzer, x, y)) return;
  const px = p.x >> 8, py = p.y >> 8;
  let ready = buzzer.rest === 0;
  if (!ready) ready = --buzzer.rest === 0;
  const sees = py > y && py < y + BUZZER_SEES_Y && (flipped ? px > x && px < x + BUZZER_SEES_X : px > x - BUZZER_SEES_X && px < x);
  if (ready && sees) {
    setAnimation(s, 1);
    buzzer.diveUntil = p.y;
    buzzer.diveStepX = Math.trunc((p.x - x * PX) / BUZZER_DIVE_FRAMES);
    buzzer.diveStepY = Math.trunc((p.y - y * PX) / BUZZER_DIVE_FRAMES);
    buzzer.behave = buzzerDiving;
  } else {
    const across = (buzzer.offsetX >> 8);
    if (flipped ? across >= buzzer.rightEnd : across <= buzzer.leftEnd) {
      setAnimation(s, 2);
      buzzer.behave = buzzerTurning;
    }
  }
  updateSprite(c, s);
  displaySprite(c, s);
}

// sub_80533B4
function buzzerTurning(t, buzzer) {
  const { sprite: s, stage: { c } } = buzzer, { x, y } = buzzerAt(buzzer, buzzer.offsetX, 0);
  if (buzzerGone(t, buzzer, x, y)) return;
  if (updateSprite(c, s) === 0) {
    s.frameFlags ^= SPRITE.X_FLIP;
    setAnimation(s, 0);
    buzzer.behave = buzzerFlying;
  }
  displaySprite(c, s);
}

// sub_80534F0
function buzzerDiving(t, buzzer) {
  const { sprite: s, stage: { c } } = buzzer;
  buzzer.diveX += buzzer.diveStepX;
  buzzer.diveY += buzzer.diveStepY;
  const { x, y } = buzzerAt(buzzer, buzzer.offsetX + buzzer.diveX, buzzer.diveY);
  if (buzzerGone(t, buzzer, x, y)) return;
  if (y * PX > buzzer.diveUntil) buzzer.behave = buzzerRising;
  updateSprite(c, s);
  displaySprite(c, s);
}

// sub_8053620
function buzzerRising(t, buzzer) {
  const { sprite: s, stage: { c } } = buzzer;
  buzzer.diveX -= buzzer.diveStepX;
  buzzer.diveY -= buzzer.diveStepY;
  const { x, y } = buzzerAt(buzzer, buzzer.offsetX + buzzer.diveX, buzzer.diveY);
  if (buzzerGone(t, buzzer, x, y)) return;
  if (buzzer.diveY < 1) {
    buzzer.diveX = 0;
    buzzer.diveY = 0;
    setAnimation(s, 0);
    buzzer.rest = BUZZER_RESTS;
    buzzer.behave = buzzerFlying;
  }
  updateSprite(c, s);
  displaySprite(c, s);
}

/** CreateEntity_Kiki: he bobs where the map has him. */
export function createKiki(stage, list, at, rx, ry) {
  const kiki = placeEnemy(stage, list, at, rx, ry, KIKI_TILES, ANIM_KIKI);
  Object.assign(kiki, {
    bob: 0, step: 1, bobs: 0, wound: 0, top: s8(list.getUint8(at + 4)) * TILE, bottom: s8(list.getUint8(at + 4)) * TILE + list.getUint8(at + 6) * TILE, behave: kikiBobbing,
  });
  updateSprite(stage.c, kiki.sprite);
  stage.c.createTask(t => t.data.behave(t, t.data), kiki, 0x4020);
}

function kikiFaces(kiki, x) {
  const { sprite: s, stage: { player: p } } = kiki;
  if (p.x >> 8 < x) s.frameFlags &= ~SPRITE.X_FLIP;
  else {
    s.frameFlags |= SPRITE.X_FLIP;
    s.x += 8;
  }
}

// Task_KikiMain
function kikiBobbing(t, kiki) {
  const { sprite: s, stage: { c, camera: cam } } = kiki, x = kiki.worldX;
  kiki.bob += kiki.step;
  const y = kiki.worldY + kiki.bob;
  s.x = x - cam.x;
  s.y = y - cam.y;
  if (kiki.bob <= kiki.top) {
    kiki.bobs = (kiki.bobs + 1) & 0xFF;
    kiki.step = 1;
    if (!(kiki.bobs & 1)) {
      kiki.wound = 0;
      s.variant = 1;
      kiki.behave = kikiThrowing;
    }
  } else if (kiki.bob >= kiki.bottom) kiki.step = -1;
  if (goneAt(t, kiki, x, y, s.y - kiki.bob)) return;
  kikiFaces(kiki, x);
  updateSprite(c, s);
  displaySprite(c, s);
}

// sub_8053A38
function kikiThrowing(t, kiki) {
  const { sprite: s, stage: { c, camera: cam } } = kiki, x = kiki.worldX, y = kiki.worldY + kiki.bob;
  s.x = x - cam.x;
  s.y = y - cam.y;
  if (goneAt(t, kiki, x, y, s.y - kiki.bob)) return;
  kikiFaces(kiki, x);
  if (++kiki.wound === KIKI_THROWS_AT) createBomb(kiki.stage, s.frameFlags & SPRITE.X_FLIP ? x - 4 : x + 9, y + 2);
  if (updateSprite(c, s) === 0) {
    kiki.behave = kikiBobbing;
    s.variant = 0;
  }
  displaySprite(c, s);
}

// CreateKikiProjectile, with Task_KikiProjMain and Task_KikiProjSplit: it flies towards the character and bounces once,
// then sits and bursts, or bursts as it hits
function createBomb(stage, startX, startY) {
  const { c } = stage, p = stage.player, px = p.x >> 8, tiles = stage.allocTiles(BOMB_TILES);
  const s = createSprite({ tiles, anim: ANIM_BOMB, oamFlags: 17 << 6, frameFlags: BEHIND_THE_PLAYER });
  const across = px < startX ? Math.max(-Math.trunc((startX - px) * 400 / 800), -BOMB_MOST) : Math.min(Math.trunc((px - startX) * 400 / 800), BOMB_MOST);
  let speedY = -BOMB_UP, travel = 0, bounced = 0, x = startX, y = startY, sitting = false;
  updateSprite(c, s);
  c.createTask(t => {
    if (!sitting) {
      speedY += BOMB_GRAVITY;
      travel += across;
      x = startX + Math.trunc(travel / 0x28);
      y += speedY >> 8;
      if (speedY > 0) {
        const gap = groundInTile(y, x, 1, 8);
        if (gap < 0) {
          y += gap;
          if (bounced === 0) {
            speedY = -(speedY >> 2);
            bounced = 1;
          } else {
            sitting = true;
            bounced = 0;
            speedY = 0;
          }
        }
      }
      if (hitByProjectile(stage, s, x, y)) {
        createBlast(stage, x, y);
        stage.freeTiles(tiles);
        c.destroyTask(t);
        return;
      }
    } else if (bounced++ >= BOMB_WAITS || hitByProjectile(stage, s, x, y)) {
      createBlast(stage, x, y);
      stage.freeTiles(tiles);
      c.destroyTask(t);
      return;
    }
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, 0x4028);
}

// CreateKikiProjectilePiece, with Task_ProjPieceMain: it can still hit the character until it's over
function createBlast(stage, x, y) {
  const { c } = stage, tiles = stage.allocTiles(BLAST_TILES);
  const s = createSprite({ tiles, anim: ANIM_BLAST, oamFlags: 18 << 6, frameFlags: BEHIND_THE_PLAYER });
  updateSprite(c, s);
  c.createTask(t => {
    const p = stage.player, box = s.hitboxes?.[0], body = p.sprite.hitboxes?.[0];
    if (box && body && boxesMeet(x, y, box, p.x >> 8, p.y >> 8, body)) damagePlayer(stage);
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    if (updateSprite(c, s) === 0) {
      stage.freeTiles(tiles);
      c.destroyTask(t);
      return;
    }
    displaySprite(c, s);
  }, null, 0x2000);
}
