// Neo Green Hill's mini loops (SAT-R decompilation, src/game/sa1/stage/interactables/034.c, mini_loop.c and
// mini_loop_boost.c): the small tunnels in act 2 that Sonic rolls through, curling round inside the ground, translated
// from the JavaScript version's engine/miniloops.js. Each part is an invisible box, d0 and d1 tiles (signed) from its
// spawn point to its top left and d2 by d3 tiles in size, that acts on every frame Sonic's centre is in it:
//   34, the entry: takes his controls and curls him into a ball that keeps rolling (MOVESTATE_200), so he lands curled
//       up, isn't held to the rise cap, and rolls on at 3 px a frame when he would stop;
//   35, the way out: lets him uncurl again and gives his controls back;
//   36, the start of the run: sends him right at 9 px a frame, on the ground;
//   37, the exit: sends him left at 7.25 px a frame, on the ground;
//   38, the entrance: turns him upside down, and on the ground the other way.
// None of them draw. Each one goes when its spawn point is more than 128 px off the screen, and as it does, it clears
// Sonic's half-pipe flag whatever he is on.

#include "objects.h"

enum { MINI_LOOP_ENTRY = 34, MINI_LOOP_BASE = 35, MINI_LOOP_START_BOOST = 36, MINI_LOOP_EXIT = 37, MINI_LOOP_ENTRANCE = 38 };
enum { SE_SPIN = 109 };
#define EXIT_SPEED (-7.25)
#define BOOST_SPEED 9

typedef struct { Object o; } MiniLoop;

// no fresh press of jump or attack: the buttons the player holds then don't count as presses
static void no_presses(Player *p) { p->jumpPressed = 0; p->attackPressed = 0; }

// what a part does to Sonic while his centre is in its box; true when he is dead, which ends its frame there
static int part(Player *p, int kind) {
  switch (kind) {
    // Task_Interactable034: Player_TransitionCancelFlyingAndBoost, then the forced roll, with no input at all and the
    // spin attack's sound (m4aSongNumStartOrChange, so it doesn't start over while it plays)
    case MINI_LOOP_ENTRY:
      if (p->dead) return 1;
      player_end_attack(p); p->pushing = 0; p->airLock = 0;
      p->forcedRoll = 1;
      player_curl_up(p); p->state = PS_SPIN;
      p->ignoreInput = 1; no_presses(p);
      p->carried = 0;
      if (p->character != CHARACTER_AMY) play_song_or_change(SE_SPIN);   // Amy has no spin's sound
      return 0;
    // Task_MiniLoop_Base: the forced roll ends, and his controls come back with the buttons he holds not counting as presses
    case MINI_LOOP_BASE:
      if (p->dead) return 1;
      p->forcedRoll = 0;
      if (p->ignoreInput) { p->ignoreInput = 0; no_presses(p); }
      return 0;
    // Task_MiniLoop_StartBoost, which doesn't look whether he is alive
    case MINI_LOOP_START_BOOST:
      if (!p->air) p->gsp = BOOST_SPEED;
      return 0;
    // Task_MiniLoop_Exit
    case MINI_LOOP_EXIT:
      if (p->dead) return 1;
      if (!p->air) p->gsp = EXIT_SPEED;
      return 0;
    // Task_MiniLoop_Entrance
    case MINI_LOOP_ENTRANCE:
      if (p->dead) return 1;
      p->rotation = 0x80;
      if (!p->air) p->gsp = -p->gsp;
      return 0;
  }
  return 0;
}

static int mini_loop_run(ActTask *t) {
  MiniLoop *m = (MiniLoop *)t->data;
  const Entity *e = &m->o.slot->e;
  Player *p = &act.player;
  int left = e->x + s8(e->d[0]) * 8, top = e->y + s8(e->d[1]) * 8;
  int right = left + e->d[2] * 8, bottom = top + e->d[3] * 8;
  if (off_display(e->x, e->y)) { p->halfPipe = 0; m->o.slot->live = NULL; return 0; }
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if (x >= left && x < right && y >= top && y < bottom) part(p, e->kind);
  return 1;
}

ActTask *mini_loop_spawn(Slot *slot) {
  MiniLoop *m = PLAIN_NEW(MiniLoop);
  if (!m) return NULL;
  m->o.slot = slot;
  m->o.x = slot->e.x;
  return object_task(&m->o, mini_loop_run, PRIORITY_OBJECTS);
}
