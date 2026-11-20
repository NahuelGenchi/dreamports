// The PlayStation's kit in C, on what every console's kit in C shares (kit/c/README.md). A game writes the console's
// graphics chip, the GPU, as its original does, a word at a time to its two ports, GP0 and GP1, and the kit draws what
// it's told into the GPU's own 1 MB of video memory and shows the part the GPU is told to show (kit/ps1/c/README.md).

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

// What a game defines, as on every console (kit/c/README.md).
void game_start(void);
void game_step(uint32_t buttons);
void game_draw(void);
void game_sound(float *left, float *right, int count);

#endif
