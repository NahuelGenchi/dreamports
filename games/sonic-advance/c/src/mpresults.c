// The round's results screen, for one GBA of the link, translated from the JavaScript version's engine/mpresults.js with
// SAT-R's src/game/sa1/multiplayer/chao_message.c (CreateMultiplayerResultsScreen(1) and its tasks, and sub_803AB60's
// Chao Hunt): a strip for each player, sliding in from alternate sides out of white, with the player's name from this GBA's
// save, a Chao and a message (in the save's language) for how the player did, the winner's, the loser's or the draw music,
// and a sound 45 frames in. Making it counts the round in the save's VS record: the player's own result and, for the
// players this GBA has met, how each did against them. It holds until a player presses A, or 0x707 frames, and every GBA
// follows the first to press it (a packet of kind 0xB0); then the strips slide out, the screen whitens, the save is
// written (14 frames with the interrupts off) and the continue screen follows.

#include "sa.h"
#include "chaohunt.h"

enum {
  TILEMAP = 88, UIGFX_FONT = 0, UIGFX_FONT_COLOURS = 60, STRIP = 40, SLIDE = 16, HOLD = 0x707, SOUND_AT = 0x2D,
  ANIM_CHAO = 885, ANIM_MESSAGE = 883, ANIM_MESSAGE_JP = 897, KIND_DONE = 0xB0, BACKDROP = 0x7B60,   // RGB(0, 27, 30)
  NAME_X = 10, NAME_Y = 20, NAME_STEP = 8, NAME_CHARS = 6, MAX_SCORE = 99,
};
enum { WIN, LOSS, DRAW, NONE = -1 };
static const int MUSIC[3] = { 7, 8, 9 }, SOUND[3] = { 157, 158, 159 };

static struct {
  int count, top, frame, phase;   // unk54, unk50, unk52
  int16_t slide[4];               // unk48: each strip's x
  int result;                     // unk56: this GBA's player's result
  uint8_t chao[4], msg[4];        // unk40: the Chao's and the message's variants for each player
  Sprite sprites[8];
  int spritesMade;
  UiText overBs[PLAYERS_MAX];
  uint32_t vramC;
  Background bg;
} screen;

enum { STARTING, SLIDING_IN, HOLDING, SLIDING_OUT, WHITENING };

static void count_up(uint8_t *at) { if (*at < MAX_SCORE) (*at)++; }

// sub_803AB60's Chao Hunt: the variants, this player's result, and the VS record of the round. Two players, or teams, read
// as a win, a loss or a draw each; more, by how many won
static void outcome(void) {
  const int *ranks = hunt.ranks;
  int id = hunt.id, n = screen.count, foes[4] = { NONE, NONE, NONE, NONE };
  if (n == 2) {
    for (int i = 0; i < n; i++) screen.chao[i] = screen.msg[i] = (uint8_t)(ranks[i] == 0 ? 2 : ranks[i] == 4 ? 4 : 3);
    screen.result = ranks[id] == 0 ? WIN : ranks[id] == 4 ? DRAW : LOSS;
    for (int i = 0; i < n; i++) {
      if (i == id) continue;
      foes[i] = ranks[i] == 0 ? (ranks[id] == 0 ? DRAW : LOSS) : ranks[i] == 4 ? DRAW : ranks[id] == 0 ? WIN : DRAW;
    }
  } else {
    int winners = 0;
    for (int i = 0; i < n; i++) if (ranks[i] == 0) winners++;
    for (int i = 0; i < n; i++)
      screen.chao[i] = screen.msg[i] = (uint8_t)(winners == 1 ? (ranks[i] == 0 ? 2 : 3) : winners == 0 ? 4 : ranks[i] == 0 ? 4 : 3);
    if (winners == 1) {
      screen.result = ranks[id] == 0 ? WIN : LOSS;
      for (int i = 0; i < n; i++) if (i != id) foes[i] = ranks[i] == 0 ? LOSS : ranks[id] == 0 ? WIN : NONE;
    } else if (winners == 0) {
      screen.result = DRAW;
      for (int i = 0; i < n; i++) if (i != id) foes[i] = DRAW;
    } else screen.result = ranks[id] == 0 ? DRAW : LOSS;
  }
  // RecordOwnMultiplayerResult and RecordMultiplayerResult, at most 99 of each
  count_up(&save.bytes[0x425 + screen.result]);
  for (int i = 0; i < n; i++) {
    if (foes[i] == NONE) continue;
    const uint8_t *record = vs_record(i);
    if (record) count_up((uint8_t *)record + 12 + foes[i]);
  }
}

