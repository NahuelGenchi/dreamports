// What's left of an enemy as it's beaten: its cloud, the animal it held, the points and their sound. Rewritten from
// CreateDustCloud with Task_CreateDustCloud, CreateTrappedAnimal with its tasks, CreateEnemyDefeatScoreAndManageLives and
// CreateEnemyDefeatScore with its two tasks.

import { createSprite, updateSprite, displaySprite } from '../sprite.js';
import { groundInTile } from './collision.js';

const OBJ_VRAM = 0x10000, BEHIND_THE_PLAYER = 0x2000, EFFECT_PRIORITY = 0x2000;
const ANIM_CLOUD = 477, CLOUD_TILES = OBJ_VRAM + 0x1000, ANIM_SCORE = 728, SCORE_TILES = 2, SE_ITEM_BOX = 138;
const SCORES = [100, 200, 400, 800, 1000], SCORE_RISES = 60, SCORE_STAYS = 30, EXTRA_LIFE_EVERY = 50000;
const ANIMAL_GRAVITY = 48, ANIMAL_THROW = 4 * 256, ANIMAL_RUN = 2 * 256, ANIMAL_IN_THE_AIR = 42, ANIMAL_OFF_THE_SCREEN = 32;
const DISPLAY_W = 240, DISPLAY_H = 160;
// sAnimsTrappedAnimals, for Leaf Forest: each one's place in sprite memory, its animation and whether it bounces
const ANIMALS = [{ tile: 192, anim: 523, bounces: false }, { tile: 196, anim: 528, bounces: false }, { tile: 200, anim: 527, bounces: true }];

// Task_CreateDustCloud: its last frame goes in twice as it ends
function createCloud(stage, x, y) {
  const { c } = stage, s = createSprite({ tiles: CLOUD_TILES, anim: ANIM_CLOUD, oamFlags: 15 << 6, frameFlags: BEHIND_THE_PLAYER });
  c.createTask(t => {
    s.x = x - stage.camera.x;
    s.y = y - stage.camera.y;
    if (updateSprite(c, s) === 0) {
      displaySprite(c, s);
      c.destroyTask(t);
    }
    displaySprite(c, s);
  }, null, EFFECT_PRIORITY);
}

// CreateTrappedAnimal, then CreateStaticAnimal and CreateBouncingAnimal with their tasks: up and back to the ground
function createAnimal(stage, startX, startY) {
  const { c } = stage, { tile, anim, bounces } = ANIMALS[stage.animalTurn];
  stage.animalTurn = (stage.animalTurn + 1) % ANIMALS.length;
  const s = createSprite({ tiles: OBJ_VRAM + tile * 32, anim, oamFlags: 17 << 6, frameFlags: BEHIND_THE_PLAYER });
  let worldX = startX * 256, worldY = startY * 256, run = bounces ? 1 : 0, fall = -ANIMAL_THROW, wait = ANIMAL_IN_THE_AIR, bouncing = false;
  c.createTask(t => {
    fall += ANIMAL_GRAVITY;
    worldY += fall;
    worldX += run;
    if (wait > 0) wait--;
    else {
      const ground = worldY + groundInTile(worldY >> 8, worldX >> 8, 1, 8) * 256;
      if (ground <= worldY) {
        fall = bounces ? -ANIMAL_THROW : 0;
        worldY = ground;
        if (bounces && !bouncing) run = -ANIMAL_RUN;
        bouncing = true;
      }
    }
    s.x = (worldX >> 8) - stage.camera.x;
    s.y = (worldY >> 8) - stage.camera.y;
    if (s.x < -ANIMAL_OFF_THE_SCREEN || s.x > DISPLAY_W + ANIMAL_OFF_THE_SCREEN || s.y + ANIMAL_OFF_THE_SCREEN < 0 || s.y > DISPLAY_H + ANIMAL_OFF_THE_SCREEN) {
      c.destroyTask(t);
      return;
    }
    updateSprite(c, s);
    displaySprite(c, s);
  }, null, EFFECT_PRIORITY);
}

// CreateEnemyDefeatScore: the points, rising and then staying
function createScore(stage, x, y, variant) {
  const { c } = stage, tiles = stage.allocTiles(SCORE_TILES);
  const s = createSprite({ tiles, anim: ANIM_SCORE, variant, oamFlags: 0, frameFlags: BEHIND_THE_PLAYER });
  let rise = 0, rising = true;
  updateSprite(c, s);
  c.createTask(t => {
    rise++;
    if (rising) {
      s.x = x - stage.camera.x;
      s.y = y - rise - stage.camera.y;
      displaySprite(c, s);
      if (rise >= SCORE_RISES) {
        rising = false;
        y -= rise;
        rise = 0;
      }
    } else if (rise > SCORE_STAYS) {
      stage.freeTiles(tiles);
      c.destroyTask(t);
    } else {
      s.x = x - stage.camera.x;
      s.y = y - stage.camera.y;
      displaySprite(c, s);
    }
  }, null, EFFECT_PRIORITY);
}

/** All of it, at an enemy's place. */
export function defeatEnemy(stage, x, y) {
  const p = stage.player, before = stage.score;
  createCloud(stage, x, y);
  createAnimal(stage, x, y);
  stage.c.playSong(SE_ITEM_BOX);
  stage.score += SCORES[p.defeatScore];   // INCREMENT_SCORE
  if (Math.trunc(stage.score / EXTRA_LIFE_EVERY) !== Math.trunc(before / EXTRA_LIFE_EVERY)) stage.lives = Math.min(stage.lives + 1, 255);
  createScore(stage, x, y, p.defeatScore);
  if (p.defeatScore < SCORES.length - 1) p.defeatScore++;
}
