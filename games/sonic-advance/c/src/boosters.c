// The speed boosters: Neo Green Hill's and Secret Base's flat one (kind 31), the ones on a slight slope (32, 33), Egg Rocket's
// on a wall (47), and the ones on a steep slope (100 and 101). Translated from the JavaScript version's engine/boosters.js (the
// original's booster.c). Running or rolling over one on the ground sends Sonic its way at 12 px a frame, unless he is already
// going faster than 9 that way; it points right, or left when its d1 is set.

#include "objects.h"

enum {
  BOOSTER = 31, BOOSTER_SLIGHT_LEFT = 32, BOOSTER_SLIGHT_RIGHT = 33, BOOSTER_WALL = 47, BOOSTER_STEEP = 100, BOOSTER_STEEP_2 = 101,
  // SA1_ANIM_BOOSTER (flat, and the slight slopes as variants 1 and 2), SA1_ANIM_BOOSTER_VERT and the steep ones
  ANIM_BOOSTER = 471, ANIM_BOOSTER_WALL = 472, ANIM_BOOSTER_STEEP = 571, ANIM_BOOSTER_STEEP_2 = 570,
  ORDER_BOOSTER = 18, PRIORITY_FRONT = 2,
  SOX = 6,                 // Sonic's spriteOffsetX
  SE_BOOSTER = 172,
};
#define BOOST 12.0
#define BOOSTED 9.0

typedef struct { Object o; int dir; } Booster;

// Task_Booster: it tests the box its last animation frame set, before stepping the animation; none yet on its first frame
static int booster_run(ActTask *t) {
  Booster *b = (Booster *)t->data;
  const Entity *e = &b->o.slot->e;
  Player *p = &act.player;
  const Hitbox *hb = object_box(&b->o.sprite, 0);
  Hitbox probe = { 0, (int8_t)-(SOX + 5), (int8_t)(1 - p->offsetY), SOX + 5, (int8_t)(p->offsetY - 1) };
  if (!p->dead && !p->air && hb && collide_overlap(e->x, e->y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &probe)) {
    // Player_TransitionCancelFlyingAndBoost
    player_end_attack(p); p->pushing = 0;
    play_song(SE_BOOSTER);
    if (p->state != PS_SPIN && p->state != PS_SPIN_DASH && p->state != PS_SPIN_DASH_REV) p->state = PS_WALK;
    p->facing = b->dir;
    if (p->gsp * b->dir < BOOSTED) p->gsp = p->xsp = BOOST * b->dir;
  }
  if (off_cam(e->x, e->y)) return 0;
  sprite_step(&b->o.sprite);
  object_draw(&b->o.sprite, e->x, e->y);
  return 1;
}

// CreateEntity_Booster and its kin: each kind's animation, variant and tiles
ActTask *booster_spawn(Slot *slot) {
  int anim = ANIM_BOOSTER, variant = 0, tiles = 32 / 8 * (16 / 8);
  switch (slot->e.kind) {
    case BOOSTER_SLIGHT_RIGHT: variant = 1; tiles = 32 / 8 * (24 / 8); break;
    case BOOSTER_SLIGHT_LEFT: variant = 2; tiles = 32 / 8 * (24 / 8); break;
    case BOOSTER_WALL: anim = ANIM_BOOSTER_WALL; tiles = 16 / 8 * (32 / 8); break;
    case BOOSTER_STEEP: anim = ANIM_BOOSTER_STEEP; tiles = 32 / 8 * (24 / 8); break;
    case BOOSTER_STEEP_2: anim = ANIM_BOOSTER_STEEP_2; tiles = 32 / 8 * (24 / 8); break;
  }
  Booster *b = OBJECT_NEW(Booster);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->dir = slot->e.d[1] ? -1 : 1;
  object_sprite_at(&b->o.sprite, vram_malloc(tiles), anim, variant, ORDER_BOOSTER, PRIORITY_FRONT, b->dir < 0, 0);
  b->o.sprite.hitboxes[0].index = -1;
  return object_task(&b->o, booster_run, PRIORITY_OBJECTS);
}
