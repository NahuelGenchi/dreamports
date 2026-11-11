// Angel Island's lifts (kind 88). Translated from the JavaScript version's engine/lifts.js (the original's
// crane_claw_and_lift.c, its Lift half: CreateEntity_Lift, Task_LiftMain, Task_Lift2, Task_Lift3 and Task_Lift4): a handle on a
// chain. Whenever Sonic's body touches the handle it catches him, at any speed, on the ground or in the air: he hangs from it,
// 3 px left of it facing right or 8 px right of it facing left, while it climbs 128 px in 64 frames, and stays up there until
// a jump press lets him go, thrown up at 4 px a frame. He keeps whether he was in the air: caught on the ground, his ground
// movement takes over again on that frame and wipes the throw, so he just drops. A second later (60 frames) the handle slides
// back down in 30 and can catch him again. It leaves once its spawn point is out of the display's range and the handle out of
// the camera's, even while it holds him, who then hangs there for good. Its data bytes aren't used.

#include "objects.h"

enum {
  ANIM_LIFT = 545, VARIANT_CHAIN = 0, VARIANT_HANDLE = 1,
  ORDER_HANDLE = 15, ORDER_CHAIN = 17, PRIORITY_FRONT = 2,
  RISE = 64, HEIGHT = 128, WAIT = 60, DROP = 30, THROW = 4,
  HANG_LEFT = 3, HANG_RIGHT = 8, HANG_BELOW = 26,
  SE_LIFT = 181,
};
enum { WAITING, RISING, HOLDING, DROPPING };

// how far above the handle the chain's links are drawn: 32 px apart, but 16 while it holds Sonic at the top
static const int LINKS[] = { 16, 48, 80, 112 }, LINKS_TOP[] = { 16, 32, 48, 64 };

typedef struct {
  Object o;            // the handle
  Sprite chain;
  int phase, t, wait;
} Lift;

/** Coll_Player_Entity_Intersection: his body's box on the handle's, which catches him */
static int catches(Lift *l, int x, int y, Player *p) {
  const Hitbox *box = object_box(&l->o.sprite, 0);
  Hitbox body = collide_body(p);
  if (p->dead || !box || !collide_overlap(x, y, box, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) return 0;
  p->carried = 1;
  p->xsp = p->gsp = p->ysp = 0;
  player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
  p->state = PS_HOOK;                     // hanging (charState 38)
  return 1;
}

static void show(Lift *l, int x, int y, int up, const int *links) {
  object_draw(&l->o.sprite, x, y - up);
  for (int i = 0; i < 4; i++) object_draw(&l->chain, x, y - up - links[i]);
}

static int gone(int x, int y, int up) { return off_display(x, y) && off_cam(x, y - up); }

static int lift_run(ActTask *t) {
  Lift *l = (Lift *)t->data;
  const Entity *en = &l->o.slot->e;
  int x = en->x, y = en->y;
  Player *p = &act.player;
  switch (l->phase) {
  case WAITING:   // Task_LiftMain
    if (catches(l, x, y, p)) { play_song(SE_LIFT); l->phase = RISING; l->t = 0; }
    if (gone(x, y, 0)) return 0;
    show(l, x, y, 0, LINKS);
    return 1;
  case RISING: {   // Task_Lift2
    int up = HEIGHT - (RISE - l->t) * HEIGHT / RISE;
    if (!p->dead) { p->x = p->facing > 0 ? x - HANG_LEFT : x + HANG_RIGHT; p->y = y - up + HANG_BELOW; }
    else p->carried = 0;
    if (++l->t > RISE) { l->t = 0; stop_song(SE_LIFT); l->phase = HOLDING; }
    if (gone(x, y, up)) return 0;
    show(l, x, y, up, LINKS);
    return 1;
  }
  case HOLDING:   // Task_Lift3
    if (gone(x, y, HEIGHT)) return 0;
    if (p->dead) { p->carried = 0; l->t = 0; l->wait = WAIT; l->phase = DROPPING; }
    else if (p->jumpPressed) {
      p->carried = 0; p->airLock = 0;
      p->xsp = p->gsp = 0; p->ysp = -THROW;
      player_end_attack(p); p->pushing = 0;
      l->t = 0; l->wait = WAIT; l->phase = DROPPING;
      p->state = PS_SPIN;
    }
    show(l, x, y, HEIGHT, LINKS_TOP);
    return 1;
  default: {   // Task_Lift4
    int up = (DROP - l->t) * HEIGHT / DROP;
    if (l->wait > 0) l->wait--;
    else if (++l->t > DROP) { l->t = 0; l->phase = WAITING; }
    if (gone(x, y, up)) return 0;
    show(l, x, y, up, LINKS);
    return 1;
  }
  }
}

/** TaskDestructor_Lift */
static void lift_end(ActTask *t) {
  object_sprite_free(&((Lift *)t->data)->chain);
  object_end(t);
}

/** CreateEntity_Lift: each sprite shows the first frame of its variant, stepped once as it is made */
ActTask *lift_spawn(Slot *slot) {
  Lift *l = OBJECT_NEW(Lift);
  if (!l) return NULL;
  l->o.slot = slot;
  l->o.x = slot->e.x;
  object_sprite(&l->o.sprite, ANIM_LIFT, VARIANT_HANDLE, VARIANT_HANDLE, ORDER_HANDLE, PRIORITY_FRONT, 0, 0);
  object_sprite(&l->chain, ANIM_LIFT, VARIANT_CHAIN, VARIANT_CHAIN, ORDER_CHAIN, PRIORITY_FRONT, 0, 0);
  sprite_step(&l->o.sprite);
  sprite_step(&l->chain);
  ActTask *t = object_task(&l->o, lift_run, PRIORITY_OBJECTS);
  if (!t) { object_sprite_free(&l->chain); return NULL; }
  t->end = lift_end;
  return t;
}
