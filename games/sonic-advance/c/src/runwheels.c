// Angel Island's run wheels (interactable kind 86). Translated from the JavaScript version's engine/runwheels.js (the
// original's run_wheel.c: CreateEntity_RunWheel, Task_RunWheel, sub_808EA80 and sub_808EC84): a wheel on a track that Sonic
// stands on and runs on the spot to drive. It goes along its track (d0 x 45 degrees from the right, clockwise) as far as
// d2 x 16.875 px of travel allows; on the track that is 2 px for every 12.5 px of travel, and 1 px each way on a diagonal one,
// since the original rounds the direction down to a whole number of pixels first. Running forward drives it at twice his
// speed less 1/16 px, up to 11.125 px a frame; standing still or running back lets it roll back, and pulls him back with it a
// quarter pixel a frame faster every frame, up to 9 px a frame. Off it, it rolls back to its start, 12/256 px a frame faster
// every frame. It is solid when he isn't on it; landing on it gives him its speed, and jumping off it keeps at most 1.125 px
// a frame of his speed across. It starts its turning over on every frame its speed and its speed the frame before are 0.

#include "objects.h"

enum {
  ANIM_RUN_WHEEL = 542, VARIANT_BACK = 0, VARIANT_FORWARD = 1,
  WHEEL_TILES = 32 / 8 * (32 / 8),
  ORDER_WHEEL = 18, PRIORITY_FRONT = 2,
  TRAVEL = 4320,               // d2's unit of travel, Q(16.875)
  STEP = 3200, DIRECTION = 6000,   // the travel of a step along the track, and what the direction is divided by
  ROLL_BACK = 12,              // Q(12 / 256)
  DRIVE_LESS = 16,             // Q(16 / 256)
  MAX_SPEED = 2848,            // Q(11.125)
  PULL = 64, MIN_GROUND = -2304, MAX_GROUND = 1152,   // Q(0.25), -Q(9), Q(4.5)
  ATTACK_MAX = 0x240, JUMP_MAX = 288,                 // Q(2.25), Q(1.125)
  ANIM_SPEED_DIV = 0x1C,
  SLIDE = 3,                   // his B-button step while sliding (unk62 3), which it doesn't pull back
  SE_SLOW = 212, SE_MEDIUM = 213, SE_FAST = 214,      // SE_RUN_WHEEL_A, B and C
};

typedef struct {
  Object o;
  int y, dx, dy, reach;
  int along, speed, last, count;   // qUnk40, qUnk44, unk48 and unk4C
} RunWheel;

