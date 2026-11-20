// What the Super Nintendo kit's own files share (snes.c, ppu.c, dma.c, apu.c, dsp.c, frame.c), which a game doesn't
// need.

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
/** What the console does to the picture unit as V-blank starts, after the frame's last line. */
void ppu_vblank(void);

/** Moves memory by DMA on each channel `channels` has a bit for, as a write to $420B does, one after another. */
void dma_start(uint8_t channels);

/** Puts the sound side as the console starts it: its memory cleared, its timers off, the sound chip reset, and the
 *  start-up program waiting for the main processor. */
void apu_power(void);
/** A write by the main processor to one of the four ports, $2140 to $2143, 0 to 3 here. */
void apu_port_write(int port, uint8_t value);
/** A read by the main processor of one of the four ports: what the sound processor last wrote there. */
uint8_t apu_port_read(int port);
/** Runs the sound side on to the end of the frame: its program's turns as its timers count, and the sound chip. */
void apu_frame(void);
/** The sound chip's next sample, left and right, as it makes one every 32 of the sound processor's cycles. */
void apu_sample(int16_t left, int16_t right);
/** Takes `count` of the samples made so far, oldest first, into `left` and `right`, each -1 to 1; silence for any
 *  not made yet. */
void apu_samples(float *left, float *right, int count);

/** Resets the sound chip, which plays from the sound processor's memory `ram`. */
void dsp_power(uint8_t *ram);
/** Runs the sound chip for `cycles` of the sound processor's. */
void dsp_run(uint32_t cycles);
/** The sound chip's register at `address`, $00 to $7F, as the sound processor reads it at $F3. */
uint8_t dsp_read(uint8_t address);
/** A write to the sound chip's register at `address`, as the sound processor writes $F3. */
void dsp_write(uint8_t address, uint8_t value);

/** Reads the cartridge's header from the player's copy, as the console's wiring sees it. */
void cartridge_load(void);
/** A write to a 24-bit address of the console's own memories, as DMA from the hardware writes it: the work memory and the
 *  save memory, wherever the map shows them; anything else isn't written. */
void snes_bus_write(uint32_t address, uint8_t value);

#endif
