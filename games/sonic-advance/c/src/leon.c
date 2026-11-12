// Leon, Angel Island's chameleon (enemy kind 11). Translated from the JavaScript version's engine/enemies.js (the
// original's leon.c: CreateEntity_Leon, Task_LeonInit, Task_806ED3C and Task_806EEA4). It walks 0.625 px a frame between
// d0 x 8 and (d0 + d2) x 8 px right of its spawn point and turns round at either end in 14 frames, standing still. Away from
// the ends, when Sonic is within 80 px in front of it and between 32 px above and 8 px below it, it shoots its tongue for 31
// frames, whose box hurts him; it then walks 60 frames away from the ends before it can shoot again. It follows the ground.
// The original never sets that count when it makes a Leon (unk4E), so it holds what an earlier task left in the task's
// memory: 1688 (0x698) for the first Leon Sonic meets in Angel Island's first act, so it walks on past him for about 28
// seconds before it can shoot. The C starts every Leon's count there. The tongue's box stays where the shot left it, so the
// next shot hurts from its first frame.

#include "enemies.h"

enum {
  ANIM_LEON = 430, VARIANT_WALK = 0, VARIANT_SHOOT = 1, VARIANT_TURN = 2,
  WALK = 160,               // 0.625 px, in 1/256 px
  TURN_FRAMES = 14, SHOT_FRAMES = 31, REST = 60, REACH = 80,
  REST_LEFT_IN_MEMORY = 0x698,   // what the original's task memory held where the count is (see above)
};
enum { WALKING, TURNING, SHOOTING };

typedef struct { Object o; int q, v, yoff, t, rest, state; } Leon;

static int leon_run(ActTask *t) {
  Leon *l = (Leon *)t->data;
  Sprite *s = &l->o.sprite;
  Slot *slot = l->o.slot;
  const Entity *e = &slot->e;
  EnemyData d = enemy_data(e);
  /** Task_LeonInit walks; Task_806ED3C turns and Task_806EEA4 shoots, standing */
  if (l->state == WALKING) l->q += l->v;
  int x = s16(e->x + enemy_i(l->q)), y = s16(e->y + l->yoff);
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (l->state == SHOOTING) {
    Player *p = &act.player;
    const Hitbox *tongue = object_box(s, 1), *body = object_box(&p->sprite, 0);
    if (tongue && body && collide_overlap(x, y, tongue, enemy_sonic_x(), enemy_sonic_y(), body)) world_damage(p);
  }
  if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  l->yoff = s16(l->yoff + terrain_tile_floor(x, y + 3, ENEMY_LAYER, 8));
  int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
  if (l->state == WALKING) {
    if (enemy_i(l->q) <= d.d0 * ENEMY_TILE) {
      if (!right) { l->v = WALK; l->t = 0; sprite_start(s, VARIANT_TURN); l->state = TURNING; enemy_flip_x(s, 1); }
    } else if (enemy_i(l->q) >= (d.d0 + d.d2) * ENEMY_TILE) {
      if (right) { l->v = -WALK; l->t = 0; sprite_start(s, VARIANT_TURN); l->state = TURNING; enemy_flip_x(s, 0); }
    } else if (l->rest == 0) {
      int px = enemy_sonic_x(), py = enemy_sonic_y();
      if (py <= y + 8 && y - 32 <= py && (right ? px >= x && x + REACH >= px : px <= x && x - REACH <= px)) {
        l->rest = REST; l->t = 0; sprite_start(s, VARIANT_SHOOT); l->state = SHOOTING;
      }
    } else l->rest--;
  } else if (++l->t == (l->state == TURNING ? TURN_FRAMES : SHOT_FRAMES)) {
    sprite_start(s, VARIANT_WALK); l->state = WALKING;
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

/** CreateEntity_Leon: made everywhere but in Angel Island on Easy */
ActTask *leon_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(ZONE_ANGEL_ISLAND)) return NULL;
  Leon *l = OBJECT_NEW(Leon);
  if (!l) return NULL;
  l->o.slot = slot;
  l->o.x = slot->e.x;
  l->v = -WALK;
  l->rest = REST_LEFT_IN_MEMORY;
  enemy_sprite(&l->o.sprite, ANIM_LEON, VARIANT_WALK, VARIANT_TURN, ENEMY_ORDER);
  return object_task(&l->o, leon_run, PRIORITY_OBJECTS);
}
