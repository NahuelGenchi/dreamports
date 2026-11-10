// Casino Paradise's marble tracks (kinds 65 to 68). Translated from the JavaScript version's engine/marbletrack.js (the
// original's marble_track.c): the pinball tubes Sonic is carried through, curled up and shrunk. A track is a chain of objects
// that hand him on by the step number he carries (act.player.track, 0x7F off any track); each takes him from a lower step, or from no
// track when its own step is 0:
//
// - the entrance (kind 67), a chute he drops into from above: landing on it while on no track takes him in, with his step set
//   to its d3; he falls with gravity, moved across d1 px over d0 frames, until d0 frames have gone, he has dropped more than d2
//   px, or a later step has him. His sprite grows from 0xB0 to full size.
// - the direction points (65): reaching within 8 px across and 10 down of one moves him d0 * 8 px across and d1 * 8 down over d2
//   frames, in a straight line, as step d3. One that ends with no later step to take him lets him go there, standing still.
// - the drop (66): within 12 px of it, he falls with gravity as step d1, for at most d2 * 3 frames or d0 * 8 px, until a later
//   step has him; then he is off the track and on his own.
// - the exit (68), a cup that throws him up: any step he carries, within its 24 px wide box (shifted 24 px left when d2 is set)
//   and 24 px above or below it, takes him off the track and launches him at 5 px a frame, shrinking; as he starts to fall, it
//   lets him go curled up, at full size, unable to steer until he lands. Otherwise it is solid.
//
// The entrance runs at priority 0x1900 + d3, the points at 0x2000 + d3, the drop at 0x2000 + d1 and the exit at 0x2100 + d1, so a
// chain's objects run in its order. Tails' tails and Knuckles' climb past the entrance are not here: only Sonic is.

#include "objects.h"
#include "terrain.h"

enum { MARBLE_DIR = 65, MARBLE_DROP = 66, MARBLE_ENTRANCE = 67, MARBLE_EXIT = 68 };
enum {
  ANIM_MARBLE_TRACK_EXIT = 488, ORDER_TRACK = 18, PRIORITY_FRONT = 2,
  SE_SPRING = 170,
  PRIORITY_ENTRANCE = 0x1900, PRIORITY_POINT = 0x2000, PRIORITY_EXIT = 0x2100,
  LAUNCH = 5,                     // the exit's launch speed, px a frame
  SMALL = 0xB0, FULL = 0x100, GROW = 4,   // his sprite's scale, and how much it changes a frame
  STANDING_OFFSET_Y = 14,         // PLAYERFN_CHANGE_SHIFT_OFFSETS(6, 14): his standing height, curled up or not
  DIR_REACH_X = 8, DIR_REACH_Y = 10, DROP_REACH = 12,
  EXIT_WIDTH = 24, EXIT_REACH_Y = 24,
  STEP_MASK = 0xFF,               // the direction point's count wraps as a byte
};
#define GRAVITY (42 / 256.0)

// the original divides by the frame count as it is; a count of 0 would be a division by zero here
static int div_frames(int a, int b) { return b ? a / b : 0; }
// a 16 bit wrap, as the original's speeds do
static double wrap16(double v) { return (int16_t)(int32_t)(int64_t)v; }

// Player_TransitionCancelFlyingAndBoost
static void cancel(Player *p) { player_end_attack(p); p->pushing = 0; }
static void full_height(Player *p) { sensors_set_offset_y(p, STANDING_OFFSET_Y); }
// the jump and attack buttons he holds then don't count as presses (heldInput, frameInput)
static void no_presses(void) { e.pressed &= (uint16_t)~(KEY_A | KEY_B); }
// taken in: curled up, carried, standing still
static void take_in(Player *p) {
  p->curled = 1; p->carried = 1;
  p->xsp = 0; p->ysp = 0; p->gsp = 0;
  no_presses();
  full_height(p);
}


typedef struct {
  Object o;
  int held, n;
  double dropped;
  // a direction point: where it took him, and where it put him a frame ago
  double x0, y0, lastX, lastY;
  // the exit: where it took him
  double hx, hy;
} Piece;

static Piece *piece_new(Slot *slot, int withSprite) {
  Piece *pc = OBJECT_NEW(Piece);
  if (!pc) return NULL;
  pc->o.slot = slot;
  pc->o.x = slot->e.x;
  if (withSprite) {
    object_sprite(&pc->o.sprite, ANIM_MARBLE_TRACK_EXIT, 0, 0, ORDER_TRACK, PRIORITY_FRONT, 0, 0);
    sprite_step(&pc->o.sprite);
  } else pc->o.sprite.graphics.dest = HEAP_END;
  return pc;
}

