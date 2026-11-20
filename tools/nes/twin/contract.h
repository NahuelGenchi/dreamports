// The function check on the NES (../twin.mjs): a twin's contract as the build writes it from a `dp:twin` line, after
// the game's own file, so it names only what no game's C would.
#ifndef DREAMPORTS_TWIN_CONTRACT_H
#define DREAMPORTS_TWIN_CONTRACT_H
#include <stdint.h>

// the processor's registers and flags, as a contract names them. S is the stack pointer as the function starts, after
// the JSR that called it: the address it comes back to is at $0101 + S and $0102 + S.
typedef struct { uint8_t A, X, Y, S; int N, V, Z, C; } twin_regs;

typedef struct {
  const char *name, *text;        // the original's function as the game's code names it, and the contract's words
  uint32_t offset;                // where the function is in the program
  int allowance;                  // how many cycles the twin counts beyond the function's own
  int gives;                      // whether it says what the twin gives back
  unsigned by_address;            // the registers and flags the twin is given by address, a bit each in the order A X Y N V Z C
  int stack;                      // whether it's given the stack pointer, S, which each call then starts with any value of
  void (*call)(twin_regs *r, long *gave);
  long (*back)(const twin_regs *r);
  int (*given)(const twin_regs *r);
} twin_contract;

#endif
