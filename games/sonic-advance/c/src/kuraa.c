// Kuraa, Ice Mountain's crab (kind 19). Translated from the JavaScript version's engine/kuraa.js (the original's kuraa.c:
// CreateEntity_Kuraa, Task_KuraaInit and Task_80737A8). It walks a quarter of a pixel a frame between d0 x 8 and
// (d0 + d2) x 8 px right of its spawn point, turning at either end. Away from the ends it snaps its claws for 120 frames,
// then walks on and doesn't snap again for 500 frames spent walking between the ends. Its sprite is a left half, drawn
// again mirrored for the right. While it snaps it can't be destroyed, and touching its box hurts Sonic; the original
// tests that box at the spawn point instead of where the crab has walked to, which is kept.

#include "enemies.h"

enum {
  ANIM_KURAA = 425, VARIANT_WALK = 0, VARIANT_SNAP = 1,
  STEP = 0x40,   // a quarter of a pixel, in 1/256 px
  SNAP = 120, REST = 500,
};

typedef struct { Object o; int q, v, snapping, t, rest; } Kuraa;

static void show(Sprite *s, int x, int y) {
  object_draw(s, x, y);
  if (!objects_drawing()) return;
  s->frameFlags |= SPRITE_X_FLIP;
  display_sprite(s);
  s->frameFlags &= ~SPRITE_X_FLIP;
}

static int kuraa_run(ActTask *t) {
  Kuraa *k = (Kuraa *)t->data;
  Sprite *s = &k->o.sprite;
  Slot *slot = k->o.slot;
  const Entity *e = &slot->e;
  EnemyData d = enemy_data(e);
  if (!k->snapping) {
    k->q += k->v;
    int x = s16(e->x + enemy_i(k->q)), y = e->y;
    if (enemy_gone(e->x, e->y, x, y)) return 0;
    if (enemy_attack(s, x, y)) { slot->gone = 1; return 0; }
    if (enemy_i(k->q) <= d.d0 * ENEMY_TILE) k->v = STEP;
    else if (enemy_i(k->q) >= (d.d0 + d.d2) * ENEMY_TILE) k->v = -STEP;
    else if (k->rest != 0) k->rest--;
    else { k->t = 0; k->rest = REST; sprite_start(s, VARIANT_SNAP); k->snapping = 1; }
    sprite_step(s);
    show(s, x, y);
    return 1;
  }
  int x = s16(e->x + enemy_i(k->q)), y = e->y;
  if (enemy_gone(e->x, e->y, x, y)) return 0;
  Player *p = &act.player;
  const Hitbox *hb = object_box(s, 0), *body = object_box(&p->sprite, 0);
  if (hb && body && collide_overlap(e->x, e->y, hb, enemy_sonic_x(), enemy_sonic_y(), body)) world_damage(p);
  if (++k->t >= SNAP) { sprite_start(s, VARIANT_WALK); k->snapping = 0; }
  sprite_step(s);
  show(s, x, y);
  return 1;
}

ActTask *kuraa_spawn(Slot *slot) {
  Kuraa *k = OBJECT_NEW(Kuraa);
  if (!k) return NULL;
  k->o.slot = slot;
  k->o.x = slot->e.x;
  k->v = -STEP;
  enemy_sprite(&k->o.sprite, ANIM_KURAA, VARIANT_WALK, VARIANT_SNAP, ENEMY_ORDER);
  return object_task(&k->o, kuraa_run, PRIORITY_OBJECTS);
}
