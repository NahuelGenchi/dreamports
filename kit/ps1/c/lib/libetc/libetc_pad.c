// SPDX-License-Identifier: MIT
// libetc's first setup of the pads, through the BIOS's own driver (libapi's PAD_init).
#include "libetc_internal.h"

extern int PadIdentifier;

static int pad_buf;

/** Sets the pads up: keeps the mode, starts the callbacks, and has the BIOS read both pads into pad_buf. */
void PadInit(int mode) {
    PadIdentifier = mode;
    pad_buf = -1;
    ResetCallback();
    PAD_init(0x20000001, &pad_buf);
    ChangeClearPAD(0);
}

/** The buttons held, a bit each, set for held: the BIOS's word turned over. */
u_long PadRead(int id) {
    PAD_dr();
    return ~pad_buf;
}

/** Stops the BIOS reading the pads. */
void PadStop(void) { StopPAD(); }
