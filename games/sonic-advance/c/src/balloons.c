// Casino Paradise's party balloons, kind 59. Translated from the JavaScript version's engine/balloons.js (the original's
// party_balloon.c): touching one pops it and throws Sonic up at 6 px a frame, rising as off a spring. Its burst shows for 33
// frames; then it goes, to come back when the camera next uncovers its place. d0 picks its colour.

#include "objects.h"

enum {
  ANIM_BLUE = 479, ANIM_RED = 480, ANIM_YELLOW = 481, COLOURS = 3,
  VARIANT_WHOLE = 0, VARIANT_POP = 1,
  ORDER_BALLOON = 18, PRIORITY_FRONT = 2,
  BLUE_TILES = (24 / 8) * (48 / 8),
  SE_BALLOON_POP = 189,
  BURST_FRAMES = 33,   // frames from the pop to the balloon going (unk40)
};
#define LIFT_SPEED 6.0   // the speed up it throws him at

typedef struct { Object o; int burst; } Balloon;

// what the pop does to the player who touches it
static void throw_up(Player *p) {
  player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
  p->onObject = NULL; p->air = 1; p->curled = 0; p->airLock = 0;
  player_stand_up(p);
  p->ysp = -LIFT_SPEED;
  p->state = PS_SPRING_RISE;
}

static int balloon_run(ActTask *t) {
  Balloon *b = (Balloon *)t->data;
  Sprite *s = &b->o.sprite;
  const Entity *e = &b->o.slot->e;
  Player *p = &act.player;
  if (off_cam(e->x, e->y)) return 0;
  if (b->burst) {
    if (--b->burst == 0) return 0;
  } else {
    // Coll_Player_Entity_Intersection: a body's box against the box its last frame set
    const Hitbox *hb = object_box(s, 0);
    Hitbox body = collide_body(p);
    if (!p->dead && hb && collide_overlap(e->x, e->y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body) && !p->carried) {
      throw_up(p);
      b->burst = BURST_FRAMES;
      sprite_start(s, VARIANT_POP);
      play_song(SE_BALLOON_POP);
    }
  }
  sprite_step(s);
  object_draw(s, e->x, e->y);
  return 1;
}

ActTask *balloon_spawn(Slot *slot) {
  Balloon *b = OBJECT_NEW(Balloon);
  if (!b) return NULL;
  const Entity *en = &slot->e;
  int colour = en->d[0] < COLOURS ? en->d[0] : 0;
  b->o.slot = slot;
  b->o.x = en->x;
  // room for the blue balloon's whole size whatever the colour (ALLOC_TILES(SA1_ANIM_BALLOON_BLUE), 24 by 48 pixels),
  // which is less than its pop takes, so the pop spills into the tiles after it as in the original
  object_sprite_at(&b->o.sprite, vram_malloc(BLUE_TILES), ANIM_BLUE + colour, VARIANT_WHOLE, ORDER_BALLOON, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);
  return object_task(&b->o, balloon_run, PRIORITY_OBJECTS);
}
