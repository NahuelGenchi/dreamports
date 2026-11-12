// Egg Rocket Zone's stage: the launch tower at sunset, then the sky the rocket climbs through and space. Translated from the
// original a function at a time (stage.c StageInit_Zone6Act1, backgrounds/zone_6.inc.c StageBgUpdate_Zone6Act1, camera.c
// HBlankCallback_803FA1C, egg_rocket_transitions.c and checkpoint.c) with the JavaScript version's engine/eggrocket.js beside it;
// every comment names the function it rewrites.

#include "act.h"
#include "objects.h"
#include "bosses.h"

enum {
  MUS_EGG_ROCKET = 22,
  CAM_SCREENBASE_BACK_C = 26,
  // the camera's unk50 flags the background reads: stopped, space next, the sky scrolling
  BG_STOPPED = 0x2000, BG_SPACE = 0x4000, BG_SCROLLING = 0x8000,
  BGCNT_SIZE_MASK = 0xC000, BGCNT_256X256 = 0x0000, BGCNT_256X512 = 0x8000, BGCNT_SCREENBASE_MASK = 0x1F00,
  BG_LINE_OUTSIDE_START = 256,
  DISPCNT_BG0_ON = 0x100,
  BLDCNT_LIGHTEN_BG0 = 0x81,    // BLDCNT_EFFECT_LIGHTEN | BLDCNT_TGT1_BG0
  SE_EXPLOSION = 144,
  SE_CRUMBLING_PLATFORM = 173,
};

// gCamera.unk50 and the layers' scrolls the update leaves for the frame; gBgCntRegs[3] and [0] are the engine's own
static struct { int flags; int bg3X, bg3Y, bg0X, bg0Y, bg0On; } view;

static int stage_time(void) { return act_stage_time(); }
static uint16_t screenbase(int n) { return (uint16_t)(n << 8); }

/** HBlankCallback_803FA1C: BG0 turns 256 × 512 from line 101 on, 160 down the map, and is lightened less and less over
 *  the lines after it */
static void bg0_split(int line) {
  if (line == 100) {
    gba_write(REG_BG0CNT, (uint16_t)((e.bgCnt[0] & ~BGCNT_SIZE_MASK) | BGCNT_256X512));
    gba_write(REG_BG0HOFS, 0);
    gba_write(REG_BG0HOFS + 2, SCREEN_H);
  } else if (line > 101 && line < 134) {
    gba_write(REG_BLDY, (uint16_t)(16 - ((line - 101) >> 1)));
  }
}

static void bg0_on(int x, int y, int callbacks) {
  view.bg0On = 1;
  e.bgCnt[0] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SIZE_MASK) | BGCNT_256X256);
  e.bgCnt[0] = (uint16_t)((e.bgCnt[0] & ~BGCNT_SCREENBASE_MASK) | screenbase(CAM_SCREENBASE_BACK_C));
  view.bg0X = x; view.bg0Y = y;
  e.bldCnt = BLDCNT_LIGHTEN_BG0;
  e.bldY = 0;
  if (callbacks) {
    e.hblankCallbacks[e.numHblankCallbacks++] = bg0_split;
    e.flags |= FLAGS_HBLANK_CALLBACKS;
  }
}

static void bg3_screen(int size, int base) {
  e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SIZE_MASK) | size);
  e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SCREENBASE_MASK) | screenbase(base));
}

