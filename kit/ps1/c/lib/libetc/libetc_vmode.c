// SPDX-License-Identifier: MIT
// libetc's video mode, which the other libraries ask for: 0 for NTSC, 1 for PAL.
#include "libetc_internal.h"

static long video_mode = 0;

/** Sets the video mode and gives the one before. */
long SetVideoMode(long mode) {
    long prev;

    prev = video_mode;
    video_mode = mode;
    return prev;
}

/** The video mode. */
long GetVideoMode() { return video_mode; }
