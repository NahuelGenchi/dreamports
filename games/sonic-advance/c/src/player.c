// Sonic's movement, animation and drawing, translated from the JavaScript version's engine/player.js, engine/animator.js
// and the part of engine/game.js that draws him (drawSonic), a function at a time and in the same order. His speeds are
// doubles of pixels a frame, as there; the original does its arithmetic on 8.8 integers, so q8 turns a speed into one
// where it matters. The other characters, the boost modes and the Sonic Advance 2 tricks are left out.

#include "objects.h"
#include "terrain.h"

// Sonic's sound effects (sound/songs.js)
enum {
  SE_SPIN = 109, SE_SPIN_DASH_RELEASE = 110, SE_SLIDE = 111, SE_AIR_DASH = 112, SE_INSTA_SHIELD = 113, SE_BRAKE = 115,
  SE_JUMP = 116, SE_SOMERSAULT = 121,
};

// physics (PHYSICS in engine/constants.js), in pixels a frame
#define ACCELERATION (8.0 / 256)
#define DECELERATION (96.0 / 256)
#define FRICTION (8.0 / 256)
#define MAX_RUN_SPEED 4.5
#define BRAKE_MIN_SPEED 3.0
#define REVERSE_KICK (96.0 / 256)
#define GRAVITY (42.0 / 256)
#define JUMP_SPEED 4.875
#define JUMP_RELEASE_CAP 3.0
#define RISE_CAP 11.8125
#define ROLL_DECELERATION (24.0 / 256)
#define FORCED_ROLL_SPEED 3.0
#define SPIN_ATTACK_SPEED 2.0
#define SOMERSAULT_SPEED 3.0
#define SLIDE_SPEED 4.0
#define ATTACK_FRICTION (8.0 / 256)
#define SLIDE_FRICTION (32.0 / 256)
#define WALL_MIN_SPEED 1.875
#define SPRING_PEAK_SPEED 1.5
#define HURT_SPEED_X 1.5
#define HURT_SPEED_Y 3.0
// under water (Player_HandleWater and the MOVESTATE_IN_WATER branches): half the top speed, acceleration and deceleration,
// a lighter gravity (PLAYER_GRAVITY_UNDER_WATER), a lower jump (PLAYER_JUMP_HEIGHT_UNDER_WATER) and its lower cap
#define WATER_MAX_RUN_SPEED 2.25
#define WATER_ACCELERATION (4.0 / 256)
#define WATER_DECELERATION (48.0 / 256)
#define WATER_GRAVITY (12.0 / 256)
#define WATER_JUMP_SPEED 2.625
#define WATER_JUMP_RELEASE_CAP 1.5
#define ROOM_TO_JUMP 4                    // px of room above him a jump needs
enum {
  BORED_DELAY = 360, SLIP_LOCK = 30, INVULNERABLE_FRAMES = 120,
  DASH_REV = 0x200, DASH_REV_MIN = 0x800,                  // the spin dash's charge: each rev adds, and a first rev jumps to
  AIR_DASH_WINDOW = 10, AIR_DASH_MIN_GAP = 5,              // the double tap: frames back it looks, and the least gap
  DEAD_BELOW_SCREEN = 240, DEAD_RESTART = 60,
  SPRITE_OFFSET_Y = 14, BALL_SPRITE_OFFSET_Y = 9,          // from his centre to the ground standing, and curled up
  HALF_WIDTH = 6,
  SPIN_DASH_SPEEDS = 0x4A7084, SPIN_DASH_SPEED_COUNT = 18, // the table of release speeds in the ROM (USA), 8.8 each
  PLAYER_ORDER = 16,                                        // his sprite's OAM order until an animation says otherwise
  DEFAULT_PRIORITY = 2,
  DROWN_SECONDS = 30, DROWN_SECOND = 60,                    // seconds under water before he drowns, of 60 frames each
  DROWNING_MUSIC_AT = 11,                                   // the second the drowning music starts at
  WATER_BELOW = 4,                                          // his centre is in the water this far below its line
  SURFACE_EFFECT_DELAY = 10,                                // frames between two splashes at the line
  BREATH_EVERY = 16, BREATH_AHEAD = 4, BREATH_ABOVE = 4,    // a breath out every 16th frame of the clock, from there
  DROWNED_BUBBLE_ABOVE = 12,
  SE_WATERFALL_SURFACE_HIT = 190,
};
// ANIMATION: the walk cycle plays at his speed, never slower than half, and the run starts at 4.5
#define RUN_SPEED 4.5
#define BRAKE_TURN_SPEED 1.5
enum { ANIM_NORMAL_SPEED = 0x10, ANIM_MIN_WALK_SPEED = 0x08 };

// what the pad says to the movement code: left and right hide up and down
typedef struct { int dir, sideways, up, down, jump, jumpPressed, attackPressed; } Control;

// --- numbers ------------------------------------------------------------------------------------------------------------
static int js_round(double v) { return (int)__builtin_floor(v + 0.5); }
/** A speed as the 8.8 integer the original does its arithmetic on. */
static int q8(double v) { return js_round(v * 256); }
static double toward0(double v, double step) { return v > 0 ? (v - step > 0 ? v - step : 0) : v < 0 ? (v + step < 0 ? v + step : 0) : 0; }

// --- ball and standing ---------------------------------------------------------------------------------------------------
// curling up lowers the centre toward the surface so the feet stay put
static void curl(Player *p) { p->curled = 1; sensors_set_offset_y(p, BALL_SPRITE_OFFSET_Y); }
static void uncurl(Player *p) { p->curled = 0; sensors_set_offset_y(p, SPRITE_OFFSET_Y); }
void player_stand_up(Player *p) { uncurl(p); }
void player_curl_up(Player *p) { curl(p); }
/** Starts the jump the course select's held A began, one frame into it: curled and rising at 3 px a frame. */
void player_start_jump(Player *p) {
  p->air = 1; p->jumped = 1; p->pushing = 0; p->state = PS_SPIN;
  p->ysp = -3.0;
  curl(p);
}
// the walk's states put his hitbox back at its standing height; it only moves him when something uncurled him
// without it
static void stand_height(Player *p) { sensors_set_offset_y(p, SPRITE_OFFSET_Y); }

