// X Zone's first boss, the Egg Wrecker (SAT-R decompilation, src/game/sa1/stage/enemies/boss_x1_egg_wrecker.c;
// where its C does not match the ROM, Task_80352C0, Task_8035354, Task_803540C, Task_80354F4 and Task_8035588,
// this follows their assembly in asm/non_matching/game/sa1/stage/enemies/). Eggman's ship swings a wrecking
// ball on a chain, as in Sonic 1's Green Hill Zone. Positions are in whole pixels, its offsets and speeds in
// 1/256 px.

#include "xbosses.h"

#define LINKS 4

typedef struct EggWrecker EggWrecker;
typedef int (*EggWreckerFn)(EggWrecker *b);

struct EggWrecker {
  Object o;
  Sprite s2;
  int worldX, worldY;
  int qx, qy, vx, vy;
  int x, y;
  int timer;
  int hits;
  int flash;
  int phase;
  int moving;
  int swing;
  int ball;
  int anim694;
  int laugh;
  EggWreckerFn main;
};

static void set_eggman(EggWrecker *b, int variant) {
  b->s2.variant = (uint8_t)variant;
  b->s2.graphics.anim = (uint16_t)(b->anim694 ? ANIM_EGGMAN_FLEE : ANIM_WRECKER_EGGMAN);
  b->s2.prevVariant = 0xFF;
}

static void wrecker_draw(EggWrecker *b) {
  int sx = b->x - cam_x(), sy = b->y - cam_y();
  boss_display(&b->o.sprite, sx, sy);
  boss_display(&b->s2, sx, sy - (b->anim694 ? 3 : 0));
}

static void wrecker_show(EggWrecker *b) {
  if (boss_flashing(&b->flash)) {
    b->o.sprite.frameFlags |= OBJ_WINDOW;
    act.bossFlash = 1;
  } else {
    b->o.sprite.frameFlags &= ~SPRITE_OBJ_MODE;
    act.bossFlash = 0;
  }
  wrecker_draw(b);
}

static void wrecker_move(EggWrecker *b) {
  b->qx += b->vx; b->qy += b->vy;
  b->x = s16(b->worldX + (b->qx >> 8));
  b->y = s16(b->worldY + (b->qy >> 8));
}

// Subtasks: Hook, Link, Ball, Flame
typedef struct { Object o; EggWrecker *b; int t; } Hook;
typedef struct { Object o; EggWrecker *b; int i, t, hanging; } Link;
typedef struct { Object o; EggWrecker *b; int t, swinging; } Ball;
typedef struct { Object o; EggWrecker *b; } Flame;

static int hook_run(ActTask *t) {
  Hook *h = (Hook *)t->data;
  EggWrecker *b = h->b;
  int lift = 0;
  if (h->t != 0) { h->t--; lift = h->t >> 3; }
  int x = b->x, y = s16(b->y - lift);
  update_sprite(&h->o.sprite, 0);
  boss_display(&h->o.sprite, x - cam_x(), y - cam_y());
  if (b->hits > 3) {
    boss_explosion(x << 8, (y + 20) << 8);
    return 0;
  }
  return 1;
}

static int link_run(ActTask *t) {
  Link *l = (Link *)t->data;
  EggWrecker *b = l->b;
  int x, y, hanging = l->hanging;
  if (!hanging) {
    int dy;
    if (--l->t != 0) {
      dy = s16(14 * l->i - (((l->t * 4 * (14 * l->i + 21)) << 8) >> 16) + 35);
    } else {
      dy = 14 * l->i + 35;
      l->t = 8 * l->i + 8;
      l->hanging = 1;
    }
    x = b->x; y = s16(dy + b->y);
  } else {
    int r = 14 * l->i + 13;
    x = s16(((xcos(b->ball) * r * 4) >> 16) + b->x);
    y = s16(b->y + ((xsin(b->ball & 0x1FF) * r * 4) >> 16) + 22);
  }
  update_sprite(&l->o.sprite, 0);
  boss_display(&l->o.sprite, x - cam_x(), y - cam_y());
  // drawn once more as it explodes
  if (hanging && b->hits > 3 && --l->t == 0) {
    boss_explosion(x << 8, y << 8);
    return 0;
  }
  return 1;
}

static int ball_run(ActTask *t) {
  Ball *bl = (Ball *)t->data;
  EggWrecker *b = bl->b;
  int x, y, swinging = bl->swinging;
  if (!swinging) {
    int dy;
    if (--bl->t != 0) {
      dy = s16(99 - (((bl->t * 4 * 93) << 8) >> 16));
    } else {
      dy = 99;
      bl->t = 60;
      bl->swinging = 1;
    }
    x = b->x; y = s16(b->y + dy);
  } else {
    x = s16(b->x + ((xcos(b->ball) * 77) >> 14));
    y = s16(b->y + ((xsin(b->ball & 0x1FF) * 77) >> 14) + 22);
    if (b->hits < 4 && boss_shot(&bl->o.sprite, x, y) == HIT_PLAYER) {
      b->laugh = 1;
    }
  }
  update_sprite(&bl->o.sprite, 0);
  boss_display(&bl->o.sprite, x - cam_x(), y - cam_y());
  // drawn as it explodes, every 8 frames for a second
  if (swinging && b->hits > 3) {
    if (!(bl->t & 7)) {
      uint32_t r = act_random();
      boss_explosion((x + (r & 0x1F) - 15) << 8, (y + ((r >> 16) & 0x1F) - 15) << 8);
    }
    if (--bl->t == 0) return 0;
  }
  return 1;
}

