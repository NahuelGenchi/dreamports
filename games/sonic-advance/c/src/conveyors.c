// The conveyor belts, kind 69 outside Ice Mountain, which uses the kind for its snow. Translated from the JavaScript version's
// engine/conveyors.js (the original's conveyor_belt_movement.c, Task_ConveyorBeltMvt). The belt itself is drawn in the act; the
// entity is a box from its spawn point, d2 by d3 tiles (both edges in). On every frame Sonic's position is in it and he is on
// the ground, it carries him 0.625 px, right when d0 is set and left otherwise, then pushes him out of any wall 8 px ahead of or
// behind his centre. It leaves when its spawn point leaves the camera's range.

#include "objects.h"
#include "terrain.h"

enum { CONVEYOR = 69, ICE_MOUNTAIN = 3, TILE = 8 };   // the wall beside him is the one-tile probe, sub_801F100 with sub_801EB44
#define CONVEYOR_BELT_SPEED 0.625

static int conveyor_run(ActTask *t) {
  Slot *slot = (Slot *)t->data;
  const Entity *e = &slot->e;
  Player *p = &act.player;
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if (!p->dead && x >= e->x && x <= e->x + e->d[2] * TILE && y >= e->y && y <= e->y + e->d[3] * TILE && !p->air) {
    if (e->d[0] != 0) {
      p->x += CONVEYOR_BELT_SPEED;
      int d = terrain_tile_scan(PROBE_WALL, (int)__builtin_floor(p->x) + 8, y, p->layer, 8);
      if (d < 0) p->x += d;
    } else p->x -= CONVEYOR_BELT_SPEED;
    int d = terrain_tile_scan(PROBE_WALL, (int)__builtin_floor(p->x) - 8, y, p->layer, -8);
    if (d < 0) p->x -= d;
  }
  if (off_cam(e->x, e->y)) { slot->live = NULL; return 0; }
  return 1;
}

ActTask *conveyor_spawn(Slot *slot) {
  if (act.stage.zone == ICE_MOUNTAIN) return NULL;   // Ice Mountain's snow
  return act_task_add(conveyor_run, NULL, slot, PRIORITY_OBJECTS);
}