void player_init(Player *p, int x, int y) {
  memset(p, 0, sizeof *p);
  p->x = x; p->y = y; p->facing = 1;
  p->state = p->prevState = p->animName = PS_IDLE;
  p->layer = LAYER_BACK; p->offsetY = SPRITE_OFFSET_Y; p->idleT = BORED_DELAY; p->prio = DEFAULT_PRIORITY;
  p->track = NO_TRACK; p->scale = FULL_SCALE;
  p->drownSeconds = DROWN_SECONDS; p->drownFrames = DROWN_SECOND; p->surfaceT = SURFACE_EFFECT_DELAY;
  sprite_init(&p->sprite);
  p->sprite.palId = 0;
  p->sprite.oamFlags = (uint16_t)(PLAYER_ORDER << 6);
  p->sprite.frameFlags = DEFAULT_PRIORITY << 12;
}

// --- moving --------------------------------------------------------------------------------------------------------------
// speed shoes double the top speed, the acceleration and the deceleration, which Player_HandleWater sets each frame for
// the land or the water
static int pace(const Player *p) { return p->speedUp > 0 ? 2 : 1; }
static double accel(const Player *p) { return (p->water ? WATER_ACCELERATION : ACCELERATION) * pace(p); }
static double decel(const Player *p) { return (p->water ? WATER_DECELERATION : DECELERATION) * pace(p); }
static double top_speed(const Player *p) { return (p->water ? WATER_MAX_RUN_SPEED : MAX_RUN_SPEED) * pace(p); }
static double gravity(const Player *p) { return p->water ? WATER_GRAVITY : GRAVITY; }   // PLAYERFN_UPDATE_AIR_FALL_SPEED
static double jump_speed(const Player *p) { return p->water ? WATER_JUMP_SPEED : JUMP_SPEED; }

// a frame's move (PLAYERFN_UPDATE_POSITION): gravity flipped since the stage clock last ran turns his Y speed around,
// and flipped, it moves him up the act
static void move(Player *p) {
  p->x += p->xsp;
  if (p->inverted != p->wasInverted) p->ysp = -p->ysp;
  p->y += p->inverted ? -p->ysp : p->ysp;
}

// ground speed along the surface (sub_8029CA0 walking, sub_8029D14 rolling): not on ceilings, never from a standstill,
// and rolling uphill only gets a quarter of the pull
static void slope(Player *p) {
  if (((p->rotation + 0x60) & 0xFF) >= 0xC0 || p->gsp == 0) return;
  p->gsp = (q8(p->gsp) + ((sin8(p->rotation) * 3) >> 5)) / 256.0;
}
static void roll_slope(Player *p) {
  if (((p->rotation + 0x60) & 0xFF) >= 0xC0 || p->gsp == 0) return;
  int pull = (sin8(p->rotation) * 60) >> 8;
  if ((p->gsp > 0 && pull <= 0) || (p->gsp < 0 && pull >= 0)) pull >>= 2;
  p->gsp = (q8(p->gsp) + pull) / 256.0;
}

// ground speed to X and Y speed along the surface
static void along_surface(Player *p) {
  int g = q8(p->gsp);
  p->xsp = ((g * cos8(p->rotation)) >> 8) / 256.0;
  p->ysp = ((g * sin8(p->rotation)) >> 8) / 256.0;
}

// the camera's bounds (sub_80232D0): Sonic stops at the sides and the top, and falling out of the bottom kills him,
// thrown up as high as a jump; under flipped gravity he stops at the bottom and dies out of the top
static void bounds(Player *p) {
  Camera *c = &act.cam;
  // past the act's loop point (sub_80232D0), Sonic and the camera go back by its distance while the camera moves and
  // follows him; the background leaves it out
  if (act.stage.loopX >= 0 && p->x >= act.stage.loopX && c->speedX != 0 && !c->locked) {
    p->x += act.stage.loopShift; c->x += act.stage.loopShift; c->wrapped += act.stage.loopShift;
    c->wrappedThisFrame += act.stage.loopShift;
  }
  double maxX = c->maxX + 240 - 1.0 / 256, maxY = c->maxY + 160 - 1.0 / 256;
  if (!p->dead && (p->inverted ? p->y <= c->minY : p->y >= maxY)) {
    p->dead = 1; p->ysp = -jump_speed(p); p->y = p->inverted ? c->minY : maxY;
  }
  if (p->x < c->minX || p->x > maxX) { p->x = p->x < c->minX ? c->minX : maxX; p->xsp = 0; p->gsp = 0; }
  if (p->y < c->minY) { p->y = c->minY; p->ysp = 0; p->gsp = 0; }
  if (p->inverted && p->y > maxY) { p->y = maxY; p->ysp = 0; p->gsp = 0; }
}

// walls, ceilings and steep slopes drop Sonic when he is too slow for them, and lock his controls for 30 grounded frames
// (sub_8029ED8)
static void fall_off(Player *p) {
  if (p->lock) { p->lock--; return; }
  if (((p->rotation + 0x20) & 0xC0) && __builtin_fabs(p->gsp) < WALL_MIN_SPEED) {
    p->gsp = 0; p->air = 1; p->lock = SLIP_LOCK;
  }
}

