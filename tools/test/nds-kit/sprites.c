// The made-up Nintendo DS program with sprites (../made-up-nds-obj.mjs) as a Dreamport in C, on the Nintendo DS kit in
// C (kit/nds/c/), for npm run test:nds-kit: the same writes as it starts, from the same list, which the test fills in
// as SETUP, and the same each frame. FLIP and SPRITE1 are filled in by the test too, which also makes wrong ones of it.

#include "nds.h"

@SETUP@

void game_arm9(void) {
  for (const uint32_t *at = SETUP; *at;) {
    uint32_t address = at[0], count = at[1];
    at += 2;
    for (uint32_t i = 0; i < count; i++) nds9_write16(address + 2 * i, at[i]);
    at += count;
  }
  // the second sprite's priority and tile, as the list has them
  nds9_write16(0x0700000C, @SPRITE1@);
  uint32_t frames = 0;
  for (;;) {
    nds9_wait_vblank(16);
    frames++;
    uint32_t keys = nds9_read16(NDS_KEYINPUT);
    nds9_write16(0x07000002, ((400 + frames) & 0x1FF) | 0x4000);
    nds9_write16(0x07000008, ((100 + frames) & 0xFF) | 0x4000);
    nds9_write16(0x07000010, (120 | 0x2000) | (keys & 1 ? 0 : 0x0200));
    nds9_write16(0x07000402, (frames & 0x1FF) | 0x4000 | (keys & 16 ? 0 : @FLIP@));
  }
}

// the ARM7's program, which waits
void game_arm7(void) {
  for (;;) nds7_wait_vblank(16);
}
