// The platforms that sink or rise under Sonic (kinds 85 and 89). Translated from the JavaScript version's
// engine/slowplatforms.js (the original's platforms_085_089.c: CreateEntity_Platform_SlowDescent, Task_Platform085,
// CreateEntity_Platform089 and Task_Platform089). Sonic lands on either from above only, as on a thin platform.
//
// Kind 85 sinks 0.75 px a frame while he stands on it, taking him with it, until the terrain is 22 px under its spawn
// point's line, and rises back as fast once he is off it. Landing on it puts him 2 px above its top. Kind 89 rises 0.75 px
// a frame while he stands on it, taking him with it, and sinks back once he is off it; once it has risen more than d3 x 8
// px, he dies on it.

#include "objects.h"
#include "terrain.h"

enum { ORDER_PLATFORM = 18, PRIORITY_PLATFORM = 2, STEP = 192, BELOW = 22, LANDING_LIFT = 2, ANIM_RISING = 523 };

// gUnknown_086CEDC0: its look in each level
static int sinking_animation(int level) {
  static const int ANIMS[] = { 463, 463, 506, 506, 495, 495, 528, 528, 544, 544, 517, 517, 517, 517, 463, 506, 495, 517 };
  return level >= 0 && level < (int)(sizeof ANIMS / sizeof ANIMS[0]) ? ANIMS[level] : 0;
}

static int floor_of(double v) { return (int)__builtin_floor(v); }

typedef struct { Object o; int q; } Sinking;   // q: how far it has sunk (risen), in 1/256 px

// Coll_Player_Entity_Intersection: his body against its box at (x, y)
static int touching(const Hitbox *hb, int x, int y, const Player *p) {
  Hitbox body = collide_body(p);
  return !p->dead && hb && collide_overlap(x, y, hb, floor_of(p->x), floor_of(p->y), &body);
}

static int sinking_run(ActTask *t) {
  Sinking *s = (Sinking *)t->data;
  const Entity *en = &s->o.slot->e;
  Player *p = &act.player;
  const Hitbox *hb = object_box(&s->o.sprite, 0);
  int y = en->y + (s->q >> 8), on = 0;
  if (p->onObject == &s->o) {
    int room = terrain_tile_floor(en->x, y + BELOW, p->layer, 8);
    if (!touching(hb, en->x, y - 4, p)) p->onObject = NULL;
    else {
      on = 1;
      if (room >= 0) p->y += STEP / 256.0;
      // out of the floor under his feet, and off it
      int d = terrain_tile_floor(floor_of(p->x), floor_of(p->y) + 16, p->layer, 8);
      if (d < 0) { p->y += d; p->onObject = NULL; }
    }
  } else if (hb && (collide_platform_top(&s->o, en->x, y, hb, p) & COLLIDE_LANDED)) {
    if (!p->spinDashing) p->y -= LANDING_LIFT;
    on = 1;
  }
  if (on) { if (terrain_tile_floor(en->x, y + BELOW, p->layer, 8) >= 0) s->q += STEP; }
  else if (s->q != 0) s->q -= STEP;
  int at = en->y + (s->q >> 8);
  if (off_display(en->x, en->y) && off_cam(en->x, at)) return 0;
  object_draw(&s->o.sprite, en->x, at);
  return 1;
}

// CreateEntity_Platform_SlowDescent
ActTask *sinking_platform_spawn(Slot *slot) {
  int anim = sinking_animation(act.stage.level);
  if (!anim) return NULL;
  Sinking *s = OBJECT_NEW(Sinking);
  if (!s) return NULL;
  s->o.slot = slot;
  s->o.x = slot->e.x;
  object_sprite(&s->o.sprite, anim, 0, 0, ORDER_PLATFORM, PRIORITY_PLATFORM, 0, 0);
  sprite_step(&s->o.sprite);
  return object_task(&s->o, sinking_run, PRIORITY_OBJECTS);
}

// Task_Platform089: drawn where it was before it moves this frame
static int rising_run(ActTask *t) {
  Sinking *s = (Sinking *)t->data;
  const Entity *en = &s->o.slot->e;
  Player *p = &act.player;
  const Hitbox *hb = object_box(&s->o.sprite, 0);
  int y = en->y - (s->q >> 8), on = 0, off = 0;   // he stood on it, and he didn't land on it
  if (p->onObject == &s->o) {
    on = 1;
    if (!touching(hb, en->x, y - 4, p)) p->onObject = NULL;
    else {
      p->y -= STEP / 256.0;
      if ((s->q >> 8) > en->d[3] * 8) { p->onObject = NULL; p->dead = 1; }
    }
  } else if (!hb || !(collide_platform_top(&s->o, en->x, y, hb, p) & COLLIDE_LANDED)) off = 1;
  if (on) s->q += STEP;
  else if (off && s->q != 0) s->q -= STEP;
  if (off_display(en->x, en->y) && off_cam(en->x, y)) return 0;
  object_draw(&s->o.sprite, en->x, y);
  return 1;
}

// CreateEntity_Platform089: Ice Mountain's thin platform's look, wherever it is
ActTask *rising_platform_spawn(Slot *slot) {
  Sinking *s = OBJECT_NEW(Sinking);
  if (!s) return NULL;
  s->o.slot = slot;
  s->o.x = slot->e.x;
  object_sprite(&s->o.sprite, ANIM_RISING, 0, 0, ORDER_PLATFORM, PRIORITY_PLATFORM, 0, 0);
  sprite_step(&s->o.sprite);
  return object_task(&s->o, rising_run, PRIORITY_OBJECTS);
}
