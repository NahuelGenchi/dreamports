// Angel Island's hang bars (kind 83): an invisible bar along the top of a box, d0 and d1 tiles (signed) from its point and
// d2 by d3 tiles big. Falling with his centre in the box, Sonic catches it: it holds him 16 px under it, still or moving
// 2 px a frame the way he holds, until he presses jump or goes past either end, when it drops him 22 px under it, falling
// from rest in the air with the spin attack on, at 2 px a frame the way he holds. Its task runs after Sonic's, at priority
// 0x8000, and it leaves once its point is out of range with nobody on it. Translated from the JavaScript version's
// engine/hangbars.js (the original's hang_bar.c).

#include "objects.h"
#include "terrain.h"

enum {
  HANG_BAR = 83,
  HANG = 16, CATCH = 18, DROP = 22, STEP = 2,
  PRIORITY_HANG = 0x8000,
};

typedef struct { Object o; int on; double x; } HangBar;

// the pose his input picks: swinging along it the way he holds, or still; it returns the way, -1, 0 or 1
static int pose(Player *p) {
  if (p->held[0] & DPAD_RIGHT) { p->state = PS_HANG_MOVE; p->facing = 1; return 1; }
  if (p->held[0] & DPAD_LEFT) { p->state = PS_HANG_MOVE; p->facing = -1; return -1; }
  p->state = PS_HANG;
  return 0;
}

static int hang_bar_run(ActTask *t) {
  HangBar *h = (HangBar *)t->data;
  const Entity *e = &h->o.slot->e;
  Player *p = &act.player;
  int left = e->x + s8(e->d[0]) * 8, right = left + e->d[2] * 8;
  int top = e->y + s8(e->d[1]) * 8, bottom = top + e->d[3] * 8;
  if (h->on) {
    if (p->dead) h->on = 0;
    else {
      int dir = pose(p);
      p->x = h->x + STEP * dir;
      p->y = e->y + HANG;
      h->x = p->x;
      int px = (int)__builtin_floor(p->x);
      if (p->jumpPressed || px < left || px > right) {
        // Player_TransitionCancelFlyingAndBoost; the spin attack goes on, the sprite offsets staying
        player_end_attack(p); p->pushing = 0;
        p->carried = 0; p->curled = 1;
        p->ysp = 0; p->y = e->y + DROP; p->air = 1;
        p->state = PS_SPRING_PEAK;   // character state 18, which leaves him uncurled in the original's code
        int held = p->held[0];
        int way = held & DPAD_RIGHT ? 1 : held & DPAD_LEFT ? -1 : 0;
        if (way < 0) p->facing = -1;
        p->gsp = p->xsp = STEP * way;
        h->on = 0;
      }
    }
  } else if (!p->dead && (int)__builtin_floor(p->ysp * 256) > 0) {   // qSpeedAirY > Q(0), the original's integer
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (px >= left && px <= right && py >= top && py <= bottom) {
      p->rotation = 0;
      player_end_attack(p); p->pushing = 0;
      p->carried = 1; p->air = 0;
      pose(p);
      p->y = e->y + CATCH;
      // PLAYERFN_CHANGE_SHIFT_OFFSETS(p, 6, 14): his feet stay where they are
      sensors_set_offset_y(p, 14);
      h->on = 1; h->x = p->x;
    }
  }
  if (!h->on && off_cam(e->x, e->y)) { h->o.slot->live = NULL; return 0; }
  return 1;
}

/** CreateEntity_HangBar: it draws nothing; the bar is in the act's tiles */
ActTask *hang_bar_spawn(Slot *slot) {
  HangBar *h = PLAIN_NEW(HangBar);
  if (!h) return NULL;
  h->o.slot = slot;
  h->o.x = slot->e.x;
  return act_task_add(hang_bar_run, NULL, h, PRIORITY_HANG);
}
