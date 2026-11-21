// The engine's other two heaps: one in the slow work memory, for what a screen keeps, and one of the sprites' tiles
// in video memory.
#ifndef MALLOC_H
#define MALLOC_H
#include "console.h"

#define EWRAM_HEAP_SIZE 0x20080
#define VRAM_HEAP_SEGMENT_SIZE 0x80
#define VRAM_HEAP_SEGMENTS 0x100

/** A stretch of the slow work memory's heap: free when `state` is positive, taken when negative. */
struct EwramNode {
  /* 0x00 */ struct EwramNode *next;
  /* 0x04 */ s32 state;
  /* 0x08 */ u8 space[0];
};

extern u8 gEwramHeap[EWRAM_HEAP_SIZE];
/** What VramMalloc gives when the tiles are all taken. */
extern void *gVramHeapNone;
extern u8 *gVramHeapStartAddr;
extern u16 gVramHeapState[VRAM_HEAP_SEGMENTS];

void EwramInitHeap(void);
void VramResetHeapState(void);
void VramFree(void *addr);

#endif
