// The underwater lava platforms (kind 98), translated from the JavaScript version's engine/lavaplatforms.js (the
// original's underwater_lava_platform.c): a thin platform resting on a solid pool of lava. Whenever the stage clock is a
// multiple of 102 while it rests, the lava spurts (song 182): the platform is thrown up at 5 px a frame, falls back 37/256
// px a frame faster every frame, and bounces twice more at 2/5 of the speed it came back with, taking Sonic with it.
// Frames 7 to 53 of the spurt, the lava hurts him.
//
// Kept from the original: the spurt doesn't step its animation for its first 6 frames, and once it is back to the pool's
// animation, that runs at twice its speed until the platform stops bouncing. The bouncing can outlast the 102 frames, and
// the stage clock's next multiple of 102 then passes without a spurt.

#include "objects.h"

enum {
  ANIM_LAVA = 561, ANIM_SPURT = 560, ANIM_TOP = 525,   // SA1_ANIM_UNDERWATER_LAVA, _LAVA_SPURT, the platform
  ORDER_LAVA = 18, ORDER_TOP = 17, PRIORITY_LAVA = 2,
  EVERY = 102,                                          // TIME(0, 1.7)
  LAVA_ABOVE = 3, STAND = 27, SPURT_SPEED = 5 * 256, FALL = 37, HURT_LAST = 48, HURT_FIRST = 96,
  HALF_WIDTH = 6,
  SE_LAVA_SPURT = 182,
};

typedef struct {
  Object o;           // the platform's top, which Sonic stands on
  Sprite lava;
  int spurting, vy, q, n, bounces, riding;   // speed and offset in 1/256 px; riding: he went up with it (unk74)
} LavaPlatform;

static int floor_of(double v) { return (int)__builtin_floor(v); }

static void start(Sprite *s, int anim) { s->graphics.anim = (uint16_t)anim; sprite_start(s, 0); }

// Task_80929A0
static int spurt(LavaPlatform *l) {
  const Entity *en = &l->o.slot->e;
  Player *p = &act.player;
  Sprite *top = &l->o.sprite, *lava = &l->lava;
  const Hitbox *hb = object_box(top, 0);
  l->vy += FALL; l->q += l->vy;
  int y = en->y + (l->q >> 8);
  if (l->riding) {
    Hitbox body = { 0, -HALF_WIDTH, (int8_t)-p->offsetY, HALF_WIDTH, (int8_t)p->offsetY };
    if (p->dead || !hb || !collide_overlap(en->x, y, hb, floor_of(p->x), floor_of(p->y), &body)) l->riding = 0;
    else p->y += l->vy / 256.0;
  } else if (hb && collide_platform_top(&l->o, en->x, y, hb, p)) {
    p->y = y - STAND;
    l->riding = !p->air;
    if (p->ysp == 0 && p->state != PS_WALK) { player_end_attack(p); p->pushing = 0; p->state = PS_WALK; }
  } else l->riding = 0;
  if (--l->n == HURT_LAST) {
    start(lava, ANIM_LAVA);
    sprite_step(lava);
  } else if (l->n > HURT_LAST && l->n < HURT_FIRST) {
    const Hitbox *hurt = object_box(lava, 1), *box = object_box(&p->sprite, 0);
    if (!p->dead && hurt && box && collide_overlap(en->x, en->y, hurt, floor_of(p->x), floor_of(p->y), box)) world_damage(p);
    sprite_step(lava);
  } else if (l->n < HURT_LAST) {
    if (sprite_step(lava)) start(lava, ANIM_LAVA);
    sprite_step(lava);
  }
  if (l->q >= 0) {
    if (--l->bounces != 0) { l->vy = -(l->vy * 2 / 5); l->riding = 0; l->q = 0; }
    else { start(lava, ANIM_LAVA); l->spurting = 0; }
  }
  object_draw(lava, en->x, en->y - LAVA_ABOVE);
  sprite_step(top);
  object_draw(top, en->x, y);
  return 1;
}

// Task_UnderwaterLavaPlatform
static int lava_platform_run(ActTask *t) {
  LavaPlatform *l = (LavaPlatform *)t->data;
  if (l->spurting) return spurt(l);
  const Entity *en = &l->o.slot->e;
  Player *p = &act.player;
  const Hitbox *hb = object_box(&l->o.sprite, 0), *solid = object_box(&l->lava, 0);
  if (hb && (collide_platform_top(&l->o, en->x, en->y, hb, p) & COLLIDE_LANDED)) { p->y = en->y - STAND; p->air = 0; }
  if (solid) collide_platform(&l->lava, en->x, en->y, solid, p);
  if (off_display(en->x, en->y) && off_cam(en->x, en->y - LAVA_ABOVE)) return 0;
  if (act_stage_time() % EVERY == 0) {
    l->n = EVERY; l->riding = 0; l->vy = -SPURT_SPEED; l->q = 0; l->bounces = 3;
    start(&l->lava, ANIM_SPURT);
    play_song(SE_LAVA_SPURT);
    l->spurting = 1;
  }
  sprite_step(&l->lava);
  object_draw(&l->lava, en->x, en->y - LAVA_ABOVE);
  sprite_step(&l->o.sprite);
  object_draw(&l->o.sprite, en->x, en->y);
  return 1;
}

// the lava's tiles go with the platform's
static void lava_platform_end(ActTask *t) {
  object_sprite_free(&((LavaPlatform *)t->data)->lava);
  object_end(t);
}

// CreateEntity_UnderwaterLavaPlatform: the lava's tiles are the spurt's; neither animates before the task's first frame,
// so neither is solid on it
ActTask *lava_platform_spawn(Slot *slot) {
  LavaPlatform *l = OBJECT_NEW(LavaPlatform);
  if (!l) return NULL;
  l->o.slot = slot;
  l->o.x = slot->e.x;
  object_sprite(&l->lava, ANIM_SPURT, 0, 0, ORDER_LAVA, PRIORITY_LAVA, 0, 0);
  l->lava.graphics.anim = ANIM_LAVA;
  object_sprite(&l->o.sprite, ANIM_TOP, 0, 0, ORDER_TOP, PRIORITY_LAVA, 0, 0);
  l->lava.hitboxes[0].index = l->o.sprite.hitboxes[0].index = -1;
  ActTask *t = object_task(&l->o, lava_platform_run, PRIORITY_OBJECTS);
  if (!t) object_sprite_free(&l->lava);
  else t->end = lava_platform_end;
  return t;
}
