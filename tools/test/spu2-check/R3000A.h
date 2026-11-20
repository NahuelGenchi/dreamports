// A stand-in for one of PCSX2's headers, with only what its SPU2's mixing needs of it, for the check of the kit's sound chip
// against PCSX2's (tools/test/ps2-spu2.mjs). Nothing here is PCSX2's own text.
#pragma once
#include "common/Pcsx2Types.h"
struct psxRegsStub { u32 cycle; };
extern psxRegsStub psxRegs;
struct psxCounterStub { u64 startCycle; u32 deltaCycles; };
extern psxCounterStub psxCounters[8];
extern u32 psxNextStartCounter; extern s32 psxNextDeltaCounter;
