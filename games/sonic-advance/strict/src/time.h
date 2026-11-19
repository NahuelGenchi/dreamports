// The console's time, for the frames that end in the middle of the game's work, as power-on's do (kit/gba/c/clock.h,
// kit/gba/c/README.md, The console's time). After a twin's C does the work of a run of the original's instructions,
// it says which they were: TIME(from, to, next, ...), the run from `from` to `to` going on to `next`, odd in Thumb
// code, and after it, in order, where each of its loads and stores that isn't the pool's or the stack's reaches, and a
// mul's first register's value. Only the memory a load or store reaches decides its time, so most are named by it:
// IW the fast work memory, EW the slow one, ROM the cartridge, and a register by its own address, as the clock takes
// the game's writes of the DMA channels, the timers, the sound and WAITCNT at the stores of them. The console's
// compiler sees none of it.
#ifndef TIME_H
#define TIME_H

#define EW 0x02000000u
#define IW 0x03000000u
#define ROM 0x08000000u
// DMA channel 3 started as the console's library starts it: where from, where to, how, and how read back
#define DMA3 0x040000D4u, 0x040000D8u, 0x040000DCu, 0x040000DCu

#ifdef MATCHING
#define TIME(from, to, next, ...)
#else
#include "clock.h"
// a run's `next` when it goes back from a call, to wherever the call came from
#define BACK GBA_CLOCK_BACK
#define TIME(from, to, next, ...)                                                                        \
  do {                                                                                                   \
    const uint32_t time_at_[] = { 0, ##__VA_ARGS__ };                                                    \
    gba_clock_run((from), (to), (next), time_at_ + 1, (int)(sizeof time_at_ / sizeof time_at_[0]) - 1); \
  } while (0)
#endif
#endif
