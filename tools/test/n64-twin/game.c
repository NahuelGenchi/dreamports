// The twins of the made-up Nintendo 64 program of the tools' tests (../made-up-n64.mjs), written as a game's C is: each
// names the function of the original it's the twin of in the comment above it, and keeps every value where the
// console keeps it, a place in the console's memory written as its address or named, as the game's
// proof/addresses.json names its values, which the test writes. Each number in the console's memory is read and written
// as the console keeps it, its highest byte first, with nothing in the C to say so. n64-twin.mjs checks them against
// the original.

extern const unsigned values[];
extern unsigned char buffer[];
extern int (*const functions[])(int);

/** 0x8000047C: the sum of two numbers */
int sum(int a, int b) {
  return a + b;
}

/** 0x80000484: count bytes of value from to */
void fill(unsigned char *to, int count, int value) {
  while (count != 0) {
    *to++ = value;
    count--;
  }
}

/** 0x800004A4: one of the program's values */
unsigned lookup(int index) {
  return values[index];
}

/** 0x800004C0: */
int twice(int a) {
  return sum(a, a);
}

/** 0x800004DC: a in the high half of a 64-bit number and b added, kept at to */
long long wide(unsigned a, int b, long long *to) {
  long long made = (long long)((unsigned long long)a << 32) + b;
  *to = made;
  return made;
}

/** 0x800004F4: 1 for 0 and 2 for anything else */
int likely(int a) {
  return a == 0 ? 1 : 2;
}

/** 0x80000508: the sum of two floats, kept after them */
void addf(float *at) {
  at[2] = at[0] + at[1];
}

/** 0x80000520: a double squared, kept after it */
void square(double *at) {
  at[1] = at[0] * at[0];
}

/** 0x80000534: */
float mulf(float a, float b) {
  return a * b;
}

/** 0x80000540: */
double addd(double a, double b) {
  return a + b;
}

/** 0x8000054C: a float given after a whole number, as its bits */
unsigned bits(int a, float b) {
  union { float f; unsigned u; } as = { b };
  return as.u;
}

/** 0x80000578: a register of the video interface and the RSP's data memory */
void hardware(unsigned value) {
  *(volatile unsigned *)0xA440000C = value;
  *(volatile unsigned *)0xA4000010 = value;
}

/** 0x800005AC: a switch */
int pick(unsigned n) {
  switch (n) {
  case 0: return 10;
  case 1: return 20;
  case 2: return 30;
  }
  return 0;
}

/** 0x8000060C: reached through the table of functions */
int shine(int a) {
  return 1;
}

/** 0x80000418: the rest, one after another, and the first of the table through its pointer, given what lookup was */
int game_main(void) {
  sum(2, 3);
  fill(buffer, 4, 0x5A);
  twice(21);
  lookup(1);
  return functions[0](1);
}

/** 0x8000055C: the original reads a word where none starts */
unsigned misaligned(unsigned char *at) {
  return at[1];
}

/** 0x80000568: the original reads the cartridge */
unsigned cartridge(void) {
  return 0;
}

/** 0x80000590: the original makes a syscall */
void trap(void) {
}
