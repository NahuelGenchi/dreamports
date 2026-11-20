// What the PlayStation kit's own files share (gpu.c, draw.c, ps1.c), which a game doesn't need.

#ifndef DREAMPORTS_PS1_KIT_H
#define DREAMPORTS_PS1_KIT_H

#include "ps1.h"
#include "kit.h"

// Around the emulator's own code the kit carries as it is, psx_gpu, which draw.c includes: what a compiler would warn
// of in it says nothing of a Dreamport's own C, so it isn't said.
#if defined(__clang__)
#define EMULATOR_CODE _Pragma("clang diagnostic push") _Pragma("clang diagnostic ignored \"-Weverything\"")
#define END_EMULATOR_CODE _Pragma("clang diagnostic pop")
#else
#define EMULATOR_CODE _Pragma("GCC diagnostic push") \
  _Pragma("GCC diagnostic ignored \"-Wsign-compare\"") _Pragma("GCC diagnostic ignored \"-Wstrict-aliasing\"") \
  _Pragma("GCC diagnostic ignored \"-Wuninitialized\"") _Pragma("GCC diagnostic ignored \"-Wmaybe-uninitialized\"") \
  _Pragma("GCC diagnostic ignored \"-Wempty-body\"") _Pragma("GCC diagnostic ignored \"-Wabsolute-value\"") \
  _Pragma("GCC diagnostic ignored \"-Wunused-function\"") _Pragma("GCC diagnostic ignored \"-Wimplicit-fallthrough\"")
#define END_EMULATOR_CODE _Pragma("GCC diagnostic pop")
#endif

/** Puts the GPU as the console starts it: nothing shown, and video memory as it was. */
void gpu_power(void);

// What the GPU draws with (draw.c): psx_gpu, as PCSX ReARMed draws with it.
/** How many words each GP0 command has after its first, as the emulator's gpulib counts them. */
extern const unsigned char cmd_lengths[256];
/** Video memory cleared and psx_gpu started, as the emulator starts it. */
void draw_power(void);
/** The drawing settings, E1 to E6, as a reset of the GPU leaves them. */
void draw_reset(void);
/** One whole drawing command, its words as the game wrote them to GP0. */
void draw_commands(uint32_t *words, int count);
/** E6's two bits: 1 to set the mask bit of each pixel written, 2 to leave a pixel that has it. */
uint32_t draw_mask_bits(void);
/** Draws what psx_gpu has gathered, before video memory is read or written another way. */
void draw_flush(void);
/** Tells psx_gpu that a rectangle of video memory changed another way, for the textures it keeps. */
void draw_vram_changed(int x, int y, int w, int h);

#endif
