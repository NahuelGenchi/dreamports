// Neo Green Hill's shrubbery (SAT-R decompilation, src/game/sa1/stage/interactables/shrubbery.c), kind 30: the bushes in
// act 2, translated from the JavaScript version's engine/shrubs.js. Each is an invisible box from its spawn point, d2 by
// d3 tiles, that Sonic passes in front of. The frame his centre gets into it, unless he is dead, leaves fly up from a
// point up to 16 px either side of him and 8 px above or below, by two of the game's random numbers, and the bush
// rustles. The leaves are a task of their own at Sonic's priority (0x3000), in front of everything: their animation, for
// 51 frames or until they are out of range.

#include "objects.h"

enum {
  SHRUBBERY = 30,
  ANIM_LEAVES = 467,
  LEAVES_ORDER = 0, LEAVES_PRIORITY = 0,
  LEAVES_FRAMES = 52,   // the counter it destroys them at, a frame before it would show the 52nd
  SE_SHRUBBERY = 178,
  PLAYERS = 1,          // only Sonic is in this version; the original reads gNumSingleplayerCharacters
};

typedef struct { Object o; int inside[PLAYERS]; } Shrub;
typedef struct { Object o; int x, y, left; } Leaves;

// CreateShrubberyParticles and Task_ShrubberyParticles
static int leaves_run(ActTask *t) {
  Leaves *l = (Leaves *)t->data;
  if (off_cam(l->x, l->y) || --l->left == 0) return 0;
  sprite_step(&l->o.sprite);
  object_draw(&l->o.sprite, l->x, l->y);
  return 1;
}

static void leaves(int x, int y) {
  Leaves *l = OBJECT_NEW(Leaves);
  if (!l) return;
  l->x = x; l->y = y; l->left = LEAVES_FRAMES;
  object_sprite(&l->o.sprite, ANIM_LEAVES, 0, 0, LEAVES_ORDER, LEAVES_PRIORITY, 0, 0);
  sprite_step(&l->o.sprite);
  object_task(&l->o, leaves_run, PRIORITY_SONIC);
}

static int shrub_run(ActTask *t) {
  Shrub *s = (Shrub *)t->data;
  const Entity *e = &s->o.slot->e;
  Player *p[PLAYERS] = { &act.player };   // the CPU partner isn't here, so only Sonic's box is read
  int right = e->x + e->d[2] * 8, bottom = e->y + e->d[3] * 8;
  for (int i = 0; i < PLAYERS; i++) {
    int x = (int)__builtin_floor(p[i]->x), y = (int)__builtin_floor(p[i]->y);
    if (x >= e->x && x <= right && y >= e->y && y <= bottom) {
      if (!p[i]->dead) {
        // the bush reacts the frame he first gets into it, not every frame he stays in it
        if (!s->inside[i]) {
          uint32_t r = act_random();
          int lx = x + (int)((r & 0x1F00) >> 8) - 16;
          int ly = y + (int)((act_random() & 0x0F00) >> 8) - 8;
          leaves(lx, ly);
          play_song(SE_SHRUBBERY);
        }
        s->inside[i] = 1;
      }
    } else s->inside[i] = 0;
  }
  if (off_cam(e->x, e->y)) { s->o.slot->live = NULL; return 0; }
  return 1;
}

ActTask *shrub_spawn(Slot *slot) {
  Shrub *s = PLAIN_NEW(Shrub);
  if (!s) return NULL;
  s->o.slot = slot;
  s->o.x = slot->e.x;
  return object_task(&s->o, shrub_run, PRIORITY_OBJECTS);
}
