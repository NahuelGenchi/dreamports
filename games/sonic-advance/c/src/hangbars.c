// Angel Island's and Egg Rocket's hang bars (kind 83). Translated from engine/hangbars.js (the original's
// hang_bar.c: CreateEntity_HangBar, Task_HangBar). An unseen bar across the top of a box (d0, d1 tiles from the
// entity, d2 by d3 tiles big). Falling into the box, Sonic catches it and hangs 16 px below it, moving 2 px a frame
// sideways as held, until jump or moving past an end drops him 22 px under it with the spin attack on.

#include "objects.h"
#include "terrain.h"

enum {
  HANG = 16, CATCH = 18, DROP = 22, STEP = 2,
  SPRITE_OFFSET_Y = 14,
  PRIORITY_HANG_BAR = 0x8000,
};

typedef struct {
  Object o;
  int left, right, top, bottom;
  int on;
  double playerX;
} HangBar;

static int hang_bar_run(ActTask *t) {
  HangBar *b = (HangBar *)t->data;
  const Entity *en = &b->o.slot->e;
  Player *p = &act.player;

  if (b->on) {
    if (p->dead) {
      b->on = 0;
    } else {
      int dir = (p->held[0] & DPAD_RIGHT) ? 1 : (p->held[0] & DPAD_LEFT) ? -1 : 0;
      if (dir != 0) {
        p->state = PS_HANG_MOVE;
        p->facing = dir;
        p->x = b->playerX + STEP * dir;
      } else {
        p->state = PS_HANG;
      }
      p->y = en->y + HANG;
      b->playerX = p->x;

      if (p->jumpPressed || (int)__builtin_floor(p->x) < b->left || (int)__builtin_floor(p->x) > b->right) {
        player_end_attack(p);
        p->pushing = 0;
        p->carried = 0;
        p->curled = 1;
        p->ysp = 0;
        p->y = en->y + DROP;
        p->air = 1;
        p->state = PS_SPRING_PEAK;
        if (dir < 0) p->facing = -1;
        p->gsp = p->xsp = STEP * dir;
        b->on = 0;
      }
    }
  } else if (!p->dead && p->ysp > 0) {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (px >= b->left && px <= b->right && py >= b->top && py <= b->bottom) {
      p->rotation = 0;
      player_end_attack(p);
      p->pushing = 0;
      p->carried = 1;
      p->air = 0;
      int dir = (p->held[0] & DPAD_RIGHT) ? 1 : (p->held[0] & DPAD_LEFT) ? -1 : 0;
      if (dir != 0) {
        p->state = PS_HANG_MOVE;
        p->facing = dir;
      } else {
        p->state = PS_HANG;
      }
      p->y = en->y + CATCH;
      sensors_set_offset_y(p, SPRITE_OFFSET_Y);
      b->on = 1;
      b->playerX = p->x;
    }
  }

  if (!b->on && off_cam(en->x, en->y)) {
    b->o.slot->live = NULL;
    return 0;
  }
  return 1;
}

ActTask *hang_bar_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  HangBar *b = OBJECT_NEW(HangBar);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = en->x;
  b->left = en->x + s8(en->d[0]) * 8;
  b->right = b->left + en->d[2] * 8;
  b->top = en->y + s8(en->d[1]) * 8;
  b->bottom = b->top + en->d[3] * 8;
  b->on = 0;
  return object_task(&b->o, hang_bar_run, PRIORITY_HANG_BAR);
}
