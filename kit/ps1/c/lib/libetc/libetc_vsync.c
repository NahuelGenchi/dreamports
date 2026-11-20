// SPDX-License-Identifier: MIT
// libetc's wait for the V-blank, timed by the V-blanks counted so far and the first root counter's lines.
#include "libetc_internal.h"

extern volatile s32 Vcount;
static volatile s32* gpu_status = (s32*)0x1F801814;
static volatile s32* hblank_counter = (s32*)0x1F801110;
volatile s32 Hcount = 0;
static volatile s32 prevVcount = 0;

/** Waits for a V-blank: with a mode below 0 gives the V-blanks counted, with 1 the lines since the last call, with 0
 *  waits for the next V-blank and with more waits for that many since the last call, then gives the lines. */
s32 VSync(s32 mode) {
    s32 temp_s0;
    s32 ret;
    s32 max;
    s32 waitCount;

    temp_s0 = *gpu_status;

    ret = (*hblank_counter - Hcount) & 0xFFFF;
    if (mode < 0) {
        return Vcount;
    }
    if (mode == 1) {
        return ret;
    }
    if (mode > 0) {
        waitCount = 1;
        waitCount = (prevVcount - waitCount) + mode;
    } else {
        waitCount = prevVcount;
    }
    max = 0;
    if (mode > 0) {
        max = mode - 1;
    }
    v_wait(waitCount, max);
    temp_s0 = *gpu_status;
    v_wait(Vcount + 1, 1);
    if (temp_s0 & 0x80000) {
        while (!((temp_s0 ^ *gpu_status) & 0x80000000)) {
        }
    }
    prevVcount = Vcount;
    Hcount = *hblank_counter;
    return ret;
}

/** Waits until the V-blanks counted reach `count`, or about `max` frames' worth of tries, and then says so and starts
 *  the pads' and the counters' interrupts clearing themselves again. */
void v_wait(s32 count, s32 max) {
    volatile s32 timeout[2];

    timeout[0] = max << 0xF;
    while (Vcount < count) {
        if (timeout[0]-- == 0) {
            puts("VSync: timeout\n");
            ChangeClearPAD(0);
            ChangeClearRCnt(3, 0);
            return;
        }
    }
}
