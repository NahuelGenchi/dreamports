// The processor's vector unit, the VFPU: PPSSPP's interpreter of it ported to C, from Core/MIPS/MIPSIntVFPU.cpp,
// MIPSVFPUUtils.cpp, MIPSInt.cpp and MIPS.cpp of PPSSPP 1.20.4. That code is the PPSSPP Project's, under the GNU GPL,
// version 2.0 or later, and so is this port of it. The tables its sines, cosines, arcsines, roots, reciprocals, powers
// of two and logarithms are read from are PPSSPP's own, from its assets/vfpu, kept in vfpu/ beside this file.
//
// Each instruction changes the registers and the control registers as PPSSPP's does, prefixes and all, and gives what
// the emulator gives to the bit. Where that hangs on the computer, it's written out here. A sum, difference, product,
// quotient or square root that is no number (NaN) comes out as the processor gives it to the emulator: the first of its
// operands that is no number, made quiet, or else the processor's own, which an x86-64 one makes 0xFFC00000 and an ARM
// one 0x7FC00000, and which the kit finds by asking the computer it runs on, as the emulator's sums do. Which operand is
// first is as the emulator's build for Windows has it, which isn't always as its source writes it, so a few sums and
// products below are written the other way round. The constants of vcst are the emulator's values.

#include "psp-kit.h"

#pragma STDC FP_CONTRACT OFF
#pragma clang diagnostic ignored "-Wc23-extensions"

struct psp_vfpu psp_vfpu_state;
int psp_vfpu_accurate_vmmul;

#define VR psp_vfpu_state.v
#define CTRL psp_vfpu_state.control
// the control registers PPSSPP names: the prefixes, the condition bits, and the random numbers' eight
enum { PFX_S, PFX_T, PFX_D, CTRL_CC, CTRL_REV = 7, CTRL_RCX = 8, CTRL_COUNT = 16 };
// an instruction's registers
#define VD ((int)(op & 0x7F))
#define VS ((int)((op >> 8) & 0x7F))
#define VT ((int)((op >> 16) & 0x7F))

// ---- PPSSPP's tables ------------------------------------------------------------------------------------------------

// each its own array, so a game's build keeps only those its instructions use; entries are little-endian
_Alignas(4) static const unsigned char vfpu_sin_lut8192[] = {
#embed "vfpu/vfpu_sin_lut8192.dat"
};
_Alignas(4) static const unsigned char vfpu_sin_lut_delta[] = {
#embed "vfpu/vfpu_sin_lut_delta.dat"
};
_Alignas(4) static const unsigned char vfpu_sin_lut_interval_delta[] = {
#embed "vfpu/vfpu_sin_lut_interval_delta.dat"
};
_Alignas(4) static const unsigned char vfpu_sin_lut_exceptions[] = {
#embed "vfpu/vfpu_sin_lut_exceptions.dat"
};
_Alignas(4) static const unsigned char vfpu_sqrt_lut[] = {
#embed "vfpu/vfpu_sqrt_lut.dat"
};
_Alignas(4) static const unsigned char vfpu_rsqrt_lut[] = {
#embed "vfpu/vfpu_rsqrt_lut.dat"
};
_Alignas(4) static const unsigned char vfpu_exp2_lut65536[] = {
#embed "vfpu/vfpu_exp2_lut65536.dat"
};
_Alignas(4) static const unsigned char vfpu_exp2_lut[] = {
#embed "vfpu/vfpu_exp2_lut.dat"
};
_Alignas(4) static const unsigned char vfpu_log2_lut65536[] = {
#embed "vfpu/vfpu_log2_lut65536.dat"
};
_Alignas(4) static const unsigned char vfpu_log2_lut65536_quadratic[] = {
#embed "vfpu/vfpu_log2_lut65536_quadratic.dat"
};
_Alignas(4) static const unsigned char vfpu_log2_lut[] = {
#embed "vfpu/vfpu_log2_lut.dat"
};
_Alignas(4) static const unsigned char vfpu_asin_lut65536[] = {
#embed "vfpu/vfpu_asin_lut65536.dat"
};
_Alignas(4) static const unsigned char vfpu_asin_lut_deltas[] = {
#embed "vfpu/vfpu_asin_lut_deltas.dat"
};
_Alignas(4) static const unsigned char vfpu_asin_lut_indices[] = {
#embed "vfpu/vfpu_asin_lut_indices.dat"
};
_Alignas(4) static const unsigned char vfpu_rcp_lut[] = {
#embed "vfpu/vfpu_rcp_lut.dat"
};

static inline uint16_t u16_at(const unsigned char *table, uint32_t i) {
  uint16_t v;
  __builtin_memcpy(&v, table + 2 * i, 2);
  return v;
}
static inline uint32_t u32_at(const unsigned char *table, uint32_t i) {
  uint32_t v;
  __builtin_memcpy(&v, table + 4 * i, 4);
  return v;
}
static inline uint64_t u64_at(const unsigned char *table, uint32_t i) {
  uint64_t v;
  __builtin_memcpy(&v, table + 8 * i, 8);
  return v;
}
// a pair's first or second byte, as PPSSPP's signed tables have it
static inline int8_t s8_at(const unsigned char *table, uint32_t i, int k) { return (int8_t)table[2 * i + (uint32_t)k]; }

// ---- floats as their bits, and what an x86-64 processor gives that is no number -------------------------------------

static inline uint32_t bits(float f) {
  uint32_t u;
  __builtin_memcpy(&u, &f, 4);
  return u;
}
static inline float flt(uint32_t u) {
  float f;
  __builtin_memcpy(&f, &u, 4);
  return f;
}
static inline int is_nan(float f) { return (bits(f) & 0x7FFFFFFFu) > 0x7F800000u; }
static inline int is_inf(float f) { return (bits(f) & 0x7FFFFFFFu) == 0x7F800000u; }
static inline int is_nan_or_inf(float f) { return (bits(f) & 0x7F800000u) == 0x7F800000u; }

// What the processor gives where an operation of a and b is no number: a made quiet if it is none, or else b, or else
// its own, which nothing divided by nothing gives
static float no_number(float a, float b) {
  if (is_nan(a)) return flt(bits(a) | 0x00400000u);
  if (is_nan(b)) return flt(bits(b) | 0x00400000u);
  volatile float zero = 0.0f;
  return zero / zero;
}
static inline float plus(float a, float b) {
  float r = a + b;
  return r == r ? r : no_number(a, b);
}
static inline float minus(float a, float b) {
  float r = a - b;
  return r == r ? r : no_number(a, b);
}
static inline float times(float a, float b) {
  float r = a * b;
  return r == r ? r : no_number(a, b);
}
static inline float over(float a, float b) {
  float r = a / b;
  return r == r ? r : no_number(a, b);
}
static inline float root(float a) {
  float r = __builtin_sqrtf(a);
  return r == r ? r : no_number(a, a);
}

// ---- PPSSPP's sines, roots, powers and logarithms (MIPSVFPUUtils.cpp) -----------------------------------------------

static inline uint32_t clz(uint32_t x) { return (uint32_t)__builtin_clz(x); }

// The PSP's sine has 22 significant bits.
static uint32_t sin_quantum(uint32_t x) { return x < 1u << 22 ? 1u : 1u << (32 - 22 - clz(x)); }

static uint32_t vfpu_sin_fixed(uint32_t arg) {
  if (arg == 0) return 0;
  if (arg == 0x00800000u) return 0x10000000u;
  // the ends of the 8192-wide interval, and of the 64-wide one by a line between them, adjusted by the deltas
  uint32_t L = u32_at(vfpu_sin_lut8192, arg >> 13), H = u32_at(vfpu_sin_lut8192, (arg >> 13) + 1);
  uint32_t A = L + (((H - L) * (((arg >> 6) & 127) + 0)) >> 7);
  uint32_t B = L + (((H - L) * (((arg >> 6) & 127) + 1)) >> 7);
  uint64_t a = ((uint64_t)A << 5) + (uint64_t)s8_at(vfpu_sin_lut_delta, arg >> 6, 0) * sin_quantum(A);
  uint64_t b = ((uint64_t)B << 5) + (uint64_t)s8_at(vfpu_sin_lut_delta, arg >> 6, 1) * sin_quantum(B);
  uint32_t v = (uint32_t)(((a * (64 - (arg & 63)) + b * (arg & 63)) >> 6) >> 5);
  v &= -sin_quantum(v);
  // the exceptions, by a binary search of those in this interval
  uint32_t at = arg >> 7;
  uint32_t lo = ((169u * (at + 0)) >> 7) + (uint32_t)(int16_t)u16_at(vfpu_sin_lut_interval_delta, at + 0) + 16384u;
  uint32_t hi = ((169u * (at + 1)) >> 7) + (uint32_t)(int16_t)u16_at(vfpu_sin_lut_interval_delta, at + 1) + 16384u;
  while (lo < hi) {
    uint32_t m = (lo + hi) / 2, e8 = vfpu_sin_lut_exceptions[m], e = (arg & -128u) + (e8 & 127u);
    if (e == arg) {
      v += sin_quantum(v) * (e8 >> 7 ? -1u : 1u);
      break;
    }
    if (e < arg) lo = m + 1;
    else hi = m;
  }
  return v;
}

// The angle in quarter turns, its sign and its place in the turn as a fixed-point number, as both sin and cos take it.
static uint32_t sin_place(uint32_t x, uint32_t *sign) {
  uint32_t exponent = (x >> 23) & 0xFF, significand = (x & 0x007FFFFFu) | 0x00800000u;
  if (exponent < 0x7F) {
    if (exponent < 0x7F - 23) significand = 0;
    else significand >>= (0x7F - exponent);
  } else if (exponent > 0x7F) {
    // There is weirdness for large exponents.
    if (exponent - 0x7F >= 25 && exponent - 0x7F < 32) significand = 0;
    else if ((exponent & 0x9F) == 0x9F) significand = 0;
    else significand <<= ((exponent - 0x7F) & 31);
  }
  *sign ^= (significand << 7) & 0x80000000u;
  return significand & 0x00FFFFFFu;
}

static float vfpu_sin(float x) {
  uint32_t u = bits(x), sign = u & 0x80000000u;
  if (((u >> 23) & 0xFF) == 0xFF) return flt(sign ^ 0x7F800001u);
  uint32_t significand = sin_place(u, &sign);
  if (significand > 0x00800000u) significand = 0x01000000u - significand;
  uint32_t ret = vfpu_sin_fixed(significand);
  return (sign ? -1.0f : +1.0f) * (float)(int32_t)ret * 3.7252903e-09f; // 2 to the -28
}

