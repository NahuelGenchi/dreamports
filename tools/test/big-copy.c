// A Dreamport in C of a made-up PlayStation 2 disc of several gigabytes (big-copy.mjs), with nothing from any game in
// it: each frame it reads one of the sectors the disc marks with a colour, far apart on it, which the page's address
// lists as marks=30,1048576,…, and paints the screen that colour. It runs under kit_run, as a game that reads its disc
// does, so a sector the page hasn't fetched yet pauses the frame partway until it has (kit/c/disc.h). Every other frame
// it tells the drive which sector comes next, as a game's drive is told to seek before it reads, so the page fetches
// that one between frames.

#include "ps2.h"
#include "disc.h"

static uint32_t marks[8], mark_count;

static uint8_t sector[2048];

static void paint(uint32_t colour) {
  gs_write(GS_FRAME_1, (uint64_t)(SCREEN_W / 64) << 16);
  gs_write(GS_SCISSOR_1, (uint64_t)(SCREEN_W - 1) << 16 | (uint64_t)(SCREEN_H - 1) << 48);
  gs_write(GS_XYOFFSET_1, 0);
  gs_write(GS_TEST_1, 0x30000);
  gs_write(GS_ZBUF_1, 1ull << 32);
  gs_write(GS_PRMODECONT, 1);
  gs_write(GS_PRIM, 6);
  gs_write(GS_RGBAQ, colour);
  gs_write(GS_XYZ2, 0);
  gs_write(GS_XYZ2, (uint64_t)(SCREEN_W << 4) | (uint64_t)(SCREEN_H << 4) << 16);
}

// the game's own loop, which never returns, as a console's game's doesn't
static void play(void) {
  for (uint32_t frame = 0;; frame++) {
    uint32_t mark = marks[frame % mark_count];
    if (kit_disc_read(mark, 1, 0, sizeof sector, sector) != 1) paint(0x80000000u);
    else paint((uint32_t)sector[0] | (uint32_t)sector[1] << 8 | (uint32_t)sector[2] << 16 | 0x80000000u);
    if (frame % 2) kit_disc_ahead(marks[(frame + 1) % mark_count], 16);
    kit_wait_frame();
  }
}

void game_start(void) {
  // the marked sectors, from the page's address
  const char *words = kit_start_point("marks");
  while (words && *words && mark_count < 8) {
    uint32_t n = 0;
    while (*words >= '0' && *words <= '9') n = n * 10 + (uint32_t)(*words++ - '0');
    marks[mark_count++] = n;
    if (*words++ != ',') break;
  }
  if (!mark_count) marks[mark_count++] = 0;
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_DISPFB1, (SCREEN_W / 64) << 9);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);
}

void game_step(uint32_t buttons) {
  (void)buttons;
  kit_run(play);
}

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {}
