// The heap in the slow work memory and the heap of the sprites' tiles.
#include "malloc.h"
#include "time.h"

/** EwramInitHeap, 0x08006A74: the slow work memory's heap as one free stretch. */
void EwramInitHeap(void) {
  struct EwramNode *root = (struct EwramNode *)gEwramHeap;

  root->next = NULL;
  root->state = EWRAM_HEAP_SIZE;
  TIME(0x08006A74, 0x08006A7E, BACK, EW, EW);
}

/** VramResetHeapState, 0x08006C0C: every stretch of the sprites' tiles free. */
void VramResetHeapState(void) {
  DMA3_FILL16(0, gVramHeapState, sizeof(gVramHeapState));
  TIME(0x08006C0C, 0x08006C26, BACK, IW, DMA3);
}

/** VramMalloc, 0x08006B54: the first run of free stretches of the sprites' tiles that holds `numTiles`, taken, or
 *  the heap's none when there's no such run. */
void *VramMalloc(u32 numTiles) {
  u16 i, j;
  u32 count = numTiles;

  count = (count + 3) / 4;
  for (i = 0; i < gVramHeapMaxTileSlots / 4; i++) {
    if (gVramHeapState[i] == 0) {
      for (j = 0; j < count; j++) {
        if (i + j >= gVramHeapMaxTileSlots / 4) return gVramHeapNone;
        if (gVramHeapState[i + j] != 0) break;
      }
      if (j == count) {
        gVramHeapState[i] = count;
        return gVramHeapStartAddr + i * VRAM_HEAP_SEGMENT_SIZE;
      }
    } else {
      i = (gVramHeapState[i] - 1) + i;
    }
  }
  return gVramHeapNone;
}

/** VramFree, 0x08006C34: frees the tiles VramMalloc gave, by where they start. */
void VramFree(void *addr) {
  u16 segment;

  if (gVramHeapNone != addr) {
    segment = (u32)((u8 *)addr - gVramHeapStartAddr) / VRAM_HEAP_SEGMENT_SIZE;
    gVramHeapState[segment] = 0;
  }
}
