// Casino Paradise's carousels (kind 74). Translated from the JavaScript version's engine/carousel.js (the original's carousel.c):
// a round top on a pole that Sonic can stand on. Within 8 px of its pole, from 48 px above to 12 px below its point, it takes him:
// he holds on, his speed set to 7.5 the way he was going, while it spins faster each frame from as fast as he came and sinks 481 px
// down its shaft with him. At the bottom it lets him go after 300 frames, or as soon as left or right is held, curled up and
// flying off at what its spin has reached, the way he holds or else the way he came. It stays at the bottom until it is out of
// range. While Knuckles climbs it does nothing to him, and Knuckles is not in this game's act, so that is not here.
//
// The original keeps a bit for each of two players; this act has one, so the part for the player it hasn't got (its top as a
// platform going down past them, taking them at its point on the way down) never runs and is not here.

#include "objects.h"
#include "terrain.h"

enum {
  CAROUSEL = 74,
  ANIM_CAROUSEL = 487, ANIM_CAROUSEL_POLE = 583, ORDER_CAROUSEL = 18, PRIORITY_FRONT = 2,
  SE_CAROUSEL_A = 209, SE_CAROUSEL_B = 210, SE_CAROUSEL_C = 211,   // turning slowly, faster and fast
  BOTTOM = 0x3C2A58,                   // how far it sinks, 1/8192 px (481 px)
  GRAB_OUT = 8, GRAB_ABOVE = 48, GRAB_BELOW = 12,   // where Sonic is taken: within 8 px of the pole, from 48 px above to 12 below
  SPEED_MASK = 0xFFFF, SPEED_STEP = 0x40, SPEED_MAX = 0x8000, ANIM_SPEED_MAX = 16,
  RELEASE_SPEED = 0x7D0,               // what the speed is taken from when he is let go
  HELD_MAX = 300,                      // frames at the bottom before it lets him go
  POLE_DROP = 2,                       // while it sinks the top is 2 px lower than its place, and the pole 2 px lower again
  SLOW_SPEED = 0x3200, MEDIUM_SPEED = 0x4B00, SLOW_EVERY = 25, MEDIUM_EVERY = 16, FAST_EVERY = 8,   // the sounds
  SPRITE_OFFSET_Y = 14,                // from his centre to the ground standing
  OAM_ORDER_PLAYER = 16,               // in front of objects again, after the ride's animation put him behind its pole
};
static const double HOLD_GROUND_SPEED = 7.5;
enum { CAROUSEL_IDLE, CAROUSEL_RIDING, CAROUSEL_BOTTOM };

typedef struct {
  Object o;            // the top
  Sprite pole;
  int phase;           // waiting (Task_CarouselIdle), turning with Sonic (Task_RidingCarousel) or at the bottom (Task_ExitCarousel)
  int speed, held, right;   // unk6E, unk76 and unk78
  uint32_t depth;      // unk70, in 1/8192 px
  int t;               // unk74
  int riding;          // unk79
} Carousel;

static int floor_of(double v) { return (int)__builtin_floor(v); }
// Math.round: halves go up
static int js_round(double v) { return (int)__builtin_floor(v + 0.5); }

// whether Sonic's centre is where it takes him
static int in_reach(const Carousel *c, const Player *p) {
  const Entity *en = &c->o.slot->e;
  int px = floor_of(p->x), py = floor_of(p->y);
  return px >= en->x - GRAB_OUT && px <= en->x + GRAB_OUT && py >= en->y - GRAB_ABOVE && py <= en->y + GRAB_BELOW;
}

static void draw_both(Carousel *c, int y, int poleY) {
  object_draw(&c->o.sprite, c->o.slot->e.x, y);
  object_draw(&c->pole, c->o.slot->e.x, poleY);
}

