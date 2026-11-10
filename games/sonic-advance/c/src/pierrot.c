// Pierrot, Casino Paradise's clown on a ball (enemy kind 10). Translated from the JavaScript version's engine/pierrot.js (the
// original's pierrot.c). It rolls 0.625 px a frame between d0 x 8 and (d0 + d2) x 8 px right of its spawn point, following the
// floor, and turns at either end. Its ball (the sprite's second hitbox) can't be broken: Sonic curled up bounces back off it,
// moved back by his speed and turned round, and any other way it hurts him. The clown on top is defeated as any enemy is.
//
// The original takes 48 px off its height every frame (Q(0.1875) where a pixel count was meant). It follows the floor all the same,
// as the floor test makes up the difference in its first frames. It leaves when its spawn point is out of the display range and
// where it has rolled to is out of the camera's (the ROM's code; the decompilation's C tests where it has rolled to both times).

#include "enemies.h"

enum {
  ANIM_PIERROT = 418,
  STEP = 160,         // 0.625 px, in 1/256 px
  RAISE = 48,         // taken off its height every frame
  SPRITE_BALL = 1,    // the hitbox of the ball
};

typedef struct {
  Object o;
  int d0, d2, q, v, yoff;
} Pierrot;

static int pierrot_run(ActTask *t) {
  Pierrot *r = (Pierrot *)t->data;
  Sprite *s = &r->o.sprite;
  Slot *slot = r->o.slot;
  const Entity *e = &slot->e;
  Player *p = &act.player;
  r->q += r->v;
  int x = s16(e->x + enemy_i(r->q)), y = s16(e->y + r->yoff - RAISE);
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (!p->dead) {
    const Hitbox *ball = object_box(s, SPRITE_BALL), *body = object_box(&p->sprite, 0);
    if (ball && body && collide_overlap(x, y, ball, enemy_sonic_x(), enemy_sonic_y(), body)) {
      if (p->curled) {
        // back by his speed, the other way round
        if (p->facing < 0) { p->x += __builtin_fabs(p->gsp); p->facing = 1; }
        else { p->x -= __builtin_fabs(p->gsp); p->facing = -1; }
        p->gsp = -p->gsp; p->xsp = -p->xsp;
      } else world_damage(p);
    }
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
  }
  r->yoff = s16(r->yoff + terrain_tile_floor(x, y, ENEMY_LAYER, 8));
  if (enemy_i(r->q) <= r->d0 * ENEMY_TILE) { r->v = STEP; enemy_flip_x(s, 1); }
  else if (enemy_i(r->q) >= (r->d0 + r->d2) * ENEMY_TILE) { r->v = -STEP; enemy_flip_x(s, 0); }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *pierrot_spawn(Slot *slot) {
  Pierrot *r = OBJECT_NEW(Pierrot);
  if (!r) return NULL;
  EnemyData d = enemy_data(&slot->e);
  r->o.slot = slot;
  r->o.x = slot->e.x;
  r->d0 = d.d0; r->d2 = d.d2;
  r->v = -STEP;
  enemy_sprite(&r->o.sprite, ANIM_PIERROT, 0, 0, ENEMY_ORDER);
  return object_task(&r->o, pierrot_run, PRIORITY_OBJECTS);
}
