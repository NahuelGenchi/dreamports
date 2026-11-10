// Drisame, Ice Mountain's fish frozen in a block of ice (enemy kind 18). Translated from the original's drisame.c a function at a
// time, with the JavaScript version's engine/drisame.js as the guide; every comment names the function it rewrites.
//
// It waits in its block until Sonic comes within 80 px of it, on its left or its right within the angles it looks along. Then
// the block shatters and the fish darts straight at where he was, about 1.8 px a frame, and keeps going. The angle is
// sub_8004418's rough one, of (dy, dx). The block is a task of its own after Sonic's: it stays drawn when the fish is
// destroyed inside it, and shatters into four pieces that fly apart, drawn and moved only two frames in every four. Once the
// fish darts off, the original tests its spawn point's x in place of its y for leaving the range, and so does this.

#include "enemies.h"

enum {
  ANIM_DRISAME = 424, ANIM_BLOCK = 573,                 // SA1_ANIM_DRISAME and SA1_ANIM_DRISAME_ICEBLOCK
  ANIM_PIECE_LARGE = 579, ANIM_PIECE_SMALL = 580,      // SA1_ANIM_DRISAME_ICEBLOCK_DEBRIS_LARGE and _SMALL
  DRISAME_TILES = 40 / 8 * (16 / 8), BLOCK_TILES = 56 / 8 * (32 / 8),   // ALLOC_TILES of each
  PIECE_LARGE_TILES = 16 / 8 * (16 / 8), PIECE_SMALL_TILES = 8 / 8 * (8 / 8),
  ORDER_DRISAME = 11, ORDER_BLOCK = 10, PRIORITY_DRISAME = 1,
  NEAR = 80 * 80,                 // Sonic is near within 80 px, squared
  LEFT_FROM = 385, LEFT_TO = 640, // the angles it sees him at on its left, from and below
  RIGHT_BELOW = 128, RIGHT_ABOVE = 896,   // and on its right, below the one or above the other
  SPEED_DIV = 35,                 // its speed is the angle's sine and cosine over this
  PIECES = 4,
  PIECE_FALL = 20,                // Q(20/256): 20/256 px a frame per frame
  SHATTER_FRAMES = 30,
};

// --- the block (CreateIceBlock) -----------------------------------------------------------------------------------------------------
// each piece starts this far from the block's centre (right, below, left, above), goes across this many quarter pixels a frame
// and starts going up this fast, in 1/256 px; the odd ones are large, the even ones small
static const int8_t PIECE_AT[PIECES][2] = { { 16, 0 }, { 0, 8 }, { -16, 0 }, { 0, -8 } };
static const int8_t PIECE_ACROSS[PIECES] = { 3, -2, -3, 2 };
static const int16_t PIECE_UP[PIECES] = { -0x100, -0x100, -0x150, -0x150 };   // -Q(1) and -Q(1.3125)

typedef struct Drisame Drisame;
typedef struct {
  Object o;                       // the whole block
  Sprite large, small;
  Drisame *fish;
  int x, y, n, shattered, broken;
  int16_t qx[PIECES], px[PIECES], py[PIECES], vy[PIECES];   // in quarter pixels, pixels and 1/256 px, as the original keeps them
} Block;

struct Drisame {
  Object o;
  Block *block;
  int darting, vx, vy, qx, qy;
};

/** Task_IceBlockInit, while whole, and Task_IceBlock_8073364, shattered */
static int block_run(ActTask *t) {
  Block *b = (Block *)t->data;
  if (!b->broken) {
    if (off_display(b->x, b->y) && off_cam(b->x, b->y)) return 0;
    if (b->shattered) b->broken = 1;   // from the next frame on
    sprite_step(&b->o.sprite);
    object_draw(&b->o.sprite, b->x, b->y);
    return 1;
  }
  if (++b->n >= SHATTER_FRAMES) return 0;
  sprite_step(&b->large);
  sprite_step(&b->small);
  if (b->n & 2) {
    for (int i = 0; i < PIECES; i++) {
      b->qx[i] += PIECE_ACROSS[i];
      b->px[i] = b->qx[i] / 4;
      b->vy[i] = s16(b->vy[i] + PIECE_FALL);
      b->py[i] = s16(b->py[i] + (b->vy[i] >> 8));
      object_draw(i & 1 ? &b->large : &b->small, b->px[i], b->py[i]);
    }
  }
  return 1;
}

