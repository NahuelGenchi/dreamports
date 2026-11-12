// Egg Rocket's propellers (kind 103). Translated from engine/propeller.js (the original's propeller.c:
// CreateEntity_Propeller, Task_PropellerMain). Only spins, at its spawn point, OAM order 18, priority 2.

#include "objects.h"

enum {
  ANIM_PROPELLER = 515,
  ORDER_PROPELLER = 18, PRIORITY_FRONT = 2,
  PROPELLER_TILES = 54,   // ALLOC_TILES: 144 x 24 px
};

typedef struct { Object o; } Propeller;

static int propeller_run(ActTask *t) {
  Propeller *pr = (Propeller *)t->data;
  const Entity *en = &pr->o.slot->e;
  if (off_cam(en->x, en->y)) { pr->o.slot->live = NULL; return 0; }
  sprite_step(&pr->o.sprite);
  object_draw(&pr->o.sprite, en->x, en->y);
  return 1;
}

ActTask *propeller_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  Propeller *pr = OBJECT_NEW(Propeller);
  if (!pr) return NULL;
  pr->o.slot = slot;
  pr->o.x = en->x;
  object_sprite_at(&pr->o.sprite, vram_malloc(PROPELLER_TILES), ANIM_PROPELLER, 0, ORDER_PROPELLER, PRIORITY_FRONT, 0, 0);
  pr->o.sprite.frameFlags |= (1 << 18);   // skips its script's palette load
  // its animation first steps in its task, not as it is made
  return object_task(&pr->o, propeller_run, PRIORITY_OBJECTS);
}
