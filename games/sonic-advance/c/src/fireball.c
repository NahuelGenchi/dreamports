// Secret Base's fireballs (enemy kind 7). Translated from the JavaScript version's engine/fireball.js (the original's
// enemies/fireball.c; CreateFireballSparks from its asm, which the decompilation matches but for its registers). The enemy
// is a spawner with nothing drawn that, on every frame of the stage clock that is a multiple of 240, throws a fireball up
// from 24 px below it at 6 px a frame, slowing by a quarter of a pixel a frame. At the top it bursts into two sparks that
// fly off either way and fall, and it shrinks as it falls back, until it is gone at 2 px a frame. The fireball and the
// sparks can't be destroyed; touching them hurts Sonic. The spawner goes when its point leaves the display's range.
//
// The original's quirks, kept: a fireball that leaves the range lets its entity spawn again even while its spawner is still
// there, so a second spawner can join the first, but one that goes out at the bottom of its fall doesn't. The fireball keeps
// its place and speed, and the sparks theirs (with x times 4), in 16 bits, so a spark past x 8191 wraps.

#include "enemies.h"

enum {
  RATE = 240,                                      // FIREBALL_SPAWN_RATE, TIME(0, 4)
  ANIM_FIREBALL = 413, VARIANT_RISE = 0, VARIANT_FALL = 1, ORDER_FIREBALL = 18,
  ANIM_SPARK = 414, ORDER_SPARK = 9, VRAM_FIREBALL_SPARK = 0x2580,   // VRAM_RESERVED_EN_FIREBALL_SPARK
  BELOW = 24, THROW = -6 * 256, GRAVITY = 64, GONE = 2 * 256,
  SPARK_UP = 16, SPARK_DX = 6, SPARK_THROW = -2 * 256, SPARK_GRAVITY = 40,
};

typedef struct { Object o; Slot *home; int16_t v, x, y; int y0, rising; } Flame;
typedef struct { Object o; int16_t x4, dx, y, vy; } Spark;

// Task_FireballSpark: it goes on through Sonic
static int spark_run(ActTask *t) {
  Spark *sp = (Spark *)t->data;
  Sprite *s = &sp->o.sprite;
  sp->x4 = (int16_t)(sp->x4 + sp->dx);
  int w = sp->x4;
  if (w < 0) w += 3;
  int x = (int16_t)(w >> 2);
  sp->vy = (int16_t)(sp->vy + SPARK_GRAVITY);
  sp->y = (int16_t)(sp->y + enemy_i(sp->vy));
  enemy_projectile(s, x, sp->y);
  int16_t sx = (int16_t)(x - cam_x()), sy = (int16_t)(sp->y - cam_y());
  if ((uint16_t)(sx + 20) > DISPLAY_WIDTH + 36 || sy + 20 < 0 || sy > DISPLAY_HEIGHT + 80) return 0;
  sprite_step(s);
  object_draw(s, x, sp->y);
  return 1;
}

// CreateFireballSparks: the first flies right, the second left, from (x, y), sharing their tiles at a fixed place
static void sparks(int16_t x, int16_t y) {
  for (int i = 0; i < 2; i++) {
    Spark *sp = OBJECT_NEW(Spark);
    if (!sp) return;
    sp->x4 = (int16_t)(x * 4);
    sp->dx = (int16_t)(i ? -SPARK_DX : SPARK_DX);
    sp->vy = SPARK_THROW;
    sp->y = y;
    object_sprite_at(&sp->o.sprite, OBJ_VRAM + VRAM_FIREBALL_SPARK, ANIM_SPARK, 0, ORDER_SPARK, ENEMY_PRIORITY, 0, 0);
    sprite_step(&sp->o.sprite);
    object_task(&sp->o, spark_run, ENEMY_SHOT_PRIORITY);
  }
}

// Task_FireballUpdateRise, then Task_FireballExtinguish; the left half, drawn again mirrored for the right
static int flame_run(ActTask *t) {
  Flame *f = (Flame *)t->data;
  Sprite *s = &f->o.sprite;
  Player *p = &act.player;
  f->v = (int16_t)(f->v + GRAVITY);
  f->y = (int16_t)(f->y + enemy_i(f->v));
  if (off_display(f->x, f->y0) && off_cam(f->x, f->y)) { f->home->live = NULL; return 0; }   // SET_MAP_ENTITY_NOT_INITIALIZED
  // Coll_Player_Entity_Intersection: his body, while he is alive
  const Hitbox *box = object_box(s, 0);
  if (!p->dead && box) {
    Hitbox body = collide_body(p);
    if (collide_overlap(f->x, f->y, box, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) world_damage(p);
  }
  if (f->rising) {
    if (f->v >= 0) {
      sparks(f->x, (int16_t)(f->y - SPARK_UP));
      sprite_start(s, VARIANT_FALL);
      f->rising = 0;
    }
  } else if (f->v >= GONE) return 0;   // without letting its entity spawn again
  sprite_step(s);
  object_draw(s, f->x, f->y);
  uint32_t flags = s->frameFlags;
  s->frameFlags |= SPRITE_X_FLIP;
  object_draw(s, f->x, f->y);
  s->frameFlags = flags;
  return 1;
}

static void flame_new(Slot *slot) {
  Flame *f = OBJECT_NEW(Flame);
  if (!f) return;
  f->home = slot;   // its block's slot stays NULL, so only its range test lets the entity spawn again
  f->v = THROW;
  f->x = (int16_t)slot->e.x;
  f->y = (int16_t)(slot->e.y + BELOW);
  f->y0 = f->y;
  f->rising = 1;
  object_sprite(&f->o.sprite, ANIM_FIREBALL, VARIANT_RISE, VARIANT_FALL, ORDER_FIREBALL, ENEMY_PRIORITY, 0, 0);
  sprite_step(&f->o.sprite);
  object_task(&f->o, flame_run, PRIORITY_OBJECTS);
}

// Task_Fireball
static int spawner_run(ActTask *t) {
  Object *o = (Object *)t->data;
  const Entity *en = &o->slot->e;
  if (off_display(en->x, en->y)) return 0;
  if (act.tick % RATE == 0) flame_new(o->slot);
  return 1;
}

// CreateEntity_Fireball
ActTask *fireball_spawn(Slot *slot) {
  Object *o = OBJECT_NEW(Object);
  if (!o) return NULL;
  o->slot = slot;
  o->x = slot->e.x;
  o->sprite.graphics.dest = HEAP_END;   // no sprite
  return object_task(o, spawner_run, PRIORITY_OBJECTS);
}
