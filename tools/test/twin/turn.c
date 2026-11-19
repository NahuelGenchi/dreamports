// A function of the function check's test (../twin.mjs) in ARM code written by hand into the cartridge
// (cartridge.mjs, withTurn), as a game's library can be: it reads a word where none starts, which the processor reads
// as the word around it, turned. Its twin says so, dp:unaligned, so the check compares those calls.
#include "program.h"

/** Turn, 0x08000900, dp:unaligned: the word at gFrame + 2, as the processor's LDR gives it, kept at gFrame + 4. */
void Turn(void) {
  u32 word = *(volatile u32 *)0x03000020;
  *(volatile u32 *)0x03000024 = word >> 16 | word << 16;
}
