// Pen, Ice Mountain's penguin (enemy kind 20). Translated from the original's pen_mk1.c a function at a time, with the
// JavaScript version's engine/pen.js as the guide; every comment names the function it rewrites.
//
// It walks 0.625 px a frame between (d0 + 1) x 8 and (d0 + d2) x 8 px right of its spawn point, following the floor, turning to
// face the way it goes at either end. Away from the ends, once it has walked 60 frames since its last throw, it stops to throw a
// snowball when Sonic is less than 80 px away, and the snowball slides off along the ground the way the penguin faces. It isn't
// made in Ice Mountain on Easy. While it throws it follows the floor twice a frame from the same place, as the original does.

#include "enemies.h"

enum {
  ZONE_ICE_MOUNTAIN = 3,
  ANIM_PEN = 426, ANIM_SNOWBALL = 428, ANIM_PIECE = 429,   // SA1_ANIM_PEN, SA1_ANIM_PEN_PROJ_2 and _PROJ_3
  VARIANT_WALK = 0, VARIANT_THROW = 1,
  STEP = 160,                     // 0.625 px, in 1/256 px
  NEAR = 80 * 80,                 // Sonic is near within 80 px, squared
  REST = 60,                      // frames spent walking between two throws
  THROW = 13, THROWN = 16,        // the frame of the throw the snowball leaves on, and the last one
  HAND_RIGHT = 4, HAND_LEFT = -6, // where the snowball leaves, from the Pen
  // the snowball (CreatePenMk1Snowball)
  VRAM_SNOWBALL = 0x25A0, VRAM_PIECE = 0x2620,   // VRAM_RESERVED_EN_PEN_MK1_PROJ and _PROJ3
  ORDER_SNOWBALL = 9,
  SNOWBALL_SPEED = 0x200,         // Q(2)
  SNOWBALL_FALL = 60,             // 60/256 px a frame per frame, off the floor
  SNOWBALL_LIFE = 800,
  SNOWBALL_SLOPE = 1000,          // the floor's sine and cosine over this push it each frame
  SNOWBALL_LANDING = 0x400,       // it breaks landing faster than Q(4)
  SNOWBALL_TURN = 0x40,           // or when the floor turns a quarter turn under it
  SNOWBALL_NEAR_FLOOR = -5,
  STEEP_A = 63, STEEP_B = 93, STEEP_WIDTH = 28,   // the steep angles it breaks on, as (angle + A) & 0xFF <= WIDTH
  // it goes when this far off the screen: x + 60 as a 16-bit number above 360, y + 60 below 0 or y above 300
  OUT_MARGIN = 60, OUT_WIDTH = SCREEN_W + 120, OUT_BELOW = SCREEN_H + 140,
  // the pieces (CreatePenMk1SnowballDebris)
  PIECE_ACROSS = 0x100, PIECE_SPEED = -0x3C0, PIECE_FALL = 60, PIECE_BELOW = SCREEN_H + 80,
};

typedef struct {
  Object o;
  int d0, d2, q, v, dy, t, rest, throwing;
} Pen;

// --- the snowball's pieces ----------------------------------------------------------------------------------------------------------
typedef struct { Object o; int ql, qr, qy, vy; } Pieces;

/** Task_SnowballDebris: two pieces thrown up, one going left and one right, drawn the same way round */
static int pieces_run(ActTask *t) {
  Pieces *d = (Pieces *)t->data;
  Sprite *s = &d->o.sprite;
  d->ql -= PIECE_ACROSS; d->qr += PIECE_ACROSS;
  d->vy = s16(d->vy + PIECE_FALL);
  d->qy += d->vy;
  int y = s16(d->qy >> 8);
  if (s16(y - cam_y()) > PIECE_BELOW) return 0;
  sprite_step(s);
  object_draw(s, s16(d->ql >> 8), y);
  object_draw(s, s16(d->qr >> 8), y);
  return 1;
}

/** CreatePenMk1SnowballDebris */
static void pieces_new(int x, int y) {
  Pieces *d = OBJECT_NEW(Pieces);
  if (!d) return;
  d->ql = d->qr = x * 256; d->qy = y * 256;
  d->vy = PIECE_SPEED;
  object_sprite_at(&d->o.sprite, OBJ_VRAM + VRAM_PIECE, ANIM_PIECE, 0, ORDER_SNOWBALL, ENEMY_PRIORITY, 0, 0);
  sprite_step(&d->o.sprite);
  object_task(&d->o, pieces_run, ENEMY_SHOT_PRIORITY);
}

// --- the snowball -------------------------------------------------------------------------------------------------------------------
typedef struct { Object o; int x0, y0, vx, vy, qx, qy, life, angle, air; } Snowball;

static int burst(int x, int y) { pieces_new(x, y); return 0; }

/** Task_PenMk1Snowball: it slides along the floor, sped up or slowed by its slope and pushed down by it, and falls off it. The
 *  test that would stop it on a slope steeper than its speed never passes, as in the original. */
