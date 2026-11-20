// The twins of the made-up NES program's functions (../made-up-nes.mjs, madeUpTwins), for the function check's test
// (../nes-twin.mjs): each is the original's function in C, with its contract beside it. The test builds this file as
// it is, where every twin has to be the same as its original, and again with one line changed, where the check has
// to find it.

#include "nes.h"

#define RAM nes_ram
// dp:bank $10
// A name of the file's own that is a register's letter, as a game's C can have: the check puts it aside before it reads
// the contracts, where Y is the register.
#define Y RAM[0x21]

/** The byte at `address` of the last bank, which is always at $C000. */
static uint8_t last_bank(uint16_t address) { return nes_prg[nes_prg_size - 0x4000 + (address - 0xC000)]; }
/** The byte at `address`, $8000 to $BFFF, with `bank` switched in. */
static uint8_t in_bank(uint8_t bank, uint16_t address) { return nes_prg[(uint32_t)(bank % 4) * 0x4000 + (address - 0x8000)]; }

/** sub_C400: adds `amount` to the total at $20 and $21 and counts the call at $22. Whether the low byte went past 255. */
// dp:twin sub_C400 add_to_total(A) -> C
int add_to_total(uint8_t amount) {
  uint16_t sum = (uint16_t)(RAM[0x20] + amount);
  RAM[0x20] = (uint8_t)sum;
  if (sum > 0xFF) Y++;
  RAM[0x22]++;
  nes_spend(sum > 0xFF ? 26 : 22);
  return sum > 0xFF;
}

/** sub_C420: the fourth byte of each four of the table at $C500, by `index`, to $30. */
// dp:twin sub_C420 pick(X)
static void pick(uint8_t index) {
  RAM[0x30] = last_bank((uint16_t)(0xC500 + (uint8_t)(index * 4)));
  nes_spend(21);
}

/** sub_C440: what the picture's hardware says, to $31, and `value` to it. `x` is the processor's X, left one higher. */
// dp:twin sub_C440 send(A, &X)
void send(uint8_t value, uint8_t *x) {
  RAM[0x31] = nes_read(0x2002);
  nes_write(0x2007, value);
  (*x)++;
}

/** sub_C460: the byte at `place` of the table at $9000 in the bank that's switched in, to $33. */
// dp:twin sub_C460 look(Y)
void look(uint8_t place) { RAM[0x33] = in_bank(RAM[0x10], (uint16_t)(0x9000 + place)); }

/** sub_01_8100, in bank 1: the byte at `place` of its own bank's table, to $32. */
// dp:twin sub_01_8100 own_table(X)
void own_table(uint8_t place) { RAM[0x32] = in_bank(1, (uint16_t)(0x9000 + place)); }

/** sub_C480: the byte at `place` in the stack's page, to $34. The original reads it in a routine it calls, so it can
 *  read that call's return address: `s`, the stack pointer as it starts, says where the call pushes it. Its second
 *  call pushes over it, which the twin leaves out: that's where the call's own frames were, free once it returns. */
// dp:twin sub_C480 peek(X, S)
void peek(uint8_t place, uint8_t s) {
  RAM[0x100 | s] = 0xC4;                  // JSR $C490 leaves $C482, the address before the one it comes back to
  RAM[0x100 | (uint8_t)(s - 1)] = 0x82;
  RAM[0x34] = RAM[0x100 | place];
}

/** sub_C090: switches `bank` in at $8000, and keeps which at $10. */
// dp:twin sub_C090 switch_to(A)
void switch_to(uint8_t bank) { RAM[0x10] = bank; }

void game_start(void) {}
void game_step(uint32_t buttons) { (void)buttons; }
