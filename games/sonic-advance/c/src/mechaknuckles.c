// Angel Island Zone's boss, Mecha Knuckles (enemy kind 26): the wall that closes Sonic into a screen-wide arena, the fight,
// its rocket, the pieces it falls apart into, and Eggman's way off in the Egg Mobile that opens the arena and makes the
// capsule. Translated from the JavaScript version's engine/mechaknuckles.js and the original's boss_5_mecha_knuckles.c,
// state for state, on the boss helpers in bosses.c.
//
// Its position is kept in 1/256 px from its spawn point (qx, qy), its speeds and accelerations as the original's s16
// values. Each state comes from the table below (sBoss5ProcData): what it does each frame, what it does as it starts, its
// speeds and timer, how it faces and moves (flags), its half width and height, and its animation in each phase. A state's
// frame function returns 0 to go to `next`, which `enter` then starts.
//
// The original's quirks are kept: the sixth of its parts, a second leg, is never made (an original-game bug, #56); Sonic's
// body on its box 1 hurts him, but even when he can't be hurt that frame it can't be hit back.

#include "bosses.h"

enum {
  ANIM_ACTIVATE = 631, ANIM_IDLE = 632, ANIM_HIT = 634, ANIM_GROUND = 635, ANIM_SPIN = 636,
  ANIM_SPINDASH = 637, ANIM_GLIDE = 638, ANIM_LAND = 640, ANIM_COVER = 642, ANIM_PUNCH = 643,
  ANIM_IDLE_B = 644, ANIM_HIT_B = 646, ANIM_SPIN_B = 648, ANIM_SPINDASH_B = 649, ANIM_GLIDE_B = 650,
  ANIM_LAND_B = 652, ANIM_COVER_B = 654, ANIM_LAUNCH = 655, ANIM_ROCKET = 656, ANIM_DEFEATED = 657,
  ANIM_PARTS = 658, ANIM_EGG_MOBILE = 693, ANIM_EGGMAN = 694,
  BODY_ORDER = 20, EGGMAN_ORDER = 20, ROCKET_ORDER = 21, PART_ORDER = 19, BLAST_ORDER = 19,
  BODY_TILES = 64, EGGMAN_TILES = 30,
  EGGMAN_SEATED = 3, EGGMAN_TURN = 6, EGGMAN_LAUGH = 9,
  EGG_MOBILE_STILL = 0, EGG_MOBILE_END = 1,
  AIRBORNE = 0x10, SHOWN = 0x20, EGGMAN = 0x40,
  FACE_SIDE = 0x100, FACE_SONIC = 0x200, KEEP_FACING = 0x400,
  AWAY_SIDE = 0x800, AWAY_SONIC = 0x1000, KEEP_SPEEDS = 0x2000,
  STOP_X = 0x4000, STOP_Y = 0x8000,
  NO_TERRAIN = 0x02000000, NO_EDGES = 0x04000000,
  FLASH = 0x20,
  OBJ_WINDOW = 0x100,                       // SPRITE_OBJ_MODE 2: the sprite is drawn into the OBJ window
  MUSIC_INTRO = 0x11, MUSIC_FIGHT = 0x12, MUSIC_AFTER = 0x32,
  SCORE = 1000,
  SE_EXPLOSION = 144, SE_ROCKET = 200, SE_SPIN = 109, SE_SPIN_DASH_RELEASE = 110, SE_JUMP = 116,
  ROCKET_TURN = 3, ROCKET_AGE = 0x18, ROCKET_SPEED_UP = 16,
  PART_GRAVITY_BASE = 42, PART_SPIN_SLOW = 8,
};

enum {
  ACTIVATE, WAIT, WAITED, ACTIVATE_2, IDLE, IDLE_2, SPIN, GLIDE, LAND, LAND_2, COVER, SPINDASH,
  SPIN_2, PUNCH, PUNCH_2, LAUNCH_ROCKET, LAUNCH_ROCKET_2, HIT, HIT_2, DEFEATED, DEFEATED_2, DEFEATED_3,
  EGGMOBILE, EGGMOBILE_2, EGGMOBILE_3,
};

typedef struct MechaKnuckles MechaKnuckles;
typedef int (*StateFn)(MechaKnuckles *);
typedef void (*EnterFn)(MechaKnuckles *);
typedef struct {
  StateFn fn;
  EnterFn enter;
  int vx, vy, ax, ay, timer, flags, w, h;
  int anim[2], variant[2];
} State;

struct MechaKnuckles {
  Object o;                 // its body
  Sprite s2;                // Eggman
  int spawnX, spawnY;
  int qx, qy, vx, vy, ax, ay;
  uint16_t timer;
  uint32_t flags;
  int phase, lives, half, blink, w, h;
  int state, next, ended, hidden;
};