static float vfpu_cos(float x) {
  uint32_t u = bits(x) & 0x7FFFFFFFu, sign = 0;
  if (((u >> 23) & 0xFF) == 0xFF) return flt(0x7F800001u);
  uint32_t significand = sin_place(u, &sign);
  if (significand >= 0x00800000u) {
    significand = 0x01000000u - significand;
    sign ^= 0x80000000u;
  }
  uint32_t ret = vfpu_sin_fixed(0x00800000u - significand);
  return (sign ? -1.0f : +1.0f) * (float)(int32_t)ret * 3.7252903e-09f;
}

// The whole square root of 2^23 times x, for 2^23 <= x < 2^25, and 2^33 over the root of x, for 2^22 <= x <= 2^24.
static uint32_t isqrt23(uint32_t x) { return (uint32_t)(int32_t)__builtin_sqrt((double)x * 8388608.0); }
static uint32_t rsqrt_floor22(uint32_t x) { return (uint32_t)(8589934592.0 / __builtin_sqrt((double)x)); }

static uint32_t vfpu_sqrt_fixed(uint32_t x) {
  uint32_t lo = (x + 0u) & -64u, hi = (x + 64u) & -64u;
  lo = lo >= 0x00400000u ? 4u * lo : 0x00800000u + 2u * lo;
  hi = hi >= 0x00400000u ? 4u * hi : 0x00800000u + 2u * hi;
  uint32_t A = 0x3F000000u + isqrt23(lo), B = 0x3F000000u + isqrt23(hi);
  uint64_t a = ((uint64_t)A << 4) + (uint64_t)s8_at(vfpu_sqrt_lut, x >> 6, 0);
  uint64_t b = ((uint64_t)B << 4) + (uint64_t)s8_at(vfpu_sqrt_lut, x >> 6, 1);
  return (uint32_t)((a + (((b - a) * (x & 63)) >> 6)) >> 4) & -4u;
}

static float vfpu_sqrt(float x) {
  uint32_t u = bits(x);
  if ((u & 0x7FFFFFFFu) <= 0x007FFFFFu) return +0.0f;
  if (u >> 31) return flt(0x7F800001u);
  if ((u >> 23) == 255u) return flt(0x7F800000u + ((u & 0x007FFFFFu) != 0u));
  int32_t exponent = (int32_t)(u >> 23) - 127;
  uint32_t index = ((u + 0x00800000u) >> 1) & 0x007FFFFFu;
  return flt(vfpu_sqrt_fixed(index) + ((uint32_t)(exponent >> 1) << 23));
}

static uint32_t vfpu_rsqrt_fixed(uint32_t x) {
  uint32_t lo = (x + 0u) & -64u, hi = (x + 64u) & -64u;
  lo = lo >= 0x00400000u ? 2u * lo : 0x00400000u + lo;
  hi = hi >= 0x00400000u ? 2u * hi : 0x00400000u + hi;
  uint32_t A = 0x3E800000u + 4u * rsqrt_floor22(lo), B = 0x3E800000u + 4u * rsqrt_floor22(hi);
  uint64_t a = ((uint64_t)A << 4) + (uint64_t)s8_at(vfpu_rsqrt_lut, x >> 6, 0);
  uint64_t b = ((uint64_t)B << 4) + (uint64_t)s8_at(vfpu_rsqrt_lut, x >> 6, 1);
  return (uint32_t)((a + (((b - a) * (x & 63)) >> 6)) >> 4) & -4u;
}

static float vfpu_rsqrt(float x) {
  uint32_t u = bits(x);
  if ((u & 0x7FFFFFFFu) <= 0x007FFFFFu) return flt(0x7F800000u | (u & 0x80000000u));
  if (u >> 31) return flt(0xFF800001u);
  if ((u >> 23) == 255u) return flt(u & 0x007FFFFFu ? 0x7F800001u : 0u);
  int32_t exponent = (int32_t)(u >> 23) - 127;
  uint32_t index = ((u + 0x00800000u) >> 1) & 0x007FFFFFu;
  return flt(vfpu_rsqrt_fixed(index) - ((uint32_t)(exponent >> 1) << 23));
}

static uint32_t asin_quantum(uint32_t x) { return x < 1u << 23 ? 1u : 1u << (32 - 23 - clz(x)); }

// Input fixed 9.23, output fixed 2.30.
static uint32_t vfpu_asin_approx(uint32_t x) {
  uint32_t i = x >> 16;
  int64_t c0 = (int32_t)u32_at(vfpu_asin_lut65536, 3 * i), c1 = (int32_t)u32_at(vfpu_asin_lut65536, 3 * i + 1);
  int64_t c2 = (int32_t)u32_at(vfpu_asin_lut65536, 3 * i + 2);
  x &= 0xFFFFu;
  uint32_t v = (uint32_t)((((((c2 * x) >> 16) + c1) * x) >> 16) + c0);
  return v & -asin_quantum(v);
}

static uint32_t vfpu_asin_fixed(uint32_t x) {
  if (x == 0) return 0;
  if (x == 1u << 23) return 1u << 30;
  uint32_t ret = vfpu_asin_approx(x);
  uint64_t deltas = u64_at(vfpu_asin_lut_deltas, u16_at(vfpu_asin_lut_indices, x / 21u));
  return ret + (3u - (uint32_t)((deltas >> (3u * (x % 21u))) & 7u)) * asin_quantum(ret);
}

static float vfpu_asin(float x) {
  uint32_t u = bits(x), sign = u & 0x80000000u;
  if ((u & 0x7FFFFFFFu) > 0x3F800000u) return flt(0x7F800001u ^ sign);
  uint32_t ret = vfpu_asin_fixed((uint32_t)(int32_t)(__builtin_fabsf(x) * 8388608.0f)); // 2 to the 23
  x = (float)(int32_t)ret * 9.31322574615478515625e-10f;                                // 2 to the -30
  return sign ? -x : x;
}

static uint32_t vfpu_exp2_approx(uint32_t x) {
  if (x == 0x00800000u) return 0x00800000u;
  uint32_t a = u32_at(vfpu_exp2_lut65536, x >> 16);
  x &= 0x0000FFFFu;
  uint32_t b = (uint32_t)(((2977151143ull * x) >> 23) + ((1032119999ull * (x * x)) >> 46));
  return (a + (uint32_t)(((uint64_t)(a + (1u << 23)) * (uint64_t)b) >> 32)) & -4u;
}

static uint32_t vfpu_exp2_fixed(uint32_t x) {
  if (x == 0) return 0;
  if (x == 0x00800000u) return 0x00800000u;
  uint32_t A = vfpu_exp2_approx(x & -64u), B = vfpu_exp2_approx((x + 64) & -64u);
  // in 32 bits before it's widened, as PPSSPP has it
  uint64_t a = (A << 4) + vfpu_exp2_lut[2 * (x >> 6)] - 64u;
  uint64_t b = (B << 4) + vfpu_exp2_lut[2 * (x >> 6) + 1] - 64u;
  return (uint32_t)((a + (((b - a) * (x & 63)) >> 6)) >> 4) & -4u;
}

static float vfpu_exp2(float x) {
  int32_t u = (int32_t)bits(x);
  if ((u & 0x7FFFFFFF) <= 0x007FFFFF) return 1.0f; // denormals are taken as 0
  if (x != x) return flt(0x7F800001u);
  if (x <= -126.0f) return 0.0f;
  if (x >= +128.0f) return flt(0x7F800000u);
  u = (int32_t)(x * 0x1p23f);
  if (x < 0.0f) --u; // Yes, really.
  u = (int32_t)0x3F800000 + (u & (int32_t)0xFF800000) + (int32_t)vfpu_exp2_fixed((uint32_t)u & 0x007FFFFFu);
  return flt((uint32_t)u);
}

static float vfpu_rexp2(float x) { return vfpu_exp2(-x); }

// Input fixed 9.23, output fixed 10.22: log2(1 + x).
static uint32_t vfpu_log2_approx(uint32_t x) {
  uint32_t a = u32_at(vfpu_log2_lut65536, (x >> 16) + 0), b = u32_at(vfpu_log2_lut65536, (x >> 16) + 1);
  uint32_t c = u32_at(vfpu_log2_lut65536_quadratic, x >> 16);
  x &= 0xFFFFu;
  uint64_t ret = (uint64_t)a * (0x10000u - x) + (uint64_t)b * x;
  ret += ((uint64_t)c * x * (0x10000u - x)) >> 40;
  return (uint32_t)(ret >> 16);
}

static float vfpu_log2(float x) {
  uint32_t u = bits(x);
  if ((u & 0x7FFFFFFFu) <= 0x007FFFFFu) return flt(0xFF800000u);
  if (u & 0x80000000u) return flt(0x7F800001u);
  if ((u >> 23) == 255u) return flt(0x7F800000u + ((u & 0x007FFFFFu) != 0));
  uint32_t e = (u & 0x7F800000u) - 0x3F800000u, i = u & 0x007FFFFFu;
  if (e >> 31 && i >= 0x007FFE00u) {
    // 1 - 2^-14 <= x * 2^n < 1 (for n > 0), which the table doesn't give right
    float c = (float)((int32_t)~e >> 23);
    return i < 0x007FFEF7u ? -3.05175781e-05f - c : -0.0f - c;
  }
  int d = e < 0x01000000u ? 0 : 8 - (int)clz(e) - (int)(e >> 31);
  uint32_t q = 1u << d, row = (uint32_t)d * 131072u + (i >> 6);
  uint32_t A = vfpu_log2_approx(i & -64u) & -q, B = vfpu_log2_approx((i + 64) & -64u) & -q;
  uint64_t a = (A << 6) + ((uint64_t)vfpu_log2_lut[2 * row] - 80ull) * q;
  uint64_t b = (B << 6) + ((uint64_t)vfpu_log2_lut[2 * row + 1] - 80ull) * q;
  uint32_t v = (uint32_t)((a + (((b - a) * (i & 63)) >> 6)) >> 6) & -q;
  return (float)(int32_t)(e ^ (2u * v)) * 1.1920928955e-7f; // 2 to the -23
}

static uint32_t vfpu_rcp_approx(uint32_t i) {
  return 0x3E800000u + ((uint32_t)((1ull << 47) / ((1ull << 23) + i)) & -4u);
}

