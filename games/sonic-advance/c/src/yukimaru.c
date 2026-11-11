// Yukimaru, Ice Mountain's snowman (enemy kinds 16 and 17). Translated from the JavaScript version's engine/yukimaru.js (the
// original's yukimaru.c). Its sprite is a half, drawn again mirrored for the other, and each half has its own tiles.
//
// On the ground (16) it walks 0.625 px a frame between d0 x 8 and (d0 + d2) x 8 px right of its spawn point, 6 px above it and
// following the floor, turning at either end. Away from the ends, once it has walked 60 frames since its last throw, it throws a
// snowball straight up whenever Sonic is above it and no more than 8 px to either side. On a wall (17) it climbs the same way
// between d1 x 8 and (d1 + d3) x 8 px below its spawn point, keeping to the wall (on its right when d0 isn't 0, on its left when
// it is), and throws across, away from the wall, whenever Sonic is on that side no more than 8 px above or below it.
//
// The snowballs pass through Sonic, hurting him, and leave only off the screen. The one thrown up keeps the snowman's X in a
// 16-bit field four times over: from X 8192 on it would appear 16384 px to the left and leave at once, which no Yukimaru in the
// game is far enough right for.

#include "enemies.h"

enum {
  ANIM_GROUND = 422, ANIM_WALL = 423, VARIANT_THROW = 0, VARIANT_WALK = 1,
  ANIM_SNOWBALL = 427, ORDER_SNOWBALL = 1, PRIORITY_SNOWBALL = 0,
  SNOWBALL_DEST = OBJ_VRAM + 0x2580,   // VRAM_RESERVED_EN_YUKIMARU_PROJ
  TILES = 8,                           // a half is 16 by 32 px, or 32 by 16 on the wall
  ORDER_HALF = 0, ORDER_MIRROR = 18,
  STEP = 160,                          // 0.625 px, in 1/256 px
  REST = 60,                           // frames of walking before it can throw again
  NEAR = 8, ABOVE = 6, THROW_UP = 18, THROW_ACROSS = 10,
  THROWN = 4, DONE_GROUND = 13, DONE_WALL = 18,
  UP_SPEED = -0x500, UP_FALL = 40, ACROSS_SPEED = 3, ACROSS_FALL = 23,
};

typedef struct { Object o; Sprite s2; int d0, d1, d2, d3, q, v, d, rest, t, throwing; } Yukimaru;
typedef struct { Object o; int16_t x4; int x, y, vx, vy; } Snowball;

// --- the snowballs (CreateSnowball and Task_Snowball, CreateSnowball2 and Task_Snowball2) --------------------------------------
// they leave once 20 px or more past the screen's left, right or top, or 80 past its bottom
static int snowball_off(int x, int y) {
  int sx = s16(x - cam_x()), sy = s16(y - cam_y());
  return ((sx + 20) & 0xFFFF) > 276 || sy + 20 < 0 || sy > 240;
}

static int snowball_run(ActTask *t) {
  Snowball *b = (Snowball *)t->data;
  Sprite *s = &b->o.sprite;
  if (b->vx == 0) b->x = (b->x4 < 0 ? b->x4 + 3 : b->x4) >> 2;   // thrown up: its X from the field kept four times over
  else b->x = s16(b->x + b->vx);
  b->vy = s16(b->vy + (b->vx == 0 ? UP_FALL : ACROSS_FALL));
  b->y = s16(b->y + enemy_i(b->vy));
  enemy_projectile(s, b->x, b->y);
  if (snowball_off(b->x, b->y)) return 0;
  sprite_step(s);
  object_draw(s, b->x, b->y);
  return 1;
}

// up (vx 0) at 5 px a frame, slowing by 40/256 px a frame each frame; or across at 3 px a frame, falling by 23/256 px a frame
// more each frame from 8 px left of where it was thrown from
static void snowball_new(int x, int y, int vx) {
  Snowball *b = OBJECT_NEW(Snowball);
  if (!b) return;
  b->x4 = (int16_t)(x * 4);
  b->x = s16(x - 8); b->y = y; b->vx = vx;
  b->vy = vx == 0 ? UP_SPEED : 0;
  object_sprite_at(&b->o.sprite, SNOWBALL_DEST, ANIM_SNOWBALL, 0, ORDER_SNOWBALL, PRIORITY_SNOWBALL, 0, 0);
  sprite_step(&b->o.sprite);
  object_task(&b->o, snowball_run, ENEMY_SHOT_PRIORITY);
}

// --- the snowman ---------------------------------------------------------------------------------------------------------------------
static void set_variant(Yukimaru *y, int variant) { y->o.sprite.variant = y->s2.variant = (uint8_t)variant; }

// both halves, the second mirrored across (on the ground) or down (on the wall)
static void draw(Yukimaru *y, int x, int yy, uint32_t mirror) {
  sprite_step(&y->o.sprite);
  sprite_step(&y->s2);
  object_draw(&y->o.sprite, x, yy);
  y->s2.frameFlags |= mirror;
  object_draw(&y->s2, x, yy);
  y->s2.frameFlags &= ~mirror;
}

