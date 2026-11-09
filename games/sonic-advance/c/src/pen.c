// Pen, Ice Mountain's penguin (enemy kind 20). Translated from the JavaScript version's engine/pen.js (the original's
// pen_mk1.c). It walks 0.625 px a frame between (d0 + 1) x 8 and (d0 + d2) x 8 px right of its spawn point, following the
// floor, turning to face the way it goes at either end. Away from the ends, once it has walked 60 frames since its last
// throw, it stops to throw a snowball when Sonic is less than 80 px away, and the snowball slides off along the ground the way
// the penguin faces. It isn't made in Ice Mountain on Easy.
//
// While it throws it follows the floor twice a frame from the same place, so on a slope it moves twice as far toward it.

#include "enemies.h"

enum {
  ANIM_PEN = 426, VARIANT_WALK = 0, VARIANT_THROW = 1,
  ANIM_SNOWBALL = 428, ANIM_PIECE = 429, ORDER_SNOWBALL = 9,
  ZONE_ICE_MOUNTAIN = 3,
  STEP = 160,             // 0.625 px, in 1/256 px
  REST = 60,              // frames of walking before it can throw again
  NEAR = 80 * 80,
  THROW = 13, THROWN = 16,
  SNOWBALL_SPEED = 512, SNOWBALL_LIFE = 800, FALL = 60, BURST_LANDING = 0x400,
  PIECE_UP = -0x3C0,
};

typedef struct { Object o; int d0, d2, q, v, dy, rest, t, throwing; } Pen;
typedef struct { Object o; int x0, y0, vx, vy, qx, qy, angle, air, life; } Snowball;
typedef struct { Object o; int ql, qr, qy, vy; } Pieces;

// --- the snowball's two pieces (CreatePenMk1SnowballDebris, Task_SnowballDebris) ---------------------------------------------------
// thrown up at 3.75 px a frame and falling 60/256 px a frame faster each frame, one moving 1 px a frame left and the other as far
// right, drawn the same way round; they go 80 px below the screen
static int pieces_run(ActTask *t) {
  Pieces *p = (Pieces *)t->data;
  Sprite *s = &p->o.sprite;
  p->ql -= 256; p->qr += 256;
  p->vy = s16(p->vy + FALL);
  p->qy += p->vy;
  int y = s16(p->qy >> 8);
  if (s16(y - cam_y()) > 240) return 0;
  sprite_step(s);
  object_draw(s, s16(p->ql >> 8), y);
  object_draw(s, s16(p->qr >> 8), y);
  return 1;
}

static void pieces_new(int x, int y) {
  Pieces *p = OBJECT_NEW(Pieces);
  if (!p) return;
  p->ql = p->qr = x * 256; p->qy = y * 256; p->vy = PIECE_UP;
  object_sprite(&p->o.sprite, ANIM_PIECE, 0, 0, ORDER_SNOWBALL, ENEMY_PRIORITY, 0, 0);
  object_task(&p->o, pieces_run, ENEMY_SHOT_PRIORITY);
}

// --- the snowball (CreatePenMk1Snowball, Task_PenMk1Snowball) ------------------------------------------------------------------------
// It slides 2 px a frame along the floor, sped up or slowed by the floor's slope (sine / 1000 of its angle a frame) and pushed
// down by its cosine / 1000. Off the floor it falls, 60/256 px a frame faster each frame. It breaks into pieces when it touches
// Sonic (hurting him), after 800 frames, when it lands faster than 4 px a frame, when the floor's angle changes by a quarter
// turn or more from one frame to the next, or when it reaches a steep slope; off the screen it goes. The original keeps the
// floor distance it starts with in the field it keeps in 1/256 px, so it starts 1/256 of that lower, and its test that would
// stop it on a slope steeper than its speed never passes: both kept.
static int burst(int x, int y) { pieces_new(x, y); return 0; }

