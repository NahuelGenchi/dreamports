// The kit's own: the words psx_gpu's C uses to tell its compiler what's likely, what not to inline and what may go
// unused, as clang takes them.
#ifndef COMPILER_FEATURES_H
#define COMPILER_FEATURES_H

#define likely(x) __builtin_expect(!!(x), 1)
#define unlikely(x) __builtin_expect(!!(x), 0)
#define noinline __attribute__((noinline))
#define attr_unused __attribute__((unused))
#define preload __builtin_prefetch

#endif
