// The made-up Nintendo DS program that reads its own cartridge (../made-up-nds-cart.mjs) as a Dreamport in C, on the
// Nintendo DS kit in C (kit/nds/c/), for npm run test:nds-kit: its ARM9's program written again, each read and write
// where the original makes it, its ARM7's doing nothing. The command's place, highest byte first, is filled in by the
// test, which also makes a wrong one of it.

#include "nds.h"

#define SLOT 0x040001A0
#define DATA 0x04100010
#define COUNT 0x02200100
// the original's loop, about 7 ticks an instruction: 5 to see a word hasn't come, and 6 more to take one
#define POLL 70
#define TAKE 84

// each way: how far its place moves each frame, with the size's bits on top; where it starts, above its command
static const uint32_t WAYS[4][2] = {
  { 0x01000264, 0x008000B7 }, { 0x07000135, 0x008000B7 }, { 0x07000000, 0x000000B8 }, { 0x01000044, 0x000000B7 },
};

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  nds9_write16(0x04000204, nds9_read16(0x04000204) & ~0x0800u);
  nds9_write16(SLOT, 0xC000);
  uint32_t frames = 0;
  for (;;) {
    nds9_wait_vblank(16);
    frames++;
    const uint32_t *way = WAYS[frames & 3];
    uint32_t place = ((frames * way[0]) & 0x7FFF) + (way[1] >> 8);
    nds9_write32(SLOT + 8, (way[1] & 0xFF) | @PLACE@);
    nds9_write32(SLOT + 12, place & 0xFF);
    uint32_t control = (way[0] >> 24) << 24 | 0xA0180018u | (frames & 4 ? 0x08000000u : 0);
    uint32_t sum = 0, mix = 0;
    nds9_write32(SLOT + 4, control);
    for (;;) {
      nds9_spend(POLL);
      uint32_t state = nds9_read32(SLOT + 4);
      if (state & 0x00800000) {
        uint32_t word = nds9_read32(DATA);
        sum += word;
        mix = (mix << 3) ^ word;
        nds9_spend(TAKE);
      }
      if (!(state & 0x80000000u)) break;
    }
    uint32_t flag = nds9_read32(NDS_IF) & 0x80000;
    nds9_write32(NDS_IF, flag);
    uint32_t count = nds9_read32(COUNT) + (flag >> 19);
    nds9_write32(COUNT, count);
    nds9_write16(NDS_PALETTE_A, sum & 0x7FFF);
    nds9_write16(NDS_PALETTE_B, (frames & 1 ? (count << 10) ^ (sum >> 15) : mix) & 0x7FFF);
  }
}

void game_arm7(void) {}
