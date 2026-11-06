// The VS lobby, translated from front/lobby.js (SAT-R's src/game/sa1/multiplayer/chao_message.c:
// CreateMultiplayerResultsScreen, with the modes that need no round before them): once the GBAs are linked, a strip for
// each player slides in from alternate sides, out of white, with a Chao and a message for how the player stands against
// the others, and the player's name. Mode 0, the lobby, plays its song, holds the strips for 240 frames (a sound 45 frames
// in) and slides them out, and the game choice follows (gameselect.c). Mode 2, a link that was closed, does the same and
// goes to the title screen.
//
// Each Chao and message is a task of its own, and the names another, all children of the screen's task.

#include "sa.h"

// the USA copy's numbers: the Chao and the messages in Japanese and English, the player rows' tilemap, and the colours
// the names take from the UI graphics
enum { ANIM_AVATAR = 885, TILEMAP = 88, UIGFX_FONT = 0, UIGFX_FONT_COLOURS = 60 };
static const uint16_t ANIM_MESSAGE[2] = { 897, 883 };
enum { STRIP = 0x28, BACKGROUND_COLOUR = 0x7B60, HOLD = 240, SOUND_AT = 0x2D, SLIDE = 0x10 };
enum { NAME_X = 10, NAME_Y = 0x14, NAME_STEP = 8, NAME_CHARS = 6 };
#define WIN(a, b) ((uint16_t)(((a) << 8) | (b)))

typedef struct { Sprite s; int x, y, i; } Mover;
static struct {
  int mode, count, top, frame;   // unk54
  int16_t slide[PLAYERS_MAX];    // unk50, unk48, unk52
  uint8_t variants[PLAYERS_MAX];
  Mover movers[PLAYERS_MAX * 2];
  UiText o;
  uint32_t vramC;
  Background bg;
} screen;

// sub_803AB60, for the modes with no round: each strip's Chao and message
static void variants_of(void) {
  int id = link_id();
  memset(screen.variants, 0, sizeof screen.variants);
  if (screen.mode == 2) {
    memset(screen.variants, 5, (size_t)screen.count);
    return;
  }
  int better = 0, worse = 0;
  for (int i = 0; i < screen.count; i++) {
    if (i == id) continue;
    const uint8_t *r = vs_record(i);
    int wins = r ? r[12] : 0, losses = r ? r[13] : 0;
    if (wins > losses) { screen.variants[i] = 6; better++; }
    else if (wins < losses) { screen.variants[i] = 1; worse++; }
    else screen.variants[i] = 0;
  }
  screen.variants[id] = better > worse ? 1 : better < worse ? 6 : 0;
}

static void init(Task *t);

/** CreateMultiplayerResultsScreen: `mode` 0 for the lobby, 2 for a closed link. */
void create_lobby(int mode) {
  int connections = vs_connections(), count = 0;
  vs_reset_missing();
  for (int i = 0; i < PLAYERS_MAX; i++) count += connections >> i & 1;
  memset(&screen, 0, sizeof screen);
  screen.mode = mode;
  screen.count = count;
  screen.top = count == 2 ? 0x28 : count == 3 ? 0x14 : 0;
  screen.slide[0] = -240; screen.slide[1] = 240; screen.slide[2] = -240; screen.slide[3] = 240;
  variants_of();
  create_task(init, &screen, 0x2000, 0, NULL);
  e.dispCnt = 0x3140;
  e.bgCnt[0] = 0x4803;
  e.bgScroll[0] = 256;
  e.bgScroll[1] = 0;
  e.winRegs[0] = WIN(0, 240);
  e.winRegs[2] = WIN(0, 160);
  e.winRegs[4] = 0x31;
  e.winRegs[5] = 0x31;
  e.bldCnt = 0xBF;
  e.bldY = 0x10;
  memset(gba_vram + 0x1FE0, 0, 0x40);
  e.mapFill[0].value = 0xFF;
  e.mapFill[0].rect[0] = 0; e.mapFill[0].rect[1] = 0; e.mapFill[0].rect[2] = 0xFF; e.mapFill[0].rect[3] = 0x40;
  vs_background(&screen.bg, TILEMAP, 0x4000, 30, 20);
  screen.bg.graphics.anim = 0xFF;
  draw_background(&screen.bg);
  e.bgPalette[0] = BACKGROUND_COLOUR;
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  play_song(mode == 0 ? SONG_VS_LOBBY : SONG_CONNECTION_CLOSED);
}

// LINK_HEARTBEAT: a GBA of the round not heard from for too long is a lost link
static int lost(void) { return vs_link_lost(); }

// Task_803C130: a Chao or a message with its strip
static void move_sprite(Task *t) {
  Mover *m = t->data;
  m->s.x = (int16_t)(m->x + screen.slide[m->i]);
  m->s.y = (int16_t)(m->y + screen.top);
  update_sprite(&m->s, 0);
  display_sprite(&m->s);
}
static void free_mover(Task *t) { vram_free(((Mover *)t->data)->s.graphics.dest); }

static void draw_names(Task *t);
static void free_names(Task *t) { (void)t; vram_free(screen.vramC); }

