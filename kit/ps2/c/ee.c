// The EE's float sums (ps2.h): each worked out exactly, then cut towards zero to a float, whatever way the computer or
// WebAssembly rounds, which is to the nearest. Sums that overflow, and the tiny floats the console has none of, aren't
// done its way yet, nor are its divisions and square roots, which no proof has needed.

#include "ps2.h"

// the float next to `value` towards zero
static float inwards(float value) {
  uint32_t bits;
  __builtin_memcpy(&bits, &value, 4);
  bits--;
  __builtin_memcpy(&value, &bits, 4);
  return value;
}

// `sum` and `left` together are an exact result, `left` far smaller: the float it's cut to. `sum` rounds to a float, and
// what that left out, with `left`, says which side of the result the float is on
static float cut(double sum, double left) {
  float rounded = (float)sum;
  double out = sum - (double)rounded;
  if (out == 0) out = left;
  if (out == 0 || rounded == 0) return rounded;
  // further from zero than the result: the next float in
  return (rounded > 0) == (out < 0) ? inwards(rounded) : rounded;
}

float ee_add(float a, float b) {
  // two floats' sum doesn't always fit a double, and what's lost is found exactly (Knuth's two-sum)
  double x = a, y = b, sum = x + y, part = sum - x;
  return cut(sum, (x - (sum - part)) + (y - part));
}
float ee_sub(float a, float b) { return ee_add(a, -b); }
// two floats' product always fits a double
float ee_mul(float a, float b) { return cut((double)a * (double)b, 0); }
// a float too large for a whole number gives the largest there is, as the console does
int32_t ee_to_int(float value) {
  if (value >= 2147483648.0f) return INT32_MAX;
  if (value <= -2147483648.0f) return INT32_MIN;
  return (int32_t)value;
}
