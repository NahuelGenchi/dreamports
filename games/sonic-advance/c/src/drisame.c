// Drisame (kind 18), Ice Mountain's fish frozen in a block of ice. Translated from the JavaScript version's
// engine/drisame.js (the original's drisame.c: CreateEntity_Drisame, Task_DrisameInit, sub_8072E68 and CreateIceBlock).
// It waits in its block until Sonic comes within 80 px of it on its left (or right), within the angles it looks along,
// then the block shatters and the fish darts straight at where he was, about 1.8 px a frame, and keeps going. The angle
// is sub_8004418's rough one, of (dy, dx) rather than (dx, dy), as the original computes it.
//
// The block is a task of its own at 0x3000, after Sonic's: it stays drawn when the fish is destroyed inside it, and
// shatters into four pieces that fly apart, drawn and moved only two frames in every four. Once the fish darts off, the
// original tests its spawn point's x in place of its y for leaving the range (issue #56).

#include "enemies.h"

enum {
  ANIM_DRISAME = 424, ANIM_BLOCK = 573, ANIM_DEBRIS_LARGE = 579, ANIM_DEBRIS_SMALL = 580,
  ORDER_FISH = 11, ORDER_BLOCK = 10, PRIORITY_IN_FRONT = 1, PRIORITY_BLOCK = 0x3000,
  NEAR = 80 * 80, SPEED_DIV = 35, PIECE_GRAVITY = 20, SHATTER_FRAMES = 30,
};

typedef struct Block Block;
typedef struct { Object o; Block *block; int darting, vx, vy, qx, qy; } Drisame;

// the block (CreateIceBlock): o.sprite is the whole block; each piece's place, its speed across in quarter pixels and up
struct Block {
  Object o;
  Sprite large, small;
  Block **owner;     // the fish's pointer to this block, cleared as it goes
  int x0, y0, shattered, broken, n;
  int qx[4], x[4], y[4], vx[4], vy[4];
};

// where each piece starts from the block's centre (right, below, left, above), its speed across and its speed up
static const int PIECES[4][4] = { { 16, 0, 3, -256 }, { 0, 8, -2, -256 }, { -16, 0, -3, -336 }, { 0, -8, 2, -336 } };

static int block_run(ActTask *t) {
  Block *b = (Block *)t->data;
  if (!b->broken) {
    if (enemy_gone(b->x0, b->y0, b->x0, b->y0)) return 0;
    if (b->shattered) b->broken = 1;
    sprite_step(&b->o.sprite);
    object_draw(&b->o.sprite, b->x0, b->y0);
    return 1;
  }
  if (++b->n >= SHATTER_FRAMES) return 0;
  sprite_step(&b->large);
  sprite_step(&b->small);
  if (b->n & 2) {
    for (int i = 0; i < 4; i++) {
      b->qx[i] += b->vx[i];
      b->x[i] = b->qx[i] / 4;
      b->vy[i] += PIECE_GRAVITY;
      b->y[i] += enemy_i(b->vy[i]);
      object_draw(i & 1 ? &b->large : &b->small, b->x[i], b->y[i]);
    }
  }
  return 1;
}

static void block_end(ActTask *t) {
  Block *b = (Block *)t->data;
  if (b->owner) *b->owner = NULL;
  object_sprite_free(&b->large);
  object_sprite_free(&b->small);
  object_end(t);
}

static Block *block_new(int x0, int y0) {
  Block *b = OBJECT_NEW(Block);
  if (!b) return NULL;
  b->x0 = x0; b->y0 = y0;
  for (int i = 0; i < 4; i++) {
    b->qx[i] = (x0 + PIECES[i][0]) * 4;
    b->x[i] = x0 + PIECES[i][0];
    b->y[i] = y0 + PIECES[i][1];
    b->vx[i] = PIECES[i][2];
    b->vy[i] = PIECES[i][3];
  }
  // the original takes their tiles in this order: the large piece's, the small one's and the block's
  object_sprite(&b->large, ANIM_DEBRIS_LARGE, 0, 0, ORDER_BLOCK, PRIORITY_IN_FRONT, 0, 0);
  object_sprite(&b->small, ANIM_DEBRIS_SMALL, 0, 0, ORDER_BLOCK, PRIORITY_IN_FRONT, 0, 0);
  object_sprite(&b->o.sprite, ANIM_BLOCK, 0, 0, ORDER_BLOCK, PRIORITY_IN_FRONT, 0, 0);
  ActTask *t = object_task(&b->o, block_run, PRIORITY_BLOCK);
  if (!t) { object_sprite_free(&b->large); object_sprite_free(&b->small); return NULL; }
  t->end = block_end;
  return b;
}

static int cos_of(int a) { return SINE[a + 256]; }

static int drisame_run(ActTask *t) {
  Drisame *d = (Drisame *)t->data;
  Slot *slot = d->o.slot;
  const Entity *e = &slot->e;
  Sprite *s = &d->o.sprite;
  int x = e->x, y = e->y;
  if (!d->darting) {
    if (enemy_gone(e->x, e->y, x, y)) return 0;
    int dy = enemy_sonic_y() - y, dx = enemy_sonic_x() - x;
    int a = octant_angle(dy, dx) & 0x3FF, near = dy * dy + dx * dx < NEAR;
    if (a >= 385 && a < 640 && near) {
      if (d->block) d->block->shattered = 1;
      enemy_flip_x(s, 0);
      int v = cos_of(a) / SPEED_DIV;
      d->vx = v < 0 ? v : -v;
      d->vy = SINE[a] / SPEED_DIV;
      d->qx = d->qy = 0; d->darting = 1;
    }
    if ((a < 128 || a > 896) && near) {
      if (d->block) d->block->shattered = 1;
      enemy_flip_x(s, 1);
      d->vx = cos_of(a) / SPEED_DIV;
      d->vy = SINE[a] / SPEED_DIV;
      d->qx = d->qy = 0; d->darting = 1;
    }
  } else {
    d->qx += d->vx; d->qy += d->vy;
    x = e->x + enemy_i(d->qx); y = e->y + enemy_i(d->qy);
    // the original's slip: its spawn point's x for both
    if (enemy_gone(e->x, e->x, x, y)) return 0;
  }
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

static void drisame_end(ActTask *t) {
  Drisame *d = (Drisame *)t->data;
  if (d->block) d->block->owner = NULL;
  object_end(t);
}

// CreateEntity_Drisame
ActTask *drisame_spawn(Slot *slot) {
  Drisame *d = OBJECT_NEW(Drisame);
  if (!d) return NULL;
  d->o.slot = slot;
  d->o.x = slot->e.x;
  object_sprite(&d->o.sprite, ANIM_DRISAME, 0, 0, ORDER_FISH, PRIORITY_IN_FRONT, 0, 0);
  sprite_step(&d->o.sprite);
  ActTask *t = object_task(&d->o, drisame_run, PRIORITY_OBJECTS);
  if (!t) return NULL;
  t->end = drisame_end;
  d->block = block_new(slot->e.x, slot->e.y);
  if (d->block) d->block->owner = &d->block;
  return t;
}
