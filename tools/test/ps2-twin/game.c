// The twins of the made-up PlayStation 2 program of the function check's test (program.mjs), written as a game's C is:
// each names the function of the original it's the twin of in the comment above it, and keeps every value where the
// console keeps it, a place in the console's memory written as its address or named, as the game's
// proof/addresses.json names its values, which the test writes. ../ps2-twin.mjs checks them against the original.

#include "ps2.h"

extern const unsigned values[];
extern unsigned char buffer[];
extern int (*const functions[])(int);

/** 0x00100094: the sum of two numbers */
int sum(int a, int b) {
  return a + b;
}

/** 0x0010009C: count bytes of value from to */
void fill(unsigned char *to, int count, int value) {
  while (count != 0) {
    *to++ = value;
    count--;
  }
}

/** 0x001000BC: one of the program's values */
unsigned lookup(int index) {
  return values[index];
}

/** 0x001000D4: */
int twice(int a) {
  return sum(a, a);
}

/** 0x001000F0: a sum of two 64-bit numbers */
long long wide(long long a, long long b) {
  return a + b;
}

// a float as the EE's FPU takes it in: one whose exponent is all ones is the largest there is, with its sign
static float clamped(float value) {
  unsigned bits;
  __builtin_memcpy(&bits, &value, 4);
  if (bits < 0x80000000u ? bits > 0x7F7FFFFFu : bits > 0xFF7FFFFFu) bits = (bits & 0x80000000u) | 0x7F7FFFFFu;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

/** 0x001000F8: a product of two floats, cut towards zero */
float scale(float a, float b) {
  return ee_mul(clamped(a), clamped(b));
}

/** 0x00100104: eight numbers' sum, four of them in t0 to t3 */
int eight(int a, int b, int c, int d, int e, int f, int g, int h) {
  return a + b + c + d + e + f + g + h;
}

/** 0x00100124: a quadword, at the quadwords the two addresses are in */
void copy16(unsigned __int128 *to, const unsigned __int128 *from) {
  *(unsigned __int128 *)((unsigned)to & ~15u) = *(const unsigned __int128 *)((unsigned)from & ~15u);
}

/** 0x00100134: the larger of two numbers */
int biggest(int a, int b) {
  return a > b ? a : b;
}

/** 0x00100140: */
int likely(int a) {
  return a == 0 ? 7 : 3;
}

/** 0x00100158: a switch */
int pick(unsigned n) {
  switch (n) {
  case 0: return 10;
  case 1: return 20;
  case 2: return 30;
  }
  return 0;
}

/** 0x00100198: a word in the scratchpad and in the GS's register that says where the screen is */
void hardware(unsigned value) {
  *(volatile unsigned *)0x70000010 = value;
  *(volatile unsigned *)0x12000070 = value;
}

/** 0x001001E8: reached through the table of functions */
int shine(int a) {
  return 1;
}

/** 0x0010001C: the rest, one after another, and the first of the table through its pointer */
int game_main(void) {
  sum(2, 3);
  fill(buffer, 4, 0x5A);
  twice(21);
  lookup(1);
  wide(40, 2);
  likely(0);
  pick(1);
  return functions[0](1);
}

/** 0x001001B0: the original calls the console's kernel */
void kernel(void) {
}

/** 0x001001C8: the original reads a word where none starts */
unsigned misaligned(unsigned char *at) {
  return at[1];
}

/** 0x001001D4: the original works on vector unit 0 */
unsigned vu0(unsigned value) {
  return value;
}