static int Q(int v) { return v * 256; }
static int I(int v) { return v >> 8; }
static MechaKnuckles *current;
static int choose(MechaKnuckles *b);
static void part_new(MechaKnuckles *b, int variant);

// --- the states' frame and start functions ---------------------------------------------------------------------------
static void go(MechaKnuckles *b, int state) { b->next = state; }
static int timer(MechaKnuckles *b) {
  int t = s16(b->timer);
  b->timer = (uint16_t)((b->timer - 1) & 0xFFFF);
  return t <= 0;
}
static int over(const Sprite *s) { return (s->frameFlags & SPRITE_ANIM_OVER) != 0; }
static int sonic_x(void) { return (int)__builtin_floor(act.player.x); }
static int sonic_y(void) { return (int)__builtin_floor(act.player.y); }

// the top and bottom of the arena close in a pixel a frame on the screen above the spawn point
static void close_in(MechaKnuckles *b) {
  Camera *c = &act.cam;
  if (c->maxY + DISPLAY_HEIGHT > b->spawnY) c->maxY--;
  else if (c->maxY + DISPLAY_HEIGHT < b->spawnY) c->maxY++;
  if (c->minY > b->spawnY - DISPLAY_HEIGHT) c->minY--;
  else if (c->minY < b->spawnY - DISPLAY_HEIGHT) c->minY++;
}
// the left edge moves a pixel a frame toward the act's right end, and never shows more than the camera does
static void opening(void) {
  Camera *c = &act.cam;
  if (c->minX < c->maxX) c->minX++;
  if (c->minX < (int)c->x) c->minX = (int)c->x;
}
// what the player reads once his controls change hands: no fresh press of jump or attack
static void clear_presses(void) { act.player.jumpPressed = 0; act.player.attackPressed = 0; e.pressed &= (uint16_t)~(KEY_A | KEY_B); }

static int activate_fn(MechaKnuckles *b) {
  close_in(b);
  if (sonic_x() >= b->spawnX + 32) { go(b, WAIT); return 0; }
  return 1;
}
static void activate_enter(MechaKnuckles *b) {
  Camera *c = &act.cam;
  c->maxX = b->spawnX; c->minY = (int)c->y; c->maxY = (int)c->y;
  b->flags |= SHOWN;
}
static int wait_fn(MechaKnuckles *b) {
  Camera *c = &act.cam;
  if (c->minX < b->spawnX) c->minX++;
  close_in(b);
  if (b->spawnX <= c->minX && b->spawnY >= c->maxY + DISPLAY_HEIGHT) { go(b, WAITED); return 0; }
  return 1;
}
static void wait_enter(MechaKnuckles *b) {
  Player *p = &act.player;
  act.cam.minX = (int)act.cam.x;
  p->gsp = p->xsp = p->ysp = 0;
  p->ignoreInput = 1; p->facing = 1;
  clear_presses();
}
static int waited_fn(MechaKnuckles *b) { go(b, ACTIVATE_2); return 0; }
static int activate_2_fn(MechaKnuckles *b) { if (over(&b->o.sprite)) { go(b, IDLE); return 0; } return 1; }
static int idle_fn(MechaKnuckles *b) {
  Player *p = &act.player;
  if (!over(&p->sprite)) return 1;
  p->ignoreInput = 0; p->scripted = 0; p->state = PS_IDLE;
  // the boss hands him jump and attack as already held (heldInput |= jump | attack), so what's held now is no press
  p->wasIgnoreInput = 0; p->heldDirs = 0;
  clear_presses();
  go(b, IDLE_2);
  return 0;
}
static void idle_enter(MechaKnuckles *b) {
  Player *p = &act.player;
  p->state = PS_REACT; p->scripted = 1;
  boss_music(MUSIC_INTRO);
  (void)b;
}
static int idle_2_fn(MechaKnuckles *b) {
  if (timer(b)) {
    int next = choose(b);
    go(b, next);
    return 0;
  }
  return 1;
}
static int spin_fn(MechaKnuckles *b) { if (b->vy >= 0) { go(b, GLIDE); return 0; } return 1; }
static int glide_fn(MechaKnuckles *b) {
  b->vy = s16(b->vy < 0x80 ? b->vy + 0x18 : b->vy - 0x18);
  int dx = sonic_x() - (b->spawnX + I(b->qx));
  if ((b->flags & (4 | 8)) || (b->vx < 0 && dx > 32) || (b->vx > 0 && dx < -32)) { go(b, LAND); return 0; }
  return 1;
}
static int land_fn(MechaKnuckles *b) { if (b->flags & 1) { go(b, LAND_2); return 0; } return 1; }
static int land_2_fn(MechaKnuckles *b) { if (over(&b->o.sprite)) { go(b, choose(b)); return 0; } return 1; }
static int cover_fn(MechaKnuckles *b) { if (over(&b->o.sprite)) { go(b, choose(b)); return 0; } return 1; }
static int spindash_fn(MechaKnuckles *b) { if (timer(b)) { go(b, SPIN_2); return 0; } return 1; }
static int spin_2_fn(MechaKnuckles *b) { if (b->flags & (4 | 8)) { go(b, IDLE_2); return 0; } return 1; }
static int punch_fn(MechaKnuckles *b) { if (over(&b->o.sprite)) { go(b, PUNCH_2); return 0; } return 1; }
static int punch_2_fn(MechaKnuckles *b) { if (over(&b->o.sprite)) { go(b, choose(b)); return 0; } return 1; }

