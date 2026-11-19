/* A program of the project's own for match's test on the PlayStation 2 (../ps2-match.mjs): tiles, weights and counts,
   made up here, with nothing of any game in it. The test writes each function's address in the comment above it, where
   @ and the function's name stand, once Sony's linker has said where it put it. */
#include "program.h"

static short sWeights[4] = { 2, 4, 8, 16 };
static int sCount;

/* Weigh, @Weigh: what a tile of a kind weighs, through a switch, whose table of addresses is the file's own */
int Weigh(int kind, int x) {
  switch (kind) {
    case 0: return x + 2;
    case 1: return x * 5;
    case 2: return x - gFrame;
    case 3: return x / 9;
    case 4: return sWeights[x & 3];
    default: return 0;
  }
}

/* Tell, @Tell: counts a tile and says so, with texts that are the file's own */
void Tell(int x) {
  sCount += x;
  gTotal++;
  Print(sCount, "tile");
  Print(x / gFrame, "done");
}

/* Blend, @Blend: a float sum, with calls to two functions of this file */
float Blend(float a, int b) {
  Tell(b);
  return a * 0.25f + Weigh(b, b);
}

/* No comment names what this is the twin of. */
int Nobody(void) {
  return 3;
}
