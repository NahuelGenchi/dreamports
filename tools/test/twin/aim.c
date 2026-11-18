// A function of the function check's test (../twin.mjs) with a branch made-up calls almost never take, in a file of
// its own so the other tests' program stays as it is: it needs four values each just so at once, and puts the frame
// back to 0 every time, so a call that goes on from the one before gets no nearer. Calls aimed at it take it.
#include "program.h"

/** Unlock, 0x080006C0: the ball's count of hits to 99 when the frame, where the ball is and its speed are each just
 *  so, and the frame back to 0. */
void Unlock(void) {
  u32 frame = gFrame;

  gFrame = 0;
  if (frame == 0x00C0FFEE && gBall.x == 1234 && gBall.y == 321 && gBall.speed == -77) gBall.hits = 99;
}
