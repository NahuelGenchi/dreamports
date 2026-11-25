// The made-up Nintendo DS program whose two processors talk (../made-up-nds-ipc.mjs) as a Dreamport in C, on the
// Nintendo DS kit in C (kit/nds/c/), for npm run test:nds-kit: its two programs written again, each read and write where
// the original makes it. The shared memory's control, as the ARM9 takes it, is filled in by the test, which also makes
// a wrong one of it.

#include "nds.h"

#define SYNC 0x04000180
#define FIFOCNT 0x04000184
#define SEND 0x04000188
#define RECEIVE 0x04100000
#define WRAMCNT 0x04000247
#define DTCM 0x03000000
#define SHARED 0x03007000

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  nds9_write16(FIFOCNT, 0x8008);
  uint32_t frames = 0, reply = 0;
  for (;;) {
    nds9_wait_vblank(16);
    frames++;
    if (!(nds9_read16(FIFOCNT) & 0x100)) reply = nds9_read32(RECEIVE);
    nds9_write16(NDS_PALETTE_A, reply & 0x7FFF);
    nds9_write16(NDS_PALETTE_B, (nds9_read16(SYNC) & 15) << 10 | (frames & 31));
    nds9_write32(SEND, frames);
    nds9_write16(SYNC, (~nds9_read16(NDS_KEYINPUT) & 15) << 8);
    nds9_write8(WRAMCNT, @WRAMCNT@);
    nds9_write32(DTCM, frames * 3);
    nds9_write32(SHARED, frames * 3);
    nds9_write8(WRAMCNT, 3);
  }
}

// the ARM7's, which waits a while after the V-blank starts, so the ARM9 is done, as the original's loop of a thousand
// turns does
void game_arm7(void) {
  nds7_write16(FIFOCNT, 0x8008);
  uint32_t sum = 0;
  for (;;) {
    nds7_wait_vblank(16);
    nds7_spend(20000);
    while (!(nds7_read16(FIFOCNT) & 0x100)) sum += nds7_read32(RECEIVE);
    sum += nds7_read16(SYNC) & 15;
    uint32_t word = nds7_read32(SHARED) + nds7_read32(DTCM);
    nds7_write32(SEND, sum + word);
    nds7_write16(SYNC, (sum & 15) << 8);
  }
}
