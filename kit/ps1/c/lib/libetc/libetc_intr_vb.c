// SPDX-License-Identifier: MIT
// libetc's V-blank interrupt: it counts V-blanks and calls up to eight callbacks at each.
#include "libetc_internal.h"

void trapIntrVSync(void);
Callback setIntrVSync(int index, Callback callback);
void VSync_memclr(int*, int);

static Callback vsync_callbacks[8] = {0};
volatile int Vcount = 0;
static volatile u_long* root_counter_1_mode = (u_long*)0x1F801114;

/** Starts the count, with the first root counter counting lines, no callbacks, and the V-blank's own callback set. */
VSyncSetter startIntrVSync(void) {
    *root_counter_1_mode = 0x107;
    Vcount = 0;
    VSync_memclr((int*)&vsync_callbacks, 8);
    InterruptCallback(0, &trapIntrVSync);
    return &setIntrVSync;
}

/** Counts a V-blank and calls each callback set. */
void trapIntrVSync(void) {
    int i;

    Vcount += 1;
    (void)Vcount;

    for (i = 0; i < 8; i++) {
        if (vsync_callbacks[i] != NULL) {
            vsync_callbacks[i]();
        }
    }
}

/** Sets V-blank callback `index`, and gives the one before. */
Callback setIntrVSync(int index, Callback callback) {
    Callback ret = vsync_callbacks[index];
    if (callback != ret) {
        vsync_callbacks[index] = callback;
    }
    return ret;
}

/** Sets `size` words from `ptr` to zero. */
void VSync_memclr(int* ptr, int size) {
    while (size--) {
        *ptr++ = 0;
    }
}
