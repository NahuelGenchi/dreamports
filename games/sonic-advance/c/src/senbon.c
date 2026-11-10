// Senbon, Secret Base act 1's pincushion (kind 5). Translated from the JavaScript version's engine/senbon.js (the
// original's senbon.c: CreateEntity_Senbon, Task_SenbonInit and Task_8070CB4). It walks 0.625 px a frame between
// (d0 + 1) x 8 and (d0 + d2 - 1) x 8 px right of its spawn point, turning at either end. Away from the ends, when Sonic is
// up to 80 px ahead of it, it stops and puts out its spikes for 60 frames, then walks on and doesn't do it again for 120
// frames spent walking between the ends. With its spikes out it can't be destroyed, and touching their box hurts Sonic.
// Not made in Secret Base on Easy.

#include "enemies.h"

enum {
  ANIM_SENBON = 411, VARIANT_WALK = 0, VARIANT_SPIKES = 1,
  STEP = 160,     // 0.625 px, in 1/256 px
  SPIKES = 60, REST = 120, SIGHT = 80,
  ORDER_SENBON = 18,
};

typedef struct { Object o; int q, v, spiky, t, rest; } Senbon;

static int senbon_run(ActTask *t) {
  Senbon *sn = (Senbon *)t->data;
  Sprite *s = &sn->o.sprite;
  Slot *slot = sn->o.slot;
  const Entity *e = &slot->e;
  Player *p = &act.player;
  EnemyData d = enemy_data(e);
  if (!sn->spiky) sn->q += sn->v;
  int x = s16(e->x + enemy_i(sn->q)), y = e->y;
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  if (!sn->spiky) {
    // Task_SenbonInit
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (enemy_i(sn->q) <= (d.d0 + 1) * ENEMY_TILE) { sn->v = STEP; enemy_flip_x(s, 1); }
    else if (enemy_i(sn->q) >= (d.d0 + d.d2 - 1) * ENEMY_TILE) { sn->v = -STEP; enemy_flip_x(s, 0); }
    else if (sn->rest != 0) sn->rest--;
    else {
      int px = enemy_sonic_x();
      int ahead = s->frameFlags & SPRITE_X_FLIP ? px >= x && x + SIGHT >= px : px <= x && x - SIGHT <= px;
      if (ahead) { sn->t = 0; sprite_start(s, VARIANT_SPIKES); sn->spiky = 1; }
    }
  } else {
    // Task_8070CB4: the spikes' box hurts him, and he can't hurt them
    const Hitbox *hb = object_box(s, 0), *body = object_box(&p->sprite, 0);
    if (hb && body && !p->dead && collide_overlap(x, y, hb, enemy_sonic_x(), enemy_sonic_y(), body)) world_damage(p);
    if (++sn->t >= SPIKES) { sn->rest = REST; sprite_start(s, VARIANT_WALK); sn->spiky = 0; }
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *senbon_spawn(Slot *slot) {
  if (enemy_left_out_on_easy(1)) return NULL;
  Senbon *sn = OBJECT_NEW(Senbon);
  if (!sn) return NULL;
  sn->o.slot = slot;
  sn->o.x = slot->e.x;
  sn->v = -STEP;
  enemy_sprite(&sn->o.sprite, ANIM_SENBON, VARIANT_WALK, VARIANT_SPIKES, ORDER_SENBON);
  return object_task(&sn->o, senbon_run, PRIORITY_OBJECTS);
}
