// Yukimaru, Ice Mountain's snowman (enemy kind 16). Translated from the original's yukimaru.c a function at a time, with the
// JavaScript version's engine/yukimaru.js as the guide; every comment names the function it rewrites.
//
// It is drawn as two halves of one picture, the right one mirrored, and walks 0.625 px a frame between d0 x 8 and (d0 + d2) x 8 px
// right of its spawn point, following the floor. Away from the ends, when its rest has run out and Sonic is above it within 8 px
// either side, it stops and throws a snowball straight up, then rests 60 frames spent walking.
//
// The snowball keeps its x four times over in 16 bits, as the original does, so from x 8192 on it lands far to the left.

#include "enemies.h"

enum {
  ANIM_YUKIMARU = 422, ANIM_SNOWBALL = 427,   // SA1_ANIM_YUKIMARU, SA1_ANIM_PEN_PROJ_1
  VARIANT_THROW = 0, VARIANT_WALK = 1,
  ORDER_LEFT = 0,                            // the left half's OAM order; the right one is ENEMY_ORDER
  STEP = 160,                                // 0.625 px, in 1/256 px
  RAISE = 6,                                 // it stands this far above its spawn point
  REACH = 8,                                 // Sonic is over it within this far either side
  REST = 60,                                 // frames spent walking between two throws
  THROW = 4, THROWN = 13,                    // the frame of the throw the snowball leaves on, and the one it ends on
  HAND_UP = -18,                             // where the snowball leaves, above the Yukimaru
  // the snowball
  VRAM_SNOWBALL = 0x2580,                    // VRAM_RESERVED_EN_YUKIMARU_PROJ
  ORDER_SNOWBALL = 1, PRIORITY_SNOWBALL = 0,
  SNOWBALL_SPEED = -0x500, SNOWBALL_FALL = 40,   // Q(5) up, and 40/256 px a frame per frame
  // it goes when this far off the screen: x + 20 as a 16-bit number above 276, y + 20 below 0 or y above 240
  OUT_MARGIN = 20, OUT_WIDTH = SCREEN_W + 36, OUT_BELOW = SCREEN_H + 80,
};

typedef struct {
  Object o;
  Sprite right;             // s2, the mirrored half
  int d0, d2, v, q, yoff, t, rest, throwing;
} Yukimaru;

typedef struct { Object o; int16_t x4; int x, y, vy; } Snowball;

// --- the snowball -----------------------------------------------------------------------------------------------------------------
/** Task_Snowball */
static int snowball_run(ActTask *t) {
  Snowball *b = (Snowball *)t->data;
  Sprite *s = &b->o.sprite;
  int x4 = b->x4;
  if (x4 < 0) x4 += 3;
  b->x = s16(x4 >> 2);
  b->vy = s16(b->vy + SNOWBALL_FALL);
  b->y = s16(b->y + enemy_i(b->vy));
  enemy_projectile(s, b->x, b->y);
  int sx = s16(b->x - cam_x()), sy = s16(b->y - cam_y());
  if ((uint16_t)(sx + OUT_MARGIN) > OUT_WIDTH || sy + OUT_MARGIN < 0 || sy > OUT_BELOW) return 0;
  sprite_step(s);
  object_draw(s, b->x, b->y);
  return 1;
}

/** CreateSnowball */
static void snowball_new(int x, int y) {
  Snowball *b = OBJECT_NEW(Snowball);
  if (!b) return;
  b->x4 = (int16_t)(x * 4);
  b->x = x - 8; b->y = y;
  b->vy = SNOWBALL_SPEED;
  object_sprite_at(&b->o.sprite, OBJ_VRAM + VRAM_SNOWBALL, ANIM_SNOWBALL, 0, ORDER_SNOWBALL, PRIORITY_SNOWBALL, 0, 0);
  sprite_step(&b->o.sprite);
  object_task(&b->o, snowball_run, ENEMY_SHOT_PRIORITY);
}

// --- the Yukimaru -----------------------------------------------------------------------------------------------------------------
static void yukimaru_variant(Yukimaru *y, int variant) {
  sprite_start(&y->o.sprite, variant);
  sprite_start(&y->right, variant);
}

/** Task_YukimaruGroundInit, walking, and Task_8071BFC, throwing */
static int yukimaru_run(ActTask *t) {
  Yukimaru *y = (Yukimaru *)t->data;
  Sprite *s = &y->o.sprite;
  Slot *slot = y->o.slot;
  const Entity *e = &slot->e;
  if (!y->throwing) y->q = s16(y->q + y->v);
  int x = s16(e->x + enemy_i(y->q)), wy = s16(e->y - RAISE + y->yoff);
  if (enemy_gone(e->x, e->y, x, wy)) return 0;
  if (enemy_attack(s, x, wy)) { slot->gone = 1; return 0; }
  y->yoff = s16(y->yoff + terrain_tile_floor(x, wy, ENEMY_LAYER, 8));
  if (!y->throwing) {
    if (enemy_i(y->q) <= y->d0 * ENEMY_TILE) y->v = STEP;
    else if (enemy_i(y->q) >= (y->d0 + y->d2) * ENEMY_TILE) y->v = -STEP;
    else if (y->rest != 0) y->rest--;
    else if (enemy_sonic_y() <= wy && enemy_sonic_x() <= x + REACH && x - REACH <= enemy_sonic_x()) {
      y->rest = REST; y->t = 0;
      yukimaru_variant(y, VARIANT_THROW);
      y->throwing = 1;
    }
  } else {
    if (++y->t == THROW) snowball_new(x, wy + HAND_UP);
    if (y->t == THROWN) { yukimaru_variant(y, VARIANT_WALK); y->throwing = 0; }
  }
  sprite_step(s);
  sprite_step(&y->right);
  object_draw(s, x, wy);
  y->right.frameFlags |= SPRITE_X_FLIP;
  object_draw(&y->right, x, wy);
  y->right.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  return 1;
}

/** TaskDestructor_YukimaruGround: both halves' tiles */
static void yukimaru_end(ActTask *t) {
  object_sprite_free(&((Yukimaru *)t->data)->right);
  object_end(t);
}

// a half: its own tiles, for every variant (ALLOC_TILES), starting on the walk
static void yukimaru_half(Sprite *s, int order) {
  object_sprite(s, ANIM_YUKIMARU, VARIANT_THROW, VARIANT_WALK, order, ENEMY_PRIORITY, 0, 0);
  s->variant = VARIANT_WALK;
  sprite_step(s);
}

/** CreateEntity_Yukimaru */
ActTask *yukimaru_spawn(Slot *slot) {
  Yukimaru *y = OBJECT_NEW(Yukimaru);
  if (!y) return NULL;
  EnemyData d = enemy_data(&slot->e);
  y->o.slot = slot;
  y->o.x = slot->e.x;
  y->d0 = d.d0; y->d2 = d.d2;
  y->v = -STEP;
  yukimaru_half(&y->o.sprite, ORDER_LEFT);
  yukimaru_half(&y->right, ENEMY_ORDER);
  ActTask *t = object_task(&y->o, yukimaru_run, PRIORITY_OBJECTS);
  if (!t) object_sprite_free(&y->right);
  else t->end = yukimaru_end;
  return t;
}
