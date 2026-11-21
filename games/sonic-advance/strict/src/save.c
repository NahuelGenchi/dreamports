// What the game keeps on the cartridge.
#include "save.h"

/** 0x08012F78: the sum of a sector's words, all but the last, which keeps it. */
u32 SaveSectorSum(void *sector) {
  u32 sum = 0;
  u32 i;

  for (i = 0; i < SAVE_SECTOR_SIZE - 4; i += 4) sum += *(u32 *)((u8 *)sector + i);
  return sum;
}