static void rocket_new(MechaKnuckles *b);
static int launch_rocket_fn(MechaKnuckles *b) {
  if (over(&b->o.sprite)) { go(b, LAUNCH_ROCKET_2); return 0; } return 1;
}
static void launch_rocket_enter(MechaKnuckles *b) {
  rocket_new(b);
  play_song(SE_ROCKET);
  boss_shake(0x200, 0x10, 0x100, -1, SHAKE_VERTICAL);
  boss_shake(0x400, 0x10, 0x80, -1, SHAKE_HORIZONTAL);
}
static int launch_rocket_2_fn(MechaKnuckles *b) { if (over(&b->o.sprite)) { go(b, choose(b)); return 0; } return 1; }

static int debris(MechaKnuckles *b) {
  if (act_stage_time() & 7) return 0;
  uint32_t r = act_random();
  int ox = (int)((r & 0x1FFF00) >> 8) - 4096;
  int oy = (int)((act_random() & 0x1FFF00) >> 8) - 4096;
  boss_explosion_at(b->qx + Q(b->spawnX) + ox, b->qy + Q(b->spawnY) + oy, BLAST_ORDER);
  return 1;
}
static int hit_fn(MechaKnuckles *b) {
  if (b->lives == b->half) debris(b);
  if (b->flags & 1) { go(b, HIT_2); return 0; }
  return 1;
}
static void hit_enter(MechaKnuckles *b) {
  // the hit that leaves it at half its lives flies at half the gravity
  if (b->lives == b->half) { b->ax >>= 1; b->ay >>= 1; }
}
static int hit_2_fn(MechaKnuckles *b) {
  if (b->lives == b->half) debris(b);
  if (over(&b->o.sprite)) { go(b, choose(b)); return 0; }
  return 1;
}
static void hit_2_enter(MechaKnuckles *b) {
  if (b->lives == b->half) { b->phase = 1; boss_music(MUSIC_FIGHT); }
}
// sub_804F7B4, sub_804F7D0, sub_804F7DC: the jump, the spin dash and its release have Sonic's sounds
static void spin_enter(MechaKnuckles *b) { (void)b; play_song(SE_JUMP); }
static void spindash_enter(MechaKnuckles *b) { (void)b; play_song(SE_SPIN); }
static void spin_2_enter(MechaKnuckles *b) { (void)b; play_song(SE_SPIN_DASH_RELEASE); }
static void defeated_enter(MechaKnuckles *b) { (void)b; world_add_score(SCORE); }   // sub_804F888
static int defeated_fn(MechaKnuckles *b) {
  debris(b);
  if (b->flags & 4) b->vx = -b->vx;
  if (b->flags & 8) b->vx = -b->vx;
  if (b->flags & 1) { go(b, DEFEATED_2); return 0; }
  return 1;
}
static int defeated_2_fn(MechaKnuckles *b) { debris(b); if (timer(b)) { go(b, DEFEATED_3); return 0; } return 1; }
static int defeated_3_fn(MechaKnuckles *b) {
  if (!debris(b)) return 1;
  for (int v = 0; v < 5; v++) part_new(b, v);   // the sixth, a second leg, is never made (the original's bug)
  go(b, EGGMOBILE);
  return 0;
}
static int eggmobile_fn(MechaKnuckles *b) {
  Camera *c = &act.cam;
  opening();
  if (b->spawnX + I(b->qx) + 32 <= (int)c->x + DISPLAY_WIDTH && c->minX >= c->maxX) { go(b, EGGMOBILE_2); return 0; }
  return 1;
}
static void eggmobile_enter(MechaKnuckles *b) {
  b->qx = Q(272); b->qy = -Q(100);
  act.cam.maxX = act.stage.width - DISPLAY_WIDTH;
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  b->s2.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  b->s2.graphics.anim = (uint16_t)ANIM_EGGMAN;
  sprite_start(&b->s2, EGGMAN_SEATED);
  b->flags |= EGGMAN;
}
static int eggmobile_2_fn(MechaKnuckles *b) {
  opening();
  if (!over(&b->o.sprite)) return 1;
  boss_capsule(b->spawnX + I(b->qx), b->spawnY + I(b->qy));
  boss_music(MUSIC_AFTER);
  go(b, EGGMOBILE_3);
  return 0;
}
static void eggmobile_2_enter(MechaKnuckles *b) {
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
  b->s2.graphics.anim = (uint16_t)ANIM_EGGMAN;
  sprite_start(&b->s2, EGGMAN_LAUGH);
}
static int eggmobile_3_fn(MechaKnuckles *b) {
  Camera *c = &act.cam;
  opening();
  if (b->spawnX + I(b->qx) >= c->maxX + DISPLAY_WIDTH + 32) { b->flags &= ~(uint32_t)(SHOWN | EGGMAN); b->ended = 1; }
  return 1;
}
static void eggmobile_3_enter(MechaKnuckles *b) {
  b->o.sprite.frameFlags |= SPRITE_X_FLIP;
  b->s2.graphics.anim = (uint16_t)ANIM_EGGMAN;
  sprite_start(&b->s2, EGGMAN_TURN);
}

