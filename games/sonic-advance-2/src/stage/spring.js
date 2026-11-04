// A spring: where the map has it, still until the character touches it, then pressed down while it throws the character.
// Rewritten from CreateEntity_Spring, Task_Spring_Idle, Task_Spring_Activated and CheckSpringPlayerCollisions, with
// Coll_Player_Interactable and sub_800CE94, how a sprite's box meets the character's.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { touchSpring, FLAG } from './player.js';

const ANIM_SPRING = 536, SE_SPRING = 153, TILE = 8, REGION = 256, DISPLAY_W = 240, DISPLAY_H = 160;
const Y_FLIP = 0x800, X_FLIP = 0x400;
// sSpringAnimationData, by each kind: its animation's variant, its tiles and how it's turned
const KINDS = [
  [0, 20, 0], [0, 20, Y_FLIP], [2, 20, X_FLIP], [2, 20, 0], [4, 20, X_FLIP], [4, 20, 0], [4, 20, X_FLIP | Y_FLIP], [4, 20, Y_FLIP], [6, 15, X_FLIP], [6, 15, 0],
];
// sSpringDirToPlayerTransition with what CallPlayerTransition adds to it: which way each kind throws, in the high half of a byte
const THROWS = [0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x40, 0x50];
const { IN_AIR, STOOD_ON } = FLAG, PLACED = 0xFE;   // an entry's x once it's on the map, MAP_ENTITY_STATE_INITIALIZED
const OVER_TOP = 0x10000, UNDER = 0x20000, RIGHT_OF = 0x40000, LEFT_OF = 0x80000;   // COLL_FLAG_10000 and its neighbours

const overlaps = (a, aSize, b, bSize) => (a <= b && a + aSize >= b) || (a >= b && b + bSize >= a);

// sub_800CE94: whether two boxes touch, and which side of the sprite the character is on, or 0 if it's going up off the top
function meet(hitbox, sx, sy, p) {
  const px = p.x >> 8, py = p.y >> 8, w = p.halfWidth, h = p.halfHeight;
  if (!overlaps(sx + hitbox.left, hitbox.right - hitbox.left, px - w, w * 2) || !overlaps(sy + hitbox.top, hitbox.bottom - hitbox.top, py - h, h * 2)) return 0;
  let result, across, upDown, slack;
  if (sx + ((hitbox.left + hitbox.right) >> 1) <= px) {
    across = sx + hitbox.right - (px - w);
    result = RIGHT_OF;
  } else {
    across = sx + hitbox.left - (px + w);
    result = LEFT_OF;
  }
  if (sy + ((hitbox.top + hitbox.bottom) >> 1) > py) {
    upDown = sy + hitbox.top - (py + h);
    slack = Math.min(upDown + 5, 0);
    result |= OVER_TOP;
  } else {
    upDown = sy + hitbox.bottom - (py - h);
    slack = Math.max(upDown + 2, 0);
    result |= UNDER;
  }
  if (Math.abs(across) < Math.abs(slack)) result &= RIGHT_OF | LEFT_OF;
  else {
    result &= OVER_TOP | UNDER;
    if (result & OVER_TOP) {
      if (p.velY < 0) return 0;
      if (!(p.flags & IN_AIR) && (p.angle + 0x20) & 0x40) p.groundSpeed = 0;
    }
  }
  if (result & (RIGHT_OF | LEFT_OF)) return across & 0xFF ? result : 0;
  return result;
}

// Coll_Player_Interactable: touching it from above, the character stands on it until it's looked at again
function touches(sprite, sx, sy, p) {
  if (!sprite.hitboxes?.[0]) return 0;
  if (p.flags & STOOD_ON && p.stoodOn === sprite) p.flags &= ~STOOD_ON;
  const result = meet(sprite.hitboxes[0], sx, sy, p);
  if (result & OVER_TOP) {
    p.flags |= STOOD_ON;
    p.stoodOn = sprite;
  } else if (p.stoodOn === sprite) p.stoodOn = null;
  return result;
}

/** CreateEntity_Spring, on the map's entry at `at` in `data`, of a region. */
export function createSpring(stage, data, at, regionX, regionY, kind) {
  const { c } = stage, [variant, tiles, flips] = KINDS[kind], placedX = data.getUint8(at);
  const worldX = placedX * TILE + regionX * REGION, worldY = data.getUint8(at + 1) * TILE + regionY * REGION;
  data.setUint8(at, PLACED);
  const spring = {
    stage, data, at, placedX, worldX, worldY, tiles: stage.allocTiles(tiles), throws: THROWS[kind] | (data.getUint8(at + 3) & 3),
    sprite: null, pressed: false,
  };
  spring.sprite = createSprite({ tiles: spring.tiles, anim: ANIM_SPRING, variant, oamFlags: 18 << 6, frameFlags: 0x2200 | flips, x: worldX, y: worldY });
  updateSprite(c, spring.sprite);
  c.createTask(springFrame, spring, 0x2010);
}

// CheckSpringPlayerCollisions: where it is on the screen, and whether the character has just touched it
function check(spring) {
  const { stage, sprite: s, worldX, worldY } = spring, p = stage.player;
  s.x = worldX - stage.camera.x;
  s.y = worldY - stage.camera.y;
  if (touches(s, worldX, worldY, p) === 0) return false;
  touchSpring(p, spring.throws);
  stage.c.playSong(SE_SPRING);
  return true;
}

// TaskDestructor_Spring and IS_OUT_OF_CAM_RANGE: far enough off the screen it goes, and the map has it again
function goneFromCamera(t, spring) {
  const { sprite: s } = spring;
  if (((s.x + REGION / 2) & 0xFFFF) <= DISPLAY_W + REGION && s.y + REGION / 2 >= 0 && s.y <= DISPLAY_H + REGION / 2) return false;
  spring.data.setUint8(spring.at, spring.placedX);
  spring.stage.freeTiles(spring.tiles);
  spring.stage.c.destroyTask(t);
  return true;
}

// Task_Spring_Idle and Task_Spring_Activated, its two states
function springFrame(t) {
  const spring = t.data, { sprite: s, stage: { c } } = spring;
  if (!spring.pressed) {
    if (check(spring)) {
      spring.pressed = true;
      s.variant++;
    }
    if (!goneFromCamera(t, spring)) displaySprite(c, s);
    return;
  }
  check(spring);
  if (goneFromCamera(t, spring)) return;
  if (updateSprite(c, s) === 0) {
    s.variant--;
    updateSprite(c, s);
    spring.pressed = false;
  }
  displaySprite(c, s);
}
