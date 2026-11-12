// Secret Base's boss, the Egg Press (enemy kind 23): Eggman on a spring-loaded press at the end of act 2. Translated from the
// JavaScript version's engine/eggpress.js (the original's boss_2_egg_press.c).
//
// When its spawn point comes into range the camera closes in on the arena, 300 px wide and ending at the spawn point, and the
// boss music starts. 121 frames later the press drops in 60 px left of its spawn point, lands, and Eggman laughs. Then it hops
// at Sonic over and over: each hop takes 72 frames to reach where he stood, and after its fourth hit, every fourth jump is a
// leap off the top of the screen that follows Sonic and lands on him, shaking the screen and hurting him unless he is in the
// air. A jump into the top of the press hits it; it flashes white and can't be hit again for 32 frames; it moves faster with
// each hit. The eighth hit beats it: the spring and the base fly off, the press drops to the floor and bounces, and for about
// 4 seconds it throws debris and explosions every 8 frames. Then Eggman flies off in the Egg Mobile, the stage music comes
// back and the capsule drops in.
//
// The white flash is the press drawn into the OBJ window, which the act brightens to white (act.bossFlash). Knuckles' glide
// slide and the CPU partner, which the original also tests the leap's landing against, are left out with the characters.

#include "bosses.h"

enum {
  ANIM_PRESS = 620, PRESS_STILL = 0, PRESS_SQUASH = 1, PRESS_STOMP = 2,
  ANIM_NO_SPRING = 621,
  ANIM_EGGMAN = 618, EGGMAN_STILL = 0, EGGMAN_LAUGH = 1, EGGMAN_HURT = 2,
  ANIM_SPRING = 619, ANIM_BASE = 617,
  PRESS_TILES = 54, EGGMAN_TILES = 8, PART_TILES = 8,
  PRESS_ORDER = 21, EGGMAN_ORDER = 22,
  OBJ_WINDOW = 0x100,                       // SPRITE_OBJ_MODE 2: the sprite is drawn into the OBJ window
  ARENA_UP = 144, ARENA_DOWN = 16, ARENA_WIDTH = 300,
  WAIT = 120, DROP_X = -60, GRAVITY = 32,
  LAUGH_AT = 60, STILL = 120,
  HOP_FRAMES = 72, HOP_UP = -1152, LEAP_UP = -10, LEAP_FOLLOW = -200,
  REST = 300, STOMP_REST = 60,
  FLASH = 0x20, FLASH_WHITE = 0x10, LEAP_FROM_HIT = 4, BEATEN_AFTER = 7, HIT_SCORE = 1000,
  BEATEN_UP = 48, BEATEN_FALL = -0x200, FALL_GRAVITY = 0x28, FLOOR_BELOW = 16, BOUNCE_END = -0x100,
  PART_VX = 0x400, PART_VY = -0x200, PART_FRAMES = 60, SPRING_SPIN = 0x80, BASE_SPIN = 0x180, BASE_BELOW = 32,
  DEBRIS_EVERY = 7, DEBRIS_GRAVITY = 40, SMOKING = 240, EGG_MOBILE_UP = 4,
  EGGMAN_SITS_LOWER = 46,
  SE_BOSS_HIT = 143, SE_EXPLOSION = 144, SE_IMPACT = 145,
};

// how far Eggman sits above the press's point, by its frame's first OAM entry over 5 (gUnknown_084ACDA0)
static const int8_t EGGMAN_RAISE[] = { 0, -1, -2, 3, -11, -20 };
// the press's speed after each hit, in tenths (gUnknown_084ACDAC)
static const uint8_t SPEEDS[] = { 10, 10, 10, 10, 12, 12, 14, 16, 16, 0 };

typedef struct EggPress EggPress;
typedef int (*Phase)(EggPress *);
struct EggPress {
  Object o;                 // the press
  Sprite s2;                // Eggman
  Phase phase;
  int x0, y0;               // the spawn point
  int qx, qy, vx, vy;       // the offsets from the spawn point and their speeds, 1/256 px
  int gravity;              // of a hop (unkA8)
  int count;                // a frame counter (unkAC, 16 bits)
  int hits, flash, leaps;   // the hits taken (unkAE), the frames left of a hit's flash (unkAF), the leap's turn (unkB0)
  int fall;                 // the beaten press's fall (qUnkB2, 16 bits)
  int oam;                  // the first OAM entry of the press's frame on screen, kept until an update shows another
};

static int falling(EggPress *b);

static Player *sonic(void) { return &act.player; }
static int sonic_q(void) { return (int)__builtin_floor(act.player.x * 256); }

