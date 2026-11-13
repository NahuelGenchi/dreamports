// The wall poles, kinds 44 and 45. Translated from the JavaScript version's engine/wallpoles.js (the original's
// red_flag_and_pole.c): bars in Neo Green Hill, red flags lying on their side in the other zones, kind 44 sticking out of a wall
// to its right and kind 45, flipped, to its left. Whenever Sonic's body touches one's box, at any speed, on the ground or in the
// air, it catches him: he hangs from it for 14 frames, bobbing down and swinging up, and is thrown straight up at 7.5 px a frame,
// keeping the X speed he came with. It takes him again once its swing animation is over. A flying Tails goes through it, as does
// Knuckles while he glides, climbs or floats.

#include "objects.h"

enum { WALL_POLE_LEFT = 44, WALL_POLE_RIGHT = 45 };
enum {
  ANIM_POLE_NEO_GREEN_HILL = 468, ANIM_POLE_FLAG = 470,   // Neo Green Hill's bar, and the red flag lying on its side
  VARIANT_REST = 0, VARIANT_SWING = 1,
  ORDER_POLE = 18, PRIORITY_FRONT = 2,
  SE_POLE = 175,
  HANG_X = 8, HANG_Y = 16,   // where it puts his centre, from its point
  SWING_FRAMES = 14,
  SWING_UP_FROM = 6,    // the frames after this one swing him up
};
// how far the swing moves him on each frame it holds him: down for the first 7, then up
static const uint8_t SWING[SWING_FRAMES] = { 1, 1, 1, 1, 1, 1, 1, 1, 16, 7, 7, 7, 7, 7 };
#define LAUNCH_SPEED 7.5

enum { PHASE_WAITING, PHASE_HOLDING, PHASE_SWINGING };   // Task_8077C5C, Task_8077D1C and Task_8077E9C

typedef struct { Object o; int dir, phase, t; } WallPole;

// it tests the box its last animation frame set, before stepping the animation; none yet on its first frame
static int catches(WallPole *w, Player *p) {
  const Entity *e = &w->o.slot->e;
  const Hitbox *hb = object_box(&w->o.sprite, 0);
  Hitbox body = collide_body(p);
  if (p->dead || !hb || !collide_overlap(e->x, e->y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) return 0;
  if ((p->character == CHARACTER_TAILS || p->character == CHARACTER_KNUCKLES) && p->midAir != 0) return 0;
  // Player_TransitionCancelFlyingAndBoost; his speeds and whether he is in the air stay as they were
  player_end_attack(p); p->pushing = 0;
  p->carried = 1;
  p->x = e->x + HANG_X * w->dir; p->y = e->y + HANG_Y;
  p->facing = -w->dir;
  p->state = PS_POLE;
  return 1;
}

static void swing(WallPole *w, Player *p) {
  if (p->dead) { p->carried = 0; return; }
  p->y += w->t > SWING_UP_FROM ? -SWING[w->t] : SWING[w->t];
  if (++w->t < SWING_FRAMES) return;
  p->air = 1;
  player_stand_up(p);   // uncurled, his feet where they were
  p->airLock = 0;       // a jump out of a roll would otherwise leave him unable to steer away from it
  p->state = PS_SPRING_RISE;
  p->ysp = -LAUNCH_SPEED;
  p->carried = 0;
  w->phase = PHASE_SWINGING;
}

static int pole_run(ActTask *t) {
  WallPole *w = (WallPole *)t->data;
  Sprite *s = &w->o.sprite;
  const Entity *e = &w->o.slot->e;
  Player *p = &act.player;
  if (w->phase == PHASE_WAITING) {
    if (catches(w, p)) {
      play_song(SE_POLE);
      sprite_start(s, VARIANT_SWING);
      w->phase = PHASE_HOLDING; w->t = 0;
    }
    if (off_cam(e->x, e->y)) return 0;
    sprite_step(s);
  } else {
    // leaving while it holds him would leave him held
    if (off_cam(e->x, e->y)) return 0;
    if (w->phase == PHASE_HOLDING) {
      swing(w, p);
      sprite_step(s);
    } else if (sprite_step(s)) {
      // back to rest, its first frame showing from the next one
      sprite_start(s, VARIANT_REST);
      w->phase = PHASE_WAITING;
    }
  }
  object_draw(s, e->x, e->y);
  return 1;
}

ActTask *wall_pole_spawn(Slot *slot) {
  WallPole *w = OBJECT_NEW(WallPole);
  if (!w) return NULL;
  const Entity *en = &slot->e;
  w->o.slot = slot;
  w->o.x = en->x;
  w->dir = en->kind == WALL_POLE_RIGHT ? -1 : 1;   // the way it points out of its wall
  w->phase = PHASE_WAITING;
  int anim = act.stage.zone == ZONE_NEO_GREEN_HILL ? ANIM_POLE_NEO_GREEN_HILL : ANIM_POLE_FLAG;
  // its first frame's box is set before its first run, which steps it on as the original does
  object_sprite(&w->o.sprite, anim, VARIANT_REST, VARIANT_SWING, ORDER_POLE, PRIORITY_FRONT, w->dir < 0, 0);
  sprite_step(&w->o.sprite);
  return object_task(&w->o, pole_run, PRIORITY_OBJECTS);
}