// a fresh press of left or right now, after an earlier press of the same direction 5-10 frames back, with no other
// direction held in between (GetAirDashDirection): -1 left, 1 right, 0 none
static int double_tap(const Player *p) {
  int now = p->pressed[0] & (DPAD_LEFT | DPAD_RIGHT);
  if (now != DPAD_LEFT && now != DPAD_RIGHT) return 0;
  int others = (DPAD_LEFT | DPAD_RIGHT | DPAD_UP | DPAD_DOWN) & ~now;
  for (int i = 0; i < AIR_DASH_WINDOW; i++) {
    if (p->held[i] & others) return 0;
    if (i >= AIR_DASH_MIN_GAP - 1 && (p->pressed[i + 1] & now)) return now == DPAD_LEFT ? -1 : 1;
  }
  return 0;
}

// --- the moves ------------------------------------------------------------------------------------------------------------
// jumps away from the surface, if there are at least 4 px of room that way
static int try_jump(Player *p, const Control *c) {
  if (!c->jumpPressed || sensors_clearance(p, sensors_act_angle(p) + 0x80) < ROOM_TO_JUMP) return 0;
  p->air = 1; p->jumped = 1; p->pushing = 0; p->state = PS_SPIN;
  int a = (p->rotation - 0x40) & 0xFF, jump = q8(jump_speed(p));
  p->xsp = (q8(p->xsp) + ((jump * cos8(a)) >> 8)) / 256.0;
  p->ysp = (q8(p->ysp) + ((jump * sin8(a)) >> 8)) / 256.0;
  if (p->curled) p->airLock = 1;   // jumping out of a roll keeps the roll's momentum
  else curl(p);
  play_song(SE_JUMP);
  return 1;
}

// spin dash: starts from a crouch with jump, revs with jump, releases when down is let go
static int try_spin_dash(Player *p, const Control *c) {
  if (!p->spinDashing) {
    if (p->state != PS_CROUCH || !c->jumpPressed) return 0;
    p->state = PS_SPIN_DASH; p->spinDashing = 1; p->dashAccel = 0;
    sensors_set_offset_y(p, BALL_SPRITE_OFFSET_Y);
    play_song(SE_SPIN);
    act_dash_dust();
    return 1;
  }
  if (!c->down) {
    p->spinDashing = 0;
    // a charge past the table's end uses its last speed
    int i = p->dashAccel >> 8;
    if (i > SPIN_DASH_SPEED_COUNT - 1) i = SPIN_DASH_SPEED_COUNT - 1;
    p->gsp = rom_s16(SPIN_DASH_SPEEDS + (uint32_t)i * 2) / 256.0 * p->facing;
    p->curled = 1; p->state = PS_SPIN;
    play_song(SE_SPIN_DASH_RELEASE);
    act_freeze_camera();
    return 1;   // the release frame doesn't move
  }
  int a = p->dashAccel;
  if (a != 0) { a -= (a << 3) >> 8; if (a <= 0) a = 0; }
  if (p->state != PS_SPIN_DASH_REV) p->state = PS_SPIN_DASH;
  if (c->jumpPressed) {
    // each rev replays the spin sound, raised by the decayed charge in semitones
    gba_sound_play_pitched(SE_SPIN, a & ~0x7F);
    p->state = PS_SPIN_DASH_REV;
    a += DASH_REV;
    if (a < DASH_REV_MIN) a = DASH_REV_MIN;
  }
  p->dashAccel = a;
  return 1;
}

void player_end_attack(Player *p) {
  p->attack = 0; p->attackNext = 0; p->midAir = 0; p->jumped = 0; p->spinDashing = 0; p->halfPipe = 0;
}

// the B-button combo on the ground (sub_8047668): true while it owns the frame. It doesn't start while Sonic revs a
// spin dash, pushes, or stands on a wall or the ceiling (Player_Sonic_StartRoll).
static int attack_step(Player *p, const Control *c) {
  switch (p->attack) {
    case 0: {
      int floor = (p->rotation + 0x40) & 0xFF;
      if (p->spinDashing || p->pushing || floor == 0 || floor >= 0x80 || !c->attackPressed) return 0;
      p->gsp = SPIN_ATTACK_SPEED * p->facing; p->xsp = 0;
      p->attack = 1; p->state = PS_SPIN_ATTACK;
      play_song(SE_SPIN);
      return 1;
    }
    case 1:
      p->gsp = toward0(p->gsp, ATTACK_FRICTION);
      along_surface(p);   // before a somersault's speed, which moves him from the next frame
      if (p->gsp == 0) { p->state = PS_IDLE; p->attack = 0; }
      if (c->attackPressed) {
        p->gsp = SOMERSAULT_SPEED * p->facing; p->attack++; p->attackNext = 0; p->state = PS_SOMERSAULT;
        play_song(SE_SOMERSAULT);
      }
      break;
    case 2:
      p->gsp = toward0(p->gsp, ATTACK_FRICTION);
      along_surface(p);
      if (p->attackNext == 0 && c->attackPressed) p->attackNext = 1;        // then slide
      else if (p->attackNext == 0 && c->jumpPressed) p->attackNext = 2;     // then backflip
      break;
    case 3:
      p->gsp = toward0(p->gsp, SLIDE_FRICTION);
      along_surface(p);
      if (p->gsp == 0) { p->state = PS_SLIDE_END; p->attack = 4; }
      break;
  }
  return 1;
}

// --- walking --------------------------------------------------------------------------------------------------------------
static void walk(Player *p, int dir) {
  double acc = accel(p), max = top_speed(p);
  if (p->gsp * dir >= 0) {
    if (p->facing != dir) { p->state = PS_TURN; p->pushing = 0; stand_height(p); }
    p->facing = dir;
    double g = p->gsp + acc * dir;
    if (g * dir > max) {
      g -= acc * dir;
      if (g * dir < max) g = max * dir;
    }
    p->gsp = g;
    // on a half-pipe he keeps the state it gives him, and past the goal his act-clear run
    if (p->state != PS_TURN && !p->halfPipe && !p->actClear && !p->scripted) { p->state = PS_WALK; stand_height(p); }
  } else {
    double g = p->gsp + decel(p) * dir;
    if (g * dir > 0) g = REVERSE_KICK * dir;
    p->gsp = g;
    // the skid sound restarts on every frame Sonic is still this fast
    if (g * dir <= -BRAKE_MIN_SPEED) { play_song(SE_BRAKE); p->state = PS_BRAKE; stand_height(p); }
  }
}

