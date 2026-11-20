// A function of the function check's test (../twin.mjs) that starts in Thumb and goes on into ARM code, written by hand
// into the cartridge (cartridge.mjs, withTwice), as a library's veneer does: the code map keeps its ARM part as a
// function of its own, so its twin says how long the whole routine is, dp:run, and is the twin of both.

/** Twice, 0x08000A80, dp:run 28: the word at gFrame + 4, twice over, kept at gFrame + 8. */
void Twice(void) {
  *(volatile unsigned *)0x03000028 = *(volatile unsigned *)0x03000024 << 1;
}
