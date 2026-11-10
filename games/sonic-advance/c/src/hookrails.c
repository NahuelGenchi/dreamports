// The hook rails (kind 75). Translated from the JavaScript version's engine/hookrails.js (the original's hook_rail.c, with
// Task_HookRail_Type0_2 and Type1_2 from their asm): a hook hanging from a rail drawn into the act. When Sonic's body touches
// its box it takes him, standing him up, and he hangs from it while it slides along the rail, picking up speed, with its
// sound playing. d0 picks the rail: 1 runs 480 px down to the right at half a pixel down for each across and lets him go at
// its end, walking at the hook's speed 10 px above where he hung; 2 the same to the left, 2 px above; 0 first climbs to the
// left, slowing, until it is 244 px from where it took him, then drops onto a lower rail and comes back to the right,
// letting him go as soon as it moves right at more than 2 px a frame. Without him (he died on it) it carries on alone.
//
// The original keeps the hook where it let him go only as a point it draws (480 px across and 240 down from where it hung
// for 1, 480 back for 2, and straight down 240 for 0), until that point leaves the camera's range; then the rail can take
// him again. It moves the hook by the speed alone, not his position, so the hook it draws is where he is only while it
// holds him. The decompilation's C goes to Task_HookRail_Shared0 when rail 0 lets him go, but its asm goes to Shared1, as
// here. It also sets PLAYER_ITEM_EFFECT__TELEPORT while it holds him, which nothing in this act reads.

#include "objects.h"

enum {
  HOOK_RAIL = 75,
  ANIM_HOOK_RAIL = 504, ANIM_HOOK_RAIL_ICE = 569,   // SA1_ANIM_HOOK_RAIL_2, and _3 in Ice Mountain (ZONE_4)
  ORDER_HOOK = 18, PRIORITY_FRONT = 2,
  SE_HOOK_RAIL = 180,
  HANG_X = 6, HANG_Y = 36, HANG_Y_LEFT = 38,   // HOOK_PLAYER_OFFSET_X, _Y and _2_Y
  DRAW_X = 5, DRAW_X_LEFT = 4,                 // HOOK_PLAYER_OFFSET_T1_2_X and _T2_0_X: the hook from his centre
  LENGTH = 480,                                // HOOK_RAIL_TYPES_1_2_LENGTH
  DONE_DOWN = 240,                             // where the original draws a hook that has let him go
  TURN = 244, LOWER = 276,                     // rail 0 turns 244 px left of where it took him, onto a rail this far down
  ACCEL = 16, ACCEL_LOWER = 20, CLIMB = 9, MAX_CLIMB = -6 * 256,   // in 1/256 px
  RISE = 10, RISE_LEFT = 2,                    // how far up he is let go
};
enum { RAIL_LEFT_THEN_RIGHT, RAIL_RIGHT, RAIL_LEFT };
enum { WAITING, HOLDING, DONE };

typedef struct {
  Object o;
  int rail, phase;
  int acc, vel, startX;   // qAcceleration, qVelocity and qStartX, in 1/256 px
  int lower;              // hitLowerRail
  int doneX, doneY;       // the point Shared0, Shared1 and Type2_1 draw it at
} HookRail;

static int q8(double v) { return (int)__builtin_floor(v * 256 + 0.5); }
static int I(int v) { return v >> 8; }
static int fl(double v) { return (int)__builtin_floor(v); }

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

static void release(HookRail *h, Player *p) { if (p->onObject == &h->o) p->onObject = NULL; }

// Coll_Player_Entity_Intersection, while he stands on nothing or on it
static int touches(HookRail *h, const Player *p, int wx, int wy) {
  const Hitbox *box = object_box(&h->o.sprite, 0);
  if (p->dead || (p->onObject && p->onObject != &h->o) || !box) return 0;
  Hitbox body = collide_body(p);
  return collide_overlap(wx, wy, box, fl(p->x), fl(p->y), &body);
}

