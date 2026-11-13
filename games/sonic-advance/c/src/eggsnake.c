// Cosmic Angel's boss, the Egg Snake (enemy kind 27). Translated from the JavaScript version's engine/eggsnake.js
// (the original's boss_6_egg_snake.c).
//
// Its body is nine segments in a row, 32 px apart, that Sonic stands on; its head sways along them, riding their bumps.
// Landing on a segment faster than 4 px a frame bounces the segments around it, and when the head is within two segments
// of that one, it opens up: Eggman is exposed inside it for 480, 300, 180 or 90 frames, and hitting him from the air
// counts. A hit makes the head sway faster for 120 frames. Bursts of three laser shots fly at Sonic every 600 frames,
// sooner with each hit. Eight hits beat it, six on Easy: its spikes fly off, it falls through the arena, throwing debris,
// and after 60 frames on the floor below Eggman rises in the Egg Mobile, Sonic is held still and then walks after him,
// and the act's results come.

#include "bosses.h"

enum {
  SEGMENTS = 9,
  PRIORITY_MANAGER = 0x2000, PRIORITY_SEGMENT = 0x2001, PRIORITY_BOSS = 0x2100,
  PRIORITY_LASER = 0x2200, PRIORITY_SHOTS = 0x2300,
  MUSIC_BOSS = 0x13, MUSIC_BOSS_OVER = 0x33,
  HITS = 8,
  SINE_BEFORE = 0x0800,
  ANIM_HEAD = 662, HEAD_CLOSE = 0, HEAD_OPEN = 1, HEAD_OPENED = 2, HEAD_SHUT = 3,
  ANIM_EGGMAN_IN = 660, EGG_OPEN = 0, EGG_OPEN_LAUGH = 1, EGG_OPEN_HIT = 2, EGG_SHUT = 3, EGG_SHUT_LAUGH = 4, EGG_SHUT_HIT = 5,
  ANIM_SEGMENT = 659, ANIM_SPIKE = 661, ANIM_LASER = 663, ANIM_SHOT = 664,
  ANIM_EGG_MOBILE = 693, MOBILE_STILL = 0, MOBILE_TURN = 1,
  ANIM_EGGMAN_OUT = 694, EGG_FLEE = 4, EGG_FLY = 6, EGG_TAUNT = 7, EGG_TURN = 9,
  HEAD_TILES = 0x30, EGGMAN_IN_TILES = 8, LASER_TILES = 6, SPIKE_TILES = 4,
  HEAD_ORDER = 22, EGGMAN_IN_ORDER = 21, SEGMENT_ORDER = 23, LASER_ORDER = 21, SHOT_ORDER = 15,
  MOBILE_ORDER = 19, EGGMAN_OUT_ORDER = 18,
  SE_BOSS_HIT = 143, SE_EXPLOSION = 144,
  SAVE_DIFFICULTY = 0x18,
};

static const int16_t SWAY[9] = { 512, 512, 512, 512, 563, 614, 1536, 2304, 2304 };
static const int16_t BURST_WAIT[9] = { 600, 600, 600, 600, 499, 428, 375, 300, 300 };
static const uint16_t OPEN_FOR[4] = { 480, 300, 180, 90 };

typedef struct EggSnake EggSnake;
typedef int (*SnakePhase)(EggSnake *);

// a segment, its own task: its own sprite in the original (segment->s), which Sonic stands on, put where the segment is on
// the screen and given the manager's box just before he is tested against it
typedef struct {
  Object o;
  int x, y;
  int index;
} SegData;

typedef struct {
  Object o;
  SegData *segs[SEGMENTS];
  int mode, bounced, stoodOn, rising, after, depth, push, frames;
  int beforeAir, beforeYsp;
  int first;
} SegManager;

typedef struct {
  Object o;
  Sprite s2;
  int wait, shots;
} LaserTask;

typedef struct {
  Object o;
  int qx, qy, vx, vy;
} ShotTask;

