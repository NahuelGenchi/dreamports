// The PlayStation's kit in C, on what every console's kit in C shares (kit/c/README.md). A game writes the console's
// graphics chip, the GPU, as its original does, a word at a time to its two ports, GP0 and GP1, and the kit draws what
// it's told into the GPU's own 1 MB of video memory and shows the part the GPU is told to show. It writes the sound
// chip, the SPU, a halfword at a time to its registers, and moves sound data into its memory as DMA does, and the kit
// mixes what it's told. It reads the pads a byte at a time through their serial port, SIO0, and the kit's pads answer
// as the console's do (kit/ps1/c/README.md).

#ifndef DREAMPORTS_PS1_H
#define DREAMPORTS_PS1_H

#include "console.h"

// where the processor sees the GPU's two ports, which a game's C writes through these functions
enum { GPU_GP0 = 0x1F801810, GPU_GP1 = 0x1F801814 };

/** A word to GP0: a drawing command, or the next word of one, or of a picture moved into video memory. */
void gpu_gp0(uint32_t word);
/** A word to GP1: what the screen shows, and the GPU's own settings. */
void gpu_gp1(uint32_t word);
/** The GPU's status, as a read of GP1 gives it: what it shows, and that it's ready for more. */
uint32_t gpu_status(void);
/** Paints the page's picture with the part of video memory the GPU shows, at its size. For game_draw. */
void gpu_show(void);
/** The GPU's video memory: 512 rows of 1024 pixels of 16 bits, a colour of 5 bits each of red, green and blue, red
 *  lowest, as gpu_vram[y][x]. */
extern uint16_t (*const gpu_vram)[1024];

// where the processor sees the sound chip's registers, a halfword each: its 24 voices', 16 bytes each, from here, and
// the chip's own from SPU_BASE + 0x180
enum { SPU_BASE = 0x1F801C00 };

/** A halfword to one of the sound chip's registers, at its address, from SPU_BASE to SPU_BASE + 0x3FF. */
void spu_write(uint32_t address, uint16_t value);
/** What a read of one of the sound chip's registers gives. */
uint16_t spu_read(uint32_t address);
/** What DMA's channel 4 moves into the sound chip's memory: `count` halfwords, from the address its transfer register
 *  (SPU_BASE + 0x1A6) says on. */
void spu_dma_write(const uint16_t *halves, int count);
/** What DMA's channel 4 moves out of the sound chip's memory into `halves`. */
void spu_dma_read(uint16_t *halves, int count);
/** Fills `left` and `right` with the sound chip's next `count` samples, each -1 to 1. For game_sound. */
void spu_sound(float *left, float *right, int count);

// where the processor sees the serial port the pads and memory cards share, SIO0: the byte sent and received, its
// status, mode, control and speed
enum { SIO_BASE = 0x1F801040 };

/** A write to one of SIO0's registers, at its address: a byte sent to the selected port at SIO_BASE, its mode at
 *  SIO_BASE + 8, its control at SIO_BASE + 0xA, which selects a port, and its speed at SIO_BASE + 0xE. */
void sio_write(uint32_t address, uint32_t value);
/** What a read of one of SIO0's registers gives: the byte the port sent back at SIO_BASE, and its status at
 *  SIO_BASE + 4, which says a byte has come back. */
uint32_t sio_read(uint32_t address);
/** The 16 bits the pad in `port` (0 or 1) sends back for its buttons this frame, low byte first, a bit clear for each
 *  button held, as the console's BIOS keeps them in its pad buffers. */
uint16_t pad_buttons(int port);

// What a game defines, as on every console (kit/c/README.md).
void game_start(void);
void game_step(uint32_t buttons);
void game_draw(void);
void game_sound(float *left, float *right, int count);

#endif
