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

// the console's fast work memory, at the console's own address in both builds
#define IWRAM_START 0x03000000

// the hardware's registers the twins name, by how far each is from 0x04000000
enum { REG_DISPSTAT = 0x004, REG_VCOUNT = 0x006, REG_IF = 0x202 };
enum { DISPSTAT_VBLANK = 0x0001, INTR_FLAG_HBLANK = 0x0002, DISPLAY_HEIGHT = 160 };

#ifdef MATCHING
// built with the console's compiler: the hardware is the console's, and a function is kept and called by its address
#define CODE(function) function
#define CALL(pointer) pointer

// one of the hardware's registers, by how far it is from 0x04000000
#define REG_READ8(at) (*(vu8 *)(0x04000000 + (at)))
#define REG_READ16(at) (*(vu16 *)(0x04000000 + (at)))
#define REG_WRITE16(at, value) (*(vu16 *)(0x04000000 + (at)) = (value))

/** Fills `size` bytes at `dest` with the 32-bit `value`, through DMA channel 3. */
#define DMA3_FILL32(value, dest, size)                \
  {                                                   \
    vu32 filler = (vu32)(value);                      \
    vu32 *dma = (vu32 *)0x040000D4;                   \
    dma[0] = (vu32)&filler;                           \
    dma[1] = (vu32)(dest);                            \
    dma[2] = 0x85000000 | ((size) / 4);               \
    dma[2];                                           \
  }

/** Fills `size` bytes at `dest` with the 16-bit `value`, through DMA channel 3. */
#define DMA3_FILL16(value, dest, size)                \
  {                                                   \
    vu16 filler = (vu16)(value);                      \
    vu32 *dma = (vu32 *)0x040000D4;                   \
    dma[0] = (vu32)&filler;                           \
    dma[1] = (vu32)(dest);                            \
    dma[2] = 0x81000000 | ((size) / 2);               \
    dma[2];                                           \
  }

/** Copies `size` bytes from `src` to `dest`, 32 bits at a time, through DMA channel 3. */
#define DMA3_COPY32(src, dest, size)                  \
  {                                                   \
    vu32 *dma = (vu32 *)0x040000D4;                   \
    dma[0] = (vu32)(src);                             \
    dma[1] = (vu32)(dest);                            \
    dma[2] = 0x84000000 | ((u32)(size) / 4);          \
    dma[2];                                           \
  }
#else
// built for a Dreamport: the kit is the hardware, and memory names a function by its address in the original
#define CODE(function) TWIN_ADDRESS(function)
#define CALL(pointer) TWIN(pointer)

/** One of the hardware's registers, by how far it is from 0x04000000, read as the kit has it. */
u16 console_read16(u32 at);
#define REG_READ8(at) ((u8)console_read16(at))
#define REG_READ16(at) console_read16(at)
#define REG_WRITE16(at, value) gba_write(at, value)

/** DMA channel 3 given the three words the console's is: done at once, as the console does one that starts now. */
void console_dma3(u32 src, u32 dest, u32 control);
#define DMA3_FILL32(value, dest, size)                                        \
  {                                                                           \
    vu32 filler = (vu32)(value);                                              \
    console_dma3((u32)&filler, (u32)(dest), 0x85000000 | ((size) / 4));       \
  }
#define DMA3_FILL16(value, dest, size)                                        \
  {                                                                           \
    vu16 filler = (vu16)(value);                                              \
    console_dma3((u32)&filler, (u32)(dest), 0x81000000 | ((size) / 2));       \
  }
#define DMA3_COPY32(src, dest, size) console_dma3((u32)(src), (u32)(dest), 0x84000000 | ((u32)(size) / 4));
#endif

#endif
