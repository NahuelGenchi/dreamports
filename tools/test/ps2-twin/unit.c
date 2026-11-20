// The twins of the made-up programs for vector unit 1 (module.mjs), written again in C on the kit's unit, for the
// function check's test of a disc's other programs (../ps2-twin-programs.mjs): each names its program by the code
// map's key, where its first pair is in the file it's uploaded from, with ~vu, takes nothing, and gives back where in
// the unit's code memory the program stops.

#include "ps2.h"

/** 0x00000008@DATA/UNIT.BIN~vu: doubles the first vector of the unit's memory into the second, and sends the GS the
 *  packet at the third */
unsigned doubler(void) {
  vu_vector *data = (vu_vector *)vu_data(1);
  *vu_vf(1, 1) = data[0];
  vu_sum(1, VU_ADD, vu_vf(1, 2), vu_vf(1, 1), vu_vf(1, 1), VU_XYZW);
  data[1] = *vu_vf(1, 2);
  vu_set_vi(1, 1, 2);
  vu1_kick(vu_vi(1, 1) * 16);
  return 48;
}

/** 0x00000050@DATA/UNIT.BIN~vu: counts VI1 down from 3 */
unsigned counter(void) {
  for (vu_set_vi(1, 1, 3); vu_vi(1, 1) != 0; ) vu_set_vi(1, 1, vu_vi(1, 1) - 1);
  return 0x100 + 56;
}

// the same count as a game gives it to the kit, for another place in the unit's code memory
static unsigned counted(void) {
  return counter() + 0x100;
}

/** 0x00000098@DATA/UNIT.BIN~vu: the same count, run the way the kit runs a program in C for a game: given to the kit
 *  for its place, and started there by the EE's write to CMSAR1, as the VIF's MSCAL starts one too. With no program
 *  in C there the kit would run the unit's own code memory, which is empty here. */
unsigned started(void) {
  vu_program(1, 0x200, counted);
  vu0_ctc2(31, 0x200 / 8);
  return 0x200 + 56;
}
