// Tiny Chao Garden's program (garden.c), for the screens its icons open, each a file of its own.

#ifndef SONIC_ADVANCE_GARDEN_H
#define SONIC_ADVANCE_GARDEN_H

#include "sa.h"

/** Where an address in the program is, as the work RAM holds it unpacked. */
const uint8_t *garden_at(uint32_t address);
/** The garden's next random number, 0 to 32767 (0x02001114). */
int garden_random(void);
/** The buttons newly pressed this frame, those held, and whether the game's language is other than Japanese. */
uint16_t garden_pressed(void);
uint16_t garden_held(void);
int garden_language(void);
/** Rings won, to the garden's count, which holds 99,999. */
void garden_add_rings(int rings);
/** What the garden's frames run from the next one on. */
void garden_run(void (*frame)(void));
/** 0x020017FC: back in the garden, which fades in from white with its music; a frame of its own. */
void garden_back(void);
/** The frame's work runs past `frames` V-blanks, as unpacking a screen's pictures does: the garden's loop misses them. */
void garden_lag(int frames);
/** A moment that isn't in C yet: the garden stops there, its screen as it was. */
void garden_not_in_c(void);
/** The BIOS's LZ77UnCompVram from the program at `from` into video memory at `vramAddress`, or into `count` halfwords
 *  of colours or sprites at `to`. */
void garden_unpack_vram(uint32_t from, uint32_t vramAddress);
void garden_unpack_halfwords(uint32_t from, uint16_t *to, int count);

/** The left icon's game (gardenrps.c) and the right one's (gardencards.c), from their first frames. */
void garden_rps(void);
void garden_cards(void);

#endif