struct EggSnake {
  Object o;
  Sprite s2;
  SnakePhase step;
  int x0, y0;
  int sx, sy;
  int16_t bumps[SEGMENTS];
  int timer, flash, phase, laserOn, hits, hitsAtOpen, eggman;
  int laserGone, slotTaken;
  int qx, qy, vx, vy, angle, speed, accel, target, swayX, swayY;
  int fallSpeed, baseX, baseY;
  int body;
};

static EggSnake *snake;
static SegManager *mgr;

static int alive(void) { return !act.player.dead; }
static int over(const Sprite *s) { return (s->frameFlags & SPRITE_ANIM_OVER) != 0; }
static void set_variant(Sprite *s, int variant, int restart) {
  s->variant = (uint8_t)variant;
  if (restart) s->prevVariant = 0xFF;
}

// sub_8004418: the angle (1024 a turn) of (y, x), linear within each eighth of the turn; -1 for (0, 0).
static int octant(int x, int y) {
  if ((x | y) == 0) return -1;
  int index = 0, f;
  if (x <= 0) { x = s16(-x); index = 4; }
  if (y <= 0) { y = s16(-y); index += 2; }
  if (x >= y) { y = s16(y * 128); f = s16(x == 0 ? y : bios_div(y, x)); }
  else { index++; x = s16(x * 128); f = s16(y == 0 ? x : bios_div(x, y)); }
  static const int A[8] = { 1, 0, 2, 3, 6, 7, 5, 4 };
  int a = A[index];
  if (a & 1) f = s16(128 - f);
  return (f + a * 128) & 0x3FF;
}

static void place(EggSnake *b, int x, int y) {
  b->sx = s16(x - cam_x());
  b->sy = s16(y - cam_y());
}

static void draw_at(EggSnake *b, Sprite *s) {
  boss_display(s, b->sx, b->sy);
}

static void unflash(EggSnake *b) {
  b->o.sprite.frameFlags &= ~(uint32_t)SPRITE_OBJ_MODE;
  if (alive()) { act.bossFlash = 0; act.blendOff = 1; }
}

static void show(EggSnake *b) {
  if (b->flash != 0 && --b->flash > 16 && !(b->flash & 2) && alive()) {
    b->o.sprite.frameFlags |= 0x100;
    act.bossFlash = 1;
  }
  draw_at(b, &b->o.sprite);
  if (b->eggman == 0) draw_at(b, &b->s2);
}

static void collide_head(EggSnake *b, int x, int y) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  unflash(b);
  if (b->flash != 0) return;
  int hit = boss_hit26(s, x, y);
  if (hit == HIT_ENEMY) {
    b->hits = s8(b->hits + 1);
    b->flash = 0x20;
    if (s->variant == HEAD_OPENED) set_variant(s2, EGG_OPEN_HIT, 0);
    if (s->variant == HEAD_SHUT) set_variant(s2, EGG_SHUT_HIT, 0);
    s2->frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
    play_song(SE_BOSS_HIT);
  } else if (hit == HIT_PLAYER) {
    if (s->variant == HEAD_OPENED) set_variant(s2, EGG_OPEN_LAUGH, 0);
    if (s->variant == HEAD_SHUT) set_variant(s2, EGG_SHUT_LAUGH, 0);
    s2->frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
  }
}

static void settle(EggSnake *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  if (s2->variant == EGG_OPEN || s2->variant == EGG_SHUT || !over(s2)) return;
  if (s->variant == HEAD_OPENED) s2->variant = EGG_OPEN;
  if (s->variant == HEAD_SHUT) s2->variant = EGG_SHUT;
  s2->prevVariant = 0xFF;
}

static int fight(EggSnake *b);
static int falling(EggSnake *b);
static int landed(EggSnake *b);
static int escape(EggSnake *b);
static void manager_spawn(void);
static void laser_spawn(void);