static float vfpu_rcp(float x) {
  uint32_t u = bits(x), s = u & 0x80000000u, e = u & 0x7F800000u, i = u & 0x007FFFFFu;
  if ((u & 0x7FFFFFFFu) > 0x7E800000u) return flt(e == 0x7F800000u && i ? s ^ 0x7F800001u : s);
  if (e == 0) return flt(s ^ 0x7F800000u);
  uint32_t A = vfpu_rcp_approx(i & -64u), B = vfpu_rcp_approx((i + 64) & -64u);
  uint64_t a = ((uint64_t)A << 6) + (uint64_t)s8_at(vfpu_rcp_lut, i >> 6, 0) * 4u;
  uint64_t b = ((uint64_t)B << 6) + (uint64_t)s8_at(vfpu_rcp_lut, i >> 6, 1) * 4u;
  uint32_t v = (uint32_t)((a + (((b - a) * (i & 63)) >> 6)) >> 6) & -4u;
  return flt(s + (0x3F800000u - e) + v);
}

// The dot product of four as the PSP rounds it, which vmmul uses with MoreAccurateVMMUL. PPSSPP runs an SSE2 version
// of this on x86-64, which gives the same as this one in the processor's usual rounding, to the nearest.
static float vfpu_dot(const float a[4], const float b[4]) {
  int32_t exps[4], mants[4], signs[4], max_exp = 0, last_inf = -1;
  for (int i = 0; i < 4; i++) {
    uint32_t ua = bits(a[i]), ub = bits(b[i]);
    int32_t aexp = (int32_t)((ua >> 23) & 0xFF), bexp = (int32_t)((ub >> 23) & 0xFF);
    uint32_t amant = ((ua & 0x007FFFFFu) | 0x00800000u) << 2, bmant = ((ub & 0x007FFFFFu) | 0x00800000u) << 2;
    exps[i] = aexp + bexp - 127;
    if (aexp == 255) {
      // INF * 0 = NAN
      if ((ua & 0x007FFFFFu) != 0 || bexp == 0) return flt(0x7F800001u);
      mants[i] = 0x00800000 << 2;
      exps[i] = 255;
    } else if (bexp == 255) {
      if ((ub & 0x007FFFFFu) != 0 || aexp == 0) return flt(0x7F800001u);
      mants[i] = 0x00800000 << 2;
      exps[i] = 255;
    } else {
      mants[i] = (int32_t)((((uint64_t)amant * bmant) >> 25) & 0x7FFFFFFF);
    }
    signs[i] = (int32_t)((ua ^ ub) & 0x80000000u);
    if (exps[i] > max_exp) max_exp = exps[i];
    if (exps[i] >= 255) {
      // Infinity minus infinity is not a real number.
      if (last_inf != -1 && signs[i] != last_inf) return flt(0x7F800001u);
      last_inf = signs[i];
    }
  }
  int32_t mant_sum = 0;
  for (int i = 0; i < 4; i++) {
    int exp = max_exp - exps[i];
    mants[i] = exp >= 32 ? 0 : mants[i] >> exp;
    mant_sum += signs[i] ? -mants[i] : mants[i];
  }
  uint32_t sign_sum = 0;
  if (mant_sum < 0) {
    sign_sum = 0x80000000u;
    mant_sum = -mant_sum;
  }
  // The extra bits off, with what they were zeroed for rounding.
  mant_sum >>= 2;
  if (mant_sum == 0 || max_exp <= 0) return 0.0f;
  int8_t shift = (int8_t)((int)clz((uint32_t)mant_sum) - 8);
  if (shift < 0) {
    // Round to even if we'd shift away a 0.5.
    uint32_t round_bit = 1u << (-shift - 1), m = (uint32_t)mant_sum;
    if ((m & round_bit) && ((m & (round_bit << 1)) || (m & (round_bit - 1)))) {
      mant_sum += (int32_t)round_bit;
      shift = (int8_t)((int)clz((uint32_t)mant_sum) - 8);
    }
    mant_sum >>= -shift;
    max_exp += -shift;
  } else {
    mant_sum <<= shift;
    max_exp -= shift;
  }
  if (max_exp >= 255) {
    max_exp = 255;
    mant_sum = 0;
  } else if (max_exp <= 0) {
    return 0.0f;
  }
  return flt(sign_sum | (uint32_t)max_exp << 23 | ((uint32_t)mant_sum & 0x007FFFFFu));
}

// The random numbers' state, in the eight control registers from RCX0: set from a seed, and the next number.
static void vrnd_init(uint32_t seed, uint32_t *rcx) {
  for (int i = 0; i < 8; i++)
    rcx[i] = 0x3F800000u | ((seed >> ((i / 4) * 16)) & 0xFFFFu) | (((seed >> (4 * i)) & 0xFu) << 16);
}

static uint32_t vrnd_generate(uint32_t *rcx) {
  uint32_t A = (rcx[0] & 0xFFFFu) | (rcx[4] << 16), B = (rcx[1] & 0xFFFFu) | (rcx[5] << 16);
  uint32_t C = (rcx[2] & 0xFFFFu) | (rcx[6] << 16), D = (rcx[3] & 0xFFFFu) | (rcx[7] << 16), E = 0;
  for (int i = 0; i < 8; i++) E |= ((rcx[i] >> 16) & 0xFu) << (4 * i);
  A = 69069u * A + 1u;
  B ^= B << 13;
  B ^= B >> 17;
  B ^= B << 5;
  uint32_t t = 2u * D + C + E;
  E = (uint32_t)(((uint64_t)C + (uint64_t)(D >> 1) + (uint64_t)E) >> 32);
  C = D;
  D = t;
  uint32_t low[4] = { A, B, C, D };
  for (int i = 0; i < 8; i++)
    rcx[i] = 0x3F800000u | (((E >> (4 * i)) & 0xFu) << 16) | (i < 4 ? low[i] & 0xFFFFu : low[i - 4] >> 16);
  return A + B + D;
}

// vfim's half-precision float.
static float float16_to_float32(uint32_t half) {
  uint32_t sign = (half >> 15) & 1, fraction = half & 0x3FF;
  int exponent = (int)((half >> 10) & 0x1F);
  if (exponent == 0x1F) return flt(sign << 31 | 255u << 23 | fraction);
  if (exponent == 0 && fraction == 0) return sign ? -0.0f : 0.0f;
  if (exponent == 0) {
    do {
      fraction <<= 1;
      exponent--;
    } while (!(fraction & 0x400));
    fraction &= 0x3FF;
  }
  return flt(sign << 31 | (uint32_t)(exponent + 112) << 23 | fraction << 13);
}

// vh2f's and vf2h's halves (PPSSPP's ExpandHalf and ShrinkToHalf).
static float expand_half(uint32_t half) {
  float f = flt((half & 0x7FFF) << 13) * 0x1p112f;
  uint32_t u = f >= 65536.0f ? 255u << 23 | (half & 0x3FF) : bits(f);
  return flt(u | (half & 0x8000) << 16);
}

static uint32_t shrink_to_half(float full) {
  uint32_t u = bits(full), sign = u & 0x80000000u, out;
  u ^= sign;
  if (u >= 0x7F800000u) {
    out = u > 0x7F800000u ? 0x7E00 | (u & 0x3FF) : 0x7C00;
  } else {
    u = bits(flt(u & ~0xFFFu) * 0x1p-112f) + 0x1000u;
    if (u > 31u << 23) u = 31u << 23;
    out = (u >> 13) & 0xFFFF;
  }
  return out | sign >> 16;
}

// vcst's constants, as the emulator works them out.
static const uint32_t cst_constants[32] = {
  0x00000000, 0x7F7FFFFF, 0x3FB504F3, 0x3F3504F3, 0x3F906EBA, 0x3F22F983, 0x3EA2F983, 0x3F490FDB,
  0x3FC90FDB, 0x40490FDB, 0x402DF854, 0x3FB8AA3B, 0x3EDE5BD9, 0x3F317218, 0x40135D8E, 0x40C90FDB,
  0x3F060A92, 0x3E9A209B, 0x40549A78, 0x3F5DB3D7,
};

// PPSSPP's interpreter has its own versions of these off: its dot products are sums, and its roots the C library's.
enum { USE_VFPU_SQRT = 0 };

// ---- the prefixes ---------------------------------------------------------------------------------------------------

static const float constants[8] = { 0.0f, 1.0f, 2.0f, 0.5f, 3.0f, 1.0f / 3.0f, 0.25f, 1.0f / 6.0f };
enum { NONE = -1, ZERO, ONE, TWO, HALF, THREE, THIRD, FOURTH, SIXTH };

static uint32_t swizzle(int x, int y, int z, int w) { return (uint32_t)(x | y << 2 | z << 4 | w << 6); }
static uint32_t lanes(int x, int y, int z, int w) { return (uint32_t)(x | y << 1 | z << 2 | w << 3); }
#define ANY_SWIZZLE 0xFFu
#define ABS(x, y, z, w) (lanes(x, y, z, w) << 8)
#define NEGATE(x, y, z, w) (lanes(x, y, z, w) << 16)
// lanes made constants, with what makes each one, for those that aren't NONE
static uint32_t constants_of(int x, int y, int z, int w) {
  int c[4] = { x, y, z, w };
  uint32_t out = 0;
  for (int i = 0; i < 4; i++)
    if (c[i] != NONE) out |= (uint32_t)((c[i] & 3) << (2 * i) | (c[i] & 4) << (6 + i) | 1 << (12 + i));
  return out;
}
static uint32_t rewrite(int which, uint32_t remove, uint32_t add) { return (CTRL[which] & ~remove) | add; }

// An S or T prefix on n lanes of r: each lane takes a lane (`invalid` past the n), or a constant, its sign as asked.
static void prefix_st(float *r, uint32_t data, int n, float invalid) {
  if (data == 0xE4) return;
  float was[4] = { invalid, invalid, invalid, invalid };
  for (int i = 0; i < n; i++) was[i] = r[i];
  for (int i = 0; i < n; i++) {
    uint32_t lane = (data >> (2 * i)) & 3, abs = (data >> (8 + i)) & 1, out;
    if ((data >> (12 + i)) & 1) out = bits(constants[lane + (abs << 2)]);
    else out = abs ? bits(was[lane]) & 0x7FFFFFFFu : bits(was[lane]);
    if ((data >> (16 + i)) & 1) out ^= 0x80000000u;
    r[i] = flt(out);
  }
}
static void prefix_s(float *r, int n) { prefix_st(r, CTRL[PFX_S], n, 0.0f); }
static void prefix_t(float *r, int n) { prefix_st(r, CTRL[PFX_T], n, 0.0f); }

// NaN stays, and -0.0 becomes +0.0 when min is +0.0.
static float clamp(float v, float min, float max) { return v >= max ? max : (v <= min ? min : v); }

// The D prefix's saturation on n lanes, unless it's to keep only its write mask, which the writes use.
static void prefix_d(float *v, int n, int mask_only) {
  uint32_t data = CTRL[PFX_D];
  if (!data || mask_only) return;
  for (int i = 0; i < n; i++) {
    uint32_t sat = (data >> (2 * i)) & 3;
    if (sat == 1) v[i] = clamp(v[i], 0.0f, 1.0f);
    else if (sat == 3) v[i] = clamp(v[i], -1.0f, 1.0f);
  }
}

