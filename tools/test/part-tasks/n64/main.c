// The Dreamport's own side of the parts program: what the kit calls, which does what the program's start and its loop
// do, and nothing of the program's functions, which are the twins in game.c. The test writes a function that has no
// twin yet as one that does nothing, after the declarations, so the game builds on every day of it, and fills in the
// program's numbers between two at signs.

#include "n64.h"

void count(void);
void red(void);
void blue(void);
void bonus(void);

@MISSING@

// a turn of the program's loop: the video interface's interrupt seen, and the frame's work
static void turn(void) {
  if (n64_read32(MI_INTR) & MI_INTR_VI) n64_write32(VI_V_CURRENT, 0);
  count();
  if (n64_read32(@COUNT_AT@) >= @BONUS@) bonus();
  if (n64_read32(@COUNT_AT@) < @TURN@) red();
  else blue();
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
  n64_write32(@COUNT_AT@, 0);
  // the program's first turn comes before the console shows its first frame, so the start takes it
  turn();
}

void game_step(uint32_t buttons) {
  (void)buttons;
  turn();
}

void game_draw(void) { n64_show(); }
void game_sound(float *left, float *right, int samples) { (void)left; (void)right; (void)samples; }
