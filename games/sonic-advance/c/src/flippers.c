// Casino Paradise's lying (54) and standing (56) flippers. Translated from the JavaScript version's engine/flippers.js (the
// original's flippers.c). The small blue flipper (73) is in flipper_blue.c.
//
// The lying flipper points right from its pivot, or left when d0 is 0. Coming down onto it, Sonic is held curled up on its slope,
// half a pixel down for each pixel out from the pivot, rolling out at 0.3125 px a frame, with his controls taken; a jump press
// flips him off, the faster the farther out he is, and rolling off its end lets him go at 1 px a frame. From below it holds him
// under it. The standing flipper is solid; walking or rolling into it from below its pivot bats him back the way he came at 10 px
// a frame. After a flip both play their flip for 8 frames, then rest; they do nothing to him meanwhile.
//
// Knuckles climbing into the lying flipper is not here: only Sonic is.

#include "objects.h"
#include "terrain.h"

enum { FLIPPER = 54, FLIPPER_STANDING = 56 };
enum {
  ANIM_FLIPPER = 478, ORDER_FLIPPER = 18, PRIORITY_FRONT = 2,
  // the animation's variants: lying, flipping, standing, standing and flipping
  VARIANT_LYING = 0, VARIANT_LYING_FLIP = 1, VARIANT_STANDING = 2, VARIANT_STANDING_FLIP = 3,
  SE_BUMPER_A = 183,
  BALL_OFFSET_Y = 9,            // Sonic's height from his centre to the ground curled up
  FLIP_FRAMES = 8,
  BAT = 10,                     // the standing flipper's speed
  HOLD_BELOW = 17,              // the lying flipper holds his centre this far above its slope
  CATCH_DEPTH = 19,             // he is only caught above this many px below its pivot
  UNDER_DEPTH = 24,             // from below it holds him this far below its pivot
  UNDER_SPEED = 10,             // in 1/256 px
  STANDING_LEFT = 6, STANDING_RIGHT = 7,   // where the standing flipper looks for him either side
  FLIP_SPEED = 0x7C0,           // the flip's speed up, less 1/16 px for each pixel out from the pivot, in 1/256 px
  FLIP_OUT_STEP = 16, FLIP_SIDE = 32,
};
static const double ROLL = 80 / 256.0;   // Q(0.3125)

typedef struct {
  Object o;
  int left, holding, flipping, on;
} Flipper;

static int floor_of(double v) { return (int)__builtin_floor(v); }
static int s16_of(int v) { return (int16_t)v; }

// Coll_Player_Entity_Intersection: his body's box against the flipper's first hitbox
static int touches(const Flipper *f, int x, int y, const Player *p) {
  const Hitbox *box = object_box(&f->o.sprite, 0);
  Hitbox body = collide_body(p);
  return !p->dead && box && collide_overlap(x, y, box, floor_of(p->x), floor_of(p->y), &body);
}

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

// the buttons he holds don't count as presses: the pad's presses of this frame are dropped before his step reads them
static void no_presses(void) { e.pressed &= (uint16_t)~(KEY_A | KEY_B); }

static void set_height(Player *p, int offsetY) { sensors_set_offset_y(p, offsetY); }

// held: curled up on the slope, rolling out, his presses dropped
static void hold(Flipper *f, Player *p, int top) {
  p->y = top + 1 / 256.0; p->ysp = 0; p->xsp = f->left ? -ROLL : ROLL;
  p->jumpPressed = 0; no_presses();
  p->ignoreInput = 1;
}

// --- the lying flipper (Task_Flipper_Horizontal, and Task_Flipper_Horizontal_2 while flipping) ------------------------------------
// It only updates its animation while flipping.
static void lying_collide(Flipper *f, Player *p, int jumpPressed) {
  const Entity *en = &f->o.slot->e;
  int left = f->left;
  // how far out from the pivot he is, and the height it holds him at there
  int out = s16_of(left ? en->x - floor_of(p->x) : floor_of(p->x) - en->x);
  int top = en->y + (out >> 1) - HOLD_BELOW;
  if (touches(f, en->x, en->y, p)) {
    if (p->ysp >= 0 && p->y < en->y + CATCH_DEPTH && p->air) {
      if (jumpPressed && f->holding) {
        f->holding = 0;
        p->onObject = NULL; p->air = 1; p->jumped = 0; p->curled = 1; p->airLock = 0;
        if (e.input & KEY_LEFT) p->facing = -1;
        else if (e.input & KEY_RIGHT) p->facing = 1;
        p->ysp = (-FLIP_SPEED - out * FLIP_OUT_STEP) / 256.0;
        p->xsp = (left ? -out : out) * FLIP_SIDE / 256.0; p->gsp = p->xsp;
        cancel(p);
        p->state = PS_SPIN;
        f->flipping = FLIP_FRAMES;
        set_height(p, BALL_OFFSET_Y);
        p->ignoreInput = 0; no_presses();
        sprite_start(&f->o.sprite, VARIANT_LYING_FLIP);
        play_song(SE_BUMPER_A);
      } else if (p->y > top) {
        // caught: his height changes after he is put on the slope, so he lands lower by it
        hold(f, p, top);
        f->holding = 1;
        p->rotation = 0;
        cancel(p);
        p->curled = 1;
        set_height(p, BALL_OFFSET_Y);
        p->state = PS_SPIN;
      } else if (f->holding) {
        cancel(p);
        p->air = 1; p->jumped = 0; p->curled = 1; p->airLock = 0;
        p->state = PS_SPIN;
        set_height(p, BALL_OFFSET_Y);
        hold(f, p, top);
      } else {
        p->ignoreInput = 0; no_presses();
      }
    } else if (p->y <= en->y) p->air = 1;
    else if (p->y < en->y + UNDER_DEPTH) { p->y = en->y + UNDER_DEPTH; p->ysp = UNDER_SPEED / 256.0; p->xsp = 0; p->gsp = 0; }
  } else {
    // off its end
    if (f->holding) { p->ignoreInput = 0; no_presses(); p->xsp = left ? -1 : 1; }
    f->holding = 0;
  }
}

