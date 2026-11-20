// The kit's float sums, one a line, for ps2-console-floats.mjs: "name a b acc" in, "result acc" out, on the EE's FPU
// (kit/ps2/c/ee.c); "efu name x y z w" in, the EFU's result out (kit/ps2/c/floats.c); and "fcr reg value name a b" in,
// for the FPU's control registers: CTC1 writes value to reg (nothing for a reg of -1), then the sum runs (nothing for a
// name of "-"), and out come its result and what CFC1 reads in each of the 32 control registers.

#include <stdio.h>
#include <string.h>
#include "ps2.h"
#include "floats.h"

static float number(uint32_t bits) {
  float value;
  memcpy(&value, &bits, 4);
  return value;
}
static uint32_t bits(float value) {
  uint32_t word;
  memcpy(&word, &value, 4);
  return word;
}

static const char *const EFU_NAMES[] = { "ESADD", "ERSADD", "ELENG", "ERLENG", "ESUM", "ESQRT", "ERSQRT", "ERCPR", "ESIN", "EEXP", "EATAN", "EATANxy", "EATANxz" };

// the sum a name gives, on floats given by their bits, with the accumulator set first; 0 and a false ok for a name
// that isn't one
static uint32_t sum(const char *name, uint32_t a_bits, uint32_t b_bits, uint32_t acc, int *ok) {
  float a = number(a_bits), b = number(b_bits);
  ee_acc = number(acc);
  *ok = 1;
  if (!strcmp(name, "add")) return bits(ee_add(a, b));
  if (!strcmp(name, "sub")) return bits(ee_sub(a, b));
  if (!strcmp(name, "mul")) return bits(ee_mul(a, b));
  if (!strcmp(name, "div")) return bits(ee_div(a, b));
  if (!strcmp(name, "sqrt")) return bits(ee_sqrt(a));
  if (!strcmp(name, "rsqrt")) return bits(ee_rsqrt(a, b));
  if (!strcmp(name, "adda")) return ee_adda(a, b), 0;
  if (!strcmp(name, "suba")) return ee_suba(a, b), 0;
  if (!strcmp(name, "mula")) return ee_mula(a, b), 0;
  if (!strcmp(name, "madd")) return bits(ee_madd(a, b));
  if (!strcmp(name, "msub")) return bits(ee_msub(a, b));
  if (!strcmp(name, "madda")) return ee_madda(a, b), 0;
  if (!strcmp(name, "msuba")) return ee_msuba(a, b), 0;
  if (!strcmp(name, "max")) return bits(ee_max(a, b));
  if (!strcmp(name, "min")) return bits(ee_min(a, b));
  if (!strcmp(name, "abs")) return bits(ee_abs(a));
  if (!strcmp(name, "neg")) return bits(ee_neg(a));
  if (!strcmp(name, "cvt.w.s")) return (uint32_t)ee_to_int(a);
  if (!strcmp(name, "cvt.s.w")) return bits(ee_from_int((int32_t)a_bits));
  if (!strcmp(name, "eq")) return (uint32_t)ee_c_eq(a, b);
  if (!strcmp(name, "f")) return (uint32_t)ee_c_f();
  if (!strcmp(name, "lt")) return (uint32_t)ee_c_lt(a, b);
  if (!strcmp(name, "le")) return (uint32_t)ee_c_le(a, b);
  *ok = 0;
  return 0;
}

int main(void) {
  char name[32];
  uint32_t v[4];
  int ok;
  while (scanf("%31s", name) == 1) {
    if (!strcmp(name, "efu")) {
      if (scanf("%31s %x %x %x %x", name, &v[0], &v[1], &v[2], &v[3]) != 5) return 1;
      int which = -1;
      for (int i = 0; i < 13; i++) if (!strcmp(name, EFU_NAMES[i])) which = i;
      if (which < 0) return 1;
      // the tests give a sum of one field the vector's z
      printf("%08x 0\n", fpu_efu(which, v[0], v[1], v[2], v[3], v[2]));
      continue;
    }
    if (!strcmp(name, "fcr")) {
      int reg;
      if (scanf("%d %x %31s %x %x", &reg, &v[0], name, &v[1], &v[2]) != 5) return 1;
      if (reg >= 0) ee_ctc1(reg, v[0]);
      uint32_t result = 0;
      if (strcmp(name, "-") && (result = sum(name, v[1], v[2], 0, &ok), !ok)) return 1;
      printf("%08x", result);
      for (int i = 0; i < 32; i++) printf(" %08x", ee_cfc1(i));
      printf("\n");
      continue;
    }
    if (scanf("%x %x %x", &v[0], &v[1], &v[2]) != 3) return 1;
    uint32_t result = sum(name, v[0], v[1], v[2], &ok);
    if (!ok) return 1;
    // ACC as a program reads it back, through a sum, which makes a tiny ACC zero
    printf("%08x %08x\n", result, bits(ee_add(ee_acc, number(0x80000000))));
  }
  return 0;
}
