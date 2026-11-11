// The curler (interactable kind 96), at the mouth of Secret Base's pipes. Translated from the JavaScript version's
// engine/curlers.js (the original's interactables/096.c, Task_Interactable096): nothing drawn, and on every frame Sonic's
// position is within 8 px of its spawn point, edges in, and he is alive, it curls him into a ball (MOVESTATE_SPIN_ATTACK
// and CHARSTATE_SPINATTACK, the rolling ball, which is PS_SPIN here; PS_SPIN_ATTACK is the B-button attack). It does so
// whatever holds him. It leaves when its spawn point leaves the camera's range.

#include "objects.h"

enum { CURLER = 96, REACH = 8 };

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

static int curler_run(ActTask *t) {
  Object *o = (Object *)t->data;
  const Entity *en = &o->slot->e;
  Player *p = &act.player;
  int wx = en->x, wy = en->y;
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (!p->dead && wx - REACH <= px && wx + REACH >= px && wy - REACH <= py && wy + REACH >= py) {
    cancel(p);
    p->state = PS_SPIN;
    player_curl_up(p);   // MOVESTATE_SPIN_ATTACK, and PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 9)
  }
  return !off_cam(wx, wy);
}

// CreateEntity_Interactable096
ActTask *curler_spawn(Slot *slot) {
  Object *o = OBJECT_NEW(Object);
  if (!o) return NULL;
  o->slot = slot;
  o->x = slot->e.x;
  o->sprite.graphics.dest = HEAP_END;   // no sprite
  return object_task(o, curler_run, PRIORITY_OBJECTS);
}