static void run(Task *t);

/** CreateMultiplayerResultsScreen(1), as the round's white completes. */
void create_vs_results(void) {
  memset(&screen, 0, sizeof screen);
  for (int i = 0; i < PLAYERS_MAX; i++) if (ctx.vsLink.connections >> i & 1) screen.count++;
  vs_reset_missing();
  screen.top = screen.count == 2 ? 40 : screen.count == 3 ? 20 : 0;
  outcome();
  screen.slide[0] = -240; screen.slide[1] = 240; screen.slide[2] = -240; screen.slide[3] = 240;
  e.dispCnt = 0x3140;
  e.bgCnt[0] = 0x4803;
  e.bgScroll[0] = 256; e.bgScroll[1] = 0;
  e.winRegs[0] = 0x00F0; e.winRegs[1] = 0x00F0;
  e.winRegs[2] = 0x00A0; e.winRegs[3] = 0x00A0;
  e.winRegs[4] = 0x31; e.winRegs[5] = 0x31;
  e.bldCnt = 0xBF; e.bldY = 0x10;
  memset(gba_vram + 0x1FE0, 0, 0x40);
  e.mapFill[0].value = 0xFF;
  e.mapFill[0].rect[0] = 0; e.mapFill[0].rect[1] = 0; e.mapFill[0].rect[2] = 0xFF; e.mapFill[0].rect[3] = 0x40;
  background_init(&screen.bg);
  screen.bg.graphics.dest = 0; screen.bg.graphics.anim = 0xFF;
  screen.bg.layoutVram = 0x4000; screen.bg.tilemapId = TILEMAP; screen.bg.targetTilesX = 30; screen.bg.targetTilesY = 20;
  draw_background(&screen.bg);
  e.bgPalette[0] = BACKDROP;
  e.flags |= FLAGS_UPDATE_BG_PALETTES;
  play_song(MUSIC[screen.result]);
  create_task(run, &screen, 0x2000, 0, NULL);
}

// sub_803BE0C: each strip's lines show the picture at its own x
static void strips(void) {
  int y = screen.top;
  if (y != 0) fill_lines(0, 0, y, 240, 0);
  for (int i = 0; i < screen.count; i++, y += STRIP) fill_lines(0, y, y + STRIP, ~screen.slide[i] & 0x1FF, -screen.top);
  if (y < SCREEN_H) fill_lines(0, y, SCREEN_H, 240, 0);
}

// Task_803C130 (0x2100): a Chao or a message on its strip
static void sprites_run(void) {
  for (int k = 0; k < screen.spritesMade; k++) {
    Sprite *s = &screen.sprites[k];
    int i = k >> 1;
    s->x = (int16_t)((k & 1 ? 0xA9 : 0x2D) + screen.slide[i]);
    s->y = (int16_t)((k & 1 ? i * STRIP + 0x14 : i * STRIP + 2) + screen.top);
    update_sprite(s, 0);
    display_sprite(s);
  }
}

