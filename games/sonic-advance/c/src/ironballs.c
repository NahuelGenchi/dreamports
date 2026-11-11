// Iron balls (kind 82). Translated from the JavaScript version's engine/ironballs.js (the original's iron_ball.c:
// CreateEntity_IronBall and Task_IronBallMain): a spiked ball that swings with the stage clock as a moving spring does,
// d2 * 8 px either way across when d2 is above d3, else d3 * 8 px either way up and down, one swing every 256 frames, half a
// swing later when the sign of d0 (across) or d1 (up and down) is set. It hurts Sonic where its box meets his body and is
// never solid. Its sprite steps once, when it is made: the frame and its box stay as they are from then on.

#include "objects.h"

enum {
  ANIM_IRON_BALL = 510, ANIM_IRON_BALL_ANGEL_ISLAND = 541,
  ORDER_BALL = 18, PRIORITY_FRONT = 2,
  SWING_HALF = 0x80,
};

typedef struct { Object o; int across, phase, reach; } IronBall;

static int iron_ball_run(ActTask *t) {
  IronBall *b = (IronBall *)t->data;
  const Entity *en = &b->o.slot->e;
  int swing = ((int32_t)((uint32_t)b->reach * (uint32_t)(int32_t)SINE[(4 * ((act_stage_time() + b->phase) & 0xFF)) & 0x3FF]) >> 14) >> 8;
  int x = en->x + (b->across ? swing : 0), y = en->y + (b->across ? 0 : swing);
  // Coll_Player_Entity_Intersection, then Coll_DamagePlayer
  Player *p = &act.player;
  const Hitbox *hb = object_box(&b->o.sprite, 0);
  Hitbox body = collide_body(p);
  if (!p->dead && hb && collide_overlap(x, y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), &body)) world_damage(p);
  if (off_display(en->x, en->y) && off_cam(x, y)) return 0;
  object_draw(&b->o.sprite, x, y);
  return 1;
}

/** CreateEntity_IronBall */
ActTask *iron_ball_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  IronBall *b = OBJECT_NEW(IronBall);
  if (!b) return NULL;
  b->across = en->d[2] > en->d[3];
  b->phase = s8(b->across ? en->d[0] : en->d[1]) < 0 ? SWING_HALF : 0;
  b->reach = (b->across ? en->d[2] : en->d[3]) << 11;
  b->o.slot = slot;
  b->o.x = en->x;
  object_sprite(&b->o.sprite, act.stage.zone == ZONE_ANGEL_ISLAND ? ANIM_IRON_BALL_ANGEL_ISLAND : ANIM_IRON_BALL, 0, 0,
                ORDER_BALL, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);
  return object_task(&b->o, iron_ball_run, PRIORITY_OBJECTS);
}