// the original's ANIM_OVER flag, set by the update that ends a one-shot, cleared by the next one that starts an animation
static int over(const Sprite *s) { return (s->frameFlags & SPRITE_ANIM_OVER) != 0; }
static void restart(Sprite *s, int anim, int variant) { s->graphics.anim = (uint16_t)anim; sprite_start(s, variant); }
// the original sets the variant alone and clears the flag, so the animation starts over only when it changes
static void play(Sprite *s, int variant) { s->variant = (uint8_t)variant; s->frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER; }
static void flip(EggPress *b, int right) {
  uint32_t set = right ? SPRITE_X_FLIP : 0;
  b->o.sprite.frameFlags = (b->o.sprite.frameFlags & ~(uint32_t)SPRITE_X_FLIP) | set;
  b->s2.frameFlags = (b->s2.frameFlags & ~(uint32_t)SPRITE_X_FLIP) | set;
}

static void update(EggPress *b) {
  Sprite *s = &b->o.sprite;
  update_sprite(s, 0);
  if (s->dimensions != NO_FRAME) b->oam = (int8_t)rom_u8(s->dimensions + 1);
  update_sprite(&b->s2, 0);
}

static int at_x(const EggPress *b) { return s16(b->x0 + enemy_i(b->qx)); }
static int at_y(const EggPress *b) { return s16(b->y0 + enemy_i(b->qy)); }

// Eggman sits on the press, or 46 px lower on what is left of it once it is beaten (sub_802D908)
static void draw(EggPress *b, int x, int y) {
  Sprite *s = &b->o.sprite;
  int raise = b->oam / 5, ey;
  if (s->graphics.anim == ANIM_NO_SPRING) ey = y + EGGMAN_SITS_LOWER;
  else ey = y - (raise >= 0 && raise < (int)sizeof EGGMAN_RAISE ? EGGMAN_RAISE[raise] : 0);
  object_draw(s, x, y);
  object_draw(&b->s2, x, ey);
}

// not drawn into the OBJ window, and the act not brightening it while Sonic is alive
static void unflash(EggPress *b) {
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_OBJ_MODE;
  if (!sonic()->dead) act.bossFlash = 0;
}

// Sonic against the press, while it isn't flashing (sub_802D748)
static void hit(EggPress *b, int x, int y) {
  unflash(b);
  if (b->flash != 0) return;
  int result = boss_hit26(&b->o.sprite, x, y);
  if (result == HIT_ENEMY) {
    b->hits = s8(b->hits + 1);
    b->flash = FLASH;
    if (b->hits == LEAP_FROM_HIT) b->leaps = 1;
    play(&b->s2, EGGMAN_HURT);
    play_song(SE_BOSS_HIT);
  } else if (result == HIT_PLAYER) play(&b->s2, EGGMAN_LAUGH);
}

// the hit's flash, white on every other pair of its first 15 frames (sub_802D870), then both sprites
static void show(EggPress *b, int x, int y) {
  if (b->flash != 0) {
    b->flash = s8(b->flash - 1);
    if (b->flash > FLASH_WHITE && !(b->flash & 2) && !sonic()->dead) {
      b->o.sprite.frameFlags |= OBJ_WINDOW;
      act.bossFlash = 1;
    }
  }
  draw(b, x, y);
}

// Eggman's face goes back to normal when its animation ends (sub_802EF24)
static void face(EggPress *b) {
  if (b->s2.variant != EGGMAN_STILL && over(&b->s2)) sprite_start(&b->s2, EGGMAN_STILL);
}

// sub_802E868: the eighth hit. What is left of the press jumps 48 px up, its spring and base fly off, the camera stops where it
// is and the hit scores 1000 points.
static void beaten(EggPress *b) {
  Sprite *s = &b->o.sprite;
  b->qy -= BEATEN_UP * 256;
  int x = at_x(b), y = at_y(b);
  b->s2.variant = EGGMAN_HURT;
  b->fall = BEATEN_FALL;
  play_song(SE_EXPLOSION);
  b->count = 0;
  restart(s, ANIM_NO_SPRING, 0);
  int right = (s->frameFlags & SPRITE_X_FLIP) != 0;
  BossPart *parts[2] = { boss_part(x, y, PART_TILES, ANIM_SPRING, 0), boss_part(x, y + BASE_BELOW, PART_TILES, ANIM_BASE, 0) };
  for (int i = 0; i < 2; i++) {
    BossPart *p = parts[i];
    if (!p) continue;
    p->vy = PART_VY; p->grow = 0; p->frames = PART_FRAMES;
    p->vx = right ? PART_VX : -PART_VX;
    p->tf.qScaleX = (int16_t)(right ? -0x100 : 0x100);
    p->spin = i == 0 ? SPRING_SPIN : BASE_SPIN;
  }
  act.cam.minX = act.cam.maxX = cam_x();
  world_add_score(HIT_SCORE);
  b->phase = falling;
  falling(b);
}