// The D prefix's x lane moved to the last of n, for the instructions it applies to that lane alone in.
static void prefix_d_last(int n) {
  uint32_t data = CTRL[PFX_D];
  CTRL[PFX_D] = (data & (1u << 8)) << (n - 1) | (data & 3) << (n + n - 2);
}

// A lane whose S or T prefix names a lane past the n gives 0, for some instructions.
static void retain_invalid(float *d, int n) {
  uint32_t s = CTRL[PFX_S], t = CTRL[PFX_T];
  for (int i = 0; i < n; i++) {
    int swizzle_s = (int)((s >> (i + i)) & 3), swizzle_t = (int)((t >> (i + i)) & 3);
    if ((swizzle_s >= n && !((s >> (12 + i)) & 1)) || (swizzle_t >= n && !((t >> (12 + i)) & 1))) d[i] = 0.0f;
  }
}

static void eat_prefixes(void) {
  CTRL[PFX_S] = 0xE4;
  CTRL[PFX_T] = 0xE4;
  CTRL[PFX_D] = 0;
}

// ---- the registers --------------------------------------------------------------------------------------------------

// A register's number: its matrix in bits 2-4, its column in 0-1, its row in 5-6. PPSSPP keeps a matrix's 16 together,
// a column at a time.
static uint32_t *single(int reg) { return &VR[((reg >> 2) & 7) * 16 + (reg & 3) * 4 + ((reg >> 5) & 3)]; }
static int vector_size(uint32_t op) { return (int)((op >> 7) & 1) + (int)((op >> 14) & 2) + 1; }
// where a pair, triple or quad starts in its column (or row, transposed)
static int first_of(int n, int reg) { return n == 3 ? (reg >> 6) & 1 : (reg >> 5) & 2; }

static uint32_t *lane_of(int n, int reg, int i) {
  int base = (reg << 2) & 0x70, col = reg & 3, row = first_of(n, reg);
  if ((reg >> 5) & 1) return &VR[base + col + ((row + i) & 3) * 4];
  return &VR[base + col * 4 + ((row + i) & 3)];
}

static void read_vector(float *rd, int n, int reg) {
  if (n == 1) {
    rd[0] = flt(*single(reg));
    return;
  }
  for (int i = 0; i < n; i++) rd[i] = flt(*lane_of(n, reg, i));
}

// A vector written, but for the lanes the D prefix's write mask keeps.
static void write_vector(const float *rs, int n, int reg) {
  uint32_t mask = (CTRL[PFX_D] >> 8) & 0xF;
  if (n == 1) {
    if (!(mask & 1)) *single(reg) = bits(rs[0]);
    return;
  }
  for (int i = 0; i < n; i++)
    if (!((mask >> i) & 1)) *lane_of(n, reg, i) = bits(rs[i]);
}

// A matrix of side n, as rd[column * 4 + row].
static uint32_t *element_of(int n, int reg, int j, int i) {
  int transpose = n == 1 ? 0 : (reg >> 5) & 1, row = n == 1 ? (reg >> 5) & 3 : first_of(n, reg), col = reg & 3;
  uint32_t *v = VR + ((reg >> 2) & 7) * 16;
  return transpose ? &v[((row + i) & 3) * 4 + ((col + j) & 3)] : &v[((col + j) & 3) * 4 + ((row + i) & 3)];
}

static void read_matrix(float *rd, int n, int reg) {
  for (int j = 0; j < n; j++)
    for (int i = 0; i < n; i++) rd[j * 4 + i] = flt(*element_of(n, reg, j, i));
}

// The write mask keeps lanes of the last column (or row, transposed) only.
static void write_matrix(const float *rs, int n, int reg) {
  uint32_t mask = (CTRL[PFX_D] >> 8) & 0xF;
  for (int j = 0; j < n; j++)
    for (int i = 0; i < n; i++)
      if (j != n - 1 || !((mask >> i) & 1)) *element_of(n, reg, j, i) = bits(rs[j * 4 + i]);
}

// The numbers of a vector's registers, as vrot compares them.
static void vector_regs(uint8_t regs[4], int n, int reg) {
  int mtx = (reg >> 2) & 7, col = reg & 3, transpose = n == 1 ? 0 : (reg >> 5) & 1;
  int row = n == 1 ? (reg >> 5) & 3 : first_of(n, reg);
  for (int i = 0; i < n; i++)
    regs[i] = (uint8_t)(mtx * 4 + (transpose ? ((row + i) & 3) + col * 32 : col + ((row + i) & 3) * 32));
}

// ---- the instructions (MIPSIntVFPU.cpp) -----------------------------------------------------------------------------

static void vpfx(uint32_t op) {
  uint32_t data = op & 0x000FFFFF, which = (op >> 24) & 3;
  if (which == PFX_D) data &= 0x00000FFF;
  CTRL[which] = data;
}

// vmidt, vmzero, vmone
static void vmatrix_init(uint32_t op) {
  static const float idt[16] = { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 }, zero[16], one[16] = {
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
  };
  int n = vector_size(op), kind = (op >> 16) & 0xF;
  const float *m = kind == 3 ? idt : kind == 6 ? zero : kind == 7 ? one : 0;
  if (!m) {
    eat_prefixes();
    return;
  }
  // The S prefix makes constants, but only for the final (possibly transposed) row.
  if (CTRL[PFX_S] & 0xF0F00) {
    float prefixed[16];
    int off = n - 1;
    for (int i = 0; i < 16; i++) prefixed[i] = m[i];
    int c = kind == 7 ? ONE : ZERO;
    uint32_t add = kind == 3 ? constants_of(off == 0, off == 1, off == 2, off == 3) : constants_of(c, c, c, c);
    prefix_st(&prefixed[off * 4], rewrite(PFX_S, ANY_SWIZZLE, add), 4, 0.0f);
    write_matrix(prefixed, n, VD);
  } else {
    write_matrix(m, n, VD);
  }
  eat_prefixes();
}

