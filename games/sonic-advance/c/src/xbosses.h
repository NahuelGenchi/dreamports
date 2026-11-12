// What X Zone's three bosses and their ending share: songs, sounds, camera routines,
// ending transitions, and window/blend display settings.

#ifndef SA_XBOSSES_H
#define SA_XBOSSES_H

#include "bosses.h"
#include "terrain.h"

#define OBJ_WINDOW 0x100

// songs and sounds
enum {
  SE_BOSS_HIT = 143,
  SE_EXPLOSION = 144,
  SE_IMPACT = 145,
  SE_LASER = 0xAC,
  SE_CLAW = 0xB3,

  MUSIC_WRECKER = 0x14,
  MUSIC_DRILLSTER = 0x15,
  MUSIC_EGG_X = 0x16,
  MUSIC_END_WRECKER = 0x34,
  MUSIC_END_DRILLSTER = 0x35,
  MUSIC_END_EGG_X = 0x36,
};

// the sprite tiles each part asks for, as the original's VramMalloc calls do (ALLOC_TILES gives an animation's width
// times its height in tiles)
enum {
  WRECKER_TILES = 30, WRECKER_EGGMAN_TILES = 8, FLEEING_EGGMAN_TILES = 12,
  DRILLSTER_TILES = 54, DRILLSTER_EGGMAN_TILES = 8, DRILLSTER_WHEEL_TILES = 16,
  EGGX_TILES = 42, EGGX_EGGMAN_TILES = 12, EGGX_ARM_TILES = 12, EGGX_HAND_TILES = 64, EGGX_BALL_TILES = 4,
  SUPER_SONIC_FLASH_TILES = 56, MOON_SPARKLE_A_TILES = 4, MOON_SPARKLE_B_TILES = 16,
};

// animations
enum {
  // Egg Wrecker
  ANIM_WRECKER_DECO = 683,      // 0: flame, 1: hook, 2: link
  ANIM_WRECKER_MOBILE = 684,    // 0: mobile
  ANIM_WRECKER_BALL = 685,      // 0: ball
  ANIM_WRECKER_EGGMAN = 686,    // 0: rest, 1: laugh, 2: hurt
  ANIM_EGGMAN_FLEE = 694,       // 4, 6: flee

  // Egg Drillster
  ANIM_DRILLSTER_DRILL = 679,   // 0: drill
  ANIM_DRILLSTER_EGGMAN = 680,  // 0: rest, 1: laugh, 2: hurt
  ANIM_DRILLSTER_WHEEL = 681,   // 0..3: wheels
  ANIM_DRILLSTER = 682,         // 0: car

  // Egg X
  ANIM_EGGX_BODY = 687,         // 0: body
  ANIM_EGGX_ARM = 688,          // 0..19: arm rotary
  ANIM_EGGX_HAND = 689,         // 0: closed, 1: open, 2: grab
  ANIM_EGGX_BALL = 690,         // 0: ball 0, 1: ball 1 (bouncing)
  ANIM_EGGX_EGGMAN = 691,       // 0: rest, 1: laugh arrive, 2: hurt, 3: laugh player hurt

  // Ending
  ANIM_SUPER_SONIC_TRANSFORM = 398, // 1: flash
  ANIM_MOON_SPARKLE_A = 731,        // 0: sparkle A
  ANIM_MOON_SPARKLE_B = 732,        // 0: sparkle B
};

typedef struct {
  int active;
  uint16_t dispCnt;
  uint16_t win0h, win0v;
  uint16_t winIn, winOut;
  uint16_t bldCnt;
  uint16_t bldY;
} XZoneDisplay;

extern XZoneDisplay xzone_disp;
void xzone_display_apply(void);

ActTask *egg_wrecker_spawn(Slot *slot);
ActTask *egg_drillster_spawn(Slot *slot);
ActTask *egg_x_spawn(Slot *slot);

void normal_ending_start(void);
void moon_ending_start(void);
int moon_opens(void);
void player_throw_from_claw(Player *p, int flip);

static inline int xsin(int a) { return SINE[a & 0x3FF]; }
static inline int xcos(int a) { return SINE[(a + 256) & 0x3FF]; }

static inline int boss_flashing(int *flash) {
  if (*flash == 0) return 0;
  (*flash)--;
  return *flash > 16 && !(*flash & 2) && !act.player.dead;
}

static inline int coarse_angle(int x, int y) {
  if ((x | y) == 0) return -1;
  static const int OCTANTS[8] = { 1, 0, 2, 3, 6, 7, 5, 4 };
  int index = 0;
  if (x <= 0) { x = s16(-x); index = 4; }
  if (y <= 0) { y = s16(-y); index += 2; }
  int fraction;
  if (x >= y) {
    y = s16(y * 128);
    fraction = s16(x == 0 ? y : y / x);
  } else {
    index++;
    x = s16(x * 128);
    fraction = s16(y == 0 ? x : x / y);
  }
  if (OCTANTS[index] & 1) fraction = s16(128 - fraction);
  fraction = s16(fraction + OCTANTS[index] * 128);
  return (fraction << 22) >> 22;
}

static inline int boss_grab_test(const Sprite *s, int x, int y) {
  Player *p = &act.player;
  const Hitbox *b0 = object_box(s, 0);
  if (!b0 || p->dead || p->invulnerable != 0 || p->invincible != 0) return 0;
  const Hitbox *body = object_box(&p->sprite, 0);
  if (!body) return 0;
  int px = enemy_sonic_x(), py = enemy_sonic_y();
  return collide_overlap(x, y, b0, px, py, body) ? HIT_PLAYER : 0;
}

static inline int boss_rect_hit(int left, int top, int right, int bottom, int x, int y) {
  Player *p = &act.player;
  if (p->dead) return 0;
  const Hitbox *body = object_box(&p->sprite, 0);
  if (!body) return 0;
  Hitbox hb = { .left = (int16_t)left, .top = (int16_t)top, .right = (int16_t)right, .bottom = (int16_t)bottom };
  int px = enemy_sonic_x(), py = enemy_sonic_y();
  if (!collide_overlap(x, y, &hb, px, py, body)) return 0;
  world_damage(p);
  return HIT_PLAYER;
}

#endif
