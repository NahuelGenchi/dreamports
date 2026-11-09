// The boxes that hide Sonic, kind 70. Translated from the JavaScript version's engine/visibility.js (the original's
// toggle_player_visibility.c), which Casino Paradise puts along its tubes. While his centre is inside one, d2 tiles across and
// d3 down from its spawn point, it hides him when its d0 is set and shows him again when it is 0: that is MOVESTATE_100000, the
// player's `invisible`. Once he is dead it shows him. Its task has priority 0x2000 plus its d3, and it sees where he was at the
// end of the last frame.

#include "objects.h"

enum { TOGGLE_VISIBILITY = 70, TILE = 8 };

static int visibility_run(ActTask *t) {
  Slot *slot = (Slot *)t->data;
  const Entity *e = &slot->e;
  Player *p = &act.player;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if (p->dead) p->invisible = 0;
  else if (x >= e->x && x <= e->x + e->d[2] * TILE && y >= e->y && y <= e->y + e->d[3] * TILE) p->invisible = e->d[0] != 0;
  if (off_cam(e->x, e->y)) { slot->live = NULL; return 0; }
  return 1;
}

ActTask *visibility_spawn(Slot *slot) {
  return act_task_add(visibility_run, NULL, slot, PRIORITY_OBJECTS | slot->e.d[3]);
}
