// The PlayStation 2's floats, on their bits (floats.h). The console's FPU and vector units don't follow the standard a
// computer's floats do:
//
// - there is no infinity and no NaN: a float whose exponent is all ones is an ordinary number, up to twice the largest
//   a computer has, and a result too large for a float is the largest there is, 0x7FFFFFFF with its sign, which raises
//   overflow;
// - a float whose exponent is zero counts as zero going in, and a result that small is zero with its sign, which
//   raises underflow;
// - a sum is cut towards zero to 24 bits, never rounded, and keeps one bit of the smaller number below the larger's
//   last, dropping the rest before it adds, so 1 minus something tiny is 1, where cutting the exact answer would give
//   the float below 1;
// - a product comes from the multiplier's own circuit, which drops low bits of its rows before they're added, so now
//   and then it's a last bit under the exact product cut: 1 times 0x3FFFFFFF is 0x3FFFFFFE;
// - a quotient and a root come a digit a step from the divider's circuit, 25 steps with nothing put right at the end,
//   so their last bit is what the digits leave, neither the exact answer cut nor rounded;
// - a product too large added to ACC or taken from it (MADD, MSUB) is the largest float with the product's sign,
//   whatever ACC holds;
// - a division by zero gives the largest float with the sign the two make and raises division by zero, or invalid for
//   0 / 0; a square root is of the float without its sign, and raises invalid for a negative one.
//
// The flags, the largest float and the zeros are as Sony's manuals for the EE and the vector units give them. The last
// bits are what a console gives: the sum's one guard bit is Play!'s (FpAddTruncate) and PCSX2's (FPU_ADD_SUB); the
// multiplier and the divider are the circuits PCSX2's soft-float work models (PS2Float.cpp, PCSX2/pcsx2#12001,
// copyright 2002-2024 PCSX2 Dev Team, GPL-3.0-or-later, as this kit is), written again here; and all of them, with
// the EFU's orders and MADD's overflow, are held to the results a console printed for ps2autotests
// (tools/test/ps2-console-floats.mjs, kit/ps2/c/README.md). Everything is in whole numbers, so it's the same on every
// computer and in WebAssembly, and it's written to build as C or as C++.

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

// The multiplier's circuit. It recodes the second significand two bits at a time into eight rows to add (Booth's way),
// adds them three at a time, and throws away what is under bit 15 of the two last rows before the last addition, where a
// carry out of those bits would have come up. So bit 15 of the product can be wrong, and with it, now and then, the
// 24 bits kept: 1 times 0x3FFFFFFF is 0x3FFFFFFE on the console.
typedef struct { uint32_t row, negative; } booth;
typedef struct { uint32_t sum, carry; } saved;
static booth recode(uint32_t a, uint32_t b, uint32_t at) {
  uint32_t three = (at ? b >> (at * 2 - 1) : b << 1) & 7, place = 1u << (at * 2);
  uint32_t row = a << (at * 2), negative = three >= 4 && three <= 6 ? ~0u : 0;
  if (three == 3 || three == 4) row += row;
  row ^= negative & (0u - place);
  if (three < 1 || three > 6) row = 0;
  booth made = { row, negative & place };
  return made;
}
// three rows added without their carries going along: a sum, and the carries a place up
static saved save(uint32_t a, uint32_t b, uint32_t c) {
  saved made = { a ^ b ^ c, ((a & b) | ((a ^ b) & c)) << 1 };
  return made;
}
static uint64_t multiply(uint32_t a, uint32_t b) {
  uint64_t exact = (uint64_t)a * b;
  booth r[8];
  for (uint32_t i = 0; i < 8; i++) r[i] = recode(a, b, i);
  saved t0 = save(r[1].row, r[2].row, r[3].row), t1 = save(r[4].row & ~0x7FFu, r[5].row & ~0xFFFu, r[6].row);
  t1.carry |= r[6].negative | (r[5].row & 0x800);
  r[7].row |= (r[5].row & 0x400) + r[5].negative;
  saved t2 = save(r[0].row, t0.sum, t0.carry), t3 = save(r[7].row, t1.sum, t1.carry);
  saved t4 = save(t2.carry, t3.sum, t3.carry), t5 = save(t2.sum, t4.sum, t4.carry);
  t5.carry += r[7].negative;
  uint32_t low = (t5.sum & ~0x7FFFu) + (t5.carry & ~0x7FFFu);
  return exact - ((low ^ exact) & 0x8000);
}

uint32_t fpu_mul(uint32_t a, uint32_t b, uint32_t *flags) {
  uint32_t sign = (a ^ b) & SIGN;
  if (is_zero(a) || is_zero(b)) return sign;
  return make(sign, exponent_of(a) + exponent_of(b) - 254 - 46, multiply((uint32_t)significand_of(a), (uint32_t)significand_of(b)), flags);
}

// The divider's circuit, which the root shares: a digit of the answer a step, each 1, 0 or -1, chosen by looking at the
// top of what is left, which is kept as a sum and its carries and never added up. 25 steps, and the answer's last bit
// is whatever the digits leave: not the exact answer cut, and not it rounded.
static int32_t digit(saved left) {
  uint32_t mask = (1u << 24) - 1;
  int32_t top = (int32_t)(((left.sum & ~mask) + left.carry) | (left.sum & mask));
  return top >= 1 << 23 ? 1 : top < (int32_t)(~0u << 24) ? -1 : 0;
}

