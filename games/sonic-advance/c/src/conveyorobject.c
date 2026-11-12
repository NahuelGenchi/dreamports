// The rollers along a conveyor belt (kind 99). Translated from engine/conveyorobject.js (the original's
// conveyor_belt_object.c: CreateEntity_ConveyorBeltObject, Task_ConveyorBeltObject). Solid objects that only animate;
// d0 picks wide or slim and its variant. In Egg Rocket (level 10) uses animations 508 and 509; in Cosmic Angel (level 11)
// 604 and 603.

#include "objects.h"

enum {
  ORDER_CONVEYOR = 18, PRIORITY_FRONT = 2,
  WIDE_TILES = 36, SLIM_TILES = 27,   // ALLOC_TILES: 96 x 24 and 72 x 24 px
};

typedef struct { Object o; } ConveyorBeltObject;

static int conveyor_belt_object_run(ActTask *t) {
  ConveyorBeltObject *cb = (ConveyorBeltObject *)t->data;
  const Entity *en = &cb->o.slot->e;
  collide_platform(&cb->o, en->x, en->y, object_box(&cb->o.sprite, 0), &act.player);
  if (off_cam(en->x, en->y)) { cb->o.slot->live = NULL; return 0; }
  sprite_step(&cb->o.sprite);
  object_draw(&cb->o.sprite, en->x, en->y);
  return 1;
}

ActTask *conveyor_belt_object_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  ConveyorBeltObject *cb = OBJECT_NEW(ConveyorBeltObject);
  if (!cb) return NULL;
  cb->o.slot = slot;
  cb->o.x = en->x;
  int isAct2 = (act.stage.level & 1) != 0;
  int anim = isAct2 ? (en->d[0] >= 2 ? 603 : 604) : (en->d[0] >= 2 ? 509 : 508);
  int variant = en->d[0] & 1;
  object_sprite_at(&cb->o.sprite, vram_malloc(en->d[0] >= 2 ? SLIM_TILES : WIDE_TILES), anim, variant, ORDER_CONVEYOR,
                   PRIORITY_FRONT, 0, 0);
  // its animation first steps in its task, not as it is made
  return object_task(&cb->o, conveyor_belt_object_run, PRIORITY_OBJECTS);
}
