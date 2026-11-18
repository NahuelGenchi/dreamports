// The console's four DMA channels and the read-modify-write of its registers, for the twins that use more of them than
// console.h gives: the same C for the console's compiler (MATCHING) and for a Dreamport, where the kit is the hardware.
#ifndef DMA_H
#define DMA_H
#include "console.h"

// each channel's three registers: source, destination, and count with control
#define DMA_CHANNEL(n) (0x040000B0 + (n) * 12)
#define DMA_ENABLE 0x8000

#ifdef MATCHING
/** DMA channel `n` given its three words. */
#define DMA_SET(n, src, dest, control)                \
  {                                                   \
    vu32 *dmaRegs = (vu32 *)DMA_CHANNEL(n);           \
    dmaRegs[0] = (vu32)(src);                         \
    dmaRegs[1] = (vu32)(dest);                        \
    dmaRegs[2] = (vu32)(control);                     \
    dmaRegs[2];                                       \
  }
/** Stops channel `n`: no more repeats, then not enabled. */
#define DMA_STOP(n)                                   \
  {                                                   \
    vu16 *dmaRegs = (vu16 *)DMA_CHANNEL(n);           \
    dmaRegs[5] &= ~(0x3000 | 0x0800 | 0x0200);        \
    dmaRegs[5] &= ~DMA_ENABLE;                        \
    dmaRegs[5];                                       \
  }
/** Stops channel `n` as the save's code does, reading the control back after each step. */
#define DMA_SLOW_STOP(n)                              \
  {                                                   \
    vu16 *dmaRegs = (vu16 *)DMA_CHANNEL(n);           \
    dmaRegs[5] &= ~(0x3000 | 0x0800 | 0x0200);        \
    dmaRegs[5];                                       \
    dmaRegs[5] &= ~DMA_ENABLE;                        \
    dmaRegs[5];                                       \
    dmaRegs[5];                                       \
  }
/** Waits until channel `n` is done. */
#define DMA_WAIT(n)                                   \
  {                                                   \
    vu32 *dmaRegs = (vu32 *)DMA_CHANNEL(n);           \
    while (dmaRegs[2] & (DMA_ENABLE << 16)) {}        \
  }
#define REG_OR16(at, value) (*(vu16 *)(0x04000000 + (at)) |= (value))
#define REG_AND16(at, value) (*(vu16 *)(0x04000000 + (at)) &= (value))
#define REG_INTR_CHECK (*(u16 *)0x03007FF8)
#else
void console_dma(u32 n, u32 src, u32 dest, u32 control);
void console_dma_stop(u32 n);
#define DMA_SET(n, src, dest, control) console_dma(n, (u32)(src), (u32)(dest), (u32)(control))
#define DMA_STOP(n) console_dma_stop(n)
#define DMA_SLOW_STOP(n) console_dma_stop(n)
#define DMA_WAIT(n) {}
#define REG_OR16(at, value) gba_write(at, console_read16(at) | (value))
#define REG_AND16(at, value) gba_write(at, console_read16(at) & (value))
#define REG_INTR_CHECK (*(u16 *)0x03007FF8)
#endif

/** Copies `size` bytes from `src` to `dest` through channel `n`, 16 or 32 bits at a time, at once. */
#define DMA_COPY16(n, src, dest, size) DMA_SET(n, src, dest, (u32)(0x8000 << 16 | ((size) / 2)))
#define DMA_COPY32(n, src, dest, size) DMA_SET(n, src, dest, (u32)(0x8400 << 16 | ((size) / 4)))
/** Fills `size` bytes at `dest` with `value` through channel `n`, 32 bits at a time, at once. */
#define DMA_FILL32(n, value, dest, size)                                     \
  {                                                                          \
    vu32 tmp = (vu32)(value);                                                \
    DMA_SET(n, &tmp, dest, (u32)(0x8500 << 16 | ((size) / 4)));              \
  }

#endif