static int lying_run(ActTask *t) {
  Flipper *f = (Flipper *)t->data;
  Sprite *s = &f->o.sprite;
  const Entity *en = &f->o.slot->e;
  if (f->flipping) {
    if (off_cam(en->x, en->y)) return 0;
    if (--f->flipping == 0) sprite_start(s, VARIANT_LYING);
    sprite_step(s);
    object_draw(s, en->x, en->y);
    return 1;
  }
  // a flip goes by the pad's own press
  int jumpPressed = (e.pressed & KEY_A) != 0;
  lying_collide(f, &act.player, jumpPressed);
  if (off_cam(en->x, en->y)) {
    if (f->holding) { act.player.ignoreInput = 0; no_presses(); }
    return 0;
  }
  object_draw(s, en->x, en->y);
  return 1;
}

// --- the standing flipper (Task_Flipper_Vertical, and Task_Flipper_Vertical_2 while flipping) ------------------------------------
// Its first frame, and with it its hitbox, comes with its first run's animation update, after its collision.

// it bats him toward `dir`, turning that way
static void bat(Flipper *f, Player *p, int dir) {
  Sprite *s = &f->o.sprite;
  p->facing = dir;
  p->xsp = BAT * dir; p->gsp = p->xsp;
  if (dir < 0) s->frameFlags |= SPRITE_X_FLIP; else s->frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  f->flipping = FLIP_FRAMES;
  sprite_start(s, VARIANT_STANDING_FLIP);
  play_song(SE_BUMPER_A);
}

static int standing_run(ActTask *t) {
  Flipper *f = (Flipper *)t->data;
  Sprite *s = &f->o.sprite;
  const Entity *en = &f->o.slot->e;
  Player *p = &act.player;
  if (f->flipping) {
    if (off_cam(en->x, en->y)) return 0;
    if (--f->flipping == 0) sprite_start(s, VARIANT_STANDING);
    sprite_step(s);
    object_draw(s, en->x, en->y);
    return 1;
  }
  if (p->dead) {
    if (f->on) { f->on = 0; p->onObject = NULL; }
  } else if (p->air || f->on) {
    if (collide_platform(&f->o, en->x, en->y, object_box(s, 0), p) & COLLIDE_LANDED) {
      f->on = 1;
      // on its top but not touching its box: he slips off
      if (!touches(f, en->x, en->y, p) && p->onObject == &f->o) p->onObject = NULL;
    } else if (f->on) { f->on = 0; p->onObject = NULL; }
  } else if (en->y < p->y) {
    if (en->x > p->x) { if (touches(f, en->x - STANDING_LEFT, en->y, p)) bat(f, p, -1); }
    else if (touches(f, en->x + STANDING_RIGHT, en->y, p)) bat(f, p, 1);
  }
  if (off_cam(en->x, en->y)) return 0;
  sprite_step(s);
  object_draw(s, en->x, en->y);
  return 1;
}

ActTask *flipper_spawn(Slot *slot) {
  Flipper *f = OBJECT_NEW(Flipper);
  if (!f) return NULL;
  const Entity *en = &slot->e;
  f->o.slot = slot;
  f->o.x = en->x;
  if (en->kind == FLIPPER) {
    f->left = en->d[0] == 0;
    object_sprite(&f->o.sprite, ANIM_FLIPPER, VARIANT_LYING, VARIANT_LYING_FLIP, ORDER_FLIPPER, PRIORITY_FRONT, f->left, 0);
    sprite_step(&f->o.sprite);
    return object_task(&f->o, lying_run, PRIORITY_OBJECTS);
  }
  object_sprite(&f->o.sprite, ANIM_FLIPPER, VARIANT_STANDING, VARIANT_STANDING_FLIP, ORDER_FLIPPER, PRIORITY_FRONT, 0, 0);
  return object_task(&f->o, standing_run, PRIORITY_OBJECTS);
}