// moveState = MOVESTATE_IA_OVERRIDE (with MOVESTATE_FACING_LEFT for rail 2), then MOVESTATE_STOOD_ON_OBJ on it
static void take(HookRail *h, Player *p, int x, int y, int facing) {
  p->x = x; p->y = y;
  p->carried = 1; p->air = 0; p->facing = facing; p->airLock = 0; p->pushing = 0; p->ignoreInput = 0;
  p->rotation = 0; p->ysp = 0; p->state = PS_HOOK;
  player_stand_up(p);   // PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14)
  p->onObject = &h->o;
}

// at the rail's end: he walks off at the hook's speed
static void let_go(HookRail *h, Player *p, int gsp, int rise) {
  stop_song(SE_HOOK_RAIL);
  cancel(p);
  p->carried = 0; p->state = PS_WALK;
  player_stand_up(p);
  p->gsp = gsp / 256.0; p->y -= rise;
  release(h, p);
}

static void done(HookRail *h, int x, int y) { h->phase = DONE; h->doneX = x; h->doneY = y; }

// he lost the hook's state to something else this frame: it puts him back
static void hold(Player *p) {
  if (p->state != PS_HOOK) { cancel(p); p->state = PS_HOOK; }
  p->ysp = 0;
}

// Task_HookRail_Type1_2 and Type2_0: down the rail to the right (dir 1) or the left (-1); the point the hook is at
static void slide(HookRail *h, Player *p, int wx, int wy, int dir, int *x, int *y) {
  if (!p->dead) {
    hold(p);
    if (I((q8(p->x) - h->startX) * dir) > LENGTH) {
      if (dir > 0) { let_go(h, p, h->acc, RISE); p->rotation = 0; done(h, wx + LENGTH, wy + DONE_DOWN); }
      else { p->facing = -1; let_go(h, p, -h->acc, RISE_LEFT); done(h, wx - LENGTH, wy + DONE_DOWN); }
    } else {
      h->acc += ACCEL; h->vel += h->acc;
      p->x = (dir > 0 ? (wx << 8) - (HANG_X << 8) + h->vel : ((wx + HANG_X) << 8) - h->vel) / 256.0;
      p->y = ((wy << 8) + ((dir > 0 ? HANG_Y : HANG_Y_LEFT) << 8) + (h->vel >> 1)) / 256.0;
      cancel(p); p->state = PS_HOOK;
    }
    *x = fl(p->x) + (dir > 0 ? DRAW_X : -DRAW_X_LEFT);
    *y = fl(p->y) - HANG_Y;
    return;
  }
  release(h, p);
  h->acc += ACCEL; h->vel += h->acc;
  *x = wx + I(h->vel) * dir;
  *y = wy + (I(h->vel) >> 1);
  // the original tests the left rail's end by where he would be, and the right's by the speed against Q(1.875) (480)
  if (dir > 0 ? I(h->vel) > LENGTH : I(h->startX - ((wx << 8) - h->vel)) > LENGTH) {
    stop_song(SE_HOOK_RAIL);
    release(h, p);
    done(h, wx + LENGTH * dir, wy + DONE_DOWN);
  }
}

// the climb to the left, slowing down to at most 6 px a frame
static void climb_step(HookRail *h) {
  h->acc -= CLIMB;
  if (h->acc < MAX_CLIMB) h->acc = MAX_CLIMB;
  h->vel += h->acc;
}

