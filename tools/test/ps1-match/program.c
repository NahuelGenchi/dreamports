/* A program of the project's own for match's test on the PlayStation (../ps1-match.mjs): balls, steps and counts, made
   up here, with nothing of any game in it. */
#include "program.h"

static short sSteps[4] = { 3, 5, 7, 11 };
static int sCount;

/* Score, 0x80010100: what a ball of a kind scores, through a switch, whose table of addresses is the file's own */
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

/* Say, 0x80010200: counts a ball and says so, with texts that are the file's own */
void Say(int x) {
  sCount += x;
  gTotal++;
  Print(sCount, "ball");
  Print(x / gFrame, "gone");
}

/* func_80010300 */
int func_80010300(int a, int b) {
  Say(a);
  return Score(a, b) + Score(b, a);
}

/* No comment names what this is the twin of. */
int Nobody(void) {
  return 3;
}