// --- the entrance (Task_MarbleTrack_Entrance) --------------------------------------------------------------------------------
static int entrance_run(ActTask *t) {
  Piece *pc = (Piece *)t->data;
  const Entity *e = &pc->o.slot->e;
  Player *p = &act.player;
  int frames = e->d[0], across = s8(e->d[1]), depth = e->d[2], step = e->d[3];
  if (!p->dead) {
    if (pc->held) {
      p->ysp += GRAVITY;
      p->y += p->ysp;
      pc->dropped += p->ysp;
      p->x = e->x + div_frames(across * pc->n, frames);
      act.player.scale = act.player.scale + GROW < FULL ? act.player.scale + GROW : FULL;
      if (++pc->n >= frames || (int)__builtin_floor(pc->dropped) > depth || (act.player.track != NO_TRACK && act.player.track > step)) pc->held = 0;
      else {
        cancel(p);
        p->carried = 1; p->xsp = 0; p->gsp = 0;
        p->state = PS_MARBLE_TRACK;
        full_height(p);
      }
    } else {
      double x = p->x;
      if (act.player.track == NO_TRACK && (collide_platform(&pc->o, e->x, e->y, object_box(&pc->o.sprite, 0), p) & COLLIDE_LANDED)) {
        pc->n = 0; pc->dropped = 0;
        cancel(p);
        p->onObject = NULL;
        act.player.track = step;
        take_in(p);
        p->state = PS_MARBLE_TRACK;
        act.player.scale = SMALL;
        play_song(SE_SPRING);
        pc->held = 1;
        p->x = x;
      }
    }
  }
  if (!pc->held && off_cam(e->x, e->y)) return 0;
  sprite_step(&pc->o.sprite);
  object_draw(&pc->o.sprite, e->x, e->y);
  return 1;
}

// --- a direction point (Task_MarbleTrack_Dir) --------------------------------------------------------------------------------
// (x0, y0) is where it took him, lastX and lastY where it put him a frame ago (in 1/256 px), from which his speeds are worked
// out, wrapping as the original's 16 bit speeds do; they start at 0
static int direction_run(ActTask *t) {
  Piece *pc = (Piece *)t->data;
  const Entity *e = &pc->o.slot->e;
  Player *p = &act.player;
  int dx = s8(e->d[0]) * 8, dy = s8(e->d[1]) * 8, frames = e->d[2], step = e->d[3];
  if (!p->dead) {
    if (pc->held) {
      if (act.player.track == step) {
        p->x = pc->x0 + div_frames(dx * pc->n, frames);
        p->y = pc->y0 + div_frames(dy * pc->n, frames);
        p->xsp = wrap16(p->x * 256 - pc->lastX) / 256;
        p->ysp = wrap16(p->y * 256 - pc->lastY) / 256;
        pc->n = (pc->n + 1) & STEP_MASK;
        if (pc->n >= frames) {
          // the last step lets him go, still
          p->ignoreInput = 0; no_presses();
          p->carried = 0;
          p->xsp = 0; p->ysp = 0; p->gsp = 0;
          pc->held = 0;
        } else {
          p->ignoreInput = 1; p->carried = 1; p->gsp = 0;
          no_presses();
          full_height(p);
        }
        pc->lastX = p->x * 256; pc->lastY = p->y * 256;
      } else pc->held = 0;
    } else if ((p->carried && act.player.track < step) || step == 0) {
      int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
      if (px >= e->x - DIR_REACH_X && px <= e->x + DIR_REACH_X && py >= e->y - DIR_REACH_Y && py <= e->y + DIR_REACH_Y) {
        pc->n = 0;
        p->ignoreInput = 1;
        pc->x0 = px; pc->y0 = py;
        take_in(p);
        play_song(SE_SPRING);
        pc->held = 1;
        act.player.track = step;
      }
    }
  }
  if (!pc->held && off_cam(e->x, e->y)) return 0;
  return 1;
}

