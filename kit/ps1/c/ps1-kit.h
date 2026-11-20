// What the PlayStation kit's own files share (gpu.c, draw.c, sound.c, pad.c, clock.c, cd.c, ps1.c), which a game
// doesn't need.

#ifndef DREAMPORTS_PS1_KIT_H
#define DREAMPORTS_PS1_KIT_H

#include "ps1.h"
#include "kit.h"

// Around the emulator's own code the kit carries as it is, psx_gpu, dfsound and its CD drive, which draw.c, sound.c
// and cd.c include:
// what a compiler would warn of in it says nothing of a Dreamport's own C, so it isn't said.
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
/** Puts the sound chip as the console's BIOS leaves it when it starts a game, with nothing heard yet. */
void spu_power(void);
// The clock (clock.c): the events the kit's chips set for a later cycle, one of each kind at a time, as PCSX ReARMed's
// libpcsxcore/psxevents.h has them, and in its order, which is the order two due at the same cycle run in.
enum { CLOCK_SIO, CLOCK_CD, CLOCK_CD_READ, CLOCK_CD_DMA, CLOCK_COUNTERS, CLOCK_LINE0, CLOCK_CD_LID, CLOCK_EVENTS };
/** Puts the clock at power: no time gone, the counters stopped at 0, and the interrupts the BIOS leaves. */
void clock_power(void);
/** The processor's cycles since power, as the kit counts them. */
uint32_t clock_now(void);
/** Sets event `which` to run `run` `after` cycles from now, in place of any it had. */
void clock_event(int which, uint32_t after, void (*run)(void));
/** The same, at cycle `at`, which runs it as soon as it can if that has gone. */
void clock_event_at(int which, uint32_t at, void (*run)(void));
void clock_cancel(int which);
/** Moves the processor's time on by `cycles`, as it waits: for a DMA transfer, or for the BIOS as it starts a game. */
void clock_spend(uint32_t cycles);
/** Sets interrupts in the controller's status, and runs the game's handler if it lets them in. */
void clock_interrupt(uint32_t bits);
/** Runs the frame's events to its V-blank, and sets the V-blank's interrupt there. */
void clock_frame_end(void);
uint32_t clock_read(uint32_t address);
void clock_write(uint32_t address, uint32_t value);
/** Puts the pads' serial port as it starts, with nothing held. */
void pad_power(void);
/** The buttons the player holds this frame, a bit each in kit/consoles.js's order (console.h). */
void pad_hold(uint32_t buttons);
/** Puts the CD drive as the emulator leaves it when it starts a game, with the player's disc in it, and gives the
 *  cycles its BIOS spends between handing over and the game's first instruction as it reads the disc (cd.c). */
uint32_t cd_power(void);

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
