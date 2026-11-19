// The small PlayStation 2 programs of tools/test/made-up-ps2-gs.mjs as Dreamports in C, on the PlayStation 2's kit in C
// (kit/ps2/c/). Each program is a list of steps, and this does the same steps through the kit as the program does on the
// console: a packet to the GIF, as a DMA transfer to it does, a picture read back from the GS into a packet's place, as
// VIF1's DMA does once the bus is turned round, or half of one of the GS's privileged registers. The test fills in the
// program's memory and steps (ps2-gs.mjs).

#include "ps2.h"

enum { SEND, READ, SCREEN };
// the program's memory, which a read back fills in places, its steps as it starts, its steps for every frame, and which
// of those each frame takes in turn: its first and how many
static uint32_t memory[] = @MEMORY@;
static const uint32_t start[][3] = @START@;
static const uint32_t steps[][3] = @STEPS@;
static const uint32_t turns[][2] = @TURNS@;
static uint32_t turn;

static void run(const uint32_t *step) {
  switch (step[0]) {
  case SEND: gif_send(memory + step[1], step[2] * 16); break;
  case READ:
    gs_screen(GS_BUSDIR, 1);
    gs_read_image(memory + step[1], step[2] * 16);
    gs_screen(GS_BUSDIR, 0);
    break;
  default: gs_screen(step[1], step[2]); break;
  }
}

void game_start(void) {
  // the screen as the program asks for it: circuit 1 alone, the framebuffer at 0 in its format, 640 by 448 on an NTSC
  // screen
  gs_screen(GS_PMODE, 0xFF25);
  gs_screen(GS_PMODE + 4, 0);
  gs_screen(GS_SMODE2, 1);
  gs_screen(GS_SMODE2 + 4, 0);
  gs_screen(GS_DISPFB1, (SCREEN_W / 64) << 9 | @SHOWN@ << 15);
  gs_screen(GS_DISPFB1 + 4, 0);
  gs_screen(GS_DISPLAY1, 656 | 36 << 12 | 3 << 23);
  gs_screen(GS_DISPLAY1 + 4, (SCREEN_W * 4 - 1) | (SCREEN_H - 1) << 12);
  gs_screen(GS_BGCOLOR, 0);
  gs_screen(GS_BGCOLOR + 4, 0);
  for (uint32_t i = 0; i < sizeof start / sizeof start[0]; i++) run(start[i]);
}

void game_step(uint32_t buttons) {
  (void)buttons;
  for (uint32_t i = 0; i < turns[turn][1]; i++) run(steps[turns[turn][0] + i]);
  turn = (turn + 1) % (sizeof turns / sizeof turns[0]);
}

void game_draw(void) { gs_show(); }

void game_sound(float *left, float *right, int count) {
  (void)left;
  (void)right;
  (void)count;
}
