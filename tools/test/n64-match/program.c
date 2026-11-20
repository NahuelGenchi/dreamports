/* A program of the project's own for match's test on the Nintendo 64 (../n64-match.mjs): balls, steps, counts and a
   fraction, made up here, with nothing of any game in it. */
#include "program.h"

static short sSteps[4] = { 3, 5, 7, 11 };
static int sCount;

/* Score, 0x80000500: what a ball of a kind scores, through a switch, whose table of addresses is the file's own */
int Score(int kind, int x) {
  switch (kind) {
    case 0: return x + 1;
    case 1: return x * 3;
    case 2: return x - gFrame;
    case 3: return x / 7;
    case 4: return sSteps[x & 3];
    default: return 0;
  }
}

/* Say, 0x80000600: counts a ball and says so, with texts that are the file's own */
void Say(int x) {
  sCount += x;
  gTotal++;
  Print(sCount, "ball");
  Print(x / gFrame, "gone");
}

/* func_80000700 */
int func_80000700(int a, int b) {
  Say(a);
  return Score(a, b) + Score(b, a);
}

/* Speed, 0x80000800: a fraction, as the console's games are full of */
float Speed(float x, int steps) {
  return x * 0.5f + steps;
}

/* No comment names what this is the twin of. */
int Nobody(void) {
  return 3;
}