static int snowball_run(ActTask *t) {
  Snowball *b = (Snowball *)t->data;
  Sprite *s = &b->o.sprite;
  if (b->air) b->vy = s16(b->vy + SNOWBALL_FALL);
  b->qx += b->vx;
  b->qy += b->vy;
  int x = s16(b->x0 + (b->qx >> 8)), y = s16(b->y0 + (b->qy >> 8));
  b->vx = s16(b->vx + s16(bios_div(SINE[(b->angle * 4) & 1023], SNOWBALL_SLOPE)));
  b->qy += bios_div(SINE[b->angle * 4 + 256], SNOWBALL_SLOPE);
  if (b->life != 0) b->life--;
  if (enemy_projectile(s, x, y) || b->life == 0) return burst(x, y);
  Scan f = terrain_tile_probe(PROBE_FLOOR, y, x, ENEMY_LAYER, 8);
  if (f.d > 0) {
    if (!b->air) b->vy = 0;
    b->air = 1;
  } else {
    if (b->air) {
      b->angle = 0;
      if (b->vy > SNOWBALL_LANDING) return burst(x, y);
    }
    if (f.d < 0) b->air = 0;
  }
  // a floor was found wherever the angle is read below
  if (!b->air) {
    if (f.d < 0) { b->qy += f.d * 256; b->vy = 0; }
    else b->vy = s16(b->vy + f.d * 64);
    int turn = (int8_t)(b->angle - f.rot);
    if (turn < 0) turn = (int8_t)-turn;
    if (turn >= SNOWBALL_TURN) return burst(x, y);
    b->angle = f.rot & 0xFF;
  }
  if (f.d >= SNOWBALL_NEAR_FLOOR && f.d <= 0) {
    if (((f.rot + STEEP_A) & 0xFF) <= STEEP_WIDTH || ((f.rot + STEEP_B) & 0xFF) <= STEEP_WIDTH) return burst(x, y);
  } else {
    int sx = s16(x - cam_x()), sy = s16(y - cam_y());
    if ((uint16_t)(sx + OUT_MARGIN) > OUT_WIDTH || sy + OUT_MARGIN < 0 || sy > OUT_BELOW) return 0;
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

/** CreatePenMk1Snowball: it starts as far below as the floor is, in 1/256 px, as the original keeps it */
static void snowball_new(int x, int y, int right) {
  Snowball *b = OBJECT_NEW(Snowball);
  if (!b) return;
  b->x0 = x; b->y0 = y;
  b->vx = right ? SNOWBALL_SPEED : -SNOWBALL_SPEED;
  b->qy = terrain_tile_floor(x, y, ENEMY_LAYER, 8);
  b->life = SNOWBALL_LIFE;
  object_sprite_at(&b->o.sprite, OBJ_VRAM + VRAM_SNOWBALL, ANIM_SNOWBALL, 0, ORDER_SNOWBALL, ENEMY_PRIORITY, 0, 0);
  sprite_step(&b->o.sprite);
  object_task(&b->o, snowball_run, ENEMY_SHOT_PRIORITY);
}

// --- the Pen ------------------------------------------------------------------------------------------------------------------------
/** Task_PenMk1Main, walking, and Task_8073CC4, throwing */
static int pen_run(ActTask *t) {
  Pen *n = (Pen *)t->data;
  Sprite *s = &n->o.sprite;
  Slot *slot = n->o.slot;
  const Entity *e = &slot->e;
  int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
  if (!n->throwing) n->q += n->v;
  int x = s16(e->x + enemy_i(n->q)), y = s16(e->y + n->dy);
  if (n->throwing) {
    n->dy += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    n->t++;
  }
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  if (!n->throwing) {
    n->dy += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    int dx = enemy_sonic_x() - x, dy = enemy_sonic_y() - y;
    if (enemy_i(n->q) <= (n->d0 + 1) * ENEMY_TILE) {
      if (!right) { enemy_flip_x(s, 1); n->v = STEP; }
    } else if (enemy_i(n->q) >= (n->d0 + n->d2) * ENEMY_TILE) {
      if (right) { enemy_flip_x(s, 0); n->v = -STEP; }
    } else if (n->rest != 0) n->rest--;
    else if (dx * dx + dy * dy < NEAR) {
      n->t = 0; n->rest = REST;
      sprite_start(s, VARIANT_THROW);
      n->throwing = 1;
    }
  } else {
    if (n->t == THROW) snowball_new(right ? x + HAND_RIGHT : x + HAND_LEFT, y, right);
    n->dy += terrain_tile_floor(x, y, ENEMY_LAYER, 8);
    if (n->t > THROWN) { n->t = 0; sprite_start(s, VARIANT_WALK); n->throwing = 0; }
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

/** CreateEntity_PenMk1 */
ActTask *pen_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(ZONE_ICE_MOUNTAIN)) return NULL;
  Pen *n = OBJECT_NEW(Pen);
  if (!n) return NULL;
  EnemyData d = enemy_data(&slot->e);
  n->o.slot = slot;
  n->o.x = slot->e.x;
  n->d0 = d.d0; n->d2 = d.d2;
  n->v = -STEP;
  enemy_sprite(&n->o.sprite, ANIM_PEN, VARIANT_WALK, VARIANT_THROW, ENEMY_ORDER);
  return object_task(&n->o, pen_run, PRIORITY_OBJECTS);
}
