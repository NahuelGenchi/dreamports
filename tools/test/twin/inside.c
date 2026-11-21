// A function of the function check's test (../twin.mjs) that writes through a pointer in the struct it's given, in a
// file of its own so the other tests' program stays as it is. The pointer to the struct is 0 in the memory the test
// calls it from, so only a call given a struct made up takes its paths (../../gba/twin-shapes.mjs), and one of them
// only when the struct's own pointer points into it, at its count, as C allows: the write then changes the count it
// read before.
#include "program.h"

/** A strip: where its number goes, how many it counts for, and the number. */
struct Strip {
  u16 *out;
  u16 count;
  u16 fill;
};

extern struct Strip *gStrip;
extern u32 gSpilled;

/** Pour, 0x08000F80: puts the strip's number where it points, and adds its count to what's spilled, or 7 when that
 *  changed its count. */
void Pour(void) {
  struct Strip *strip = gStrip;
  u16 count = strip->count;
  *strip->out = strip->fill;
  if (strip->count != count) gSpilled += 7;
  else gSpilled += count;
}