// sub_803BEB8: the names' glyphs, with the UI font's colours
static void make_names(void) {
  UiSlot layout;
  uint32_t fontTiles, fontPalette, colourTiles, colours;
  UiSlot colourLayout;
  ui_graphics(UIGFX_FONT, &fontTiles, &fontPalette, &layout);
  ui_graphics(UIGFX_FONT_COLOURS, &colourTiles, &colours, &colourLayout);
  screen.vramC = vram_malloc(0xE0);
  ui_gfx_stack_init();
  UiGfx g = { 0 };
  g.uiGfxID = UIGFX_FONT; g.unk2B = 1; g.layout = &layout; g.tiles = fontTiles; g.tilesSize = 0x1C00;
  g.palette = colours; g.paletteSize = 0x20; g.unk28 = 1; g.vramC = screen.vramC; g.unk2A = 0xD;
  load_ui_gfx(&g);
  memset(&screen.o, 0, sizeof screen.o);
  screen.o.unkE = 1; screen.o.unk10 = 1; screen.o.unk12 = 1; screen.o.unk16 = 1;
  create_task(draw_names, &screen.o, 0x2200, 0, free_names);
}

static void slide_in(Task *t);

// Task_ChaoMessageInit: the Chao, the messages and the names, and then the strips slide in
static void init(Task *t) {
  int lang = SAVE_UI_LANGUAGE;
  if (lost()) return;
  for (int i = 0; i < screen.count; i++) {
    Mover *chao = &screen.movers[i * 2], *message = &screen.movers[i * 2 + 1];
    vs_sprite(&chao->s, ANIM_AVATAR, vram_malloc(40), 0, 0, 0x400, screen.variants[i], 0x3000);
    chao->x = 0x2D; chao->y = i * STRIP + 2; chao->i = i;
    create_task(move_sprite, chao, 0x2100, 0, free_mover);
    vs_sprite(&message->s, ANIM_MESSAGE[lang == 0 ? 0 : 1], vram_malloc(26), 0, 0, 0x400, screen.variants[i], 0x3000);
    message->x = 0xA9; message->y = i * STRIP + 0x14; message->i = i;
    create_task(move_sprite, message, 0x2100, 0, free_mover);
  }
  create_ui_task();
  make_names();
  screen.frame = 0;
  t->main = slide_in;
  slide_in(t);
}

// sub_803BFE8: each player's name, a glyph at a time
static void draw_names(Task *t) {
  UiText *o = t->data;
  for (int i = 0; i < screen.count; i++) {
    const uint8_t *name = vs_name(i);
    for (int c = 0; c < NAME_CHARS; c++) {
      char glyph[2] = { (char)name[c], 0 };
      o->unkA = (uint16_t)(screen.slide[i] + NAME_X + c * NAME_STEP);
      o->unkC = (uint16_t)(screen.top + i * STRIP + NAME_Y);
      if (((name[c] - 0x70) & 0xFF) < 26) o->unkC += 8;
      draw_ui_text(glyph, o, 0);
    }
  }
}

// sub_803BE0C: the picture seen through each strip, at its own place
static void show_strips(void) {
  int y = screen.top;
  if (screen.top != 0) fill_lines(0, 0, y, 240, 0);
  for (int i = 0; i < screen.count; i++) {
    fill_lines(0, y, y + STRIP, ~screen.slide[i] & 0x1FF, -screen.top);
    y += STRIP;
  }
  if (y < 160) fill_lines(0, y, 160, 240, 0);
}

static void hold(Task *t);
static void slide_out(Task *t);
static void fade_out(Task *t);

// a strip moves on, unless it is where it goes
static void move(int i, int target, int step, int *done) {
  if (screen.slide[i] != target) screen.slide[i] = s16(screen.slide[i] + step);
  else (*done)++;
}

// Task_803B7AC: the strips slide in one after the other, out of white
static void slide_in(Task *t) {
  if (lost()) return;
  int f = ++screen.frame, done = 0;
  switch (screen.count) {
    case 4:
      if (f >= 0x10) move(3, 0, -SLIDE, &done);
      // falls through
    case 3:
      if (f > 0xA) move(2, 0, SLIDE, &done);
      // falls through
    case 2:
      if (f > 5) move(1, 0, -SLIDE, &done);
      if (f != 0) move(0, 0, SLIDE, &done);
      break;
    default:
      break;
  }
  if (done == screen.count) t->main = hold;
  if (e.bldY != 0) e.bldY--;
  show_strips();
}

// sub_803B944: the strips stay for 240 frames
static void hold(Task *t) {
  if (lost()) return;
  if (++screen.frame >= HOLD) {
    t->main = slide_out;
    screen.frame = 0;
  }
  if (screen.frame == SOUND_AT) play_song(screen.mode == 0 ? SONG_VS_LOBBY_HELLO : SONG_VS_LOBBY_CLOSED);
  show_strips();
}

// sub_803BAD4: and slide out again, the other way round
static void slide_out(Task *t) {
  if (lost()) return;
  int f = ++screen.frame, done = 0;
  switch (screen.count) {
    case 4:
      if (f != 0) move(3, 240, SLIDE, &done);
      // falls through
    case 3:
      if (f > 5) move(2, -240, -SLIDE, &done);
      // falls through
    case 2:
      if (f > 10) move(1, 240, SLIDE, &done);
      if (f >= 0x10) move(0, -240, -SLIDE, &done);
      break;
    default:
      break;
  }
  if (done == screen.count) t->main = fade_out;
  show_strips();
}

// sub_803BC64: white again, and the screen after
static void fade_out(Task *t) {
  (void)t;
  if ((e.bldY & 0x1F) < 0x10) {
    e.bldY++;
    show_strips();
    return;
  }
  destroy_tasks(0, 0xFFFF);
  clear_queues();
  if (screen.mode == 0) create_game_select();
  else {
    vs_leave_link();
    create_title_screen(1);
  }
}
