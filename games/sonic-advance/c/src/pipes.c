// The pipe entrances and exits (kinds 110 and 111). Translated from the JavaScript version's engine/pipes.js (the original's
// pipe.c). An entrance catches Sonic curled up, pulls him into its mouth and carries him a first stretch, unless a tube track
// (tubes.c) takes him on the way; an exit throws him out. Both are solid to him otherwise. Like the tracks, each runs at the
// objects' priority plus its step d3, and an entrance sets his `track` to 0 (player.h).
//
// The original makes a task for each player, the first's showing the sprite; there is one player here. Zone 6 and Chao Hunt D
// draw their own pipes and turn the vertical mouths round; those looks aren't here, only the other levels' (Secret Base's).

#include "objects.h"
#include "terrain.h"

enum {
  ANIM_PIPE_H = 588, ANIM_PIPE_V = 589,     // SA1_ANIM_PIPE_GATE_2_H and _V
  VARIANT_ENTRANCE = 0, VARIANT_EXIT = 1,
  PIPE_TILES = 70,                          // ALLOC_TILES: 80 x 56 px either way round
  ORDER_PIPE = 5, PRIORITY_BEHIND = 0,
  SE_SPIN_ATTACK = 109,
  STANDING_OFFSET_Y = 14,                   // his standing height, curled up or not
  FACE_DOWN = 0, FACE_UP = 1, FACE_RIGHT = 2, FACE_LEFT = 3,
  PULL = 90, PULL_SOUND = 45,               // the entrance's pull: frames, and the one it sounds on
  ENTRANCE_STEPS = 20,                      // frames of its stretch
  COUNT_MASK = 0xFF,                        // its frame count is a byte
  EXIT_FRAMES = 15,
};
enum { PULL_SPEED = 384 };                  // Q(1.5), in 1/256 px

static int floor_of(double v) { return (int)__builtin_floor(v); }
static double wrap16(double v) { return (int16_t)(int32_t)(int64_t)v; }
static int q(double v) { return (int)__builtin_floor(v * 256 + 0.5); }

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }

// the jump and attack buttons he holds then don't count as presses (heldInput, frameInput)
static void no_presses(void) { e.pressed &= (uint16_t)~(KEY_A | KEY_B); }

// curled up and held, standing tall: PLAYERFN_CHANGE_SHIFT_OFFSETS(p, 6, 14) keeps his feet where they were
static void hold(Player *p) {
  p->carried = 1; p->state = PS_SPIN;
  sensors_set_offset_y(p, STANDING_OFFSET_Y);
}

typedef struct {
  Object o;
  int face, step, phase;
  int n;               // unk3F (unk3E on an exit): the entrance's pull counting down, then its stretch counting up
  int carrying;        // unk58
  double prevX, prevY; // unk50 and unk54: where the stretch put him a frame ago (1/256 px), 0 before its first use
} Pipe;
enum { WAITING, PULLING, CARRYING, HOLDING = PULLING, THROWING = CARRYING };

static int vertical(const Pipe *pi) { return pi->face == FACE_DOWN || pi->face == FACE_UP; }

static Pipe *pipe_new(Slot *slot, int variant, int flipY) {
  Pipe *pi = OBJECT_NEW(Pipe);
  if (!pi) return NULL;
  pi->o.slot = slot;
  pi->o.x = slot->e.x;
  pi->face = slot->e.d[2]; pi->step = slot->e.d[3];
  int v = vertical(pi);
  object_sprite_at(&pi->o.sprite, vram_malloc(PIPE_TILES), v ? ANIM_PIPE_V : ANIM_PIPE_H, variant, ORDER_PIPE, PRIORITY_BEHIND,
                   !v && (pi->face & 1), v && flipY);
  sprite_step(&pi->o.sprite);   // its animation steps once as it is made
  return pi;
}

static int show(Pipe *pi) {
  sprite_step(&pi->o.sprite);
  object_draw(&pi->o.sprite, pi->o.slot->e.x, pi->o.slot->e.y);
  return 1;
}

