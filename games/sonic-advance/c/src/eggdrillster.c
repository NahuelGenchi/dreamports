// X Zone's second boss, the Egg Drillster (SAT-R decompilation, src/game/sa1/stage/enemies/boss_x2_egg_drillster.c):
// Eggman's drill car from Sonic 2's Emerald Hill Zone. Positions are in whole pixels, its offsets and speeds in
// 1/256 px.

#include "xbosses.h"

#define WHEELS 4
#define DRILLSTER_WIDTH 72

typedef struct EggDrillster EggDrillster;
typedef int (*EggDrillsterFn)(EggDrillster *b);

struct EggDrillster {
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
  int window;
  int laugh;
  EggDrillsterFn main;
};

static void set_eggman(EggDrillster *b, int variant) {
  b->s2.variant = (uint8_t)variant;
  b->s2.prevVariant = 0xFF;
}

static void drillster_draw(EggDrillster *b) {
  int sx = b->x - cam_x(), sy = b->y - cam_y();
  boss_display(&b->o.sprite, sx, sy);
  boss_display(&b->s2, sx, sy);
}

static void drillster_show(EggDrillster *b) {
  b->window = boss_flashing(&b->flash);
  if (b->window) {
    b->o.sprite.frameFlags |= OBJ_WINDOW;
    act.bossFlash = 1;
  } else {
    b->o.sprite.frameFlags &= ~SPRITE_OBJ_MODE;
    act.bossFlash = 0;
  }
  drillster_draw(b);
}

static void drillster_move(EggDrillster *b) {
  b->qx += b->vx; b->qy += b->vy;
  b->x = s16(b->worldX + (b->qx >> 8));
  b->y = s16(b->worldY + (b->qy >> 8));
}

// Subtasks: Drill, Wheel
typedef struct { Object o; EggDrillster *b; int wait, flying, qx, qy, vx, wx, wy; } Drill;
typedef struct { Object o; EggDrillster *b; int i, off, qx, qy, vx, vy, wx, wy; } Wheel;

// the drill and the wheels face the way the body does and flash white with it (sub_803673C, Task_Drill)
enum { BODY_FLAGS = SPRITE_X_FLIP | SPRITE_OBJ_MODE };

static int drill_run(ActTask *t) {
  Drill *d = (Drill *)t->data;
  EggDrillster *b = d->b;
  if (d->flying) {
    d->qx += d->vx;
    int x = s16(d->wx + (d->qx >> 8)), y = s16(d->wy + (d->qy >> 8));
    if (b->hits < 4 && boss_shot(&d->o.sprite, x, y) == HIT_PLAYER) b->laugh = 1;
    update_sprite(&d->o.sprite, 0);
    boss_display(&d->o.sprite, x - cam_x(), y - cam_y());
    return ((uint32_t)(d->qx + (192 << 8))) <= ((uint32_t)(DISPLAY_WIDTH + 2 * DRILLSTER_WIDTH) << 8);
  }
  d->o.sprite.frameFlags = (d->o.sprite.frameFlags & ~BODY_FLAGS) | (b->o.sprite.frameFlags & BODY_FLAGS);
  int x = b->x, y = b->y;
  if (b->moving != 0 && b->hits <= 3 && boss_shot(&d->o.sprite, x, y) == HIT_PLAYER) b->laugh = 1;
  update_sprite(&d->o.sprite, 0);
  boss_display(&d->o.sprite, x - cam_x(), y - cam_y());
  if (b->hits > 2) {
    int sonic = enemy_sonic_x(), fire = 0;
    if (d->wait != 0) d->wait--;
    else if (d->o.sprite.frameFlags & SPRITE_X_FLIP) fire = x + 16 < sonic;
    else fire = x - 16 > sonic;
    if (b->hits > 3) fire = 1;
    if (fire) {
      d->qx = b->qx; d->qy = b->qy; d->wx = b->worldX; d->wy = b->worldY;
      d->vx = (d->o.sprite.frameFlags & SPRITE_X_FLIP) ? 3 << 8 : -3 << 8;
      d->flying = 1;
    }
  }
  return 1;
}