static int flame_run(ActTask *t) {
  Flame *f = (Flame *)t->data;
  EggWrecker *b = f->b;
  if (b->moving == 0 || b->vx == 0) return 1;
  if (b->qx > 300 << 8) return 0;
  f->o.sprite.frameFlags = (f->o.sprite.frameFlags & ~SPRITE_X_FLIP) | (b->o.sprite.frameFlags & SPRITE_X_FLIP);
  update_sprite(&f->o.sprite, 0);
  boss_display(&f->o.sprite, b->x - cam_x(), b->y - cam_y());
  return 1;
}

static void create_parts(EggWrecker *b) {
  // Hook
  Hook *h = OBJECT_NEW(Hook);
  if (h) {
    h->b = b; h->t = 0x40;
    object_sprite_at(&h->o.sprite, vram_malloc(2), ANIM_WRECKER_DECO, 1, 24, ENEMY_PRIORITY, 0, 0);
    object_task(&h->o, hook_run, 0x2100);
  }
  // Links
  for (int i = 0; i < LINKS; i++) {
    Link *l = OBJECT_NEW(Link);
    if (l) {
      l->b = b; l->i = i; l->t = 0x40; l->hanging = 0;
      object_sprite_at(&l->o.sprite, vram_malloc(4), ANIM_WRECKER_DECO, 2, 25, ENEMY_PRIORITY, 0, 0);
      object_task(&l->o, link_run, 0x2100 | i);
    }
  }
  // Ball
  Ball *bl = OBJECT_NEW(Ball);
  if (bl) {
    bl->b = b; bl->t = 0x40; bl->swinging = 0;
    object_sprite_at(&bl->o.sprite, vram_malloc(0x10), ANIM_WRECKER_BALL, 0, 23, ENEMY_PRIORITY, 0, 0);
    object_task(&bl->o, ball_run, 0x2104);
  }
  // Flame
  Flame *f = OBJECT_NEW(Flame);
  if (f) {
    f->b = b;
    object_sprite_at(&f->o.sprite, vram_malloc(4), ANIM_WRECKER_DECO, 0, 24, ENEMY_PRIORITY, 0, 0);
    object_task(&f->o, flame_run, 0x2105);
  }
}

static int wrecker_falling(EggWrecker *b);

static void wrecker_wrecked(EggWrecker *b) {
  b->flash = 0; act.bossFlash = 0; b->o.sprite.frameFlags &= ~(uint32_t)OBJ_WINDOW;
  b->phase = 0; b->timer = 60; b->vx = 0; b->vy = 0;
  b->qy += (xcos(((b->swing + 0x100) * 2) & 0x3FF) >> 13) << 8;
  set_eggman(b, 2);
  play_song(SE_EXPLOSION);
  world_add_score(1000);
  b->main = wrecker_falling;
  wrecker_falling(b);
}

static int wrecker_falling(EggWrecker *b) {
  wrecker_move(b);
  if (!(b->timer & 7)) x_boss_debris(b->x, b->y, b->y);
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  wrecker_draw(b);
  switch (b->phase) {
    case 0:
      if (--b->timer == 0) {
        b->timer = 0x5A; b->phase++;
        b->anim694 = 1;
        b->s2.oamFlags = (uint16_t)(23 << 6);
        vram_free(b->s2.graphics.dest);
        b->s2.graphics.dest = vram_malloc(FLEEING_EGGMAN_TILES);
        set_eggman(b, 4);
      }
      break;
    case 1:
      b->vy += 3;
      if (--b->timer == 0) { b->timer = 30; b->phase++; }
      break;
    case 2:
      b->vy -= 0x18;
      if (--b->timer == 0) {
        b->vx = 0x200; b->vy = -0x40; b->timer = 1; b->phase++;
        set_eggman(b, 6);
        b->o.sprite.frameFlags |= SPRITE_X_FLIP;
        b->s2.frameFlags |= SPRITE_X_FLIP;
      }
      break;
    case 3:
      if (b->qx > 0x13000) {
        act.cam.minY = 0;
        act.cam.maxY = act.stage.height - DISPLAY_HEIGHT;
        act.cam.maxX = act.stage.width - DISPLAY_WIDTH;
        boss_music(MUSIC_END_WRECKER);
        b->o.slot->gone = 1;
        return 0;
      }
      break;
  }
  return 1;
}

static void wrecker_hit_test(EggWrecker *b, int x, int y) {
  if (b->flash != 0) return;
  int hit = boss_hit(&b->o.sprite, x, y);
  if (hit == HIT_ENEMY) {
    b->hits++;
    b->flash = 0x20;
    set_eggman(b, 2);
    play_song(SE_BOSS_HIT);
  } else if (hit == HIT_PLAYER) {
    set_eggman(b, 1);
  }
}

