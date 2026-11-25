// The function check on the Game Boy (../twin.mjs): a twin's contract as the build writes it from a `dp:twin` line,
// after the game's own file, so it names only what no game's C would.
#ifndef DREAMPORTS_GB_TWIN_CONTRACT_H
#define DREAMPORTS_GB_TWIN_CONTRACT_H
#include <stdint.h>

// the processor's registers and flags, as a contract names them. SP is the stack pointer as the function starts,
// after the CALL that called it: the address it comes back to is at SP and SP + 1.
typedef struct { uint8_t A, B, C, D, E, H, L; uint16_t SP; int ZF, NF, HF, CF; } twin_regs;

typedef struct {
  const char *name, *text;        // the original's function as the game's code names it, and the contract's words
  uint32_t offset;                // where the function is in the program
  int allowance;                  // how many cycles the twin counts beyond the function's own
  int gives;                      // whether it says what the twin gives back
  unsigned by_address;            // the registers and flags the twin is given by address, a bit each in the order A B C D E H L ZF NF HF CF
  int stack;                      // whether it's given the stack pointer, SP, which each call then starts with any value of
  void (*call)(twin_regs *r, long *gave);
  long (*back)(const twin_regs *r);
  int (*given)(const twin_regs *r);
} twin_contract;

#endif
