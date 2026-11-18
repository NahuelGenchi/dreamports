// Two functions of the function check's test (../twin.mjs) that work the hardware, in a file of their own so the other
// tests' program stays as it is. One reads one of its registers and writes it changed: each call of the original
// starts from the same hardware, so its twin has to as well. The other asks DMA channel 3 for a copy at the next
// V-blank and waits past it, which a twin, with no clock, can't do: the check has to set such calls aside.
#include "program.h"

#ifdef MATCHING
#define BG0CNT_READ() (*(volatile u16 *)0x04000008)
#define BG0CNT_WRITE(value) (*(volatile u16 *)0x04000008 = (value))
#else
#define BG0CNT_READ() gba_io[0x08 >> 1]
#define BG0CNT_WRITE(value) gba_write(0x08, value)
#endif

/** Shift, 0x080005E0: the first background's control a step on, and the frame what it was. */
void Shift(void) {
  u16 was = BG0CNT_READ();
  BG0CNT_WRITE(was + 1);
  gFrame = was;
}

// where play keeps its stage (play.c): only its address is used here
extern u32 gStage;

/** Await, 0x08000620: the stage copied to the frame at the next V-blank, by DMA channel 3, and a wait past it. */
void Await(void) {
  volatile u32 n;

#ifdef MATCHING
  *(volatile u32 *)0x040000D4 = (u32)&gStage;
  *(volatile u32 *)0x040000D8 = (u32)&gFrame;
  *(volatile u32 *)0x040000DC = 0x94000001;   // on, at the V-blank, one word
#endif
  for (n = 0; n < 60000; n++) {
  }
}
