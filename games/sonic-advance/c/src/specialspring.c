// The special spring, kind 102. Translated from the JavaScript version's engine/specialspring.js (the original's
// special_spring.c): the spring that sends Sonic up out of the act into the special stage. Its d bytes aren't read. Landing on
// it throws him up like a spring; unless the special springs are off, it then holds him and the camera while he rises out of
// the screen, and the act stops for the special stage. Coming back from one turns them off (the player's plainSprings, the
// original's gPlayer.unk99[1]) until the act starts over. They are plain springs too when the game has no special stage to go
// to. (Amy's hammer and the CPU partner landing on it are not here: only Sonic is.)

#include "objects.h"

// What the spring hands to the act (the act_* hooks) is in act.h; act.c writes them.

enum { SPECIAL_SPRING = 102 };
enum {
  ANIM_SPECIAL_SPRING = 572, VARIANT_LAUNCH = 0, VARIANT_WAIT = 1,
  ORDER_SPRING = 18, PRIORITY_FRONT = 2,
  SE_SPRING = 170,
  LEAVE_ABOVE = 128,   // how far above the top of the screen his centre is when the act ends
};
#define LAUNCH_SPEED 7.5   // the throw, and how fast he rises out of the screen (Q(7.5))

typedef struct { Object o; int launching, heldX, heldY; } SpecialSpring;   // held: the camera when Sonic landed

static int plain(const Player *p) { return p->plainSprings || !act_special_stages(); }

static const Hitbox *box_of(const SpecialSpring *sp) { return object_box(&sp->o.sprite, 0); }

// Task_SpecialSpringMain: Sonic, if alive, landing on its top (Coll_Player_Platform's COLL_FLAG_8) is thrown up at 7.5 px a frame
// in the spring's rising state, uncurled, with the spring's song. It doesn't start his animation over as the other springs do.
// With the special springs on, it also holds him and stops the course clock. The launch's first frame shows on the same frame.
static int wait(SpecialSpring *sp) {
  Sprite *s = &sp->o.sprite;
  const Entity *e = &sp->o.slot->e;
  Player *p = &act.player;
  int landed = !p->dead && (collide_platform(&sp->o, e->x, e->y, box_of(sp), p) & COLLIDE_LANDED) != 0;
  // or Amy's hammer, half as fast again (Coll_AmyHammer_Spring)
  int hammered = !p->dead && !landed && player_hammer_hits(p, e->x, e->y, box_of(sp));
  if (landed || hammered) {
    player_land(p);
    p->onObject = NULL; p->air = 1;
    p->ysp = hammered ? player_hammer_speed(-LAUNCH_SPEED) : -LAUNCH_SPEED;
    p->state = PS_SPRING_RISE;
    sp->heldX = cam_x(); sp->heldY = cam_y();
    if (!plain(p)) { p->carried = 1; act.clockStopped = 1; }
    sprite_start(s, VARIANT_LAUNCH);
    player_stand_up(p);
    play_song(SE_SPRING);
    sp->launching = 1;
  }
  if (off_cam(e->x, e->y)) return 0;
  sprite_step(s);
  object_draw(s, e->x, e->y);
  return 1;
}

// Task_TransitionSpStage. Sonic isn't tested while it runs. With the special springs off it plays the launch and goes back to
// waiting as it ends, its first frame showing on the same frame. With them on it puts the camera back where it was when he
// landed, after the camera's task has moved it and drawn the layers there, and moves him up 7.5 px a frame, until his centre is
// more than 128 px above the top of the screen: then every task ends and the special stage starts, the spring being where he
// comes back to (the original makes it his checkpoint and keeps the one he had). The spring is still drawn where the moved camera
// put it, as it was placed before, and what is drawn after it this frame where the camera is held.
static int launch(SpecialSpring *sp) {
  Sprite *s = &sp->o.sprite;
  const Entity *e = &sp->o.slot->e;
  Player *p = &act.player;
  if (off_cam(e->x, e->y)) return 0;
  if (plain(p)) {
    if (sprite_step(s)) { sp->launching = 0; sprite_start(s, VARIANT_WAIT); sprite_step(s); }
    object_draw(s, e->x, e->y);
    return 1;
  }
  int dx = cam_x() - sp->heldX, dy = cam_y() - sp->heldY;
  act_hold_camera(sp->heldX, sp->heldY);
  p->y -= LAUNCH_SPEED;
  if ((int)__builtin_floor(p->y) - sp->heldY < -LEAVE_ABOVE) {
    // the spring is where he comes back to; every task ends with the act
    act_special_stage(e->x, e->y);
    return 0;
  }
  sprite_step(s);
  object_draw(s, e->x - dx, e->y - dy);
  return 1;
}

static int special_spring_run(ActTask *t) {
  SpecialSpring *sp = (SpecialSpring *)t->data;
  return sp->launching ? launch(sp) : wait(sp);
}

ActTask *special_spring_spawn(Slot *slot) {
  SpecialSpring *sp = OBJECT_NEW(SpecialSpring);
  if (!sp) return NULL;
  const Entity *en = &slot->e;
  sp->o.slot = slot;
  sp->o.x = en->x;
  object_sprite(&sp->o.sprite, ANIM_SPECIAL_SPRING, VARIANT_LAUNCH, VARIANT_WAIT, ORDER_SPRING, PRIORITY_FRONT, 0, 0);
  sp->o.sprite.variant = VARIANT_WAIT;
  sprite_step(&sp->o.sprite);
  return object_task(&sp->o, special_spring_run, PRIORITY_OBJECTS);
}