// facing the drop or with his back to it, from the side the edge is on
static void balance(Player *p, int edge) { p->state = edge == p->facing ? PS_BALANCE_FORWARD : PS_BALANCE_BACK; }

// at a ledge (Player_8044E48): no ground within 8 px under his centre, none under one side of him (2 px past his
// half-width) and ground right under the other. Under flipped gravity the sides look up, but the first look is still down
// the act, as in the original.
static void balance_on_terrain(Player *p) {
  int x = (int)__builtin_floor(p->x), y = (int)__builtin_floor(p->y), up = p->inverted ? -1 : 1, feet = y + up * p->offsetY;
  if (terrain_scan(PROBE_FLOOR, y + p->offsetY, x, p->layer, 8).d <= 8) return;
  int left = terrain_scan(PROBE_FLOOR, feet, x - 2 - HALF_WIDTH, p->layer, 8 * up).d;
  int right = terrain_scan(PROBE_FLOOR, feet, x + 2 + HALF_WIDTH, p->layer, 8 * up).d;
  if (left > 8 && right == 0) balance(p, -1);
  else if (left == 0 && right > 8) balance(p, 1);
}

// at the side of the object he stands on (Player_8044D74): his centre more than a pixel past the side of its box, less his
// half-width; a side at 0 never counts. Once balancing, he keeps on a pixel further in.
static void balance_on_object(Player *p) {
  const Object *o = p->onObject;
  const Hitbox *hb = object_box(&o->sprite, 0);
  if (!hb) return;
  int l = hb->left, r = hb->right;
  if (l != 0 && p->x < o->x + l - HALF_WIDTH + 1) { balance(p, -1); return; }
  if (r != 0 && p->x > o->x + r + HALF_WIDTH - 2) { balance(p, 1); return; }
  if ((p->x < o->x + l - HALF_WIDTH + 2 || p->x > o->x + r + HALF_WIDTH - 3) && (p->prevState == PS_BALANCE_FORWARD || p->prevState == PS_BALANCE_BACK)) {
    p->state = p->prevState;
  }
}

static void walk_input(Player *p, const Control *c) {
  if (c->dir) walk(p, c->dir);
  else if (!c->sideways) {
    if (p->gsp != 0) {
      if (p->state == PS_BRAKE || p->state == PS_IDLE) { p->state = PS_WALK; stand_height(p); }
    } else if (!p->actClear && !p->scripted) {
      if (p->state == PS_CROUCH) p->state = PS_CROUCH_END;
      else if (p->state == PS_LOOK_UP) p->state = PS_LOOK_UP_END;
      else if (p->state != PS_CROUCH_END && p->state != PS_LOOK_UP_END) p->state = PS_IDLE;
      stand_height(p);
    }
  }
  // standing still on level ground stops the push, and at an edge he balances; not in his act-clear pose
  if (!((p->rotation + 0x20) & 0xC0) && p->gsp == 0) {
    p->pushing = 0;
    if (p->actClear || p->scripted) return;
    if (p->state != PS_CROUCH_END && p->state != PS_LOOK_UP_END) p->state = PS_IDLE;
    if (p->onObject) balance_on_object(p);
    else balance_on_terrain(p);
  }
}

// up and down (sub_80448D0): they only count while no direction is held, cancel each other out, and do nothing while he
// balances at an edge
static void look_input(Player *p, const Control *c) {
  if (p->state == PS_BALANCE_FORWARD || p->state == PS_BALANCE_BACK) return;
  if (c->up && !c->down) { if (p->gsp == 0) p->state = PS_LOOK_UP; }
  else if (c->down && !c->up) {
    p->state = PS_CROUCH;
    if (p->gsp != 0) { curl(p); p->state = PS_SPIN; play_song(SE_SPIN); }
  } else if (!c->up && !c->down) {
    if (p->state == PS_CROUCH) p->state = PS_CROUCH_END;
    else if (p->state == PS_LOOK_UP) p->state = PS_LOOK_UP_END;
  }
}

// standing or running, not curled up (Player_8044F7C); the control lock skips left and right, not up and down
static void walk_step(Player *p, const Control *c) {
  if (!p->lock && p->state != PS_BREATHE) walk_input(p, c);
  look_input(p, c);
  if (!c->sideways) p->gsp = toward0(p->gsp, FRICTION);
  along_surface(p);
  sensors_wall_push(p, 0);
}

// rolling (Player_8043DDC): a roll that stops stands him up, unless an object keeps him curled: then it starts again at
// 3 px a frame the way he faces, with the rolling sound
static void roll_step(Player *p, const Control *c) {
  if (c->dir && !p->lock) {
    if (p->gsp * c->dir >= 0) p->facing = c->dir;
    else {
      p->gsp += ROLL_DECELERATION * c->dir;
      if (p->gsp * c->dir > 0) p->gsp = REVERSE_KICK * c->dir;
    }
  }
  p->gsp = toward0(p->gsp, accel(p) / 2);   // half the acceleration
  if (p->gsp == 0 && p->forcedRoll) { p->gsp = FORCED_ROLL_SPEED * p->facing; play_song(SE_SPIN); }
  else if (p->gsp == 0) { uncurl(p); p->state = c->down ? PS_CROUCH : PS_WALK; }
  along_surface(p);
  // a wall to the side stops the roll and stands him up
  if (sensors_wall_push(p, 1) && p->curled) { uncurl(p); p->state = PS_WALK; }
}