// sub_803BFE8 (0x2200): six glyphs of the UI font for each player, over its strip, lowercase ones 8 px lower
static void names_run(Task *t) {
  (void)t;
  for (int i = 0; i < screen.count; i++) {
    UiText *o = &screen.overBs[i];
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
static void names_free(Task *t) { (void)t; vram_free(screen.vramC); }

// sub_803BEB8: the UI font with the colours of UI graphics 60, and the names' task
static void make_names(void) {
  UiSlot layout, colourLayout;
  uint32_t fontTiles, fontPalette, colourTiles, colours;
  ui_graphics(UIGFX_FONT, &fontTiles, &fontPalette, &layout);
  ui_graphics(UIGFX_FONT_COLOURS, &colourTiles, &colours, &colourLayout);
  screen.vramC = vram_malloc(0xE0);
  UiGfx g = { 0 };
  g.uiGfxID = UIGFX_FONT; g.unk2B = 1; g.layout = &layout; g.tiles = fontTiles; g.tilesSize = 0x1C00;
  g.palette = colours; g.paletteSize = 0x20; g.unk28 = 1; g.vramC = screen.vramC; g.unk2A = 0xD;
  load_ui_gfx(&g);
  for (int i = 0; i < PLAYERS_MAX; i++) {
    UiText *o = &screen.overBs[i];
    memset(o, 0, sizeof *o);
    o->unkA = NAME_X; o->unkC = NAME_Y; o->unkE = 1; o->unk10 = 1; o->unk12 = 1; o->unk16 = 1;
  }
  create_task(names_run, NULL, 0x2200, 0, names_free);
}

// Task_ChaoMessageInit: a Chao and a message for each player, the UI task and the names
static void start(void) {
  for (int i = 0; i < screen.count; i++) {
    Sprite *c = &screen.sprites[i * 2], *m = &screen.sprites[i * 2 + 1];
    sprite_init(c);
    c->graphics.dest = vram_malloc(40); c->graphics.anim = ANIM_CHAO; c->variant = screen.chao[i];
    c->oamFlags = 16 << 6; c->frameFlags = 0x3000;
    sprite_init(m);
    m->graphics.dest = vram_malloc(26); m->graphics.anim = SAVE_UI_LANGUAGE == 0 ? ANIM_MESSAGE_JP : ANIM_MESSAGE;
    m->variant = screen.msg[i]; m->oamFlags = 16 << 6; m->frameFlags = 0x3000;
  }
  create_ui_task();
  make_names();
  screen.frame = 0;
}

// the strips move in turn, the first to start being the last to stop; true once all are in place
static int move(int out) {
  int done = 0, f = screen.frame, n = screen.count;
#define STEP(i, after, target, by) do { if (after) { if (screen.slide[i] != (target)) screen.slide[i] = (int16_t)(screen.slide[i] + (by)); else done++; } } while (0)
  if (!out) {
    if (n >= 4) STEP(3, f >= 0x10, 0, -SLIDE);
    if (n >= 3) STEP(2, f > 0xA, 0, SLIDE);
    if (n >= 2) { STEP(1, f > 5, 0, -SLIDE); STEP(0, f != 0, 0, SLIDE); }
  } else {
    if (n >= 4) STEP(3, f != 0, 240, SLIDE);
    if (n >= 3) STEP(2, f > 5, -240, -SLIDE);
    if (n >= 2) { STEP(1, f > 10, 240, SLIDE); STEP(0, f >= 0x10, -240, -SLIDE); }
  }
#undef STEP
  return done == n;
}

static void after_write(void) {
  sound_vsync_on();
  create_vs_continue();
}

static void run(Task *t) {
  uint8_t *send = link_send();
  if (screen.phase != WHITENING && vs_link_lost()) return;
  switch (screen.phase) {
    case STARTING:
      start();
      screen.phase = SLIDING_IN;
      // fallthrough
    case SLIDING_IN:   // Task_803B7AC
      screen.frame++;
      if (move(0)) screen.phase = HOLDING;
      if (e.bldY != 0) e.bldY--;
      break;
    case HOLDING: {   // sub_803B944
      screen.frame++;
      int seen = 0;
      for (int i = 0; i < PLAYERS_MAX; i++) if (packet_kind(link_slot(i)) == KIND_DONE) seen = 1;
      if ((e.pressed & KEY_A) || screen.frame > HOLD || seen) {
        screen.phase = SLIDING_OUT; screen.frame = 0;
        if (!seen) { send[0] = KIND_DONE; send[1] = 0; }
      }
      if (screen.frame == SOUND_AT) play_song(SOUND[screen.result]);
      break;
    }
    case SLIDING_OUT:   // sub_803BAD4
      screen.frame++;
      if (move(1)) screen.phase = WHITENING;
      break;
    case WHITENING:   // sub_803BC64
      if ((e.bldY & 0x1F) < 0x10) { e.bldY++; break; }
      destroy_tasks(0, 0xFFFF);
      clear_queues();
      clear_bg_sprites();
      // the save is written with the sound engine and the interrupts off: the white holds for its frames
      stop_all_songs();
      sound_vsync_off();
      if (save_write()) engine_stall(WRITE_FRAMES, after_write);
      else after_write();
      return;
  }
  (void)t;
  strips();
  // the Chao's and the message's tasks, made in the screen's first frame, first run on the next
  sprites_run();
  screen.spritesMade = screen.count * 2;
}