// Task_EggSnakeInit
static int intro(EggSnake *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  if (b->timer == 120 && b->phase == 0) {
    manager_spawn();
    laser_spawn();
  }
  int r = (SINE[b->angle & 0x3FF] * 15) >> 11;
  int x = s16(b->x0 + enemy_i(b->qx) + r);
  int k = s16(r + 0x90);
  if (k < 0) k += 31;
  int y = s16(b->bumps[k >> 5] + b->y0 + enemy_i(b->qy));
  place(b, x, y);
  update_sprite(s, 0);
  update_sprite(s2, 0);
  show(b);
  switch (b->phase) {
    case 0:
      if (--b->timer == 0) { boss_music(MUSIC_BOSS); b->timer = 60; b->phase++; }
      break;
    case 1:
      if (--b->timer == 0) { set_variant(s2, EGG_SHUT_LAUGH, 0); b->phase++; }
      break;
    case 2:
      if (over(s2)) { set_variant(s2, EGG_SHUT, 0); b->timer = 60; b->phase++; }
      break;
    case 3:
      if (--b->timer == 0) { b->laserOn = 1; b->phase = 0; b->step = fight; }
      break;
  }
  return 1;
}

// sub_80327C4
static int beaten(EggSnake *b) {
  b->qx += b->swayX << 8;
  b->qy += b->swayY << 8;
  int x = s16(b->x0 + enemy_i(b->qx)), y = s16(b->y0 + enemy_i(b->qy));
  set_variant(&b->s2, EGG_OPEN_HIT, 0);
  b->fallSpeed = -0x80;
  play_song(SE_EXPLOSION);
  int right = (b->o.sprite.frameFlags & SPRITE_X_FLIP) != 0;
  static const struct { int dx, dy, vx, spin, xflip; } SPIKES[4] = {
    { 0, 0, -0x100, 0x100, 0 },
    { 16, 16, -0x400, 0x200, 0 },
    { -16, 16, 0x200, 0x300, 1 },
    { -16, 16, 0x80, 0x380, 1 },
  };
  for (int i = 0; i < 4; i++) {
    BossPart *p = boss_part(x + SPIKES[i].dx, y + SPIKES[i].dy, SPIKE_TILES, ANIM_SPIKE, 0);
    if (!p) continue;
    p->vy = -0x200;
    p->grow = 0;
    p->spin = SPIKES[i].spin;
    if (SPIKES[i].xflip) p->o.sprite.frameFlags |= SPRITE_X_FLIP;
    if (right) {
      p->tf.qScaleX = -0x100;
      p->vx = -SPIKES[i].vx;
    } else {
      p->vx = SPIKES[i].vx;
    }
    p->frames = 0x3C;
  }
  Camera *c = &act.cam;
  c->minX = c->maxX = cam_x();
  boss_cam_pan(c->maxY, c->maxY + 320);
  act.clockStopped = 1;
  act.ringsStopped = 1;
  world_add_score(1000);
  b->step = falling;
  return falling(b);
}

