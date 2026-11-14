// What the PlayStation 2 kit's own files share (gs.c, ps2.c), which a game doesn't need.

#ifndef DREAMPORTS_PS2_KIT_H
#define DREAMPORTS_PS2_KIT_H

#include "ps2.h"

/** Gives the GS its memory, once. */
void gs_power(void);
/** Starts a frame's draw list again. */
void gs_list_start(void);
/** The hash of what has been written since, as the proof tools hash the original's, and how many things that was. */
uint32_t gs_list_hash(void);
uint32_t gs_list_count(void);

#endif
