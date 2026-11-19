// The twins of the made-up PlayStation program of the tools' tests (../made-up-ps1.mjs), written as a game's C is: each
// names the function of the original it's the twin of in the comment above it, and keeps every value where the
// console keeps it, a place in the console's memory written as its address or named, as the game's
// proof/addresses.json names its values, which the test writes. ps1-twin.mjs checks them against the original.

extern const unsigned values[];
extern unsigned char buffer[];
extern int (*const functions[])(int);

/** 0x80010080: the sum of two numbers */
int sum(int a, int b) {
  return a + b;
}

/** 0x80010088: count bytes of value from to */
void fill(unsigned char *to, int count, int value) {
  while (count != 0) {
    *to++ = value;
    count--;
  }
}

/** 0x800100A8: one of the program's values */
unsigned lookup(int index) {
  return values[index];
}

/** 0x800100C4: */
int twice(int a) {
  return sum(a, a);
}

/** 0x80010104: a word in the scratchpad and a halfword in a register of the sound chip */
void hardware(unsigned value) {
  *(volatile unsigned *)0x1F800010 = value;
  *(volatile unsigned short *)0x1F801C00 = value;
}

/** 0x80010130: a switch */
int pick(unsigned n) {
  switch (n) {
  case 0: return 10;
  case 1: return 20;
  case 2: return 30;
  }
  return 0;
}

/** 0x80010190: reached through the table of functions */
int shine(int a) {
  return 1;
}

/** 0x80010018: the rest, one after another, and the first of the table through its pointer, given what lookup was */
int game_main(void) {
  sum(2, 3);
  fill(buffer, 4, 0x5A);
  twice(21);
  lookup(1);
  return functions[0](1);
}

/** 0x800100E4: the original asks the BIOS */
void bios(void) {
}

/** 0x800100F8: the original reads a word where none starts */
unsigned misaligned(unsigned char *at) {
  return at[1];
}

/** 0x80010118: the original puts a0 in the geometry processor and takes it back */
unsigned gte(unsigned value) {
  return value;
}