// --- the drop (Task_MarbleTrack_Unk) -----------------------------------------------------------------------------------------
// In Secret Base's zone, and in multiplayer stage 15, it also moves him across to it, half a pixel a frame.
static int drop_run(ActTask *t) {
  Piece *pc = (Piece *)t->data;
  const Entity *e = &pc->o.slot->e;
  Player *p = &act.player;
  int depth = s8(e->d[0]) * 8, step = e->d[1], frames = e->d[2] * 3;
  int centre = act.stage.level >> 1 == 1 || act.stage.level == 15;
  if (!p->dead) {
    if (pc->held) {
      p->ysp += GRAVITY;
      p->y += p->ysp;
      pc->dropped += p->ysp;
      if (centre) p->x = p->x < e->x ? (p->x + 0.5 < e->x ? p->x + 0.5 : e->x) : (p->x - 0.5 > e->x ? p->x - 0.5 : e->x);
      if (act.player.track > step || ++pc->n >= frames || (int)__builtin_floor(pc->dropped) > depth) {
        if (act.player.track == step) { act.player.track = NO_TRACK; p->carried = 0; }
        pc->held = 0;
      } else {
        p->carried = 1; p->xsp = 0; p->gsp = 0;
        full_height(p);
      }
    } else if ((p->carried && act.player.track < step) || step == 0) {
      int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
      if (px >= e->x - DROP_REACH && px <= e->x + DROP_REACH && py >= e->y - DROP_REACH && py <= e->y + DROP_REACH) {
        pc->n = 0; pc->dropped = 0;
        p->curled = 1; p->carried = 1;
        p->xsp = 0; p->ysp = 0; p->gsp = 0;
        full_height(p);
        play_song(SE_SPRING);
        pc->held = 1;
        act.player.track = step;
      }
    }
  } else if (pc->held) { pc->held = 0; p->carried = 0; }
  if (!pc->held && off_cam(e->x, e->y)) return 0;
  return 1;
}

// --- the exit (Task_MarbleTrack_Exit) ----------------------------------------------------------------------------------------
// It keeps where it took him, (hx, hy), and moves him from there.
static int exit_run(ActTask *t) {
  Piece *pc = (Piece *)t->data;
  const Entity *e = &pc->o.slot->e;
  Player *p = &act.player;
  int left = e->d[2] != 0 ? -EXIT_WIDTH : 0;
  if (!p->dead) {
    if (pc->held) {
      p->ysp += GRAVITY;
      pc->hy += p->ysp;
      p->y = pc->hy; p->x = pc->hx;
      act.player.scale = act.player.scale - GROW > SMALL ? act.player.scale - GROW : SMALL;
      p->ignoreInput = 1; p->carried = 1;
      if (p->ysp > 0) {
        cancel(p);
        p->state = PS_SPIN;
        p->ignoreInput = 0; no_presses();
        p->carried = 0;
        pc->held = 0;
        act.player.scale = FULL;
      }
    } else {
      int px = (int)__builtin_floor(p->x), py = (int)__builtin_floor(p->y);
      if (act.player.track != NO_TRACK && px >= e->x + left && px <= e->x + left + EXIT_WIDTH && py >= e->y - EXIT_REACH_Y && py <= e->y + EXIT_REACH_Y) {
        pc->hx = p->x; pc->hy = p->y;
        cancel(p);
        p->airLock = 1;   // MOVESTATE_FLIP_WITH_MOVE_DIR: no steering until he lands
        p->air = 1; p->ignoreInput = 1;
        take_in(p);
        p->ysp = -LAUNCH;
        play_song(SE_SPRING);
        act.player.track = NO_TRACK;
        pc->held = 1;
      }
      if (!p->ignoreInput) collide_platform(&pc->o, e->x, e->y, object_box(&pc->o.sprite, 0), p);
    }
  }
  if (off_cam(e->x, e->y)) {
    if (pc->held) { p->ignoreInput = 0; no_presses(); p->carried = 0; }
    return 0;
  }
  sprite_step(&pc->o.sprite);
  object_draw(&pc->o.sprite, e->x, e->y);
  return 1;
}

ActTask *marble_track_spawn(Slot *slot) {
  const Entity *e = &slot->e;
  switch (e->kind) {
    case MARBLE_ENTRANCE: {
      Piece *pc = piece_new(slot, 1);
      return pc ? object_task(&pc->o, entrance_run, PRIORITY_ENTRANCE + e->d[3]) : NULL;
    }
    case MARBLE_DIR: {
      Piece *pc = piece_new(slot, 0);
      return pc ? object_task(&pc->o, direction_run, PRIORITY_POINT | e->d[3]) : NULL;
    }
    case MARBLE_DROP: {
      Piece *pc = piece_new(slot, 0);
      return pc ? object_task(&pc->o, drop_run, PRIORITY_POINT + s8(e->d[1])) : NULL;
    }
    case MARBLE_EXIT: {
      Piece *pc = piece_new(slot, 1);
      return pc ? object_task(&pc->o, exit_run, PRIORITY_EXIT + s8(e->d[1])) : NULL;
    }
    default: return NULL;
  }
}
