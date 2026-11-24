// The made-up Nintendo DS program with backgrounds (../made-up-nds-bg.mjs) as a Dreamport in C, on the Nintendo DS kit
// in C (kit/nds/c/), for npm run test:nds-kit: its ARM9's program written again, each write where the original makes it.
// @FLIP@ and @FRONT@ are filled in by the test, which also makes wrong ones of it.

#include "nds.h"

#define STATE 0x02200000

static const uint16_t COLOURS[32] = {
  0x0000, 0x001F, 0x03E0, 0x7C00, 0x03FF, 0x7FE0, 0x7C1F, 0x4210, 0x2108, 0x6318, 0x0010, 0x0200, 0x4000, 0x0210, 0x4200, 0x4010,
  0x0000, 0x0C63, 0x1CE7, 0x2D6B, 0x3DEF, 0x4E73, 0x5EF7, 0x6F7B, 0x7FFF, 0x1234, 0x2345, 0x3456, 0x4567, 0x5678, 0x6789, 0x789A,
};

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  // bank A for engine A's backgrounds, bank C for engine B's
  nds9_write8(0x04000240, 0x81);
  nds9_write8(0x04000242, 0x84);
  for (uint32_t i = 0; i < 32; i++) nds9_write16(NDS_PALETTE_A + 2 * i, COLOURS[i]);
  uint32_t colour = 0;
  for (uint32_t at = NDS_PALETTE_B; at < NDS_PALETTE_B + 0x200; at += 2) {
    nds9_write16(at, colour);
    colour = (colour + 0x0421) & 0x7FFF;
  }
  // engine A's two tiles of 16 colours, a stripe and a block, and engine B's of 256, the colours 1 to 64
  for (uint32_t i = 0; i < 8; i++) nds9_write32(0x06004020 + 4 * i, 0x76543210);
  for (uint32_t i = 0; i < 8; i++) nds9_write32(0x06004040 + 4 * i, 0x99999999);
  for (uint32_t b = 1; b < 65; b += 2) nds9_write16(0x06204040 + b - 1, b | (b + 1) << 8);
  // the maps: engine A's first background, its second, and engine B's
  for (uint32_t i = 0; i < 1024; i++) nds9_write16(0x06000000 + 2 * i, (1 + ((i ^ i >> 5) & 1)) | ((i >> 2) & 1) << 12 | ((i >> 6) & 1) @FLIP@);
  for (uint32_t i = 0; i < 1024; i++) nds9_write16(0x06000800 + 2 * i, i & 7 ? 0 : 0x1802);
  for (uint32_t i = 0; i < 1024; i++) nds9_write16(0x06200000 + 2 * i, 1 | (i & 3) << 10);
  nds9_write16(0x04000008, 0x0005);
  nds9_write16(0x0400000A, @FRONT@);
  nds9_write16(0x04001008, 0x0084);
  nds9_write32(NDS_DISPCNT_A, 0x00010300);
  nds9_write32(NDS_DISPCNT_B, 0x00010100);
  uint32_t frames = 0;
  for (;;) {
    nds9_wait_vblank(16);
    frames++;
    nds9_write16(0x04000010, frames);
    nds9_write16(0x04000012, frames >> 1);
    uint32_t keys = nds9_read16(NDS_KEYINPUT), left = nds9_read32(STATE);
    if (!(keys & 1)) nds9_write32(STATE, left += 2);
    nds9_write16(0x04000014, -left);
    uint32_t right = nds9_read32(STATE + 4);
    if (!(keys & 16)) nds9_write32(STATE + 4, right -= 1);
    nds9_write16(0x04001010, right);
    nds9_write16(0x04001012, frames);
  }
}

// the ARM7's program, which waits
void game_arm7(void) {
  for (;;) nds7_wait_vblank(16);
}
