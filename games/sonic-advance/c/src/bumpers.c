// Casino Paradise's bumpers and the wall bumper. Translated from the JavaScript version's engine/bumpers.js (the original's
// bumpers.c). Touching a bumper throws Sonic off it curled up, in the air, at a speed that depends on where he touched it, and
// shakes it for 9 frames; it keeps throwing him every frame he still touches it. None animates: each shows its animation's first
// frame, with that frame's hitbox.
//
// The hexagon (48) and the round bumper (49) throw him at a speed picked by the angle from their centre to his; they can sway
// along x (the hexagon) or x or y (the round one, whichever of d2 and d3 is larger). The circling round bumper (50) goes round its
// spot. The small triangles, lying (51) and standing (52), throw him off whichever side he touches; the big right-angled one (53)
// only off its slanted side. The wall bumper (71) is part of the scenery: it throws him while his centre is in its area.
//
// A flying Tails or a gliding Knuckles stops as a bumper throws him; only Sonic is here, so that has nothing to do. The original's
// bug that makes the circling bumper work out its angle from 8 times its offset is kept, and so is the shake's last two frames
// reading past the sine table's end (the JavaScript version's fixes are off).

#include "objects.h"

enum {
  BUMPER_HEXAGON = 48, BUMPER_ROUND, BUMPER_CIRCLING, BUMPER_TRI_H, BUMPER_TRI_V, BUMPER_RIGHT_ANGLE, WALL_BUMPER = 71,
};
enum {
  ANIM_RIGHT_ANGLE = 475, ANIM_TRI_H = 476, ANIM_TRI_V = 477, ANIM_HEXAGON = 484, ANIM_ROUND = 485,
  ORDER_BUMPER = 18, PRIORITY_FRONT = 2,
  SE_BUMPER_A = 183, SE_BUMPER_B = 184,      // the hexagonal and round bumpers' sound, and the triangular ones'
  BALL_OFFSET_Y = 9,                         // Sonic's height from his centre to the ground curled up
  POINTS = 10,
  SHAKE_END = 8,                             // the last frame of the shake that is a shake frame
  SHAKE_FRAMES = 10,                         // the shake's tables, which its last frame (9) reads
  SWAY_UNIT = 2048,                          // d * 8 px in 1/256 px
  SWAY_PHASE_HALF = 0x80, SWAY_PERIOD = 0x100,   // a sway is one turn of the stage clock every 256 frames
  CIRCLE_MASK = 0x7FF, CIRCLE_START_MASK = 7,
  WALL_SPEED_X = 5, WALL_SPEED_UP = 7, WALL_SPEED_DOWN = 6, WALL_DOWN_FROM = 3,
};
static const int FAST = 1638;                // Q(6.3984375): straight off a side
static const int STANDING_FAST = 0x666;      // the standing triangle's throw off its left, the same speed
static const int SLANT_A = 0x297, SLANT_B = 0x5D9;   // off a corner, across and along
static const int CORNER = 1200;              // Q(4.6875): off the right-angled one's slant
// COS(c * 128) >> 12 and SIN(c * 128) >> 12 for shake frames 0-9: the last two read past the table's end, where the ROM has 1 and
// 482 for their cosines, which don't move it across
static const int SHAKE_X[SHAKE_FRAMES] = { 4, 2, 0, -3, -4, -3, 0, 2, 0, 0 };
static const int SHAKE_Y[SHAKE_FRAMES] = { 0, 2, 4, 2, 0, -3, -4, -3, 0, 2 };
// SIN(-1), for the angle of a touch dead on the centre: the halfword before the sine table in the ROM
static const int SIN_BEFORE = 2048;

typedef struct {
  Object o;
  int kind, flipX, flipY;
  int alongX, alongY, phase;       // the sway: along x (unk48), along y (unk4A), its phase (unk3C)
  int start, speed, radius;        // the circling one: where it starts round, which way it goes, how far out
  int qx, qy;                      // its offset from its spot, in 1/256 px (unk40, unk44)
  int shaking, c;                  // the shake, and its frame
} Bumper;