// sub_804ED80: the next attack, by how far Sonic is and the game's random numbers
static int choose(MechaKnuckles *b) {
  int dx = sonic_x() - (b->spawnX + I(b->qx));
  if (dx < 0) dx = -dx;
  int r = (int)act_random();
  Player *p = &act.player;
  if (b->phase == 0) {
    if (dx < 80) {
      if (dx < 32) return p->air ? SPIN : PUNCH;
      if (r & 0x1000) return IDLE_2;
    }
    return r & 0x100 ? SPINDASH : SPIN;
  }
  if (dx >= 80 && (r & 0x3000)) return LAUNCH_ROCKET;
  if (dx < 80 && p->air) return SPIN;
  return r & 0x100 ? SPINDASH : SPIN;
}


static const State STATES[] = {
  [ACTIVATE] = { activate_fn, activate_enter, 0, 0, 0, 0, 0, 0, 6, 14, { ANIM_ACTIVATE, -1 }, { 0, 0 } },
  [WAIT] = { wait_fn, wait_enter, 0, 0, 0, 0, 0, 0, 6, 14, { -1, -1 }, { 0, 0 } },
  [WAITED] = { waited_fn, NULL, 0, 0, 0, 0, 0, 0, 6, 14, { -1, -1 }, { 0, 0 } },
  [ACTIVATE_2] = { activate_2_fn, NULL, 0, 0, 0, 0, 0, 0, 6, 14, { ANIM_ACTIVATE, -1 }, { 1, 0 } },
  [IDLE] = { idle_fn, idle_enter, 0, 0, 0, 0, 0, 0, 6, 14, { ANIM_IDLE, -1 }, { 0, 0 } },
  [IDLE_2] = { idle_2_fn, NULL, 0, 0, 0, 0, 0x5A, FACE_SONIC, 6, 14, { ANIM_IDLE, ANIM_IDLE_B }, { 0, 0 } },
  [SPIN] = { spin_fn, spin_enter, 0, 0xFB20, 0, 42, 0, FACE_SONIC | AIRBORNE, 6, 9, { ANIM_SPIN, ANIM_SPIN_B }, { 0, 0 } },
  [GLIDE] = { glide_fn, NULL, 0x300, 0x180, 3, 0, 0, AWAY_SONIC | FACE_SONIC | AIRBORNE, 6, 6, { ANIM_GLIDE, ANIM_GLIDE_B }, { 0, 0 } },
  [LAND] = { land_fn, NULL, 0, 0, 0, 42, 0, AIRBORNE, 6, 14, { ANIM_LAND, ANIM_LAND_B }, { 0, 0 } },
  [LAND_2] = { land_2_fn, NULL, 0, 0, 0, 0, 0, 0, 6, 14, { ANIM_LAND, ANIM_LAND_B }, { 1, 1 } },
  [COVER] = { cover_fn, NULL, 0, 0, 0, 0, 0, AWAY_SONIC | FACE_SONIC, 6, 14, { ANIM_COVER, ANIM_COVER_B }, { 0, 0 } },
  [SPINDASH] = { spindash_fn, spindash_enter, 0, 0, 0, 0, 0x3C, AWAY_SIDE | FACE_SIDE, 6, 9, { ANIM_SPINDASH, ANIM_SPINDASH_B }, { 0, 0 } },
  [SPIN_2] = { spin_2_fn, spin_2_enter, 0x480, 0, 0, 0, 0, KEEP_SPEEDS | KEEP_FACING, 6, 9, { ANIM_SPIN, ANIM_SPIN_B }, { 0, 0 } },
  [PUNCH] = { punch_fn, NULL, 0, 0, 0, 0, 0, FACE_SONIC, 6, 14, { ANIM_PUNCH, ANIM_PUNCH }, { 0, 0 } },
  [PUNCH_2] = { punch_2_fn, NULL, 0, 0, 0, 0, 0, FACE_SONIC, 6, 14, { ANIM_PUNCH, ANIM_PUNCH }, { 1, 1 } },
  [LAUNCH_ROCKET] = { launch_rocket_fn, NULL, 0, 0, 0, 0, 0, AWAY_SONIC | FACE_SONIC, 6, 14, { ANIM_LAUNCH, ANIM_LAUNCH }, { 0, 0 } },
  [LAUNCH_ROCKET_2] = { launch_rocket_2_fn, launch_rocket_enter, 0xFB80, 0, 96, 0, 0, STOP_X | KEEP_SPEEDS | KEEP_FACING, 6, 14, { ANIM_LAUNCH, ANIM_LAUNCH }, { 1, 1 } },
  [HIT] = { hit_fn, hit_enter, 0xFE80, 0xFD00, 0, 42, 0, AWAY_SONIC | FACE_SONIC | AIRBORNE, 6, 9, { ANIM_HIT, ANIM_HIT_B }, { 0, 0 } },
  [HIT_2] = { hit_2_fn, hit_2_enter, 0, 0, 0, 0, 0, 0, 6, 9, { ANIM_GROUND, ANIM_HIT_B }, { 0, 0 } },
  [DEFEATED] = { defeated_fn, defeated_enter, 0xFE80, 0xFD00, 0, 21, 0, AWAY_SONIC | FACE_SONIC | AIRBORNE, 6, 9, { ANIM_DEFEATED, ANIM_DEFEATED }, { 0, 0 } },
  [DEFEATED_2] = { defeated_2_fn, NULL, 0, 0, 0, 0, 0x78, 0, 6, 9, { ANIM_DEFEATED, ANIM_DEFEATED }, { 1, 1 } },
  [DEFEATED_3] = { defeated_3_fn, NULL, 0, 0, 0, 0, 0x78, 0, 6, 14, { ANIM_DEFEATED, ANIM_DEFEATED }, { 1, 1 } },
  [EGGMOBILE] = { eggmobile_fn, eggmobile_enter, 0, 0, 0, 0, 0, NO_TERRAIN | NO_EDGES, 0, 0, { ANIM_EGG_MOBILE, ANIM_EGG_MOBILE }, { 0, 0 } },
  [EGGMOBILE_2] = { eggmobile_2_fn, eggmobile_2_enter, 0, 0, 0, 0, 0, NO_TERRAIN | NO_EDGES, 0, 0, { ANIM_EGG_MOBILE, ANIM_EGG_MOBILE }, { 1, 1 } },
  [EGGMOBILE_3] = { eggmobile_3_fn, eggmobile_3_enter, 0x400, 0, 0, 0, 0, NO_TERRAIN | NO_EDGES, 0, 0, { ANIM_EGG_MOBILE, ANIM_EGG_MOBILE }, { 0, 0 } },
};

