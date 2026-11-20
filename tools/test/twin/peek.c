// Routines of the function check's test (../twin.mjs) written by hand into the cartridge (cartridge.mjs, withPeek),
// as a library's assembly can be: one takes an address in r2 and gives back in r3, which no C function does, so its
// twin's comment says so, dp:registers, and the check compares r3 with what that C works out; the other takes a
// place in gBall in r4 and a byte in r5 and gives nothing back, which the check gives it as it gives r0 to r3.

/** Peek, 0x08000A40, dp:registers r3 = Peek((const unsigned char *)r2) */
unsigned Peek(const unsigned char *at) {
  return at[0] + 1;
}

extern unsigned char gBall[];

/** Spill, 0x08000A48, dp:registers Spill(r4, r5) */
void Spill(unsigned place, unsigned value) {
  gBall[place & 7] = value;
}
