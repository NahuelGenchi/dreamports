// Sonic's, Tails', Knuckles' and Amy's movement, animation and drawing, and Tails' as the CPU's partner, translated from
// the JavaScript version's engine/player.js, engine/animator.js and the part of engine/game.js that draws them (drawSonic,
// drawTails), a function at a time and in the same order. Their speeds are doubles of pixels a frame, as there; the
// original does its arithmetic on 8.8 integers, so q8 turns a speed into one where it matters. The boost modes and the
// Sonic Advance 2 tricks are left out.

#include "objects.h"
#include "terrain.h"
#include "bosses.h"

// Sonic's sound effects (sound/songs.js)
enum {
  SE_SPIN = 109, SE_SPIN_DASH_RELEASE = 110, SE_SLIDE = 111, SE_AIR_DASH = 112, SE_INSTA_SHIELD = 113, SE_BRAKE = 115,
  SE_JUMP = 116, SE_SOMERSAULT = 121, SE_GRINDING = 114,
  SE_TAILS_FLYING = 120,   // SE_TAILS_PROPELLER_FLYING: Tails' flight, started again on each of its frames
  SE_DROWNING = 27,        // MUS_DROWNING, which the partner's water never stops
  SE_PUNCH_2 = 126, SE_PUNCH_3 = 127,   // Knuckles' second punch, and his third
  SE_AMY_HAMMER = 130, SE_AMY_SWIRL = 131, SE_AMY_GRINDING = 134,   // Amy's hammer in the air, swirled down, and her grinding
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
// Tails' flight (TAILS in engine/constants.js; Player_Tails_InitFlying, Player_Tails_8047A3C): 240 frames, counted down
// every other frame; a press lifts him 24/256 a frame for up to 31 frames while he rises slower than 0.75, and otherwise
// he sinks by 8/256 a frame
enum { FLY_TIME = 240, FLY_LIFT_FRAMES = 32 };
#define FLY_LIFT (24.0 / 256)
#define FLY_FALL (8.0 / 256)
#define FLY_RISE_MAX 0.75
// Knuckles (KNUCKLES in engine/constants.js): the glide starts at 3 px a frame, slowing his fall by 1.5, gains 6/256 a frame
// up to 3 and 3/256 more (6 more with speed shoes) up to 18 heading straight, loses 9/256 (3 more with shoes) under water
// above 3, and his fall eases by 24/256 toward 0.5; the slide after it slows by 24/256; he climbs at 0.75 (0.5 under water)
// and leaps off a wall 2.625 up and 3 away; each punch adds 3 and slows by 96/256 a frame; the uppercut rises 2 (1 under
// water) and goes 2 forward; floating he rises 24/256 a frame up to 1; a landing holds left and right for 15 frames
#define GLIDE_SPEED 3.0
#define GLIDE_SLOW 1.5
#define GLIDE_ACCEL (6.0 / 256)
#define GLIDE_STRAIGHT_ACCEL (3.0 / 256)
#define GLIDE_SHOES_ACCEL (6.0 / 256)
#define GLIDE_MAX 18.0
#define GLIDE_WATER_DECEL (9.0 / 256)
#define GLIDE_WATER_SHOES_DECEL (3.0 / 256)
#define GLIDE_FALL 0.5
#define GLIDE_FALL_STEP (24.0 / 256)
#define GLIDE_SLIDE_FRICTION (24.0 / 256)
#define CLIMB_SPEED 0.75
#define CLIMB_WATER_SPEED 0.5
#define WALL_JUMP_Y 2.625
#define WALL_JUMP_X 3.0
#define PUNCH_SPEED 3.0
#define PUNCH_FRICTION (96.0 / 256)
#define UPPERCUT_UP 2.0
#define UPPERCUT_WATER_UP 1.0
#define UPPERCUT_FORWARD 2.0
#define FLOAT_RISE (24.0 / 256)
#define FLOAT_MAX_RISE 1.0
enum {
  GLIDE_OFFSET_Y = 6,       // from his centre to his feet in a glide
  LAND_LOCK = 15,
  SLIDE_DUST_EVERY = 4,     // the slide's dust at his feet, every 4th frame of the clock
  SLIDE_FOLLOW = 12,        // the slide follows ground less than this far under him
  LEDGE_STEP = HALF_WIDTH + 3, LEDGE_CEILING = 9, LEDGE_REACH = 2,
  FLOAT_BELOW = 4,          // floating, his centre stays this far under the water's line
};
// Amy (AMY in engine/constants.js): her hammer's leap goes 6 px a frame from the ground (3.375 under water); her dive is
// thrown 4 along the ground (2.5) and rises 1.25 (0.75); its slam slides on at 2 at least (1.25), slowing as Knuckles'
// slide does, into a pose that holds left and right for 15 frames; her second swing adds 3, and a swing slows by 0.375
#define LEAP_SPEED 6.0
#define LEAP_WATER_SPEED 3.375
#define DIVE_SPEED 4.0
#define DIVE_WATER_SPEED 2.5
#define DIVE_RISE 1.25
#define DIVE_WATER_RISE 0.75
#define DIVE_SLIDE_SPEED 2.0
#define DIVE_SLIDE_WATER_SPEED 1.25
#define SWING2_SPEED 3.0
#define SWING_FRICTION 0.375
enum { DIVE_SLIDE_LOCK = 15, DIVE_FOLLOW = 7 };
// ANIMATION: the walk cycle plays at his speed, never slower than half, and the run starts at 4.5
#define RUN_SPEED 4.5
#define BRAKE_TURN_SPEED 1.5
enum { ANIM_NORMAL_SPEED = 0x10, ANIM_MIN_WALK_SPEED = 0x08 };

// what the pad says to the movement code: left and right hide up and down
typedef struct { int dir, sideways, left, right, up, down, jump, jumpPressed, attackPressed; } Control;

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

// the table of each character's first animation (gPlayerCharacterIdleAnims, offsets.characterAnims), which the
// character states before Sonic's own moves count from
enum { CHARACTER_ANIMS = 0x4A6F04 };
// his tails, as a spin shows them (SA1_ANIM_CHAR(TAILS, SPIN_ATTACK), variant 1), at OAM order 17 just behind him
enum { TAILS_SPIN_ANIM = 107, TAILS_SPIN_VARIANT = 1, TAILS_ORDER = 17, TAILS_TILES = 16, PARTNER_BODY_TILES = 64 / 8 * (64 / 8),
       PARTNER_MATRIX = 1 };

void player_init_partner(Player *p, int x, int y) {
  player_init(p, x, y);
  p->cpu = 1;
  // AllocateCharacterStageGfx: room for the largest frame of Sonic's run, from the heap; the body goes through the rotation
  // matrix of his player number when it is rotated
  p->sprite.graphics.dest = vram_malloc(PARTNER_BODY_TILES);
  p->sprite.frameFlags |= PARTNER_MATRIX;
  player_become_tails(p);
}

void player_become_tails(Player *p) {
  p->character = CHARACTER_TAILS;
  // AllocateCharacterMidAirGfx
  sprite_init(&p->tails);
  p->tails.graphics.dest = vram_malloc(TAILS_TILES);
  p->tails.graphics.anim = TAILS_SPIN_ANIM; p->tails.variant = TAILS_SPIN_VARIANT;
  p->tails.palId = 0;
  p->tails.oamFlags = (uint16_t)(TAILS_ORDER << 6);
  p->tails.frameFlags = DEFAULT_PRIORITY << 12 | SPRITE_ROT_SCALE_ENABLE | 4;
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
  // follows him; the background leaves it out. The CPU partner goes back with Sonic, never by himself.
  if (!p->cpu && act.stage.loopX >= 0 && p->x >= act.stage.loopX && c->speedX != 0 && !c->locked) {
    p->x += act.stage.loopShift; c->x += act.stage.loopShift; c->wrapped += act.stage.loopShift;
    c->wrappedThisFrame += act.stage.loopShift;
    if (act.hasPartner) act.partner.x += act.stage.loopShift;
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
static int is_amy(const Player *p) { return p->character == CHARACTER_AMY; }

// Amy's jump (Player_TryJump): she stays uncurled (charState 85), and with down held she dives (91), thrown along the ground
// as well as up. Returns how fast she leaves the ground.
static double amy_jump(Player *p, const Control *c) {
  if (!c->down) { p->state = PS_HAMMER_RISE; return jump_speed(p); }
  p->state = PS_DIVE; p->hammerJump = 0; p->dive = 1; p->jumped = 0; p->glideFlags = GLIDE_UP;
  int along = q8(p->water ? DIVE_WATER_SPEED : DIVE_SPEED), rot = p->rotation & 0xFF, dir = p->facing < 0 ? -1 : 1;
  p->xsp = ((dir * along * cos8(rot)) >> 8) / 256.0;
  p->ysp = ((dir * along * sin8(rot)) >> 8) / 256.0;
  return p->water ? DIVE_WATER_RISE : DIVE_RISE;
}

// jumps away from the surface, if there are at least 4 px of room that way
static int try_jump(Player *p, const Control *c) {
  if (!c->jumpPressed || sensors_clearance(p, sensors_act_angle(p) + 0x80) < ROOM_TO_JUMP) return 0;
  p->air = 1; p->jumped = 1; p->pushing = 0; p->state = PS_SPIN;
  double up = is_amy(p) ? amy_jump(p, c) : jump_speed(p);
  int a = (p->rotation - 0x40) & 0xFF, jump = q8(up);
  p->xsp = (q8(p->xsp) + ((jump * cos8(a)) >> 8)) / 256.0;
  p->ysp = (q8(p->ysp) + ((jump * sin8(a)) >> 8)) / 256.0;
  if (!is_amy(p)) {
    if (p->curled) p->airLock = 1;   // jumping out of a roll keeps the roll's momentum
    else curl(p);
  }
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
    act_dash_dust_of(p);
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
    if (!p->cpu) act_freeze_camera();   // the camera is Sonic's
    return 1;   // the release frame doesn't move
  }
  int a = p->dashAccel;
  if (a != 0) { a -= (a << 3) >> 8; if (a <= 0) a = 0; }
  if (p->state != PS_SPIN_DASH_REV) p->state = PS_SPIN_DASH;
  if (c->jumpPressed) {
    // each rev replays the spin sound, raised by the decayed charge in semitones
    gba_sound_play_pitched(SE_SPIN, a & ~0x7F);
    if (p->character != CHARACTER_TAILS) p->state = PS_SPIN_DASH_REV;   // only Sonic has a rev's animation
    a += DASH_REV;
    if (a < DASH_REV_MIN) a = DASH_REV_MIN;
  }
  p->dashAccel = a;
  return 1;
}

// ends the combo, the mid-air moves and the spin dash (also Player_TransitionCancelFlyingAndBoost), and stops the sound of
// Tails' flight unless `keepPropeller`
static void end_attack(Player *p, int keepPropeller) {
  p->attack = 0; p->attackNext = 0; p->midAir = 0; p->jumped = 0; p->spinDashing = 0; p->halfPipe = 0;
  if (p->character == CHARACTER_TAILS && !keepPropeller) stop_song(SE_TAILS_FLYING);
  if (is_amy(p)) { p->hammerJump = 0; p->dive = 0; }
}
void player_end_attack(Player *p) { end_attack(p, 0); }

// Tails' tail swipe on the ground (sub_80480C4): as Sonic's combo, not while he revs a spin dash, pushes, or stands on a
// wall or the ceiling; its first frame is his whole frame. Its effect comes with it.
static int try_swipe(Player *p, const Control *c) {
  int floor = (p->rotation + 0x40) & 0xFF;
  if (p->spinDashing || p->pushing || floor == 0 || floor >= 0x80 || !c->attackPressed) return 0;
  p->attack = 1; p->state = PS_TAIL_SWIPE;
  act_tail_swipe(p);
  return 1;
}
// the swipe's frames (sub_8048110): the ground speed eases off by half the deceleration
static void swipe_step(Player *p) {
  p->gsp = toward0(p->gsp, decel(p) / 2);
  along_surface(p);
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
// half-width; a side at 0 never counts. Once balancing, he keeps on a pixel further in. Its place is where its sprite was
// last drawn on the screen, from where the camera is now, which for an object that moves is where it was a frame before.
static void balance_on_object(Player *p) {
  const Object *o = p->onObject;
  const Hitbox *hb = object_box(&o->sprite, 0);
  if (!hb) return;
  int l = hb->left, r = hb->right, x = o->sprite.x + cam_x();
  if (l != 0 && p->x < x + l - HALF_WIDTH + 1) { balance(p, -1); return; }
  if (r != 0 && p->x > x + r + HALF_WIDTH - 2) { balance(p, 1); return; }
  if ((p->x < x + l - HALF_WIDTH + 2 || p->x > x + r + HALF_WIDTH - 3) && (p->prevState == PS_BALANCE_FORWARD || p->prevState == PS_BALANCE_BACK)) {
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
    // Amy crouches on the move, with no roll, slowing as she would braking
    if (is_amy(p) && p->state == PS_CROUCH) p->gsp = toward0(p->gsp, decel(p));
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
    if (p->gsp != 0 && !is_amy(p)) { curl(p); p->state = PS_SPIN; play_song(SE_SPIN); }
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
  // a wall to the side stops the roll and stands him up, pushing: the roll ends with the walking check (sub_8023128)
  if (sensors_wall_push(p, 0) && p->curled) { uncurl(p); p->state = PS_WALK; }
}

// on a frame a jump or a B move starts nothing else runs; while revving a spin dash Sonic stays put but still follows the
// ground (Player_Sonic_80473AC)
// standing on an object, the object holds him up and the ground sensors rest (sub_8022D6C)
static void follow_ground(Player *p) {
  if (p->onObject) { p->rotA = p->rotB = 0; return; }
  sensors_ground(p);
}

// jumping off a grind rail (sub_8044434), if there are at least 4 px of room that way on the layer he came from, back on
// which he lands: straight up from the rail as fast as a jump, keeping his X speed
static int try_rail_jump(Player *p, const Control *c) {
  if (!c->jumpPressed) return 0;
  p->layer ^= 1;
  if (sensors_clearance(p, sensors_act_angle(p) + 0x80) < ROOM_TO_JUMP) { p->layer ^= 1; return 0; }
  stop_song(is_amy(p) ? SE_AMY_GRINDING : SE_GRINDING);
  p->air = 1; p->jumped = 1; p->pushing = 0; p->grinding = 0; p->state = player_thrown_state(p);
  p->ysp = (q8(jump_speed(p)) * sin8((p->rotation - 0x40) & 0xFF) >> 8) / 256.0;
  play_song(SE_JUMP);
  p->front = 0;
  if (!is_amy(p)) curl(p);
  return 1;
}

// grinding down a rail (sub_80449D8): down or right (even with left) pulls him down its slope at 5/32 of the slope's
// sine, more than a walk, left brakes, and he always slows down, but never below 0.75 px a frame
static void grind_step(Player *p, const Control *c) {
  if ((c->down || c->dir > 0) && ((p->rotation + 0x60) & 0xFF) < 0xC0) p->gsp = (q8(p->gsp) + ((sin8(p->rotation) * 5) >> 5)) / 256.0;
  int g = q8(p->gsp);
  if (c->dir < 0) { int braked = g - 8; g = braked > 0xC0 ? braked : 0xC0; }
  int slowed = g - 8;
  p->gsp = (slowed > 0xC0 ? slowed : 0xC0) / 256.0;
  p->state = PS_GRIND;
  along_surface(p);
}

// --- Knuckles on the ground ---------------------------------------------------------------------------------------------------
static int is_knuckles(const Player *p) { return p->character == CHARACTER_KNUCKLES; }
int player_climbing(const Player *p) { return is_knuckles(p) && p->state >= PS_WALL_GRAB && p->state <= PS_LEDGE_TOP; }
int player_gliding(const Player *p) { return is_knuckles(p) && (p->midAir == KN_GLIDE || p->midAir == KN_SLIDE); }
// his own states (charState 62 and up), which standing up from a glide ends; under water his glide is PS_SWIM
static int knuckles_state(int state) { return (state >= PS_GLIDE && state <= PS_WATER_FLOAT_UP) || state == PS_SWIM; }

// speed added along angle `a` (8.8)
static void push_along(Player *p, int speed, int a) {
  a &= 0xFF;
  p->xsp = (q8(p->xsp) + ((speed * cos8(a)) >> 8)) / 256.0;
  p->ysp = (q8(p->ysp) + ((speed * sin8(a)) >> 8)) / 256.0;
}

// the first punch (sub_8048ADC), not while he revs a spin dash, pushes, or stands on a wall or the ceiling
static int try_punch(Player *p, const Control *c) {
  if (p->spinDashing || s8(p->rotation + 0x40) <= 0 || p->pushing || !c->attackPressed) return 0;
  p->gsp += PUNCH_SPEED * p->facing;
  p->attack = 1; p->state = PS_PUNCH1;
  return 1;
}

// the uppercut (sub_8048B38), if there are at least 4 px of room above him, and otherwise he stops as on landing: up from
// the surface and forward along it, with its flame
static void uppercut(Player *p) {
  if (sensors_clearance(p, sensors_act_angle(p) + 0x80) < ROOM_TO_JUMP) { player_land(p); return; }
  p->air = 1; p->grinding = 0; p->pushing = 0;
  push_along(p, q8(p->water ? UPPERCUT_WATER_UP : UPPERCUT_UP), p->rotation - 0x40);
  push_along(p, q8(UPPERCUT_FORWARD) * p->facing, p->rotation);
  p->state = PS_UPPERCUT;
  act_uppercut_flame(p);
}

// Knuckles on his feet, not rolling (sub_8048CB0): B starts his punches, each slowing him by 96/256 a frame, and the third
// becomes an uppercut. The frame a punch starts he moves as he did. 1 when a jump started, 2 a spin dash.
static int knuckles_ground(Player *p, const Control *c) {
  if (p->attack == 0) {
    if (try_punch(p, c)) return 0;
    if (try_spin_dash(p, c)) return 2;
    if (try_jump(p, c)) return 1;
    slope(p);
    walk_step(p, c);
    return 0;
  }
  slope(p);
  // sub_8048C3C: B during the first two punches queues the next; the third tries the uppercut each frame
  if (p->attack == 3) { uppercut(p); return 0; }
  if (c->attackPressed) p->attackNext = 1;
  p->gsp = toward0(p->gsp, PUNCH_FRICTION);
  along_surface(p);
  sensors_wall_push(p, 1);
  return 0;
}

// --- Amy on the ground ------------------------------------------------------------------------------------------------------
// what her hammer hits: the moves that swing it (charStates 87 to 90), while their animation has its box out
int player_hammer_hits(const Player *p, int x, int y, const Hitbox *hb) {
  if (!is_amy(p) || !hb || (p->state != PS_HAMMER && p->state != PS_HAMMER2 && p->state != PS_HAMMER_AIR && p->state != PS_HAMMER_SWIRL)) return 0;
  const Hitbox *atk = object_box(&p->sprite, 1);
  return atk && collide_overlap(x, y, hb, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), atk);
}
double player_hammer_speed(double v) { int q = q8(v); return (q + (q >> 1)) / 256.0; }
int player_thrown_state(const Player *p) { return is_amy(p) ? PS_HAMMER_RISE : PS_SPIN; }
int player_slamming(const Player *p) { return is_amy(p) && p->dive && p->attack != 0; }
void player_bounce_off_boss(Player *p) {
  p->xsp = is_amy(p) ? (q8(p->xsp) >> 1) / 256.0 : -p->xsp;
  p->ysp = -p->ysp;
}

// her hammer on the ground (sub_8049370): a swing where the ground allows it, or with down held and at least 4 px of room
// above her, a leap away from the surface with the jump's sound
static int try_hammer(Player *p, const Control *c, int level) {
  if (!c->attackPressed || p->halfPipe) return 0;   // not while a half-pipe lifts her (MOVESTATE_8000)
  if (!c->down) {
    if (!level) return 0;
    p->attack = 1; p->state = PS_HAMMER;
    act_amy_hearts(p);
    return 1;
  }
  if (sensors_clearance(p, sensors_act_angle(p) + 0x80) < ROOM_TO_JUMP) return 0;
  p->state = PS_HAMMER_LEAP;
  push_along(p, q8(p->water ? LEAP_WATER_SPEED : LEAP_SPEED), p->rotation - 0x40);
  p->air = 1; p->pushing = 0; p->jumped = 1; p->dive = 0; p->hammerJump = 1;
  play_song(SE_JUMP);
  return 1;
}

// Amy on the ground (sub_80494E8): with no swing going, her hammer, her jump or a walk. A swing slows her by 0.375 a frame,
// and a press during the first one queues the second. True if it took the whole frame.
static int amy_ground(Player *p, const Control *c) {
  int floor = (p->rotation + 0x40) & 0xFF, level = !p->pushing && floor != 0 && floor < 0x80;
  if (p->attack == 0) {
    if (try_hammer(p, c, level)) return 1;
    if (try_jump(p, c)) return 1;
    slope(p);
    walk_step(p, c);
    return 0;
  }
  if (p->attack == 1 && level && p->attackNext == 0 && c->attackPressed) p->attackNext = 1;
  slope(p);
  p->gsp = toward0(p->gsp, SWING_FRICTION);
  along_surface(p);
  sensors_wall_push(p, 1);
  return 0;
}

static void ground_step(Player *p, const Control *c) {
  if (p->curled) {
    if (try_jump(p, c)) return;
    roll_slope(p);
    roll_step(p, c);
  } else if (p->grinding) {
    if (try_rail_jump(p, c)) return;
    grind_step(p, c);
    bounds(p);
    move(p);
    follow_ground(p);
    return;
  } else if (is_knuckles(p)) {
    int started = knuckles_ground(p, c);
    if (started == 1) return;
    if (started == 2) { bounds(p); follow_ground(p); return; }
  } else if (is_amy(p)) {
    if (amy_ground(p, c)) return;
  } else if (p->attack != 0) {
    slope(p);
    if (p->character == CHARACTER_TAILS) swipe_step(p);
    else attack_step(p, c);
    sensors_wall_push(p, 1);   // the rolling check: a wall stops the combo's moves without starting a push
  } else {
    if (p->character == CHARACTER_TAILS ? try_swipe(p, c) : attack_step(p, c)) return;
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

// RandomlySpawnAirBubbles under water: on every 8th frame of the stage clock, one time in four, a bubble at his centre,
// moving with him, small or a group. The original's random offsets, up to 15 px across and 8 px up or down, are taken off
// his 8.8 position, so they move it by as many 1/256 px.
static void swim_bubbles(Player *p) {
  if (act_stage_time() % 8 != 0 || (act_random() & 0x300) != 0) return;
  int dx = (int)((act_random() & 0xF00) >> 8), dy = (int)((act_random() & 0xF00) >> 8) - 8;
  water_bubble(q8(p->x) - (p->facing > 0 ? -dx : dx), q8(p->y) - dy, q8(p->xsp), (act_random() & 0x100) != 0);
}

// how he flies (Player_Tails_8047990): tired out once the time is up; under water swimming, turning while left or right
// is held against the way he faces, and letting bubbles out; in the air flying the same way, with the propeller's sound
// going. A turn in the air plays out once begun; the water's turn is checked as the air's is, as in the original, so it
// lasts one frame, and a turn from the air goes on in the water.
static void flight_state(Player *p) {
  int held = p->held[0], against = ((held & DPAD_LEFT) && p->facing > 0) || ((held & DPAD_RIGHT) && p->facing < 0);
  if (p->flyTime == 0) {
    p->state = PS_FLY_TIRED;
    stop_song(SE_TAILS_FLYING);
  } else if (p->water) {
    if (against) p->state = PS_SWIM_TURN;
    else if (p->state != PS_FLY_TURN) p->state = PS_SWIM;
    swim_bubbles(p);
    stop_song(SE_TAILS_FLYING);
  } else {
    if (against) p->state = PS_FLY_TURN;
    else if (p->state != PS_FLY_TURN) p->state = PS_FLY;
    play_song_or_change(SE_TAILS_FLYING);
  }
}

// Tails takes off (Player_Tails_InitFlying), uncurling with his feet in place, with 8 seconds of flight; this frame's
// gravity still pulls him
static void start_flying(Player *p) {
  if (p->curled) uncurl(p);
  p->flyTime = FLY_TIME;
  flight_state(p);
}

// a frame of flight (Player_Tails_8047A3C): the time runs down every other frame; a press lifts him while he rises slower
// than 0.75, until 31 frames have lifted him or he rises faster, and otherwise he sinks. He stops at the camera's top edge.
static void fly_step(Player *p, const Control *c) {
  if ((act_stage_time() & 1) != 0 && p->flyTime != 0) p->flyTime--;
  if (p->midAir != 1) {
    if (p->ysp >= -FLY_RISE_MAX) {
      p->ysp -= FLY_LIFT;
      if (++p->midAir == FLY_LIFT_FRAMES) p->midAir = 1;
    } else p->midAir = 1;
  } else {
    if (c->jumpPressed && p->ysp >= -FLY_RISE_MAX && p->flyTime != 0) p->midAir = 2;
    p->ysp += FLY_FALL;
  }
  int top = act.cam.minY;
  if (p->y < top) { p->y = top; if (p->ysp < 0) p->ysp = 0; }
  flight_state(p);
}

// --- Knuckles in the air ------------------------------------------------------------------------------------------------------
static void drown_count_reset(Player *p);

// left or right and the drag in the air (Player_AirInputControls), none while knocked back
static void air_input(Player *p, const Control *c) {
  if (p->state == PS_HURT) return;
  air_control(p, c, p->state != PS_BOUNCE);
  if (p->ysp < 0) air_drag(p);
}

// the frame he goes into the water not rising, he floats (MOVESTATE_1000), uncurled with his centre where it is
static void try_float(Player *p) {
  if (!p->waterCrossed || !p->water || p->ysp < 0) return;
  p->midAir = KN_FLOAT; p->curled = 0; p->airLock = 0;
  p->state = PS_WATER_FLOAT;
  act_float_splash(p);
}

// floating (Player_Knuckles_SwimFloat_8048D74): down lets him sink; under water he rises by 24/256 a frame up to 1, and at
// 4 px under the line he stops there, his breath back and the drowning music stopped; up looks up
static void float_step(Player *p, const Control *c) {
  if (c->down) { p->state = PS_SPRING_PEAK; p->midAir = 0; return; }
  if (p->water) { p->ysp -= FLOAT_RISE; if (p->ysp < -FLOAT_MAX_RISE) p->ysp = -FLOAT_MAX_RISE; }
  int level = water_level();
  if ((int)__builtin_floor(p->y) - FLOAT_BELOW < level) {
    p->y = level + FLOAT_BELOW; p->ysp = 0; p->water = 1;
    drown_count_reset(p);
    water_drowning_music_stop();
  }
  if (c->up) p->state = PS_WATER_FLOAT_UP;
  else {
    if (p->state != PS_WATER_FLOAT) act_float_splash(p);
    p->state = PS_WATER_FLOAT;
  }
}

// his glide heads left from a quarter turn round from right
static int glides_left(const Player *p) { return s8(p->glideShift + 0x40) <= 0; }

// the glide starts (Player_Knuckles_InitGlide): uncurled at 6 px from his centre to his feet, his centre where it is,
// slowing his fall by 1.5, at 3 the way he faces (1.5 under water)
static void start_glide(Player *p) {
  p->curled = 0; p->offsetY = GLIDE_OFFSET_Y;
  p->ysp += GLIDE_SLOW; if (p->ysp < 0) p->ysp = 0;
  int g = q8(GLIDE_SPEED);
  if (p->water) g >>= 1;
  p->gsp = p->xsp = g * p->facing / 256.0;
  p->glideShift = p->facing < 0 ? 0x80 : 0;
  p->rotation = 0;
  p->glideFlags = GLIDE_UP;
}

// the jump cap, or once the rise has slowed his glide (Player_8044670)
static void knuckles_jump_cap(Player *p, const Control *c) {
  if (p->jumped) {
    double cap = p->water ? WATER_JUMP_RELEASE_CAP : JUMP_RELEASE_CAP;
    if (p->ysp < -cap) { if (!c->jump) p->ysp = -cap; }
    else if (p->midAir == 0 && c->jumpPressed && p->state != PS_HURT) { p->airLock = 0; p->midAir = KN_GLIDE; start_glide(p); }
  } else if (!p->forcedRoll && p->ysp < -RISE_CAP) p->ysp = -RISE_CAP;
}

// a frame of glide (sub_8048980): its speed and heading, held left or right turning him round 2/256 of a turn a frame, a
// turn begun going on to its end; his X speed follows the heading and his fall eases toward 0.5. On each of these frames
// the camera's look also eases back.
static void glide_physics(Player *p, const Control *c) {
  p->lookEase = LOOK_EASE_GLIDE;
  if (p->midAir != KN_GLIDE) return;
  int g = q8(p->gsp), s = p->glideShift, shoes = pace(p) == 2;
  if (g < 0) g = -g;
  if (g < q8(GLIDE_SPEED)) g += q8(GLIDE_ACCEL);
  else if (g < q8(GLIDE_MAX) && (s & 0x7F) == 0) g += q8(GLIDE_STRAIGHT_ACCEL) + (shoes ? q8(GLIDE_SHOES_ACCEL) : 0);
  if (p->water && g > q8(GLIDE_SPEED)) {
    g -= q8(GLIDE_WATER_DECEL) + (shoes ? q8(GLIDE_WATER_SHOES_DECEL) : 0);
    if (g < q8(GLIDE_SPEED)) g = q8(GLIDE_SPEED);
  }
  p->gsp = (glides_left(p) ? -g : g) / 256.0;
  int turn = s8(s) < 0 ? -s8(s) : s8(s);
  if (c->left) { if (s != 0x80) s = (turn + 2) & 0xFF; }
  else if (c->right) { if (s != 0) s = (-turn + 2) & 0xFF; }
  else if (s & 0x7F) s = (s + 2) & 0xFF;
  p->glideShift = s;
  p->xsp = ((cos8(s) * g) >> 8) / 256.0;
  p->ysp = (q8(p->ysp) + (q8(p->ysp) < q8(GLIDE_FALL) ? 1 : -1) * q8(GLIDE_FALL_STEP)) / 256.0;
}

// how he glides (Player_Knuckles_GlideUpdateAnim): straight, or under water swimming and letting bubbles out, facing left
// only when heading straight left; turning, one of four frames by how far round
static void glide_anim(Player *p) {
  int s = p->glideShift;
  p->pushing = 0; p->facing = 1;
  if ((s & 0x7F) == 0) {
    if (p->water) { p->state = PS_SWIM; swim_bubbles(p); }
    else p->state = PS_GLIDE;
    if (s == 0x80) p->facing = -1;
  } else {
    int turn = s8(s) < 0 ? -s8(s) : s8(s);
    p->state = PS_GLIDE_TURN0 + ((turn & 0x7F) >> 5);
  }
}

// stood up out of the glide or the climb (sub_8022318), his feet 14 px under his centre: curled, he uncurls keeping his
// feet in place; otherwise his centre stays where it is
static void stand_from_glide(Player *p) {
  if (p->curled) {
    p->curled = 0; p->state = PS_IDLE;
    int dy = p->offsetY - SPRITE_OFFSET_Y;
    if (p->inverted) dy = -dy;
    if (s8(p->rotation + 0x40) <= 0) dy = -dy;
    p->y += dy;
  }
  p->offsetY = SPRITE_OFFSET_Y;
  p->air = 0; p->pushing = 0; p->airLock = 0; p->jumped = 0; p->halfPipe = 0;
  p->chain = 0; p->midAir = 0;
  if (knuckles_state(p->state)) p->state = PS_IDLE;
}

// letting go of the glide or losing the wall (sub_8049348): he drops, standing height from his centre
static void start_drop(Player *p) {
  p->midAir = KN_DROP; p->state = PS_GLIDE_DROP;
  p->offsetY = SPRITE_OFFSET_Y;
  p->glideFlags |= GLIDE_UP;
}

// the glide's frame after it moves (sub_8048230): touching down on a steep slope stands him up, on flatter ground he slides
// on with the slide's sound; a wall he grabs, if it is flat for his height and the ground under its foot leaves room, and
// otherwise he drops; letting go of jump drops him with a quarter of his X speed
static void glide_step(Player *p, const Control *c) {
  sensors_glide(p);
  if (!(p->glideFlags & GLIDE_UP)) {
    p->facing = p->xsp <= 0 ? -1 : 1;
    if ((p->rotation + 0x20) & 0xC0) {
      p->facing = glides_left(p) ? -1 : 1;
      p->ysp = 0;
      stand_from_glide(p);
      p->state = p->gsp != 0 ? PS_WALK : PS_IDLE;
    } else {
      p->midAir = KN_SLIDE; p->state = PS_GLIDE_SLIDE;
      play_song(SE_SLIDE);
    }
  } else if (p->glideFlags & GLIDE_WALL) {
    int dir = glides_left(p) ? -1 : 1;
    SensorPair w = sensors_wall_beside(p, dir);
    p->facing = dir;
    if (w.d != w.out) { start_drop(p); return; }
    if (w.d != 0) {
      // the ground at the wall's foot, a pixel past his feet; not looked at to the right under flipped gravity
      if (dir < 0 || !p->inverted) {
        int up = p->inverted ? -1 : 1;
        int foot = terrain_scan(PROBE_FLOOR, (int)__builtin_floor(p->y) + up * (1 + p->offsetY), (int)__builtin_floor(p->x) + dir * (1 + HALF_WIDTH), p->layer, 8 * up).d;
        if (foot < 0) { start_drop(p); return; }
      }
      p->x += dir * w.d;
    }
    p->gsp = 0; p->xsp = 0; p->ysp = 0;
    p->midAir = KN_CLIMB; p->glideShift = 3; p->state = PS_WALL_GRAB;
  } else if (!c->jump) {
    p->midAir = KN_DROP; p->state = PS_GLIDE_DROP;
    p->facing = p->xsp <= 0 ? -1 : 1;
    p->xsp = (q8(p->xsp) >> 2) / 256.0;
    p->offsetY = SPRITE_OFFSET_Y;
  } else glide_anim(p);
}

// the drop (sub_80484CC): air control and gravity after he moves; landing stops him, and on flat ground he lands into a
// crouch that holds left and right for 15 frames
static void drop_step(Player *p, const Control *c) {
  air_input(p, c);
  p->ysp += gravity(p);
  sensors_glide(p);
  if (p->glideFlags & GLIDE_UP) return;
  p->gsp = 0; p->xsp = 0; p->ysp = 0;
  p->offsetY = SPRITE_OFFSET_Y;
  stand_from_glide(p);
  if (!((p->rotation + 0x20) & 0xC0)) { p->lock = LAND_LOCK; p->state = PS_DROP_LAND; }
}

// sliding on (sub_8048524): dust at his feet every 4th frame; he follows the ground less than 12 px under him, and with
// none, unless he is on an object, he drops at standing height
static void slide_on(Player *p) {
  if (act_stage_time() % SLIDE_DUST_EVERY == 0)
    act_brake_dust_at((int)__builtin_floor(p->x), (int)__builtin_floor(p->y) + (p->inverted ? -p->offsetY : p->offsetY));
  sensors_glide(p);
  SensorPair f = sensors_floor_under(p);
  if (f.d < SLIDE_FOLLOW) { p->y += p->inverted ? -f.d : f.d; p->rotation = f.rot; }
  else if (!p->onObject) { p->midAir = KN_DROP; sensors_set_offset_y(p, SPRITE_OFFSET_Y); p->glideFlags |= GLIDE_UP; }
}

// the slide after a glide (sub_80485CC): while jump is held and he hasn't stopped he slides on, slowing, and otherwise he
// gets up at standing height, into the end of a crouch, holding left and right for 15 frames
static void slide_step(Player *p, const Control *c) {
  if (c->jump) {
    if (p->xsp <= 0) { p->xsp += GLIDE_SLIDE_FRICTION; if (p->xsp < 0) { slide_on(p); return; } }
    else { p->xsp -= GLIDE_SLIDE_FRICTION; if (p->xsp > 0) { slide_on(p); return; } }
  }
  p->gsp = 0; p->xsp = 0; p->ysp = 0;
  p->y += (p->inverted ? -1 : 1) * (p->offsetY - SPRITE_OFFSET_Y);
  stand_from_glide(p);
  p->lock = LAND_LOCK; p->state = PS_CROUCH_END;
}

// the wall he climbs, 2 px past his side at his centre's height (sub_8048650), whose angle he takes (a quarter turn where
// it has none); the original reads its angle from an unset byte when nothing is there, which here leaves his angle as it was
static int climb_wall(Player *p) {
  int dir = p->facing;
  Scan r = terrain_scan(PROBE_WALL, (int)__builtin_floor(p->x) + dir * (LEDGE_REACH + HALF_WIDTH), (int)__builtin_floor(p->y), p->layer, 8 * dir);
  if (r.hasRot) p->rotation = r.rot & 1 ? (dir < 0 ? 0x40 : 0xC0) : r.rot;
  return r.d;
}

// down the wall onto the ground
static void climb_stand(Player *p, SensorPair f) {
  p->y += f.d; p->rotation = f.rot;
  stand_from_glide(p);
  p->state = PS_GLIDE_DROP;
}

// climbing (sub_80486E8), standing on nothing: up climbs while the wall reaches his head, and onto the ledge where it ends,
// stopped by a ceiling 9 px over him; down climbs while it reaches his feet, until the ground; still, he keeps to it until
// the ground. Off the wall, or on an object, he drops. Jump leaps off it, 2.625 up and 3 away, curled up.
static void climb_step(Player *p, const Control *c) {
  int up = p->inverted ? -1 : 1;
  if (p->onObject) { start_drop(p); return; }
  p->gsp = 0; p->xsp = 0; p->ysp = 0;
  if (p->state != PS_WALL_GRAB) p->state = PS_CLIMB;
  int s = q8(p->water ? CLIMB_WATER_SPEED : CLIMB_SPEED);
  if (pace(p) == 2) s <<= 1;
  if (c->up || c->down) {
    int dy = up * p->offsetY * (c->up ? -1 : 1);
    p->y += dy;
    int d = climb_wall(p);
    p->y -= dy;
    if (c->up) {
      if (d > LEDGE_REACH) {
        p->state = PS_LEDGE_CLIMB;
        p->y -= up * p->offsetY;
        p->midAir = KN_LEDGE; p->glideShift = 0;
        return;
      }
      if (d >= 0) {
        p->y -= up * LEDGE_CEILING;
        int ceiling = sensors_act_ceiling(p).d;
        p->y += up * LEDGE_CEILING;
        p->state = PS_CLIMB_UP;
        if (ceiling < 0) p->y -= ceiling;
        else p->ysp = -s / 256.0;
        p->lookEase = LOOK_EASE_CLIMB;
      }
    } else {
      if (d > 0) { start_drop(p); return; }
      SensorPair f = sensors_act_floor(p);
      if (f.d < 0) { climb_stand(p, f); return; }
      p->state = PS_CLIMB_DOWN; p->ysp = s / 256.0;
      p->lookEase = LOOK_EASE_CLIMB;
    }
  } else {
    if (climb_wall(p) > 0) { start_drop(p); return; }
    SensorPair f = sensors_act_floor(p);
    if (f.d < 0) { climb_stand(p, f); return; }
  }
  if (c->jumpPressed) {
    p->facing = -p->facing;
    p->ysp = -WALL_JUMP_Y; p->xsp = WALL_JUMP_X * p->facing;
    p->curled = 1; p->air = 1; p->jumped = 1; p->offsetY = BALL_SPRITE_OFFSET_Y;
    p->state = PS_SPIN; p->midAir = 0;
  }
}

// Knuckles in the air (sub_8048E34, and Player_Knuckles_8049000's case for a jump), by midAir: going into the water not
// rising floats him; the glide, the drop from it, the slide after it and the climb move first and then run their own step;
// the ledge climb only waits for its animation
static void knuckles_air(Player *p, const Control *c) {
  if (p->curled || p->midAir == 0) {
    // after the uppercut, none of the jump's control
    if (p->curled || p->attack == 0) {
      knuckles_jump_cap(p, c);
      try_float(p);
      air_input(p, c);
    } else try_float(p);
    bounds(p);
    move(p);
    p->ysp += gravity(p);
    tumble(p);
    sensors_air(p);
    return;
  }
  if (p->midAir == KN_FLOAT) {
    // a jump off the water goes half as high, and leaves the camera's look as it is this frame
    if (try_jump(p, c)) { p->ysp = (q8(p->ysp) >> 1) / 256.0; p->midAir = 0; p->lookEase = LOOK_EASE_STILL; return; }
    air_input(p, c);
    bounds(p);
    move(p);
    float_step(p, c);
    p->ysp += gravity(p);
    tumble(p);
    sensors_air(p);
    return;
  }
  if (p->midAir == KN_DROP) try_float(p);
  glide_physics(p, c);
  bounds(p);
  move(p);
  switch (p->midAir) {
    case KN_GLIDE: glide_step(p, c); break;
    case KN_DROP: drop_step(p, c); break;
    case KN_SLIDE: slide_step(p, c); break;
    case KN_CLIMB: climb_step(p, c); break;
  }
}

// --- Amy in the air ------------------------------------------------------------------------------------------------------------
// her dive (sub_80495F0): no control in the air. A press turns it into a slam (charState 92) that slides on from where it
// lands, at 2 px a frame at least (1.25 under water), slowing by 24/256 with dust every 4th frame, into a short pose that
// holds left and right for 15 frames; off the edge of what it slides on she carries on falling
static void dive_step(Player *p, const Control *c) {
  bounds(p);
  move(p);
  p->ysp += gravity(p);
  tumble(p);
  if (p->attack == 0) {
    if (c->attackPressed) { p->state = PS_DIVE_SLAM; p->attack = 1; }
    sensors_air(p);
    return;
  }
  sensors_glide(p);
  if (p->attack == 1) {
    if (p->glideFlags & GLIDE_UP) return;
    int least = q8(p->water ? DIVE_SLIDE_WATER_SPEED : DIVE_SLIDE_SPEED), now = q8(p->xsp);
    p->xsp = (p->facing < 0 ? -(least > -now ? least : -now) : (least > now ? least : now)) / 256.0;
    p->gsp = p->xsp;
    p->attack = 2;
    play_song(SE_SLIDE);
    return;
  }
  if (!(p->glideFlags & GLIDE_UP)) {
    int going;
    if (p->xsp <= 0) { p->xsp += GLIDE_SLIDE_FRICTION; going = p->xsp < 0; }
    else { p->xsp -= GLIDE_SLIDE_FRICTION; going = p->xsp > 0; }
    if (!going) {
      p->gsp = 0; p->xsp = 0; p->ysp = 0;
      stand_from_glide(p);
      p->dive = 0; p->lock = DIVE_SLIDE_LOCK; p->state = PS_DIVE_END;
      return;
    }
  }
  if (act_stage_time() % SLIDE_DUST_EVERY == 0)
    act_brake_dust_at((int)__builtin_floor(p->x), (int)__builtin_floor(p->y) + (p->inverted ? -p->offsetY : p->offsetY));
  sensors_glide(p);
  SensorPair f = sensors_floor_under(p);
  if (f.d < DIVE_FOLLOW) { p->y += p->inverted ? -f.d : f.d; p->rotation = f.rot; }
  else if (!p->onObject) { p->attack = 1; p->glideFlags |= GLIDE_UP; }
}

// Amy in the air (sub_80497AC): her dive, or as anyone jumps, with her hammer unless she leapt or bounced
static void amy_air(Player *p, const Control *c) {
  if (p->dive) { dive_step(p, c); return; }
  if (!p->hammerJump) {
    if (p->attack == 0 && c->attackPressed) {   // sub_804948C
      p->attack = 1;
      int swirl = c->down;
      play_song(swirl ? SE_AMY_SWIRL : SE_AMY_HAMMER);
      if (swirl) p->xsp = 0;
      p->state = swirl ? PS_HAMMER_SWIRL : PS_HAMMER_AIR;
      act_amy_hearts(p);
    }
    // the jump cap (Player_8044670): she has no move of her own to start once the rise has slowed
    if (p->jumped) {
      double cap = p->water ? WATER_JUMP_RELEASE_CAP : JUMP_RELEASE_CAP;
      if (p->ysp < -cap) { if (!c->jump) p->ysp = -cap; }
      else if (p->midAir == 0 && c->jumpPressed) { p->airLock = 0; p->midAir = 1; }
    } else if (!p->forcedRoll && p->ysp < -RISE_CAP) p->ysp = -RISE_CAP;
  }
  air_control(p, c, p->state != PS_BOUNCE);
  if (p->ysp < 0) air_drag(p);
  bounds(p);
  move(p);
  p->ysp += gravity(p);
  tumble(p);
  sensors_air(p);
}

static void air_step(Player *p, const Control *c) {
  if (is_knuckles(p)) { knuckles_air(p, c); return; }
  // knocked back, he flies on as he was thrown: no moves, no control and no drag, but his tilt still eases back
  if (p->state == PS_HURT) {
    bounds(p);
    move(p);
    p->ysp += gravity(p);
    tumble(p);
    sensors_air(p);
    return;
  }
  if (is_amy(p)) { amy_air(p, c); return; }
  // Sonic's double-tap dash, only while curled up (sub_8047714)
  if (p->character == CHARACTER_SONIC && p->curled && p->jumped && p->midAir == 0) {
    int tap = double_tap(p);
    if (tap) {
      p->midAir = 2; p->state = PS_AIR_DASH;
      p->xsp += (q8(top_speed(p)) >> 2) / 256.0 * tap;
      p->ysp = 0;
      play_song(SE_AIR_DASH);
    }
  }
  // jump cap, or once the rise has slowed Sonic's insta-shield or Tails' flight (Player_8044670); in flight, its own step
  // instead (Player_Tails_8047A3C)
  int flying = p->character == CHARACTER_TAILS && p->midAir != 0 && !p->curled;
  if (flying) fly_step(p, c);
  else if (p->jumped) {
    double cap = p->water ? WATER_JUMP_RELEASE_CAP : JUMP_RELEASE_CAP;
    if (p->ysp < -cap) { if (!c->jump) p->ysp = -cap; }
    else if (p->midAir == 0 && c->jumpPressed) {
      p->airLock = 0; p->midAir = 1;
      if (p->character == CHARACTER_TAILS) start_flying(p);
      else {
        p->state = PS_INSTA_SHIELD;
        play_song(SE_INSTA_SHIELD);
        act_insta_shield();
      }
    }
  } else if (!p->forcedRoll && p->ysp < -RISE_CAP) p->ysp = -RISE_CAP;

  // air control and drag (Player_AirInputControls); off a bounce block he keeps facing the way he went up
  air_control(p, c, p->state != PS_BOUNCE);
  if (p->ysp < 0) air_drag(p);
  bounds(p);
  move(p);
  if (!flying) p->ysp += gravity(p);
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
  end_attack(p, 1);   // as a hit, Tails' propeller goes on
  p->airLock = 0;
  p->onObject = NULL;
  p->state = PS_HURT;
  uncurl(p);   // the feet stay put
  // on a grind rail he leaves it for the layer he came from, unless that has less than 4 px of room above him
  if (p->grinding) {
    p->layer ^= 1;
    if (sensors_clearance(p, p->rotation + 0x80) < ROOM_TO_JUMP) p->layer ^= 1;
    else { p->grinding = 0; p->front = 0; }
  }
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
// none while Knuckles floats on the water
static void surface_splash(Player *p) {
  if (p->surfaceT >= 1 || (is_knuckles(p) && p->midAir == KN_FLOAT)) return;
  p->surfaceT = SURFACE_EFFECT_DELAY;
  water_splash((int)__builtin_floor(p->x));
  play_song(SE_WATERFALL_SURFACE_HIT);
}

// Player_HandleWater (sub_8023878), before he moves: going in halves his X speed and quarters his Y speed, coming out
// doubles his Y speed. Under water a second goes every 60 frames: at 12, 10, 8, 6, 4 and 2 a number counts down over him, at
// 11 the drowning music starts and below 0 he drowns; every 16th frame of the clock he breathes out a bubble, one time in
// four. Out of the water the count starts over and the drowning music stops.
void player_water_step(Player *p) {
  int level = water_level();
  p->waterCrossed = 0;
  if (level >= 0 && (int)__builtin_floor(p->y) - WATER_BELOW >= level) {
    if (!p->water) {
      p->water = 1; p->waterCrossed = 1;
      p->xsp = (q8(p->xsp) >> 1) / 256.0;
      p->ysp = (q8(p->ysp) >> 2) / 256.0;
      surface_splash(p);
    }
    if (--p->drownFrames < 1) {
      int second = p->drownSeconds--;
      // the drowning music is Sonic's; the CPU partner's countdown is over him
      if (second == DROWNING_MUSIC_AT) { if (!p->cpu) water_drowning_music(); }
      else if (countdown_number(second) >= 0) water_countdown(p, countdown_number(second));
      if (p->drownSeconds < 0) {
        p->dead = 1; p->ysp = 0;
        water_bubble((int)__builtin_floor(p->x * 256), (int)__builtin_floor(p->y * 256) - DROWNED_BUBBLE_ABOVE * 256, 0, 1);
        water_drowned_bubbles(p);
      }
      p->drownFrames = DROWN_SECOND;
    }
    if (act_stage_time() % BREATH_EVERY == 0 && !(act_random() & 0x300)) {
      int ahead = p->facing < 0 ? -BREATH_AHEAD : BREATH_AHEAD;
      water_bubble((int)__builtin_floor(p->x * 256) + ahead * 256, (int)__builtin_floor(p->y * 256) - BREATH_ABOVE * 256, 0, 0);
    }
  } else {
    if (p->water) {
      p->water = 0; p->waterCrossed = 1;
      p->ysp = (s16(q8(p->ysp) << 1)) / 256.0;
      surface_splash(p);
    }
    drown_count_reset(p);
    if (level >= 0 && !p->cpu) water_drowning_music_stop();
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
    .left = in->left, .right = in->right,
    .up = in->up && !sideways, .down = in->down && !sideways,
    .jump = in->jump, .jumpPressed = in->jumpPressed, .attackPressed = in->attackPressed,
  };
  p->jumpPressed = c.jumpPressed; p->attackPressed = c.attackPressed;
  p->lookEase = LOOK_EASE_NONE;

  if (p->dead) { dead_step(p); return; }
  player_water_step(p);
  if (p->override || p->carried) return;   // an object moves him, and his own code doesn't run
  if (p->air) air_step(p, &c);
  else ground_step(p, &c);
}

// --- animation ------------------------------------------------------------------------------------------------------------------
// the animation and variant each name shows (SONIC_ANIMATIONS in rom/extract.js); bouncing shows the walk cycle
static const uint16_t ANIMATIONS[PA_COUNT][2] = {
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
  [PS_BREATHE] = {17, 0}, [PS_FLOAT] = {42, 0},
  [PS_GRIND] = {44, 0}, [PS_GRIND_STEEP] = {44, 1}, [PS_RAIL_JUMP] = {45, 0},
  [PS_HANG] = {41, 0}, [PS_HANG_MOVE] = {41, 1},
  [PS_REACT] = {24, 0},
  [PS_GRABBED] = {98, 0},
  [PS_MOON_GAZE] = {397, 0}, [PS_MOON_TRANSFORM] = {398, 0}, [PS_MOON_FLY] = {399, 0},
};

// Tails' own (TAILS_ANIMATIONS in rom/extract.js); his others are Sonic's moved by his first animation
// (characterAnimations), where Sonic's own moves have none
static const uint16_t TAILS_ANIMATIONS[PA_COUNT][2] = {
  [PS_FLY] = {155, 0}, [PS_FLY_TURN] = {156, 0}, [PS_FLY_TIRED] = {157, 0}, [PS_FLY_LAND] = {158, 0},
  [PS_SWIM] = {145, 0}, [PS_SWIM_TURN] = {146, 0}, [PS_TAIL_SWIPE] = {149, 0},
};
// Knuckles' own (KNUCKLES_ANIMATIONS)
static const uint16_t KNUCKLES_ANIMATIONS[PA_COUNT][2] = {
  [PS_GLIDE] = {260, 0}, [PS_GLIDE_TURN0] = {261, 0}, [PS_GLIDE_TURN1] = {261, 1}, [PS_GLIDE_TURN2] = {261, 2},
  [PS_GLIDE_TURN3] = {261, 3}, [PS_SWIM] = {245, 0}, [PS_GLIDE_DROP] = {263, 0}, [PS_DROP_LAND] = {263, 1},
  [PS_GLIDE_SLIDE] = {262, 0}, [PS_WALL_GRAB] = {264, 0}, [PS_CLIMB] = {265, 2}, [PS_CLIMB_UP] = {265, 0},
  [PS_CLIMB_DOWN] = {265, 1}, [PS_LEDGE_CLIMB] = {265, 3}, [PS_LEDGE_TOP] = {265, 4}, [PS_PUNCH1] = {249, 0},
  [PS_PUNCH2] = {249, 1}, [PS_PUNCH3] = {250, 0}, [PS_UPPERCUT] = {250, 1}, [PS_WATER_FLOAT] = {269, 0},
  [PS_WATER_FLOAT_UP] = {271, 0},
};
// Amy's own (AMY_ANIMATIONS)
static const uint16_t AMY_ANIMATIONS[PA_COUNT][2] = {
  [PS_HAMMER_RISE] = {308, 0}, [PS_HAMMER_LEAP] = {373, 0}, [PS_HAMMER] = {348, 0}, [PS_HAMMER2] = {353, 0},
  [PS_HAMMER_AIR] = {376, 0}, [PS_HAMMER_SWIRL] = {377, 0}, [PS_DIVE] = {374, 0}, [PS_DIVE_SLAM] = {375, 0},
  [PS_DIVE_END] = {375, 1},
};
static void animation_of(const Player *p, int name, uint16_t *anim, uint8_t *variant) {
  const uint16_t (*own)[2] = p->character == CHARACTER_TAILS ? TAILS_ANIMATIONS : is_knuckles(p) ? KNUCKLES_ANIMATIONS
    : is_amy(p) ? AMY_ANIMATIONS : NULL;
  if (own && own[name][0]) {
    *anim = own[name][0]; *variant = (uint8_t)own[name][1];
    return;
  }
  *anim = (uint16_t)(ANIMATIONS[name][0] + rom_u16(CHARACTER_ANIMS + (uint32_t)p->character * 2));
  *variant = (uint8_t)ANIMATIONS[name][1];
}

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
    case PS_GRIND:
      if (!((p->rotation + 0x20) & 0xC0)) return PS_GRIND;
      p->facing = 1;
      return PS_GRIND_STEEP;
    case PS_HALF_PIPE_LOW: case PS_HALF_PIPE_MID: case PS_HALF_PIPE_HIGH:
      p->sprite.animSpeed = (uint8_t)walk_cycle_speed(speed);
      return p->state;
    case PS_HAMMER_RISE:
      if (p->ysp >= -SPRING_PEAK_SPEED) p->state = PS_SPRING_PEAK;
      return PS_HAMMER_RISE;
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
    // Amy's swings: another queued goes on to the second, 3 faster with its hearts, and otherwise she walks on or stands;
    // the end of a dive's slide takes her chain too
    case PS_HAMMER:
      if (p->attackNext != 0) {
        p->attackNext = 0; p->attack++; p->state = PS_HAMMER2;
        p->gsp += SWING2_SPEED * p->facing;
        act_amy_hearts(p);
      } else { p->attack = 0; p->state = p->gsp != 0 ? PS_WALK : PS_IDLE; }
      break;
    case PS_HAMMER2: p->attack = 0; p->state = p->gsp != 0 ? PS_WALK : PS_IDLE; break;
    case PS_DIVE_END: p->attack = 0; p->attackNext = 0; p->state = PS_IDLE; p->chain = 0; break;
    case PS_FLY_TURN: p->state = PS_FLY; break;
    case PS_SWIM_TURN: p->state = PS_SWIM; break;
    case PS_TAIL_SWIPE:
      p->attack = 0; p->attackNext = 0; p->chain = 0;
      p->state = p->gsp != 0 ? PS_WALK : PS_IDLE;
      break;
    case PS_SPRING: case PS_SPRING_PEAK: p->state = PS_SPRING_FALL; break;
    // Knuckles' punches: another queued goes on to the next, 3 faster with its sound, and otherwise he stands
    case PS_PUNCH1: case PS_PUNCH2:
      if (p->attackNext != 0) {
        p->attack++; p->attackNext = 0;
        play_song(p->state == PS_PUNCH2 ? SE_PUNCH_3 : SE_PUNCH_2);
        p->state = p->state == PS_PUNCH1 ? PS_PUNCH2 : PS_PUNCH3;
        p->gsp += PUNCH_SPEED * p->facing;
      } else { p->attack = 0; p->attackNext = 0; p->state = PS_IDLE; p->chain = 0; p->gsp = 0; }
      break;
    // up onto the ledge: 9 px onto it and stood up, 14 px up (down the act under flipped gravity, by his new height)
    case PS_LEDGE_CLIMB:
      p->x += LEDGE_STEP * p->facing;
      p->offsetY = SPRITE_OFFSET_Y;
      p->y += p->inverted ? p->offsetY : -SPRITE_OFFSET_Y;
      p->state = PS_LEDGE_TOP; p->attack++;
      break;
    case PS_LEDGE_TOP: p->rotation = 0; player_land(p); break;
    case PS_DROP_LAND: player_land(p); break;
    case PS_WALL_GRAB: p->state = PS_CLIMB; break;
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
  uint16_t anim; uint8_t variant;
  animation_of(p, name, &anim, &variant);
  if (anim != s->graphics.anim || variant != s->variant) {
    s->hitboxes[0].index = s->hitboxes[1].index = -1;
    s->hitboxes[0].left = s->hitboxes[0].top = s->hitboxes[0].right = s->hitboxes[0].bottom = 0;
    s->hitboxes[1].left = s->hitboxes[1].top = s->hitboxes[1].right = s->hitboxes[1].bottom = 0;
  }
  s->graphics.anim = anim; s->variant = variant;
  if (restart) s->prevVariant = 0xFF;
  p->animName = name;
}

// walking, bouncing and in a marble track he is drawn through the rotation hardware
static int drawn_rotated(const Player *p) { return p->state == PS_WALK || p->state == PS_BOUNCE || p->state == PS_MARBLE_TRACK; }

void player_animate(Player *p, const PlayerInput *in) {
  Sprite *s = &p->sprite;
  if (p->death == PLAYER_GONE) return;
  choose(p, pick(p, in), p->animRestart);
  p->animRestart = 0;
  if (p->state == PS_BRAKE && act_stage_time() % 4 == 0) act_brake_dust_of(p);
  for (int guard = 0; guard < 4; guard++) {
    // a hitbox a frame sets is turned with him, as the sprite system applies its flips when it sets one; the frames drawn
    // through the rotation hardware have their flips cleared first (sub_8024B10), so theirs are never turned
    s->frameFlags &= ~(SPRITE_X_FLIP | SPRITE_Y_FLIP);
    if (!drawn_rotated(p)) s->frameFlags |= (p->facing > 0 ? SPRITE_X_FLIP : 0) | (p->inverted ? SPRITE_Y_FLIP : 0);
    if (update_sprite(s, 0)) break;
    int before = p->state;
    after_animation(p);
    if (p->state == before) break;
    choose(p, pick(p, in), 0);
  }
  p->prio = (int)((s->frameFlags & SPRITE_PRIORITY) >> 12);
  p->prevState = p->state;
  p->hidden = !p->dead && (p->invisible || (p->invulnerable > 0 && (act_stage_time() & 2)));
  // dead, the timers count down only on the frame he dies: the tasks that take over from then on leave them
  if (p->dead && p->invulnerable == 1) return;
  if (p->state != PS_HURT && p->invulnerable > 0) p->invulnerable--;
  // the speed shoes and invincibility run out
  if (p->speedUp > 0 && --p->speedUp == 0) gba_sound_tempo(TEMPO_NORMAL);
  if (p->invincible > 0) p->invincible--;
}

// --- Tails' tails (sub_8024F74) ----------------------------------------------------------------------------------------------
// The way he moves is worked out each frame, straight ahead of him when he is still. Only while he is curled up (charState
// 5) are they shown, as a second sprite just behind him (OAM order 17) through the next rotation matrix of the frame, turned
// that way and mirrored as his rotated frames are, and only then does their animation run, at half speed under water. They
// blink with him. (In a marble track he shows them another way, Task_8047D04, which no act in C has yet.)
void player_tails_step(Player *p) {
  p->tailsShown = 0;
  if (p->character != CHARACTER_TAILS) return;
  int vx = s16(q8(p->xsp)), vy = s16(q8(p->ysp));
  p->tailsShift = vx != 0 || vy != 0 ? ((arc_tan2(vx, vy) >> 8) + 0x40) & 0xFF : p->facing < 0 ? 0xC0 : 0x40;
  if (p->state != PS_SPIN) return;
  p->tailsMatrix = boss_matrix();
  p->tails.animSpeed = p->water ? ANIM_NORMAL_SPEED >> 1 : ANIM_NORMAL_SPEED;
  update_sprite(&p->tails, 0);
  p->tailsShown = !p->hidden;
}

static void tails_draw(Player *p, int sx, int sy) {
  Sprite *s = &p->tails;
  int right = (p->facing > 0) != (p->inverted != 0), rotation = p->tailsShift << 2;
  Transform tf;
  tf.rotation = (uint16_t)(p->inverted ? (512 - rotation) & 1023 : rotation);
  tf.qScaleX = (int16_t)(right ? -p->scale : p->scale); tf.qScaleY = (int16_t)p->scale;
  tf.x = (int16_t)(sx - (right ? 1 : 0)); tf.y = (int16_t)sy;
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)p->tailsMatrix | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(s, &tf);
  display_sprite(s);
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
  int rotated = drawn_rotated(p);
  if (!rotated) p->drawRotation = 0;
  else if (p->state != PS_MARBLE_TRACK) p->drawRotation = p->rotation << 2;
  int sx = (int)__builtin_floor(p->x) - camX, sy = (int)__builtin_floor(p->y) - camY;
  int priority = p->death != PLAYER_ALIVE || p->front ? 1 : p->prio;
  s->frameFlags &= ~(SPRITE_PRIORITY | SPRITE_X_FLIP | SPRITE_Y_FLIP | SPRITE_ROT_SCALE | SPRITE_ROT_SCALE_ENABLE | SPRITE_DOUBLE_SIZE);
  // through the rotation matrix of his player number (AllocateCharacterStageGfx)
  s->frameFlags |= (uint32_t)priority << 12 | (p->cpu ? PARTNER_MATRIX : 0);
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
  if (p->tailsShown) tails_draw(p, sx, sy);
}
