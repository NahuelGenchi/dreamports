// The PlayStation 2's floats, on their bits (floats.c): the rules its FPU and its vector units share, which aren't a
// computer's. The kit's EE and vector units work their sums out with these (ee.c, vu.c), and so does the console's
// emulator in the proof tools, which is given this same file (tools/libretro/play.patch), so both sides of a proof
// follow the console.

#ifndef DREAMPORTS_PS2_FLOATS_H
#define DREAMPORTS_PS2_FLOATS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// what a sum raises, added to `flags`: overflow, underflow, division by zero and invalid
enum { FLAG_O = 1, FLAG_U = 2, FLAG_D = 4, FLAG_I = 8 };

uint32_t fpu_add(uint32_t a, uint32_t b, uint32_t *flags);
uint32_t fpu_mul(uint32_t a, uint32_t b, uint32_t *flags);
uint32_t fpu_div(uint32_t a, uint32_t b, uint32_t *flags);
/** The square root of a float without its sign. */
uint32_t fpu_sqrt(uint32_t a, uint32_t *flags);
/** a over the square root of b: the root cut, then the division cut. */
uint32_t fpu_rsqrt(uint32_t a, uint32_t b, uint32_t *flags);
/** A float as a whole number, what's after its point dropped, the largest there is with its sign for one too large. */
int32_t fpu_to_int(uint32_t a);
/** A whole number as a float, cut to 24 bits. */
uint32_t fpu_from_int(int32_t value);
/** A float as a whole number that orders as it does, a tiny one as zero, for the FPU's compares, MAX and MIN. */
int32_t fpu_order(uint32_t a);

// the vector units' EFU sums, by name
enum { EFU_ESADD, EFU_ERSADD, EFU_ELENG, EFU_ERLENG, EFU_ESUM, EFU_ESQRT, EFU_ERSQRT, EFU_ERCPR, EFU_ESIN, EFU_EEXP, EFU_EATAN, EFU_EATANXY, EFU_EATANXZ };
/** One EFU sum of a vector's four fields, `s` being the one field the sums of one field take. */
uint32_t fpu_efu(int which, uint32_t x, uint32_t y, uint32_t z, uint32_t w, uint32_t s);
/** CLIP's six judgements of x, y and z against the size of w: +x, -x, +y, -y, +z, -z from the lowest bit. */
uint32_t fpu_clip(uint32_t x, uint32_t y, uint32_t z, uint32_t w);

#ifdef __cplusplus
}
#endif

#endif
