// The platforms Sonic lands on from above and passes through from below: the thin platform, the falling platform and X Zone's
// falling brick, the trampoline and the bounce block. Translated from the JavaScript version's engine/platforms.js (the original's
// platform_thin.c, small_fall_block.c, trampoline.c and bounce_block.c). A thin platform swings to and fro with the stage clock and carries him; a
// falling one drops half a second after he lands on it. They sag under him by up to 4 px. The trampoline is solid and throws him
// up when he lands on it, and so does the bounce block, which wobbles.

#include "objects.h"

enum { PLATFORM_THIN = 21, PLATFORM_FALLING = 22, PLATFORM_TRAMPOLINE = 23, PLATFORM_BOUNCE_BLOCK = 25, PLATFORM_FALLING_BRICK = 104 };
enum {
  ORDER_PLATFORM = 18, PRIORITY_FRONT = 2,
  PRIORITY_THIN = 0x2010,
  SAG_STEP = 0x10, SAG_MAX = 0x100,
  SWING_TURN = 0x100, SWING_HALF = 0x80,   // the stage clock frames of a swing, and half of one
  WAIT_FRAMES = 30, FALL_FRAMES = 32, FALL_ACCEL = 42,
  // the trampoline: Secret Base's and X Zone's (SA1_ANIM_TRAMPOLINE2, 48 by 40 px) or the others' (SA1_ANIM_TRAMPOLINE1, 48 by
  // 32), still or bouncing; it throws Sonic up 1.22 times as fast as he came down, between 3.75 and 10.99 px a frame
  ANIM_TRAMPOLINE = 461, ANIM_TRAMPOLINE_2 = 505, TRAMPOLINE_TILES = 48 / 8 * (32 / 8), TRAMPOLINE_2_TILES = 48 / 8 * (40 / 8),
  VARIANT_STILL = 0, VARIANT_BOUNCE = 1, THROW_SLOWEST = -960, THROW_FASTEST = -2814, BALL_OFFSET_Y = 14, STEP_UP = 8,
  SE_TRAMPOLINE = 176,
  // the bounce block throws him up at 5 px a frame and wobbles for 30 frames, 90/1024 of a turn a frame
  BOUNCE_UP = 5, WOBBLE_FRAMES = 30, WOBBLE_STEP = 90, SE_SPRING = 170,
  BOUNCE_TILES = 32 / 8 * (24 / 8),   // ALLOC_TILES(SA1_ANIM_BOUNCE_BLOCK_1), whichever level's block it shows
};

// the platforms' animations by level (rom/levels.js sprites): thin, the brick and the bounce block if the level has them
static const struct { int level, thin, brick, bounce; } ANIMATIONS[] = {
  { 0, 463, 0, 462 }, { 1, 0, 0, 462 }, { 3, 506, 0, 499 }, { 4, 495, 0, 0 }, { 5, 495, 0, 0 }, { 6, 523, 0, 543 },
  { 7, 523, 0, 543 }, { 12, 605, 574, 0 },
};
enum { FALL_STILL, FALL_WAITING, FALL_FALLING };

