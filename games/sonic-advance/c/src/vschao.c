// The Chao Hunt stage choice of the VS menus, translated from front/vschao.js (SAT-R's src/game/sa1/ui/game_2_3.c:
// sub_8062F90 and its tasks): after the overview, the picture of the course select with the four stages in a list. The
// first GBA, the parent, picks the stage with Up and Down and A, and the others wait with a "please wait" text in the
// middle and follow the stage it shows. Once the parent has chosen, every GBA answers, and the parent, hearing all of
// them, sends the stage and the places of the Chao (three of the stage's eight, different from each other) and the round
// starts, which isn't in C yet (front.c).
//
// The GBAs tell each other over the link: 0x50 with the stage they show, 0x51 once chosen (the parent) or once they know
// (the others), and 0x52 from the parent, with the stage and the Chao's places.

#include "sa.h"

// the USA copy's numbers: the acts' list, and the waiting text
enum { ANIM_ACTS = 724, ANIM_WAIT = 903 };
// the acts' sprites: their tiles in sprite VRAM and the variant of each. A fifth is made and never shown, with the first
// act's variant's colours for a chosen row (the sprites' palette row 3), and its tiles are the waiting text's
static const uint16_t ACTS[5][2] = { { 0x20, 15 }, { 0x360, 16 }, { 0x6A0, 17 }, { 0x9E0, 18 }, { 0xF00, 0 } };
enum { WAIT_TILES_AT = 0xF00, STAGES = 4, FIRST_STAGE_LEVEL = 14, SHOWN = 0x40 };
enum { CHOOSING = 0x50, CHOSEN = 0x51, STARTING = 0x52 };
// the picture, as the course select's is, one thing after the other from OFFSET_COURSE_SELECT_BACKGROUND: the front
// layer's tiles and map, then this screen's own colours, back layer tiles and map
enum {
  FRONT_TILES = 0, FRONT_TILES_SIZE = 0xE00, FRONT_LAYOUT = 0xD40, FRONT_LAYOUT_SIZE = 0x500,
  PALETTE = 0x35C0, PALETTE_SIZE = 0x200, TILES = 0x37C0, TILES_SIZE = 0x1CC0, LAYOUT = 0x4040, LAYOUT_SIZE = 0x1000,
};

static struct {
  int frame, scroll, stage, chosen, chao;   // unk4C, unk52, unk55, unk57
  Fade fade;
  Sprite acts[5], wait;
  Task *task, *list;
} screen;

// sub_8062EDC: the picture's two layers
static void load_background(uint32_t at) {
  static const UiSlot noLayout;
  ui_gfx_stack_init();
  UiGfx front = { 0 };
  front.uiGfxID = 0x80; front.unk2B = 1; front.layout = &noLayout; front.unk29 = 1; front.unk2A = 0x11;
  front.tiles = at + FRONT_TILES; front.tilesSize = FRONT_TILES_SIZE; front.layout_ = at + FRONT_LAYOUT; front.layoutSize = FRONT_LAYOUT_SIZE;
  load_ui_gfx(&front);
  UiGfx back = { 0 };
  back.uiGfxID = 0x80; back.unk2B = 0; back.layout = &noLayout; back.unk28 = 0; back.unk29 = 0; back.unk2A = 0x15;
  back.tiles = at + TILES; back.tilesSize = TILES_SIZE; back.palette = at + PALETTE; back.paletteSize = PALETTE_SIZE;
  back.layout_ = at + LAYOUT; back.layoutSize = LAYOUT_SIZE;
  load_ui_gfx(&back);
}

static void fade_in(Task *t);
static void show_acts(Task *t);

/** sub_8062F90. */
void create_vs_chao_select(void) {
  vs_reset_missing();
  play_song(SONG_COURSE_SELECTION);
  create_ui_task();
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1D83;
  e.bgCnt[1] = 0x1886;
  for (int i = 0; i < 4; i++) e.bgScroll[i] = 0;
  load_background(OFFSET_COURSE_SELECT_BACKGROUND);

  memset(&screen, 0, sizeof screen);
  screen.scroll = 0x14;
  screen.fade = create_fade(0, 1, 2, 0, 0x200, 1);
  for (int i = 0; i < 5; i++) {
    vs_sprite(&screen.acts[i], ANIM_ACTS, OBJ_VRAM + ACTS[i][0], 0, 0, 0x480, ACTS[i][1], 0x2000);
    update_sprite(&screen.acts[i], 0);
  }
  vs_sprite(&screen.wait, ANIM_WAIT, OBJ_VRAM + WAIT_TILES_AT, 120, 80, 0x80, 0, 0x2000);
  screen.task = create_task(fade_in, &screen, 0x2000, 0, NULL);
  screen.list = create_task(show_acts, &screen, 0x2030, 0, NULL);
  update_sprite(&screen.wait, 0);
  fade_step(&screen.fade);
}