// --- the entrance (Task_PipeEntrance, Task_8095D28, Task_8095E90) --------------------------------------------------------------
// d2 is which way it faces: 0 and 1 up and down, taking him as he lands on it or bumps it from below (the other way round under
// inverted gravity), 2 and 3 across, taking him as he runs into its right or left side. It pulls him to its point for 90 frames,
// then carries him d0, d1 tiles in 20 frames if no track took him on the way. It only goes off screen while it waits.

// 1.5 px a frame toward (x, y), down or up first, stopping on it
static void pull(Player *p, int x, int y) {
  int tx = x * 256, ty = y * 256, px = q(p->x), py = q(p->y);
  if (py < ty) { py += PULL_SPEED; if (py > ty) py = ty; } else if (py > ty) { py -= PULL_SPEED; if (py < ty) py = ty; }
  if (px < tx) { px += PULL_SPEED; if (px > tx) px = tx; } else if (px > tx) { px -= PULL_SPEED; if (px < tx) px = tx; }
  p->x = px / 256.0; p->y = py / 256.0;
}

// one frame of the stretch: the speeds are what he moved since the last frame it moved him (from 0 on its first use, so wild).
// True once he is at its end.
static int carry(Player *p, Pipe *pi, int x, int y, int dx, int dy) {
  int qx = (x + pi->n * dx / ENTRANCE_STEPS) * 256, qy = (y + pi->n * dy / ENTRANCE_STEPS) * 256;
  p->x = qx / 256.0; p->y = qy / 256.0;
  p->ysp = wrap16(qy - pi->prevY) / 256;
  p->gsp = p->xsp = wrap16(qx - pi->prevX) / 256;
  pi->n = (pi->n + 1) & COUNT_MASK;
  pi->prevX = qx; pi->prevY = qy;
  return floor_of(p->x) == x + dx && floor_of(p->y) == y + dy;
}

// the side of a vertical entrance that takes him, as a Coll_Player_Platform result
static int mouth(const Pipe *pi, const Player *p) {
  return (pi->face != FACE_DOWN) == (p->inverted != 0) ? COLLIDE_FROM_BELOW : COLLIDE_LANDED;
}

// taken in, back where he was before the collision put him out of it
static void take_in(Pipe *pi, Player *p, double x, double y) {
  cancel(p);
  pi->n = PULL;
  p->onObject = NULL; p->air = !vertical(pi); p->airLock = 0;
  p->curled = 1;
  p->x = x; p->y = y;
  p->xsp = p->ysp = p->gsp = 0;
  p->track = 0;
  hold(p);
  pi->phase = PULLING;
}

static int entrance_run(ActTask *t) {
  Pipe *pi = (Pipe *)t->data;
  const Entity *en = &pi->o.slot->e;
  Player *p = &act.player;
  int x = en->x, y = en->y;
  switch (pi->phase) {
  case WAITING: {
    // dead, it sets what his own death step sets
    const Hitbox *box = object_box(&pi->o.sprite, 0);
    if (!p->dead && box) {
      double px = p->x, py = p->y;
      int hit = collide_platform(&pi->o, x, y, box, p);
      if (vertical(pi) ? hit & mouth(pi, p)
          : (hit & COLLIDE_RIGHT_FACE && pi->face == FACE_RIGHT) || (hit & COLLIDE_LEFT_FACE && pi->face == FACE_LEFT))
        take_in(pi, p, px, py);
    }
    if (off_cam(x, y)) return 0;
    break;
  }
  case PULLING:
    if (p->dead) { p->carried = 0; break; }
    if (pi->n != 0) {
      pull(p, x, y);
      if (--pi->n == PULL_SOUND) play_song(SE_SPIN_ATTACK);
    } else {
      // the count runs on from 0 along the stretch
      pi->carrying = 1;
      p->onObject = NULL;
      pi->phase = CARRYING;
    }
    cancel(p); p->state = PS_SPIN;
    break;
  default:   // CARRYING
    if (!pi->carrying) {
      pi->phase = WAITING;
      if (off_cam(x, y)) return 0;
    } else if (p->dead) { pi->carrying = 0; p->carried = 0; }
    else if (p->track != pi->step) pi->carrying = 0;   // a track has him
    else if (carry(p, pi, x, y, s8(en->d[0]) * 8, s8(en->d[1]) * 8)) { p->carried = 0; pi->carrying = 0; }
    else { cancel(p); hold(p); }
    break;
  }
  return show(pi);
}

