// The twins of the made-up program for memories of play (../made-up-ps1.mjs, madeUpPlayExe), as a game's C is: each
// names the function of the original it's the twin of in the comment above it, and keeps every value where the console
// keeps it. ../ps1-memories.mjs checks them against the original from the memory each starts from in play.

extern int D_80030000;

/** Level, 0x80010100: the level play set, one up */
int Level(void) {
  return D_80030000 + 1;
}

/** Add, 0x80010200: adds to a count only play makes */
int Add(int *count, int by) {
  *count += by;
  return *count;
}