// Task_8063824: the acts, the chosen one a little to the right, and blinking once it is chosen
static void show_acts(Task *t) {
  (void)t;
  for (int i = 0; i < STAGES; i++) {
    Sprite *s = &screen.acts[i];
    if (i == screen.stage) {
      s->palId = (uint8_t)(screen.chosen ? screen.frame & 1 : 1);
      s->x = 104;
    } else {
      s->x = 100;
      s->palId = 0;
    }
    s->y = (int16_t)((i << 5) + 24);
    update_sprite(s, 0);
    display_sprite(s);
  }
}

// the list's scroll, kept with the stage shown, as every one of the choosing tasks keeps it
static void track(void) {
  int stage = screen.stage;
  if (stage > screen.scroll / 24 + 5) screen.scroll = (stage - 5) * 24 - 8;
  else if (stage <= screen.scroll / 24) screen.scroll = stage * 24 - 8;
}

static void choose(Task *t);
static void follow(Task *t);
static void answer(Task *t);
static void start(Task *t);

// Task_80631E8: the picture fades in, for 64 frames or until A
static void fade_in(Task *t) {
  screen.frame++;
  fade_step(&screen.fade);
  if (screen.frame == SHOWN || (e.pressed & KEY_A)) {
    screen.frame = SHOWN;
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    t->main = choose;
  }
}

// Task_80632B4: the parent's Up and Down and A; the others show what the parent does
static void choose(Task *t) {
  int flags = link_flags();
  if (vs_link_lost()) return;

  const uint8_t *parent = link_slot(0);
  int kind = packet_kind(parent);
  if (!(flags & 0x80)) {
    if (kind >= CHOOSING) screen.stage = parent[2];
    update_sprite(&screen.wait, 0);
    display_sprite(&screen.wait);
  }
  screen.frame++;
  if ((flags & 0x80) && STAGES > 1) {
    if (e.repeated & KEY_DOWN) {
      if (screen.stage < 3) screen.stage++;
    } else if (e.repeated & KEY_UP) {
      if (screen.stage != 0) screen.stage--;
    }
  }
  track();
  fade_step(&screen.fade);
  uint8_t *send = link_send();
  set_kind(send, CHOOSING);
  send[2] = (uint8_t)screen.stage;
  if ((flags & 0x80) && (e.pressed & KEY_A)) set_kind(send, CHOSEN);

  if (kind == CHOSEN) {
    screen.chosen = 1;
    t->main = follow;
    play_song(SONG_SELECT);
    stop_song(SONG_COURSE_SELECTION);
    screen.fade.unk4 = 1;
    screen.fade.unk6 = (int16_t)((0x2000 - (screen.fade.unk6 & 0xFFFF)) & 0xFFFF);
  }
}

// Task_80634EC: the others follow the stage, and the picture fades out
static void follow(Task *t) {
  int flags = link_flags();
  if (vs_link_lost()) return;
  const uint8_t *parent = link_slot(0);
  if (!(flags & 0x80) && packet_kind(parent) >= CHOOSING) screen.stage = parent[2];
  screen.frame++;
  fade_step(&screen.fade);
  if (screen.fade.unk6 > 0x1800 && screen.fade.unk4 == 1) t->main = answer;
}

// Task_8063638: every GBA says it knows, and the parent, once it has heard them all, sends the stage and the places
static void answer(Task *t) {
  int flags = link_flags();
  if (vs_link_lost()) return;
  int connections = ctx.vsLink.connections;

  const uint8_t *parent = link_slot(0);
  if (packet_kind(parent) == STARTING) {
    t->main = start;
    screen.chao = parent[3];   // gChaoTasks
  }
  uint8_t *send = link_send();
  if (flags & 0x80) {
    int i = 1;
    while (i < PLAYERS_MAX && (!(connections >> i & 1) || packet_kind(link_slot(i)) == CHOSEN)) i++;
    if (i == PLAYERS_MAX) {
      set_kind(send, STARTING);
      send[2] = (uint8_t)screen.stage;
      // three different places among the eight, as the game draws them
      uint32_t r = front_random();
      send[3] = r & 7;
      r >>= 8;
      if (send[3] == (r & 7)) {
        do r = front_random(); while (send[3] == (r & 7));
      }
      send[4] = r & 7;
      r >>= 8;
      while (send[3] == (r & 7) || send[4] == (r & 7)) r = front_random();
      send[5] = r & 7;
      return;
    }
  }
  set_kind(send, CHOSEN);
  send[2] = (uint8_t)screen.stage;
}

// Task_80638B0: the round starts, for the stage and the places
static void start(Task *t) {
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0;
  e.bldY = 0;
  front_vs_round(FIRST_STAGE_LEVEL + screen.stage, screen.chao & 7);
  destroy_task(screen.list);
  destroy_task(t);
}
