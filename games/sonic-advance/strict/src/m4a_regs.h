// The console's sound and DMA registers the sound library writes, each as the C variable the library's source
// names: at the console's own address for its compiler (MATCHING), and in the version's own registers, console_io
// (hardware.c), for a Dreamport, which keeps every value the library writes without a sound chip behind it yet.
#ifndef SA_M4A_REGS_H
#define SA_M4A_REGS_H
#include "console.h"

typedef u8 bool8;
#ifdef MATCHING
typedef u32 uintptr_t;
typedef s32 intptr_t;
#endif

#ifdef MATCHING
#define M4A_REG(bits, offset) (*(vu##bits *)(0x04000000 + (offset)))
#define REG_ADDR_VCOUNT 0x04000006
#define REG_ADDR_FIFO_A 0x040000A0
#define REG_ADDR_FIFO_B 0x040000A4
#define REG_ADDR_WAVE_RAM0 0x04000090
#define REG_ADDR_NR10 0x04000060
#define REG_ADDR_NR30 0x04000070
#define REG_ADDR_DMA1SAD 0x040000BC
#define REG_ADDR_DMA2SAD 0x040000C8
#else
extern u16 console_io[];
#define M4A_REG(bits, offset) (*(vu##bits *)((u8 *)console_io + (offset)))
// the line count, a line on each time it's looked at, as the console's goes on while the library waits for one line
u32 console_vcount_at(void);
#define REG_ADDR_VCOUNT console_vcount_at()
#define REG_ADDR_FIFO_A ((u32)console_io + 0xA0)
#define REG_ADDR_FIFO_B ((u32)console_io + 0xA4)
#define REG_ADDR_WAVE_RAM0 ((u32)console_io + 0x90)
#define REG_ADDR_NR10 ((u32)console_io + 0x60)
#define REG_ADDR_NR30 ((u32)console_io + 0x70)
#define REG_ADDR_DMA1SAD ((u32)console_io + 0xBC)
#define REG_ADDR_DMA2SAD ((u32)console_io + 0xC8)
#endif

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

// the sound library's state, which the BIOS's and the library's own code find at the top of the fast work memory
#define SOUND_INFO_PTR (*(struct SoundMixerState **)0x03007FF0)
#define UNUSED
#define ALIGNED(n) __attribute__((aligned(n)))
#define PLATFORM_GBA 1
#define COLLECT_RINGS_ROM 0
#define ENGINE_3 3
#define ENGINE 1
#define USE_NEW_DMA 0

#endif
