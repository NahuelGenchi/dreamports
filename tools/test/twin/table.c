// A function of the function check's test (../twin.mjs) that reads through a pointer the game keeps to one of its own
// tables in the cartridge, in a file of its own so the other tests' program stays as it is. The table is a list of
// pointers to numbers, and no number in it has its top two bits set, which one of the function's paths needs, so only
// a call given a table made up in the work memory takes it: the check makes one up, laid out as this C has it, with
// the numbers its pointers lead to made up too (../../gba/twin-shapes.mjs).
#include "program.h"

/** A table of pieces: each kind's numbers, and how many kinds. */
struct Table {
  const u16 *const *pieces;
  u16 kinds;
};

extern const struct Table *gTable;
extern u16 gKind;
extern u32 gWide;

/** Measure, 0x08000E80: the first number of the kind's piece adds 2 to the width when its top two bits are set, or
 *  its lowest bit otherwise. */
void Measure(void) {
  const u16 *piece = gTable->pieces[gKind];
  if (piece[0] >> 14 == 3) gWide += 2;
  else gWide += piece[0] & 1;
}
