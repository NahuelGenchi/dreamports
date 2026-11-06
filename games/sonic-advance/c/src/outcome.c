// The Multi-Pak outcome screen, translated from front/outcome.js (SAT-R's src/game/shared/multiplayer/
// communication_outcome.c: CreateMultipackOutcomeScreen): what came of the connection. A message runs across the screen
// under a black band and, on a success, one Chao for each GBA linked sits in the middle. It lasts 120 frames, from a fade
// in over 16, and then fades out to black: a success goes on to the lobby (lobby.c), an error leaves the link and returns
// to the main menu.

#include "sa.h"

// by the outcome (0 success, 1 error): the Chao's animation and variant, the message's width and the tilemap, the USA
// copy's numbers, and the sound
static const uint16_t ANIM_CHAO[2] = { 887, 884 }, VARIANT_CHAO[2] = { 0, 0 }, MESSAGE_WIDTH[2] = { 44, 42 }, TILEMAP[2] = { 78, 79 };
static const int SONGS[2] = { SONG_CONNECTION_SUCCESS, SONG_CONNECTION_ERROR };
enum { ANIM_MESSAGES = 889, ANIM_BLACK_RECT = 860, CHAO_STEP = 0x2A, HOLD = 0x78 };
static const int16_t CHAO_X[5] = { 0, 99, 78, 57, 36 };
#define WIN(a, b) ((uint16_t)(((a) << 8) | (b)))

static struct {
  int outcome, count, qMessage, hold;
  Sprite chao, message, band;
  Background bg;
} screen;

static void run(Task *t);

/** CreateMultipackOutcomeScreen: `outcome` is 0 for a connection made and 1 for an error. */
void create_multipack_outcome(int outcome) {
  e.dispCnt = 0x3140;
  e.bgCnt[0] = 0x803;
  e.bgScroll[0] = 0x100;
  e.bgScroll[1] = 0;
  e.winRegs[0] = WIN(0, 240);
  e.winRegs[2] = WIN(0, 160);
  e.winRegs[4] = 0x31;
  e.winRegs[5] = 0x31;
  e.bldCnt = 0xBF;
  e.bldY = 0x10;

  int connections = vs_connections(), count = 0;
  for (int i = 0; i < 4; i++) count += connections >> i & 1;
  memset(&screen, 0, sizeof screen);
  screen.outcome = outcome;
  screen.count = count;
  screen.hold = HOLD;
  vs_sprite(&screen.chao, ANIM_CHAO[outcome], OBJ_VRAM + 0x300, 93, 85, 0x3C0, VARIANT_CHAO[outcome], 0x2000);
  vs_sprite(&screen.message, ANIM_MESSAGES, OBJ_VRAM, 0, 32, 0x3C0, outcome + 8, 0x2000);
  vs_sprite(&screen.band, ANIM_BLACK_RECT, OBJ_VRAM + 0x180, 0, 21, 0x400, 0, 0x2000);
  create_task(run, &screen, 0x2000, 0, NULL);
  update_sprite(&screen.chao, 0);
  update_sprite(&screen.message, 0);
  update_sprite(&screen.band, 0);
  vs_background(&screen.bg, TILEMAP[outcome], 0x4000, 30, 20);
  draw_background(&screen.bg);
  play_song(SONGS[outcome]);
}

/** LinkCommunicationError: the error outcome. */
void create_link_error(void) { create_multipack_outcome(1); }

// Task_MultipackOutcomeScreen
static void run(Task *t) {
  (void)t;
  Sprite *c = &screen.chao;
  update_sprite(c, 0);
  if (screen.outcome == 0) {
    c->x = CHAO_X[screen.count];
    for (int n = screen.count; n > 0; n--) {
      display_sprite(c);
      c->x = (int16_t)(c->x + CHAO_STEP);
    }
  } else {
    display_sprite(c);
  }

  int width = MESSAGE_WIDTH[screen.outcome];
  Sprite *m = &screen.message;
  screen.qMessage += 0x80;
  if (screen.qMessage > width << 8) screen.qMessage -= width << 8;
  update_sprite(m, 0);
  for (int v = (screen.qMessage >> 8) - width; 251 - v > -11; v += width) {
    m->x = (int16_t)(251 - v);
    display_sprite(m);
  }
  Sprite *band = &screen.band;
  band->y = 21;
  for (int i = 0; i < 8; i++) {
    band->x = (int16_t)(i << 5);
    display_sprite(band);
  }

  if (screen.hold != 0) {
    screen.hold--;
    if (e.bldY != 0) e.bldY--;
    return;
  }
  if (e.bldY != 0x10) { e.bldY++; return; }

  destroy_tasks(0, 0xFFFF);
  clear_queues();
  if (screen.outcome == 0) {
    create_lobby(0);
  } else {
    vs_leave_link();
    create_main_menu(1);
  }
}