// the start of each of the fight's frames: the hit, the defeat once it has taken 8, otherwise its place
static int fight(EggPress *b, int *x, int *y) {
  *x = at_x(b); *y = at_y(b);
  hit(b, *x, *y);
  if (b->hits > BEATEN_AFTER) { beaten(b); return 0; }
  face(b);
  return 1;
}

static int drop(EggPress *b);
static int landed(EggPress *b);
static int ready(EggPress *b);
static int hop(EggPress *b);
static int landing(EggPress *b);
static int rest(EggPress *b);
static int leap(EggPress *b);
static int stomp(EggPress *b);
static int smoking(EggPress *b);

// Task_EggPressMain: nothing for 121 frames, then it shows 144 px up and starts to fall; this frame draws it twice
static int wait(EggPress *b) {
  if (b->count++ <= WAIT) return 1;
  b->qx = DROP_X * 256; b->qy = -ARENA_UP * 256; b->vy = 0;
  int x = at_x(b), y = at_y(b);
  update(b);
  object_draw(&b->o.sprite, x, y);
  object_draw(&b->s2, x, y);
  b->phase = drop;
  return drop(b);
}

// Task_802DC3C: falling 32/256 px a frame faster each frame, landing on the spawn point's height
static int drop(EggPress *b) {
  if (b->qy != 0) {
    b->vy += GRAVITY; b->qy += b->vy;
    if (b->qy >= 0) {
      b->qy = 0;
      sprite_start(&b->o.sprite, PRESS_SQUASH);
      update(b);
      play_song(SE_IMPACT);
    }
    draw(b, at_x(b), at_y(b));
    return 1;
  }
  update(b);
  draw(b, at_x(b), at_y(b));
  if (over(&b->o.sprite)) { b->phase = landed; sprite_start(&b->o.sprite, PRESS_STILL); b->count = STILL; }
  return 1;
}

// Task_802DDCC: 120 frames still, Eggman laughing after the first 60 (they wait while he does)
static int landed(EggPress *b) {
  if (b->s2.variant == EGGMAN_STILL) {
    b->count = (b->count - 1) & 0xFFFF;
    if (b->count == LAUGH_AT) sprite_start(&b->s2, EGGMAN_LAUGH);
    if (b->count == 0) {
      b->phase = ready; b->vy = 0;
      sprite_start(&b->o.sprite, PRESS_SQUASH);
      sprite_start(&b->s2, EGGMAN_STILL);
    }
  } else if (over(&b->s2)) sprite_start(&b->s2, EGGMAN_STILL);
  update(b);
  draw(b, at_x(b), at_y(b));
  return 1;
}

// Task_802DEFC: crouching, then a hop toward Sonic or, on the leap's turn, a leap
static int ready(EggPress *b) {
  int x, y;
  if (!fight(b, &x, &y)) return 1;
  update(b);
  show(b, x, y);
  if (!over(&b->o.sprite)) return 1;
  if ((b->leaps & 3) == 1) {
    b->vx = 0; b->vy = LEAP_UP * 256;
    b->phase = leap;
  } else {
    int speed = SPEEDS[b->hits];
    b->vx = (sonic_q() - x * 256) / HOP_FRAMES;
    b->vx = speed * b->vx / 10;
    b->vy = speed * HOP_UP / 10;
    b->gravity = speed * (speed * 0x20) / 100;
    flip(b, b->vx >= 0);
    b->phase = hop;
  }
  if (b->leaps != 0) b->leaps = s8(b->leaps + 1);
  return 1;
}

// Task_802E130: the hop, its sprites still until it lands
static int hop(EggPress *b) {
  b->vy += b->gravity; b->qx += b->vx; b->qy += b->vy;
  if (b->qy >= 0) {
    b->qy = 0; b->vx = 0; b->vy = 0;
    sprite_start(&b->o.sprite, PRESS_SQUASH);
    update(b);
    b->phase = landing;
    play_song(SE_IMPACT);
  }
  int x, y;
  if (fight(b, &x, &y)) show(b, x, y);
  return 1;
}

// Task_802E290: the landing's crouch, then a rest that is shorter the faster it is
static int landing(EggPress *b) {
  int x, y;
  if (!fight(b, &x, &y)) return 1;
  update(b);
  show(b, x, y);
  if (over(&b->o.sprite)) { sprite_start(&b->o.sprite, PRESS_STILL); b->count = REST / SPEEDS[b->hits]; b->phase = rest; }
  return 1;
}

// Task_802E3DC
static int rest(EggPress *b) {
  int x, y;
  if (!fight(b, &x, &y)) return 1;
  update(b);
  show(b, x, y);
  b->count = (b->count - 1) & 0xFFFF;
  if (b->count == 0) { sprite_start(&b->o.sprite, PRESS_SQUASH); b->phase = ready; }
  return 1;
}