// vzero, vone
static void vvector_init(uint32_t op) {
  float d[4] = { 0 };
  int n = vector_size(op), c = ((op >> 16) & 0xF) == 6 ? ZERO : ONE;
  // The S prefix makes the constants, but negate is still respected.
  prefix_st(d, rewrite(PFX_S, ANY_SWIZZLE, constants_of(c, c, c, c)), n, 0.0f);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// viim, vfim
static void viim(uint32_t op) {
  uint32_t type = (op >> 23) & 7;
  float f = type == 6 ? (float)(int16_t)(op & 0xFFFF) : type == 7 ? float16_to_float32(op & 0xFFFF) : 0.0f;
  prefix_d(&f, 1, 0);
  write_vector(&f, 1, VT);
  eat_prefixes();
}

static void vidt(uint32_t op) {
  float f[4] = { 0 };
  int n = vector_size(op), offmask = n >= 3 ? 3 : 1, off = VD & offmask;
  // A pair's identity starts at its own place.
  uint32_t add = constants_of(off == (0 & offmask), off == (1 & offmask), off == (2 & offmask), off == (3 & offmask));
  prefix_st(f, rewrite(PFX_S, ANY_SWIZZLE, add), n, 0.0f);
  prefix_d(f, n, 0);
  write_vector(f, n, VD);
  eat_prefixes();
}

static void vmmul(uint32_t op) {
  float s[16] = { 0 }, t[16] = { 0 }, d[16] = { 0 };
  int n = vector_size(op);
  read_matrix(s, n, VS);
  read_matrix(t, n, VT);
  for (int a = 0; a < n; a++) {
    for (int b = 0; b < n; b++) {
      float *sb = &s[b * 4], *ta = &t[a * 4], sum;
      int last = a == n - 1 && b == n - 1;
      // S and T prefixes work on the final dot.
      if (last) {
        prefix_s(sb, 4);
        prefix_t(ta, 4);
      }
      if (psp_vfpu_accurate_vmmul) {
        uint32_t u = bits(vfpu_dot(sb, ta));
        if ((u & 0x7FFFFFFFu) > 0x7F800000u) u = 0x7F800001u;
        else if ((u & 0x7F800000u) == 0) u &= 0xFF800000u;
        sum = flt(u);
      } else if (last) {
        sum = plus(times(sb[0], ta[0]), 0.0f);
        for (int c = 1; c < 4; c++) sum = plus(sum, times(sb[c], ta[c]));
      } else {
        // the emulator's build adds the second and fourth products in front of the sum so far
        sum = plus(times(sb[0], ta[0]), 0.0f);
        for (int c = 1; c < n; c++) sum = c & 1 ? plus(times(sb[c], ta[c]), sum) : plus(sum, times(sb[c], ta[c]));
      }
      d[a * 4 + b] = sum;
    }
  }
  // The D prefix applies only to the final element, but sat does work.
  prefix_d_last(n);
  prefix_d(&d[4 * (n - 1)], 4, 0);
  write_matrix(d, n, VD);
  eat_prefixes();
}

static void vmscl(uint32_t op) {
  float s[16] = { 0 }, t[4] = { 0 }, d[16] = { 0 };
  int n = vector_size(op), vt = VT;
  read_matrix(s, n, VS);
  read_vector(t, 1, vt);
  for (int a = 0; a < n - 1; a++)
    for (int b = 0; b < n; b++) d[a * 4 + b] = times(s[a * 4 + b], t[0]);
  // The S prefix applies to the last row, and T to it per lane, swizzled to the lane the scale is read from.
  prefix_s(&s[(n - 1) * 4], 4);
  int tlane = (vt >> 5) & 3;
  t[tlane] = t[0];
  prefix_st(t, rewrite(PFX_T, ANY_SWIZZLE, swizzle(tlane, tlane, tlane, tlane)), 4, 0.0f);
  // the emulator's build multiplies t's by s's in the first two lanes of a pair or triple
  for (int b = 0; b < n; b++) {
    float *at = &d[(n - 1) * 4 + b], sv = s[(n - 1) * 4 + b];
    *at = (n == 2 || (n == 3 && b < 2)) ? times(t[b], sv) : times(sv, t[b]);
  }
  prefix_d(&d[(n - 1) * 4], 4, 0);
  write_matrix(d, n, VD);
  eat_prefixes();
}

static void vmmov(uint32_t op) {
  float s[16] = { 0 };
  int n = vector_size(op), off = n - 1;
  read_matrix(s, n, VS);
  // S and D prefixes apply to the last row.
  prefix_s(&s[off * 4], 4);
  prefix_d(&s[off * 4], 4, 0);
  write_matrix(s, n, VD);
  eat_prefixes();
}

// vflush, vnop, vsync: only 0xFFFFxxxx keeps the prefixes.
static void vflush(uint32_t op) {
  if ((op & 0xFFFF0000u) != 0xFFFF0000u) eat_prefixes();
}

// vmov, vabs, vneg, vsat0, vsat1, vrcp, vrsq, vsin, vcos, vexp2, vlog2, vsqrt, vasin, vnrcp, vnsin, vrexp2
static void vv2op(uint32_t op) {
  float s[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), type = (op >> 16) & 0x1F;
  read_vector(s, n, VS);
  // Some of these are prefix hacks (affects constants, etc.)
  if (type == 1) prefix_st(s, rewrite(PFX_S, 0, ABS(1, 1, 1, 1)), n, 0.0f);
  else if (type == 2) prefix_st(s, rewrite(PFX_S, 0, NEGATE(1, 1, 1, 1)), n, 0.0f);
  else if (type >= 16 && type <= 23) prefix_st(&s[n - 1], CTRL[PFX_S], 1, __builtin_inff());
  else if (type == 24 || type == 26) prefix_st(&s[n - 1], rewrite(PFX_S, NEGATE(1, 0, 0, 0), 0), 1, -__builtin_inff());
  else if (type == 28) prefix_st(&s[n - 1], rewrite(PFX_S, NEGATE(1, 0, 0, 0), 0), 1, __builtin_inff());
  else prefix_s(s, n);
  for (int i = 0; i < n; i++) {
    float v = s[i];
    switch (type) {
    case 0: case 1: case 2: d[i] = v; break;
    case 4: d[i] = v <= 0 ? 0 : v > 1.0f ? 1.0f : v; break; // vsat0 changes -0.0 to +0.0, both keep NaN
    case 5: d[i] = v < -1.0f ? -1.0f : v > 1.0f ? 1.0f : v; break;
    case 16: d[i] = vfpu_rcp(v); break;
    case 17: d[i] = USE_VFPU_SQRT ? vfpu_rsqrt(v) : over(1.0f, root(v)); break;
    case 18: d[i] = vfpu_sin(v); break;
    case 19: d[i] = vfpu_cos(v); break;
    case 20: d[i] = vfpu_exp2(v); break;
    case 21: d[i] = vfpu_log2(v); break;
    case 22: d[i] = USE_VFPU_SQRT ? vfpu_sqrt(v) : __builtin_fabsf(root(v)); break;
    case 23: d[i] = vfpu_asin(v); break;
    case 24: d[i] = -vfpu_rcp(v); break;
    case 26: d[i] = -vfpu_sin(v); break;
    case 28: d[i] = vfpu_rexp2(v); break;
    }
  }
  // vsat1 is a prefix hack, so 0:1 doesn't apply; the others from vrcp on take the D prefix on their last lane alone.
  if (type == 5) {
    prefix_d(d, n, 1);
  } else {
    if (type >= 16) prefix_d_last(n);
    prefix_d(d, n, 0);
  }
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vocp(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  read_vector(s, n, VS);
  // S forces the negate flags; T forces constants of 1, so abs makes another and negate still works.
  prefix_st(s, rewrite(PFX_S, 0, NEGATE(1, 1, 1, 1)), n, 0.0f);
  prefix_st(t, rewrite(PFX_T, ANY_SWIZZLE, constants_of(ONE, ONE, ONE, ONE)), n, 0.0f);
  for (int i = 0; i < n; i++) d[i] = is_nan(s[i]) ? __builtin_fabsf(s[i]) : plus(t[i], s[i]); // NaN always positive
  retain_invalid(d, n);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// nanmin(nanmax(f, 0), 1): NaN stays, and the bounds' signs win over an equal f's.
static float nan_clamp01(float f) {
  f = f <= 0.0f ? 0.0f : f;
  return f >= 1.0f ? 1.0f : f;
}

static void vsocp(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), out = n == 1 ? 2 : 4;
  read_vector(s, n, VS);
  // S forces xxyy and negate in y and w; abs applies to the final lanes. T forces constants 1, 0, 1, 0.
  prefix_st(s, rewrite(PFX_S, ANY_SWIZZLE | NEGATE(1, 1, 1, 1), swizzle(0, 0, 1, 1) | NEGATE(1, 0, 1, 0)), out, 0.0f);
  prefix_st(t, rewrite(PFX_T, ANY_SWIZZLE, constants_of(ONE, ZERO, ONE, ZERO)), out, 0.0f);
  // Essentially D prefix saturation is forced.
  for (int i = 0; i < out; i++) d[i] = nan_clamp01(plus(t[i], s[i]));
  prefix_d(d, n, 1);
  write_vector(d, out, VD);
  eat_prefixes();
}

static void vsgn(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  read_vector(s, n, VS);
  // T forces constants of 0, which abs and negate can make 3 or -3.
  prefix_st(t, rewrite(PFX_T, ANY_SWIZZLE, constants_of(ZERO, ZERO, ZERO, ZERO)), n, 0.0f);
  // S lanes past the n are T's there, which in the emulator are never set: taken as 0 here.
  for (int i = n; i < 4; i++) s[i] = t[i];
  prefix_s(s, 4);
  for (int i = 0; i < n; i++) {
    uint32_t u = bits(minus(s[i], t[i]));
    d[i] = (u == 0 || u == 0x80000000u) ? 0.0f : (u >> 31) == 0 ? 1.0f : -1.0f;
  }
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// vf2in's rounding: a half to the even one, partly in doubles, as the emulator does it.
static int32_t round_half_even(double d) {
  float below = (float)__builtin_floor(d);
  d -= below;
  if (d < 0.5f) return (int32_t)below;
  if (d > 0.5f) return (int32_t)(below + 1.0f);
  return (int32_t)(2.0f * __builtin_truncf(below / 2.0f) == below ? below : below + 1.0f);
}

// vf2in, vf2iz, vf2iu, vf2id
static void vf2i(uint32_t op) {
  float s[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  float mult = (float)(1u << ((op >> 16) & 0x1F));
  read_vector(s, n, VS);
  // Negate, abs and constants apply to the bits as you'd expect.
  prefix_s(s, n);
  for (int i = 0; i < n; i++) {
    int32_t out;
    if (is_nan(s[i])) {
      out = 0x7FFFFFFF;
    } else {
      double sv = (double)(s[i] * mult);
      if (sv > 2147483647.0) out = 0x7FFFFFFF;
      else if (sv <= -2147483648.0) out = (int32_t)0x80000000;
      else switch ((op >> 21) & 0x1F) {
        case 16: out = round_half_even(sv); break;
        case 17: out = s[i] >= 0 ? (int32_t)__builtin_floor(sv) : (int32_t)__builtin_ceil(sv); break;
        case 18: out = (int32_t)__builtin_ceil(sv); break;
        case 19: out = (int32_t)__builtin_floor(sv); break;
        default: out = 0x7FFFFFFF; break;
      }
    }
    d[i] = flt((uint32_t)out);
  }
  // No saturation, but the mask applies.
  prefix_d(d, n, 1);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vi2f(uint32_t op) {
  float s[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  float mult = 1.0f / (float)(1u << ((op >> 16) & 0x1F));
  read_vector(s, n, VS);
  prefix_s(s, n);
  for (int i = 0; i < n; i++) d[i] = (float)(int32_t)bits(s[i]) * mult;
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vh2f(uint32_t op) {
  float s[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), out = n == 1 ? 2 : 4;
  read_vector(s, n, VS);
  prefix_s(s, n);
  // Sizes past a pair are all taken as a pair.
  for (int i = 0; i < out; i++) d[i] = expand_half(i & 1 ? bits(s[i / 2]) >> 16 : bits(s[i / 2]) & 0xFFFF);
  prefix_d(d, out, 0);
  write_vector(d, out, VD);
  eat_prefixes();
}

static void vf2h(uint32_t op) {
  float s[4] = { 0 }, d[2] = { 0 };
  int n = vector_size(op), out = n <= 2 ? 1 : 2;
  read_vector(s, n, VS);
  // A swizzle can make a single write both halves. (PPSSPP keeps invalid swizzles here too, none on four lanes.)
  prefix_s(s, 4);
  for (int i = 0; i < out; i++) d[i] = flt(shrink_to_half(s[2 * i]) | shrink_to_half(s[2 * i + 1]) << 16);
  prefix_d(d, out, 0);
  write_vector(d, out, VD);
  eat_prefixes();
}

// vuc2i, vc2i, vus2i, vs2i
static void vx2i(uint32_t op) {
  float s[4] = { 0 }, df[4];
  uint32_t d[4] = { 0 };
  int n = vector_size(op), out = n;
  read_vector(s, n, VS);
  prefix_s(s, n);
  uint32_t value = bits(s[0]);
  switch ((op >> 16) & 3) {
  case 0: // 8 bits unsigned to 31 bits, swizzled to saturate
    for (int i = 0; i < 4; i++, value >>= 8) d[i] = ((value & 0xFF) * 0x01010101u) >> 1;
    out = 4;
    break;
  case 1: // signed, so no shift
    d[0] = (value & 0xFF) << 24;
    d[1] = (value & 0xFF00) << 16;
    d[2] = (value & 0xFF0000) << 8;
    d[3] = value & 0xFF000000u;
    out = 4;
    break;
  default: { // vus2i and vs2i: a single makes a pair, and anything larger is taken as a pair making a quad
    int halves = n == 1 ? 1 : 2, unsigned_ = ((op >> 16) & 3) == 2;
    out = n == 1 ? 2 : 4;
    for (int i = 0; i < halves; i++) {
      value = bits(s[i]);
      d[i * 2] = unsigned_ ? (value & 0xFFFF) << 15 : (value & 0xFFFF) << 16;
      d[i * 2 + 1] = unsigned_ ? (value & 0xFFFF0000u) >> 1 : value & 0xFFFF0000u;
    }
    break;
  }
  }
  // Saturation does in fact apply.
  for (int i = 0; i < 4; i++) df[i] = flt(d[i]);
  prefix_d(df, out, 0);
  write_vector(df, out, VD);
  eat_prefixes();
}

// vi2uc, vi2c, vi2us, vi2s
static void vi2x(uint32_t op) {
  float s[4] = { 0 }, df[2];
  uint32_t d[2] = { 0 };
  int n = vector_size(op), out = 1;
  read_vector(s, n, VS);
  // Negate, constants etc. apply as expected.
  prefix_s(s, 4);
  switch ((op >> 16) & 3) {
  case 0:
    for (int i = 0; i < 4; i++) {
      int32_t v = (int32_t)bits(s[i]);
      if (v < 0) v = 0;
      d[0] |= ((uint32_t)(v >> 23) & 0xFF) << (i * 8);
    }
    break;
  case 1:
    for (int i = 0; i < 4; i++) d[0] |= (bits(s[i]) >> 24) << (i * 8);
    break;
  default: {
    int elems = (n + 1) / 2, unsigned_ = ((op >> 16) & 3) == 2;
    for (int i = 0; i < elems; i++) {
      int32_t low = (int32_t)bits(s[i * 2]), high = (int32_t)bits(s[i * 2 + 1]);
      if (unsigned_) {
        d[i] = (uint32_t)((low < 0 ? 0 : low) >> 15) | (uint32_t)((high < 0 ? 0 : high) >> 15) << 16;
      } else {
        d[i] = ((uint32_t)low >> 16) | ((uint32_t)high >> 16) << 16;
      }
    }
    out = n >= 3 ? 2 : 1;
    break;
  }
  }
  df[0] = flt(d[0]);
  df[1] = flt(d[1]);
  prefix_d(df, out, 0);
  write_vector(df, out, VD);
  eat_prefixes();
}

// vt4444, vt5551, vt5650
static void vcolor(uint32_t op) {
  float s[4], ov[2];
  uint32_t colors[4];
  read_vector(s, 4, VS);
  prefix_s(s, 4);
  for (int i = 0; i < 4; i++) {
    uint32_t in = bits(s[i]), a = in >> 24, b = (in >> 16) & 0xFF, g = (in >> 8) & 0xFF, r = in & 0xFF;
    switch ((op >> 16) & 3) {
    case 1: colors[i] = (a >> 4) << 12 | (b >> 4) << 8 | (g >> 4) << 4 | r >> 4; break;
    case 2: colors[i] = (a >> 7) << 15 | (b >> 3) << 10 | (g >> 3) << 5 | r >> 3; break;
    case 3: colors[i] = (b >> 3) << 11 | (g >> 2) << 5 | r >> 3; break;
    default: colors[i] = 0; break;
    }
  }
  ov[0] = flt(colors[0] | colors[1] << 16);
  ov[1] = flt(colors[2] | colors[3] << 16);
  prefix_d(ov, 2, 0);
  write_vector(ov, vector_size(op) == 1 ? 1 : 2, VD);
  eat_prefixes();
}

// The sum of four products as vdot, vfad and vavg have it built: t's times s's, the last added in front.
static float dot_t_s(const float *s, const float *t) {
  float sum = plus(times(t[0], s[0]), 0.0f);
  sum = plus(sum, times(t[1], s[1]));
  sum = plus(sum, times(t[2], s[2]));
  return plus(times(t[3], s[3]), sum);
}

static void vdot(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d;
  int n = vector_size(op);
  read_vector(s, n, VS);
  prefix_s(s, 4);
  read_vector(t, n, VT);
  prefix_t(t, 4);
  d = dot_t_s(s, t);
  prefix_d(&d, 1, 0);
  write_vector(&d, 1, VD);
  eat_prefixes();
}

static void vhdp(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d;
  int n = vector_size(op), l = n - 1;
  read_vector(s, n, VS);
  read_vector(t, n, VT);
  prefix_t(t, 4);
  // S forces a constant 1 in the last lane; otherwise it's vdot.
  uint32_t remove = 3u << (2 * l);
  uint32_t add = constants_of(l == 0 ? ONE : NONE, l == 1 ? ONE : NONE, l == 2 ? ONE : NONE, l == 3 ? ONE : NONE);
  prefix_st(s, rewrite(PFX_S, remove, add), 4, 0.0f);
  // each product added in front of the sum so far, in the emulator's build
  float sum = plus(times(t[0], s[0]), 0.0f);
  for (int i = 1; i < 4; i++) sum = plus(times(t[i], s[i]), sum);
  d = is_nan(sum) ? __builtin_fabsf(sum) : sum;
  prefix_d(&d, 1, 0);
  write_vector(&d, 1, VD);
  eat_prefixes();
}

// vbfy1, vbfy2
static void vbfy(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4];
  int n = vector_size(op), two = (op & 0x10000) != 0;
  read_vector(s, n, VS);
  read_vector(t, n, VS);
  // S forces the negate flags (z and w, or y and w); T forces the swizzle (zwxy, or yxwz).
  prefix_st(s, rewrite(PFX_S, 0, two ? NEGATE(0, 0, 1, 1) : NEGATE(0, 1, 0, 1)), n, 0.0f);
  prefix_st(t, rewrite(PFX_T, ANY_SWIZZLE, two ? swizzle(2, 3, 0, 1) : swizzle(1, 0, 3, 2)), n, 0.0f);
  for (int i = 0; i < 4; i++) d[i] = plus(t[i], s[i]); // t first, in the emulator's build
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// vsrt1 to vsrt4: T is S again, swizzled, and each lane takes the least or the most, as std::min and std::max do.
static void vsrt(uint32_t op, uint32_t t_swizzle, int maxes) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4];
  int n = vector_size(op);
  read_vector(s, n, VS);
  prefix_s(s, n);
  read_vector(t, n, VS);
  prefix_st(t, rewrite(PFX_T, swizzle(3, 3, 3, 3), t_swizzle), n, 0.0f);
  for (int i = 0; i < 4; i++) d[i] = (maxes >> i) & 1 ? (s[i] < t[i] ? t[i] : s[i]) : (t[i] < s[i] ? t[i] : s[i]);
  retain_invalid(d, n);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// half a cross product
static void vcrs(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4];
  int n = vector_size(op);
  read_vector(s, n, VS);
  read_vector(t, n, VT);
  // S forces yzx and T zxy in the first three lanes.
  prefix_st(s, rewrite(PFX_S, swizzle(3, 3, 3, 0), swizzle(1, 2, 0, 0)), n, 0.0f);
  prefix_st(t, rewrite(PFX_T, swizzle(3, 3, 3, 0), swizzle(2, 0, 1, 0)), n, 0.0f);
  for (int i = 0; i < 4; i++) d[i] = times(s[i], t[i]);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vdet(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d;
  int n = vector_size(op);
  // normally a pair; lanes not read are 0
  read_vector(s, n, VS);
  prefix_s(s, 4);
  read_vector(t, n, VT);
  // T forces yx in x and y, with no negation.
  prefix_st(t, rewrite(PFX_T, swizzle(3, 3, 0, 0), swizzle(1, 0, 0, 0)), 4, 0.0f);
  d = minus(times(s[0], t[0]), times(s[1], t[1]));
  d = plus(d, plus(times(s[2], t[2]), times(s[3], t[3])));
  prefix_d(&d, 1, 0);
  write_vector(&d, 1, VD);
  eat_prefixes();
}

// vfad, vavg: T makes constants, 1 for vfad, and 1 over the size for vavg, where abs is ignored.
static void vfad_vavg(uint32_t op, int average) {
  float s[4] = { 0 }, t[4] = { 0 }, d;
  int n = vector_size(op);
  static const int share[5] = { 0, ZERO, HALF, THIRD, FOURTH };
  read_vector(s, n, VS);
  prefix_s(s, 4);
  int c = average ? share[n] : ONE;
  uint32_t remove = average ? ANY_SWIZZLE | ABS(1, 1, 1, 1) : ANY_SWIZZLE;
  prefix_st(t, rewrite(PFX_T, remove, constants_of(c, c, c, c)), 4, 0.0f);
  d = dot_t_s(s, t);
  prefix_d(&d, 1, 0);
  write_vector(&d, 1, VD);
  eat_prefixes();
}

static void vscl(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), vt = VT, tlane = (vt >> 5) & 3;
  read_vector(s, n, VS);
  prefix_s(s, n);
  // T forces the swizzle to the lane the scale is read from; negate still works.
  t[tlane] = flt(*single(vt));
  prefix_st(t, rewrite(PFX_T, ANY_SWIZZLE, swizzle(tlane, tlane, tlane, tlane)), 4, 0.0f);
  for (int i = 0; i < n; i++) d[i] = times(s[i], t[i]);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vrnds(uint32_t op) {
  float seed = flt(*single(VD));
  // Swizzles make a constant; constants, abs and negate vary the seed.
  prefix_s(&seed, 1);
  vrnd_init(bits(seed), &CTRL[CTRL_RCX]);
  eat_prefixes();
}

// vrndi, vrndf1, vrndf2
static void vrndx(uint32_t op) {
  float d[4] = { 0 };
  int n = vector_size(op), type = (op >> 16) & 0x1F;
  // Values are written in backwards order.
  for (int i = n - 1; i >= 0; i--) {
    uint32_t r = vrnd_generate(&CTRL[CTRL_RCX]);
    d[i] = flt(type == 1 ? r : type == 2 ? 0x3F800000u | (r & 0x007FFFFFu) : 0x40000000u | (r & 0x007FFFFFu));
  }
  // The D prefix applies to the last lane only.
  prefix_d_last(n);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// One line of a rotation matrix around one of the three axes.
static void vrot(uint32_t op) {
  float d[4] = { 0 }, sine, cosine;
  int n = vector_size(op), vd = VD, vs = VS, imm = (op >> 16) & 0x1F;
  int neg_sin = (imm & 0x10) != 0, sine_lane = (imm >> 2) & 3, cosine_lane = imm & 3;
  if (CTRL[PFX_S] == 0xE4) {
    sine = vfpu_sin(flt(*single(vs)));
    cosine = vfpu_cos(flt(*single(vs)));
    if (neg_sin) sine = -sine;
  } else {
    // S swizzles only the sine, with negate applied later; the cosine ignores all prefixes.
    float s[4] = { 0 };
    read_vector(s, 1, vs);
    prefix_st(s, rewrite(PFX_S, NEGATE(1, 0, 0, 0), 0), 1, 0.0f);
    cosine = vfpu_cos(flt(*single(vs)));
    sine = vfpu_sin(s[0]);
    if (neg_sin) sine = -sine;
    retain_invalid(&sine, 1);
  }
  if (sine_lane == cosine_lane) {
    for (int i = 0; i < 4; i++) d[i] = sine;
  } else {
    d[sine_lane] = sine;
  }
  // Written over its own angle, the cosine is of what's in that lane now (the sine or 0). PPSSPP looks through all four
  // numbers, those past the vector's lanes being 0.
  int written = 0;
  if (((vd >> 2) & 7) == ((vs >> 2) & 7)) {
    uint8_t dregs[4] = { 0 };
    vector_regs(dregs, n, vd);
    for (int i = 0; i < 4 && !written; i++) {
      if (vs == dregs[i]) {
        d[cosine_lane] = vfpu_cos(d[i]);
        written = 1;
      }
    }
  }
  if (!written) d[cosine_lane] = cosine;
  // The D prefix works, but not for the cosine's lane, as PPSSPP takes it off.
  CTRL[PFX_D] &= 0xFFFFFu ^ ((3u << cosine_lane) | (1u << (8 + cosine_lane)));
  prefix_d(d, n, 0);
  write_vector(d, n, vd);
  eat_prefixes();
}

// vtfm2-4 and vhtfm2-4
static void vtfm(uint32_t op) {
  // which products the emulator's build works out as t's times s's, a bit a lane, in each row before the last
  static const uint8_t t_first[3] = { 0xC, 0x2, 0x5 };
  float s[16] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int ins = (op >> 23) & 3, side = ins + 1, n = vector_size(op), tn = n < side ? n : side;
  read_matrix(s, side, VS);
  read_vector(t, side, VT);
  for (int i = 0; i < ins; i++) {
    const float *r = &s[i * 4];
    float sum = 0.0f;
    for (int k = 0; k < tn; k++) {
      float p = (t_first[i] >> k) & 1 ? times(t[k], r[k]) : times(r[k], t[k]);
      // the first row's second product is added in front
      sum = k == 0 ? p : (i == 0 && k == 1) ? plus(p, sum) : plus(sum, p);
    }
    if (ins >= n) sum = plus(sum, r[ins]);
    d[i] = sum;
  }
  // S and T apply to the final row only; T makes the zero and one constants, which abs still changes.
  prefix_s(&s[ins * 4], 4);
  int cy = n < 2 ? ZERO : NONE, cz = n < 3 ? ZERO : NONE, cw = n < 4 ? ZERO : NONE;
  if (ins >= n) {
    if (ins == 1) cy = ONE;
    else if (ins == 2) cz = ONE;
    else cw = ONE;
  }
  uint32_t remove = swizzle(0, n < 2 ? 3 : 0, n < 3 ? 3 : 0, n < 4 ? 3 : 0);
  prefix_st(t, rewrite(PFX_T, remove, constants_of(NONE, cy, cz, cw)), 4, 0.0f);
  const float *r = &s[ins * 4];
  float sum = times(r[0], t[0]);
  for (int k = 1; k < 4; k++) sum = plus(sum, times(r[k], t[k]));
  d[ins] = sum;
  // The D prefix applies to the last lane only.
  prefix_d_last(side);
  prefix_d(d, side, 0);
  write_vector(d, side, VD);
  eat_prefixes();
}

// vmfvc and vmtvc keep the prefixes, and write and read the register whole.
static void vmfvc(uint32_t op) {
  uint32_t imm = (op >> 8) & 0x7F;
  *single(VD) = imm < CTRL_COUNT ? CTRL[imm] : 0;
}

// What part of a control register mtvc and vmtvc can write, or 0 for one they can't.
static uint32_t ctrl_mask(uint32_t reg) {
  if (reg <= PFX_T) return 0x000FFFFF;
  if (reg == PFX_D) return 0x00000FFF;
  if (reg == CTRL_CC) return 0x0000003F;
  if (reg == 4) return 0xFFFFFFFF;
  if (reg >= CTRL_RCX && reg < CTRL_COUNT) return 0x3FFFFFFF;
  return 0;
}

static void vmtvc(uint32_t op) {
  uint32_t imm = op & 0x7F, mask = ctrl_mask(imm);
  if (mask) CTRL[imm] = *single(VS) & mask;
}

static void vcst(uint32_t op) {
  float c = flt(cst_constants[(op >> 16) & 0x1F]), d[4] = { c, c, c, c };
  int n = vector_size(op);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vcmp(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 };
  int n = vector_size(op), cond = op & 0xF;
  uint32_t cc = 0, or_val = 0, and_val = 1, affected = 1 << 4 | 1 << 5;
  read_vector(s, n, VS);
  prefix_s(s, n);
  read_vector(t, n, VT);
  prefix_t(t, n);
  for (int i = 0; i < n; i++) {
    uint32_t c = 0;
    switch (cond) {
    case 0: c = 0; break;
    case 1: c = s[i] == t[i]; break;
    case 2: c = s[i] < t[i]; break;
    case 3: c = s[i] <= t[i]; break;
    case 4: c = 1; break;
    case 5: c = s[i] != t[i]; break;
    case 6: c = s[i] >= t[i]; break;
    case 7: c = s[i] > t[i]; break;
    case 8: c = s[i] == 0.0f || s[i] == -0.0f; break;
    case 9: c = is_nan(s[i]); break;
    case 10: c = is_inf(s[i]); break;
    case 11: c = is_nan_or_inf(s[i]); break;
    case 12: c = s[i] != 0; break;
    case 13: c = !is_nan(s[i]); break;
    case 14: c = !is_inf(s[i]); break;
    case 15: c = !is_nan_or_inf(s[i]); break;
    }
    cc |= c << i;
    or_val |= c;
    and_val &= c;
    affected |= 1u << i;
  }
  CTRL[CTRL_CC] = (CTRL[CTRL_CC] & ~affected) | ((cc | or_val << 4 | and_val << 5) & affected);
  eat_prefixes();
}

static void vminmax(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), most = ((op >> 23) & 3) == 3;
  read_vector(s, n, VS);
  prefix_s(s, n);
  read_vector(t, n, VT);
  prefix_t(t, n);
  // Both zero takes t's sign; otherwise -NaN < -Inf < real < Inf < NaN, a larger mantissa farther from 0.
  for (int i = 0; i < n; i++) {
    if (is_nan_or_inf(s[i]) || is_nan_or_inf(t[i])) {
      int32_t si = (int32_t)bits(s[i]), ti = (int32_t)bits(t[i]);
      // both negative flips the comparison, as these aren't two's complement
      int take_larger = most != (si < 0 && ti < 0);
      d[i] = flt((uint32_t)(take_larger ? (ti < si ? si : ti) : (si < ti ? si : ti)));
    } else {
      d[i] = most ? (t[i] < s[i] ? s[i] : t[i]) : (s[i] < t[i] ? s[i] : t[i]);
    }
  }
  retain_invalid(d, n);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vscmp(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  read_vector(s, n, VS);
  prefix_s(s, n);
  read_vector(t, n, VT);
  prefix_t(t, n);
  for (int i = 0; i < n; i++) {
    float a = s[i] - t[i];
    if (is_nan(a)) {
      // NaN and Inf are taken as just larger numbers, as in vmin and vmax.
      int32_t sm = (int32_t)(bits(s[i]) & 0x7FFFFFFF), tm = (int32_t)(bits(t[i]) & 0x7FFFFFFF);
      int32_t b = ((int32_t)bits(s[i]) < 0 ? -sm : sm) - ((int32_t)bits(t[i]) < 0 ? -tm : tm);
      d[i] = (float)((0 < b) - (b < 0));
    } else {
      d[i] = (float)((0.0f < a) - (a < 0.0f));
    }
  }
  retain_invalid(d, n);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// vsge, vslt
static void vsge_vslt(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), less = ((op >> 23) & 7) == 7;
  read_vector(s, n, VS);
  prefix_s(s, n);
  read_vector(t, n, VT);
  prefix_t(t, n);
  for (int i = 0; i < n; i++)
    d[i] = is_nan(s[i]) || is_nan(t[i]) ? 0.0f : (less ? s[i] < t[i] : s[i] >= t[i]) ? 1.0f : 0.0f;
  retain_invalid(d, n);
  // The clamp cannot matter, so it's skipped.
  prefix_d(d, n, 1);
  write_vector(d, n, VD);
  eat_prefixes();
}

static void vcmov(uint32_t op) {
  float s[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), tf = (op >> 19) & 1, imm3 = (op >> 16) & 7;
  uint32_t cc = CTRL[CTRL_CC];
  read_vector(s, n, VS);
  prefix_s(s, n);
  // D is read too, as T, and the T prefix applies to it.
  read_vector(d, n, VD);
  prefix_t(d, n);
  if (imm3 < 6) {
    if ((int)((cc >> imm3) & 1) == !tf)
      for (int i = 0; i < n; i++) d[i] = s[i];
  } else if (imm3 == 6) {
    for (int i = 0; i < n; i++)
      if ((int)((cc >> i) & 1) == !tf) d[i] = s[i];
  }
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// vadd, vsub, vdiv, vmul
static void vec_do3(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op), type = op >> 26 == 25 ? 8 : (op >> 23) & 7;
  read_vector(s, n, VS);
  read_vector(t, n, VT);
  if (type != 7) {
    prefix_s(s, n);
    prefix_t(t, n);
  } else {
    // vdiv's S and T apply their x lane to the last lane alone.
    prefix_st(&s[n - 1], CTRL[PFX_S], 1, -__builtin_inff());
    prefix_st(&t[n - 1], CTRL[PFX_T], 1, -__builtin_inff());
  }
  // the emulator's build adds and multiplies a quad as t's and s's, and anything smaller as s's and t's
  for (int i = 0; i < n; i++) {
    switch (type) {
    case 0: d[i] = n == 4 ? plus(t[i], s[i]) : plus(s[i], t[i]); break;
    case 1: d[i] = minus(s[i], t[i]); break;
    case 7: d[i] = over(s[i], t[i]); break;
    case 8: d[i] = n == 4 ? times(t[i], s[i]) : times(s[i], t[i]); break;
    }
  }
  // vdiv's D prefix applies to the last lane only.
  if (type == 7) {
    prefix_d_last(n);
  } else {
    retain_invalid(d, n);
  }
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// vcrsp.t and vqmul.q, with each product's and sum's operands in the order the emulator's build has them.
static void cross_quat(uint32_t op) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  uint32_t remove = ANY_SWIZZLE | NEGATE(1, 1, 1, 1);
  read_vector(s, n, VS);
  read_vector(t, n, VT);
  switch (n) {
  case 3: // vcrsp.t
    d[0] = minus(times(t[2], s[1]), times(s[2], t[1]));
    d[1] = minus(times(t[0], s[2]), times(s[0], t[2]));
    // T forces a swizzle and negate, which can make odd constants.
    prefix_st(t, rewrite(PFX_T, remove, swizzle(1, 0, 3, 2) | NEGATE(0, 1, 0, 0)), 4, 0.0f);
    prefix_s(s, 4);
    d[2] = plus(plus(plus(times(s[0], t[0]), times(s[1], t[1])), times(s[2], t[2])), times(s[3], t[3]));
    break;
  case 4: // vqmul.q
    d[0] = plus(minus(plus(times(t[3], s[0]), times(t[2], s[1])), times(s[2], t[1])), times(t[0], s[3]));
    d[1] = plus(plus(plus(times(t[2], -s[0]), times(t[3], s[1])), times(s[2], t[0])), times(t[1], s[3]));
    d[2] = plus(plus(minus(times(s[0], t[1]), times(s[1], t[0])), times(t[3], s[2])), times(t[2], s[3]));
    prefix_st(t, rewrite(PFX_T, remove, swizzle(0, 1, 2, 3) | NEGATE(1, 1, 1, 0)), 4, 0.0f);
    prefix_s(s, 4);
    d[3] = plus(plus(plus(times(s[0], t[0]), times(s[1], t[1])), times(s[2], t[2])), times(s[3], t[3]));
    break;
  case 2: // T's swizzle is past the pair, so the product is always 0; a swizzled s[2] can make the second lane.
    d[0] = 0;
    prefix_st(t, rewrite(PFX_T, remove, swizzle(0, 0, 0, 0)), 4, 0.0f);
    prefix_s(s, 4);
    d[1] = times(s[2], t[2]);
    break;
  default:
    d[0] = 0;
    break;
  }
  // The D prefix applies to the last lane only, from a pair up; a single always writes 0.
  if (n != 1) {
    prefix_d_last(n);
    prefix_d(d, n, 0);
  } else {
    CTRL[PFX_D] = 0;
  }
  write_vector(d, n, VD);
  eat_prefixes();
}

// vlgb, vwbn, vsbz, vsbn work on the first lane and copy the others.
static void exponent_op(uint32_t op, int kind) {
  float s[4] = { 0 }, t[4] = { 0 }, d[4] = { 0 };
  int n = vector_size(op);
  read_vector(s, n, VS);
  prefix_s(s, n);
  uint32_t u = bits(s[0]), e = (u & 0x7F800000u) >> 23, out;
  if (kind == 'l') { // vlgb: the exponent
    out = e == 0xFF ? u : e == 0 ? 0xFF800000u : bits((float)((int)e - 127));
  } else if (kind == 'w') { // vwbn
    uint32_t exp = (op >> 16) & 0xFF, mantissa = (u & 0x007FFFFFu) | 0x00800000u;
    if (e != 0xFF && e != 0) {
      if (exp > e) mantissa >>= (exp - e) & 0xF;
      else mantissa <<= (e - exp) & 0xF;
      out = (u & 0x80000000u) | (mantissa & 0x007FFFFFu) | exp << 23;
    } else {
      out = u | exp << 23;
    }
  } else if (kind == 'z') { // vsbz: NaN and denormals pass through
    out = is_nan(s[0]) || e == 0 ? u : 127u << 23 | (u & 0x007FFFFFu);
  } else { // vsbn: the exponent replaced, by T read as a whole number
    read_vector(t, n, VT);
    prefix_t(t, n);
    uint32_t exp = (127u + bits(t[0])) & 0xFF;
    out = e != 0 && e != 0xFF ? (u & ~0x7F800000u) | exp << 23 : u;
  }
  d[0] = flt(out);
  for (int i = 1; i < n; i++) d[i] = s[i];
  if (kind == 'l' || kind == 'w') retain_invalid(d, n);
  prefix_d(d, n, 0);
  write_vector(d, n, VD);
  eat_prefixes();
}

// ---- the calls ------------------------------------------------------------------------------------------------------

void psp_vfpu_reset(void) {
  static const uint32_t start[CTRL_COUNT] = {
    0xE4, 0xE4, 0, 0x3F, 0, 0, 0, 0x7772CEAB, 0x3F800001, 0x3F800002, 0x3F800004, 0x3F800008,
    0x3F800000, 0x3F800000, 0x3F800000, 0x3F800000,
  };
  for (int i = 0; i < 128; i++) VR[i] = 0;
  for (int i = 0; i < CTRL_COUNT; i++) CTRL[i] = start[i];
}

void psp_vfpu(uint32_t op) {
  uint32_t sub = (op >> 16) & 0x1F;
  switch (op >> 26) {
  case 24:
    switch ((op >> 23) & 7) {
    case 0: case 1: case 7: vec_do3(op); break;
    case 2: exponent_op(op, 'n'); break;
    }
    break;
  case 25:
    switch ((op >> 23) & 7) {
    case 0: vec_do3(op); break;
    case 1: vdot(op); break;
    case 2: vscl(op); break;
    case 4: vhdp(op); break;
    case 5: vcrs(op); break;
    case 6: vdet(op); break;
    }
    break;
  case 27:
    switch ((op >> 23) & 7) {
    case 0: vcmp(op); break;
    case 2: case 3: vminmax(op); break;
    case 5: vscmp(op); break;
    case 6: case 7: vsge_vslt(op); break;
    }
    break;
  case 52:
    switch ((op >> 21) & 0x1F) {
    case 0:
      if (sub == 3) vidt(op);
      else if (sub == 6 || sub == 7) vvector_init(op);
      else if (sub <= 5 || (sub >= 16 && sub <= 24) || sub == 26 || sub == 28) vv2op(op);
      break;
    case 1:
      if (sub == 0) vrnds(op);
      else if (sub <= 3) vrndx(op);
      else if (sub == 18) vf2h(op);
      else if (sub == 19) vh2f(op);
      else if (sub == 22) exponent_op(op, 'z');
      else if (sub == 23) exponent_op(op, 'l');
      else if (sub >= 28) vi2x(op);
      else if (sub >= 24) vx2i(op);
      break;
    case 2:
      switch (sub) {
      case 0: vsrt(op, swizzle(1, 0, 3, 2), 0xA); break;
      case 1: vsrt(op, swizzle(3, 2, 1, 0), 0xC); break;
      case 2: case 3: vbfy(op); break;
      case 4: vocp(op); break;
      case 5: vsocp(op); break;
      case 6: vfad_vavg(op, 0); break;
      case 7: vfad_vavg(op, 1); break;
      case 8: vsrt(op, swizzle(1, 0, 3, 2), 0x5); break;
      case 9: vsrt(op, swizzle(3, 2, 1, 0), 0x3); break;
      case 10: vsgn(op); break;
      case 16: vmfvc(op); break;
      case 17: vmtvc(op); break;
      case 25: case 26: case 27: vcolor(op); break;
      }
      break;
    case 3: vcst(op); break;
    case 16: case 17: case 18: case 19: vf2i(op); break;
    case 20: vi2f(op); break;
    case 21: vcmov(op); break;
    case 24: case 25: case 26: case 27: case 28: case 29: case 30: case 31: exponent_op(op, 'w'); break;
    }
    break;
  case 55:
    if (((op >> 23) & 7) < 6) vpfx(op);
    else viim(op);
    break;
  case 60: {
    uint32_t kind = (op >> 21) & 0x1F, m = (op >> 16) & 0xF;
    if (kind < 4) vmmul(op);
    else if (kind < 16) vtfm(op);
    else if (kind < 20) vmscl(op);
    else if (kind < 24) cross_quat(op);
    else if (kind == 28 && m == 0) vmmov(op);
    else if (kind == 28 && (m == 3 || m == 6 || m == 7)) vmatrix_init(op);
    else if (kind == 29) vrot(op);
    break;
  }
  case 63: vflush(op); break;
  }
}

// Whether 16 bytes from an address are all the console's memory, as lv.q and sv.q ask before they read or write.
static int quad_in_memory(uint32_t address) { return psp_memory(address) && psp_memory(address + 15); }

void psp_vfpu_load(uint32_t op, uint32_t base) {
  uint32_t address = base + (uint32_t)(int32_t)(int16_t)(op & 0xFFFC);
  int vt = (int)((op >> 16) & 0x1F), q = vt | (int)(op & 1) << 5;
  float d[4];
  switch (op >> 26) {
  case 50: // lv.s writes the register whole
    *single(vt | (int)(op & 3) << 5) = psp_read32(address);
    break;
  case 53: { // lvl.q, lvr.q
    int offset = (address >> 2) & 3;
    read_vector(d, 4, q);
    if (!(op & 2)) {
      for (int i = 0; i < offset + 1; i++) d[3 - i] = flt(psp_read32(address - 4 * (uint32_t)i));
    } else {
      for (int i = 0; i < (3 - offset) + 1; i++) d[i] = flt(psp_read32(address + 4 * (uint32_t)i));
    }
    write_vector(d, 4, q);
    break;
  }
  case 54: // lv.q, at the address as it is, and nothing where it isn't memory
    if (!quad_in_memory(address)) break;
    for (int i = 0; i < 4; i++) d[i] = flt(psp_read32(address + 4 * (uint32_t)i));
    write_vector(d, 4, q);
    break;
  }
}

void psp_vfpu_store(uint32_t op, uint32_t base) {
  uint32_t address = base + (uint32_t)(int32_t)(int16_t)(op & 0xFFFC);
  int vt = (int)((op >> 16) & 0x1F), q = vt | (int)(op & 1) << 5;
  float d[4];
  switch (op >> 26) {
  case 58: // sv.s
    psp_write32(address, *single(vt | (int)(op & 3) << 5));
    break;
  case 61: { // svl.q, svr.q
    int offset = (address >> 2) & 3;
    read_vector(d, 4, q);
    if (!(op & 2)) {
      for (int i = 0; i < offset + 1; i++) psp_write32(address - 4 * (uint32_t)i, bits(d[3 - i]));
    } else {
      for (int i = 0; i < (3 - offset) + 1; i++) psp_write32(address + 4 * (uint32_t)i, bits(d[i]));
    }
    break;
  }
  case 62: // sv.q
    if (!quad_in_memory(address)) break;
    read_vector(d, 4, q);
    for (int i = 0; i < 4; i++) psp_write32(address + 4 * (uint32_t)i, bits(d[i]));
    break;
  }
}

uint32_t psp_vfpu_get(uint32_t op) {
  uint32_t imm = op & 0xFF;
  if (((op >> 21) & 0x1F) != 3) return 0;
  if (imm < 128) return *single((int)imm);
  if (imm < 128 + CTRL_COUNT) return CTRL[imm - 128];
  return 0;
}

void psp_vfpu_set(uint32_t op, uint32_t value) {
  uint32_t imm = op & 0xFF;
  if (((op >> 21) & 0x1F) != 7) return;
  if (imm < 128) {
    *single((int)imm) = value;
  } else if (imm < 128 + CTRL_COUNT) {
    uint32_t mask = ctrl_mask(imm - 128);
    if (mask) CTRL[imm - 128] = value & mask;
  }
}

int psp_vfpu_branch(uint32_t op) {
  uint32_t set = (CTRL[CTRL_CC] >> ((op >> 18) & 7)) & 1;
  return (int)((op >> 16) & 1 ? set : !set);
}
