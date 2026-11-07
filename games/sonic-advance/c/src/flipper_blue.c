// Casino Paradise's small blue flipper (kind 73). Translated from the JavaScript version's engine/flippers.js (the original's
// flipper_small_blue.c). It is part of a marble track, as step d1: taking Sonic from an earlier step, it throws him up at 12.5625
// px a frame with gravity for d0 frames, then lets him go. It is mirrored when d2 is set. Its art turns into the lying flipper's 24
// frames after it throws him, until it next spawns: it switches to that animation where it means its own (the original's bug,
// which the JavaScript version's fixes undo; they are off).
//
// It needs Sonic to have the marble track's step (`track`, 0x7F for none) and its state (PS_MARBLE_TRACK).

#include "objects.h"
#include "terrain.h"

enum {
  FLIPPER_BLUE = 73,
  ANIM_BLUE_FLIPPER = 522, ANIM_FLIPPER = 478, ORDER_FLIPPER = 18, PRIORITY_FRONT = 2,
  VARIANT_BLUE = 0, VARIANT_BLUE_FLIP = 1, VARIANT_LYING = 0,
  SE_BUMPER_A = 183,
  SPRITE_OFFSET_Y = 14,         // Sonic's height from his centre to the ground standing
  BLUE_ART = 24,
};
static const double BLUE_THROW = -3216 / 256.0, GRAVITY = 42 / 256.0;

typedef struct {
  Object o;
  int frames, step;
  int holding, n, art;          // for Sonic: held; the frames it has thrown him for; the frames until its art changes
  double vy, hx, hy;            // his speed up, and where it holds him
} Blue;

static int floor_of(double v) { return (int)__builtin_floor(v); }

// Coll_Player_Entity_Intersection: his body's box against the flipper's first hitbox
static int touches(const Blue *b, const Player *p) {
  const Entity *en = &b->o.slot->e;
  const Hitbox *box = object_box(&b->o.sprite, 0);
  Hitbox body = collide_body(p);
  return !p->dead && box && collide_overlap(en->x, en->y, box, floor_of(p->x), floor_of(p->y), &body);
}

static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

static int blue_run(ActTask *t) {
  Blue *b = (Blue *)t->data;
  Sprite *s = &b->o.sprite;
  const Entity *en = &b->o.slot->e;
  Player *p = &act.player;
  if (p->dead) {
    // nothing happens to a dead player
  } else if (b->holding) {
    if (b->art != 0 && --b->art == 0) { s->graphics.anim = ANIM_FLIPPER; sprite_start(s, VARIANT_LYING); }
    b->vy += GRAVITY;
    b->hy += b->vy;
    p->y = b->hy; p->x = b->hx; p->ysp = b->vy; p->xsp = 0; p->gsp = 0;
    if (++b->n >= b->frames) {
      if (p->track == b->step) p->carried = 0;
      b->holding = 0;
      b->art = 0;
    } else {
      cancel(p);
      p->carried = 1;
      p->state = PS_MARBLE_TRACK;
      sensors_set_offset_y(p, SPRITE_OFFSET_Y);
    }
  } else if (b->art != 0) {
    if (--b->art == 0) { s->graphics.anim = ANIM_BLUE_FLIPPER; sprite_start(s, VARIANT_BLUE); }
  } else if (p->carried && p->track < b->step && touches(b, p)) {
    b->n = 0;
    cancel(p);
    p->curled = 1; p->carried = 1;
    p->track = b->step;
    b->hy = p->y; b->hx = p->x; b->vy = BLUE_THROW;
    p->ysp = 0; p->xsp = 0; p->gsp = 0;
    p->state = PS_MARBLE_TRACK;
    sensors_set_offset_y(p, SPRITE_OFFSET_Y);
    play_song(SE_BUMPER_A);
    b->holding = 1;
    b->art = BLUE_ART;
    s->graphics.anim = ANIM_BLUE_FLIPPER;
    sprite_start(s, VARIANT_BLUE_FLIP);
  }
  if (!b->holding && off_cam(en->x, en->y)) return 0;
  sprite_step(s);
  object_draw(s, en->x, en->y);
  return 1;
}

ActTask *flipper_blue_spawn(Slot *slot) {
  Blue *b = OBJECT_NEW(Blue);
  if (!b) return NULL;
  const Entity *en = &slot->e;
  b->o.slot = slot;
  b->o.x = en->x;
  b->frames = en->d[0];
  b->step = en->d[1];
  object_sprite(&b->o.sprite, ANIM_BLUE_FLIPPER, VARIANT_BLUE, VARIANT_BLUE_FLIP, ORDER_FLIPPER, PRIORITY_FRONT, en->d[2] != 0, 0);
  sprite_step(&b->o.sprite);
  return object_task(&b->o, blue_run, PRIORITY_OBJECTS + s8(en->d[1]));
}
