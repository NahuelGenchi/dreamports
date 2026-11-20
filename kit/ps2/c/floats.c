// The PlayStation 2's floats, on their bits (floats.h). The console's FPU and vector units don't follow the standard a
// computer's floats do:
//
// - there is no infinity and no NaN: a float whose exponent is all ones is an ordinary number, up to twice the largest
//   a computer has, and a result too large for a float is the largest there is, 0x7FFFFFFF with its sign, which raises
//   overflow;
// - a float whose exponent is zero counts as zero going in, and a result that small is zero with its sign, which
//   raises underflow;
// - a result is cut towards zero to 24 bits, never rounded;
// - a sum keeps one bit of the smaller number below the larger's last, and drops the rest before it adds, so 1 minus
//   something tiny is 1, where cutting the exact answer would give the float below 1;
// - a division by zero gives the largest float with the sign the two make and raises division by zero, or invalid for
//   0 / 0; a square root is of the float without its sign, and raises invalid for a negative one.
//
// These are as Sony's manuals for the EE and the vector units give them, and where the manuals leave the last bit open,
// as the emulators that have measured the console agree: the sum's one guard bit is Play!'s (FpAddTruncate) and PCSX2's
// (FPU_ADD_SUB), and a product, a quotient and a root are the exact ones cut, as both work them out. Everything is in
// whole numbers, so it's the same on every computer and in WebAssembly, and it's written to build as C or as C++.

#include "floats.h"

#define SIGN 0x80000000u
#define FMAX 0x7FFFFFFFu
#define ONE 0x3F800000u

static int is_zero(uint32_t x) { return !(x & 0x7F800000); }
static int32_t exponent_of(uint32_t x) { return (int32_t)(x >> 23 & 0xFF); }
static uint64_t significand_of(uint32_t x) { return (x & 0x7FFFFF) | 0x800000; }

// a float from its sign, the exponent of its significand's lowest bit and the significand, of any number of bits: cut
// to 24 bits, and what's too large or too small for a float as the console makes it
static uint32_t make(uint32_t sign, int32_t low, uint64_t significand, uint32_t *flags) {
  if (!significand) return 0;
  int top = 63 - __builtin_clzll(significand);
  int32_t exponent = low + top + 127;
  uint32_t kept = (uint32_t)(top > 23 ? significand >> (top - 23) : significand << (23 - top));
  if (exponent > 255) {
    *flags |= FLAG_O;
    return sign | FMAX;
  }
  if (exponent < 1) {
    *flags |= FLAG_U;
    return sign;
  }
  return sign | (uint32_t)exponent << 23 | (kept & 0x7FFFFF);
}

uint32_t fpu_add(uint32_t a, uint32_t b, uint32_t *flags) {
  if (is_zero(a) && is_zero(b)) return a & b & SIGN;
  if (is_zero(a)) return b;
  if (is_zero(b)) return a;
  // the larger first
  if ((b & ~SIGN) > (a & ~SIGN)) {
    uint32_t t = a;
    a = b, b = t;
  }
  // both a bit up, and the smaller down to the larger's exponent: one bit of it is kept below the larger's last
  int32_t shift = exponent_of(a) - exponent_of(b);
  uint64_t big = significand_of(a) << 1, small = shift > 24 ? 0 : (significand_of(b) << 1) >> shift;
  uint64_t sum = (a ^ b) & SIGN ? big - small : big + small;
  if (!sum) return 0;
  return make(a & SIGN, exponent_of(a) - 127 - 24, sum, flags);
}

uint32_t fpu_mul(uint32_t a, uint32_t b, uint32_t *flags) {
  uint32_t sign = (a ^ b) & SIGN;
  if (is_zero(a) || is_zero(b)) return sign;
  return make(sign, exponent_of(a) + exponent_of(b) - 254 - 46, significand_of(a) * significand_of(b), flags);
}

uint32_t fpu_div(uint32_t a, uint32_t b, uint32_t *flags) {
  uint32_t sign = (a ^ b) & SIGN;
  if (is_zero(b)) {
    *flags |= is_zero(a) ? FLAG_I : FLAG_D;
    return sign | FMAX;
  }
  if (is_zero(a)) return sign;
  // 39 more bits of quotient than the significands have, cut, which cut again to 24 is the exact quotient cut
  uint64_t quotient = (significand_of(a) << 39) / significand_of(b);
  return make(sign, exponent_of(a) - exponent_of(b) - 39, quotient, flags);
}

uint32_t fpu_sqrt(uint32_t a, uint32_t *flags) {
  if (is_zero(a)) return 0;
  if (a & SIGN) *flags |= FLAG_I;
  // the significand with an even power of two, and 36 more bits, so its whole root, found a bit at a time, has 30
  int32_t power = exponent_of(a) - 127 - 23;
  uint64_t n = significand_of(a), root = 0;
  if (power & 1) n <<= 1, power--;
  n <<= 36;
  for (int bit = 31; bit >= 0; bit--) {
    uint64_t trial = root | 1ull << bit;
    if (trial * trial <= n) root = trial;
  }
  return make(0, power / 2 - 18, root, flags);
}

