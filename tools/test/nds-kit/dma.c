// The made-up Nintendo DS program whose processors copy and fill memory with DMA (../made-up-nds-dma.mjs) as a Dreamport
// in C, on the Nintendo DS kit in C (kit/nds/c/), for npm run test:nds-kit: its two programs written again, each read
// and write where the original makes it. Its channel 1's control, the backwards copy, is filled in by the test, which
// also makes a wrong one of it.

#include "nds.h"

#define BLOCK 0x02200000
#define DMA 0x040000B0
#define FILL 0x040000E0
// the time the original's instructions take around its timed copy, as the test's maker read it on melonDS from the
// timer, beside the copy's own
#define AROUND 20
// the ARM7's loop of 5000 turns after each V-blank starts, which only has to end before the ARM9 shows what it copied
#define WAITING7 50000

static const uint32_t WAYS[4][2] = {
  { BLOCK, BLOCK + 0x2000 }, { BLOCK, 0x05000404 }, { 0x05000002, BLOCK + 0x2000 }, { BLOCK, 0x06800000 },
};
static const uint32_t CONTROLS[4] = { 0x80000000, 0x84000000, 0x80000000, 0x84000000 };

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  nds9_write8(0x04000240, 0x80);
  nds9_write32(NDS_TIMER(2), 0x00800000);
  nds9_write32(DMA, BLOCK + 0x30000);
  nds9_write32(DMA + 4, NDS_PALETTE_A);
  nds9_write32(DMA + 8, 0xCB600001);
  uint32_t frames = 0;
  for (;;) {
    nds9_wait_vblank(16);
    frames++;
    for (uint32_t i = 0; i < 32; i++) nds9_write16(BLOCK + 2 * i, (frames * 7 + i * 3) & 0x7FFF);
    nds9_write32(DMA + 12, BLOCK);
    nds9_write32(DMA + 16, BLOCK + 0x103E);
    nds9_write32(DMA + 20, @REVERSE@);
    nds9_write32(FILL, frames << 16 | frames);
    nds9_write32(DMA + 24, FILL);
    nds9_write32(DMA + 28, BLOCK + 0x1100);
    nds9_write32(DMA + 32, 0x85000008);
    uint32_t way = (frames >> 1) & 3;
    nds9_write32(DMA + 36, WAYS[way][0]);
    nds9_write32(DMA + 40, WAYS[way][1]);
    uint32_t before = nds9_read16(NDS_TIMER(2));
    nds9_spend(AROUND);
    nds9_write32(DMA + 44, CONTROLS[way] | ((frames & 127) + 20));
    uint32_t took = nds9_read16(NDS_TIMER(2)) - before;
    uint32_t shown = frames & 1 ? took : nds9_read16(BLOCK + 0x1000 + 2 * (frames & 31)) ^ nds9_read32(BLOCK + 0x1100 + 4 * (frames & 7));
    nds9_write16(BLOCK + 0x30000, shown & 0x7FFF);
    uint32_t flag = (nds9_read32(NDS_IF) >> 8) & 1;
    nds9_write32(NDS_IF, 0x100);
    uint32_t flags = nds9_read32(BLOCK + 0x1300) + flag;
    nds9_write32(BLOCK + 0x1300, flags);
    uint32_t seven = nds9_read16(BLOCK + 0x3000 + 2 * (frames & 15)) & 0x3FF;
    nds9_write16(NDS_PALETTE_B, (flags & 31) | seven << 5);
  }
}

void game_arm7(void) {
  for (;;) {
    nds7_wait_vblank(16);
    nds7_spend(WAITING7);
    nds7_write32(DMA + 36, BLOCK);
    nds7_write32(DMA + 40, 0x03800100);
    nds7_write32(DMA + 44, 0x84000010);
    nds7_write32(DMA, 0x0380013E);
    nds7_write32(DMA + 4, BLOCK + 0x3000);
    nds7_write32(DMA + 8, 0x80800020);
  }
}