static int wheel_run(ActTask *t) {
  Wheel *w = (Wheel *)t->data;
  EggDrillster *b = w->b;
  if (!w->off) {
    w->o.sprite.frameFlags = (w->o.sprite.frameFlags & ~BODY_FLAGS) | (b->o.sprite.frameFlags & BODY_FLAGS);
    if (b->vx != 0) update_sprite(&w->o.sprite, 0);
    boss_display(&w->o.sprite, b->x - cam_x(), b->y - cam_y());
    if (b->hits > 3) { w->wx = b->x; w->wy = b->y; w->off = 1; }
    return 1;
  }
  int x = w->wx, y = w->wy;
  if (b->phase != 0) {
    if (w->vx == 0) {
      static const int16_t WHEEL_SPEEDS[4][2] = { {-0xC0, -0x1B0}, {-0x100, -0x180}, {0x100, -0x190}, {0xE0, -0x1A0} };
      w->vx = WHEEL_SPEEDS[w->i][0]; w->vy = WHEEL_SPEEDS[w->i][1];
      if (b->o.sprite.frameFlags & SPRITE_X_FLIP) w->vx = -w->vx;
    }
    w->vy = s16(w->vy + 24);
    w->qx += w->vx; w->qy += w->vy;
    x = s16(w->wx + (w->qx >> 8)); y = s16(w->wy + (w->qy >> 8));
    int d = terrain_tile_floor(x, y + 30, 1, 8);
    if (d < 0) {
      w->qy += d << 8;
      w->vy = s16(-w->vy + 4);
      if (x < cam_x() - 32 || x > cam_x() + DISPLAY_WIDTH + 32) return 0;
    }
  }
  update_sprite(&w->o.sprite, 0);
  boss_display(&w->o.sprite, x - cam_x(), y - cam_y());
  return 1;
}

static void create_drillster_parts(EggDrillster *b) {
  Drill *d = OBJECT_NEW(Drill);
  if (d) {
    d->b = b; d->wait = 60; d->flying = 0;
    object_sprite_at(&d->o.sprite, vram_malloc(16), ANIM_DRILLSTER_DRILL, 0, 20, ENEMY_PRIORITY, 0, 0);
    object_task(&d->o, drill_run, 0x2100);
  }
  for (int i = 0; i < WHEELS; i++) {
    Wheel *w = OBJECT_NEW(Wheel);
    if (w) {
      w->b = b; w->i = i; w->off = 0; w->vx = 0; w->vy = 0;
      object_sprite_at(&w->o.sprite, vram_malloc(DRILLSTER_WHEEL_TILES), ANIM_DRILLSTER_WHEEL, i, (i & 1) ? 23 : 19, ENEMY_PRIORITY, 0, 0);
      object_task(&w->o, wheel_run, 0x2100 | i);
    }
  }
}

static int drillster_falling(EggDrillster *b);

static void drillster_wrecked(EggDrillster *b) {
  b->flash = 0; act.bossFlash = 0; b->o.sprite.frameFlags &= ~(uint32_t)OBJ_WINDOW;
  // it drops from where it is, its timer left as the fight left it, and the camera stays put (sub_8036150)
  b->phase = 0; b->vx = 0; b->vy = 0;
  set_eggman(b, 2);
  act.cam.minX = (int)act.cam.x;
  act.cam.maxX = (int)act.cam.x;
  play_song(SE_EXPLOSION);
  world_add_score(1000);
  b->main = drillster_falling;
  drillster_falling(b);
}

static int drillster_falling(EggDrillster *b) {
  if (b->phase < 2) {
    if (b->phase == 0) b->vy += 0x10;
    drillster_move(b);
    if (!(b->timer & 7)) x_boss_debris(b->x, b->y + 16, b->y + 32);
    update_sprite(&b->o.sprite, 0);
    update_sprite(&b->s2, 0);
    drillster_draw(b);
  }
  switch (b->phase) {
    case 0: {
      b->timer = (b->timer - 1) & 0xFFFF;
      int d = terrain_tile_floor(b->x, b->y + 20, 1, 8);
      if (d < 0) {
        b->qy += d << 8;
        b->vy = 0;
        b->timer = 240;
        b->phase++;
      }
      break;
    }
    case 1:
      if (--b->timer == 0) {
        boss_egg_mobile(b->x, b->y);
        boss_music(MUSIC_END_DRILLSTER);
        for (int i = 0; i < 4; i++) {
          static const int8_t EX[4][2] = { {16, -16}, {-16, -16}, {20, 16}, {-20, 16} };
          boss_explosion((b->x + EX[i][0]) << 8, (b->y + EX[i][1]) << 8);
        }
        b->timer = 240;
        b->phase++;
      }
      break;
    case 2:
      if (--b->timer == 0) {
        act.cam.minY = 0;
        act.cam.maxY = act.stage.height - DISPLAY_HEIGHT;
        act.cam.maxX = act.stage.width - DISPLAY_WIDTH;
        b->o.slot->gone = 1;
        return 0;
      }
      break;
  }
  return 1;
}

