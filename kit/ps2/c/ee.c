// The EE's float sums (ps2.h), which the vector units share: each worked out exactly, then cut towards zero to a float,
// whatever way the computer or WebAssembly rounds, which is to the nearest. The console has no floats tinier than the
// smallest ordinary one, so those count as zero going in and coming out. This is how the console's emulator does them
// (Play!, with its sums cut towards zero and its tiny floats flushed), which is what a Dreamport is proven against.
// Sums that overflow aren't done the console's way yet.

#include "ps2.h"

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

// a float tinier than the smallest ordinary one is zero, with its sign
static float flushed(float value) {
  uint32_t bits = bits_of(value);
  return bits & 0x7F800000 ? value : of_bits(bits & 0x80000000);
}

// `sum` and `left` together are an exact result, `left` far smaller: the float it's cut to. `sum` rounds to a float, and
// what that left out, with `left`, says which side of the result the float is on
static float cut(double sum, double left) {
  float rounded = (float)sum;
  double out = sum - (double)rounded;
  if (out == 0) out = left;
  if (out == 0 || rounded == 0) return flushed(rounded);
  // further from zero than the result: the next float in
  return flushed((rounded > 0) == (out < 0) ? of_bits(bits_of(rounded) - 1) : rounded);
}

float ee_add(float a, float b) {
  // two floats' sum doesn't always fit a double, and what's lost is found exactly (Knuth's two-sum)
  double x = flushed(a), y = flushed(b), sum = x + y, part = sum - x;
  return cut(sum, (x - (sum - part)) + (y - part));
}
float ee_sub(float a, float b) { return ee_add(a, -b); }
// two floats' product always fits a double
float ee_mul(float a, float b) { return cut((double)flushed(a) * (double)flushed(b), 0); }

float ee_div(float a, float b) {
  double x = flushed(a), y = flushed(b);
  // nothing divides by zero here: the units give their largest float, which a game's code asks for by name
  if (y == 0) return of_bits(0x7F7FFFFF | ((bits_of(a) ^ bits_of(b)) & 0x80000000));
  float rounded = (float)(x / y);
  if (rounded == 0) return flushed(rounded);
  // what's left of a once the float's share of it is taken away, which is exact, says which side of the result it is on
  double left = x - (double)rounded * y;
  int beyond = left != 0 && ((left > 0) == (y > 0)) != (rounded > 0);
  return flushed(beyond ? of_bits(bits_of(rounded) - 1) : rounded);
}

// the square root of a float, or of what it is without its sign, as the units take it: found a bit at a time in whole
// numbers, so it's cut and never rounded
float ee_sqrt(float value) {
  uint32_t bits = bits_of(flushed(value)) & 0x7FFFFFFF;
  if (bits == 0 || bits >= 0x7F800000) return of_bits(bits);
  int32_t exponent = (int32_t)(bits >> 23) - 127;
  uint64_t mantissa = (bits & 0x7FFFFF) | 0x800000;
  if (exponent & 1) { mantissa <<= 1; exponent--; }
  // the whole root of the mantissa with 23 more bits, which is the root's own 24
  uint64_t square = mantissa << 23, root = 0;
  for (uint64_t bit = 1ull << 23; bit; bit >>= 1) if ((root | bit) * (root | bit) <= square) root |= bit;
  return of_bits((uint32_t)(exponent / 2 + 127) << 23 | ((uint32_t)root & 0x7FFFFF));
}

// a float too large for a whole number gives the largest there is, as the console does
int32_t ee_to_int(float value) {
  if (value >= 2147483648.0f) return INT32_MAX;
  if (value <= -2147483648.0f) return INT32_MIN;
  return (int32_t)value;
}
// a whole number too long for a float is cut to one
float ee_from_int(int32_t value) { return cut((double)value, 0); }
