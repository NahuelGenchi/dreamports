// Torches (kind 87). Translated from the JavaScript version's engine/torches.js (the original's torch.c): a flame on
// Angel Island that only burns, drawn behind the other sprites, its animation stepping before it is drawn from the frame it
// is made. Cosmic Angel's zone and Chao Hunt D draw the same kind as their antigravity units: one when its d0 is set, two side
// by side when it is 0.

#include "objects.h"

enum {
  ANIM_TORCH = 558, ANIM_ANTIGRAVITY = 511, ANIM_ANTIGRAVITY_DOUBLE = 512,
  ORDER_TORCH = 28, PRIORITY_FRONT = 2,
  ZONE_6 = 5, CHAO_HUNT_D = 17,
};

static int torch_run(ActTask *t) {
  Object *o = (Object *)t->data;
  const Entity *en = &o->slot->e;
  if (off_cam(en->x, en->y)) return 0;
  sprite_step(&o->sprite);
  object_draw(&o->sprite, en->x, en->y);
  return 1;
}

/** CreateEntity_Torch */
ActTask *torch_spawn(Slot *slot) {
  Object *o = OBJECT_NEW(Object);
  if (!o) return NULL;
  o->slot = slot;
  o->x = slot->e.x;
  int antigravity = act.stage.zone == ZONE_6 || act.stage.level == CHAO_HUNT_D;
  int anim = antigravity ? (slot->e.d[0] ? ANIM_ANTIGRAVITY : ANIM_ANTIGRAVITY_DOUBLE) : ANIM_TORCH;
  object_sprite(&o->sprite, anim, 0, 0, ORDER_TORCH, PRIORITY_FRONT, 0, 0);
  return object_task(o, torch_run, PRIORITY_OBJECTS);
}