/** StageBgUpdate_Zone6Act1 */
static void background_update(void) {
  int x = (int)act.cam.x - act.cam.wrapped, bossIndex = act_checkpoint_index(), t = stage_time();
  view.bg0On = 0;
  if (view.flags & BG_STOPPED) return;
  if (bossIndex == 0) {
    // BG3 is the full 256 × 512 map, on the launch tower in the sunset
    bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C + 2);
    view.bg3X = x * 16 / 816;
    view.bg3Y = BG_LINE_OUTSIDE_START;
  } else if (bossIndex < 3) {
    if (!(view.flags & BG_SCROLLING)) {
      bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C + 2);
      view.bg3X = x * 16 / 816;
      if (((-(t * 2)) & 0x1FF) == view.bg3Y) view.flags |= BG_SCROLLING;
    } else {
      if (((-(t * 2)) & 0x1FF) == 0) e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SIZE_MASK) | BGCNT_256X256);
      e.bgCnt[3] = (uint16_t)((e.bgCnt[3] & ~BGCNT_SCREENBASE_MASK) | screenbase(CAM_SCREENBASE_BACK_C + 2));
      view.bg3X = 0;
      view.bg3Y = (e.bgCnt[3] & BGCNT_SIZE_MASK) == BGCNT_256X256 ? (-(t * 2)) & 0xFF : (-(t * 2)) & 0x1FF;
    }
  } else if (bossIndex == 3) {
    int base = (e.bgCnt[3] & BGCNT_SCREENBASE_MASK) >> 8;
    if (base == CAM_SCREENBASE_BACK_C + 2) {
      view.bg3X = 0; view.bg3Y = (-(t * 2)) & 0xFF;
      if (((-(t * 2)) & 0x1FF) == 256 && (view.flags & BG_SPACE)) {
        view.bg3Y = BG_LINE_OUTSIDE_START;
        bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C + 1);
      }
    } else if (base == CAM_SCREENBASE_BACK_C + 1) {
      view.bg3X = 0; view.bg3Y = (-(t * 2)) & 0x1FF;
      if (((-(t * 2)) & 0x1FF) == 0) {
        view.bg3Y = (-((t * 2 + 256))) & 0x1FF;
        bg3_screen(BGCNT_256X512, CAM_SCREENBASE_BACK_C);
      }
    } else if ((e.bgCnt[3] & BGCNT_SIZE_MASK) == BGCNT_256X512) {
      view.bg3X = 0; view.bg3Y = (-((t * 2) + 256)) & 0x1FF;
      if (view.bg3Y < SCREEN_H) bg0_on(0, (t >> 3) & 0xFF, 1);
      if (view.bg3Y == 0) {
        view.bg3Y = (-(t * 2)) & 0xFF;
        bg3_screen(BGCNT_256X256, CAM_SCREENBASE_BACK_C);
        bg0_on(0, (t >> 1) & 0xFF, 1);
      }
    } else {
      bg3_screen(BGCNT_256X256, CAM_SCREENBASE_BACK_C);
      view.bg3X = 0; view.bg3Y = (t >> 6) & 0xFF;
      bg0_on(0x74, (t >> 3) & 0xFF, 1);
      if (!(view.flags & BG_SCROLLING)) {
        fill_lines(0, 0, 100, (uint16_t)view.bg0X, (uint16_t)view.bg0Y);
        fill_lines(0, 100, 104, 0, SCREEN_H);
        if ((128 - ((t >> 5) & 0x7F)) > 56) {
          fill_lines(0, 104, 160, 0, (uint16_t)(((t >> 5) & 0x7F) + 160));
        } else {
          int v = 232 - ((t >> 5) & 0x7F);
          fill_lines(0, 104, v, 0, (uint16_t)(((t >> 5) & 0x7F) + 160));
          fill_lines(0, v, 160, 0, (uint16_t)(((t >> 5) & 0x7F) + 32));
        }
      }
    }
  }
}

// UpdateCamera's fnBgUpdate, which runs with its RenderMetatileLayers
static void camera_moved(int runs) {
  if (runs) background_update();
}

/** The scrolls the update set, as draw_frame writes the frame's registers */
static void draw(int camX, int camY) {
  (void)camX; (void)camY;
  e.bgScroll[6] = (uint16_t)view.bg3X; e.bgScroll[7] = (uint16_t)view.bg3Y;
  if (view.bg0On) {
    e.dispCnt |= DISPCNT_BG0_ON;
    e.bgScroll[0] = (uint16_t)view.bg0X; e.bgScroll[1] = (uint16_t)view.bg0Y;
  }
}

/** StageInit_Zone6Act1: the stage's background starts 256 × 512, and its palette animations are in the row */
static void start(void) {
  memset(&view, 0, sizeof view);
  e.bgCnt[3] = 0x9C0B;
  int i = act_checkpoint_index();
  if (i > 0) {
    act.cam.minX = 1058;
    view.flags |= BG_SCROLLING;
    e.bgCnt[3] = (uint16_t)(e.bgCnt[3] & ~BGCNT_256X512);
    act.timerReversed = 1;
    act.courseTime = 5 * 3600;
  }
  if (i > 1) {
    act.cam.maxY = 5568 - SCREEN_H;
    act.timerReversed = 1;
    act.courseTime = 5 * 3600;
  }
  if (i > 2) {
    view.flags = (view.flags | BG_SPACE) & ~BG_SCROLLING;
    act.cam.maxY = 3264 - SCREEN_H;
    act.timerReversed = 1;
    act.courseTime = 5 * 3600;
  }
}

// --- the rocket's launch and stage separations (egg_rocket_transitions.c) -------------------------------------------

// CreateEggRocketLaunchScreenShakeEffect: a short vertical shake, camera kept right of the tower, player locked;
// a second later a 5-second random shake with explosions, then 5:00 countdown starts and controls unlock
typedef struct { Object o; int t, rumbling; } EggRocketLaunch;