// on a frame a jump or a B move starts nothing else runs; while revving a spin dash Sonic stays put but still follows the
// ground (Player_Sonic_80473AC)
// standing on an object, the object holds him up and the ground sensors rest (sub_8022D6C)
static void follow_ground(Player *p) {
  if (p->onObject) { p->rotA = p->rotB = 0; return; }
  sensors_ground(p);
}

static void ground_step(Player *p, const Control *c) {
  if (p->curled) {
    if (try_jump(p, c)) return;
    roll_slope(p);
    roll_step(p, c);
  } else if (p->attack != 0) {
    slope(p);
    attack_step(p, c);
    sensors_wall_push(p, 1);   // the rolling check: a wall stops the combo's moves without starting a push
  } else {
    if (attack_step(p, c)) return;
    if (try_spin_dash(p, c)) { bounds(p); follow_ground(p); return; }
    if (try_jump(p, c)) return;
    slope(p);
    walk_step(p, c);
  }
  bounds(p);
  move(p);
  follow_ground(p);
  fall_off(p);
}

// --- the air --------------------------------------------------------------------------------------------------------------
// the angle he left the ground at eases back to upright, 2/256 of a turn a frame; off a bounce block he tumbles the way he
// faces instead (Player_8047224)
static void tumble(Player *p) {
  if (p->state == PS_BOUNCE) { p->rotation = (p->rotation + 4 * p->facing) & 0xFF; return; }
  int r = s8(p->rotation);
  r = r > 0 ? (r - 2 > 0 ? r - 2 : 0) : (r + 2 < 0 ? r + 2 : 0);
  p->rotation = r & 0xFF;
}

// left or right in the air (Player_AirInputControls): twice the walking acceleration up to the top speed, turning him to
// face that way unless `turn` is 0; not after a jump out of a roll
static void air_control(Player *p, const Control *c, int turn) {
  if (p->airLock || !c->dir) return;
  int dir = c->dir;
  double acc = accel(p) * 2, max = top_speed(p);
  if (turn) p->facing = dir;
  double v = p->xsp + acc * dir;
  if (v * dir > max) {
    v -= acc * dir;
    if (v * dir < max) v = max * dir;
  }
  p->xsp = v;
}

// while rising, X speed loses 1/32 of itself (sub_80236C8)
static void air_drag(Player *p) {
  double drag = __builtin_floor(p->xsp * 256 / 32) / 256;   // an arithmetic shift of the 8.8 value
  p->xsp = p->xsp > 0 ? (p->xsp - drag > 0 ? p->xsp - drag : 0) : p->xsp < 0 ? (p->xsp - drag < 0 ? p->xsp - drag : 0) : 0;
}

static void air_step(Player *p, const Control *c) {
  // knocked back, he flies on as he was thrown: no moves, no control and no drag, but his tilt still eases back
  if (p->state == PS_HURT) {
    bounds(p);
    move(p);
    p->ysp += gravity(p);
    tumble(p);
    sensors_air(p);
    return;
  }
  // the double-tap dash, only while curled up (sub_8047714)
  if (p->curled && p->jumped && p->midAir == 0) {
    int tap = double_tap(p);
    if (tap) {
      p->midAir = 2; p->state = PS_AIR_DASH;
      p->xsp += (q8(top_speed(p)) >> 2) / 256.0 * tap;
      p->ysp = 0;
      play_song(SE_AIR_DASH);
    }
  }
  // jump cap, or once the rise has slowed the insta-shield (Player_8044670)
  if (p->jumped) {
    double cap = p->water ? WATER_JUMP_RELEASE_CAP : JUMP_RELEASE_CAP;
    if (p->ysp < -cap) { if (!c->jump) p->ysp = -cap; }
    else if (p->midAir == 0 && c->jumpPressed) {
      p->airLock = 0; p->midAir = 1;
      p->state = PS_INSTA_SHIELD;
      play_song(SE_INSTA_SHIELD);
      act_insta_shield();
    }
  } else if (!p->forcedRoll && p->ysp < -RISE_CAP) p->ysp = -RISE_CAP;

  // air control and drag (Player_AirInputControls); off a bounce block he keeps facing the way he went up
  air_control(p, c, p->state != PS_BOUNCE);
  if (p->ysp < 0) air_drag(p);
  bounds(p);
  move(p);
  p->ysp += gravity(p);
  tumble(p);
  sensors_air(p);
}

void player_land(Player *p) {
  p->air = 0; p->pushing = 0;
  // in a mini loop he lands rolling, as he was
  if (!p->forcedRoll) {
    if (!p->actClear && !p->scripted) p->state = PS_WALK;
    if (p->curled) uncurl(p);
    p->offsetY = SPRITE_OFFSET_Y;   // set outright, even when something uncurled him without moving him
  }
  p->airLock = 0;
  p->chain = 0;
  player_end_attack(p);
}

// --- hurt and dead ----------------------------------------------------------------------------------------------------------
int player_hurt(Player *p) {
  if (p->invulnerable > 0 || p->invincible > 0) return 0;
  double xsp = p->xsp < 0 || (p->xsp == 0 && p->facing < 0) ? HURT_SPEED_X : -HURT_SPEED_X, ysp = -HURT_SPEED_Y;
  // under water both are halved (Coll_DamagePlayer)
  if (p->water) { xsp = (q8(xsp) >> 1) / 256.0; ysp = (q8(ysp) >> 1) / 256.0; }
  player_knock_aside(p, xsp, ysp);
  return 1;
}

void player_knock_aside(Player *p, double xsp, double ysp) {
  p->invulnerable = INVULNERABLE_FRAMES;
  p->xsp = xsp; p->ysp = ysp;
  p->air = 1; p->pushing = 0;
  player_end_attack(p);
  p->airLock = 0;
  p->onObject = NULL;
  p->state = PS_HURT;
  uncurl(p);   // the feet stay put
}