typedef struct {
  Object o;
  int sag;
  // a thin platform
  int across, phase, reach, offset;
  // a falling one
  int state, n, vy, fallen;
  // a trampoline, and a bounce block
  int bouncing, wobble;
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
    if (ANIMATIONS[i].level == act.stage.level) return brick == 2 ? ANIMATIONS[i].bounce : brick ? ANIMATIONS[i].brick : ANIMATIONS[i].thin;
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

// --- the trampoline (Task_Trampoline) -------------------------------------------------------------------------------------------------
// Landing on it throws Sonic up, rising as off a spring, and it bounces. Walking onto it from the side lifts him 8 px first.
static int trampoline_throw(Platform *pf, Player *p) {
  const Entity *en = &pf->o.slot->e;
  int v = (int)__builtin_floor(p->ysp * 256 + 0.5);
  if (!(collide_platform(&pf->o, en->x, en->y, box_of(pf), p) & COLLIDE_LANDED)) return 0;
  player_end_attack(p);
  p->onObject = NULL; p->air = 1; p->curled = 0;
  p->offsetY = BALL_OFFSET_Y;
  if (v == 0) p->y -= STEP_UP;
  int up = (v >> 5) - (v + (v >> 2));
  p->ysp = (up < THROW_FASTEST ? THROW_FASTEST : up > THROW_SLOWEST ? THROW_SLOWEST : up) / 256.0;
  p->state = PS_SPRING_RISE;
  return 1;
}

static int trampoline_run(ActTask *t) {
  Platform *pf = (Platform *)t->data;
  const Entity *en = &pf->o.slot->e;
  Sprite *s = &pf->o.sprite;
  int hit = trampoline_throw(pf, &act.player);
  if (hit) play_song(SE_TRAMPOLINE);   // sub_8074FB0
  if (off_cam(en->x, en->y)) return 0;
  if (pf->bouncing) {
    if (hit) sprite_start(s, VARIANT_BOUNCE);
    if (sprite_step(s)) { pf->bouncing = 0; sprite_start(s, VARIANT_STILL); sprite_step(s); }
  } else if (hit) {
    pf->bouncing = 1;
    sprite_start(s, VARIANT_BOUNCE);   // its first frame shows on the next one
  }
  object_draw(s, en->x, en->y);
  return 1;
}

// CreateEntity_Trampoline
static ActTask *trampoline_spawn(Slot *slot) {
  Platform *pf = OBJECT_NEW(Platform);
  if (!pf) return NULL;
  int second = act.stage.zone == 1 || act.stage.zone == 5;
  pf->o.slot = slot;
  pf->o.x = slot->e.x;
  object_sprite_at(&pf->o.sprite, vram_malloc(second ? TRAMPOLINE_2_TILES : TRAMPOLINE_TILES), second ? ANIM_TRAMPOLINE_2 : ANIM_TRAMPOLINE,
                   VARIANT_STILL, ORDER_PLATFORM, PRIORITY_FRONT, 0, 0);
  sprite_step(&pf->o.sprite);
  return object_task(&pf->o, trampoline_run, PRIORITY_OBJECTS);
}

// --- the bounce block (Task_BounceBlock) ---------------------------------------------------------------------------------------------
// Landing on it throws Sonic up at 5 px a frame, facing the way he holds, and it wobbles for 30 frames from the next one, its
// only animated frames. He is tested against it where it rests, wobbling or not.
static int bounce_throw(Platform *pf, Player *p) {
  const Entity *en = &pf->o.slot->e;
  if (p->dead || !(collide_platform(&pf->o, en->x, en->y, box_of(pf), p) & COLLIDE_LANDED)) return 0;
  player_end_attack(p);
  p->onObject = NULL; p->air = 1; p->curled = 0;
  if (p->held[0] & DPAD_LEFT) p->facing = -1;
  else if (p->held[0] & DPAD_RIGHT) p->facing = 1;
  p->ysp = -BOUNCE_UP;
  p->state = PS_BOUNCE; p->rotation = 0;
  player_stand_up(p);
  return 1;
}

static int bounce_run(ActTask *t) {
  Platform *pf = (Platform *)t->data;
  const Entity *en = &pf->o.slot->e;
  int dy = pf->bouncing ? SINE[pf->wobble & 0x3FF] / 1024 : 0;
  int hit = bounce_throw(pf, &act.player);
  if (hit) { pf->n = WOBBLE_FRAMES; pf->wobble = 0; play_song(SE_SPRING); }
  if (off_cam(en->x, en->y + dy)) return 0;
  if (pf->bouncing) {
    pf->wobble += WOBBLE_STEP;
    if (--pf->n == 0) pf->bouncing = 0;
    sprite_step(&pf->o.sprite);
  } else if (hit) pf->bouncing = 1;
  object_draw(&pf->o.sprite, en->x, en->y + dy);
  return 1;
}

// CreateEntity_BounceBlock: the level's block, in tiles enough for the first level's
static ActTask *bounce_spawn(Slot *slot) {
  int anim = animation_of(2);
  if (!anim) return NULL;
  Platform *pf = OBJECT_NEW(Platform);
  if (!pf) return NULL;
  pf->o.slot = slot;
  pf->o.x = slot->e.x;
  object_sprite_at(&pf->o.sprite, vram_malloc(BOUNCE_TILES), anim, 0, ORDER_PLATFORM, PRIORITY_FRONT, 0, 0);
  sprite_step(&pf->o.sprite);
  return object_task(&pf->o, bounce_run, PRIORITY_OBJECTS);
}

ActTask *platform_spawn(Slot *slot) {
  switch (slot->e.kind) {
    case PLATFORM_THIN: return thin_spawn(slot);
    case PLATFORM_FALLING: return falling_spawn(slot, 0);
    case PLATFORM_TRAMPOLINE: return trampoline_spawn(slot);
    case PLATFORM_BOUNCE_BLOCK: return bounce_spawn(slot);
    default: return falling_spawn(slot, 1);
  }
}
