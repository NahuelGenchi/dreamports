// The checkpoints, kind 7. Translated from the JavaScript version's engine/checkpoints.js (the original's checkpoint.c). d0
// numbers them along the act. When Sonic's centre enters one's box it spins, with the checkpoint song from its animation script,
// and the act starts over from it after a death; one whose number is not above the last passed spawns already passed. It
// doesn't count while an object holds Sonic, as a wall pole doesn't. Egg Rocket's have no post, and are not built here.

#include "objects.h"

// What the checkpoint hands to the act (the act_* hooks) is in act.h; act.c writes them.

enum { CHECKPOINT = 7 };
enum {
  ANIM_CHECKPOINT = 452, VARIANT_WAITING = 0, VARIANT_SPIN = 1, VARIANT_PASSED = 2,
  ORDER_CHECKPOINT = 18, PRIORITY_FRONT = 2,
};
enum { PHASE_WAITING, PHASE_SPINNING, PHASE_PASSED };   // Task_CheckpointMain, Task_Checkpoint1 and Task_Checkpoint2

typedef struct { Object o; int index, phase; } Checkpoint;

// Task_Checkpoint1: the spin, which ends in the passed pose
static int spin(Checkpoint *c) {
  Sprite *s = &c->o.sprite;
  const Entity *e = &c->o.slot->e;
  if (off_cam(e->x, e->y)) return 0;
  if (sprite_step(s)) { c->phase = PHASE_PASSED; sprite_start(s, VARIANT_PASSED); }
  object_draw(s, e->x, e->y);
  return 1;
}

static int checkpoint_run(ActTask *t) {
  Checkpoint *c = (Checkpoint *)t->data;
  Sprite *s = &c->o.sprite;
  const Entity *e = &c->o.slot->e;
  Player *p = &act.player;
  if (c->phase == PHASE_SPINNING) return spin(c);
  const Hitbox *hb = object_box(s, 0);
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y);
  if (c->phase == PHASE_WAITING && hb && !p->carried
      && x >= e->x + hb->left && x <= e->x + hb->right && y >= e->y + hb->top && y <= e->y + hb->bottom) {
    // it records where Sonic will start, his feet at its base, and the time, then runs its spinning task at once and goes on
    // with the rest of this one, so the spin's first frame shows for one frame
    act_checkpoint_pass(c->index, e->x, e->y - p->offsetY);
    c->phase = PHASE_SPINNING;
    sprite_start(s, VARIANT_SPIN);
    if (!spin(c)) return 0;
    sprite_step(s);
    return 1;
  }
  if (off_cam(e->x, e->y)) return 0;
  sprite_step(s);
  object_draw(s, e->x, e->y);
  return 1;
}

ActTask *checkpoint_spawn(Slot *slot) {
  if (act.stage.level == LEVEL_EGG_ROCKET) return NULL;   // its checkpoints are the rocket's launch and stage separations
  Checkpoint *c = OBJECT_NEW(Checkpoint);
  if (!c) return NULL;
  const Entity *en = &slot->e;
  c->o.slot = slot;
  c->o.x = en->x;
  c->index = s8(en->d[0]);
  c->phase = c->index <= act_checkpoint_index() ? PHASE_PASSED : PHASE_WAITING;
  object_sprite(&c->o.sprite, ANIM_CHECKPOINT, VARIANT_WAITING, VARIANT_PASSED, ORDER_CHECKPOINT, PRIORITY_FRONT, 0, 0);
  c->o.sprite.variant = c->phase == PHASE_PASSED ? VARIANT_PASSED : VARIANT_WAITING;
  sprite_step(&c->o.sprite);
  return object_task(&c->o, checkpoint_run, PRIORITY_OBJECTS);
}
