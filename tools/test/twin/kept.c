// A function of the function check's test (../twin.mjs) whose last branch goes by a value it keeps on its own stack,
// in a file of its own so the other tests' program stays as it is. The check has to follow the value through the
// stack to aim at the branch, and then to try another value than the nearest that fits, as the nearest is the one
// value that ends the function before the branch (#2059). It needs the frame, the ball's height and its speed each
// just so at once, and puts the frame back to 0 every time, so made-up calls almost never get that far.
#include "program.h"

/** Stash, 0x08000780: the ball's count of hits to 55 when the frame, the ball's height and its speed are each just
 *  so and a count the function keeps on its stack, one more than how far along the ball is, is below none as a signed
 *  halfword, and the frame back to 0. A count of none ends it first, and none is the nearest count that isn't above
 *  none. */
void Stash(void) {
  volatile u32 count;
  u32 frame = gFrame;

  gFrame = 0;
  count = (u16)(gBall.x + 1);
  if (frame != 0x00C0FFEE || gBall.y != 321 || gBall.speed != 77) return;
  if (count == 0) return;
  if ((s16)count <= 0) gBall.hits = 55;
}
