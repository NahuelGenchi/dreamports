// The parts program of the Nintendo 64's test of a game made a part at a time, each part a function at a time
// (../made-up-n64.mjs, madeUpPartsCartridge, and ../n64-parts.mjs) in C, on the console's kit (kit/n64/c/): a twin of
// each function a frame runs, with the original's address in the comment above it, and the game's start and step,
// which call them as the original does. Each twin reads and writes the console at the original's addresses through
// the kit, so the same C is what the function check compares with the original and what plays. The test fills in the
// program's numbers and each function's address, between two at signs.

#include "n64.h"

// the frame's count, a word of the console's memory, and the picture's first rows, as the processor sees them uncached
#define COUNT @COUNT_AT@
#define ROWS (0xA0000000 + @FRAMEBUFFER@)

/** @COUNT@: the frame's count moved on */
void count(void) {
  n64_write32(COUNT, n64_read32(COUNT) + 1);
}

/** @RED@: the picture's first rows in a red of the count's low five bits */
void red(void) {
  uint16_t colour = (uint16_t)((n64_read32(COUNT) & 31) << 11 | 1);
  for (uint32_t pixel = 0; pixel < @PIXELS@; pixel++) n64_write16(ROWS + pixel * 2, colour);
}

/** @BLUE@: the same rows in a blue of them */
void blue(void) {
  uint16_t colour = (uint16_t)((n64_read32(COUNT) & 31) << 1 | 1);
  for (uint32_t pixel = 0; pixel < @PIXELS@; pixel++) n64_write16(ROWS + pixel * 2, colour);
}

/** @STEP@: a frame's work: the count, and red until the count's turn, blue from then on */
void step(void) {
  count();
  if (n64_read32(COUNT) < @TURN@) red();
  else blue();
}

// a turn of the program's loop: the video interface's interrupt seen, and the frame's work
static void turn(void) {
  if (n64_read32(MI_INTR) & MI_INTR_VI) n64_write32(VI_V_CURRENT, 0);
  step();
}

void game_start(void) {
  // the video interface: 16-bit colour, no filtering, every pixel shown twice across, 240 lines
  n64_write32(VI_ORIGIN, @FRAMEBUFFER@);
  n64_write32(VI_WIDTH, 320);
  n64_write32(VI_V_INTR, 2);
  n64_write32(VI_BURST, 0x03E52239);
  n64_write32(VI_V_SYNC, 0x20D);
  n64_write32(VI_H_SYNC, 0xC15);
  n64_write32(VI_LEAP, 0x0C150C15);
  n64_write32(VI_H_START, 0x006C02EC);
  n64_write32(VI_V_START, 0x002501FF);
  n64_write32(VI_V_BURST, 0x000E0204);
  n64_write32(VI_X_SCALE, 0x200);
  n64_write32(VI_Y_SCALE, 0x400);
  n64_write32(VI_STATUS, 0x3302);
  n64_write32(COUNT, 0);
  // the program's first turn comes before the console shows its first frame, so the start takes it
  turn();
}

void game_step(uint32_t buttons) {
  (void)buttons;
  turn();
}

void game_draw(void) { n64_show(); }
void game_sound(float *left, float *right, int samples) { (void)left; (void)right; (void)samples; }
