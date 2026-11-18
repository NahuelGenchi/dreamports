// Two functions of the function check's test (../twin.mjs), in a file of their own so the other tests' program stays
// as it is: one gives back a value, and the other keeps what it gave. A twin of the first that gives back nothing
// leaves the same memory, and still differs, as its caller uses what the original gives back.
#include "program.h"

/** Count, 0x08000580: the frame one on, given back. */
u32 Count(void) {
  return ++gFrame;
}

/** Keep, 0x080005A0: what Count gives back, kept as the ball's count of hits. */
void Keep(void) {
  gBall.hits = Count();
}
