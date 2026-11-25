// The GameCube processor's single-precision sums, as Dolphin's interpreter works them out (Source/Core/Core/PowerPC/
// Interpreter/Interpreter_FPUtils.h, at the commit tools/consoles.mjs fixes), for a game's C to get the same numbers
// as its original: a sum, a difference or a quotient of two singles is the same as C's, but the processor rounds the
// third operand of a multiply to 25 bits first, fuses a multiply with an add and rounds once, keeps a NaN's bits as
// it goes, giving the first of its operands that is one, made quiet, and turns a number into a whole one by its own
// rule at the ends. Each of these does that, with the floating-point unit as games set it: rounding to the nearest,
// no exception taken and NI off, so nothing is flushed to zero.
//
// WebAssembly doesn't promise which NaN a sum of a NaN gives, or which bits a NaN keeps when a single becomes a double,
// so every NaN here is worked out from its bits, as the processor keeps them.

#include "gamecube.h"

typedef union { double d; uint64_t u; } bits64;
typedef union { float f; uint32_t u; } bits32;

static uint64_t bits_of(double d) { bits64 b; b.d = d; return b.u; }
static double double_bits(uint64_t u) { bits64 b; b.u = u; return b.d; }
static uint32_t single_bits_of(float f) { bits32 b; b.f = f; return b.u; }
static float single_bits(uint32_t u) { bits32 b; b.u = u; return b.f; }

static int is_nan(double d) { uint64_t u = bits_of(d); return (u & 0x7FF0000000000000ull) == 0x7FF0000000000000ull && (u & 0x000FFFFFFFFFFFFFull); }

// a single as the double the processor keeps it as: exactly, and a NaN with its bits where a double has them
static double widened(float f) {
  uint32_t u = single_bits_of(f);
  if ((u & 0x7F800000u) == 0x7F800000u && (u & 0x007FFFFFu))
    return double_bits((uint64_t)(u & 0x80000000u) << 32 | 0x7FF0000000000000ull | (uint64_t)(u & 0x007FFFFFu) << 29);
  return (double)f;
}

// a double made a single, rounding to the nearest, and a NaN with the high bits of what it carries (ForceSingle)
static float narrowed(double d) {
  if (is_nan(d)) {
    uint64_t u = bits_of(d);
    return single_bits((uint32_t)(u >> 32 & 0x80000000u) | 0x7F800000u | (uint32_t)(u >> 29 & 0x007FFFFFu));
  }
  return (float)d;
}

// a NaN made quiet, as Common::MakeQuiet does, and the NaN the processor makes of nothing that was one
static double quiet(double d) { return double_bits(bits_of(d) | 0x0008000000000000ull); }
#define PPC_NAN double_bits(0x7FF8000000000000ull)

// the third operand of a multiply rounded to 25 bits, as Dolphin's Force25Bit does, a subnormal at its own bit
static double force25(double d) {
  uint64_t u = bits_of(d), exponent = u & 0x7FF0000000000000ull, fraction = u & 0x000FFFFFFFFFFFFFull;
  if (exponent == 0 && fraction != 0) {
    int64_t keep = (int64_t)0xFFFFFFFFF8000000ull;
    uint64_t round = 0x8000000;
    unsigned shift = (unsigned)__builtin_clzll(fraction) - (63 - 52);
    keep >>= shift;
    round >>= shift;
    u = (u & (uint64_t)keep) + (u & round);
  } else {
    u = (u & 0xFFFFFFFFF8000000ull) + (u & 0x8000000);
  }
  return double_bits(u);
}

// a sum or a product that came out a NaN: the first operand that is one, made quiet, or the processor's own
static double nan_of(double a, double b, double made) {
  if (is_nan(a)) return quiet(a);
  if (is_nan(b)) return quiet(b);
  return made;
}

float gc_adds(float a, float b) {
  double x = widened(a), y = widened(b), sum = x + y;
  return narrowed(is_nan(sum) ? nan_of(x, y, PPC_NAN) : sum);
}

float gc_subs(float a, float b) {
  double x = widened(a), y = widened(b), difference = x - y;
  return narrowed(is_nan(difference) ? nan_of(x, y, PPC_NAN) : difference);
}

float gc_muls(float a, float c) {
  double x = widened(a), y = force25(widened(c)), product = x * y;
  return narrowed(is_nan(product) ? nan_of(x, y, PPC_NAN) : product);
}

float gc_divs(float a, float b) {
  double x = widened(a), y = widened(b), quotient = x / y;
  return narrowed(is_nan(quotient) ? nan_of(x, y, PPC_NAN) : quotient);
}

// a * c + b rounded once, as fmadds gives it: c rounded to 25 bits, the sum worked out in a double, which holds the
// product of a single and c whole, and where that double ties when it's made a single, the way the exact sum lies from
// it says which way to round, as NI_madd_msub does
float gc_madds(float a, float c, float b) {
  double x = widened(a), y = force25(widened(c)), z = widened(b);
  double sum = x * y + z;
  if (!is_nan(sum)) {
    uint64_t u = bits_of(sum);
    if ((u & 0x000000001FFFFFFFull) == 0x0000000010000000ull) {
      double a_prime = z - sum, b_prime = sum + a_prime;
      double delta_a = x * y + a_prime, delta_b = z - b_prime, error = delta_a + delta_b;
      if (error != 0.0) sum = double_bits((error > 0.0) == (sum > 0.0) ? u + 1 : u - 1);
    }
    return narrowed(sum);
  }
  // the operands are looked at in the order a, b, c, whatever the sum's order
  if (is_nan(x)) return narrowed(quiet(x));
  if (is_nan(z)) return narrowed(quiet(z));
  if (is_nan(y)) return narrowed(quiet(y));
  return narrowed(PPC_NAN);
}

int32_t gc_tointz(double x) {
  if (is_nan(x)) return INT32_MIN;
  // toward zero: a double this large is a whole number already
  double whole = x > -4503599627370496.0 && x < 4503599627370496.0 ? (double)(int64_t)x : x;
  if (whole >= 2147483648.0) return INT32_MAX;
  if (whole < -2147483648.0) return INT32_MIN;
  return (int32_t)whole;
}
