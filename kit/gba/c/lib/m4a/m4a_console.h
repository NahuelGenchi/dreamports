// What the m4a sound engine sees of the console. The same C is built twice: by the console's own compiler, which
// match compares with the original's bytes (MATCHING is defined, as match defines it), and for a Dreamport, on the kit,
// with the console's work memory at the console's addresses (tools/README.md, The same-memory build).
//
// The registers are the console's own for its compiler. In a Dreamport there's no sound chip behind them, so a
// version that takes the engine keeps them itself and gives the engine two things:
//   u16 console_io[]: the console's registers, each at its distance from 0x04000000, which the engine writes and reads
//   u32 console_vcount_at(void): where the line count is kept, a line on each time it's looked at, as the console's
//     goes on while the engine waits for one line
#ifndef M4A_CONSOLE_H
#define M4A_CONSOLE_H

#ifdef MATCHING
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed char s8;
typedef signed short s16;
typedef signed int s32;
typedef unsigned long long u64;
typedef u32 uintptr_t;
typedef s32 intptr_t;
#define NULL ((void *)0)
#else
#include <stdint.h>
#include <stddef.h>
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int8_t s8;
typedef int16_t s16;
typedef int32_t s32;
typedef uint64_t u64;
#endif

typedef volatile u8 vu8;
typedef volatile u16 vu16;
typedef volatile u32 vu32;
typedef u32 bool32;
typedef u8 bool8;
#define TRUE 1
#define FALSE 0

/** The BIOS's copier: copies or fills `control`'s count of halfwords or words from `src` to `dest`. */
void CpuSet(const void *src, void *dest, u32 control);
#define CPU_SET_SRC_FIXED 0x01000000
#define CPU_SET_32BIT 0x04000000
/** Fills `size` bytes at `dest` with the 32-bit `value`, through the BIOS's copier. */
#define CpuFill32(value, dest, size)                                                          \
  {                                                                                           \
    vu32 tmp = (vu32)(value);                                                                 \
    CpuSet((void *)&tmp, dest, CPU_SET_32BIT | CPU_SET_SRC_FIXED | ((size) / 4 & 0x1FFFFF));  \
  }
/** Copies `size` bytes from `src` to `dest`, 32 bits at a time, through the BIOS's copier. */
#define CpuCopy32(src, dest, size) CpuSet(src, dest, CPU_SET_32BIT | ((size) / 4 & 0x1FFFFF))

// The console's time (kit/gba/c/clock.h, kit/gba/c/README.md, The console's time), for a game that keeps it: one whose
// twins.h names this library's functions hears from each, after its C does the work of a run of the original's
// instructions, which they were. M4A_TIME(function, from, to, next, ...) is a twin's TIME with `from` and `to` as
// offsets in the library's own `function`, M4A_AT(function, offset) an address in it, in Thumb code, and M4A_BACK the
// way back from a call, wherever it came from. M4A_DIVIDE is a division by the compiler's own library, whose path the
// numbers decide. Only the paths a game's power-on takes say so, as the clock is for power-on, and a run that writes a
// register the C writes again later is timed before the later write, as the clock reads what the register holds. The
// console's compiler sees none of it.
#if !defined(MATCHING) && defined(__has_include)
#if __has_include("twins.h") && __has_include("clock.h")
#include "twins.h"
#include "clock.h"
// a game whose twins.h names the functions power-on runs: the library's, and the compiler's division and indirect call
#if defined(ADDRESS_m4aSoundInit) && defined(ADDRESS_SoundInit) && defined(ADDRESS_SampleFreqSet) \
    && defined(ADDRESS_m4aSoundMode) && defined(ADDRESS_m4aSoundVSyncOff) && defined(ADDRESS_m4aSoundVSyncOn) \
    && defined(ADDRESS_MPlayExtender) && defined(ADDRESS_MPlayOpen) && defined(ADDRESS_Clear64byte) \
    && defined(ADDRESS_SoundMainBTM) && defined(ADDRESS_MPlayJumpTableCopy) && defined(ADDRESS_chk_adr_r2) \
    && defined(ADDRESS_CpuSet) && defined(ADDRESS___divsi3) && defined(ADDRESS__call_via_r1)