// Task_HookRail_Type0_2: up to the left, then back along the lower rail
static void climb(HookRail *h, Player *p, int wx, int wy, int *x, int *y) {
  if (!p->dead) {
    hold(p);
    if (h->lower) {
      h->acc += ACCEL_LOWER; h->vel += h->acc;
      p->x = ((wx << 8) - (HANG_X << 8) + h->vel) / 256.0;
      p->y = (((wy + LOWER) << 8) + (h->vel >> 1)) / 256.0;
      if (I(h->vel) > 2) { let_go(h, p, h->acc, RISE); done(h, wx, wy + DONE_DOWN); }
    } else {
      climb_step(h);
      p->x = ((wx << 8) - (HANG_X << 8) + h->vel) / 256.0;
      p->y = (((wy + HANG_Y_LEFT) << 8) - (h->vel >> 1)) / 256.0;
      if (I(q8(p->x) - h->startX) < -TURN) h->lower = 1;
    }
    *x = fl(p->x) + DRAW_X;
    *y = fl(p->y) - HANG_Y;
    return;
  }
  if (h->lower) {
    h->acc += ACCEL_LOWER; h->vel += h->acc;
    *y = wy + (I(h->vel) >> 1) + DONE_DOWN;
    if (I(h->vel) > 2) { stop_song(SE_HOOK_RAIL); release(h, p); done(h, wx, wy + DONE_DOWN); }
  } else {
    climb_step(h);
    if (I((wx << 8) + h->vel - h->startX) < -TURN) h->lower = 1;
    *y = wy - I(h->vel >> 1);
  }
  *x = wx + I(h->vel);
}

static int hook_rail_run(ActTask *t) {
  HookRail *h = (HookRail *)t->data;
  const Entity *en = &h->o.slot->e;
  Player *p = &act.player;
  int wx = en->x, wy = en->y, x = wx, y = wy;
  if (h->phase == WAITING) {
    // Task_HookRail_Type0, Type1 and Type2
    if (touches(h, p, wx, wy)) {
      cancel(p);
      int gsp = q8(p->gsp);
      if (gsp < 0) gsp = -gsp;
      if (h->rail == RAIL_RIGHT) { take(h, p, wx - HANG_X, wy + HANG_Y, 1); h->acc = gsp < 256 ? 256 : gsp; }
      else if (h->rail == RAIL_LEFT) { take(h, p, wx, wy + HANG_Y_LEFT, -1); h->acc = gsp; }
      else { take(h, p, wx, wy + HANG_Y, 1); h->acc = -gsp; }
      h->startX = q8(p->x);
      play_song(SE_HOOK_RAIL);
      h->phase = HOLDING;
    }
  } else if (h->phase == HOLDING) {
    if (h->rail == RAIL_LEFT_THEN_RIGHT) climb(h, p, wx, wy, &x, &y);
    else slide(h, p, wx, wy, h->rail == RAIL_RIGHT ? 1 : -1, &x, &y);
  } else { x = h->doneX; y = h->doneY; }
  if (off_cam(x, y)) { release(h, p); return 0; }
  object_draw(&h->o.sprite, x, y);
  return 1;
}

// CreateEntity_HookRail: its box comes from the one animation step it takes as it is made
ActTask *hook_rail_spawn(Slot *slot) {
  HookRail *h = OBJECT_NEW(HookRail);
  if (!h) return NULL;
  int d0 = slot->e.d[0];
  h->o.slot = slot;
  h->o.x = slot->e.x;
  h->rail = d0 == 1 ? RAIL_RIGHT : d0 == 2 ? RAIL_LEFT : RAIL_LEFT_THEN_RIGHT;
  // ALLOC_TILES_VARIANT(anim, 0); Ice Mountain's takes room for its animation's whole size (ALLOC_TILES), which waits for
  // that act: variant 0's tiles here
  if (act.stage.zone == ZONE_ICE_MOUNTAIN) object_sprite(&h->o.sprite, ANIM_HOOK_RAIL_ICE, 0, 0, ORDER_HOOK, PRIORITY_FRONT, 0, 0);
  else object_sprite(&h->o.sprite, ANIM_HOOK_RAIL, 0, 0, ORDER_HOOK, PRIORITY_FRONT, 0, 0);
  sprite_step(&h->o.sprite);
  return object_task(&h->o, hook_rail_run, PRIORITY_OBJECTS);
}
