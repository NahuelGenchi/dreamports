// The made-up Nintendo DS program that divides and takes square roots (../made-up-nds-math.mjs) as a Dreamport in C, on
// the Nintendo DS kit in C (kit/nds/c/), for npm run test:nds-kit: its ARM9's program written again, each read and write
// where the original makes it, its ARM7's doing nothing. The numerator's high word is filled in by the test, which
// also makes a wrong one of it.

#include "nds.h"

#define DIVIDER 0x04000280
#define ROOT 0x040002B0
// The time of one of the original's instructions between its reads and writes of the divider, in the ARM9's cycles,
// as the test's maker read it on melonDS with a timer: 7 ticks. Each gap below is the original's instructions there,
// which decides which of the divisions its writes start are done before the next write starts one again: a 32-bit
// division takes 18 ticks, the others 34, and a square root 13.
#define INSTRUCTION 14

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  uint32_t frames = 0;
  for (;;) {
    nds9_wait_vblank(16);
    frames++;
    nds9_write16(DIVIDER, frames & 3);
    nds9_spend(4 * INSTRUCTION);
    nds9_write32(DIVIDER + 0x10, frames * 0x01234567u);
    nds9_spend(3 * INSTRUCTION);
    nds9_write32(DIVIDER + 0x14, @HIGH@);
    int32_t denominator = (int32_t)(frames & 15) - 3;
    nds9_spend(4 * INSTRUCTION);
    nds9_write32(DIVIDER + 0x18, (uint32_t)denominator);
    nds9_spend(2 * INSTRUCTION);
    nds9_write32(DIVIDER + 0x1C, (uint32_t)(denominator >> 31));
    nds9_spend(INSTRUCTION);
    uint32_t soon = nds9_read32(DIVIDER + 0x20);
    nds9_spend(INSTRUCTION);
    uint32_t busy = nds9_read16(DIVIDER);
    while (nds9_read16(DIVIDER) & 0x8000) nds9_spend(3 * INSTRUCTION);
    uint32_t flags = (busy >> 15) << 10 | (nds9_read16(DIVIDER) >> 14) << 11 | (soon & 0x3FF);
    uint32_t mixed = nds9_read32(DIVIDER + 0x20) ^ nds9_read32(DIVIDER + 0x24);
    mixed ^= nds9_read32(DIVIDER + 0x28);
    mixed ^= nds9_read32(DIVIDER + 0x2C);
    nds9_write16(ROOT, frames & 1);
    nds9_spend(4 * INSTRUCTION);
    nds9_write32(ROOT + 8, frames * 0x01234567u);
    nds9_spend(3 * INSTRUCTION);
    nds9_write32(ROOT + 12, frames * 37);
    nds9_spend(INSTRUCTION);
    uint32_t root_soon = nds9_read32(ROOT + 4);
    while (nds9_read16(ROOT) & 0x8000) nds9_spend(4 * INSTRUCTION);
    uint32_t root = nds9_read32(ROOT + 4);
    uint32_t upper = frames & 1 ? root : mixed, lower = frames & 1 ? root_soon ^ flags : flags;
    nds9_write16(NDS_PALETTE_A, upper & 0x7FFF);
    nds9_write16(NDS_PALETTE_B, lower & 0x7FFF);
  }
}

void game_arm7(void) {}
