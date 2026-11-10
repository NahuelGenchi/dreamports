// The platforms Sonic lands on from above and passes through from below: the thin platform, the falling platform and X Zone's
// falling brick. Translated from the JavaScript version's engine/platforms.js (the original's platform_thin.c and
// small_fall_block.c). A thin platform swings to and fro with the stage clock and carries him; a falling one drops half a second
// after he lands on it. They sag under him by up to 4 px.

#include "objects.h"

enum { PLATFORM_THIN = 21, PLATFORM_FALLING = 22, PLATFORM_FALLING_BRICK = 104 };
enum {
  ORDER_PLATFORM = 18, PRIORITY_FRONT = 2,
  PRIORITY_THIN = 0x2010,
  SAG_STEP = 0x10, SAG_MAX = 0x100,
  SWING_TURN = 0x100, SWING_HALF = 0x80,   // the stage clock frames of a swing, and half of one
  WAIT_FRAMES = 30, FALL_FRAMES = 32, FALL_ACCEL = 42,
};

// the platforms' animations by level (rom/levels.js sprites): thin, and the brick if the level has one
static const struct { int level, thin, brick; } ANIMATIONS[] = {
  { 4, 495, 0 }, { 5, 495, 0 }, { 12, 605, 574 },
};
enum { FALL_STILL, FALL_WAITING, FALL_FALLING };

typedef struct {
  Object o;
  int sag;
  // a thin platform
  int across, phase, reach, offset;
  // a falling one
  int state, n, vy, fallen;
} Platform;

static const Hitbox *box_of(const Platform *pf) { return object_box(&pf->o.sprite, 0); }

// how far a thin or falling platform sags under Sonic: it eases down by 1/64 of a half turn a frame while he stands on it, and
// back up when he is off it
static int sagging(Platform *pf) {
  if (act.player.onObject == &pf->o) { pf->sag += SAG_STEP; if (pf->sag > SAG_MAX) pf->sag = SAG_MAX; }
  else { pf->sag -= SAG_STEP; if (pf->sag < 0) pf->sag = 0; }
  return SINE[pf->sag] >> 12;
}

static int animation_of(int brick) {
  for (unsigned i = 0; i < sizeof ANIMATIONS / sizeof ANIMATIONS[0]; i++) {
    if (ANIMATIONS[i].level == act.stage.level) return brick ? ANIMATIONS[i].brick : ANIMATIONS[i].thin;
  }
  return 0;
}

static Platform *platform_new(Slot *slot, int brick) {
  int anim = animation_of(brick);
  if (!anim) return NULL;
  Platform *pf = OBJECT_NEW(Platform);
  if (!pf) return NULL;
  pf->o.slot = slot;
  pf->o.x = slot->e.x;
  object_sprite(&pf->o.sprite, anim, 0, 0, ORDER_PLATFORM, PRIORITY_FRONT, 0, 0);
  sprite_step(&pf->o.sprite);
  return pf;
}

// --- the thin platform (Task_PlatformThin, at priority 0x2010) -------------------------------------------------------------------
// It swings across when d2 is above d3 and up and down otherwise, by d2 (d3) * 8 px either side, once every 256 frames of the
// stage clock; a negative d0 (d1) starts it half a swing on. It carries Sonic by what it moved this frame, plus 1 px down, which
// its top then puts him back from (under flipped gravity 2 px up, and it sags up).
static int thin_run(ActTask *t) {
  Platform *pf = (Platform *)t->data;
  const Entity *en = &pf->o.slot->e;
  Player *p = &act.player;
  int inverted = p->inverted;
  int32_t next = (int32_t)((uint32_t)pf->reach * (uint32_t)(int32_t)SINE[(4 * ((act.tick + pf->phase) & 0xFF)) & 0x3FF]) >> 14;
  int moved = next - pf->offset;
  pf->offset = next;
  int x = en->x + (pf->across ? pf->offset >> 8 : 0), y = en->y + (pf->across ? 0 : pf->offset >> 8);
  pf->o.x = x;   // where Sonic balances at its edges
  if (p->onObject == &pf->o) {
    if (pf->across) p->x += moved / 256.0;
    p->y += (inverted ? -2 : 1) + (pf->across ? 0 : moved / 256.0);
  }
  collide_platform_top(&pf->o, x, y, box_of(pf), p);
  if (off_display(en->x, en->y) && off_cam(x, y)) return 0;
  object_draw(&pf->o.sprite, x, y + (inverted ? -1 : 1) * sagging(pf));
  return 1;
}

static ActTask *thin_spawn(Slot *slot) {
  Platform *pf = platform_new(slot, 0);
  if (!pf) return NULL;
  const Entity *en = &slot->e;
  pf->across = en->d[2] > en->d[3];
  pf->phase = s8(pf->across ? en->d[0] : en->d[1]) < 0 ? SWING_HALF : 0;
  pf->reach = (pf->across ? en->d[2] : en->d[3]) << 11;
  return object_task(&pf->o, thin_run, PRIORITY_THIN);
}

// --- the falling platform and brick (Task_PlatformThin_Falling) ------------------------------------------------------------------
// 30 frames after Sonic lands on it, it falls, 42/256 px a frame faster every frame, and takes him down with it for 32 frames;
// then it drops him, falling as fast as it does, and falls through him. It comes back when its spawn point is uncovered again. A
// still thin one gives way to a landing at once; a brick (small_fall_block.c) only gives way with Sonic on it.
static int falling_run(ActTask *t) {
  Platform *pf = (Platform *)t->data;
  const Entity *en = &pf->o.slot->e;
  Player *p = &act.player;
  int brick = en->kind == PLATFORM_FALLING_BRICK;
  if (pf->state != FALL_FALLING) {
    int hit = collide_platform_top(&pf->o, en->x, en->y, box_of(pf), p);
    if (pf->state == FALL_STILL && (hit & COLLIDE_LANDED) && (!brick || p->onObject == &pf->o)) { pf->state = FALL_WAITING; pf->n = WAIT_FRAMES; }
    else if (pf->state == FALL_WAITING && --pf->n == 0) pf->state = FALL_FALLING;
    if (off_display(en->x, en->y) && off_cam(en->x, en->y)) return 0;
    object_draw(&pf->o.sprite, en->x, en->y + sagging(pf));
    return 1;
  }
  pf->vy += FALL_ACCEL;
  pf->fallen += pf->vy;
  pf->n++;
  int y = en->y + (pf->fallen >> 8);
  if (p->onObject == &pf->o) {
    if (pf->n > FALL_FRAMES) { p->air = 1; p->onObject = NULL; p->ysp = s16(pf->vy) / 256.0; }
    else p->y += (pf->vy + 256) / 256.0;
  }
  if (pf->n < FALL_FRAMES) collide_platform_top(&pf->o, en->x, y, box_of(pf), p);
  if (off_cam(en->x, y)) return 0;
  object_draw(&pf->o.sprite, en->x, y + sagging(pf));
  return 1;
}

static ActTask *falling_spawn(Slot *slot, int brick) {
  Platform *pf = platform_new(slot, brick);
  return pf ? object_task(&pf->o, falling_run, PRIORITY_OBJECTS) : NULL;
}

ActTask *platform_spawn(Slot *slot) {
  switch (slot->e.kind) {
    case PLATFORM_THIN: return thin_spawn(slot);
    case PLATFORM_FALLING: return falling_spawn(slot, 0);
    default: return falling_spawn(slot, 1);
  }
}