static int wrecker_fight(EggWrecker *b) {
  b->qx += b->vx; b->qy += b->vy;
  b->swing = (b->swing - 4) & 0x3FF;
  if ((b->swing & 0x1FF) == 0x100) {
    b->o.sprite.frameFlags ^= SPRITE_X_FLIP;
    b->s2.frameFlags ^= SPRITE_X_FLIP;
  }
  int bob = s16(xcos(((b->swing + 0x100) * 2) & 0x3FF) >> 13);
  int x = s16(b->worldX + (b->qx >> 8)), y = s16(bob + b->worldY + (b->qy >> 8));
  b->x = x; b->y = y;
  int c_val = xcos(b->swing) >> 6;
  if (c_val > 0xFF) c_val = 0xFF;
  b->ball = c_val + 0x300;

  if (b->laugh) {
    b->laugh = 0;
    set_eggman(b, 1);
  }

  wrecker_hit_test(b, x, y);
  if (b->hits > 3) {
    wrecker_wrecked(b);
    return 1;
  }
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  if (b->s2.variant != 0 && (b->s2.frameFlags & SPRITE_ANIM_OVER)) {
    set_eggman(b, 0);
  }
  wrecker_show(b);

  switch (b->phase) {
    case 0: if (b->swing > 0x100 && b->swing <= 0x300) { b->vx = 0; b->phase++; } break;
    case 1: if (b->swing <= 0x200) { b->vx = 0xC0; b->phase++; } break;
    case 2: if (b->swing <= 0x100) { b->vx = 0; b->phase++; } break;
    case 3: if (b->swing == 0 || b->swing > 0x100) { b->vx = -0xC0; b->phase = 0; } break;
  }
  return 1;
}

static int wrecker_arrive(EggWrecker *b) {
  wrecker_move(b);
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  wrecker_show(b);
  switch (b->phase) {
    case 0:
      if (b->qy >= 32 << 8) { b->qy = 32 << 8; b->vx = -0x100; b->vy = -16; b->phase++; }
      break;
    case 1:
      if (b->qx <= 0) { b->qx = 0; b->vx = 0; b->vy = 0; b->timer = 4; b->phase++; }
      break;
    case 2:
      if (--b->timer == 0) {
        set_eggman(b, 1);
        b->swing = 0x100; b->ball = 0x100; b->timer = 64; b->phase++;
        create_parts(b);
      }
      break;
    case 3:
      if (b->timer > 0) b->timer--;
      if (b->s2.variant != 0 && (b->s2.frameFlags & SPRITE_ANIM_OVER)) set_eggman(b, 0);
      if (b->s2.variant == 0 && b->timer == 0) {
        b->vx = -48; b->moving = 0xFF; b->phase = 0;
        b->main = wrecker_fight;
        boss_cam_pan(act.cam.minY - DISPLAY_HEIGHT / 2, act.cam.maxY + DISPLAY_HEIGHT);
      }
      break;
  }
  return 1;
}

static int wrecker_wait_for_camera(EggWrecker *b) {
  if (b->phase == 0) {
    if (b->worldX - 120 <= cam_x()) {
      act.cam.minX = b->worldX - 120;
      act.cam.maxX = b->worldX - 120;
      b->phase = 1;
    }
  } else if (b->phase == 1) {
    if (b->worldY - 64 <= cam_y()) {
      boss_cam_pan(b->worldY, b->worldY + DISPLAY_HEIGHT);
      b->phase = 2;
    }
  }
  if (act.cam.minX == b->worldX - 120 && act.cam.maxY + DISPLAY_HEIGHT == b->worldY + DISPLAY_HEIGHT) {
    b->phase = 0;
    b->vy = 0x100;
    b->main = wrecker_arrive;
    boss_music(MUSIC_WRECKER);
  }
  return 1;
}

static int egg_wrecker_run(ActTask *t) {
  EggWrecker *b = (EggWrecker *)t->data;
  return b->main(b);
}

static void egg_wrecker_end(ActTask *t) {
  EggWrecker *b = (EggWrecker *)t->data;
  act.bossFlash = 0;
  object_sprite_free(&b->s2);
  object_end(t);
}

ActTask *egg_wrecker_spawn(Slot *slot) {
  EggWrecker *b = OBJECT_NEW(EggWrecker);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->worldX = slot->e.x; b->worldY = slot->e.y;
  b->qx = 0x4000; b->qy = -0x6000;
  b->timer = 120;
  b->main = wrecker_wait_for_camera;

  object_sprite_at(&b->o.sprite, vram_malloc(WRECKER_TILES), ANIM_WRECKER_MOBILE, 0, 22, ENEMY_PRIORITY, 0, 0);
  ActTask *t = boss_task(&b->o, egg_wrecker_run, egg_wrecker_end, PRIORITY_OBJECTS);
  if (!t) return NULL;

  object_sprite_at(&b->s2, vram_malloc(WRECKER_EGGMAN_TILES), ANIM_WRECKER_EGGMAN, 0, 21, ENEMY_PRIORITY, 0, 0);
  return t;
}
