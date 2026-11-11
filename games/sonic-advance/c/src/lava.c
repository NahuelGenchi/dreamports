// Lava (interactable kind 105). Translated from the JavaScript version's engine/lava.js (the original's lava.c, Task_Lava):
// an area with nothing drawn, from its spawn point d2 tiles across and d3 down, both edges in. On every frame Sonic's
// position is in it, he is alive and nothing carries him (MOVESTATE_IA_OVERRIDE), d0 decides: 0 hurts him as spikes do
// unless he is invincible, anything else kills him where he is, keeping his speeds. It leaves when its spawn point leaves
// the camera's range; there, as the waterfalls do, the original would halve his falling speed behind a flag (unk3A) that
// is never set, so it never does.

#include "objects.h"

enum { LAVA = 105, TILE = 8 };

static int lava_run(ActTask *t) {
  Object *o = (Object *)t->data;
  const Entity *en = &o->slot->e;
  Player *p = &act.player;
  int wx = en->x, wy = en->y;
  if (off_cam(wx, wy)) return 0;
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (!p->carried && wx <= px && wx + en->d[2] * TILE >= px && wy <= py && wy + en->d[3] * TILE >= py && !p->dead) {
    if (en->d[0] == 0) {
      if (!p->invincible) world_damage(p);
    } else p->dead = 1;
  }
  return 1;
}

// CreateEntity_Lava
ActTask *lava_spawn(Slot *slot) {
  Object *o = OBJECT_NEW(Object);
  if (!o) return NULL;
  o->slot = slot;
  o->x = slot->e.x;
  o->sprite.graphics.dest = HEAP_END;   // no sprite
  return object_task(o, lava_run, PRIORITY_OBJECTS);
}
