// A program of the project's own for the function check's test (../twin.mjs): a few functions that between them do
// what the check has to follow. One reads values from memory and decides by them, one reads the cartridge's data, one
// takes more than the registers hold, one writes bytes to video memory, and two keep a function's address in memory
// and call through it.
#include "program.h"

/** Fall, 0x08000200: the ball a frame further down, stopped at the floor and counted each time it gets there. */
void Fall(void) {
  s32 y = gBall.y + gBall.speed;

  if (y > FLOOR) {
    y = FLOOR;
    gBall.hits++;
  }
  gBall.y = y;
}

/** Scale, 0x08000240: a value as many times as its kind counts for, from the cartridge's own list, and the frame. */
u32 Scale(u32 value, u8 kind) {
  return value * gSteps[kind & 3] + gFrame;
}

/** Sum, 0x08000280: five numbers, the fifth of which comes on the stack, kept as the frame. */
s32 Sum(s32 a, s32 b, s32 c, s32 d, s16 e) {
  gFrame = a + b - c + d * 2 + e;
  return gFrame;
}

/** Paint, 0x080002C0: one byte into a background tile and one into a sprite tile, where the frame says. */
void Paint(u8 colour) {
  u32 at = gFrame & 0xFF;

  VIDEO8(TILES + at, colour);
  VIDEO8(SPRITE_TILES + at, colour);
}

/** Step, 0x08000300: the frame a little on. */
void Step(void) {
  gFrame += 3;
}

/** Skip, 0x08000320: the frame a lot on. */
void Skip(void) {
  gFrame += 100;
}

/** Choose, 0x08000340: which of the two is run next. */
void Choose(u32 which) {
  gHandler = which & 1 ? Step : Skip;
}

/** Run, 0x08000380: whatever was chosen, if anything was. */
void Run(void) {
  if (gHandler) gHandler();
}
