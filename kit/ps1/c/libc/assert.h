// The kit's own: the C library's assert.h, for psx_gpu and dfsound, whose checks the emulator's build leaves on and a
// Dreamport's page has nowhere to stop at; and the computer's own anywhere else.
#ifndef __wasm__
#include_next <assert.h>
#else
#define assert(x) ((void)0)
#endif
