// Cosmic Angel's and Egg Rocket's gravity toggles (kind 109). Translated from engine/gravity.js (the original's
// toggle_gravity.c: Task_ToggleGravity). An unseen line that acts when Sonic's centre crosses it within its span.

#include "objects.h"

typedef struct { Object o; int across, what, turn, normal, from, to, line; double last; } GravityToggle;

static int gravity_toggle_run(ActTask *t) {
  GravityToggle *g = (GravityToggle *)t->data;
  const Entity *en = &g->o.slot->e;
  Player *p = &act.player;
  if (!p->dead) {
    double now = g->across ? p->y : p->x;
    int at = (int)__builtin_floor(g->across ? p->x : p->y);
    if (at >= g->from && at <= g->to && ((g->last > g->line && now < g->line) || (g->last < g->line && now > g->line))) {
      p->inverted = g->what == g->turn ? !p->inverted : g->what != g->normal;
    }
    g->last = now;
  }
  if (off_cam(en->x, en->y)) { g->o.slot->live = NULL; return 0; }
  return 1;
}

ActTask *gravity_toggle_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  GravityToggle *g = OBJECT_NEW(GravityToggle);
  if (!g) return NULL;
  g->o.slot = slot;
  g->o.x = en->x;
  // which kind it is comes from the longer span, but which way its line runs comes from the kind alone (kind > 2: across)
  g->what = en->d[2] > en->d[3] ? en->d[1] : en->d[0];
  g->last = en->d[2] > en->d[3] ? act.player.y : act.player.x;
  g->across = g->what > 2;
  g->turn = g->across ? 3 : 0;
  g->normal = g->across ? 4 : 1;
  g->from = g->across ? en->x + s8(en->d[0]) * 8 : en->y + s8(en->d[1]) * 8;
  g->to = g->from + (g->across ? en->d[2] : en->d[3]) * 8;
  g->line = g->across ? en->y : en->x;
  return object_task(&g->o, gravity_toggle_run, PRIORITY_OBJECTS);
}
