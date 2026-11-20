// The kit's float sums, one a line, for ps2-console-floats.mjs: "name a b acc" in, "result acc" out, on the EE's FPU
// (kit/ps2/c/ee.c); "efu name x y z w" in, the EFU's result out (kit/ps2/c/floats.c).

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

int main(void) {
  char name[32];
  uint32_t v[4];
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
    if (scanf("%x %x %x", &v[0], &v[1], &v[2]) != 3) return 1;
    float a = number(v[0]), b = number(v[1]);
    uint32_t result = 0;
    ee_acc = number(v[2]);
    if (!strcmp(name, "add")) result = bits(ee_add(a, b));
    else if (!strcmp(name, "sub")) result = bits(ee_sub(a, b));
    else if (!strcmp(name, "mul")) result = bits(ee_mul(a, b));
    else if (!strcmp(name, "div")) result = bits(ee_div(a, b));
    else if (!strcmp(name, "sqrt")) result = bits(ee_sqrt(a));
    else if (!strcmp(name, "rsqrt")) result = bits(ee_rsqrt(a, b));
    else if (!strcmp(name, "adda")) ee_adda(a, b);
    else if (!strcmp(name, "suba")) ee_suba(a, b);
    else if (!strcmp(name, "mula")) ee_mula(a, b);
    else if (!strcmp(name, "madd")) result = bits(ee_madd(a, b));
    else if (!strcmp(name, "msub")) result = bits(ee_msub(a, b));
    else if (!strcmp(name, "madda")) ee_madda(a, b);
    else if (!strcmp(name, "msuba")) ee_msuba(a, b);
    else if (!strcmp(name, "max")) result = bits(ee_max(a, b));
    else if (!strcmp(name, "min")) result = bits(ee_min(a, b));
    else if (!strcmp(name, "abs")) result = bits(ee_abs(a));
    else if (!strcmp(name, "neg")) result = bits(ee_neg(a));
    else if (!strcmp(name, "cvt.w.s")) result = (uint32_t)ee_to_int(a);
    else if (!strcmp(name, "cvt.s.w")) result = bits(ee_from_int((int32_t)v[0]));
    else if (!strcmp(name, "eq")) result = (uint32_t)ee_c_eq(a, b);
    else if (!strcmp(name, "f")) result = (uint32_t)ee_c_f();
    else if (!strcmp(name, "lt")) result = (uint32_t)ee_c_lt(a, b);
    else if (!strcmp(name, "le")) result = (uint32_t)ee_c_le(a, b);
    else return 1;
    // ACC as a program reads it back, through a sum, which makes a tiny ACC zero
    printf("%08x %08x\n", result, bits(ee_add(ee_acc, number(0x80000000))));
  }
  return 0;
}
