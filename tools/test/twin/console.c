// What stands in for the kit in the function check's test (../twin.mjs): the one thing the program asks of the
// hardware, done as the console does it.
#include "program.h"

/** A byte written to video memory: the console fills both bytes of a background tile's halfword with it, and drops
 *  one written to a sprite's tile. */
void video_put8(u32 address, u8 value) {
  if ((address & 0x1FFFF) >= 0x10000) return;
  *(u16 *)(address & ~1u) = value | value << 8;
}