uint32_t fpu_rsqrt(uint32_t a, uint32_t b, uint32_t *flags) { return fpu_div(a, fpu_sqrt(b, flags), flags); }

int32_t fpu_to_int(uint32_t a) {
  if (is_zero(a)) return 0;
  int32_t exponent = exponent_of(a) - 127;
  if (exponent < 0) return 0;
  if (exponent > 30) return a & SIGN ? INT32_MIN : INT32_MAX;
  uint32_t whole = (uint32_t)(exponent > 23 ? significand_of(a) << (exponent - 23) : significand_of(a) >> (23 - exponent));
  return a & SIGN ? -(int32_t)whole : (int32_t)whole;
}

uint32_t fpu_from_int(int32_t value) {
  uint32_t flags = 0;
  if (!value) return 0;
  return make(value < 0 ? SIGN : 0, 0, value < 0 ? (uint64_t)-(int64_t)value : (uint64_t)value, &flags);
}

int32_t fpu_order(uint32_t a) {
  if (is_zero(a)) return 0;
  return a & SIGN ? -(int32_t)(a & ~SIGN) : (int32_t)a;
}

// a run of terms, each a power of x by its constant, added in turn: the power by multiplying by x again
static uint32_t series(uint32_t x, const uint32_t *constants, const int *powers, int count) {
  uint32_t flags = 0, total = 0;
  for (int i = 0; i < count; i++) {
    uint32_t term = x;
    for (int k = 1; k < powers[i]; k++) term = fpu_mul(term, x, &flags);
    term = fpu_mul(term, constants[i], &flags);
    total = i ? fpu_add(total, term, &flags) : term;
  }
  return total;
}

// The EFU's sums, with the constants Sony's manual gives for ESIN, EATAN and EEXP. Each step is one of the sums above,
// in the order the manual's formula reads: x squared plus y squared, plus z squared; x plus y, plus z, plus w.
uint32_t fpu_efu(int which, uint32_t x, uint32_t y, uint32_t z, uint32_t w, uint32_t s) {
  static const int odd[8] = { 1, 3, 5, 7, 9, 11, 13, 15 }, each[6] = { 1, 2, 3, 4, 5, 6 };
  static const uint32_t sine[5] = { 0x3F800000, 0xBE2AAAA4, 0x3C08873E, 0xB94FB21F, 0x362E9C14 };
  static const uint32_t arctangent[8] = { 0x3F7FFFF5, 0xBEAAA61C, 0x3E4C40A6, 0xBE0E6C63, 0x3DC577DF, 0xBD6501C4, 0x3CB31652, 0xBB84D7E7 };
  static const uint32_t exponential[6] = { 0x3E7FFFA8, 0x3D0007F4, 0x3B29D3FF, 0x3933E553, 0x36B63510, 0x353961AC };
  uint32_t flags = 0;
  uint32_t squares = fpu_add(fpu_add(fpu_mul(x, x, &flags), fpu_mul(y, y, &flags), &flags), fpu_mul(z, z, &flags), &flags);
  switch (which) {
  case EFU_ESADD: return squares;
  case EFU_ERSADD: return fpu_div(ONE, squares, &flags);
  case EFU_ELENG: return fpu_sqrt(squares, &flags);
  case EFU_ERLENG: return fpu_rsqrt(ONE, squares, &flags);
  case EFU_ESUM: return fpu_add(fpu_add(fpu_add(x, y, &flags), z, &flags), w, &flags);
  case EFU_ESQRT: return fpu_sqrt(s, &flags);
  case EFU_ERSQRT: return fpu_rsqrt(ONE, s, &flags);
  case EFU_ERCPR: return fpu_div(ONE, s, &flags);
  case EFU_ESIN: return series(s, sine, odd, 5);
  case EFU_EEXP: {
    // 1 over the fourth power of 1 plus the series
    uint32_t total = fpu_add(series(s, exponential, each, 6), ONE, &flags), square = fpu_mul(total, total, &flags);
    return fpu_div(ONE, fpu_mul(square, square, &flags), &flags);
  }
  default: {
    // the arctangent of s, of y over x or of z over x: a quarter of pi plus the series of (a - b) / (a + b)
    uint32_t top = which == EFU_EATAN ? s : which == EFU_EATANXY ? y : z, under = which == EFU_EATAN ? ONE : x;
    uint32_t t = fpu_div(fpu_add(top, under ^ SIGN, &flags), fpu_add(top, under, &flags), &flags);
    return fpu_add(series(t, arctangent, odd, 8), 0x3F490FDB, &flags);
  }
  }
}

uint32_t fpu_clip(uint32_t x, uint32_t y, uint32_t z, uint32_t w) {
  uint32_t fields[3] = { x, y, z }, size = is_zero(w) ? 0 : w & ~SIGN, judged = 0;
  for (int f = 0; f < 3; f++) {
    uint32_t own = is_zero(fields[f]) ? 0 : fields[f] & ~SIGN;
    if (own > size) judged |= (fields[f] & SIGN ? 2u : 1u) << (f * 2);
  }
  return judged;
}
