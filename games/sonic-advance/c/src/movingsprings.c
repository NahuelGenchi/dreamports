// Moving springs (kind 81). Translated from the JavaScript version's engine/movingsprings.js (the original's
// moving_spring.c: CreateEntity_MovingSpring, its two tasks, sub_808B7A0 and sub_808BB44): a spring on a block that swings
// with the stage clock, d2 * 8 px either way across when d2 is above d3, else d3 * 8 px either way up and down, one swing
// every 256 frames, half a swing later when the sign of d0 (across) or d1 (up and down) is set.
//
// Sonic lands on its top like any solid object's; the frame after he lands, the spring throws him up at 7.5 px a frame in
// his spring somersault, and plays its launch animation. Its sides push him out on their own, 8 px of slack each way, and set
// him on the terrain when that puts him in it. Two quirks of the original are kept: while he is in the spring somersault (from
// any spring) its sides don't move him, and whenever he pushes against anything but its block, it stops his pushing and sets
// him walking.

#include "objects.h"
#include "terrain.h"

enum {
  ORDER_SPRING = 18, PRIORITY_FRONT = 2,
  SWING_HALF = 0x80,        // the stage clock frames of half a swing
  SIDE_SLACK = 8,           // how far in from its edges the sides put him out to the nearer one
  LAUNCH_FRAMES = 12,
  SE_SPRING = 170,
  ZONE_6 = 5, CHAO_HUNT_D = 17,
};
#define THROW_SPEED 7.5

// the look by zone (CreateEntity_MovingSpring): its animation and the variants it waits and launches with
static const struct { int anim, idle, launch; } LOOK_ICE_MOUNTAIN = { 526, 1, 0 }, LOOK_ZONE_6 = { 582, 1, 0 }, LOOK_DEFAULT = { 540, 0, 1 };

typedef struct {
  Object o;
  int y;               // where its box is this frame (Object has the x)
  int across, phase, reach, idle, launch;
  int launching, n;
} MovingSpring;

static int floor_of(double v) { return (int)__builtin_floor(v); }

/** sub_808BB44: out of its sides to a whole pixel, within 8 px of each, then out of the floor below and the ceiling above
 *  him (both moving him up) */
static void side(MovingSpring *ms, Player *p) {
  const Hitbox *hb = object_box(&ms->o.sprite, 0);
  Hitbox flank = collide_flank(p);
  int px = floor_of(p->x), py = floor_of(p->y);
  if (!hb || !collide_overlap(ms->o.x, ms->y, hb, px, py, &flank)) return;
  int left = ms->o.x + hb->left - flank.right, right = ms->o.x + hb->right - flank.left;
  if (px <= left + SIDE_SLACK) p->x = left;
  else if (px >= right - SIDE_SLACK) p->x = right;
  else return;
  int d = terrain_scan(PROBE_FLOOR, py + 9, (int)p->x, p->layer, 8).d;
  if (d < 0) p->y += d;
  d = terrain_scan(PROBE_FLOOR, floor_of(p->y), (int)p->x, p->layer, -8).d;
  if (d < 0) p->y += d;
  // off whatever he stood on, not only this
  p->pushing = 0; p->onObject = NULL;
}

/** sub_808B7A0: true when it throws him */
static int spring_collide(MovingSpring *ms, Player *p) {
  if (p->dead) return 0;
  int thrown = 0;
  if (p->onObject == &ms->o) {
    p->air = 1; p->pushing = 0; player_end_attack(p);
    p->state = PS_SPRING; p->animRestart = 1;
    p->ysp = -THROW_SPEED;
    play_song(SE_SPRING);
    thrown = 1;
  }
  double x = p->x;
  side(ms, p);
  int r = collide_platform(&ms->o, ms->o.x, ms->y, object_box(&ms->o.sprite, 0), p);
  if (p->state == PS_SPRING) p->x = x;
  if (!(r & COLLIDE_PUSHING) && p->pushing) { p->pushing = 0; player_end_attack(p); p->state = PS_WALK; }
  return thrown;
}

static int moving_spring_run(ActTask *t) {
  MovingSpring *ms = (MovingSpring *)t->data;
  const Entity *en = &ms->o.slot->e;
  int swing = ((int32_t)((uint32_t)ms->reach * (uint32_t)(int32_t)SINE[(4 * ((act_stage_time() + ms->phase) & 0xFF)) & 0x3FF]) >> 14) >> 8;
  ms->o.x = en->x + (ms->across ? swing : 0);
  ms->y = en->y + (ms->across ? 0 : swing);
  Player *p = &act.player;
  if (!ms->launching) {
    if (spring_collide(ms, p)) { ms->n = 0; ms->launching = 1; sprite_start(&ms->o.sprite, ms->launch); }
  } else {
    // a throw while it plays keeps the animation going and counts its frames again
    if (spring_collide(ms, p)) ms->n = 0;
    if (++ms->n > LAUNCH_FRAMES) { ms->launching = 0; sprite_start(&ms->o.sprite, ms->idle); }
  }
  if (off_display(en->x, en->y) && off_cam(ms->o.x, ms->y)) return 0;
  sprite_step(&ms->o.sprite);
  object_draw(&ms->o.sprite, ms->o.x, ms->y);
  return 1;
}

/** CreateEntity_MovingSpring */
ActTask *moving_spring_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  MovingSpring *ms = OBJECT_NEW(MovingSpring);
  if (!ms) return NULL;
  ms->across = en->d[2] > en->d[3];
  ms->phase = s8(ms->across ? en->d[0] : en->d[1]) < 0 ? SWING_HALF : 0;
  ms->reach = (ms->across ? en->d[2] : en->d[3]) << 11;
  int zone = act.stage.zone;
  const __typeof__(LOOK_DEFAULT) *look = zone == ZONE_ICE_MOUNTAIN ? &LOOK_ICE_MOUNTAIN
    : zone == ZONE_6 || act.stage.level == CHAO_HUNT_D ? &LOOK_ZONE_6 : &LOOK_DEFAULT;
  ms->idle = look->idle; ms->launch = look->launch;
  ms->o.slot = slot;
  ms->o.x = en->x;
  ms->y = en->y;
  object_sprite(&ms->o.sprite, look->anim, look->idle < look->launch ? look->idle : look->launch,
                look->idle > look->launch ? look->idle : look->launch, ORDER_SPRING, PRIORITY_FRONT, 0, 0);
  sprite_start(&ms->o.sprite, look->idle);
  sprite_step(&ms->o.sprite);
  return object_task(&ms->o, moving_spring_run, PRIORITY_OBJECTS);
}