static int floor_of(double v) { return (int)__builtin_floor(v); }
static int angle_to(const Player *p, int x, int y) { return quick_angle(floor_of(p->y) - y, floor_of(p->x) - x); }   // sub_8004418
static int sine_at(int i) { return i < 0 ? SIN_BEFORE : SINE[i]; }

// Coll_Player_Entity_Intersection: his body's box against the bumper's first hitbox
static int touches(const Bumper *b, int x, int y, const Player *p) {
  const Hitbox *box = object_box(&b->o.sprite, 0);
  Hitbox body = collide_body(p);
  return !p->dead && box && collide_overlap(x, y, box, floor_of(p->x), floor_of(p->y), &body);
}

// thrown off: in the air and curled up, with his ball's height; it isn't a jump, so letting go of the button doesn't cut it short,
// and he can steer
static void throw_off(Player *p) {
  p->onObject = NULL; p->air = 1;
  p->jumped = 0;               // MOVESTATE_100
  p->curled = 1;
  p->airLock = 0;              // MOVESTATE_FLIP_WITH_MOVE_DIR
  p->offsetY = BALL_OFFSET_Y;
}

static void set_speed(Player *p, int xsp, int ysp) { p->xsp = xsp / 256.0; p->ysp = ysp / 256.0; }

// the round bumpers' throw: along the angle, at the sine table's scale (Q2.14) over 15 in 1/256 px
static void round_throw(Player *p, int rot) {
  p->xsp = (SINE[rot + 256] / 15) / 256.0;
  p->gsp = p->xsp;
  p->ysp = (sine_at(rot) / 15) / 256.0;
  if (p->xsp == 0) p->xsp = 8 / 256.0;
  world_add_score_jingle(POINTS);
  play_song(SE_BUMPER_A);
}

// BumperCheckCollAndPosA1: the hexagon
static void hexagon_throw(Player *p, int angle) {
  uint32_t rot = (uint32_t)angle;
  if (rot - 0x40 > 0x380) p->xsp = FAST / 256.0;
  else if (rot - 0x1C1 <= 0x88) p->xsp = -FAST / 256.0;
  else if (rot > 0x249) set_speed(p, rot > 0x300 ? SLANT_A : -SLANT_A, -SLANT_B);
  else if (rot > 0x100) set_speed(p, -SLANT_A, SLANT_B);
  else set_speed(p, SLANT_A, SLANT_B);
}

// BumperCheckCollAndPosC1: the lying triangle
static void tri_h_throw(Player *p, int angle, int upsideDown) {
  uint32_t rot = (uint32_t)angle;
  if (upsideDown) {
    if (rot >= 0x200) p->ysp = -FAST / 256.0;
    else set_speed(p, rot < 0x100 ? SLANT_A : -SLANT_A, SLANT_B);
  } else if (rot > 0x1EE) set_speed(p, rot > 0x300 ? SLANT_A : -SLANT_A, -SLANT_B);
  else if (rot < 0x15) set_speed(p, SLANT_A, -SLANT_B);
  else p->ysp = FAST / 256.0;
}

// BumperCheckCollAndPosC2: the standing triangle
static void tri_v_throw(Player *p, int angle, int right) {
  uint32_t rot = (uint32_t)angle;
  if (right) {
    if (rot - 0xFD >= 0x207) p->xsp = FAST / 256.0;
    else set_speed(p, -SLANT_B, rot > 0x200 ? -SLANT_A : SLANT_A);
  } else if (rot - 0x104 <= 0x1F8) p->xsp = -STANDING_FAST / 256.0;
  else set_speed(p, SLANT_B, rot > 0x200 ? -SLANT_A : SLANT_A);
}

// BumperCheckCollAndPosC3: the right-angled one throws him only when he is past the line of its slant
static int right_angle_throw(Player *p, int x, int y, int flipX, int flipY) {
  int dy = floor_of(p->y) - y, dx = floor_of(p->x) - x;
  if (flipY) {
    if (!(dy < 65 - (flipX ? -dx : dx))) return 0;
    throw_off(p);
    set_speed(p, flipX ? -CORNER : CORNER, CORNER);
  } else {
    if (!(dy > (flipX ? -dx : dx) - 60)) return 0;
    throw_off(p);
    set_speed(p, flipX ? -CORNER : CORNER, -CORNER);
  }
  return 1;
}