// Task_YukimaruGroundInit, Task_8071BFC
static int ground_run(ActTask *t) {
  Yukimaru *y = (Yukimaru *)t->data;
  Slot *slot = y->o.slot;
  const Entity *e = &slot->e;
  if (!y->throwing) y->q = s16(y->q + y->v);
  int x = s16(e->x + enemy_i(y->q)), yy = s16(e->y - ABOVE + y->d);
  if (enemy_gone(e->x, e->y, x, yy)) return 0;
  if (enemy_attack(&y->o.sprite, x, yy)) { slot->gone = 1; return 0; }
  y->d = s16(y->d + terrain_tile_floor(x, yy, ENEMY_LAYER, 8));
  if (!y->throwing) {
    if (enemy_i(y->q) <= y->d0 * ENEMY_TILE) y->v = STEP;
    else if (enemy_i(y->q) >= (y->d0 + y->d2) * ENEMY_TILE) y->v = -STEP;
    else if (y->rest != 0) y->rest--;
    else if (enemy_sonic_y() <= yy && enemy_sonic_x() <= x + NEAR && x - NEAR <= enemy_sonic_x()) {
      y->rest = REST; y->t = 0; set_variant(y, VARIANT_THROW); y->throwing = 1;
    }
  } else {
    y->t++;
    if (y->t == THROWN) snowball_new(x, yy - THROW_UP, 0);
    if (y->t == DONE_GROUND) { set_variant(y, VARIANT_WALK); y->throwing = 0; }
  }
  draw(y, x, yy, SPRITE_X_FLIP);
  return 1;
}

// Task_YukimaruWallInit and sub_80723C0 (d0 not 0, throwing left), Task_YukimaruWallInit2 and sub_80727B4 (d0 0, throwing
// right): the throw to the right sets off its snowball before it can leave or be defeated that frame
static int wall_run(ActTask *t) {
  Yukimaru *y = (Yukimaru *)t->data;
  Slot *slot = y->o.slot;
  const Entity *e = &slot->e;
  int right = y->d0 == 0;
  if (!y->throwing) y->q = s16(y->q + y->v);
  int x = s16(e->x + y->d), yy = s16(e->y + enemy_i(y->q));
  if (y->throwing && right && ++y->t == THROWN) snowball_new(x + THROW_ACROSS, yy, ACROSS_SPEED);
  if (enemy_gone(e->x, e->y, x, yy)) return 0;
  if (enemy_attack(&y->o.sprite, x, yy)) { slot->gone = 1; return 0; }
  if (!y->throwing) {
    int d = terrain_tile_probe(PROBE_WALL, x, yy, ENEMY_LAYER, right ? -8 : 8).d;
    y->d = s16(right ? y->d - d : y->d + d);
    int px = enemy_sonic_x(), py = enemy_sonic_y();
    if (enemy_i(y->q) <= y->d1 * ENEMY_TILE) y->v = STEP;
    else if (enemy_i(y->q) >= (y->d1 + y->d3) * ENEMY_TILE) y->v = -STEP;
    else if (y->rest != 0) y->rest--;
    else if ((right ? px >= x : px <= x) && py <= yy + NEAR && yy - NEAR <= py) {
      y->rest = REST; y->t = 0; set_variant(y, VARIANT_THROW); y->throwing = 1;
    }
  } else {
    if (!right && ++y->t == THROWN) snowball_new(x - THROW_ACROSS, yy, -ACROSS_SPEED);
    if (y->t == DONE_WALL) { set_variant(y, VARIANT_WALK); y->throwing = 0; }
  }
  draw(y, x, yy, SPRITE_Y_FLIP);
  return 1;
}

static void yukimaru_end(ActTask *t) {
  object_sprite_free(&((Yukimaru *)t->data)->s2);
  object_end(t);
}

// CreateEntity_Yukimaru, CreateEntity_Yukimaru_Wall: on the wall, both halves face away from it unless d0 is 1
static ActTask *spawn(Slot *slot, int wall) {
  Yukimaru *y = OBJECT_NEW(Yukimaru);
  if (!y) return NULL;
  EnemyData d = enemy_data(&slot->e);
  y->o.slot = slot;
  y->o.x = slot->e.x;
  y->d0 = d.d0; y->d1 = d.d1; y->d2 = d.d2; y->d3 = d.d3;
  y->v = -STEP;
  int anim = wall ? ANIM_WALL : ANIM_GROUND, flip = wall && d.d0 != 1;
  object_sprite_at(&y->o.sprite, vram_malloc(TILES), anim, VARIANT_WALK, ORDER_HALF, ENEMY_PRIORITY, 0, 0);
  sprite_step(&y->o.sprite);
  if (flip) y->o.sprite.frameFlags |= SPRITE_X_FLIP;
  object_sprite_at(&y->s2, vram_malloc(TILES), anim, VARIANT_WALK, wall ? ORDER_HALF : ORDER_MIRROR, ENEMY_PRIORITY, flip, 0);
  sprite_step(&y->s2);
  ActTask *t = object_task(&y->o, wall ? wall_run : ground_run, PRIORITY_OBJECTS);
  if (!t) object_sprite_free(&y->s2);
  else t->end = yukimaru_end;
  return t;
}

ActTask *yukimaru_spawn(Slot *slot) { return spawn(slot, 0); }
ActTask *yukimaru_wall_spawn(Slot *slot) { return spawn(slot, 1); }
