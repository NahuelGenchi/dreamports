// The made-up Nintendo DS program whose processors wait for the V-blank in the BIOS and count their interrupts
// (../made-up-nds-irq.mjs) as a Dreamport in C, on the Nintendo DS kit in C (kit/nds/c/), for npm run test:nds-kit: its
// two programs and their handlers written again, each read and write where the original makes it. Its timer 0's
// control, as the ARM9 starts it, is filled in by the test, which also makes a wrong one of it.

#include "nds.h"

#define COUNTS 0x02210000

// The time the original's instructions take on melonDS where the Dreamport has to keep it, as the test's maker read it
// there from the timers that count the clock: each processor's start, up to where it starts the timer its V-blank
// handler reads; and the ARM9's way from its V-blank wait to its write of timer 0's control, which takes 9 ticks more
// on an odd frame's way and on the way with A let go.
#define START9 262
#define START7 160
#define TO_CONTROL 852
#define OTHER_WAY 18
// the ARM9's loop of 10000 turns after its work each frame, which only has to end mid-frame
#define WAITING9 120000

static void handler9(void) {
  uint32_t taken = nds9_read32(NDS_IF);
  nds9_write32(NDS_IF, taken);
  if (taken & 8) nds9_write32(COUNTS + 4, nds9_read32(COUNTS + 4) + 1);
  if (taken & 16) nds9_write32(COUNTS + 8, nds9_read32(COUNTS + 8) + 1);
  if (taken & 1) {
    nds9_write32(COUNTS + 12, nds9_read16(NDS_TIMER(2)));
    uint32_t counts = nds9_read32(COUNTS) + 1;
    nds9_write32(COUNTS, counts);
    counts &= 31;
    counts |= (nds9_read32(COUNTS + 4) & 31) << 5;
    counts |= (nds9_read32(COUNTS + 8) & 31) << 10;
    nds9_write32(COUNTS + 40, counts);
  }
  nds9_write32(0x03003FF8, nds9_read32(0x03003FF8) | taken);
}

void game_arm9(void) {
  nds9_write16(NDS_POWCNT, 0x8203);
  nds9_write32(NDS_DISPCNT_A, 0x10000);
  nds9_write32(NDS_DISPCNT_B, 0x10000);
  nds9_on_interrupt(handler9);
  nds9_write16(NDS_IPCFIFOCNT, 0x8000);
  nds9_spend(START9);
  nds9_write32(NDS_TIMER(2), 0x00800000);
  nds9_write32(NDS_TIMER(1), 0x00C4FFFD);
  nds9_write32(NDS_TIMER(0), @TIMER0@);
  nds9_write16(NDS_DISPSTAT, 8);
  nds9_write32(NDS_IE, 0x19);
  nds9_write32(NDS_IME, 1);
  uint32_t frames = 0;
  for (;;) {
    nds9_intr_wait(1, 1);
    frames++;
    uint32_t upper = nds9_read32(COUNTS + (frames & 1 ? 12 : 40)), lower = nds9_read32(COUNTS + (frames & 1 ? 36 : 32));
    nds9_write16(NDS_PALETTE_A, upper & 0x7FFF);
    nds9_write16(NDS_PALETTE_B, lower & 0x7FFF);
    uint32_t keys = nds9_read16(NDS_KEYINPUT);
    nds9_spend(TO_CONTROL + (frames & 1 ? OTHER_WAY : 0) + (keys & 1 ? OTHER_WAY : 0));
    nds9_write16(NDS_TIMER(0) + 2, keys & 1 ? 0xC3 : 0x43);
    nds9_write32(COUNTS + 48, nds9_read16(NDS_TIMER(2)));
    if (!(keys & 2)) nds9_write16(NDS_IPCSYNC, 0x2000);
    if (!(keys & 8)) nds9_write32(NDS_IPCFIFOSEND, frames);
    nds9_spend(WAITING9);
    nds9_write32(COUNTS + 32, nds9_read32(COUNTS + 44));
    nds9_write32(COUNTS + 36, nds9_read32(COUNTS + 28));
  }
}

static void handler7(void) {
  uint32_t taken = nds7_read32(NDS_IF);
  nds7_write32(NDS_IF, taken);
  if (taken & 8) nds7_write32(COUNTS + 20, nds7_read32(COUNTS + 20) + 1);
  if (taken & 0x10000) nds7_write32(COUNTS + 24, nds7_read32(COUNTS + 24) + 1);
  if (taken & 0x40000) {
    while (!(nds7_read16(NDS_IPCFIFOCNT) & 0x100)) {
      uint32_t word = nds7_read32(NDS_IPCFIFORECV);
      nds7_write32(COUNTS + 24, nds7_read32(COUNTS + 24) + word);
    }
  }
  if (taken & 1) {
    nds7_write32(COUNTS + 28, nds7_read16(NDS_TIMER(1)));
    uint32_t counts = nds7_read32(COUNTS + 16) + 1;
    nds7_write32(COUNTS + 16, counts);
    counts &= 31;
    counts |= (nds7_read32(COUNTS + 20) & 31) << 5;
    counts |= (nds7_read32(COUNTS + 24) & 31) << 10;
    nds7_write32(COUNTS + 44, counts);
  }
  nds7_write32(0x03FFFFF8, nds7_read32(0x03FFFFF8) | taken);
}

void game_arm7(void) {
  nds7_on_interrupt(handler7);
  nds7_write16(NDS_IPCSYNC, 0x4000);
  nds7_write16(NDS_IPCFIFOCNT, 0x8400);
  nds7_spend(START7);
  nds7_write32(NDS_TIMER(1), 0x00800000);
  nds7_write32(NDS_TIMER(0), 0x00C2E000);
  nds7_write16(NDS_DISPSTAT, 8);
  nds7_write32(NDS_IE, 0x00050009);
  nds7_write32(NDS_IME, 1);
  for (;;) nds7_intr_wait(1, 1);
}
