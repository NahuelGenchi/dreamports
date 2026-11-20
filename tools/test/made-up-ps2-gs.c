// The small PlayStation 2 programs of tools/test/made-up-ps2-gs.mjs as Dreamports in C, on the PlayStation 2's kit in C
// (kit/ps2/c/). Each program is a list of steps, and this does the same steps through the kit as the program does on the
// console: a packet to the GIF, as a DMA transfer to it does, a picture read back from the GS into a packet's place, as
// VIF1's DMA does once the bus is turned round, half of one of the GS's privileged registers written or read into a
// packet's place, a wait for one of their bits, or a handler for the GS's interrupt. The test fills in the program's
// memory and steps (ps2-gs.mjs).

#include "ps2.h"

enum { SEND, READ, SCREEN, PEEK, WAIT_SET, WAIT_CLEAR, HANDLER };
// the program's memory, which a read back fills in places, its steps as it starts, its steps for every frame, and which
// of those each frame takes in turn: its first and how many
static uint32_t memory[] = @MEMORY@;
static const uint32_t start[][3] = @START@;
static const uint32_t steps[][3] = @STEPS@;
static const uint32_t turns[][2] = @TURNS@;
static uint32_t turn, counter;

// the program's handler for the GS's interrupt: it clears SIGNAL in CSR when it's set, and counts it in a word
static void counted(void) {
  uint32_t signal = gs_screen_read(GS_CSR) & 1;
  gs_screen(GS_CSR, signal);
  memory[counter] += signal;
}

// waits for a bit of a privileged register, as the program does, which the kit has set or cleared by now
static void wait(uint32_t address, uint32_t mask, int set) {
  for (int i = 0; i < 1000 && ((gs_screen_read(address) & mask) != 0) != set; i++) {}
}

static void run(const uint32_t *step) {
  switch (step[0]) {
  case SEND: gif_send(memory + step[1], step[2] * 16); break;
  case READ:
    gs_screen(GS_BUSDIR, 1);
    gs_read_image(memory + step[1], step[2] * 16);
    gs_screen(GS_BUSDIR, 0);
    break;
  case SCREEN: gs_screen(step[1], step[2]); break;
  case PEEK: memory[step[2]] = gs_screen_read(step[1]); break;
  case WAIT_SET: case WAIT_CLEAR: wait(step[1], step[2], step[0] == WAIT_SET); break;
  default:
    counter = step[2];
    gs_on_interrupt(counted);
    break;
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
