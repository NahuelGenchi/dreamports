// A function of the function check's test (../twin.mjs) in ARM code written by hand into the cartridge
// (cartridge.mjs, withLinked), as a game's link interrupt is: it reads what the link port received from the first
// console and compares it with the mark that a packet starts. Only the hardware writes that register, so the check
// has to give it, and the mark is a number only a comparison in ARM code names (#1815).
#include "program.h"

// the console's registers, as a version that keeps them itself has them, each at its distance from 0x04000000
u16 console_io[0x210];

/** Linked, 0x08000D80: the frame 1 when the first console sent the mark that a packet starts. */
void Linked(void) {
  if (console_io[0x120 >> 1] == 0xFEFE) gFrame = 1;
}
