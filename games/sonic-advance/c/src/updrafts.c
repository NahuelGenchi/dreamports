// Angel Island's updraft debris (kind 97). Translated from the JavaScript version's engine/updrafts.js (the original's
// updraft.c): a bit of debris that rises 64 px over and over inside a whirlwind (kind 90), 8 px at a time. It is only a
// sprite; d0 picks which: 0 the first (every 4 frames), 1 the third (every 5), any other the second (every 6). Its animation
// starts on its first frame.

#include "objects.h"

enum { ANIM_DEBRIS_A = 564, ANIM_DEBRIS_B = 565, ANIM_DEBRIS_C = 566, ORDER_DEBRIS = 18, PRIORITY_FRONT = 2 };

static int updraft_run(ActTask *t) {
  Object *o = (Object *)t->data;
  const Entity *en = &o->slot->e;
  if (off_cam(en->x, en->y)) return 0;
  sprite_step(&o->sprite);
  object_draw(&o->sprite, en->x, en->y);
  return 1;
}

/** CreateEntity_Updraft */
ActTask *updraft_spawn(Slot *slot) {
  Object *o = OBJECT_NEW(Object);
  if (!o) return NULL;
  o->slot = slot;
  o->x = slot->e.x;
  int d0 = slot->e.d[0];
  object_sprite(&o->sprite, d0 == 0 ? ANIM_DEBRIS_A : d0 == 1 ? ANIM_DEBRIS_C : ANIM_DEBRIS_B, 0, 0, ORDER_DEBRIS,
                PRIORITY_FRONT, 0, 0);
  return object_task(o, updraft_run, PRIORITY_OBJECTS);
}
