// Two functions of the function check's test (../twin.mjs) that work the hardware, in a file of their own so the other
// tests' program stays as it is. One reads one of its registers and writes it changed: each call of the original
// starts from the same hardware, so its twin has to as well. The other asks DMA channel 3 for a copy at the next
// V-blank and waits past it, which a twin, with no clock, can't do: the check has to set such calls aside. A third
// reads a register the console set at power-on, through a register file of its twin's own, as a version that keeps
// the console's registers itself does: the check gives that file the original's registers before each call (#1527).
// A fourth has DMA channel 3 copy from the BIOS, which a DMA can't read: the check sets such a call aside (#1559). A
// fifth reads the line count, waits and reads it again, and whether the display is in the V-blank: a twin has no clock,
// so the check holds both as each call starts, and starts some calls outside the V-blank (#1569). A sixth adds 228 to a
// line of the picture, as m4a's SoundMain does: a call the check starts outside the V-blank starts on one (#1729). A
// seventh reads the display's control, which the console set at power-on, through the kit's display registers: the
// check gives those the original's before each call too (#1773). An eighth has DMA channel 3 copy two words to just
// below its own frame, so the second lands on a local of its own, which a twin keeps elsewhere: the check sets such a
// call aside. A ninth has it copy a word into a local of its own, as a twin does into its own: that call is compared
// (#1874).
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

#ifdef MATCHING
#define SOUNDBIAS (*(volatile u16 *)0x04000088)
#else
// the console's registers, as a version that keeps them itself has them, each at its distance from 0x04000000
u16 console_io[0x210];
#define SOUNDBIAS console_io[0x88 >> 1]
#endif

/** Bias, 0x08000680: the frame the sound's bias, as the console has it. */
void Bias(void) {
  gFrame = SOUNDBIAS;
}

/** Fetch, 0x08000940: a halfword copied to the frame by DMA channel 3, from the BIOS, which a DMA can't read. */
void Fetch(void) {
#ifdef MATCHING
  *(volatile u32 *)0x040000D4 = 0x00000100;
  *(volatile u32 *)0x040000D8 = (u32)&gFrame;
  *(volatile u32 *)0x040000DC = 0x80000001;
#endif
}

#ifdef MATCHING
#define DISPSTAT (*(volatile u16 *)0x04000004)
#define VCOUNT (*(volatile u16 *)0x04000006)
#else
#define DISPSTAT console_io[0x04 >> 1]
#define VCOUNT console_io[0x06 >> 1]
#endif

/** Ready, 0x08000980: how many lines went by in a wait, and 0x100 more outside the V-blank, in the frame. */
void Ready(void) {
  volatile u32 n;
  u16 line = VCOUNT;
  n = 0;
  do n++;
  while (n < 2000);
  if (DISPSTAT & 1) gFrame = (u16)(VCOUNT - line);
  else gFrame = 0x100 + (u16)(VCOUNT - line);
}

/** Picture, 0x08000AC0: the line count in the frame, 228 on for a line of the picture, as m4a's SoundMain counts its
 *  line limit on past the V-blank. */
void Picture(void) {
  u32 line = (u8)VCOUNT;
  if (line < 160) line += 228;
  gFrame = line;
}

#ifdef MATCHING
#define DISPCNT_READ() (*(volatile u16 *)0x04000000)
#else
#define DISPCNT_READ() gba_io[0]
#endif

/** Mode, 0x08000A60: the frame the display's control, as the console has it. */
void Mode(void) {
  gFrame = DISPCNT_READ();
}

/** Sweep, 0x08000700: two words from the frame copied by DMA channel 3 to just below a local of the function's own,
 *  so the second lands on it, and the frame what the local holds then. */
void Sweep(void) {
  volatile u32 local = 1;

#ifdef MATCHING
  *(volatile u32 *)0x040000D4 = (u32)&gFrame;
  *(volatile u32 *)0x040000D8 = (u32)&local - 4;
  *(volatile u32 *)0x040000DC = 0x84000002;   // on, words, two
#endif
  gFrame = local;
}

/** Into, 0x08000740: the frame copied by DMA channel 3 into a local of the function's own, and the frame one on. */
void Into(void) {
  volatile u32 local = 0;

#ifdef MATCHING
  *(volatile u32 *)0x040000D4 = (u32)&gFrame;
  *(volatile u32 *)0x040000D8 = (u32)&local;
  *(volatile u32 *)0x040000DC = 0x84000001;   // on, words, one
#else
  local = gFrame;
#endif
  gFrame = local + 1;
}
