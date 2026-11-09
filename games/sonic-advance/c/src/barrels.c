// Casino Paradise's small Barrel of Doom (kind 57). Translated from the JavaScript version's engine/barrels.js (the original's
// platform_square.c, Task_BarrelOfDoomMini): a barrel that bobs on a spring. Sonic lands on its top as on a crumbling platform,
// from any side while he isn't rising, and landing pushes it down by 6/10 of his falling speed. Off its place it is pulled back at
// 48/256 px a frame per frame, its speed loses 1% a frame, and it comes to rest when that speed is under 48/256 px a frame within
// 3 px of its place.
//
// Standing on it he moves with it, kept on its top while his feet are within 8 px of it. His presses from his last frame count:
// jump throws him off at half its speed less 4 px a frame up, as his own jump starts; with down held, jump only curls him up on it,
// and attack does nothing (both are Amy's moves in the original).

#include "objects.h"
#include "terrain.h"

enum {
  BARREL_OF_DOOM_MINI = 57,
  ANIM_BARREL_MINI = 493, ORDER_BARREL = 18, PRIORITY_FRONT = 2,
  PULL = 48,                           // 1/256 px a frame per frame
  REST_SPEED = 48, REST_RANGE = 3 * 256,
  JUMP = 4 * 256,                      // what a jump off it takes from half its speed
  GLUE = 8,                            // how far down he is put to see whether he is still on it
  BALL_SPRITE_OFFSET_Y = 9,            // from his centre to the ground curled up
  LANDING_SHARE = 6, LANDING_OF = 10,  // it takes 6/10 of the speed he lands at
  DAMPING = 9900, DAMPING_OF = 10000,  // and loses 1% of its speed a frame
};

typedef struct {
  Object o;
  int speed;   // its speed and how far down from its place it is (qUnk3C, qUnk44), in 1/256 px
  int at;
} Barrel;

static int barrel_run(ActTask *t) {
  Barrel *b = (Barrel *)t->data;
  const Entity *en = &b->o.slot->e;
  Player *p = &act.player;
  if (b->at != 0) b->speed += b->at < 0 ? PULL : -PULL;
  int y = en->y + (b->at >> 8);
  const Hitbox *hb = object_box(&b->o.sprite, 0);
  double fall = p->ysp * 256;
  if (p->onObject == &b->o) {
    p->ysp = 0;
    p->y += b->speed / 256.0;
    if (p->attackPressed && (p->heldDirs & DPAD_DOWN)) {
      // Amy's
    } else if (p->jumpPressed && (p->heldDirs & DPAD_DOWN)) sensors_set_offset_y(p, BALL_SPRITE_OFFSET_Y);
    else if (p->jumpPressed) {
      p->ysp = ((b->speed >> 1) - JUMP) / 256.0;
      p->onObject = NULL;
    } else {
      p->y += GLUE; p->ysp = 1 / 256.0;
      if (!collide_platform_top(&b->o, en->x, y, hb, p)) { p->onObject = NULL; p->y -= GLUE; }
      p->ysp = 0;
    }
  } else if (collide_platform_top(&b->o, en->x, y, hb, p) & COLLIDE_LANDED) b->speed += (int)(fall * LANDING_SHARE / LANDING_OF);
  b->speed = b->speed * DAMPING / DAMPING_OF;
  if (b->speed > -REST_SPEED && b->speed < REST_SPEED && b->at > -REST_RANGE && b->at < REST_RANGE) b->speed = 0;
  b->at += b->speed;
  if (off_display(en->x, en->y) && off_cam(en->x, y)) return 0;
  object_draw(&b->o.sprite, en->x, y);
  return 1;
}

ActTask *barrel_spawn(Slot *slot) {
  Barrel *b = OBJECT_NEW(Barrel);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  object_sprite(&b->o.sprite, ANIM_BARREL_MINI, 0, 0, ORDER_BARREL, PRIORITY_FRONT, 0, 0);
  sprite_step(&b->o.sprite);   // its one frame, and with it its box, comes when it is made
  return object_task(&b->o, barrel_run, PRIORITY_OBJECTS);
}