static int snowball_run(ActTask *t) {
  Snowball *b = (Snowball *)t->data;
  Sprite *s = &b->o.sprite;
  if (b->air) b->vy = s16(b->vy + FALL);
  b->qx += b->vx;
  b->qy += b->vy;
  int x = s16(b->x0 + (b->qx >> 8)), y = s16(b->y0 + (b->qy >> 8));
  b->vx = s16(b->vx + SINE[(b->angle * 4) & 1023] / 1000);
  b->qy += SINE[((b->angle * 4) & 1023) + 256] / 1000;
  if (b->life != 0) b->life--;
  if (enemy_projectile(s, x, y) || b->life == 0) return burst(x, y);
  Scan f = terrain_tile_probe(PROBE_FLOOR, y, x, ENEMY_LAYER, 8);
  if (f.d > 0) {
    if (!b->air) b->vy = 0;
    b->air = 1;
  } else {
    if (b->air) {
      b->angle = 0;
      if (b->vy > BURST_LANDING) return burst(x, y);
    }
    if (f.d < 0) b->air = 0;
  }
  // a floor was found whenever d <= 0, so its angle is set wherever it is read
  if (!b->air) {
    if (f.d < 0) { b->qy += f.d * 256; b->vy = 0; } else b->vy = s16(b->vy + f.d * 64);
    int turn = s8(b->angle - f.rot);
    if (turn < 0) turn = s8(-turn);
    if (turn > 0x3F) return burst(x, y);
    b->angle = f.rot;
  }
  if (f.d >= -5 && f.d <= 0) {
    if (((f.rot + 0x3F) & 0xFF) <= 0x1C || ((f.rot + 0x5D) & 0xFF) <= 0x1C) return burst(x, y);
  } else {
    int sx = s16(x - cam_x()), sy = s16(y - cam_y());
    if (((sx + 60) & 0xFFFF) > 360 || sy + 60 < 0 || sy > 300) return 0;
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

static void snowball_new(int x, int y, int right) {
  Snowball *b = OBJECT_NEW(Snowball);
  if (!b) return;
  b->x0 = x; b->y0 = y;
  b->vx = right ? SNOWBALL_SPEED : -SNOWBALL_SPEED;
  b->qy = terrain_tile_floor(x, y, ENEMY_LAYER, 8);
  b->life = SNOWBALL_LIFE;
  object_sprite(&b->o.sprite, ANIM_SNOWBALL, 0, 0, ORDER_SNOWBALL, ENEMY_PRIORITY, 0, 0);
  object_task(&b->o, snowball_run, ENEMY_SHOT_PRIORITY);
}

// --- the penguin ---------------------------------------------------------------------------------------------------------------------
static int pen_run(ActTask *t) {
  Pen *p = (Pen *)t->data;
  Sprite *s = &p->o.sprite;
  Slot *slot = p->o.slot;
  const Entity *e = &slot->e;
  if (!p->throwing) p->q += p->v;
  int x = s16(e->x + enemy_i(p->q)), y = s16(e->y + p->dy);
  if (p->throwing) {
    p->dy += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    p->t++;
  }
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
  if (!p->throwing) {
    p->dy += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    int dx = enemy_sonic_x() - x, dy = enemy_sonic_y() - y;
    if (enemy_i(p->q) <= (p->d0 + 1) * ENEMY_TILE) {
      if (!right) { enemy_flip_x(s, 1); p->v = STEP; }
    } else if (enemy_i(p->q) >= (p->d0 + p->d2) * ENEMY_TILE) {
      if (right) { enemy_flip_x(s, 0); p->v = -STEP; }
    } else if (p->rest != 0) p->rest--;
    else if (dx * dx + dy * dy < NEAR) {
      p->t = 0; p->rest = REST;
      sprite_start(s, VARIANT_THROW);
      p->throwing = 1;
    }
  } else {
    if (p->t == THROW) snowball_new(right ? x + 4 : x - 6, y, right);
    p->dy += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    if (p->t > THROWN) { p->t = 0; sprite_start(s, VARIANT_WALK); p->throwing = 0; }
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *pen_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(ZONE_ICE_MOUNTAIN)) return NULL;
  Pen *p = OBJECT_NEW(Pen);
  if (!p) return NULL;
  EnemyData d = enemy_data(&slot->e);
  p->o.slot = slot;
  p->o.x = slot->e.x;
  p->d0 = d.d0; p->d2 = d.d2;
  p->v = -STEP;
  enemy_sprite(&p->o.sprite, ANIM_PEN, VARIANT_WALK, VARIANT_THROW, ENEMY_ORDER);
  return object_task(&p->o, pen_run, PRIORITY_OBJECTS);
}
