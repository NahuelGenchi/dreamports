// Secret Base's swing ropes, kind 78. Translated from the JavaScript version's engine/swingropes.js (the original's
// swing_rope.c): a rope across the act, drawn in its layers, which Sonic grabs when his centre enters its box (d0, d1 its top
// left corner in tiles from the entity, d2 by d3 its size). He swings round it as he slides along it to the right, at half the
// ground speed he came with, gaining 1/16 px a frame each frame up to 0.90625 and 1/16 more while right is held (left takes it
// back off, not below that), up to 9 px a frame. Jump throws him off at 6.75 px a frame, up or down as held, or else the way
// his swing is going. It doesn't take him again for 20 frames.

#include "objects.h"
#include "terrain.h"

enum {
  SLOWEST = 232, FASTEST = 2304, PUSH = 16, GAIN = 16,   // in 1/256 px a frame
  TURN = 30,     // frames his swing takes, as its animation does
  WAIT = 20,
  THROWN_Y = 9,  // where it lets him go, below the rope
};
#define THROW 6.75

typedef struct {
  Object o;
  int left, right, top, bottom;
  int holding, speed, turn, wait;   // whether it holds him, his speed along it, the frames of his swing, and before it takes him again
} SwingRope;

static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

static void hold(SwingRope *r, const Entity *en, Player *p) {
  if (r->speed < SLOWEST) r->speed += GAIN;
  if (r->speed > FASTEST) r->speed = FASTEST;
  p->y = en->y + 1;
  int x = (int)__builtin_floor(p->x);
  if (r->left <= x && r->right >= x) {
    p->x += r->speed / 256.0;
    if (p->held[0] & DPAD_RIGHT) r->speed += PUSH;
    else if ((p->held[0] & DPAD_LEFT) && r->speed > SLOWEST) r->speed -= PUSH;
    // a wall left of him pushes him back out (sub_801F100 scanning left)
    int d = terrain_tile_scan(PROBE_WALL, (int)__builtin_floor(p->x) - 8, (int)__builtin_floor(p->y), p->layer, -8);
    if (d < 0) p->x -= d;
  }
  p->ysp = 0;
  if (p->jumpPressed) {
    cancel(p);
    p->ignoreInput = 0; p->carried = 0; p->curled = 1; p->air = 1; p->airLock = 0; p->jumped = 0;
    // it counts jump and attack as held, so a press of either on this frame isn't one
    p->jumpPressed = p->attackPressed = 0;
    e.pressed &= (uint16_t)~(KEY_A | KEY_B);
    int held = p->held[0];
    if (held & (DPAD_UP | DPAD_DOWN)) p->ysp = held & DPAD_UP ? -THROW : THROW;
    else p->ysp = r->turn / (TURN / 2) != 0 ? THROW : -THROW;
    p->state = PS_SPIN;
    player_curl_up(p);
    p->y = en->y + THROWN_Y;
    p->gsp = 0; p->xsp = 0;
    r->holding = 0; r->turn = 0; r->wait = WAIT;
    p->prio = 2;   // his sprite back at priority 2, which the original sets in its flags
    p->sprite.frameFlags = (p->sprite.frameFlags & ~(uint32_t)SPRITE_PRIORITY) | 2u << 12;
  }
  r->turn = (r->turn + 1) % TURN;
}

// Task_SwingRope
static int rope_run(ActTask *t) {
  SwingRope *r = (SwingRope *)t->data;
  const Entity *en = &r->o.slot->e;
  Player *p = &act.player;
  if (p->dead) {
    if (r->holding) { p->carried = 0; r->holding = 0; }
  } else if (r->holding) hold(r, en, p);
  else if (r->wait > 0) r->wait--;
  else {
    int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
    if (r->left <= px && r->right >= px && r->top <= py && r->bottom >= py) {
      int speed = (int)__builtin_floor(p->gsp * 256 + 0.5) >> 1;
      r->speed = speed > 0 ? speed : 0;
      cancel(p);
      p->carried = 1; p->air = 0; p->jumped = 0;
      r->holding = 1;
      p->state = PS_SWING_ROPE;
      player_stand_up(p);
      r->turn = 0;
    }
  }
  return r->holding || !off_cam(en->x, en->y);
}

// CreateEntity_SwingRope
ActTask *swing_rope_spawn(Slot *slot) {
  SwingRope *r = OBJECT_NEW(SwingRope);
  if (!r) return NULL;
  const Entity *e = &slot->e;
  r->o.slot = slot;
  r->o.x = e->x;
  r->o.sprite.graphics.dest = HEAP_END;
  r->left = e->x + (int8_t)e->d[0] * 8; r->right = r->left + e->d[2] * 8;
  r->top = e->y + (int8_t)e->d[1] * 8; r->bottom = r->top + e->d[3] * 8;
  return object_task(&r->o, rope_run, PRIORITY_OBJECTS);
}