// dead (Task_PlayerMain's death block, then Task_PlayerDied and Task_PlayerHandleDeath): on the first frame he stops moving
// sideways, and the camera and clock stop; then he falls through everything until he is 80 px below the screen, and the act
// restarts 61 frames later
static void dead_step(Player *p) {
  if (p->death == PLAYER_ALIVE) {
    p->death = PLAYER_FALLING; p->state = PS_DEAD;
    p->xsp = 0; p->invulnerable = 2; p->pushing = 0; p->invincible = 0;
    p->onObject = NULL; p->shield = SHIELD_NONE;
    player_end_attack(p);
    act_player_died();
    return;
  }
  if (p->death == PLAYER_FALLING) {
    int cameraY = (int)__builtin_floor(act.cam.y);
    int gone = p->inverted ? p->y <= cameraY - DEAD_BELOW_SCREEN + 160 : p->y >= cameraY + DEAD_BELOW_SCREEN - 1.0 / 256;
    if (gone) { p->death = PLAYER_GONE; p->countdown = DEAD_RESTART; p->hidden = 1; return; }
    move(p);
    p->ysp += gravity(p);
    return;
  }
  if (p->countdown != 0) p->countdown--;
  else act_life_lost();
}

// --- the water ------------------------------------------------------------------------------------------------------------------
// the countdown's numbers, by the second they show at (SpawnDrowningCountdownNum)
static int countdown_number(int second) {
  switch (second) { case 12: return 5; case 10: return 4; case 8: return 3; case 6: return 2; case 4: return 1; case 2: return 0; }
  return -1;
}

static void drown_count_reset(Player *p) { p->drownFrames = DROWN_SECOND; p->drownSeconds = DROWN_SECONDS; }

// a splash at the line with its sound, at most one every 10 frames
static void surface_splash(Player *p) {
  if (p->surfaceT >= 1) return;
  p->surfaceT = SURFACE_EFFECT_DELAY;
  water_splash((int)__builtin_floor(p->x));
  play_song(SE_WATERFALL_SURFACE_HIT);
}

// Player_HandleWater (sub_8023878), before he moves: going in halves his X speed and quarters his Y speed, coming out
// doubles his Y speed. Under water a second goes every 60 frames: at 12, 10, 8, 6, 4 and 2 a number counts down over him, at
// 11 the drowning music starts and below 0 he drowns; every 16th frame of the clock he breathes out a bubble, one time in
// four. Out of the water the count starts over and the drowning music stops.
static void water_step(Player *p) {
  int level = water_level();
  if (level >= 0 && (int)__builtin_floor(p->y) - WATER_BELOW >= level) {
    if (!p->water) {
      p->water = 1;
      p->xsp = (q8(p->xsp) >> 1) / 256.0;
      p->ysp = (q8(p->ysp) >> 2) / 256.0;
      surface_splash(p);
    }
    if (--p->drownFrames < 1) {
      int second = p->drownSeconds--;
      if (second == DROWNING_MUSIC_AT) water_drowning_music();
      else if (countdown_number(second) >= 0) water_countdown(countdown_number(second));
      if (p->drownSeconds < 0) {
        p->dead = 1; p->ysp = 0;
        water_bubble((int)__builtin_floor(p->x * 256), (int)__builtin_floor(p->y * 256) - DROWNED_BUBBLE_ABOVE * 256, 0, 1);
        water_drowned_bubbles();
      }
      p->drownFrames = DROWN_SECOND;
    }
    if (act.tick % BREATH_EVERY == 0 && !(act_random() & 0x300)) {
      int ahead = p->facing < 0 ? -BREATH_AHEAD : BREATH_AHEAD;
      water_bubble((int)__builtin_floor(p->x * 256) + ahead * 256, (int)__builtin_floor(p->y * 256) - BREATH_ABOVE * 256, 0, 0);
    }
  } else {
    if (p->water) {
      p->water = 0;
      p->ysp = (s16(q8(p->ysp) << 1)) / 256.0;
      surface_splash(p);
    }
    drown_count_reset(p);
    water_drowning_music_stop();
  }
  if (p->surfaceT != 0) p->surfaceT--;
}

void player_breathe(Player *p) {
  player_end_attack(p); p->pushing = 0;   // Player_TransitionCancelFlyingAndBoost
  p->state = PS_BREATHE;
  if (p->curled) {
    p->airLock = 0;
    // in the air his centre stays where it is (PLAYERFN_SET_SHIFT_OFFSETS), on the ground his feet do
    if (p->air) { p->curled = 0; p->offsetY = SPRITE_OFFSET_Y; }
    else uncurl(p);
  }
  p->xsp = p->ysp = p->gsp = 0;
  drown_count_reset(p);
}

// --- one frame ------------------------------------------------------------------------------------------------------------------
void player_step(Player *p, const PlayerInput *in) {
  int sideways = in->left || in->right;
  int bits = (in->left ? DPAD_LEFT : 0) | (in->right ? DPAD_RIGHT : 0) | (in->up ? DPAD_UP : 0) | (in->down ? DPAD_DOWN : 0);
  memmove(&p->pressed[1], &p->pressed[0], (DPAD_HISTORY - 1) * sizeof p->pressed[0]);
  p->pressed[0] = bits & ~p->held[0];
  memmove(&p->held[1], &p->held[0], (DPAD_HISTORY - 1) * sizeof p->held[0]);
  p->held[0] = bits;
  // Player_HandleInputs: while an object holds his controls heldDirs stays as it was and nothing is pressed. Up and down
  // are dropped while left or right is.
  if (p->ignoreInput) p->pressedDirs = 0;
  else {
    int fresh = bits & ~p->heldDirs;
    p->pressedDirs = fresh & (DPAD_LEFT | DPAD_RIGHT) ? fresh & ~(DPAD_UP | DPAD_DOWN) : fresh;
    p->heldDirs = bits & (DPAD_LEFT | DPAD_RIGHT) ? bits & ~(DPAD_UP | DPAD_DOWN) : bits;
  }

  Control c = {
    .dir = in->left && !in->right ? -1 : in->right && !in->left ? 1 : 0, .sideways = sideways,
    .up = in->up && !sideways, .down = in->down && !sideways,
    .jump = in->jump, .jumpPressed = in->jumpPressed, .attackPressed = in->attackPressed,
  };
  p->jumpPressed = c.jumpPressed; p->attackPressed = c.attackPressed;

  if (p->dead) { dead_step(p); return; }
  water_step(p);
  if (p->override || p->carried) return;   // an object moves him, and his own code doesn't run
  if (p->air) air_step(p, &c);
  else ground_step(p, &c);
}

