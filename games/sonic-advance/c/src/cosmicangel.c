// Cosmic Angel Zone: its row (levels.h), the space background behind it (StageBgUpdate_Zone6Act2), and its gravity
// toggles (kind 109, Task_ToggleGravity). Translated from the JavaScript version's levels.js, engine/backgrounds.js and
// engine/gravity.js (the original's StageInit_Zone6Act2, StageBgUpdate_Zone6Act2 and toggle_gravity.c).

#include "objects.h"

enum {
  MUS_COSMIC_ANGEL = 23,
  BELT_A_START = 120, BELT_A_END = 136,
  BELT_B_START = 176, BELT_B_END = 192,
};

// StageBgUpdate_Zone6Act2: the 512 x 256 map moves across 272 px over the act's width and 72 px down over its height,
// and two 16-line asteroid belts in it drift in opposite directions at 0.5 px per stage-clock frame through H-blank.
static void draw_cosmic_angel(int camX, int camY) {
  int cx = camX - act.cam.wrapped;
  int cy = camY;
  int x = bios_div((cx << 8) + (cx << 4), act.stage.width - SCREEN_W);
  int y = bios_div((cy << 6) + (cy << 3), act.stage.height - SCREEN_H);
  act.cam.bgX = (int16_t)x;
  act.cam.bgY = (int16_t)y;
  e.bgScroll[6] = (uint16_t)x;
  e.bgScroll[7] = (uint16_t)y;
  set_hblank_copy(REG_BG0HOFS + 3 * 4, 4);
  int time = act_stage_time() >> 1;
  for (int line = 0; line < SCREEN_H; line++) {
    int row = y + line, lineX;
    if (row >= BELT_A_START && row < BELT_A_END) lineX = (x - time) & 0x1FF;
    else if (row >= BELT_B_START && row < BELT_B_END) lineX = (time + x) & 0x1FF;
    else lineX = x & 0x1FF;
    put16(e.primary + (uint32_t)line * 4, (uint32_t)lineX);
    put16(e.primary + (uint32_t)line * 4 + 2, (uint32_t)(y & 0xFFFF));
  }
}

static const int PALETTES[] = { 829, 830, 831, 850, 851, 848, 846, 847 };

const Level ACT_COSMIC_ANGEL = {
  .song = MUS_COSMIC_ANGEL, .hudFlash = 90, LEVEL_PALETTES(PALETTES),
  // 512 x 256, priority 3, map 28 (0xE000), character base 2
  .bgCnt = 0x5C0B,
  .drawBackground = draw_cosmic_angel,
};

// --- gravity toggles (kind 109, Task_ToggleGravity) ------------------------------------------------------------------------
// An unseen line that acts when Sonic's centre crosses it, either way, within its span, while he is alive. With d2 above d3
// it lies across, at the entity's y, from x + d0 * 8 for d2 * 8 px, and d1 says what it does: 3 turns gravity over, 4 sets
// it normal, anything else flips it. Otherwise it stands at the entity's x, from y + d1 * 8 for d3 * 8 px, and d0 says: 0
// turns it over, 1 normal, anything else flipped.
typedef struct {
  Object o;
  int across, what, turn, normal;
  double last;
} ToggleGravity;

static double along(const ToggleGravity *tg, const Player *p) { return tg->across ? p->y : p->x; }

static int toggle_gravity_run(ActTask *t) {
  ToggleGravity *tg = (ToggleGravity *)t->data;
  const Entity *en = &tg->o.slot->e;
  Player *p = &act.player;
  if (!p->dead) {
    int line = tg->across ? en->y : en->x;
    double now = along(tg, p);
    int from = tg->across ? en->x + s8(en->d[0]) * 8 : en->y + s8(en->d[1]) * 8;
    int to = from + (tg->across ? en->d[2] : en->d[3]) * 8;
    int at = (int)__builtin_floor(tg->across ? p->x : p->y);
    if (from <= at && to >= at && ((tg->last > line && now < line) || (tg->last < line && now > line))) {
      p->inverted = tg->what == tg->turn ? !p->inverted : tg->what != tg->normal;
    }
    tg->last = now;
  }
  if (off_cam(en->x, en->y)) return 0;
  return 1;
}

ActTask *toggle_gravity_spawn(Slot *slot) {
  ToggleGravity *tg = PLAIN_NEW(ToggleGravity);
  if (!tg) return NULL;
  const Entity *en = &slot->e;
  tg->o.slot = slot;
  tg->o.x = en->x;
  tg->across = en->d[2] > en->d[3];
  tg->what = tg->across ? en->d[1] : en->d[0];
  tg->turn = tg->across ? 3 : 0;
  tg->normal = tg->across ? 4 : 1;
  tg->last = along(tg, &act.player);
  return object_task(&tg->o, toggle_gravity_run, PRIORITY_OBJECTS);
}
