// The twins of the parts program's functions (../../made-up-n64.mjs, madeUpPartsCartridge), each with the address of
// its original in the comment above it. Each reads and writes the console at the original's addresses through the kit,
// so the same C is what the function check compares with the original and what the game plays. The test fills in the
// program's numbers and each function's address, between two at signs.

#include "n64.h"

// the frame's count, a word of the console's memory, and the picture's first rows, as the processor sees them uncached
#define COUNT 0x80200000
#define ROWS (0xA0000000 + 0x100000)

/** 0x80000524: the frame's count moved on */
void count(void) {
  n64_write32(COUNT, n64_read32(COUNT) + 1);
}

/** 0x80000538: the picture's first rows in a red of the count's low five bits */
void red(void) {
  uint16_t colour = (uint16_t)((n64_read32(COUNT) & 31) << 11 | 1);
  for (uint32_t pixel = 0; pixel < 1280; pixel++) n64_write16(ROWS + pixel * 2, colour);
}