// sub_804E8D4: a state starts. Its flags replace the old ones, but for the facing and speed modes a state that keeps them
// leaves as they were; its speeds point away from its side of the arena or from Sonic, and it turns to face that way.
static void enter(MechaKnuckles *b, int state) {
  const State *d = &STATES[state];
  int t = d->flags;
  int f = (int)b->flags;
  if (!(t & KEEP_FACING)) f = (f & ~0x700) | (t & 0x300);
  if (!(t & KEEP_SPEEDS)) f = (f & ~0x3800) | (t & 0x1800);
  f |= t & (KEEP_FACING | KEEP_SPEEDS);
  int copied = AIRBORNE | STOP_X | STOP_Y | NO_TERRAIN | NO_EDGES;
  f = (f & ~copied) | (t & copied);
  if (f & AIRBORNE) f &= ~1;
  b->flags = (uint32_t)f;
  b->timer = (uint16_t)d->timer;
  b->w = d->w;
  if (d->h != b->h) { b->qy -= Q(b->h - d->h); b->h = d->h; }
  int bx = b->spawnX + I(b->qx), px = sonic_x();
  int vx = s16(d->vx), ax = s16(d->ax);   // the table holds them as the original's s16 values
  int side = f & (AWAY_SIDE | AWAY_SONIC);
  if ((side == AWAY_SIDE && I(b->qx) > 0x77) || (side == AWAY_SONIC && bx >= px)) { vx = -vx; ax = -ax; }
  b->vx = s16(vx); b->vy = s16(d->vy); b->ax = s16(ax); b->ay = s16(d->ay);
  int facing = f & (FACE_SIDE | FACE_SONIC);
  if (facing == FACE_SIDE) {
    if (I(b->qx) > 0x77) b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
    else b->o.sprite.frameFlags |= SPRITE_X_FLIP;
  } else if (facing == FACE_SONIC) {
    if (bx >= px) b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_X_FLIP;
    else b->o.sprite.frameFlags |= SPRITE_X_FLIP;
  }
  int anim = d->anim[b->phase], variant = d->variant[b->phase];
  if (anim >= 0 && (b->o.sprite.graphics.anim != anim || b->o.sprite.variant != variant)) {
    b->o.sprite.graphics.anim = (uint16_t)anim;
    sprite_start(&b->o.sprite, variant);
    b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;   // a new animation starts over
    b->o.sprite.hitboxes[0].index = -1;
    b->o.sprite.hitboxes[1].index = -1;
  }
  b->state = state;
  if (d->enter) d->enter(b);
  b->next = state;
}

