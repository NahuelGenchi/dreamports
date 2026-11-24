// The twins of the made-up Game Boy program's functions (../made-up-gb.mjs, madeUpTwins), for the function check's
// test (../gb-twin.mjs): each is the original's function in C, with its contract beside it. The test builds this file
// as it is, where every twin has to be the same as its original, and again with one line changed, where the check has
// to find it.

#include "gb.h"

#define RAM(address) gb_wram[(address) - 0xC000]
// dp:bank $C010
// A name of the file's own that is a register's, as a game's C can have: the check puts it aside before it reads the
// contracts, where HL is the register pair.
#define HL RAM(0xC021)

/** sub_0500: adds `amount` to the total at $C020 and $C021 and counts the call at $C022. Whether the low byte went past 255. */
// dp:twin sub_0500 add_to_total(A) -> CF
int add_to_total(uint8_t amount) {
  uint16_t sum = (uint16_t)(RAM(0xC020) + amount);
  RAM(0xC020) = (uint8_t)sum;
  if (sum > 0xFF) HL++;
  RAM(0xC022)++;
  gb_spend(sum > 0xFF ? 100 : 92);
  return sum > 0xFF;
}

/** sub_0520: the fourth byte of each four of the table at $0600, by `index`, to $C030, and back. */
// dp:twin sub_0520 pick(B) -> A
static uint8_t pick(uint8_t index) {
  uint8_t byte = gb_read((uint16_t)(0x0600 + (uint8_t)(index * 4)));
  RAM(0xC030) = byte;
  gb_spend(64);
  return byte;
}

/** sub_0540: the line the screen is at, to $C031, and `shades` to the background's palette. `c` is the processor's C, left one higher. */
// dp:twin sub_0540 send(A, &C)
void send(uint8_t shades, uint8_t *c) {
  RAM(0xC031) = gb_read(0xFF44);
  gb_write(0xFF47, shades);
  (*c)++;
}

/** sub_0560: the byte at $5000 + `at` of the bank that's switched in, to $C033. */
// dp:twin sub_0560 look(E)
void look(uint8_t at) {
  RAM(0xC033) = gb_read((uint16_t)(0x5000 + at));
}

/** sub_01_4100, in bank 1: the byte at $5000 + `at` of its own bank, to $C032. */
// dp:twin sub_01_4100 own(D)
void own(uint8_t at) {
  RAM(0xC032) = gb_read((uint16_t)(0x5000 + at));
}

/** sub_0580: switches to the bank in `bank`, and keeps its number at $C010. */
// dp:twin sub_0580 switch_to(A)
void switch_to(uint8_t bank) {
  RAM(0xC010) = bank;
  gb_write(0x2000, bank);
}

/** sub_05A0: zeros as many bytes as `count`, or 256 for 0, from `from`, and gives where it stopped. */
// dp:twin sub_05A0 clear(&HL, B) if HL >= 0xC100 && HL < 0xDC00
void clear(uint16_t *from, uint8_t count) {
  do gb_write((*from)++, 0);
  while (--count);
}