// Task_8032370
static int fight(EggSnake *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  b->speed = s16(b->speed + b->accel);
  b->angle = (b->angle - enemy_i(b->speed)) & 0x3FF;
  int r = (SINE[b->angle] * 15) >> 11;
  int x = s16(b->x0 + enemy_i(b->qx) + r);
  int t = s16(r + 0x80), n = (t < 0 ? t + 31 : t) >> 5, at = n & 0xFF, frac = s16(t - (n << 5));
  int d = (b->bumps[at + 1] - b->bumps[at]) * frac;
  if (d < 0) d += 31;
  int dy = s16(b->bumps[at] + (d >> 5)), y = s16(dy + b->y0 + enemy_i(b->qy));
  b->swayX = r;
  b->swayY = dy;
  collide_head(b, x, y);
  if (b->hits >= HITS) return beaten(b);
  place(b, x, y);
  settle(b);
  update_sprite(s, 0);
  if (b->eggman == 0) update_sprite(s2, 0);
  show(b);
  switch (b->phase) {
    case 0: {
      if (b->speed < 0x200) { b->speed = 0x200; b->accel = 0; }
      int k = r + 0x90;
      if (k < 0) k += 31;
      int under = (k >> 5) & 0xFF;
      if (mgr && under != 0 && under != 8 && mgr->bounced != 0 && mgr->bounced != 8
          && s8(under) >= s8(mgr->bounced - 2) && s8(under) <= s8(mgr->bounced + 2) && mgr->rising != 0) {
        b->speed = 0x200;
        b->accel = 0;
        b->phase++;
      }
      break;
    }
    case 1:
      if (s->variant != HEAD_OPEN) {
        if (!mgr || mgr->push >= 0) return 1;
        set_variant(s, HEAD_OPEN, 1);
        b->eggman = 0xFF;
        return 1;
      }
      if (!over(s)) return 1;
      set_variant(s, HEAD_OPENED, 1);
      set_variant(s2, EGG_OPEN, 0);
      b->eggman = 0;
      b->timer = OPEN_FOR[(act_random() + (uint32_t)act_stage_time()) & 3];
      b->hitsAtOpen = b->hits;
      b->phase++;
      break;
    case 2:
      if (b->flash != 0) {
        if (b->flash > 16) return 1;
      } else if ((b->timer = (b->timer - 1) & 0xFFFF) != 0) break;
      set_variant(s, HEAD_CLOSE, 1);
      b->eggman = 0xFF;
      b->phase++;
      break;
    case 3:
      if (!over(s)) break;
      set_variant(s, HEAD_SHUT, 1);
      set_variant(s2, EGG_SHUT, 0);
      b->eggman = 0;
      b->accel = 0x40;
      b->target = SWAY[b->hits];
      b->timer = 120;
      b->phase += b->hits == b->hitsAtOpen ? 2 : 1;
      break;
    case 4:
      if (b->speed >= b->target) { b->speed = b->target; b->accel = 0; }
      if ((b->timer = (b->timer - 1) & 0xFFFF) == 0) { b->accel = -0x40; b->phase = 0; }
      break;
    case 5:
      if (b->speed >= 0x200) { b->speed = 0x200; b->accel = 0; b->phase = 0; }
      break;
  }
  return 1;
}

// Task_8032AF8
static int falling(EggSnake *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  b->fallSpeed = s16(b->fallSpeed + 5);
  b->qy += b->fallSpeed;
  int x = s16(b->x0 + enemy_i(b->qx)), y = s16(b->y0 + enemy_i(b->qy));
  if (terrain_tile_floor(x, y, 1, 8) < 0) {
    b->timer = 60;
    b->step = landed;
    return 1;
  }
  unflash(b);
  b->timer = (b->timer + 1) & 0xFFFF;
  if ((b->timer & 7) == 0) {
    boss_debris(x, y + 32, 5);
    if (b->laserGone) b->slotTaken = 1;
  }
  place(b, x, y);
  update_sprite(s, 0);
  update_sprite(s2, 0);
  draw_at(b, s);
  draw_at(b, s2);
  return 1;
}

