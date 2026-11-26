// The made-up Nintendo DS program's Dreamport in C (../made-up-nds-parts.mjs), on the Nintendo DS kit in C (kit/nds/c/):
// each frame, as the V-blank starts, the ARM9's program calls the twins where the original calls its functions, and
// colours the two screens as the original does, and the ARM7's does nothing, as the original's waits for ever. The upper
// screen's colour is filled in by the test (nds-flow.mjs), which also makes a wrong one of it.

#include "nds.h"
#include "game.h"

static struct state state;

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  for (;;) {
    nds9_wait_vblank(16);
    state.keys = ~nds9_read16(NDS_KEYINPUT);
    tick(&state);
    if (state.keys & 1) bump(&state);
    nds9_write16(NDS_PALETTE_A, @SHOWN@);
    nds9_write16(NDS_PALETTE_B, state.lower);
  }
}

void game_arm7(void) {}
