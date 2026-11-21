// The heap in the slow work memory and the heap of the sprites' tiles.
#include "malloc.h"

/** EwramInitHeap, 0x08006A74: the slow work memory's heap as one free stretch. */
void EwramInitHeap(void) {
  struct EwramNode *root = (struct EwramNode *)gEwramHeap;

  root->next = NULL;
  root->state = EWRAM_HEAP_SIZE;
}

/** VramResetHeapState, 0x08006C0C: every stretch of the sprites' tiles free. */
void VramResetHeapState(void) { DMA3_FILL16(0, gVramHeapState, sizeof(gVramHeapState)); }

/** VramFree, 0x08006C34: frees the tiles VramMalloc gave, by where they start. */
void VramFree(void *addr) {
  u16 segment;

  if (gVramHeapNone != addr) {
    segment = (u32)((u8 *)addr - gVramHeapStartAddr) / VRAM_HEAP_SEGMENT_SIZE;
    gVramHeapState[segment] = 0;
  }
}