// sub_8032D44
static int landed(EggSnake *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  if ((b->timer = (b->timer - 1) & 0xFFFF) != 0) {
    place(b, s16(b->x0 + enemy_i(b->qx)), s16(b->y0 + enemy_i(b->qy)));
    update_sprite(s, 0);
    update_sprite(s2, 0);
    draw_at(b, s);
    draw_at(b, s2);
    return 1;
  }
  if (mgr) mgr->after = 0xFF;
  act.player.onObject = NULL;
  act.cam.maxY = 2208;
  boss_music(MUSIC_BOSS_OVER);
  b->baseX = s16(b->x0 + enemy_i(b->qx));
  b->baseY = s16(b->y0 + enemy_i(b->qy));
  b->qx = 0; b->qy = 0; b->vx = 0; b->vy = -0x80; b->phase = 0;
  object_sprite_free(s);
  object_sprite_free(s2);
  object_sprite(s, ANIM_EGG_MOBILE, MOBILE_STILL, MOBILE_TURN, MOBILE_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite(s2, ANIM_EGGMAN_OUT, EGG_FLEE, EGG_TURN, EGGMAN_OUT_ORDER, ENEMY_PRIORITY, 0, 0);
  b->body = 0;
  b->step = escape;
  return 1;
}

static void follow_eggman(int px, int x) {
  Player *p = &act.player;
  if (px < x - 96) { p->heldRight = 1; p->heldLeft = 0; }
  if (px > cam_x() + DISPLAY_WIDTH + 120) {
    p->xsp = 0; p->ysp = 0; p->gsp = 0;
    p->heldRight = 0; p->heldLeft = 0;
  }
}

// sub_8032F58
static int escape(EggSnake *b) {
  Sprite *s = &b->o.sprite, *s2 = &b->s2;
  Player *p = &act.player;
  int px = enemy_sonic_x();
  b->qx += b->vx;
  b->qy += b->vy;
  int x = s16(enemy_i(b->qx) + b->baseX), y = s16(enemy_i(b->qy) + b->baseY);
  if (b->phase <= 4) {
    place(b, x, y);
    update_sprite(s, 0);
    update_sprite(s2, 0);
    draw_at(b, s);
    draw_at(b, s2);
  }
  switch (b->phase) {
    case 0:
      if (!p->air && !p->onObject) {
        if (!p->ignoreInput) {
          p->xsp = 0; p->ysp = 0; p->gsp = 0;
          p->ignoreInput = 1;
          p->heldRight = x > px;
          p->heldLeft = x <= px;
          act.cam.speedX = 0;
          act.cam.maxX = cam_x() + 240;
        } else {
          p->heldRight = 0;
          p->heldLeft = 0;
        }
      }
      if (b->qy < -90 * 256) { b->qy = -90 * 256; b->vy = 0; }
      if (b->vy == 0 && p->ignoreInput) {
        if (x > px) {
          b->phase += 2;
          set_variant(s2, EGG_TAUNT, 1);
        } else {
          b->phase++;
          set_variant(s, MOBILE_TURN, 1);
          set_variant(s2, EGG_TURN, 1);
        }
      }
      break;
    case 1:
      if (over(s2)) {
        b->phase++;
        set_variant(s, MOBILE_STILL, 1);
        set_variant(s2, EGG_TAUNT, 1);
        s->frameFlags |= SPRITE_X_FLIP;
        s2->frameFlags |= SPRITE_X_FLIP;
      }
      break;
    case 2:
      if (!over(s2)) break;
      if (s2->frameFlags & SPRITE_X_FLIP) {
        b->phase += 2;
        set_variant(s2, EGG_FLY, 1);
        b->vx = 0x280;
      } else {
        b->phase++;
        set_variant(s, MOBILE_TURN, 1);
        set_variant(s2, EGG_TURN, 1);
      }
      break;
    case 3:
      if (over(s2)) {
        b->phase++;
        set_variant(s, MOBILE_STILL, 1);
        set_variant(s2, EGG_FLY, 1);
        s->frameFlags |= SPRITE_X_FLIP;
        s2->frameFlags |= SPRITE_X_FLIP;
        b->vx = 0x280;
      }
      break;
    case 4:
      follow_eggman(px, x);
      if (x - cam_x() > DISPLAY_WIDTH + 120) {
        b->phase++;
        b->timer = 180;
        // the results' tasks (0x2120) go into the list between this task (0x2100) and the one the list already holds
        // as next, so they first run on the next frame
        act_stage_results(1);
      }
      break;
    case 5:
      follow_eggman(px, x);
      if ((b->timer = (b->timer - 1) & 0xFFFF) == 0) return 0;
      break;
  }
  return 1;
}

// --- segments (sub_8033878, Task_8033924, Task_8033AA0, Task_8034098) -----------------------------------------------------
static void seg_ends(int16_t *bumps) {
  if (bumps[0] > 8) bumps[0] = 8;
  if (bumps[8] > 8) bumps[8] = 8;
}

static void seg_slope(int16_t *bumps, int k, int clampEach) {
  for (int i = 0; i < SEGMENTS; i++) {
    if (i == k) continue;
    int d = s8(k - i), n = k;
    if (d < 0) { d = -d; n = 8 - k; }
    int t = s16(bumps[k] - bios_div(d * bumps[k], s8(n + 1)));
    if (t > bumps[i]) bumps[i]++;
    if (t < bumps[i]) bumps[i]--;
    if (clampEach) seg_ends(bumps);
  }
}

static void seg_thirds(int16_t *bumps, int k) {
  for (int i = 0; i < SEGMENTS; i++) {
    if (i == k) continue;
    int d = s8(k - i);
    if (d < 0) d = -d;
    if (d <= 2) bumps[i] = (int16_t)(bumps[k] - bios_div(bumps[k] * d, 3));
  }
}

static int seg_bounce(SegManager *m, int16_t *bumps, int k) {
  bumps[k] = (int16_t)(bumps[k] + m->push);
  if (bumps[k] >= m->depth) {
    bumps[k] = (int16_t)m->depth;
    m->push = s16(1 - m->push);
    m->rising = 0;
  }
  return bumps[k] + bios_div(m->depth, 2) <= 0;
}

static int segment_run(ActTask *t) {
  SegData *sg = (SegData *)t->data;
  if (!snake || !mgr) return 0;
  int y = s16(sg->y + snake->bumps[sg->index]);
  if (y - cam_y() < -240) return 0;
  if (mgr->after == 0 || !(mgr->frames & 1)) object_draw(&mgr->o.sprite, s16(sg->x), y);
  return 1;
}

// the manager forgets a segment that has gone
static void segment_end(ActTask *t) {
  SegData *sg = (SegData *)t->data;
  if (mgr && mgr->segs[sg->index] == sg) mgr->segs[sg->index] = NULL;
  object_end(t);
}

static int q8(double v) { return (int)__builtin_floor(v * 256 + 0.5); }

static int manager_run(ActTask *t) {
  SegManager *m = (SegManager *)t->data;
  if (!snake) return 0;
  Player *p = &act.player;
  int16_t *bumps = snake->bumps;
  if (m->first) {
    m->first = 0;
    m->beforeAir = p->air;
    m->beforeYsp = q8(p->ysp);
    memset(bumps, 0, sizeof snake->bumps);
    update_sprite(&m->o.sprite, 0);
    for (int i = 0; i < SEGMENTS; i++) {
      SegData *sg = PLAIN_NEW(SegData);
      m->segs[i] = sg;
      if (!sg) continue;
      sg->x = snake->x0 + i * 32 - 112;
      sg->y = snake->y0;
      sg->index = i;
      if (!boss_task(&sg->o, segment_run, segment_end, PRIORITY_SEGMENT + i)) m->segs[i] = NULL;
    }
    return 1;
  }
  int16_t was[SEGMENTS];
  memcpy(was, bumps, sizeof was);
  m->frames = (m->frames + 1) & 0xFFFF;
  int on = -1, done = 0;
  const Hitbox *box = object_box(&m->o.sprite, 0);
  if (m->after == 0) {
    for (int i = 0; i < SEGMENTS; i++) {
      SegData *sg = m->segs[i];
      if (!sg) continue;
      int wx = s16(sg->x), wy = s16(sg->y + bumps[i]);
      sg->o.sprite.x = (int16_t)(wx - cam_x());
      sg->o.sprite.y = (int16_t)(wy - cam_y());
      if (box) sg->o.sprite.hitboxes[0] = *box;
      if (box && collide_platform_top(&sg->o, wx, wy, box, p)) {
        on = i;
        break;
      }
    }
  } else if (!p->air && !p->onObject) done = 1;

  if (on >= 0) {
    int k = on;
    int depth = k == 0 || k == 8 ? 8 : 16;
    m->stoodOn = k;
    if (m->beforeAir && m->beforeYsp > 0x400) {
      m->mode = 2; m->bounced = k; m->rising = 0xFF;
      if (depth != 8) depth *= 2;
      m->depth = depth;
      for (int i = 0; i < SEGMENTS; i++) {
        if (i != k) { bumps[i] = 0; continue; }
        m->push = m->beforeYsp >> 8;
        bumps[i] = (int16_t)(bumps[i] + m->push);
        if (bumps[i] > depth) bumps[i] = (int16_t)depth;
      }
    } else if (m->mode == 2) {
      if (seg_bounce(m, bumps, k)) { bumps[k] = (int16_t)-bios_div(m->depth, 2); m->mode = 1; }
      seg_thirds(bumps, k);
      seg_ends(bumps);
    } else {
      m->mode = 1;
      bumps[k] = (int16_t)(bumps[k] + (bumps[k] < 0 ? 2 : 1));
      if (bumps[k] > depth) bumps[k] = (int16_t)depth;
      seg_slope(bumps, k, 0);
      seg_ends(bumps);
    }
    p->y += 1 + (bumps[k] - was[k]);
  } else if (m->mode == 2) {
    int k = m->bounced;
    if (seg_bounce(m, bumps, k)) { bumps[k] = (int16_t)-bios_div(m->depth, 2); m->push = 0; m->mode = 0; }
    seg_thirds(bumps, k);
    seg_ends(bumps);
  } else {
    int k = m->stoodOn;
    m->mode = 0;
    if (bumps[k] > 0) bumps[k]--;
    if (bumps[k] < 0) { bumps[k] += 2; if (bumps[k] > 0) bumps[k] = 0; }
    seg_slope(bumps, k, 1);
  }
  m->beforeAir = p->air;
  m->beforeYsp = q8(p->ysp);
  return !done;
}

static void manager_end(ActTask *t) {
  if (mgr == (SegManager *)t->data) mgr = NULL;
  object_end(t);
}

static void manager_spawn(void) {
  SegManager *m = OBJECT_NEW(SegManager);
  if (!m) return;
  m->first = 1;
  mgr = m;
  object_sprite(&m->o.sprite, ANIM_SEGMENT, 0, 0, SEGMENT_ORDER, ENEMY_PRIORITY, 0, 0);
  boss_task(&m->o, manager_run, manager_end, PRIORITY_MANAGER);
}

// --- laser and shots (sub_803330C, Task_8033480, CreateProjectile, Task_8033730) ------------------------------------------
static int shot_run(ActTask *t) {
  ShotTask *sh = (ShotTask *)t->data;
  Sprite *s = &sh->o.sprite;
  if (!snake) return 0;
  sh->qx += sh->vx;
  sh->qy += sh->vy;
  int x = s16(snake->x0 + enemy_i(sh->qx)), y = s16(snake->y0 + enemy_i(sh->qy));
  int sx = s16(x - cam_x()), sy = s16(y - cam_y());
  if ((sy < -32 || sy > 176) && (sh->vx >= 0 ? sx > 256 : sx < -32)) return 0;
  int found = !snake->laserGone || snake->slotTaken;
  if (found && snake->hits >= HITS) {
    boss_explosion(x << 8, y << 8);
    return 0;
  }
  if (enemy_projectile(s, x, y) && found && snake->body) {
    if (snake->o.sprite.variant == HEAD_OPENED) snake->s2.variant = EGG_OPEN_LAUGH;
    if (snake->o.sprite.variant == HEAD_SHUT) snake->s2.variant = EGG_SHUT_LAUGH;
  }
  update_sprite(s, 0);
  object_draw(s, x, y);
  return 1;
}

static void shot_spawn(void) {
  if (!snake) return;
  ShotTask *sh = OBJECT_NEW(ShotTask);
  if (!sh) return;
  sh->qx = (snake->swayX + 16) << 8;
  sh->qy = snake->swayY << 8;
  int dx = s16(enemy_sonic_x() - (snake->x0 + enemy_i(sh->qx)));
  int dy = s16(enemy_sonic_y() - (snake->y0 + enemy_i(sh->qy)));
  int a = octant(bios_div(dy, 2), bios_div(dx, 2));
  sh->vx = SINE[(a + 256) & 0x3FF] >> 6;
  sh->vy = (a < 0 ? SINE_BEFORE : SINE[a & 0x3FF]) >> 6;
  object_sprite(&sh->o.sprite, ANIM_SHOT, 0, 0, SHOT_ORDER, ENEMY_PRIORITY, 0, 0);
  object_task(&sh->o, shot_run, PRIORITY_SHOTS);
}

static int laser_run(ActTask *t) {
  LaserTask *l = (LaserTask *)t->data;
  if (!snake || snake->hits >= HITS) {
    if (snake) snake->laserGone = 1;
    return 0;
  }
  if (!snake->laserOn) return 1;
  Sprite *s = &l->o.sprite, *s2 = &l->s2;
  int v = snake->o.sprite.variant;
  if (l->wait != 0) {
    if (--l->wait != 0) return 1;
    s->frameFlags &= ~(uint32_t)SPRITE_Y_FLIP;
    s2->frameFlags &= ~(uint32_t)SPRITE_Y_FLIP;
    if (v != HEAD_OPENED && v != HEAD_SHUT) { l->wait = 1; return 1; }
    if (v == HEAD_SHUT) {
      s->frameFlags |= SPRITE_Y_FLIP;
      s2->frameFlags |= SPRITE_Y_FLIP;
    }
    s->prevVariant = 0xFF;
    s2->prevVariant = 0xFF;
    s->frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
    s2->frameFlags &= ~(uint32_t)SPRITE_ANIM_OVER;
    l->shots++;
    shot_spawn();
  } else if (over(s) || (v != HEAD_OPENED && v != HEAD_SHUT)) {
    if (l->shots != 3) l->wait = 60;
    else { l->wait = BURST_WAIT[snake->hits]; l->shots = 0; }
  } else {
    update_sprite(s, 0);
    draw_at(snake, s);
    s2->frameFlags |= SPRITE_X_FLIP;
    update_sprite(s2, 0);
    draw_at(snake, s2);
  }
  return 1;
}

static void laser_spawn(void) {
  LaserTask *l = OBJECT_NEW(LaserTask);
  if (!l) return;
  l->wait = 600;
  l->shots = 0;
  uint32_t vram = vram_malloc(LASER_TILES);
  object_sprite_at(&l->o.sprite, vram, ANIM_LASER, 0, LASER_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite_at(&l->s2, vram, ANIM_LASER, 0, LASER_ORDER, ENEMY_PRIORITY, 1, 0);
  l->s2.frameFlags |= 0xC0000;
  object_task(&l->o, laser_run, PRIORITY_LASER);
}

static int snake_run(ActTask *t) {
  EggSnake *b = (EggSnake *)t->data;
  return b->step(b);
}

static void snake_end(ActTask *t) {
  EggSnake *b = (EggSnake *)t->data;
  if (snake == b) snake = NULL;
  object_sprite_free(&b->s2);
  object_end(t);
}

ActTask *egg_snake_spawn(Slot *slot) {
  slot->gone = 1;
  EggSnake *b = OBJECT_NEW(EggSnake);
  if (!b) return NULL;
  snake = b;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->x0 = slot->e.x;
  b->y0 = slot->e.y;
  b->timer = 120;
  b->qx = 0x1000;
  b->speed = 0x200;
  b->body = 1;
  if (save.bytes[SAVE_DIFFICULTY] != 0) b->hits = 2;
  b->step = intro;
  object_sprite_at(&b->o.sprite, vram_malloc(HEAD_TILES), ANIM_HEAD, HEAD_SHUT, HEAD_ORDER, ENEMY_PRIORITY, 0, 0);
  object_sprite_at(&b->s2, vram_malloc(EGGMAN_IN_TILES), ANIM_EGGMAN_IN, EGG_SHUT, EGGMAN_IN_ORDER, ENEMY_PRIORITY, 0, 0);
  boss_cam_bounds(b->y0 - 128, b->y0 + 32, b->x0 - 144, b->x0 + 176);
  return boss_task(&b->o, snake_run, snake_end, PRIORITY_BOSS);
}
