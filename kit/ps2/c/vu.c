// The vector units' sums (ps2.h): each of a vector's four floats on its own, with the EE's arithmetic (ee.c), only on the
// fields an instruction names. A program on a vector unit, written again in C, reads as its instructions did. What a
// program's timing does, such as a division's result arriving some instructions later, is the game's code to keep.

#include "ps2.h"

// the fields an instruction names, x first, as its bits have them: 8 for x down to 1 for w
#define EACH(dest) for (int i = 0; i < 4; i++) if ((dest) & (8 >> i))

void vu_add(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = ee_add(fs->f[i], ft->f[i]); }
void vu_sub(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = ee_sub(fs->f[i], ft->f[i]); }
void vu_mul(vu_vector *fd, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = ee_mul(fs->f[i], ft->f[i]); }
void vu_madd(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = ee_add(acc->f[i], ee_mul(fs->f[i], ft->f[i])); }
void vu_msub(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, const vu_vector *ft, int dest) { EACH(dest) fd->f[i] = ee_sub(acc->f[i], ee_mul(fs->f[i], ft->f[i])); }

void vu_addf(vu_vector *fd, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = ee_add(fs->f[i], with); }
void vu_subf(vu_vector *fd, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = ee_sub(fs->f[i], with); }
void vu_mulf(vu_vector *fd, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = ee_mul(fs->f[i], with); }
void vu_maddf(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = ee_add(acc->f[i], ee_mul(fs->f[i], with)); }
void vu_msubf(vu_vector *fd, const vu_vector *acc, const vu_vector *fs, float with, int dest) { EACH(dest) fd->f[i] = ee_sub(acc->f[i], ee_mul(fs->f[i], with)); }

void vu_ftoi(vu_vector *ft, const vu_vector *fs, int bits, int dest) {
  // times 1, 16, 4096 or 32768, cut, and then what's after the point dropped
  EACH(dest) ft->i[i] = ee_to_int(bits ? ee_mul(fs->f[i], (float)(1 << bits)) : fs->f[i]);
}
void vu_itof(vu_vector *ft, const vu_vector *fs, int bits, int dest) {
  EACH(dest) ft->f[i] = bits ? ee_div(ee_from_int(fs->i[i]), (float)(1 << bits)) : ee_from_int(fs->i[i]);
}