static int launch_run(ActTask *t) {
  EggRocketLaunch *l = (EggRocketLaunch *)t->data;
  if (!l->rumbling) {
    if (--l->t == 0) {
      l->t = 300;
      l->rumbling = 1;
      boss_shake(0x800, 8, 16, 300, SHAKE_VERTICAL | SHAKE_RANDOM);
    }
    return 1;
  }
  if ((l->t & 0xF) == 0) play_song(SE_EXPLOSION);
  if (--l->t != 0) return 1;
  act.timerReversed = 1;
  act.courseTime = 5 * 3600;
  act.player.ignoreInput = 0;
  return 0;
}

static void launch_start(void) {
  boss_shake(0x800, 8, 16, 10, SHAKE_VERTICAL);
  act.cam.minX = 1058;
  act.player.ignoreInput = 1;
  EggRocketLaunch *l = OBJECT_NEW(EggRocketLaunch);
  if (!l) return;
  l->t = 60;
  l->rumbling = 0;
  object_task(&l->o, launch_run, 0x4000);
}

// CreateEggRocketStageSeparation: camera pans down to worldY, stage below splits and falls away on BG2 with debris and shake,
// then camera pans back up and countdown resets to 5:00. Its five tasks are the phases; a phase that hands over runs the next
// one in the same frame, as Task_8028F20, Task_8029070 and Task_8029194 call the next one's main.
typedef struct { Object o; int worldY, q6, q8, n, phase; } EggRocketSeparation;

enum { SEP_PAN_DOWN, SEP_SLIP, SEP_SLIP_SHAKE, SEP_FALL, SEP_PAN_UP };

// gBgScrollRegs[2]: the front layer's scroll as RenderMetatileLayers leaves it in the camera's task, before this one runs
static int front_h(void) { return (int)act.cam.x & 7; }
static int front_v(void) { return (int)act.cam.y & 7; }

// the stage above worldY stays, the lines from worldY to the falling part's top hold one line of empty map, and the part
// below them shows the stage moved down by q8; once the split is off the screen the lines stop being copied
static void separation_slip(int worldY, int q6, int q8) {
  int16_t top = (int16_t)(worldY + (q6 >> 8) - (int)act.cam.y);
  int16_t below = (int16_t)(worldY + (q8 >> 8) - (int)act.cam.y);
  int splitY = worldY - (int)act.cam.y;
  int h = front_h(), v = front_v();
  if (top > 0 && below < SCREEN_H) {
    if (splitY > 0) {
      fill_lines(2, 0, splitY, h, v);
      scroll_lines(2, splitY, below, h, SCREEN_H + 80);
    } else {
      scroll_lines(2, 0, below, h, SCREEN_H + 80);
    }
    fill_lines(2, below, SCREEN_H, h, v - (q8 >> 8));
  } else {
    e.flags &= ~FLAGS_HBLANK_COPY;
  }
}

static int separation_phase(EggRocketSeparation *s) {
  int worldY = s->worldY;
  switch (s->phase) {
    case SEP_PAN_DOWN:   // Task_8028CE4
      if (++act.cam.shiftY < worldY - (int)act.cam.y + SCREEN_H / 2) return 1;
      throw_nuts_and_bolts();
      boss_shake(0x800, 8, 16, 10, SHAKE_VERTICAL);
      play_song(SE_CRUMBLING_PLATFORM);
      s->phase = SEP_SLIP;
      return 1;
    case SEP_SLIP:       // Task_8028F20
      s->q6 = (s->q6 + 8) & 0xFFFF; s->q8 = (s->q8 + 16) & 0xFFFF;
      if (s->q6 >= 0x400 && (act.checkpointIndex == 2 || ((-(stage_time() * 2)) & 0x1FF) == 0x102)) {
        s->phase = SEP_SLIP_SHAKE; s->n = 0;
        if (act.checkpointIndex == 3) view.flags |= BG_SPACE;
        return separation_phase(s);
      }
      separation_slip(worldY, s->q6, s->q8);
      return 1;
    case SEP_SLIP_SHAKE: // Task_8029070
      s->q6 = (s->q6 + 8) & 0xFFFF; s->q8 = (s->q8 + 16) & 0xFFFF;
      if (s->n++ > 40) {
        s->phase = SEP_FALL; s->n = 0;
        boss_shake(0x800, 8, 16, -1, SHAKE_VERTICAL | SHAKE_HORIZONTAL | SHAKE_RANDOM);
        return separation_phase(s);
      }
      separation_slip(worldY, s->q6, s->q8);
      return 1;
    case SEP_FALL:       // Task_8029194
      s->q8 = (s->q8 + 0x200) & 0xFFFF; s->q6 = (s->q6 + 0x100) & 0xFFFF;
      if ((s->n++ & 0xF) == 0) { throw_nuts_and_bolts(); play_song(SE_EXPLOSION); }
      if ((int16_t)(worldY + (s->q8 >> 8) - (int)act.cam.y) > SCREEN_H) {
        s->phase = SEP_PAN_UP;
        return separation_phase(s);
      }
      separation_slip(worldY, s->q6, s->q8);
      return 1;
    case SEP_PAN_UP: {   // Task_80294A8
      act.cam.shiftY--;
      if ((s->n++ & 0xF) == 0) { throw_nuts_and_bolts(); play_song(SE_EXPLOSION); }
      int splitY = worldY - (int)act.cam.y;
      if ((int)act.cam.y > worldY - SCREEN_H) {
        if (splitY > 0) {
          fill_lines(2, 0, splitY, front_h(), front_v());
          scroll_lines(2, splitY, SCREEN_H, front_h(), SCREEN_H + 80);
        } else {
          scroll_lines(2, 0, SCREEN_H, front_h(), SCREEN_H + 80);
        }
        return 1;
      }
      act.cam.shiftY = 0;
      if (act.checkpointIndex > 1) { act.cam.maxY = 5568 - SCREEN_H; act.clockStopped = 0; act.timerReversed = 1; act.courseTime = 5 * 3600; }
      if (act.checkpointIndex > 2) { act.cam.maxY = 3264 - SCREEN_H; act.clockStopped = 0; act.timerReversed = 1; act.courseTime = 5 * 3600; }
      act.player.ignoreInput = 0;
      e.flags &= ~FLAGS_HBLANK_COPY;
      view.flags &= ~BG_SCROLLING;
      return 0;
    }
  }
  return 0;
}

