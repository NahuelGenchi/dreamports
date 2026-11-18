// A function of the function check's test (../twin.mjs) that divides through the BIOS, as games do, in a file of its
// own so the other tests' program stays as it is. On the console it calls the cartridge's stub, swi 6 and back
// (cartridge.mjs); its twin divides itself.
#include "program.h"

s32 Div(s32 num, s32 denom);

/** Share, 0x08000540: a total shared out by what its kind counts for, through the BIOS's division, kept as the frame. */
u32 Share(s32 total, u8 kind) {
  gFrame = Div(total, gSteps[kind & 3]);
  return gFrame;
}

#ifndef MATCHING
// what the BIOS works out for a game's swi 6: the quotient, rounded toward zero
s32 Div(s32 num, s32 denom) { return num / denom; }
#endif