// Task_802E500: up 10 px a frame, slowing by 32/256; above 200 px it keeps over Sonic, and it lands on him
static int leap(EggPress *b) {
  Player *p = sonic();
  b->vy += GRAVITY; b->qy += b->vy;
  if (b->qy < LEAP_FOLLOW * 256) b->qx = sonic_q() - b->x0 * 256;
  if (b->qy >= 0) {
    b->qy = 0; b->vy = 0; b->count = STOMP_REST;
    sprite_start(&b->o.sprite, PRESS_STOMP);
    b->phase = stomp;
    play_song(SE_IMPACT);
    boss_shake(0x800, 0x40, 0x100, -1, SHAKE_VERTICAL);
    if (!p->air) {
      world_damage(p);
      play(&b->s2, EGGMAN_LAUGH);
    }
  }
  int x, y;
  if (fight(b, &x, &y)) show(b, x, y);
  return 1;
}

// Task_802E714: the stomp's crouch, then 60 frames still
static int stomp(EggPress *b) {
  int x, y;
  if (!fight(b, &x, &y)) return 1;
  update(b);
  show(b, x, y);
  if (b->o.sprite.variant == PRESS_STOMP) {
    if (over(&b->o.sprite)) sprite_start(&b->o.sprite, PRESS_STILL);
  } else {
    b->count = (b->count - 1) & 0xFFFF;
    if (b->count == 0) { sprite_start(&b->o.sprite, PRESS_SQUASH); b->phase = ready; }
  }
  return 1;
}

// debris and an explosion every 8 frames, then both sprites
static void smoke(EggPress *b, int x, int y) {
  b->count = (b->count + 1) & 0xFFFF;
  if ((b->count & DEBRIS_EVERY) == 0) boss_debris(x, y, DEBRIS_GRAVITY);
  update(b);
  draw(b, x, y);
}

// Task_802EA8C: it falls 40/256 px a frame faster each frame and bounces off the floor at 3/4 of its speed until that is under
// 1 px a frame; it is drawn, and throws its debris, from where it was before the floor pushed it out
static int falling(EggPress *b) {
  b->fall = s16(b->fall + FALL_GRAVITY);
  b->qy += b->fall;
  int x = at_x(b), y = at_y(b);
  int d = terrain_tile_floor(x, y + FLOOR_BELOW, 1, 8);
  if (d < 0) {
    b->qy += d * 256;
    b->fall = s16((b->fall >> 2) - b->fall);
    if (b->fall > BOUNCE_END) { b->fall = 0; b->phase = smoking; }
  }
  unflash(b);
  smoke(b, x, y);
  return 1;
}

// sub_802ECFC: on the floor, until 241 frames after it was beaten; then Eggman flies off, the capsule comes and the stage's
// music comes back
static int smoking(EggPress *b) {
  int x = at_x(b), y = at_y(b);
  if (b->count > SMOKING) {
    boss_egg_mobile(x, y - EGG_MOBILE_UP);
    boss_capsule(x, y);
    boss_music(BOSS_MUSIC_END);
    return 0;
  }
  smoke(b, x, y);
  return 1;
}

static int egg_press_run(ActTask *t) {
  EggPress *b = (EggPress *)t->data;
  return b->phase(b);
}

static void egg_press_end(ActTask *t) {
  EggPress *b = (EggPress *)t->data;
  object_sprite_free(&b->s2);
  object_end(t);
}

// CreateEntity_EggPress: it never spawns again in this act, beaten or not; on Easy it starts with two hits taken. Neither
// sprite has run its script, so it is not solid yet.
ActTask *egg_press_spawn(Slot *slot) {
  EggPress *b = OBJECT_NEW(EggPress);
  if (!b) return NULL;
  slot->gone = 1;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->x0 = slot->e.x; b->y0 = slot->e.y;
  b->hits = save.bytes[0x18] ? 2 : 0;
  b->phase = wait;
  b->s2.graphics.dest = HEAP_END;   // nothing to free if the task can't be made
  object_sprite_at(&b->o.sprite, vram_malloc(PRESS_TILES), ANIM_PRESS, PRESS_SQUASH, PRESS_ORDER, ENEMY_PRIORITY, 0, 0);
  ActTask *t = boss_task(&b->o, egg_press_run, egg_press_end, PRIORITY_OBJECTS);
  if (!t) return NULL;
  object_sprite_at(&b->s2, vram_malloc(EGGMAN_TILES), ANIM_EGGMAN, EGGMAN_STILL, EGGMAN_ORDER, ENEMY_PRIORITY, 0, 0);
  boss_cam_bounds(b->y0 - ARENA_UP, b->y0 + ARENA_DOWN, b->x0 - ARENA_WIDTH, b->x0);
  boss_music(BOSS_MUSIC_START);
  return t;
}