#define M4A_TIMED
#endif
#endif
#endif
#define M4A_EW 0x02000000u
#define M4A_IW 0x03000000u
#define M4A_ROM 0x08000000u
#ifdef M4A_TIMED
#define M4A_BACK GBA_CLOCK_BACK
#define M4A_AT(function, offset) ((((uint32_t)ADDRESS_##function) & ~1u) + (offset) + 1u)
#define M4A_TIME(function, from, to, next, ...)                                                             \
  do {                                                                                                      \
    const uint32_t m4a_at_[] = { 0, ##__VA_ARGS__ };                                                        \
    uint32_t m4a_base_ = ((uint32_t)ADDRESS_##function) & ~1u;                                              \
    gba_clock_run(m4a_base_ + (from), m4a_base_ + (to), (next), m4a_at_ + 1, (int)(sizeof m4a_at_ / sizeof m4a_at_[0]) - 1); \
  } while (0)
#define M4A_DIVIDE(numerator, denominator) \
  gba_clock_divsi3(((uint32_t)ADDRESS___divsi3) & ~1u, (int32_t)(numerator), (int32_t)(denominator), GBA_CLOCK_BACK)
#else
#define M4A_TIME(function, from, to, next, ...)
#define M4A_DIVIDE(numerator, denominator)
#endif

// the console's sound and DMA registers the engine writes, each as the C its source names
#ifdef MATCHING
#define M4A_REG(bits, offset) (*(vu##bits *)(0x04000000 + (offset)))
#define M4A_REG_ADDR(offset) (0x04000000 + (offset))
#define REG_ADDR_VCOUNT M4A_REG_ADDR(0x006)
#else
extern u16 console_io[];
u32 console_vcount_at(void);
#define M4A_REG(bits, offset) (*(vu##bits *)((u8 *)console_io + (offset)))
#define M4A_REG_ADDR(offset) ((u32)console_io + (offset))
#define REG_ADDR_VCOUNT console_vcount_at()
#endif
#define REG_ADDR_FIFO_A M4A_REG_ADDR(0x0A0)
#define REG_ADDR_FIFO_B M4A_REG_ADDR(0x0A4)
#define REG_ADDR_WAVE_RAM0 M4A_REG_ADDR(0x090)
#define REG_ADDR_NR10 M4A_REG_ADDR(0x060)
#define REG_ADDR_NR30 M4A_REG_ADDR(0x070)
#define REG_ADDR_DMA1SAD M4A_REG_ADDR(0x0BC)
#define REG_ADDR_DMA2SAD M4A_REG_ADDR(0x0C8)

#define REG_SOUNDCNT_L M4A_REG(16, 0x080)
#define REG_FIFO_A M4A_REG(32, 0x0A0)
#define REG_FIFO_B M4A_REG(32, 0x0A4)
#define REG_WAVE_RAM0 M4A_REG(32, 0x090)
#define REG_WAVE_RAM1 M4A_REG(32, 0x094)
#define REG_WAVE_RAM2 M4A_REG(32, 0x098)
#define REG_WAVE_RAM3 M4A_REG(32, 0x09C)
#define REG_NR10 M4A_REG(8, 0x060)
#define REG_NR11 M4A_REG(8, 0x062)
#define REG_NR12 M4A_REG(8, 0x063)
#define REG_NR13 M4A_REG(8, 0x064)
#define REG_NR14 M4A_REG(8, 0x065)
#define REG_NR21 M4A_REG(8, 0x068)
#define REG_NR22 M4A_REG(8, 0x069)
#define REG_NR23 M4A_REG(8, 0x06C)
#define REG_NR24 M4A_REG(8, 0x06D)
#define REG_NR30 M4A_REG(8, 0x070)
#define REG_NR31 M4A_REG(8, 0x072)
#define REG_NR32 M4A_REG(8, 0x073)
#define REG_NR33 M4A_REG(8, 0x074)
#define REG_NR34 M4A_REG(8, 0x075)
#define REG_NR41 M4A_REG(8, 0x078)
#define REG_NR42 M4A_REG(8, 0x079)
#define REG_NR43 M4A_REG(8, 0x07C)
#define REG_NR44 M4A_REG(8, 0x07D)
#define REG_NR50 M4A_REG(8, 0x080)
#define REG_NR51 M4A_REG(8, 0x081)
#define REG_SOUNDCNT_H M4A_REG(16, 0x082)
#define REG_SOUNDCNT_X M4A_REG(16, 0x084)
#define REG_NR52 M4A_REG(8, 0x084)
#define REG_SOUNDBIAS_H M4A_REG(8, 0x089)
#define REG_DMA1SAD M4A_REG(32, 0x0BC)
#define REG_DMA1DAD M4A_REG(32, 0x0C0)
#define REG_DMA1CNT M4A_REG(32, 0x0C4)
#define REG_DMA1CNT_H M4A_REG(16, 0x0C6)
#define REG_DMA2SAD M4A_REG(32, 0x0C8)
#define REG_DMA2DAD M4A_REG(32, 0x0CC)
#define REG_DMA2CNT M4A_REG(32, 0x0D0)
#define REG_DMA2CNT_H M4A_REG(16, 0x0D2)
#define REG_TM0CNT_L M4A_REG(16, 0x100)
#define REG_TM0CNT_H M4A_REG(16, 0x102)

#ifndef DMA_ENABLE
#define DMA_ENABLE 0x8000
#endif
#define DMA_32BIT 0x0400
#define DMA_REPEAT 0x0200
#define DMA_START_NOW 0x0000
#define DMA_SRC_INC 0x0000
#define DMA_DEST_FIXED 0x0040
#define DMA_START_SPECIAL 0x3000
#define DMA_16BIT 0x0000
#define DMA_DEST_RELOAD 0x0060
#define DMA_START_VBLANK 0x1000
#define DMA_START_HBLANK 0x2000
#define SOUND_MASTER_ENABLE 0x0080
#define SOUND_4_ON 0x0008
#define SOUND_3_ON 0x0004
#define SOUND_2_ON 0x0002
#define SOUND_1_ON 0x0001
#define TIMER_ENABLE 0x80
#define TIMER_1CLK 0x00
#define SOUND_CGB_MIX_FULL 0x0002
#define SOUND_A_MIX_FULL 0x0004
#define SOUND_B_MIX_FULL 0x0008
#define SOUND_A_RIGHT_OUTPUT 0x0100
#define SOUND_A_LEFT_OUTPUT 0x0200
#define SOUND_B_RIGHT_OUTPUT 0x1000
#define SOUND_B_LEFT_OUTPUT 0x2000
#define SOUND_A_TIMER_0 0x0000
#define SOUND_B_TIMER_0 0x0000
#define SOUND_A_FIFO_RESET 0x0800
#define SOUND_B_FIFO_RESET 0x8000
#define SOUND_ALL_MIX_FULL 0x000E

// where the engine keeps its state, which the BIOS's and the engine's own code find at the top of the fast work memory
#define SOUND_INFO_PTR (*(struct SoundMixerState **)(0x03000000 + 0x7FF0))
#define UNUSED
#define ALIGNED(n) __attribute__((aligned(n)))

#endif
