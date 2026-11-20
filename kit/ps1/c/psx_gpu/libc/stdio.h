// The kit's own: the C library's stdio.h, for psx_gpu, whose only use of it is printf in its debugging and its
// benchmark, which a Dreamport's page has nowhere to print to; and the computer's own anywhere else.
#ifndef __wasm__
#include_next <stdio.h>
#elif !defined(DREAMPORTS_STDIO_H)
#define DREAMPORTS_STDIO_H
#define printf(...) ((void)0)
#endif
