// A program of the project's own for match's test (../match.mjs): a few functions that between them have what the
// console's compiler writes for real code, which is a loop, calls inside the file and out of it, values kept beside a
// function, a switch through a table of addresses, and a function's address kept as a value.
#include "program.h"

/** Bounce, 0x08000280: `at`, or as far back from `edge` as it went past it. */
s32 Bounce(s32 at, s32 edge) {
  if (at > edge) return edge * 2 - at;
  return at;
}

// StepFor, 0x08000400:
// how far a ball of each kind falls in a frame.
u32 StepFor(u32 kind) {
  switch (kind) {
  case 0: return 1;
  case 1: return 2;
  case 2: return gFrame & 3;
  case 3: return 5;
  case 4: return gUnknown_03000040;
  case 5: return 9;
  }
  return 0;
}

/** MoveBall, 0x08000300: one ball a frame on, counting each time it meets the floor. */
void MoveBall(struct Ball *ball) {
  s32 y = ball->y + ball->speed * StepFor(ball->kind);

  if (y > FLOOR) ball->hits++;
  ball->y = Bounce(y, FLOOR);
  DrawBall(ball);
}

/** MoveBalls, 0x08000200: every ball a frame on, then the frame counted. */
void MoveBalls(void) {
  s32 i;

  for (i = 0; i < BALLS; i++) MoveBall(&gBalls[i]);
  gFrame++;
  sub_8000500(gFrame);
}

/** What moves the balls, 0x080002C0, for whoever calls it later. */
void *Mover(void) {
  return MoveBalls;
}

void sub_8000480(void) {
}

// a function that doesn't say which of the original's it is

void Nobody(void) {
  gFrame = 0;
}
