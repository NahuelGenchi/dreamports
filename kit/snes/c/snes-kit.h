// What the Super Nintendo kit's own files share (snes.c, ppu.c, dma.c, frame.c), which a game doesn't need.

#ifndef DREAMPORTS_SNES_KIT_H
#define DREAMPORTS_SNES_KIT_H

#include "snes.h"
#include "kit.h"

// how wide and how tall the console's picture is, and the line the first one shown is: the console doesn't show line 0
enum { SNES_WIDTH = 256, SNES_HEIGHT = 224, SNES_FIRST_LINE = 1 };

/** Puts the picture unit as the console starts it: the screen off, its memories cleared. */
void ppu_power(void);
/** A write to a register of the picture unit, $2100 to $2133. */
void ppu_write(uint16_t address, uint8_t value);
/** Draws the frame's lines, as the registers are, into `out`, SNES_WIDTH by SNES_HEIGHT words, as the page shows them. */
void ppu_frame(uint32_t *out);

/** Moves memory by DMA on each channel `channels` has a bit for, as a write to $420B does, one after another. */
void dma_start(uint8_t channels);

/** Reads the cartridge's header from the player's copy, as the console's wiring sees it. */
void cartridge_load(void);
/** A write to a 24-bit address of the console's own memories, as DMA from the hardware writes it: the work memory and the
 *  save memory, wherever the map shows them; anything else isn't written. */
void snes_bus_write(uint32_t address, uint8_t value);

#endif
