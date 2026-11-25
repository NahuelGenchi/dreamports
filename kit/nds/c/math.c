// The Nintendo DS ARM9's divider and square root (kit/nds/c/README.md), as melonDS, the reference emulator, has them
// (its NDS.cpp): a write of a control, or of a word of a number, starts one again, and its result comes 18 ticks later
// for a 32-bit division, 34 for the others, and 13 for a square root, with the busy flag up until then and the results
// still the last ones, as melonDS works them out at that time from the numbers as they are then.

#include "nds.h"
#include "nds-kit.h"

static uint32_t divcnt, numerator[2], denominator[2], quotient[2], remainder_[2];
static uint32_t sqrtcnt, root, radicand[2];
static uint64_t divided_at, rooted_at;

#define NEVER UINT64_MAX

void nds_math_power(void) {
  divcnt = sqrtcnt = root = 0;
  for (int i = 0; i < 2; i++) numerator[i] = denominator[i] = quotient[i] = remainder_[i] = radicand[i] = 0;
  divided_at = rooted_at = NEVER;
}

static uint64_t join(const uint32_t *words) { return (uint64_t)words[0] | (uint64_t)words[1] << 32; }
static void split(uint32_t *words, uint64_t value) { words[0] = (uint32_t)value, words[1] = (uint32_t)(value >> 32); }

// the division, as melonDS's DivDone does it for each size
static void divide(void) {
  divcnt &= ~0xC000u;
  if ((divcnt & 3) == 0) {
    int32_t num = (int32_t)numerator[0], den = (int32_t)denominator[0];
    if (den == 0) {
      quotient[0] = num < 0 ? 1 : 0xFFFFFFFFu;
      quotient[1] = num < 0 ? 0xFFFFFFFFu : 0;
      split(remainder_, (uint64_t)(int64_t)num);
    } else if (num == INT32_MIN && den == -1) {
      split(quotient, 0x80000000u);
    } else {
      split(quotient, (uint64_t)(int64_t)(num / den));
      split(remainder_, (uint64_t)(int64_t)(num % den));
    }
  } else {
    int64_t num = (int64_t)join(numerator);
    int64_t den = (divcnt & 3) == 2 ? (int64_t)join(denominator) : (int64_t)(int32_t)denominator[0];
    if (den == 0) {
      split(quotient, (uint64_t)(num < 0 ? 1 : -1));
      split(remainder_, (uint64_t)num);
    } else if (num == INT64_MIN && den == -1) {
      split(quotient, 0x8000000000000000ull);
      split(remainder_, 0);
    } else {
      split(quotient, (uint64_t)(num / den));
      split(remainder_, (uint64_t)(num % den));
    }
  }
  if (!(denominator[0] | denominator[1])) divcnt |= 0x4000;
}

// the square root, as melonDS's SqrtDone does it, a bit at a time
static void square_root(void) {
  sqrtcnt &= ~0x8000u;
  uint64_t value = sqrtcnt & 1 ? join(radicand) : radicand[0], rest = 0;
  uint32_t result = 0, bits = sqrtcnt & 1 ? 32 : 16, top = sqrtcnt & 1 ? 62 : 30;
  for (uint32_t i = 0; i < bits; i++) {
    rest = (rest << 2) + ((value >> top) & 3);
    value <<= 2;
    result <<= 1;
    uint64_t product = ((uint64_t)result << 1) + 1;
    if (rest >= product) {
      rest -= product;
      result++;
    }
  }
  root = result;
}

static void settle(uint64_t now) {
  if (now >= divided_at) { divided_at = NEVER; divide(); }
  if (now >= rooted_at) { rooted_at = NEVER; square_root(); }
}

static void start_division(uint64_t now) {
  divcnt |= 0x8000;
  divided_at = now + ((divcnt & 3) == 0 ? 18 : 34);
}

static void start_root(uint64_t now) {
  sqrtcnt |= 0x8000;
  rooted_at = now + 13;
}

int nds_math_read(uint64_t now, uint32_t address, int bytes, uint32_t *value) {
  if (address < 0x04000280 || address >= 0x040002C0) return 0;
  settle(now);
  uint32_t r = address - 0x04000280, word;
  if (r < 4) word = divcnt;
  else if (r >= 0x10 && r < 0x18) word = numerator[(r >> 2) & 1];
  else if (r >= 0x18 && r < 0x20) word = denominator[(r >> 2) & 1];
  else if (r >= 0x20 && r < 0x28) word = quotient[(r >> 2) & 1];
  else if (r >= 0x28 && r < 0x30) word = remainder_[(r >> 2) & 1];
  else if (r >= 0x30 && r < 0x34) word = sqrtcnt;
  else if (r >= 0x34 && r < 0x38) word = root;
  else if (r >= 0x38 && r < 0x40) word = radicand[(r >> 2) & 1];
  else { nds_not_yet(); return 1; }
  // the controls are halfwords, read as a word with nothing above
  word >>= 8 * (r & 3);
  *value = bytes == 4 ? word : bytes == 2 ? word & 0xFFFF : word & 0xFF;
  return 1;
}

int nds_math_write(uint64_t now, uint32_t address, uint32_t value, int bytes) {
  if (address < 0x04000280 || address >= 0x040002C0) return 0;
  settle(now);
  uint32_t r = address - 0x04000280;
  // melonDS starts them again only on a halfword or word written to a control, which keeps 16 bits, or a word to a
  // number's
  if (r == 0 && bytes >= 2) { divcnt = value & 0xFFFF; start_division(now); return 1; }
  if (r == 0x30 && bytes >= 2) { sqrtcnt = value & 0xFFFF; start_root(now); return 1; }
  if (bytes != 4) { nds_not_yet(); return 1; }
  if (r == 0x10 || r == 0x14) numerator[(r >> 2) & 1] = value, start_division(now);
  else if (r == 0x18 || r == 0x1C) denominator[(r >> 2) & 1] = value, start_division(now);
  else if (r == 0x38 || r == 0x3C) radicand[(r >> 2) & 1] = value, start_root(now);
  else nds_not_yet();
  return 1;
}