static int separation_run(ActTask *t) { return separation_phase((EggRocketSeparation *)t->data); }

static void separation_start(int worldY) {
  act.player.ignoreInput = 1; act.player.xsp = 0; act.player.gsp = 0;
  act.cam.maxY = worldY;
  EggRocketSeparation *s = OBJECT_NEW(EggRocketSeparation);
  if (!s) return;
  s->worldY = worldY;
  s->q6 = 0; s->q8 = 0; s->n = 0; s->phase = SEP_PAN_DOWN;
  object_task(&s->o, separation_run, 0x4000);
}

// --- checkpoint entity (checkpoint.c) -------------------------------------------------------------------------------

typedef struct { Object o; int index, passed; } EggRocketCheckpoint;

static int egg_rocket_checkpoint_run(ActTask *t) {
  EggRocketCheckpoint *c = (EggRocketCheckpoint *)t->data;
  const Entity *en = &c->o.slot->e;
  Player *p = &act.player;

  int reached = c->index == 1 ? (int)__builtin_floor(p->x) > en->x : (int)__builtin_floor(p->y) + p->offsetY < en->y + 4;
  if (!c->passed && reached && !p->carried) {
    act_checkpoint_pass(c->index, en->x, en->y - p->offsetY);
    c->passed = 1;
    if (c->index == 1) { p->xsp = 0; p->gsp = 0; launch_start(); }
    if (c->index == 2) { act.clockStopped = 1; separation_start((58 * 96) - 1); }
    if (c->index == 3) { act.clockStopped = 1; separation_start((34 * 96) - 1); }
    if (off_cam(en->x, en->y)) { c->o.slot->live = NULL; return 0; }
    return 1;
  }
  if (off_cam(en->x, en->y)) { c->o.slot->live = NULL; return 0; }
  return 1;
}

ActTask *egg_rocket_checkpoint_spawn(Slot *slot) {
  const Entity *en = &slot->e;
  EggRocketCheckpoint *c = OBJECT_NEW(EggRocketCheckpoint);
  if (!c) return NULL;
  c->o.slot = slot;
  c->o.x = en->x;
  c->index = s8(en->d[0]);
  c->passed = c->index <= act_checkpoint_index();
  return object_task(&c->o, egg_rocket_checkpoint_run, PRIORITY_OBJECTS);
}

// StageInit_Zone6Act1's palette animations: 839 and 842 both step one row of the stage palette, 840 and 841 each their own
static const int PALETTES[] = { 839, 840, 841, 842 };

const Level ACT_EGG_ROCKET = {
  .song = MUS_EGG_ROCKET, .hudFlash = 4, LEVEL_PALETTES(PALETTES),
  .bgCnt = 0x9A0B,   // 256 × 512, priority 3, character base 2, and the background's map from screen 26 (0xD000) on: its four screens
  .start = start, .cameraMoved = camera_moved, .drawBackground = draw,
  .ownsBlend = 1,
};