// the sway of the hexagon and the round bumper, in 1/256 px: d * 8 px each way, a turn every 256 frames
static int sway(int d, int phase, int t) {
  int32_t sine = SINE[(4 * ((t + phase) & (SWAY_PERIOD - 1))) & 0x3FF];
  return (int32_t)((uint32_t)(d * SWAY_UNIT) * (uint32_t)sine) >> 14;
}

// whether it throws him this frame
static int test(Bumper *b, Player *p) {
  const Entity *e = &b->o.slot->e;
  int x = e->x, y = e->y;
  switch (b->kind) {
    case BUMPER_HEXAGON: case BUMPER_ROUND:
      x += b->qx >> 8; y += b->qy >> 8;
      if (!touches(b, x, y, p) || p->carried) return 0;
      throw_off(p);
      if (b->kind == BUMPER_HEXAGON) { hexagon_throw(p, angle_to(p, x, y)); play_song(SE_BUMPER_A); }
      else round_throw(p, angle_to(p, x, y));
      break;
    case BUMPER_CIRCLING:
      if (!touches(b, x + (b->qx >> 11), y + (b->qy >> 11), p)) return 0;
      throw_off(p);
      round_throw(p, angle_to(p, x + (b->qx >> 8), y + (b->qy >> 8)));   // 8 times its offset: the original's bug
      break;
    case BUMPER_TRI_H:
      if (p->carried || !touches(b, x, y, p)) return 0;
      throw_off(p);
      tri_h_throw(p, angle_to(p, x, y), b->flipY);
      play_song(SE_BUMPER_B);
      break;
    case BUMPER_TRI_V:
      if (!touches(b, x, y, p) || p->carried) return 0;
      throw_off(p);
      tri_v_throw(p, angle_to(p, x, y), b->flipX);
      play_song(SE_BUMPER_B);
      break;
    default:
      if (!touches(b, x, y, p) || p->carried || !right_angle_throw(p, x, y, b->flipX, b->flipY)) return 0;
      play_song(SE_BUMPER_B);
      break;
  }
  b->c = 0;
  return 1;
}

static int bumper_run(ActTask *t) {
  Bumper *b = (Bumper *)t->data;
  const Entity *e = &b->o.slot->e;
  int tick = act.tick;
  int inShake = b->shaking;
  if (b->shaking && ++b->c > SHAKE_END) b->shaking = 0;
  if (b->alongX) b->qx = sway(e->d[2], b->phase, tick);
  if (b->alongY) b->qy = sway(e->d[3], b->phase, tick);
  if (b->kind == BUMPER_CIRCLING) {
    int a = (((int32_t)((uint32_t)b->speed * (uint32_t)tick) + b->start) & CIRCLE_MASK) >> 1;
    b->qx = SINE[a] * b->radius; b->qy = SINE[a + 256] * b->radius;
  }
  int x = e->x, y = e->y;
  if (b->kind == BUMPER_CIRCLING) { x += b->qx >> 11; y += b->qy >> 11; } else { x += b->qx >> 8; y += b->qy >> 8; }
  // in the shake, the hexagon, the swaying round bumper and the standing triangle look for him before it moves; the others after
  int sideways = b->flipX ? 1 : -1;
  if (!inShake) {
    if (test(b, &act.player)) b->shaking = 1;
  } else if (b->kind == BUMPER_HEXAGON || b->kind == BUMPER_ROUND || b->kind == BUMPER_TRI_V) {
    test(b, &act.player);
    x += sideways * SHAKE_X[b->c]; y += SHAKE_Y[b->c];
  } else {
    x += sideways * SHAKE_X[b->c]; y += SHAKE_Y[b->c];
    test(b, &act.player);
  }
  if (off_display(e->x, e->y) && off_cam(x, y)) return 0;
  object_draw(&b->o.sprite, x, y);
  return 1;
}

