// The twins of the made-up GameCube program of the tools' tests (../made-up-gamecube.mjs), written as a game's C is:
// each names the function of the original it's the twin of in the comment above it, and keeps every value where the
// console keeps it, a place in its memory or a register of its hardware written as its address. Each number in the
// console's memory is read and written as the console keeps it, its highest byte first, with nothing in the C to say
// so. The addresses and numbers, each a name between two at signs, are the program's own, a function's address by its
// name and a number by its name in capitals, which gamecube-twin.mjs writes in from it before it checks the twins
// against the original.

#define FRAMEBUFFER (@FRAMEBUFFER@u | @UNCACHED@u)
#define WIDTH @WIDTH@
#define HEIGHT @HEIGHT@
#define SQUARE_Y @SQUARE_Y@
#define SQUARE_SIZE @SQUARE_SIZE@

/** @fill@: count words of value from to, as the count register counts them, so a count of 0 goes round all of its values */
void fill(unsigned *to, unsigned value, unsigned count) {
  do {
    *to++ = value;
  } while (--count != 0);
}

/** @square@: the square, left pixels from the left edge, its even lines in one colour and its odd lines in the other */
void square(unsigned left, unsigned even, unsigned odd) {
  unsigned *at = (unsigned *)(FRAMEBUFFER + SQUARE_Y * WIDTH * 2 + (left >> 1) * 4);
  for (int line = SQUARE_SIZE; line != 0; line--) {
    for (int pair = 0; pair < SQUARE_SIZE / 2; pair++) at[pair] = even;
    unsigned other = even;
    even = odd;
    odd = other;
    at += WIDTH * 2 / 4;
  }
}

/** @bits@: a word's 32 bits as blocks, the highest first */
void bits(unsigned word, unsigned *at) {
  for (int bit = 32; bit != 0; bit--) {
    unsigned colour = (int)word < 0 ? @ON@u : @OFF@u;
    for (int line = @BIT_LINES@; line != 0; line--) {
      unsigned *row = at + (@BIT_LINES@ - line) * (WIDTH * 2 / 4);
      row[0] = colour;
      row[1] = colour;
      row[2] = colour;
      row[3] = colour;
    }
    at += @BIT_WIDTH@ / 2;
    word <<= 1;
  }
}

/** @wait@: until the beam is at line 100 of either field, having left it first */
void wait(void) {
  volatile unsigned short *beam = (volatile unsigned short *)0xCC00202C;
  while (*beam == @LINE@ || *beam == @LINE@ + 263) {
  }
  while (*beam != @LINE@ && *beam != @LINE@ + 263) {
  }
}

/** @setup@: the video interface's registers from the program's table, the picture, the controller and the tone */
void setup(void) {
  for (const unsigned short *table = (const unsigned short *)@VALUES@u; table[0] != 0xFFFF; table += 2) {
    *(volatile unsigned short *)(0xCC002000u + table[0]) = table[1];
  }
  fill((unsigned *)FRAMEBUFFER, @BACKGROUND@u, WIDTH * HEIGHT / 2);
  square(0, @SQUARE@u, @SQUARE_ODD@u);
  *(volatile unsigned *)0xCC006400u = @PAD_COMMAND@u;
  *(volatile unsigned *)0xCC006430u = @PAD_POLL@u;
  *(volatile unsigned *)0xCC006C00u = 0;
  *(volatile unsigned short *)0xCC005030u = (unsigned short)(@TONE@u >> 16);
  *(volatile unsigned short *)0xCC005032u = (unsigned short)@TONE@u;
  *(volatile unsigned short *)0xCC005036u = (unsigned short)(0x8000u | @TONE_BLOCKS@u);
}

/** @sum@: the sum of two numbers */
int sum(int a, int b) {
  return a + b;
}

/** @compare@: -1, 0 or 1, as a is less than b, the same or more */
int compare(int a, int b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** @shift@: a shifted three ways by n, as the processor shifts, by six bits of n, so 32 and more shift everything out */
unsigned shift(unsigned a, unsigned n) {
  n &= 63;
  unsigned left = n & 32 ? 0 : a << n, right = n & 32 ? 0 : a >> n;
  unsigned keeping = n & 32 ? (unsigned)((int)a >> 31) : (unsigned)((int)a >> n);
  return left ^ right ^ keeping;
}

/** @divide@: a over b, as the processor divides, with -1 or 0, by a's sign, for what it can't */
int divide(int a, int b) {
  if (b == 0 || (a == (int)0x80000000 && b == -1)) return a < 0 ? -1 : 0;
  return a / b;
}

/** @wide@: the sum of two 64-bit numbers */
unsigned long long wide(unsigned long long a, unsigned long long b) {
  return a + b;
}

/** @pick@: a switch through a table of its cases */
int pick(unsigned n) {
  switch (n) {
  case 0: return 10;
  case 1: return 20;
  case 2: return 35;
  case 3: return 47;
  default: return -1;
  }
}