// sub_804EB04: it moves, then its speeds change by their accelerations
static void move_boss(MechaKnuckles *b) {
  b->qx += b->vx; b->qy += b->vy;
  int vx = b->vx + b->ax;
  if ((b->flags & STOP_X) && ((b->vx < 0) != (vx < 0))) { vx = 0; b->ax = 0; }
  b->vx = s16(vx);
  int vy = b->vy + b->ay;
  if ((b->flags & STOP_Y) && ((b->vy < 0) != (vy < 0))) { vy = 0; b->ay = 0; }
  b->vy = s16(vy);
}
// sub_804FDD4: it stays inside the arena, the screen-wide strip from its spawn point, 6 px in from its sides
static void edges(MechaKnuckles *b) {
  b->flags &= ~(uint32_t)(4 | 8);
  int d = I(b->qx) - b->w - 6;
  if (d < 0) { b->qx -= Q(d); b->flags |= 4; }
  d = I(b->qx) + b->w - 234;
  if (d > 0) { b->qx -= Q(d); b->flags |= 8; }
}
// sub_804EB90: the back layer's floor under its feet catches it within 10 px, or once it is in it while it is airborne;
// rising, a ceiling above its head stops it going further
static void terrain(MechaKnuckles *b) {
  int x = b->spawnX + I(b->qx), y = b->spawnY + I(b->qy);
  b->flags &= ~(uint32_t)1;
  int d = terrain_scan(PROBE_FLOOR, y + b->h, x, LAYER_BACK, 8).d;
  if (b->flags & AIRBORNE ? d < 0 : d <= 10) { b->qy += d << 8; b->flags |= 1; }
  b->flags &= ~(uint32_t)2;
  if (b->vy < 0) {
    d = terrain_scan(PROBE_FLOOR, y - b->h, x, LAYER_BACK, -8).d;
    if (d < 0) { b->qy -= Q(d); b->flags |= 2; }
  }
}

// --- the rocket (CreateMechaKnucklesRocket) -----------------------------------------------------------------------------
typedef struct { Object o; Transform tf; int qx, qy, vx, vy, turn, age, heading, scaleX; } Rocket;

