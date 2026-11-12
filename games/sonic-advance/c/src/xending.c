// X Zone's two endings, from Egg X's landing to the stage results (SAT-R decompilation,
// src/game/sa1/stage/enemies/boss_x3_egg_x.c): the normal one (sub_803A594 and Task_Strc10_803891C), and the way to
// the Moon Zone (sub_803A54C and Task_8038554), which the rule in unlock.js chooses.

#include "xbosses.h"
#include "results.h"

int moon_opens(void) {
  return ctx.character == 0 && act.stage.level >= LEVEL_X_ZONE && (SAVE_CHAOS_EMERALDS == ALL_EMERALDS)
    && save_unlocked_level(0) > LEVEL_X_ZONE && save_unlocked_level(1) > LEVEL_X_ZONE
    && save_unlocked_level(2) > LEVEL_X_ZONE && save_unlocked_level(3) > LEVEL_X_ZONE
    && !(save_unlocked_level(0) == MOON_BEATEN && ctx.startLevel == LEVEL_X_ZONE);
}

// Sparkle
typedef struct {
  Object o;
  Transform tf;
  int x, y, vx, vy, scale, life;
} Sparkle;

static int sparkle_run(ActTask *t) {
  Sparkle *sp = (Sparkle *)t->data;
  sp->x += sp->vx; sp->y += sp->vy;
  if (sp->scale > 0x800) sp->scale--;
  int size = sp->scale >> 4;
  update_sprite(&sp->o.sprite, 0);
  sp->tf.x = (int16_t)(0xEF4 + (sp->x >> 8) - cam_x());
  sp->tf.y = (int16_t)(0x120 + (sp->y >> 8) - cam_y());
  sp->tf.rotation = 0;
  sp->tf.qScaleX = size; sp->tf.qScaleY = size;
  sp->o.sprite.frameFlags = (sp->o.sprite.frameFlags & ~(uint32_t)SPRITE_ROT_SCALE) | (uint32_t)boss_matrix() | SPRITE_ROT_SCALE_ENABLE;
  transform_sprite(&sp->o.sprite, &sp->tf);
  display_sprite(&sp->o.sprite);
  return --sp->life != 0;
}

static void spawn_sparkle(int anim, int vx, int vy) {
  Sparkle *sp = OBJECT_NEW(Sparkle);
  if (!sp) return;
  sp->x = 0; sp->y = 0; sp->vx = vx; sp->vy = vy;
  sp->scale = 0x1000; sp->life = 600;
  object_sprite_at(&sp->o.sprite, vram_malloc(anim == ANIM_MOON_SPARKLE_A ? MOON_SPARKLE_A_TILES : MOON_SPARKLE_B_TILES), anim, 0, 23, ENEMY_PRIORITY, 0, 0);
  object_task(&sp->o, sparkle_run, 0x2100);
}

// TransformFlash
typedef struct {
  Object o;
  int life;
} Flash;

static int flash_run(ActTask *t) {
  Flash *fl = (Flash *)t->data;
  update_sprite(&fl->o.sprite, 0);
  boss_display(&fl->o.sprite, (int)act.player.x - cam_x(), (int)act.player.y - cam_y());
  return --fl->life != 0;
}

static void spawn_transform_flash(void) {
  Flash *fl = OBJECT_NEW(Flash);
  if (!fl) return;
  fl->life = 15;
  object_sprite_at(&fl->o.sprite, vram_malloc(SUPER_SONIC_FLASH_TILES), ANIM_SUPER_SONIC_TRANSFORM, 1, 17, ENEMY_PRIORITY, 0, 0);
  object_task(&fl->o, flash_run, 0x2100);
}

// Normal Ending
typedef struct {
  Object o;
  int interval, count, tick, timer, phase;
} NormalEnding;

static int normal_ending_run(ActTask *t) {
  NormalEnding *e = (NormalEnding *)t->data;
  Player *p = &act.player;
  e->tick = (e->tick + 1) & 0xFFFF;
  if (!(e->tick & 3)) {
    // the original takes the remainders of signed numbers, so half of these land left of or above the screen's corner
    int x = s16((int32_t)act_random() % DISPLAY_WIDTH + cam_x());
    int y = s16((int32_t)act_random() % DISPLAY_HEIGHT + cam_y());
    x_boss_debris(x, y + 16, y + 32);
  }
  e->count = (e->count + 1) & 0xFFFF;
  if (e->count >= e->interval) {
    e->count = 0;
    e->interval -= 2;
    if (e->interval < 4) e->interval = 4;
    int x = s16((int)p->x - 48), y = s16((int)p->y);
    x_boss_debris(x, y + 16, y + 32);
  }

  switch (e->phase) {
    case 0:
      if (e->timer != 0) e->timer--;
      else if (!p->air) {
        p->heldRight = 1;
        act.cam.maxX = act.stage.width - DISPLAY_WIDTH;
        e->phase++;
      }
      break;
    case 1:
      if (p->x >= 3072) {
        xzone_disp.active = 1;
        xzone_disp.dispCnt = 0x2000;
        xzone_disp.win0h = DISPLAY_WIDTH;
        xzone_disp.win0v = DISPLAY_HEIGHT;
        xzone_disp.winIn = 0x3F3F;
        xzone_disp.bldCnt = 0xBF;
        xzone_disp.bldY = 0;
        e->timer = 0;
        e->phase++;
      }
      break;
    case 2:
      if (++e->timer > 128) {
        p->heldRight = 0;
        p->xsp = 0; p->ysp = 0; p->gsp = 0;
        p->invisible = 1;
        act_tasks_destroy(0x2000, 0x2FFF);
        act.hud.gone = 1;   // the HUD's task is one of those (0x2180)
        xzone_disp.bldCnt &= ~0x10;
        results_start(LEVEL_X_ZONE, act.ringCount, act.courseTime, 1, 1);
        return 0;
      }
      xzone_disp.bldY = e->timer >> 3;
      act.cam.shiftX = -(e->timer >> 1);
      break;
  }
  return 1;
}

