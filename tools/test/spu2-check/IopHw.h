// A stand-in for one of PCSX2's headers, with only what its SPU2's mixing needs of it, for the check of the kit's sound chip
// against PCSX2's (tools/test/ps2-spu2.mjs). Nothing here is PCSX2's own text.
#pragma once
#include "common/Pcsx2Types.h"
extern u32 HW_DMA4_MADR, HW_DMA4_TADR, HW_DMA7_MADR, HW_DMA7_TADR, HW_DMA4_BCR, HW_DMA7_BCR, HW_DMA4_CHCR, HW_DMA7_CHCR;
void spu2Irq(); void spu2DMA4Irq(); void spu2DMA7Irq();
inline void* iopPhysMem(u32) { return nullptr; }