// CreateEntity_PipeEntrance: a vertical one is drawn upside down unless it faces down
ActTask *pipe_entrance_spawn(Slot *slot) {
  Pipe *pi = pipe_new(slot, VARIANT_ENTRANCE, slot->e.d[2] != FACE_DOWN);
  return pi ? object_task(&pi->o, entrance_run, PRIORITY_OBJECTS | pi->step) : NULL;
}

// --- the exit (Task_PipeExit, Task_809656C, Task_8096724) ---------------------------------------------------------------------
// d2 is which way it throws, 0 down, 1 up, 2 right, 3 left, at d1 / 4 px a frame. It takes him when a tube holds him on a step
// below its d3 and his body touches it. On the next frame it gives him his speed, then moves him for 15 frames and lets him go,
// curled up in the air; a jump or attack pressed on that last frame doesn't count.

// Coll_Player_Entity_Intersection: his body's box against the exit's first hitbox
static int touches(const Pipe *pi, int x, int y, const Player *p) {
  const Hitbox *box = object_box(&pi->o.sprite, 0);
  Hitbox body = collide_body(p);
  return box && collide_overlap(x, y, box, floor_of(p->x), floor_of(p->y), &body);
}

static int exit_run(ActTask *t) {
  Pipe *pi = (Pipe *)t->data;
  const Entity *en = &pi->o.slot->e;
  Player *p = &act.player;
  int x = en->x, y = en->y;
  switch (pi->phase) {
  case WAITING:
    if (p->dead) {
      // dead, it sets what his own death step sets
    } else if (!p->carried) {
      const Hitbox *box = object_box(&pi->o.sprite, 0);
      if (box) collide_platform(&pi->o, x, y, box, p);
    } else if (p->track < pi->step && touches(pi, x, y, p)) {
      // its pull toward its point (unk3E) never runs: it puts him there and zeroes the count
      pi->n = 0;
      cancel(p);
      p->onObject = NULL; p->air = 0; p->airLock = 0;
      p->curled = 1;
      p->x = x; p->y = y;
      p->xsp = p->ysp = p->gsp = 0;
      p->jumpPressed = 0; p->attackPressed = 0; no_presses();
      p->track = NO_TRACK;
      hold(p);
      pi->phase = HOLDING;
    }
    if (off_cam(x, y)) return 0;
    break;
  case HOLDING:
    // dead, it stays here
    if (!p->dead) {
      double speed = s8(en->d[1]) * 64 / 256.0, v = pi->face & 1 ? -speed : speed;
      if (vertical(pi)) { p->ysp = v; p->xsp = p->gsp = 0; }
      else { p->facing = pi->face & 1 ? -1 : 1; p->ysp = 0; p->xsp = p->gsp = v; }
      pi->n = EXIT_FRAMES;
      pi->phase = THROWING;
      cancel(p); p->state = PS_SPIN; p->air = 1;
    }
    break;
  default:   // THROWING
    if (pi->n == 0) {
      pi->phase = WAITING;
      if (off_cam(x, y)) return 0;
    } else if (!p->dead) {   // dead, it stays here
      pi->n--;
      p->x += p->xsp; p->y += p->ysp;
      if (pi->n == 0) {
        p->ignoreInput = 0;
        p->jumpPressed = 0; p->attackPressed = 0; no_presses();
        p->track = NO_TRACK;
        p->carried = 0;
      }
    }
    break;
  }
  return show(pi);
}

// CreateEntity_PipeExit: a vertical one is drawn upside down unless it throws down
ActTask *pipe_exit_spawn(Slot *slot) {
  Pipe *pi = pipe_new(slot, VARIANT_EXIT, slot->e.d[2] != FACE_DOWN);
  return pi ? object_task(&pi->o, exit_run, PRIORITY_OBJECTS | pi->step) : NULL;
}
