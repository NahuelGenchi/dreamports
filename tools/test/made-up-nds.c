// The made-up Nintendo DS program (made-up-nds.mjs) as a Dreamport in C, on the Nintendo DS kit in C (kit/nds/c/), for
// npm run test:real-nds: its two programs written again, each read and write where the original makes it, and the time
// between them as each spends it. @MOVED@ and @TIMER@ are filled in by the test, which also makes a wrong one of it.

#include "nds.h"

// the words the two programs share in the main memory, as the original keeps them
#define SHARED_KEYS 0x02200000
#define SHARED_X 0x02200004
#define SHARED_Y 0x02200008
#define SHARED_FRAMES 0x0220000C

// how long after the V-blank starts each program's loop sees it, and how long the ARM9 takes from there to read the
// words the ARM7 leaves it: long enough for the ARM7 to have written its buttons, and not to have asked the touch
// screen's chip, which takes three transfers of the serial bus for each of its two numbers
#define SEES 16
#define ARM9_TO_SHARED 200
#define ARM7_TO_KEYS 12

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  uint32_t frames = 0;
  for (;;) {
    nds9_wait_vblank(SEES);
    frames++;
    uint32_t keys = ~nds9_read16(NDS_KEYINPUT) & 0x3FF;
    nds9_write16(NDS_PALETTE_A, (frames & 31) | keys << 5);
    nds9_spend(ARM9_TO_SHARED);
    uint32_t shared = nds9_read32(SHARED_KEYS), lower;
    if (!(shared & 64)) {
      uint32_t x = nds9_read32(SHARED_X), y = nds9_read32(SHARED_Y);
      lower = (x >> 7) | (y >> 7) << 5 | 0x4000;
    } else {
      lower = (~shared & 3) << 10;
    }
    nds9_write16(NDS_PALETTE_B, lower);
    nds9_write32(SHARED_FRAMES, frames);
  }
}

static void spi_wait(void) {
  while (nds7_read16(NDS_SPICNT) & 0x80) nds7_spend(8);
}

// one of the touch screen's numbers, 12 bits, from the chip over the serial bus, as the original asks for it
static uint32_t touch(uint32_t control) {
  nds7_write16(NDS_SPICNT, 0x8A01);
  nds7_write16(NDS_SPIDATA, control);
  spi_wait();
  nds7_write16(NDS_SPIDATA, 0);
  spi_wait();
  uint32_t high = nds7_read16(NDS_SPIDATA);
  nds7_write16(NDS_SPICNT, 0x8201);
  nds7_write16(NDS_SPIDATA, 0);
  spi_wait();
  uint32_t low = nds7_read16(NDS_SPIDATA);
  return ((high << 8 | low) << 17) >> 20;
}

void game_arm7(void) {
  nds7_write16(NDS_POWCNT, 1);
  nds7_write16(NDS_SOUNDCNT, 0x807F);
  nds7_write16(NDS_SOUNDBIAS, 0x200);
  nds7_write16(NDS_SOUND(9) + 8, @TIMER@);
  for (;;) {
    nds7_wait_vblank(SEES);
    uint32_t pen = nds7_read16(NDS_EXTKEYIN);
    if (!(pen & 64)) {
      nds7_write32(SHARED_X, touch(0xD0) + @MOVED@ * 16);
      nds7_write32(SHARED_Y, touch(0x90));
    }
    nds7_spend(ARM7_TO_KEYS);
    nds7_write32(SHARED_KEYS, pen);
    uint32_t keys = nds7_read16(NDS_KEYINPUT);
    nds7_write32(NDS_SOUND(9), keys & 1 ? 0 : 0xE340007F);
  }
}
