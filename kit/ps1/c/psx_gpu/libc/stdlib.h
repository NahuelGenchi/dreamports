// The kit's own: the C library's stdlib.h, for psx_gpu, which takes abs from it, and the computer's own anywhere else.
#ifndef __wasm__
#include_next <stdlib.h>
#elif !defined(DREAMPORTS_STDLIB_H)
#define DREAMPORTS_STDLIB_H
#include <stddef.h>
static inline int abs(int value) { return value < 0 ? -value : value; }
#endif
