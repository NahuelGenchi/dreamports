// The EE's FPU (ps2.h): its instructions on the console's float rules (floats.c), with its flags kept in ee_fcsr as the
// console keeps them in its FCSR. A sum that can overflow or underflow sets or clears those two flags, and a division or
// a square root the division and invalid flags, each with the sticky flag that stays until the game clears it. ABS, NEG,
// MAX and MIN clear overflow and underflow, and a compare sets the condition bit and nothing else.

#include "ps2-kit.h"

#define SIGN 0x80000000u
#define OU (EE_FCSR_O | EE_FCSR_U)
#define DI (EE_FCSR_D | EE_FCSR_I)

uint32_t ee_fcsr = EE_FCSR_ONES;
float ee_acc;

uint32_t ee_cfc1(int reg) { return reg < 16 ? 0x2E30 : ee_fcsr; }
void ee_ctc1(int reg, uint32_t value) {
  if (reg == 31) ee_fcsr = EE_FCSR_ONES | (value & EE_FCSR_WRITTEN);
}

static uint32_t bits_of(float value) {
  uint32_t bits;
  __builtin_memcpy(&bits, &value, 4);
  return bits;
}
static float of_bits(uint32_t bits) {
  float value;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

// a result with the flags of one kind it raised, overflow and underflow or division and invalid: those are cleared,
// then set with their sticky flags
static float flagged(uint32_t result, uint32_t flags, uint32_t kind) {
  ee_fcsr &= ~kind;
  if (kind == OU) ee_fcsr |= (flags & FLAG_O ? EE_FCSR_O | EE_FCSR_SO : 0) | (flags & FLAG_U ? EE_FCSR_U | EE_FCSR_SU : 0);
  else ee_fcsr |= (flags & FLAG_D ? EE_FCSR_D | EE_FCSR_SD : 0) | (flags & FLAG_I ? EE_FCSR_I | EE_FCSR_SI : 0);
  return of_bits(result);
}

float ee_add(float a, float b) {
  uint32_t flags = 0, result = fpu_add(bits_of(a), bits_of(b), &flags);
  return flagged(result, flags, OU);
}
float ee_sub(float a, float b) { return ee_add(a, of_bits(bits_of(b) ^ SIGN)); }
float ee_mul(float a, float b) {
  uint32_t flags = 0, result = fpu_mul(bits_of(a), bits_of(b), &flags);
  return flagged(result, flags, OU);
}
float ee_div(float a, float b) {
  uint32_t flags = 0, result = fpu_div(bits_of(a), bits_of(b), &flags);
  return flagged(result, flags, DI);
}
float ee_sqrt(float value) {
  uint32_t flags = 0, result = fpu_sqrt(bits_of(value), &flags);
  return flagged(result, flags, DI);
}
float ee_rsqrt(float a, float b) {
  uint32_t flags = 0, result = fpu_rsqrt(bits_of(a), bits_of(b), &flags);
  return flagged(result, flags, DI);
}

// the accumulator's: ADDA, SUBA and MULA set it, MADD and MSUB give it plus or minus a product, and MADDA and MSUBA
// set it to that
float ee_adda(float a, float b) { return ee_acc = ee_add(a, b); }
float ee_suba(float a, float b) { return ee_acc = ee_sub(a, b); }
float ee_mula(float a, float b) { return ee_acc = ee_mul(a, b); }
static float multiply_add(float a, float b, uint32_t negate) {
  uint32_t flags = 0, result = fpu_mul_add(bits_of(ee_acc), bits_of(a), bits_of(b), negate != 0, &flags);
  return flagged(result, flags, OU);
}
float ee_madd(float a, float b) { return multiply_add(a, b, 0); }
float ee_msub(float a, float b) { return multiply_add(a, b, SIGN); }
float ee_madda(float a, float b) { return ee_acc = multiply_add(a, b, 0); }
float ee_msuba(float a, float b) { return ee_acc = multiply_add(a, b, SIGN); }

float ee_abs(float value) { return flagged(bits_of(value) & ~SIGN, 0, OU); }
float ee_neg(float value) { return flagged(bits_of(value) ^ SIGN, 0, OU); }
float ee_max(float a, float b) { return flagged(fpu_rank(bits_of(a)) >= fpu_rank(bits_of(b)) ? bits_of(a) : bits_of(b), 0, OU); }
float ee_min(float a, float b) { return flagged(fpu_rank(bits_of(a)) <= fpu_rank(bits_of(b)) ? bits_of(a) : bits_of(b), 0, OU); }

static int condition(int value) {
  ee_fcsr = value ? ee_fcsr | EE_FCSR_C : ee_fcsr & ~EE_FCSR_C;
  return value;
}
int ee_c_f(void) { return condition(0); }
int ee_c_eq(float a, float b) { return condition(fpu_order(bits_of(a)) == fpu_order(bits_of(b))); }
int ee_c_lt(float a, float b) { return condition(fpu_order(bits_of(a)) < fpu_order(bits_of(b))); }
int ee_c_le(float a, float b) { return condition(fpu_order(bits_of(a)) <= fpu_order(bits_of(b))); }

int32_t ee_to_int(float value) { return fpu_to_int(bits_of(value)); }
float ee_from_int(int32_t value) { return of_bits(fpu_from_int(value)); }