/** TaskDestructor_IceBlock */
static void block_end(ActTask *t) {
  Block *b = (Block *)t->data;
  if (b->fish) b->fish->block = NULL;
  object_sprite_free(&b->large);
  object_sprite_free(&b->small);
  object_end(t);
}

/** CreateIceBlock */
static Block *block_new(int x, int y) {
  Block *b = OBJECT_NEW(Block);
  if (!b) return NULL;
  b->x = x; b->y = y;
  for (int i = 0; i < PIECES; i++) {
    b->vy[i] = PIECE_UP[i];
    b->qx[i] = (x + PIECE_AT[i][0]) * 4;
    b->px[i] = x + PIECE_AT[i][0];
    b->py[i] = y + PIECE_AT[i][1];
  }
  object_sprite_at(&b->large, vram_malloc(PIECE_LARGE_TILES), ANIM_PIECE_LARGE, 0, ORDER_BLOCK, PRIORITY_DRISAME, 0, 0);
  object_sprite_at(&b->small, vram_malloc(PIECE_SMALL_TILES), ANIM_PIECE_SMALL, 0, ORDER_BLOCK, PRIORITY_DRISAME, 0, 0);
  object_sprite_at(&b->o.sprite, vram_malloc(BLOCK_TILES), ANIM_BLOCK, 0, ORDER_BLOCK, PRIORITY_DRISAME, 0, 0);
  ActTask *t = object_task(&b->o, block_run, ENEMY_SHOT_PRIORITY);
  if (!t) {
    object_sprite_free(&b->large);
    object_sprite_free(&b->small);
    return NULL;
  }
  t->end = block_end;
  return b;
}

// --- the fish -----------------------------------------------------------------------------------------------------------------------
/** Task_DrisameInit's darting off: the block shatters and it heads along the angle it saw him at */
static void dart(Drisame *d, int a, int right) {
  if (d->block) d->block->shattered = 1;
  enemy_flip_x(&d->o.sprite, right);
  int c = bios_div(SINE[a + 256], SPEED_DIV);
  d->vx = right || c < 0 ? c : -c;   // always to the left on its left
  d->vy = bios_div(SINE[a], SPEED_DIV);
  d->qx = d->qy = 0;
  d->darting = 1;
}

/** Task_DrisameInit, waiting in the block, and sub_8072E68, darting */
static int drisame_run(ActTask *t) {
  Drisame *d = (Drisame *)t->data;
  Sprite *s = &d->o.sprite;
  Slot *slot = d->o.slot;
  const Entity *e = &slot->e;
  int x = e->x, y = e->y;
  if (!d->darting) {
    if (off_display(x, y) && off_cam(x, y)) return 0;
    int dy = enemy_sonic_y() - y, dx = enemy_sonic_x() - x;
    int a = s16(quick_angle(dy, dx) & 0x3FF), near = dy * dy + dx * dx < NEAR;   // CLAMP_SIN_PERIOD
    if (a >= LEFT_FROM && a < LEFT_TO && near) dart(d, a, 0);
    if ((a < RIGHT_BELOW || a > RIGHT_ABOVE) && near) dart(d, a, 1);
  } else {
    d->qx += d->vx; d->qy += d->vy;
    x += enemy_i(d->qx); y += enemy_i(d->qy);
    if (off_display(e->x, e->x) && off_cam(x, y)) return 0;   // the spawn point's x for both, as the original
  }
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

/** The fish's end: the block, if it is still there, no longer hears from it */
static void drisame_end(ActTask *t) {
  Drisame *d = (Drisame *)t->data;
  if (d->block) d->block->fish = NULL;
  object_end(t);
}

/** CreateEntity_Drisame */
ActTask *drisame_spawn(Slot *slot) {
  Drisame *d = OBJECT_NEW(Drisame);
  if (!d) return NULL;
  d->o.slot = slot;
  d->o.x = slot->e.x;
  object_sprite_at(&d->o.sprite, vram_malloc(DRISAME_TILES), ANIM_DRISAME, 0, ORDER_DRISAME, PRIORITY_DRISAME, 0, 0);
  sprite_step(&d->o.sprite);
  ActTask *t = object_task(&d->o, drisame_run, PRIORITY_OBJECTS);
  if (!t) return NULL;
  t->end = drisame_end;
  d->block = block_new(slot->e.x, slot->e.y);
  if (d->block) d->block->fish = d;
  return t;
}