static int carousel_run(ActTask *t) {
  Carousel *c = (Carousel *)t->data;
  const Entity *en = &c->o.slot->e;
  Sprite *top = &c->o.sprite;
  const Hitbox *hb = object_box(top, 0);
  Player *p = &act.player;

  if (c->phase == CAROUSEL_IDLE) {
    if (off_display(en->x, en->y) && off_cam(en->x, en->y)) return 0;
    if (!p->dead) {
      collide_platform_top(&c->o, en->x, en->y, hb, p);
      if (in_reach(c, p)) {
        c->riding = 1;
        int xsp = js_round(p->xsp * 256);
        c->speed = ((xsp < 0 ? -xsp : xsp) << 2) & SPEED_MASK;
        c->depth = 0; c->held = 0; c->t = 0;
        p->xsp = 0;
        c->right = p->gsp > 0;
        p->gsp = c->right ? HOLD_GROUND_SPEED : -HOLD_GROUND_SPEED;
        player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
        p->state = PS_CAROUSEL_RIDE; p->carried = 1;
        play_song(SE_CAROUSEL_A);
        c->phase = CAROUSEL_RIDING;
      }
    }
    draw_both(c, en->y, en->y);
    return 1;
  }

  if (c->phase == CAROUSEL_BOTTOM) {
    int y = en->y + (int)(c->depth >> 13);
    if (!p->dead) collide_platform_top(&c->o, en->x, y, hb, p);
    if (off_display(en->x, en->y) && off_cam(en->x, y)) return 0;
    draw_both(c, y, y);
    return 1;
  }

  int y = en->y + (int)(c->depth >> 13) + POLE_DROP;
  int at = en->y + (int)(c->depth >> 13);
  if (c->riding && !p->dead) { p->x = en->x; p->y = at; }
  if (c->depth >= BOTTOM) {
    // what it lets him go at
    if (!p->dead && c->riding) p->xsp = p->gsp = (((c->speed >> 2) - RELEASE_SPEED) * 2 / 3) / 256.0;
  } else c->speed += SPEED_STEP;
  if (c->speed > SPEED_MAX) c->speed = SPEED_MAX;
  int anim = c->speed * 35 / 0xA000;
  top->animSpeed = (uint8_t)(anim < ANIM_SPEED_MAX ? anim : ANIM_SPEED_MAX);
  c->depth += (uint32_t)c->speed;
  if (off_display(en->x, en->y) && off_cam(en->x, y)) return 0;

  if (!p->dead && c->riding) {
    if (c->depth >= BOTTOM) {
      c->depth = BOTTOM;
      c->held++;
      // his controls as the player task last read them, on the frame before
      int pad = p->held[0];
      if (c->held >= HELD_MAX || (pad & (DPAD_LEFT | DPAD_RIGHT))) {
        c->held = HELD_MAX;
        // off the way he holds, or else the way he came
        if ((pad & DPAD_LEFT) ? p->gsp > 0 : (pad & DPAD_RIGHT) ? p->gsp < 0 : !c->right) p->gsp = -p->gsp;
        p->xsp = p->gsp;
        c->riding = 0;
        player_end_attack(p); p->pushing = 0;
        p->carried = 0; p->onObject = NULL;
        p->curled = 1; p->airLock = 1; p->air = 1;
        p->state = PS_WALK;
        sensors_set_offset_y(p, SPRITE_OFFSET_Y);   // PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14)
        p->ysp = 0;
        p->x = en->x;
        p->sprite.oamFlags = OAM_ORDER_PLAYER << 6;
        c->phase = CAROUSEL_BOTTOM;
      }
    }
  } else if (p->dead) {
    if (c->depth > BOTTOM) c->depth = BOTTOM;
    p->carried = 0;
    c->held++;
    if (c->held > HELD_MAX) c->phase = CAROUSEL_BOTTOM;
  }

  c->t++;
  if (c->speed < SLOW_SPEED) { if (c->speed != 0 && c->t % SLOW_EVERY == 0) play_song(SE_CAROUSEL_A); }
  else if (c->speed < MEDIUM_SPEED) { if (c->t % MEDIUM_EVERY == 0) play_song(SE_CAROUSEL_B); }
  else if (c->t % FAST_EVERY == 0) play_song(SE_CAROUSEL_C);

  sprite_step(top);
  draw_both(c, y, y + POLE_DROP);
  return 1;
}

// the top's and the pole's tiles go together (TaskDestructor_Carousel)
static void carousel_end(ActTask *t) {
  Carousel *c = (Carousel *)t->data;
  object_sprite_free(&c->pole);
  object_end(t);
}

ActTask *carousel_spawn(Slot *slot) {
  Carousel *c = OBJECT_NEW(Carousel);
  if (!c) return NULL;
  c->o.slot = slot;
  c->o.x = slot->e.x;
  object_sprite(&c->o.sprite, ANIM_CAROUSEL, 0, 0, ORDER_CAROUSEL, PRIORITY_FRONT, 0, 0);
  object_sprite(&c->pole, ANIM_CAROUSEL_POLE, 0, 0, ORDER_CAROUSEL, PRIORITY_FRONT, 0, 0);
  sprite_step(&c->o.sprite);
  sprite_step(&c->pole);   // the pole's one frame: the task never steps it again
  ActTask *t = object_task(&c->o, carousel_run, PRIORITY_OBJECTS);
  if (!t) object_sprite_free(&c->pole);
  else t->end = carousel_end;
  return t;
}