uint32_t fpu_div(uint32_t a, uint32_t b, uint32_t *flags) {
  uint32_t sign = (a ^ b) & SIGN;
  if (is_zero(b)) {
    *flags |= is_zero(a) ? FLAG_I : FLAG_D;
    return sign | FMAX;
  }
  if (is_zero(a)) return sign;
  uint32_t divisor = (uint32_t)significand_of(b) << 2, quotient = 0;
  saved left = { (uint32_t)significand_of(a) << 2, 0 };
  int32_t next = 1;
  for (int step = 0; step < 25; step++) {
    quotient = (quotient << 1) + (uint32_t)next;
    left.carry += next > 0;
    saved after = save(left.sum, left.carry, next > 0 ? ~divisor : next < 0 ? divisor : 0);
    next = digit(next ? after : left);
    left.sum = after.sum << 1, left.carry = after.carry << 1;
  }
  int32_t exponent = exponent_of(a) - exponent_of(b) + 126;
  if (quotient >= 1u << 24) exponent++, quotient >>= 1;
  if (exponent > 255) {
    *flags |= FLAG_O;
    return sign | FMAX;
  }
  if (exponent < 1) {
    *flags |= FLAG_U;
    return sign;
  }
  return sign | (uint32_t)exponent << 23 | (quotient & 0x7FFFFF);
}

uint32_t fpu_sqrt(uint32_t a, uint32_t *flags) {
  if (is_zero(a)) return 0;
  if (a & SIGN) *flags |= FLAG_I;
  uint32_t root = 0;
  saved left = { (uint32_t)significand_of(a) << (a & 0x800000 ? 1 : 2), 0 };
  int32_t next = 1;
  for (int step = 0; step < 25; step++) {
    // a digit more on the root takes the digit times twice the root, and the digit's square, from what is left
    uint32_t take = root + ((uint32_t)next << (24 - step));
    root += (uint32_t)next << (25 - step);
    left.carry += next > 0;
    saved after = save(left.sum, left.carry, next > 0 ? ~take : next < 0 ? take : 0);
    next = digit(next ? after : left);
    left.sum = after.sum << 1, left.carry = after.carry << 1;
  }
  return (uint32_t)((exponent_of(a) + 127) >> 1) << 23 | (root >> 2 & 0x7FFFFF);
}

uint32_t fpu_mul_add(uint32_t acc, uint32_t a, uint32_t b, int subtract, uint32_t *flags) {
  uint32_t raised = 0, product = fpu_mul(a, b, &raised) ^ (subtract ? SIGN : 0);
  *flags |= raised;
  return raised & FLAG_O ? product : fpu_add(acc, product, flags);
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

int64_t fpu_rank(uint32_t a) { return a & SIGN ? -1 - (int64_t)(a & ~SIGN) : (int64_t)a; }

// The EFU's sums, with the constants Sony's manual gives for ESIN, EATAN and EEXP. The manual gives each formula and not
// the order the unit works it out in, which changes the last bits: these orders are the ones that give what a console
// gives (kit/ps2/c/README.md says which results, and where the arctangent still parts from them). A product's two
// numbers are named in their order, as the multiplier doesn't treat them alike.
uint32_t fpu_efu(int which, uint32_t x, uint32_t y, uint32_t z, uint32_t w, uint32_t s) {
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
  case EFU_ESIN: {
    // the odd powers, each the one before by s squared, each by its constant, added from the first
    uint32_t square = fpu_mul(s, s, &flags), power = s, total = 0;
    for (int i = 0; i < 5; i++) {
      uint32_t term = fpu_mul(power, sine[i], &flags);
      total = i ? fpu_add(total, term, &flags) : term;
      power = fpu_mul(power, square, &flags);
    }
    return total;
  }
  case EFU_EEXP: {
    // 1 over the fourth power of 1 plus the series: the 1 goes in before the series' last term
    uint32_t power = s, total = 0;
    for (int i = 0; i < 6; i++) {
      uint32_t term = fpu_mul(power, exponential[i], &flags);
      if (i == 5) total = fpu_add(total, ONE, &flags);
      total = i ? fpu_add(total, term, &flags) : term;
      power = fpu_mul(power, s, &flags);
    }
    uint32_t square = fpu_mul(total, total, &flags);
    return fpu_div(ONE, fpu_mul(square, square, &flags), &flags);
  }
  default: {
    // the arctangent of s, of y over x or of z over x: the series of (a - b) / (a + b), then a quarter of pi, which
    // the unit holds a last bit under the float nearest it
    uint32_t top = which == EFU_EATAN ? s : which == EFU_EATANXY ? y : z, under = which == EFU_EATAN ? ONE : x;
    uint32_t t = fpu_div(fpu_add(top, under ^ SIGN, &flags), fpu_add(top, under, &flags), &flags);
    uint32_t square = fpu_mul(t, t, &flags), power = t, total = 0;
    for (int i = 0; i < 8; i++) {
      uint32_t term = fpu_mul(arctangent[i], power, &flags);
      total = i ? fpu_add(total, term, &flags) : term;
      power = fpu_mul(square, power, &flags);
    }
    return fpu_add(total, 0x3F490FDA, &flags);
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
