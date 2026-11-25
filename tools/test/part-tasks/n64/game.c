// The twins of the parts program's functions (../../made-up-n64.mjs, madeUpPartsCartridge), each with the address of
// its original in the comment above it. Each reads and writes the console at the original's addresses through the kit,
// so the same C is what the function check compares with the original and what the game plays. The test fills in the
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

/** @BONUS@: the word after the count set to one */
void bonus(void) {
  n64_write32(COUNT + 4, 1);
}

