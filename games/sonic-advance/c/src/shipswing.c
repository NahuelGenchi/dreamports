// Casino Paradise's ship swings (kind 60). Translated from the JavaScript version's engine/shipswing.js (the original's
// ship_swing.c, Task_ShipSwing): a pirate ship hanging from a hook on five links, swinging with the stage timer. Sonic can stand
// on the hook and on the ship, which carries him with it, his centre 5 px above its point; stepping off the ship keeps it from
// taking him again for 5 frames. The ship is half a sprite, drawn a second time mirrored.

#include "objects.h"

enum {
  SHIP_SWING = 60,
  ANIM_SHIP = 491, ANIM_HOOK = 490, ANIM_LINK = 489,
  ORDER_SHIP = 4, ORDER_HOOK = 18, ORDER_LINK = 18, ORDER_LAST_LINK = 3, PRIORITY_FRONT = 2,
  PRIORITY_SHIP_SWING = 0x7000,
  LINKS = 5,
  SWING_PERIOD = 0x200, SWING_HALF = 0x100,   // the stage clock, doubled, in 1/512 of a swing
  SWING_PHASE = 0x7E,
  LINK_SCALE = 110, LINK_OF = 100, LINK_SHIFT = 10,   // each link is 110/100 of the swing's direction, in 1/1024 px
  HOOK_ABOVE = 4,       // he is taken by the hook while he is more than 4 px above its point
  SEAT_ABOVE = 5,       // the ship carries him with his centre 5 px above its point
  SHIP_WAIT = 5,        // frames the ship leaves him alone after he steps off
};

typedef struct {
  Object o;             // the ship
  Object hook;          // what he stands on at the hook: its sprite's box and where it is
  Sprite link;
  int onHook, onShip;   // unk9C and unkA5
  int wait;             // frames before the ship takes him again
  int lastX;            // the ship's last x
} Swing;

static int ship_swing_run(ActTask *t) {
  Swing *sw = (Swing *)t->data;
  const Entity *en = &sw->o.slot->e;
  Player *p = &act.player;
  // the swing: an angle from the timer, and a lift at either end of it
  int turn = (act.tick * 2) % SWING_PERIOD, lift;
  if (turn > SWING_HALF) { turn = SWING_PERIOD - turn; lift = SINE[turn * 2] >> 8; }
  else lift = -(SINE[turn * 2] >> 8);
  int theta = ((SINE[((turn - SWING_PHASE) & 0x1FF) * 2] >> 7) & 0x1FF) * 2;
  int dirX = SINE[theta], dirY = SINE[theta + 256] + lift;

  if (off_cam(en->x, en->y)) return 0;
  object_draw(&sw->hook.sprite, en->x, en->y);
  int dx = 0, dy = 0;
  for (int i = 0; i < LINKS; i++) {
    dx += dirX * LINK_SCALE / LINK_OF;
    dy += dirY * LINK_SCALE / LINK_OF;
    sw->link.oamFlags = (uint16_t)((i == LINKS - 1 ? ORDER_LAST_LINK : ORDER_LINK) << 6);
    object_draw(&sw->link, en->x + (dx >> LINK_SHIFT), en->y + (dy >> LINK_SHIFT));
  }
  int sx = en->x + (dx >> LINK_SHIFT), sy = en->y + (dy >> LINK_SHIFT);
  sw->o.x = sx;

  if (!p->dead) {
    if (en->y - HOOK_ABOVE > p->y) {
      if (collide_platform_top(&sw->hook, en->x, en->y, object_box(&sw->hook.sprite, 0), p) & COLLIDE_LANDED) sw->onHook = 1;
      else if (sw->onHook) { sw->onHook = 0; p->onObject = NULL; p->pushing = 0; }
    }
    if (sw->wait > 0) sw->wait--;
    else if (collide_platform_top(&sw->o, sx, sy, object_box(&sw->o.sprite, 0), p) & COLLIDE_LANDED) {
      if (!sw->onShip) sw->onShip = 1;
      else { p->x += sx - sw->lastX; p->y = sy - SEAT_ABOVE; }
      sw->lastX = sx;
    } else if (sw->onShip) { sw->onShip = 0; sw->wait = SHIP_WAIT; p->onObject = NULL; p->pushing = 0; }
  }

  Sprite *ship = &sw->o.sprite;
  ship->frameFlags &= ~SPRITE_X_FLIP;
  object_draw(ship, sx, sy);
  ship->frameFlags |= SPRITE_X_FLIP;
  object_draw(ship, sx, sy);
  return 1;
}

// the tiles of all three go together (TaskDestructor_ShipSwing)
static void ship_swing_end(ActTask *t) {
  Swing *sw = (Swing *)t->data;
  object_sprite_free(&sw->hook.sprite);
  object_sprite_free(&sw->link);
  object_end(t);
}

ActTask *ship_swing_spawn(Slot *slot) {
  Swing *sw = OBJECT_NEW(Swing);
  if (!sw) return NULL;
  sw->o.slot = slot;
  sw->hook.x = slot->e.x;
  // the ship, the hook and then the links are given their tiles in this order, and take their first frame in it: the only frames
  // they have, whose boxes they keep
  object_sprite(&sw->o.sprite, ANIM_SHIP, 0, 0, ORDER_SHIP, PRIORITY_FRONT, 0, 0);
  object_sprite(&sw->hook.sprite, ANIM_HOOK, 0, 0, ORDER_HOOK, PRIORITY_FRONT, 0, 0);
  object_sprite(&sw->link, ANIM_LINK, 0, 0, ORDER_LINK, PRIORITY_FRONT, 0, 0);
  sprite_step(&sw->o.sprite);
  sprite_step(&sw->hook.sprite);
  sprite_step(&sw->link);
  ActTask *t = object_task(&sw->o, ship_swing_run, PRIORITY_SHIP_SWING);
  if (!t) { object_sprite_free(&sw->hook.sprite); object_sprite_free(&sw->link); }
  else t->end = ship_swing_end;
  return t;
}
