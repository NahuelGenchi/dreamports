// Casino Paradise's red flags, kind 42. Translated from the JavaScript version's engine/redflags.js (the original's
// red_flag_and_pole.c): a flag on a pole that Sonic swings round when he runs into it on the ground facing the way it points (to
// the right, or mirrored to the left when d1 is set) at more than 3 px a frame, or 5.25 px rolling. It puts him 15 px behind its
// pole, holds him there for 7 frames, carries him on 10 px and then 7.5 px a frame for 6 frames, and lets him go running that way
// at 10.5 px a frame or more. It takes him again once its animation is over.

#include "objects.h"

enum { RED_FLAG = 42 };
enum {
  ANIM_RED_FLAG = 469, VARIANT_REST = 0, VARIANT_TUG = 1,
  ORDER_FLAG = 18, PRIORITY_FRONT = 2,
  SE_POLE = 175,
  BEHIND_POLE = 15,          // how far behind the pole it puts him
  HOLD_FRAMES = 7,           // frames it holds him still
  LAST_FRAME = 13,           // the frame it lets him go
  FIRST_PULL = 7,            // the frame of the 10 px pull, and the 7.5 px ones follow
};
#define RUN_SPEED 3.0     // the least speed on foot that it catches him at
#define ROLL_SPEED 5.25   // and rolling
#define THROW_SPEED 10.5  // the speed it lets him go at, at the least
#define PULL_FIRST 10.0
#define PULL_NEXT 7.5

enum { PHASE_WAITING, PHASE_HOLDING, PHASE_WAVING };   // Task_RedFlag, Task_8077760 and Task_8077918

typedef struct { Object o; int dir, phase, t, state; } RedFlag;

// sub_80780B4, and sub_8077FA4 mirrored: Sonic's body on its box, on the ground, fast enough its way
static int catches(RedFlag *f, Player *p) {
  const Entity *e = &f->o.slot->e;
  const Hitbox *hb = object_box(&f->o.sprite, 0);
  Hitbox body = collide_body(p);
  if (!hb || p->air || !collide_overlap(e->x, e->y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) return 0;
  if (p->gsp * f->dir <= (p->curled ? ROLL_SPEED : RUN_SPEED) || p->facing != f->dir) return 0;
  // Player_TransitionCancelFlyingAndBoost
  player_end_attack(p); p->pushing = 0;
  p->x = e->x - BEHIND_POLE * f->dir;
  p->carried = 1;
  f->state = p->state; p->state = PS_FLAG_SWING;
  return 1;
}

// his charState back, uncurled though his size stays a ball's if he was rolling, and at least the throw's speed
static void release(RedFlag *f, Player *p) {
  p->state = f->state == PS_BRAKE ? PS_WALK : f->state;
  p->curled = 0;
  if (p->gsp * f->dir < THROW_SPEED) { p->gsp = THROW_SPEED * f->dir; p->xsp = THROW_SPEED * f->dir; }
  p->carried = 0;
}

static int flag_run(ActTask *t) {
  RedFlag *f = (RedFlag *)t->data;
  Sprite *s = &f->o.sprite;
  const Entity *e = &f->o.slot->e;
  Player *p = &act.player;
  if (f->phase == PHASE_WAITING) {
    // only while Sonic is alive
    if (!p->dead && catches(f, p)) {
      play_song(SE_POLE);
      sprite_start(s, VARIANT_TUG);
      f->phase = PHASE_HOLDING; f->t = 0;
    }
    if (off_cam(e->x, e->y)) return 0;
    sprite_step(s);
  } else {
    // leaving while it holds him would leave him held
    if (off_cam(e->x, e->y)) return 0;
    if (f->phase == PHASE_HOLDING) {
      // Sonic dying lets go of him
      if (p->dead) p->carried = 0;
      else {
        if (f->t >= HOLD_FRAMES) p->x += (f->t == FIRST_PULL ? PULL_FIRST : PULL_NEXT) * f->dir;
        if (++f->t > LAST_FRAME) { release(f, p); f->phase = PHASE_WAVING; }
      }
      sprite_step(s);
    } else if (sprite_step(s)) {
      // an animation that has ended reports it again; back to rest, its first frame showing from the next one
      sprite_start(s, VARIANT_REST);
      f->phase = PHASE_WAITING;
    }
  }
  object_draw(s, e->x, e->y);
  return 1;
}

ActTask *red_flag_spawn(Slot *slot) {
  RedFlag *f = OBJECT_NEW(RedFlag);
  if (!f) return NULL;
  const Entity *en = &slot->e;
  f->o.slot = slot;
  f->o.x = en->x;
  f->dir = en->d[1] ? -1 : 1;   // the way it points
  f->phase = PHASE_WAITING;
  object_sprite(&f->o.sprite, ANIM_RED_FLAG, VARIANT_REST, VARIANT_TUG, ORDER_FLAG, PRIORITY_FRONT, f->dir < 0, 0);
  sprite_step(&f->o.sprite);
  return object_task(&f->o, flag_run, PRIORITY_OBJECTS);
}
