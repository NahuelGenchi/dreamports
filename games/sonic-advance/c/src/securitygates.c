// Secret Base's security gates (kind 77). Translated from the JavaScript version's engine/securitygates.js (the original's
// security_gate.c): a shutter that drops shut behind Sonic. It waits until he is inside a zone d2 tiles wide and d3 tiles tall
// from its spawn point's height down: with d0 0 the zone ends 10 px right of the gate, otherwise it starts there. Then it slides
// down 6 px a frame for 8 frames, to 48 px below its spawn point, and from the next frame on it pushes him out of its sides. It
// stays shut until it leaves the camera's range.

#include "objects.h"

enum {
  ANIM_GATE = 534, ORDER_GATE = 18, PRIORITY_FRONT = 2,
  TILE = 8, DROP = 6, FRAMES = 8, SHUT = 48, ZONE_SIDE = 10,
};
enum { WAITING, DROPPING, SHUT_TIGHT };

typedef struct { Object o; int from, phase, drop, left; } Gate;

// Task_SecurityGateMain, Task_SecurityGate1 while it drops and Task_SecurityGate2 once it is shut
static int gate_run(ActTask *t) {
  Gate *g = (Gate *)t->data;
  const Entity *en = &g->o.slot->e;
  Player *p = &act.player;
  int y = en->y + g->drop, was = g->phase;
  if (g->phase == WAITING) {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y), x0 = en->x - g->from;
    if (!p->dead && x0 <= px && x0 + en->d[2] * TILE >= px && en->y <= py && en->y + en->d[3] * TILE >= py) {
      g->drop = 0; g->left = FRAMES; g->phase = DROPPING;
    }
  } else if (g->phase == SHUT_TIGHT) collide_gate(en->x, y, object_box(&g->o.sprite, 0), p);
  if (off_display(en->x, en->y) && off_cam(en->x, y)) return 0;
  if (was == DROPPING) {
    if (--g->left == 0) { g->drop = SHUT; g->phase = SHUT_TIGHT; } else g->drop += DROP;
  }
  sprite_step(&g->o.sprite);
  object_draw(&g->o.sprite, en->x, y);
  return 1;
}

// CreateEntity_SecurityGate
ActTask *security_gate_spawn(Slot *slot) {
  Gate *g = OBJECT_NEW(Gate);
  if (!g) return NULL;
  g->o.slot = slot;
  g->o.x = slot->e.x;
  g->from = slot->e.d[0] == 0 ? slot->e.d[2] * TILE - ZONE_SIDE : -ZONE_SIDE;
  object_sprite(&g->o.sprite, ANIM_GATE, 0, 0, ORDER_GATE, PRIORITY_FRONT, 0, 0);
  return object_task(&g->o, gate_run, PRIORITY_OBJECTS);
}