static void drillster_hit_test(EggDrillster *b, int x, int y) {
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

// across the arena at 2 px a frame, to 192 px either side of where it stopped, waiting half a second at each end
// (Task_8035F70)
enum { DRILLSTER_REACH = 192 };

static int drillster_fight(EggDrillster *b) {
  drillster_move(b);
  int x = b->x, y = b->y;
  if (b->laugh) {
    b->laugh = 0;
    set_eggman(b, 1);
  }
  drillster_hit_test(b, x, y);
  if (b->hits > 3) {
    drillster_wrecked(b);
    return 1;
  }
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  if (b->s2.variant != 0 && (b->s2.frameFlags & SPRITE_ANIM_OVER)) set_eggman(b, 0);
  drillster_show(b);

  switch (b->phase) {
    case 0:
      if (b->qx <= -DRILLSTER_REACH << 8) { b->vx = 0; b->timer = 30; b->phase++; }
      break;
    case 1:
      if (--b->timer == 0) {
        b->vx = 0x200; b->phase++;
        b->o.sprite.frameFlags |= SPRITE_X_FLIP;
        b->s2.frameFlags |= SPRITE_X_FLIP;
      }
      break;
    case 2:
      if (b->qx >= DRILLSTER_REACH << 8) { b->vx = 0; b->timer = 30; b->phase++; }
      break;
    case 3:
      if (--b->timer == 0) {
        b->vx = -0x200; b->phase = 0;
        b->o.sprite.frameFlags &= ~SPRITE_X_FLIP;
        b->s2.frameFlags &= ~SPRITE_X_FLIP;
      }
      break;
  }
  return 1;
}

static int drillster_arrive(EggDrillster *b) {
  drillster_move(b);
  update_sprite(&b->o.sprite, 0);
  update_sprite(&b->s2, 0);
  drillster_show(b);
  switch (b->phase) {
    case 0:
      if (b->qx <= 0) { b->qx = 0; b->vx = 0; b->vy = 0; b->timer = 15; b->phase++; }
      break;
    case 1:
      if (--b->timer == 0) { set_eggman(b, 1); b->phase++; }
      break;
    case 2:
      if (b->s2.frameFlags & SPRITE_ANIM_OVER) { set_eggman(b, 0); b->timer = 15; b->phase++; }
      break;
    case 3:
      if (--b->timer == 0) { b->vx = -0x200; b->moving = 0xFF; b->phase = 0; b->main = drillster_fight; }
      break;
  }
  return 1;
}

static int drillster_wait_for_camera(EggDrillster *b) {
  if (b->phase == 0) {
    if (b->worldX - 120 <= cam_x()) {
      act.cam.minX = b->worldX - 120 - 32;
      act.cam.maxX = b->worldX + 120 + 32 - DISPLAY_WIDTH;
      b->phase = 1;
    }
  } else if (b->phase == 1) {
    if (b->worldY - 224 <= cam_y()) {
      boss_cam_pan(b->worldY - DISPLAY_HEIGHT, b->worldY);
      b->phase = 2;
    }
  }
  if (b->phase == 2) {
    b->phase = 0;
    b->vx = -0x180;
    create_drillster_parts(b);
    b->main = drillster_arrive;
    boss_music(MUSIC_DRILLSTER);
  }
  return 1;
}

static int egg_drillster_run(ActTask *t) {
  EggDrillster *b = (EggDrillster *)t->data;
  return b->main(b);
}

static void egg_drillster_end(ActTask *t) {
  EggDrillster *b = (EggDrillster *)t->data;
  act.bossFlash = 0;
  object_sprite_free(&b->s2);
  object_end(t);
}

ActTask *egg_drillster_spawn(Slot *slot) {
  if (act_checkpoint_index() != 0) return NULL;
  EggDrillster *b = OBJECT_NEW(EggDrillster);
  if (!b) return NULL;
  b->o.slot = slot;
  b->o.x = slot->e.x;
  b->worldX = slot->e.x; b->worldY = slot->e.y;
  b->qx = 0xC020; b->qy = -40 << 8;
  b->timer = 120;
  b->main = drillster_wait_for_camera;

  object_sprite_at(&b->o.sprite, vram_malloc(DRILLSTER_TILES), ANIM_DRILLSTER, 0, 22, ENEMY_PRIORITY, 0, 0);
  ActTask *t = boss_task(&b->o, egg_drillster_run, egg_drillster_end, PRIORITY_OBJECTS);
  if (!t) return NULL;

  object_sprite_at(&b->s2, vram_malloc(DRILLSTER_EGGMAN_TILES), ANIM_DRILLSTER_EGGMAN, 0, 21, ENEMY_PRIORITY, 0, 0);
  return t;
}