// --- animation ------------------------------------------------------------------------------------------------------------------
// the animation and variant each name shows (SONIC_ANIMATIONS in rom/extract.js); bouncing shows the walk cycle
static const uint8_t ANIMATIONS[PA_COUNT][2] = {
  [PS_IDLE] = {0, 0}, [PA_BORED] = {1, 0}, [PS_LOOK_UP] = {2, 0}, [PS_LOOK_UP_END] = {2, 1}, [PS_CROUCH] = {3, 0},
  [PS_CROUCH_END] = {3, 1}, [PS_WALK] = {4, 0}, [PA_RUN] = {5, 0}, [PS_TURN] = {6, 0}, [PA_BRAKE_TURN] = {7, 0},
  [PS_SPIN] = {8, 0}, [PS_BRAKE] = {9, 0}, [PS_SPRING_RISE] = {10, 0}, [PS_SPRING_PEAK] = {10, 1},
  [PS_SPRING_FALL] = {10, 2}, [PS_SPRING] = {11, 0}, [PS_PUSH] = {12, 0}, [PS_BALANCE_FORWARD] = {13, 0},
  [PS_BALANCE_BACK] = {14, 0}, [PS_SPIN_DASH] = {18, 0}, [PS_SPIN_DASH_REV] = {18, 1}, [PS_HURT] = {19, 0},
  [PS_DEAD] = {21, 0}, [PS_AIR_DASH] = {49, 0}, [PS_INSTA_SHIELD] = {50, 0}, [PS_SPIN_ATTACK] = {51, 0},
  [PS_SOMERSAULT] = {52, 0}, [PS_SLIDE] = {53, 0}, [PS_SLIDE_END] = {53, 1}, [PS_BACKFLIP] = {55, 0}, [PS_BOUNCE] = {4, 0},
  [PS_MARBLE_TRACK] = {39, 0}, [PS_POLE] = {38, 0}, [PS_FLAG_SWING] = {37, 0}, [PS_ACT_CLEAR_RUN] = {22, 0},
  [PS_CAROUSEL_RIDE] = {40, 0}, [PS_SWING_ROPE] = {40, 1}, [PS_HOOK] = {43, 0}, [PS_ACT_CLEAR_POSE] = {23, 0},
  [PS_HALF_PIPE_LOW] = {36, 0}, [PS_HALF_PIPE_MID] = {36, 1}, [PS_HALF_PIPE_HIGH] = {36, 2},
  [PS_BREATHE] = {17, 0},
};

// the walk cycle plays at his speed, never slower than half
static int walk_cycle_speed(double speed) {
  int s = (int)__builtin_floor(speed * 256) >> 4;
  return s > ANIM_NORMAL_SPEED ? ANIM_NORMAL_SPEED : s < ANIM_MIN_WALK_SPEED ? ANIM_MIN_WALK_SPEED : s;
}

// state -> animation, with the walk cycle's speed and the idle timer (sub_802486C)
static int pick_animation(Player *p, const PlayerInput *in) {
  double speed = __builtin_fabs(p->gsp);
  p->sprite.animSpeed = ANIM_NORMAL_SPEED;
  if (p->override) return p->state;
  if (p->gsp != 0 || in->left || in->right || in->up || in->down || in->jump || in->attack) p->idleT = BORED_DELAY;
  if (p->pushing) p->state = PS_PUSH;
  switch (p->state) {
    case PS_IDLE:
      if (p->idleT != 0) { p->idleT--; return PS_IDLE; }
      return PA_BORED;
    case PS_WALK:
      if (speed >= RUN_SPEED) return PA_RUN;
      p->sprite.animSpeed = (uint8_t)walk_cycle_speed(speed);
      return PS_WALK;
    case PS_BRAKE: return speed < BRAKE_TURN_SPEED ? PA_BRAKE_TURN : PS_BRAKE;
    case PS_HALF_PIPE_LOW: case PS_HALF_PIPE_MID: case PS_HALF_PIPE_HIGH:
      p->sprite.animSpeed = (uint8_t)walk_cycle_speed(speed);
      return p->state;
    case PS_SPRING_RISE:
      // the animation was picked before the state changes, so the top-out one starts on the next frame
      if (p->ysp >= -SPRING_PEAK_SPEED) p->state = PS_SPRING_PEAK;
      return PS_SPRING_RISE;
    default: return p->state;
  }
}

// the animation, and under water it runs at half speed, rounded up (the end of sub_802486C)
static int pick(Player *p, const PlayerInput *in) {
  int name = pick_animation(p, in);
  if (p->water) p->sprite.animSpeed = (uint8_t)(p->sprite.animSpeed - (p->sprite.animSpeed >> 1));
  return name;
}

