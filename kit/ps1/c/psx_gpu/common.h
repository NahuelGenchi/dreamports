// The kit's own: what psx_gpu.c takes for granted, its types and its own declarations (kit/ps1/c/psx_gpu/NOTICE.md).
#ifndef COMMON_H
#define COMMON_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// the clock psx_gpu.c's benchmark reads, which a Dreamport never runs: the computer's, or none built to WebAssembly
#ifdef __wasm__
struct timeval { long tv_sec, tv_usec; };
static inline int gettimeofday(struct timeval *now, void *zone) { now->tv_sec = now->tv_usec = 0; return 0; }
#else
#include <sys/time.h>
#endif

#include "vector_types.h"
#include "psx_gpu.h"

#endif
