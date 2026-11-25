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

/** @SCALE@: x times y, as the floating-point unit multiplies */
float scale(float x, float y) {
  return psp_mul_s(x, y);
}

/** @WHOLE@: round.w.s */
int whole(float x) {
  return psp_round_w_s(x);
}

/** @CUT@: trunc.w.s */
int cut(float x) {
  return psp_trunc_w_s(x);
}

/** @FLOOR_OF@: floor.w.s */
int floor_of(float x) {
  return psp_floor_w_s(x);
}

/** @CEIL_OF@: ceil.w.s */
int ceil_of(float x) {
  return psp_ceil_w_s(x);
}

/** @NEAREST@: cvt.w.s, as the console starts a program rounding */
int nearest(float x) {
  return psp_cvt_w_s(x, PSP_FPU_NEAREST);
}

/** @LESS@: whether x is less than y */
int less(float x, float y) {
  return x < y;
}

/** @ROOT@: the square root */
float root(float x) {
  return __builtin_sqrtf(x);
}

/** @FROM_WHOLE@: a whole number as a float */
float from_whole(int n) {
  return (float)n;
}

/** @LEADING@: how many top bits are 0 */
unsigned leading(unsigned x) {
  return psp_clz(x);
}

/** @SWAPPED@: each half's bytes swapped */
unsigned swapped(unsigned x) {
  return psp_wsbh(x);
}

/** @REVERSED@: the bits the other way round */
unsigned reversed(unsigned x) {
  return psp_bitrev(x);
}

/** @QUOTIENT@: a over b */
int quotient(int a, int b) {
  return (int)psp_div(a, b).lo;
}

/** @REST@: what's left of a over b */
int rest(int a, int b) {
  return (int)psp_div(a, b).hi;
}

/** @DOT@: a times b plus c times d, the low word */
int dot(int a, int b, int c, int d) {
  return (int)psp_madd(psp_mult(a, b), c, d).lo;
}

/** @TURNED@: x turned right by n */
unsigned turned(unsigned x, unsigned n) {
  return psp_rotr(x, n);
}

/** @INVERSE_SQUARE@: one over the four floats at v dotted with themselves, by the vector unit, as its bits */
unsigned inverse_square(const float *v) {
  psp_vfpu_load(0xD8800000u, (uint32_t)(uintptr_t)v);
  psp_vfpu(0x64808081u);
  psp_vfpu(0xD0100101u);
  return psp_vfpu_get(0x48620001u);
}

/** @SPIN@: angle's sine and cosine, left in the vector unit */
void spin(unsigned angle) {
  psp_vfpu_set(0x48E40000u, angle);
  psp_vfpu(0xD0120002u);
  psp_vfpu(0xD0130003u);
}
