// A routine of the function check's test (../twin.mjs) written by hand into the cartridge (cartridge.mjs, withPeek),
// as a library's assembly can be: it takes an address in r2 and gives back in r3, which no C function does, so its
// twin's comment says so, dp:registers, and the check compares r3 with what that C works out.

/** Peek, 0x08000A40, dp:registers r3 = Peek((const unsigned char *)r2) */
unsigned Peek(const unsigned char *at) {
  return at[0] + 1;
}