// what comes after an animation that ends (sub_8024B10)
static void after_animation(Player *p) {
  switch (p->state) {
    case PS_SPIN_DASH_REV: p->state = PS_SPIN_DASH; break;
    case PS_CROUCH_END: p->state = p->gsp != 0 ? PS_WALK : PS_IDLE; break;
    case PS_LOOK_UP_END: p->state = PS_IDLE; break;
    case PS_TURN: case PS_BREATHE: p->state = PS_WALK; break;
    case PS_SPRING: case PS_SPRING_PEAK: p->state = PS_SPRING_FALL; break;
    case PS_SPIN_ATTACK: case PS_SLIDE_END:
      player_end_attack(p); p->state = p->gsp != 0 ? PS_WALK : PS_IDLE; break;
    case PS_SOMERSAULT:
      if (p->attackNext == 1) {
        p->gsp = SLIDE_SPEED * p->facing; p->attack++; p->attackNext = 0; p->state = PS_SLIDE;
        play_song(SE_SLIDE);
      } else if (p->attackNext == 2) {
        player_end_attack(p);
        p->xsp = -p->xsp; p->ysp = -jump_speed(p);   // flips backwards, away from the way he was going
        p->air = 1; curl(p); p->state = PS_BACKFLIP;
        play_song(SE_JUMP);
      } else { player_end_attack(p); p->state = PS_IDLE; p->gsp = 0; }
      break;
    default: break;
  }
}

// shows the animation `name` names; a new one clears his hitboxes until its script sets them (sub_802486C). Only a new
// animation or variant restarts the sprite, so bouncing and walking, which share one, carry on where the cycle was.
static void choose(Player *p, int name, int restart) {
  Sprite *s = &p->sprite;
  uint16_t anim = ANIMATIONS[name][0];
  uint8_t variant = ANIMATIONS[name][1];
  if (anim != s->graphics.anim || variant != s->variant) {
    s->hitboxes[0].index = s->hitboxes[1].index = -1;
    s->hitboxes[0].left = s->hitboxes[0].top = s->hitboxes[0].right = s->hitboxes[0].bottom = 0;
    s->hitboxes[1].left = s->hitboxes[1].top = s->hitboxes[1].right = s->hitboxes[1].bottom = 0;
  }
  s->graphics.anim = anim; s->variant = variant;
  if (restart) s->prevVariant = 0xFF;
  p->animName = name;
}

void player_animate(Player *p, const PlayerInput *in) {
  Sprite *s = &p->sprite;
  if (p->death == PLAYER_GONE) return;
  choose(p, pick(p, in), p->animRestart);
  p->animRestart = 0;
  if (p->state == PS_BRAKE && act.tick % 4 == 0) act_brake_dust();
  // a hitbox a frame sets is turned with him, as the sprite system applies its flips when it sets one
  s->frameFlags = (s->frameFlags & ~(SPRITE_X_FLIP | SPRITE_Y_FLIP)) | (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
  for (int guard = 0; guard < 4; guard++) {
    if (update_sprite(s, 0)) break;
    int before = p->state;
    after_animation(p);
    if (p->state == before) break;
    choose(p, pick(p, in), 0);
  }
  p->prio = (int)((s->frameFlags & SPRITE_PRIORITY) >> 12);
  p->prevState = p->state;
  p->hidden = !p->dead && (p->invisible || (p->invulnerable > 0 && (act.tick & 2)));
  // dead, the timers count down only on the frame he dies: the tasks that take over from then on leave them
  if (p->dead && p->invulnerable == 1) return;
  if (p->state != PS_HURT && p->invulnerable > 0) p->invulnerable--;
  // the speed shoes and invincibility run out
  if (p->speedUp > 0) p->speedUp--;
  if (p->invincible > 0) p->invincible--;
}

// --- drawing --------------------------------------------------------------------------------------------------------------------
// Sonic's sprite (OAM order 16): the walk frames go through the rotation hardware (matrix 0, normal size) and follow the
// slope, mirrored with a negative scale when he faces right, which also moves him 1 px left; facing left, the original
// shifts the other frames 1 px right. Under flipped gravity the other frames are turned over, and the rotated ones
// mirrored the other way and turned by half a turn less their angle. Dying puts him in front of the front layer.
void player_draw(Player *p, int camX, int camY) {
  if (p->hidden) return;
  Sprite *s = &p->sprite;
  // walking, bouncing and in a marble track he is drawn through the rotation hardware: at his surface's angle, or in a
  // track at the angle the track turned him to, and at his scale
  int rotated = p->state == PS_WALK || p->state == PS_BOUNCE || p->state == PS_MARBLE_TRACK;
  if (!rotated) p->drawRotation = 0;
  else if (p->state != PS_MARBLE_TRACK) p->drawRotation = p->rotation << 2;
  int sx = (int)__builtin_floor(p->x) - camX, sy = (int)__builtin_floor(p->y) - camY;
  int priority = p->death != PLAYER_ALIVE ? 1 : p->prio;
  s->frameFlags &= ~(SPRITE_PRIORITY | SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_ROT_SCALE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE);
  s->frameFlags |= (uint32_t)priority << 12;
  if (rotated) {
    int right = (p->facing > 0) != (p->inverted != 0);
    int rotation = p->drawRotation;
    Transform tf;
    tf.rotation = (uint16_t)(p->inverted ? (512 - rotation) & 1023 : rotation);
    tf.qScaleX = (int16_t)(right ? -p->scale : p->scale); tf.qScaleY = (int16_t)p->scale;
    tf.x = (int16_t)(sx - (right ? 1 : 0)); tf.y = (int16_t)sy;
    s->frameFlags |= SPRITE_ROT_SCALE_ENABLE;
    transform_sprite(s, &tf);
  } else {
    if (p->facing > 0) s->frameFlags |= SPRITE_X_FLIP;
    if (p->inverted) s->frameFlags |= SPRITE_Y_FLIP;
    s->x = (int16_t)(sx + (p->facing < 0 ? 1 : 0));
    s->y = (int16_t)sy;
  }
  display_sprite(s);
  // the animation's priority stays as its commands left it
  s->frameFlags = (s->frameFlags & ~SPRITE_PRIORITY) | (uint32_t)p->prio << 12;
}
