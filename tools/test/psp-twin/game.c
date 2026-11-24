// The twins of the functions of the made-up program in tools/test/made-up-psp-twin.mjs, for npm run test:psp-twin: each
// is what its original does, in C, on the PlayStation Portable's kit, and names the address of its original in the
// comment above it, which the test puts where the names between at signs are, as the program is placed where the
// console puts it.

#include "psp.h"

extern const int values[];

/** @SUM@: a + b */
int sum(int a, int b) {
  return a + b;
}

/** @FILL@: writes value to count bytes from to */
void fill(uint8_t *to, int count, int value) {
  while (count != 0) {
    *to++ = (uint8_t)value;
    count--;
  }
}

/** @LOOKUP@: the index-th of the table */
int lookup(int index) {
  return values[index];
}

/** @TWICE@: a + a, by sum */
int twice(int a) {
  return sum(a, a);
}

/** @PICK@: a number for each of three cases */
int pick(unsigned n) {
  switch (n) {
  case 0: return 10;
  case 1: return 20;
  case 2: return 30;
  default: return 0;
  }
}

/** @BIGGER@: the larger, as the Allegrex's max gives it */
int bigger(int a, int b) {
  return a > b ? a : b;
}

/** @MIDDLE@: bits 4 to 11, as the Allegrex's ext gives them */
unsigned middle(unsigned x) {
  return (x >> 4) & 0xFF;
}

/** @CLOCK@: the system's time */
uint32_t system_time(void) {
  return sceKernelGetSystemTimeLow();
}

/** @HALF@: half of a float */
float half(float x) {
  return x / 2;
}
