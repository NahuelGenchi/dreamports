// SPDX-License-Identifier: MIT
// libetc's DMA interrupt: it calls a callback when a DMA channel finishes, and says when the bus had an error.
#include "libetc_internal.h"

Callback setIntrDMA(int index, Callback callback);
void trapIntrDMA(void);
void DMA_memclr(int* ptr, int size);

static volatile u_long* dma_interrupt = (u_long*)0x1F8010F4;
static Callback dma_callbacks[8] = {0};
static u_long* dma_channels = (u_long*)0x1F801080;

/** Starts the DMA's callbacks, none set and every channel's interrupt off. */
void* startIntrDMA(void) {
    DMA_memclr((int*)&dma_callbacks, 8);
    *dma_interrupt = 0;
    InterruptCallback(3, &trapIntrDMA);
    return &setIntrDMA;
}

/** Calls the callback of each channel that finished, until none has, and says so when the bus had an error. */
void trapIntrDMA(void) {
    u32 mask;
    int i;

    while ((mask = (*dma_interrupt >> 24) & 0x7f) != 0) {
        for (i = 0; mask != 0 && i < 7; i++, mask >>= 1) {
            if (mask & 1) {
                *dma_interrupt &= (0xffffff | (1 << (i + 24)));
                if (dma_callbacks[i] != NULL) {
                    dma_callbacks[i]();
                }
            }
        }
    }

    if ((*dma_interrupt & 0xFF000000) == 0x80000000 || *dma_interrupt & 0x8000) {
        printf("DMA bus error: code=%08x\n", *dma_interrupt);
        for (i = 0; i < 7; i++) {
            printf("MADR[%d]=%08x\n", i, dma_channels[4 * i]);
        }
    }
}

/** Sets channel `index`'s callback and lets its interrupt through, or with none stops it, and gives the one before. */
Callback setIntrDMA(int index, Callback callback) {
    Callback prev = dma_callbacks[index];
    if (callback != prev) {
        if (callback != NULL) {
            dma_callbacks[index] = callback;
            *dma_interrupt =
                (*dma_interrupt & 0xFFFFFF) | 0x800000 | (1 << (index + 16));
        } else {
            dma_callbacks[index] = 0;
            *dma_interrupt =
                ((*dma_interrupt & 0xFFFFFF) | 0x800000) & ~(1 << (index + 16));
        }
    }
    return prev;
}

/** Sets `size` words from `ptr` to zero. */
void DMA_memclr(int* ptr, int size) {
    while (size--) {
        *ptr++ = 0;
    }
}