// --- the wall bumper (Task_WallBumper) -----------------------------------------------------------------------------------------
// While his centre is in its area, d2 * 8 px across and d3 * 8 down, it throws him every frame at 5 px a frame across (right when
// d0 is odd, else left) and 7 up, or 6 down when d0 is 3 or more, without curling him up.
static int wall_run(ActTask *t) {
  Slot *slot = (Slot *)t->data;
  const Entity *e = &slot->e;
  Player *p = &act.player;
  int dir = s8(e->d[0]);
  int px = floor_of(p->x), py = floor_of(p->y);
  if (!p->dead && px >= e->x && px <= e->x + e->d[2] * 8 && py >= e->y && py <= e->y + e->d[3] * 8) {
    play_song(SE_BUMPER_B);
    p->jumped = 0; p->air = 1; p->airLock = 0;
    p->xsp = dir & 1 ? WALL_SPEED_X : -WALL_SPEED_X;
    p->ysp = dir < WALL_DOWN_FROM ? -WALL_SPEED_UP : WALL_SPEED_DOWN;
  }
  if (off_display(e->x, e->y)) { slot->live = NULL; return 0; }
  return 1;
}

ActTask *bumper_spawn(Slot *slot) {
  const Entity *e = &slot->e;
  if (e->kind == WALL_BUMPER) return act_task_add(wall_run, NULL, slot, PRIORITY_OBJECTS);
  Bumper *b = OBJECT_NEW(Bumper);
  if (!b) return NULL;
  int k = e->kind;
  b->o.slot = slot;
  b->o.x = e->x;
  b->kind = k;
  b->flipX = (k == BUMPER_TRI_V || k == BUMPER_RIGHT_ANGLE) && e->d[0] == 0;
  b->flipY = (k == BUMPER_TRI_H && e->d[0] == 0) || (k == BUMPER_RIGHT_ANGLE && e->d[1] == 0);
  int anim = k == BUMPER_HEXAGON ? ANIM_HEXAGON : k == BUMPER_ROUND || k == BUMPER_CIRCLING ? ANIM_ROUND
    : k == BUMPER_TRI_H ? ANIM_TRI_H : k == BUMPER_TRI_V ? ANIM_TRI_V : ANIM_RIGHT_ANGLE;
  // all but the hexagon share their kind's tiles, at fixed places below the heap (vram_hardcoded.h)
  uint32_t fixed = k == BUMPER_ROUND || k == BUMPER_CIRCLING ? VRAM_BUMPER : k == BUMPER_TRI_H ? VRAM_BUMPER_TRI
    : k == BUMPER_TRI_V ? VRAM_BUMPER_TRI_2 : k == BUMPER_RIGHT_ANGLE ? VRAM_BUMPER_TRI_BIG : 0;
  if (fixed) object_sprite_at(&b->o.sprite, OBJ_VRAM + fixed, anim, 0, ORDER_BUMPER, PRIORITY_FRONT, b->flipX, b->flipY);
  else object_sprite(&b->o.sprite, anim, 0, 0, ORDER_BUMPER, PRIORITY_FRONT, b->flipX, b->flipY);
  sprite_step(&b->o.sprite);

  // the sway: a negative d0 (d1) starts it half a turn on
  if (k == BUMPER_HEXAGON) { b->alongX = 1; b->phase = s8(e->d[0]) < 0 ? SWAY_PHASE_HALF : 0; }
  else if (k == BUMPER_ROUND) {
    if (e->d[2] > e->d[3]) { b->alongX = 1; b->phase = s8(e->d[0]) < 0 ? SWAY_PHASE_HALF : 0; }
    else { b->alongY = 1; b->phase = s8(e->d[1]) < 0 ? SWAY_PHASE_HALF : 0; }
  }
  if (e->d[2] == 0 && e->d[3] == 0) b->alongX = 0;
  // the circling one: d0 * 1/8 of a turn on, d1 * 1/2048 of a turn a frame, the other way when d3 is the larger
  b->start = (e->d[0] & CIRCLE_START_MASK) << 8;
  b->speed = (e->d[2] > e->d[3] ? 1 : -1) * s8(e->d[1]);
  b->radius = e->d[2] > e->d[3] ? e->d[2] : e->d[3];
  return object_task(&b->o, bumper_run, PRIORITY_OBJECTS);
}
