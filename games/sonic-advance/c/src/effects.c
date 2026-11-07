// The effects that objects leave behind. Translated from the JavaScript version's engine/defeat.js (dustCloud).

#include "objects.h"

enum { ANIM_DUST_CLOUD = 407, ORDER_EFFECT = 15, PRIORITY_FRONT = 2 };

typedef struct { Object o; int x, y; } Dust;

static int dust_run(ActTask *t) {
  Dust *d = (Dust *)t->data;
  int ended = sprite_step(&d->o.sprite);
  object_draw(&d->o.sprite, d->x, d->y);
  return !ended;
}

void dust_cloud(int x, int y) {
  Dust *d = OBJECT_NEW(Dust);
  if (!d) return;
  d->x = x; d->y = y;
  object_sprite(&d->o.sprite, ANIM_DUST_CLOUD, 0, 0, ORDER_EFFECT, PRIORITY_FRONT, 0, 0);
  object_task(&d->o, dust_run, PRIORITY_OBJECTS);
}
