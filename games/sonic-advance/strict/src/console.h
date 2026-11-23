// What a twin sees of the console. The same C is built twice: by the console's own compiler, to compare its bytes with
// the original's (MATCHING is defined, as match defines it), and for the Dreamport, on the kit, with the console's work
// memory at the console's addresses (tools/README.md, The same-memory build). Only this header and hardware.c tell the
// two apart.
#ifndef CONSOLE_H
#define CONSOLE_H

#ifdef MATCHING
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed char s8;
typedef signed short s16;
typedef signed int s32;
#define NULL ((void *)0)
#else
#include "gba.h"
#include "twins.h"
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int8_t s8;
typedef int16_t s16;
typedef int32_t s32;
#endif

typedef volatile u8 vu8;
typedef volatile u16 vu16;
typedef volatile u32 vu32;
typedef u32 bool32;
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

// the console's fast work memory, at the console's own address in both builds
#define IWRAM_START 0x03000000

// the hardware's registers the twins name, by how far each is from 0x04000000
enum { REG_DISPSTAT = 0x004, REG_VCOUNT = 0x006, REG_SIOCNT = 0x128, REG_RCNT = 0x134, REG_IE = 0x200, REG_IF = 0x202, REG_WAITCNT = 0x204, REG_IME = 0x208 };
enum { DISPSTAT_VBLANK = 0x0001, DISPSTAT_VBLANK_INTR = 0x0008, DISPSTAT_HBLANK_INTR = 0x0010 };
enum { INTR_FLAG_VBLANK = 0x0001, INTR_FLAG_HBLANK = 0x0002, INTR_FLAG_TIMER3 = 0x0040, INTR_FLAG_SERIAL = 0x0080, DISPLAY_HEIGHT = 160 };

// where the console has its memories
#define VRAM 0x06000000
#define VRAM_SIZE 0x18000
#define OBJ_VRAM0 0x06010000
#define OAM 0x07000000
#define OAM_SIZE 0x400
#define PLTT 0x05000000
#define PLTT_SIZE 0x400
#define EWRAM_START 0x02000000
/** Where the console's BIOS goes when an interrupt comes, at the top of the fast work memory. */
#define INTR_VECTOR (*(void **)0x03007FFC)

#ifdef MATCHING
// built with the console's compiler: the hardware is the console's, and a function is kept and called by its address
#define CODE(function) function
#define CALL(pointer) pointer

// one of the hardware's registers, by how far it is from 0x04000000
#define REG_READ8(at) (*(vu8 *)(0x04000000 + (at)))
#define REG_READ16(at) (*(vu16 *)(0x04000000 + (at)))
#define REG_WRITE16(at, value) (*(vu16 *)(0x04000000 + (at)) = (value))
#define REG_WRITE32(at, value) (*(vu32 *)(0x04000000 + (at)) = (value))

/** DMA channel 3 given its three words: where from, where to, and how. */
#define DMA3_SET(src, dest, control)                  \
  {                                                   \
    vu32 *dma = (vu32 *)0x040000D4;                   \
    dma[0] = (vu32)(src);                             \
    dma[1] = (vu32)(dest);                            \
    dma[2] = (vu32)(control);                         \
    dma[2];                                           \
  }

/** Fills `size` bytes at `dest` with the 32-bit `value`, through DMA channel 3. */
#define DMA3_FILL32(value, dest, size)                                       \
  {                                                                          \
    vu32 filler = (vu32)(value);                                             \
    DMA3_SET(&filler, dest, (u32)(0x8500 << 16 | ((size) / 4)));             \
  }

/** Fills `size` bytes at `dest` with the 16-bit `value`, through DMA channel 3. */
#define DMA3_FILL16(value, dest, size)                                       \
  {                                                                          \
    vu16 filler = (vu16)(value);                                             \
    DMA3_SET(&filler, dest, (u32)(0x8100 << 16 | ((size) / 2)));             \
  }

/** Copies `size` bytes from `src` to `dest`, 16 bits at a time, through DMA channel 3. */
#define DMA3_COPY16(src, dest, size) DMA3_SET(src, dest, (u32)(0x8000 << 16 | ((size) / 2)))

/** Copies `size` bytes from `src` to `dest`, 32 bits at a time, through DMA channel 3. */
#define DMA3_COPY32(src, dest, size) DMA3_SET(src, dest, (u32)(0x8400 << 16 | ((size) / 4)))
#else
// built for a Dreamport: the kit is the hardware, and memory names a function by its address in the original
#define CODE(function) TWIN_ADDRESS(function)
#define CALL(pointer) TWIN(pointer)

/** One of the hardware's registers, by how far it is from 0x04000000: the display's are the kit's, and the rest the
 *  version's own (hardware.c). */
u16 console_read16(u32 at);
void console_write16(u32 at, u16 value);
#define REG_READ8(at) ((u8)console_read16(at))
#define REG_READ16(at) console_read16(at)
#define REG_WRITE16(at, value) console_write16(at, value)
#define REG_WRITE32(at, value) (console_write16(at, (u16)(value)), console_write16((at) + 2, (u16)((u32)(value) >> 16)))

/** DMA channel 3 given the three words the console's is: done at once, as the console does one that starts now. */
void console_dma3(u32 src, u32 dest, u32 control);
/** The same, from a value of the Dreamport's own, as a fill's is: read where it is, as the console reads its stack. */
void console_dma3_own(const void *src, u32 dest, u32 control);
/** At the V-blank: DMA channel 3, if it waits for it. */
void console_vblank_dma3(void);
#define DMA3_FILL32(value, dest, size)                                        \
  {                                                                           \
    vu32 filler = (vu32)(value);                                              \
    console_dma3_own((const void *)&filler, (u32)(dest), 0x85000000 | ((size) / 4)); \
  }
#define DMA3_FILL16(value, dest, size)                                        \
  {                                                                           \
    vu16 filler = (vu16)(value);                                              \
    console_dma3_own((const void *)&filler, (u32)(dest), 0x81000000 | ((size) / 2)); \
  }
#define DMA3_COPY16(src, dest, size) console_dma3((u32)(src), (u32)(dest), 0x80000000 | ((u32)(size) / 2));
#define DMA3_COPY32(src, dest, size) console_dma3((u32)(src), (u32)(dest), 0x84000000 | ((u32)(size) / 4));
#endif

#endif