static int rocket_run(ActTask *t) {
  Rocket *r = (Rocket *)t->data;
  Sprite *s = &r->o.sprite;
  Player *p = &act.player;
  int a = r->heading & 0xFF;
  if (r->age > ROCKET_AGE) {
    int dy = (int)__builtin_floor(p->y * 256) - r->qy;
    int across = (int)__builtin_floor(p->x * 256) - r->qx;
    if (across < 0) across = -across;
    int num = (r->vy + sin8(a) * 8) * across;
    int den = (r->vx + cos8(a) * 8);
    if (den < 0) den = -den;
    int at = den == 0 ? 0 : num / den;
    if (at < dy - Q(8)) a += r->vx > 0 ? ROCKET_TURN : -ROCKET_TURN;
    else if (at > dy) a += r->vx > 0 ? -ROCKET_TURN : ROCKET_TURN;
    r->heading = a & 0xFF;
  }
  r->qx += r->vx; r->qy += r->vy;
  if (r->age > ROCKET_SPEED_UP) {
    r->vx = s16(r->vx + ((r->turn * cos8(a)) >> 8));
    r->vy = s16(r->vy + ((r->turn * sin8(a)) >> 8));
  }
  int x = I(r->qx), y = I(r->qy);
  int touched = 0;
  const Hitbox *box = object_box(s, 0), *body = object_box(&p->sprite, 0);
  if (box && !p->dead && body && collide_overlap(x, y, box, (int)__builtin_floor(p->x), (int)__builtin_floor(p->y), body)) {
    world_damage(p); touched = 1;
  }
  if (touched) {
    boss_explosion(r->qx + ((Q(21) * cos8(a)) >> 8), r->qy + ((Q(21) * sin8(a)) >> 8));
    return 0;
  }
  int sx = x - cam_x(), sy = y - cam_y();
  int back = (int)(act_random() & 0x3FF) - Q(26);
  act_brake_dust_at(I(r->qx + ((back * cos8(a)) >> 8)), I(r->qy + ((back * sin8(a)) >> 8)));
  if ((unsigned)(sx + 32) >= DISPLAY_WIDTH + 64u || (unsigned)(sy + 64) >= DISPLAY_HEIGHT + 128u) return 0;
  r->age++;
  int rotation = (((r->scaleX < 0 ? a + 0x80 : a) + 0x80) * 4) & 0x3FF;
  sprite_step(s);
  r->tf = (Transform){ (uint16_t)rotation, (int16_t)r->scaleX, 256, (int16_t)(x - cam_x()), (int16_t)(y - cam_y()) };
  s->frameFlags = (s->frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(s, &r->tf);
  if (objects_drawing()) display_sprite(s);
  return 1;
}
// its sound stops as its task ends, however it ends
static void rocket_end(ActTask *t) { object_sprite_free(&((Rocket *)t->data)->o.sprite); stop_song(SE_ROCKET); object_end(t); }

// the rocket off the arm the way it faces, at 0.25 px a frame, speeding up after 16 frames and turning toward Sonic
static void rocket_new(MechaKnuckles *b) {
  Rocket *r = OBJECT_NEW(Rocket);
  if (!r) return;
  int flipped = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  object_sprite_at(&r->o.sprite, vram_malloc((uint32_t)sprite_tiles(ANIM_ROCKET, 0, 0)), ANIM_ROCKET, 0,
                   ROCKET_ORDER, ENEMY_PRIORITY, 0, 0);
  r->qx = Q(b->spawnX) + b->qx;
  r->qy = Q(b->spawnY) + b->qy - Q(6);
  r->vx = flipped ? 0x40 : -0x40;
  r->turn = act_random() & 0x1000 ? 0x20 : 0x40;
  r->heading = flipped ? 0 : 0x80;
  r->scaleX = flipped ? -256 : 256;
  ActTask *t = object_task(&r->o, rocket_run, PRIORITY_OBJECTS + 1);   // 0x2001, just after the boss
  if (t) t->end = rocket_end;
}

// --- the pieces it falls apart into (CreateMechaKnucklesParts) ------------------------------------------------------------
typedef struct { Object o; Transform tf; int qx, qy, vx, vy, ay, rot, spin; } MkPart;

static int part_run(ActTask *t) {
  MkPart *p = (MkPart *)t->data;
  p->qx += p->vx; p->qy += p->vy;
  p->vy = s16(p->vy + p->ay);
  p->rot = s16(p->rot + p->spin);
  if (p->spin > 0) { int s = p->spin - PART_SPIN_SLOW; p->spin = s > 0 ? s : 0; }
  else if (p->spin < 0) { int s = p->spin + PART_SPIN_SLOW; p->spin = s < 0 ? s : 0; }
  int sx = I(p->qx) - cam_x(), sy = I(p->qy) - cam_y();
  if ((unsigned)(sx + 32) > 0x12F || sy > 0xDF) return 0;
  sprite_step(&p->o.sprite);
  p->tf = (Transform){ (uint16_t)((p->rot & 0xFFFF) >> 6), 256, 256, (int16_t)(I(p->qx) - cam_x()), (int16_t)(I(p->qy) - cam_y()) };
  p->o.sprite.frameFlags = (p->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(&p->o.sprite, &p->tf);
  if (objects_drawing()) display_sprite(&p->o.sprite);
  return 1;
}
static void part_end(ActTask *t) { object_sprite_free(&((MkPart *)t->data)->o.sprite); object_end(t); }

static void part_new(MechaKnuckles *b, int variant) {
  MkPart *p = OBJECT_NEW(MkPart);
  if (!p) return;
  // each value takes a random number of its own, in this order
  p->qx = Q(b->spawnX) + b->qx; p->qy = Q(b->spawnY) + b->qy;
  p->vx = s16((int)((act_random() << 13) >> 21) - Q(4));
  p->vy = s16(-(int)((act_random() << 15) >> 23) - Q(2));
  p->ay = s16(PART_GRAVITY_BASE - (int)((act_random() & 0x1F00) >> 8));
  p->rot = s16(act_random() >> 8);
  p->spin = ((act_random() << 12) >> 20) - Q(8);
  object_sprite_at(&p->o.sprite, vram_malloc((uint32_t)sprite_tiles(ANIM_PARTS, variant, variant)), ANIM_PARTS, variant,
                   PART_ORDER, ENEMY_PRIORITY, 0, 0);
  ActTask *t = object_task(&p->o, part_run, PRIORITY_ITEMS);   // 0x4001
  if (t) t->end = part_end;
}

// --- one frame ---------------------------------------------------------------------------------------------------------
static int boss_run(ActTask *t) {
  MechaKnuckles *b = (MechaKnuckles *)t->data;
  current = b;
  Player *p = &act.player;
  Sprite *s = &b->o.sprite;
  if (!p->dead) { s->frameFlags &= ~(uint32_t)SPRITE_OBJ_MODE; act.bossFlash = 0; }
  int going = STATES[b->state].fn(b);
  move_boss(b);
  if (!(b->flags & NO_EDGES)) edges(b);
  if (!(b->flags & NO_TERRAIN)) terrain(b);

  int bx = b->spawnX + I(b->qx), by = b->spawnY + I(b->qy), px = sonic_x(), py = sonic_y();
  const Hitbox *b0 = object_box(s, 0), *b1 = object_box(s, 1);
  const Hitbox *body = object_box(&p->sprite, 0), *attack = object_box(&p->sprite, 1);
  int hurt = 0;
  if (!p->dead && b1 && body && collide_overlap(bx, by, b1, px, py, body)) { world_damage(p); hurt = 1; }
  if (!hurt && b->blink <= 0) {
    if (b0 && attack && !p->dead && collide_overlap(bx, by, b0, px, py, attack)) {
      player_bounce_off_boss(p);
      if ((b->state == IDLE_2 || b->state == COVER) && !p->air) {
        if (b->state != COVER) {
          going = 0; b->next = COVER;
          p->xsp = -p->xsp; p->gsp = -p->gsp;
        }
      } else {
        going = 0;
        b->next = --b->lives <= 0 ? DEFEATED : HIT;
        b->blink = FLASH;
      }
    }
  }
  if (b->blink != 0) {
    if (!(act_stage_time() & 2) && !p->dead) { s->frameFlags |= OBJ_WINDOW; act.bossFlash = BOSS_FLASH_WINDOW; }
    if (b->next != HIT && b->next != HIT_2) b->blink--;
  }
  if (b->flags & SHOWN) {
    sprite_step(s);
    object_draw(s, bx, by);   // while it flashes, every other frame it is the window the flash shows through
  }
  if (b->flags & EGGMAN) {
    sprite_step(&b->s2);
    object_draw(&b->s2, bx, by);
  }
  if (!going) enter(b, b->next);
  return !b->ended;
}
static void boss_end(ActTask *t) {
  MechaKnuckles *b = (MechaKnuckles *)t->data;
  object_sprite_free(&b->s2);
  object_end(t);
}

/** CreateEntity_MechaKnuckles: enemy kind 26, 208 px right of its point and 32 above, with 8 lives, its second phase at 4
 *  (6 and 3 on Easy), and the rings it scatters bouncing off ceilings. */
ActTask *mecha_knuckles_spawn(Slot *slot) {
  slot->gone = 1;
  MechaKnuckles *b = OBJECT_NEW(MechaKnuckles);
  if (!b) return NULL;
  b->o.slot = slot;
  b->spawnX = slot->e.x; b->spawnY = slot->e.y;
  b->qx = Q(208); b->qy = -Q(32);
  b->phase = 0;
  int difficulty = difficulty_easy();
  b->lives = 8 - difficulty * 2;
  b->half = 4 - difficulty;
  b->state = b->next = ACTIVATE;
  b->h = 0; b->w = 0; b->blink = 0;
  object_sprite_at(&b->o.sprite, vram_malloc(BODY_TILES), ANIM_ACTIVATE, 0, BODY_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite_at(&b->s2, vram_malloc(EGGMAN_TILES), ANIM_EGGMAN, EGGMAN_SEATED, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  scatter_ceilings();
  ActTask *t = object_task(&b->o, boss_run, PRIORITY_OBJECTS);
  if (!t) { object_sprite_free(&b->s2); return NULL; }
  t->end = boss_end;
  enter(b, ACTIVATE);
  return t;
}
