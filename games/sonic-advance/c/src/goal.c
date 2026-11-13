// The goal signpost, kind 0. Translated from the JavaScript version's engine/goal.js (the original's stage_goal.c) as it runs
// in single player. Only those with d1 set spawn; act 1 has one that shows (d0 set) and a column of hidden ones along the same
// line, so Sonic can't pass it above or below. The first one he passes, once his centre is right of it, ends the act: the clock
// and the rings stop, it plays the goal song and spins, and from then on it holds right for him, raises the camera 56 px a pixel
// a frame and keeps him to 4.5 px a frame. Any other goal he passes after that only spins. 31 frames on, a task waits for him to
// be on the ground at 2.25 px a frame or more and puts him into his act-clear run; from the 122nd frame on, once he is in it,
// the goal makes way for the results. Ice Mountain act 2 and Egg Rocket have rules of their own: in Ice Mountain act 2 Sonic
// must also be lower than 80 px above the goal; in Egg Rocket his body box must take in the goal's point, it plays no sound (it
// isn't the signpost), nothing holds his controls or raises the camera, his own movement stops and the results come on the
// 122nd frame, whatever he is doing.

#include "objects.h"

// What the goal hands to the act (the act_* hooks) is in act.h; act.c writes them.

enum { STAGE_GOAL = 0 };
enum {
  ANIM_GOAL = 453, VARIANT_FACE = 0, VARIANT_SPIN = 1,   // Eggman's face, and spinning once Sonic has passed it
  ORDER_GOAL = 18, PRIORITY_FRONT = 2,
  SE_GOAL = 135,
  ICE_MOUNTAIN_ABOVE = 80,  // DISPLAY_CENTER_Y: how far above the goal Sonic may be in Ice Mountain act 2
  SHIFT_Y = -56,            // how far the camera's target rises
  FRAMES_BEFORE_WAIT = 30,  // frames before the task that waits for Sonic to be on the ground is made
  FRAMES_BEFORE_RESULTS = 120,
};
#define RUN_SPEED 4.5       // PLAYER_POST_GOAL_RUN_SPEED
#define RESULTS_SPEED 2.25  // the least ground speed Task_ShowResults waits for

enum { PHASE_WAITING, PHASE_ENDING, PHASE_PASSED };   // Task_StageGoal, then Task_StageGoal2 or Task_StageGoal3

typedef struct { Object o; int shows, phase, frames, waiting; } Goal;   // frames and waiting are unk3C and unk3E

// Task_ShowResults: on the ground and fast enough, Sonic lands into his act-clear run
static int show_results_run(ActTask *t) {
  Player *p = &act.player;
  if (p->air || p->gsp < RESULTS_SPEED) return 1;
  player_land(p);
  p->state = PS_ACT_CLEAR_RUN; p->actClear = 1;
  return 0;
}

// Task_StageGoal3, and the end of Task_StageGoal2: the hidden ones draw nothing
static int passed(Goal *g) {
  if (!g->shows) return 1;
  const Entity *e = &g->o.slot->e;
  sprite_step(&g->o.sprite);
  object_draw(&g->o.sprite, e->x, e->y);
  return 1;
}

// Task_StageGoal2
static int ending(Goal *g) {
  Player *p = &act.player;
  int rocket = act.stage.level == LEVEL_EGG_ROCKET;
  if (rocket) p->carried = 1;
  else {
    p->ignoreInput = 1; p->heldRight = 1;
    if (act.cam.shiftY > SHIFT_Y) act.cam.shiftY--;
    if (p->gsp > RUN_SPEED) p->gsp = RUN_SPEED;
    if (g->frames > FRAMES_BEFORE_WAIT && !g->waiting) {
      g->waiting = 1;
      act_task_add(show_results_run, NULL, NULL, PRIORITY_OBJECTS);
    }
  }
  if (g->frames++ > FRAMES_BEFORE_RESULTS && (p->state == PS_ACT_CLEAR_RUN || rocket)) {
    // the goal goes with the act: it stays marked as there, so that it isn't made again
    g->o.slot->gone = 1;
    act_stage_results(0);
    return 0;
  }
  return passed(g);
}

// Task_StageGoal: whether Sonic, right of the goal, ends the act here. The original tests his body box whether or not it is
// set; here a cleared one never takes in the point
static int reached(const Goal *g) {
  const Player *p = &act.player;
  const Entity *e = &g->o.slot->e;
  int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
  if (px <= e->x) return 0;
  if (act.stage.level == LEVEL_ICE_MOUNTAIN_2) return py > e->y - ICE_MOUNTAIN_ABOVE;
  if (act.stage.level != LEVEL_EGG_ROCKET) return 1;
  const Hitbox *b = object_box(&p->sprite, 0);
  return b && px + b->left <= e->x && px + b->right >= e->x && py + b->top <= e->y && py + b->bottom >= e->y;
}

static int goal_run(ActTask *t) {
  Goal *g = (Goal *)t->data;
  Sprite *s = &g->o.sprite;
  const Entity *e = &g->o.slot->e;
  if (g->phase == PHASE_ENDING) return ending(g);
  if (g->phase == PHASE_PASSED) return passed(g);
  if (reached(g)) {
    if (s->variant != VARIANT_SPIN) sprite_start(s, VARIANT_SPIN);
    if (act_goal_passed()) { g->phase = PHASE_PASSED; return passed(g); }
    act_goal_reached();
    if (act.stage.level != LEVEL_EGG_ROCKET) play_song(SE_GOAL);
    g->phase = PHASE_ENDING;
    return ending(g);
  }
  if (off_cam(e->x, e->y)) return 0;
  if (g->shows) object_draw(s, e->x, e->y);
  return 1;
}

ActTask *goal_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  if (en->d[1] == 0) return NULL;   // in single player only those with d1 set spawn
  Goal *g = OBJECT_NEW(Goal);
  if (!g) return NULL;
  g->o.slot = slot;
  g->o.x = en->x;
  g->shows = en->d[0] != 0;
  g->phase = PHASE_WAITING;
  object_sprite(&g->o.sprite, ANIM_GOAL, VARIANT_FACE, VARIANT_SPIN, ORDER_GOAL, PRIORITY_FRONT, 0, 0);
  sprite_step(&g->o.sprite);
  return object_task(&g->o, goal_run, PRIORITY_OBJECTS);
}
