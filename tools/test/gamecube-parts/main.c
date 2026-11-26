// The parts program of the GameCube's test of a game made a part at a time, each part a function at a time
// (../made-up-gamecube.mjs, madeUpGameCubeParts, and ../gamecube-parts.mjs) in C, on the console's kit
// (kit/gamecube/c/): a twin of each function a frame runs, with the original's address in the comment above it, and the
// game's start and step, which call them as the original does. Each twin reads and writes the console at the
// original's addresses through the kit, so the same C is what the function check compares with the original and what
// plays. The test fills in the program's numbers and each function's address, between two at signs.

#include "gamecube.h"

// the frame's count, a word of the console's memory, and the picture's first rows, round the processor's cache
#define COUNT @COUNT_AT@
#define ROWS (@FRAMEBUFFER@ | @UNCACHED@)

// the video interface's registers the program writes, each where it is and its value, in its order
static const uint16_t video[][2] = { @VIDEO@ };

/** @COUNT@: the frame's count moved on */
void count(void) {
  gc_write32(COUNT, gc_read32(COUNT) + 1);
}

/** @RED@: the picture's first rows in a red as bright as the count's low five bits */
void red(void) {
  uint32_t y = (gc_read32(COUNT) & 31) * 4 + 0x40;
  for (uint32_t pair = 0; pair < @PIXELS@ / 2; pair++) gc_write32(ROWS + pair * 4, y << 24 | 0x5A << 16 | y << 8 | 0xF0);
}

/** @BLUE@: the same rows in a blue as bright */
void blue(void) {
  uint32_t y = (gc_read32(COUNT) & 31) * 4 + 0x40;
  for (uint32_t pair = 0; pair < @PIXELS@ / 2; pair++) gc_write32(ROWS + pair * 4, y << 24 | 0xF0 << 16 | y << 8 | 0x6E);
}

/** @STEP@: a frame's work: the count, and red until the count's turn, blue from then on */
void step(void) {
  count();
  if (gc_read32(COUNT) < @TURN@) red();
  else blue();
}

void game_start(void) {
  for (unsigned i = 0; i < sizeof video / sizeof video[0]; i++) gc_write16(0xCC002000 + video[i][0], video[i][1]);
  for (uint32_t pair = 0; pair < @WIDTH@ * @HEIGHT@ / 2; pair++) gc_write32(ROWS + pair * 4, @BACKGROUND@);
  gc_write32(COUNT, 0);
  gc_write32(AI_CONTROL, 0);
}

void game_step(uint32_t buttons) {
  (void)buttons;
  step();
}

void game_draw(void) { gc_show(); }

void game_sound(float *left, float *right, int count) { gc_sound(left, right, count); }
