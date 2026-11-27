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

/** EwramMalloc, 0x08006A88: allocates `req` bytes from the slow work memory's heap, rounded up to words, or returns
 *  gVramHeapNone if no free stretch fits. */
void *EwramMalloc(u32 req) {
#ifdef MATCHING
  register struct EwramNode *cur asm("r3");
#else
  struct EwramNode *cur;
#endif
  struct EwramNode *next, *following;
  u32 words = req;

  words = (words + 3) >> 2;
  if (words == 0) return gVramHeapNone;
  words = words * 4 + sizeof(struct EwramNode);
  cur = (struct EwramNode *)gEwramHeap;

  while (1) {
    if (words <= (u32)cur->state) {
      if ((s32)words == cur->state) {
        cur->state = -(s32)words;
        return cur->space;
      }
      if ((s32)(words + sizeof(struct EwramNode)) <= cur->state) {
        next = (struct EwramNode *)((u8 *)cur + words);
        next->next = cur->next;
        next->state = cur->state - words;
        cur->next = next;
        cur->state = -(s32)words;
        return cur->space;
      }
    }
    following = cur->next;
    if (following == NULL) return gVramHeapNone;
    cur = following;
  }
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
    TIME(0x08006C34, 0x08006C52, BACK, EW, IW, IW);
  }
}