void normal_ending_start(void) {
  NormalEnding *e = PLAIN_NEW(NormalEnding);
  if (!e) return;
  e->interval = 32; e->count = 0; e->tick = 0; e->timer = 120; e->phase = 0;
  object_task(&e->o, normal_ending_run, 0x1FFF);
}

// Moon Ending
typedef struct {
  Object o;
  int phase, timer, speed, angle, height;
} MoonEnding;

static int moon_ending_run(ActTask *t) {
  MoonEnding *m = (MoonEnding *)t->data;
  Player *p = &act.player;
  switch (m->phase) {
    case 0:
      if (m->timer != 0) m->timer--;
      else if (!p->air) {
        p->heldRight = 1;
        act.cam.maxX = act.stage.width - DISPLAY_WIDTH;
        m->phase++;
      }
      break;
    case 1:
      if (p->x >= 3680) {
        p->heldRight = 0;
        p->heldLeft = 1;
        m->timer = 12;
        spawn_sparkle(ANIM_MOON_SPARKLE_A, -8, 4);
        boss_cam_bounds(act.cam.minY, act.cam.maxY + DISPLAY_HEIGHT, (int)p->x - 96, act.cam.maxX + DISPLAY_WIDTH);
        m->phase++;
      }
      break;
    case 2:
      if (--m->timer == 0) {
        p->heldLeft = 0;
        p->state = PS_MOON_GAZE;
        p->override = 1;
        m->timer = 60;
        m->phase++;
      }
      break;
    case 3:
      if (--m->timer == 0) {
        results_start(LEVEL_X_ZONE, act.ringCount, act.courseTime, 0, 0);
        m->timer = results_wait_total();
        m->phase++;
      }
      break;
    case 4:
      if (--m->timer == 0) {
        p->state = PS_MOON_TRANSFORM;
        p->override = 1;
        p->y -= 16;
        m->angle = 0; m->speed = 0; m->timer = 0;
        m->phase++;
      }
      break;
    case 5:
      if (++m->timer == 0x22) spawn_transform_flash();
      if (m->timer > 0x99) {
        p->state = PS_MOON_FLY;
        m->speed = 256;
        m->timer = 120;
        m->phase++;
      } else if (m->timer > 33) {
        m->angle = (m->angle + 0x10) & 0x3FF;
        p->y = m->height + (SINE[m->angle] >> 11);
      } else if (m->timer > 0x1F) {
        m->speed += 0x400;
        p->y += (double)m->speed / 256.0;
        m->height = (int)p->y;
      } else if (m->timer > 0x19) {
        m->speed -= 0x180;
        p->y += (double)m->speed / 256.0;
      }
      break;
    case 6:
      if (p->x <= 3872) {
        m->speed += 0x80;
        p->x += (double)m->speed / 256.0;
      } else {
        p->hidden = 1;
      }
      if (--m->timer == 0) {
        spawn_sparkle(ANIM_MOON_SPARKLE_B, -12, 6);
        m->timer = 0xB4;
        m->phase++;
      }
      break;
    case 7:
      if (--m->timer == 0) {
        xzone_disp.active = 1;
        xzone_disp.dispCnt = 0x2000;
        xzone_disp.win0h = DISPLAY_WIDTH;
        xzone_disp.win0v = DISPLAY_HEIGHT;
        xzone_disp.winIn = 0x3F3F;
        xzone_disp.winOut = 0x3F3F;
        xzone_disp.bldCnt = 0xBF;
        xzone_disp.bldY = 0;
        m->timer = 0;
        m->phase++;
      }
      break;
    case 8:
      if (++m->timer > 0x80) {
        act_tasks_destroy(0x2000, 0x2FFF);
        act_go_to_next_level();
        return 0;
      }
      xzone_disp.bldY = m->timer >> 3;
      break;
  }
  return 1;
}

void moon_ending_start(void) {
  MoonEnding *m = PLAIN_NEW(MoonEnding);
  if (!m) return;
  m->phase = 0; m->timer = 420; m->speed = 0; m->angle = 0; m->height = 0;
  object_task(&m->o, moon_ending_run, 0x1FFF);
}
