// The mole, in Secret Base, Egg Rocket and Cosmic Angel (enemy kind 15). Translated from the JavaScript version's
// engine/mole.js (the original's mole.c): a mole in a mound that pops up every 60 frames, facing Sonic, and ducks back after 60
// more. Only while it is up can it be defeated or hurt him. Defeated, it sinks into its mound for good, which stays until the
// act starts over: the original clears d1 in the act's copy of the entity, and with d1 0 it never comes up. While it is down it
// keeps its last box, so for its first frames up it is hit where it was last.

#include "enemies.h"

enum {
  ANIM_MOLE = 434, VARIANT_DOWN = 0, VARIANT_UP = 1,
  WAIT = 60,   // TIME(0, 1)
};

typedef struct { Object o; int up, t; } Mole;

// Task_Mole, and Task_Mole_8071640 while it is up; it sets the variant alone, which starts the animation over only when it
// changes
static int mole_run(ActTask *t) {
  Mole *m = (Mole *)t->data;
  Slot *slot = m->o.slot;
  Sprite *s = &m->o.sprite;
  int x = slot->e.x, y = slot->e.y;
  if (enemy_gone(x, y, x, y)) return 0;
  if (slot->e.d[1] != 0) {
    if (!m->up) {
      if (++m->t >= WAIT) {
        m->t = 0;
        s->variant = VARIANT_UP;
        enemy_flip_x(s, !(x > enemy_sonic_x()));
        m->up = 1;
      }
    } else {
      if (++m->t >= WAIT) { m->t = 0; s->variant = VARIANT_DOWN; m->up = 0; }
      if (enemy_attack(s, x, y)) {
        s->variant = VARIANT_DOWN;
        m->up = 0;
        slot->e.d[1] = 0;
      }
    }
  }
  sprite_step(s);
  object_draw(s, x, y);
  return 1;
}

ActTask *mole_spawn(Slot *slot) {
  Mole *m = OBJECT_NEW(Mole);
  if (!m) return NULL;
  m->o.slot = slot;
  m->o.x = slot->e.x;
  enemy_sprite(&m->o.sprite, ANIM_MOLE, VARIANT_DOWN, VARIANT_UP, ENEMY_ORDER);
  return object_task(&m->o, mole_run, PRIORITY_OBJECTS);
}
