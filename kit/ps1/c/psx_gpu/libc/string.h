// The kit's own: the C library's string.h, for psx_gpu, as the kit's C library has it built to WebAssembly
// (kit/c/libc.c), and the computer's own anywhere else.
#ifndef __wasm__
#include_next <string.h>
#elif !defined(DREAMPORTS_STRING_H)
#define DREAMPORTS_STRING_H
#include <stddef.h>
void *memset(void *to, int value, size_t n);
void *memcpy(void *restrict to, const void *restrict from, size_t n);
void *memmove(void *to, const void *from, size_t n);
int memcmp(const void *a, const void *b, size_t n);
#endif