static int q(double v) { return (int)__builtin_floor(v * 256 + 0.5); }   // to 1/256 px, rounded as the JavaScript does
static int clamp(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

/** the sound of it turning: slow, medium and fast, timed by the frames since he landed on it or left it */
static void sound(RunWheel *w) {
  w->count = (w->count + 1) & 0xFFFF;
  if ((uint32_t)(w->speed + 1279) < 2559u) {
    if (w->speed != 0 && w->count % 25 == 0) play_song(SE_SLOW);
  } else if ((uint32_t)(w->speed + 0x81F) < 0x103Fu) {
    if (w->count % 16 == 0) play_song(SE_MEDIUM);
  } else if (w->count % 8 == 0) play_song(SE_FAST);
}

static void anim_speed(RunWheel *w) {
  int v = w->speed / ANIM_SPEED_DIV;
  w->o.sprite.animSpeed = (uint8_t)(v < 0 ? -v : v);
}

/** sub_808EA80: Sonic not on it; it is solid, and rolls back */
static void free_wheel(RunWheel *w, Player *p, const Hitbox *hb) {
  if (!p->dead && hb && (collide_platform(&w->o, w->o.x, w->y, hb, p) & COLLIDE_LANDED)) {
    w->last = 0; w->count = 0;
    p->gsp = w->speed / 256.0;
    p->carried = 0;
  }
  anim_speed(w);
  w->speed -= ROLL_BACK;
  w->along += w->speed;
  if (w->along > w->reach) w->along = w->reach;
  if (w->along < 0) { w->along = 0; w->speed = 0; }
  int variant = w->speed >= 0 ? VARIANT_FORWARD : VARIANT_BACK;
  if (w->o.sprite.variant != variant) sprite_start(&w->o.sprite, variant);
  sound(w);
}

/** sub_808EC84: Sonic on it runs on the spot on its top, and drives it */
static void driven(RunWheel *w, Player *p, const Hitbox *hb) {
  if (p->state == PS_HURT || p->dead || !hb) { p->onObject = NULL; return; }
  p->y = w->y + hb->top - p->offsetY;
  if (p->air || p->attack != 0) {
    w->count = 0;
    if (p->air) {
      p->onObject = NULL;
      // Amy's dive keeps its speed
      if (!p->dive) p->xsp = clamp(q(p->xsp), -JUMP_MAX, JUMP_MAX) / 256.0;
    } else if (collide_platform(&w->o, w->o.x, w->y, hb, p) & COLLIDE_LANDED) {
      p->gsp = clamp(q(p->gsp), -ATTACK_MAX, ATTACK_MAX) / 256.0;
    }
  } else p->x = w->o.x - p->xsp;
  anim_speed(w);
  int gsp = q(p->gsp);
  // Amy crouching on it (charState 2) drives it as she is
  w->speed = p->character == CHARACTER_AMY && p->state == PS_CROUCH ? gsp : gsp - DRIVE_LESS;
  if (w->speed > 0) w->speed *= 2;
  if (w->speed > MAX_SPEED) w->speed = MAX_SPEED;
  w->along += w->speed;
  if (w->along > w->reach) {
    w->along = w->reach;
    if (w->speed < 0) w->speed = 0;
  }
  // rolling back, it pulls him back faster and faster, unless he is sliding
  int g = gsp;
  if (w->speed < 0 && g <= 0 && p->attack != SLIDE) g -= PULL;
  int before = s16(g);
  g = g < MIN_GROUND ? MIN_GROUND : before > MAX_GROUND ? MAX_GROUND : before;
  if (w->along < 0) {
    w->along = 0; w->speed = 0;
    if (p->attack == 0 && before < 0) g = 0;
    sprite_start(&w->o.sprite, VARIANT_FORWARD);
  }
  p->gsp = g / 256.0;
  if (w->speed >= 0) { if (w->last <= 0) sprite_start(&w->o.sprite, VARIANT_FORWARD); }
  else if (w->last >= 0) sprite_start(&w->o.sprite, VARIANT_BACK);
  sound(w);
  w->last = w->speed;
}

/** Task_RunWheel */
static int run_wheel_run(ActTask *t) {
  RunWheel *w = (RunWheel *)t->data;
  const Entity *en = &w->o.slot->e;
  int step = w->along / STEP;
  w->o.x = en->x + w->dx * step;
  w->y = en->y + w->dy * step;
  if (off_display(en->x, en->y) && off_cam(w->o.x, w->y)) return 0;
  Player *p = &act.player;
  const Hitbox *hb = object_box(&w->o.sprite, 0);
  if (p->onObject == &w->o) driven(w, p, hb);
  else free_wheel(w, p, hb);
  if (w->speed != 0) sprite_step(&w->o.sprite);
  object_draw(&w->o.sprite, w->o.x, w->y);
  return 1;
}

/** CreateEntity_RunWheel */
ActTask *run_wheel_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  RunWheel *w = OBJECT_NEW(RunWheel);
  if (!w) return NULL;
  w->o.slot = slot;
  w->o.x = en->x;
  w->y = en->y;
  int theta = (en->d[0] << 7) & 1023;
  w->dx = SINE[theta + 256] / DIRECTION;
  w->dy = SINE[theta] / DIRECTION;
  w->reach = en->d[2] * TRAVEL;
  object_sprite_at(&w->o.sprite, vram_malloc(WHEEL_TILES), ANIM_RUN_WHEEL, VARIANT_FORWARD, ORDER_WHEEL, PRIORITY_FRONT, 0, 0);
  sprite_step(&w->o.sprite);
  return object_task(&w->o, run_wheel_run, PRIORITY_OBJECTS);
}
