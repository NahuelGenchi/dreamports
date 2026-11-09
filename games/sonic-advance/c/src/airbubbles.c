// The air bubbles under water (kind 94), translated from the JavaScript version's engine/airbubbles.js (the original's
// air_bubbles.c): a spot on the ground that fizzes, lets a stream of small bubbles out and, now and then, a big one Sonic
// can breathe from. All are tasks at the objects' priority; the bubbles burst when they reach the water line.

#include "objects.h"

enum {
  ANIM_MAKER = 533, ANIM_BIG = 532, ANIM_SMALL = 753, ANIM_GROUP = 754,   // SA1_ANIM_MINIBUBBLES, SA1_ANIM_AIR_BUBBLES
  ORDER_MAKER = 18, ORDER_BIG = 15, PRIORITY_BUBBLES = 2,
  BREATH_FROM = 80, BREATH_AFTER = 16,
  SE_AIR_BUBBLE = 191,
};
// VRAM_RESERVED_BUBBLES_SMALL and _GROUP, shared with the bubbles Sonic lets out (water.c)
#define SMALL_DEST (OBJ_VRAM + 0x2A20)
#define GROUP_DEST (OBJ_VRAM + 0x2AA0)

// the frames between two big bubbles, in turn (gUnknown_086CEE60); a stream's next small bubble comes after half of one
// of them, picked by the stage clock
static const int DELAYS[] = { 301, 241, 121, 261, 301, 121, 201, 121 };
enum { DELAY_COUNT = sizeof DELAYS / sizeof DELAYS[0] };

// a bubble's sway: up to 8 px either way, a turn every 341 frames of its own
static int sway(int t) { return SINE[(t * 3) & 1023] >> 11; }

static int above_water(int y) { int level = water_level(); return level < 0 || y < level; }

// The big bubble (CreateBubbleContainingAir, Task_BubbleContainingAir): it rises half a pixel a frame, swaying. From its
// 80th frame Sonic's body touching its box takes a breath with its sound, and the drowning music stops; the bubble then
// stays where it is for 16 more frames (Task_809141C).
typedef struct { Object o; int x, y, t, after; } Big;

static int big_run(ActTask *t) {
  Big *b = (Big *)t->data;
  Player *p = &act.player;
  int x = b->x + sway(b->t), y = b->y - (b->t >> 1);
  if (off_cam(x, y) || above_water(y)) return 0;
  if (b->after >= 0) {
    if (--b->after < 0) return 0;
    sprite_step(&b->o.sprite);
    object_draw(&b->o.sprite, x, y);
    return 1;
  }
  b->t++;
  sprite_step(&b->o.sprite);
  const Hitbox *hb = object_box(&b->o.sprite, 0);
  if (b->t >= BREATH_FROM && hb && !p->dead) {
    Hitbox body = collide_body(p);
    if (collide_overlap(x, y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) {
      player_breathe(p);
      water_stop_drowning_music();
      play_song(SE_AIR_BUBBLE);
      b->after = BREATH_AFTER;
    }
  }
  object_draw(&b->o.sprite, x, y);
  return 1;
}

static void big_bubble(int x, int y) {
  Big *b = OBJECT_NEW(Big);
  if (!b) return;
  b->x = x; b->y = y; b->after = -1;
  object_sprite(&b->o.sprite, ANIM_BIG, 0, 0, ORDER_BIG, PRIORITY_BUBBLES, 0, 0);
  sprite_step(&b->o.sprite);
  object_task(&b->o, big_run, PRIORITY_OBJECTS);
}

// A stream's bubble (sub_80914F8, Task_80915F0): small or a group by the low bit of `n`, set off from the spot by its low
// four bits; it rises and sways like the big one.
typedef struct { Object o; int x, y, dx, t; } Small;

static int small_run(ActTask *t) {
  Small *b = (Small *)t->data;
  int x = b->x - 8 + sway(b->t) + b->dx, y = b->y - (b->t >> 1);
  if (off_cam(x, y) || above_water(y)) return 0;
  b->t++;
  sprite_step(&b->o.sprite);
  object_draw(&b->o.sprite, x, y);
  return 1;
}

static void small_bubble(int x, int y, int n) {
  Small *b = OBJECT_NEW(Small);
  if (!b) return;
  b->x = x; b->y = y; b->dx = n & 0xF;
  if (n & 1) object_sprite_at(&b->o.sprite, GROUP_DEST, ANIM_GROUP, 0, ORDER_MAKER, PRIORITY_BUBBLES, 0, 0);
  else object_sprite_at(&b->o.sprite, SMALL_DEST, ANIM_SMALL, 0, ORDER_MAKER, PRIORITY_BUBBLES, 0, 0);
  object_task(&b->o, small_run, PRIORITY_OBJECTS);
}

// Task_AirBubbles: the spot, with its two counters
typedef struct { Object o; int big, next, small; } Maker;

static int maker_run(ActTask *t) {
  Maker *m = (Maker *)t->data;
  const Entity *en = &m->o.slot->e;
  if (--m->big == 0) {
    big_bubble(en->x, en->y - 4);
    m->big = DELAYS[m->next];
    m->next = (m->next + 1) % DELAY_COUNT;
  }
  if (--m->small == 0) {
    small_bubble(en->x, en->y - 4, ((m->big >> 3) + act.tick) & 0xFF);
    m->small = DELAYS[act.tick % DELAY_COUNT] / 2;
  }
  if (off_cam(en->x, en->y)) return 0;
  sprite_step(&m->o.sprite);
  object_draw(&m->o.sprite, en->x, en->y);
  return 1;
}

// CreateEntity_AirBubbles
ActTask *air_bubbles_spawn(Slot *slot) {
  Maker *m = OBJECT_NEW(Maker);
  if (!m) return NULL;
  m->o.slot = slot;
  m->o.x = slot->e.x;
  m->big = 120; m->small = 60;
  object_sprite(&m->o.sprite, ANIM_MAKER, 0, 0, ORDER_MAKER, PRIORITY_BUBBLES, 0, 0);
  return object_task(&m->o, maker_run, PRIORITY_OBJECTS);
}
