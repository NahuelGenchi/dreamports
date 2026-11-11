// Casino Paradise's SEGA SONIC letters, kind 58. Translated from the JavaScript version's engine/segaletters.js (the original's
// sega_sonic_letters.c): letters Sonic can stand on, which light up and go dark on a cycle that runs with the stage clock. d0
// picks the letter, the low two bits of d1 the cycle's length (500, 400 or 300 frames; 3 doesn't occur) and d2 delays it by that
// many frames. With h = (length - 161) / 2 (169, 119 or 69 frames), on frame r of the cycle:
//
// - 0: it flickers on (its variant 1); from 58 it shines (variant 3); from 58 + h it blinks out (variant 0). It is solid all the
//   while, except on frames 0 and 58 + h.
// - from length - h to the end: it is dark (variant 2) and isn't solid, and Sonic's body touching it lets him drop off whatever
//   he stands on.
//
// Before the stage clock reaches the delay the cycle's frame is negative, which the original reads as a huge one: the letter
// blinks out as it spawned, and isn't solid.

#include "objects.h"

enum { SEGA_SONIC_LETTER = 58 };
enum {
  ANIM_LETTER = 492, VARIANTS_PER_LETTER = 4,   // each letter has four variants in a row
  LOOK_OFF = 0, LOOK_FLICKER = 1, LOOK_DARK = 2, LOOK_SHINE = 3,
  ORDER_LETTER = 18, PRIORITY_FRONT = 2,
  CYCLES = 3, START = 58,   // the lengths there are, and the frame the letter shines from
  LENGTH_MASK = 3,
};
static const int LENGTHS[CYCLES] = { 500, 400, 300 };

typedef struct { Object o; int letter, length, h, delay; } Letter;

static int look(const Letter *l, int v) { return l->letter * VARIANTS_PER_LETTER + v; }

static int letter_run(ActTask *t) {
  Letter *l = (Letter *)t->data;
  Sprite *s = &l->o.sprite;
  const Entity *e = &l->o.slot->e;
  Player *p = &act.player;
  if (off_cam(e->x, e->y)) return 0;
  // Mod(gStageTime - delay, length), compared unsigned
  unsigned r = (unsigned)((act_stage_time() - l->delay) % l->length);
  unsigned length = (unsigned)l->length, h = (unsigned)l->h;
  int solid = 1;
  const Hitbox *hb = object_box(s, 0);
  if (r < START) {
    if (r == 0) { solid = 0; sprite_start(s, look(l, LOOK_FLICKER)); }
  } else if (r < START + h) {
    if (r == START) sprite_start(s, look(l, LOOK_SHINE));
  } else if (r < length - h) {
    if (r == START + h) { solid = 0; sprite_start(s, look(l, LOOK_OFF)); }
  } else {
    solid = 0;
    if (r == length - h) sprite_start(s, look(l, LOOK_DARK));
    // Coll_Player_Entity_Intersection, then MOVESTATE_STOOD_ON_OBJ cleared
    Hitbox body = collide_body(p);
    if (!p->dead && hb && collide_overlap(e->x, e->y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) p->onObject = NULL;
  }
  if (solid) collide_platform(&l->o, e->x, e->y, hb, p);
  sprite_step(s);
  object_draw(s, e->x, e->y);
  return 1;
}

ActTask *sega_letter_spawn(Slot *slot) {
  Letter *l = OBJECT_NEW(Letter);
  if (!l) return NULL;
  const Entity *en = &slot->e;
  l->o.slot = slot;
  l->o.x = en->x;
  l->letter = en->d[0];
  l->length = LENGTHS[(en->d[1] & LENGTH_MASK) % CYCLES];
  l->h = (l->length - 161) >> 1;
  l->delay = en->d[2];
  int first = look(l, LOOK_OFF);
  object_sprite(&l->o.sprite, ANIM_LETTER, first, first + VARIANTS_PER_LETTER - 1, ORDER_LETTER, PRIORITY_FRONT, 0, 0);
  sprite_step(&l->o.sprite);
  return object_task(&l->o, letter_run, PRIORITY_OBJECTS);
}
