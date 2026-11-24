// The GameCube's kit in C, on what every console's kit in C shares (kit/c/README.md). A game reads and writes the console
// as its original does, at the same addresses: its memory and the registers of the chips around its processor. The kit
// does what the console's chips do with them, as Dolphin, the console's reference in the proof tools, does
// (kit/gamecube/c/README.md): the video interface shows a field of the framebuffer the game points it at, the audio
// interface plays the samples the game hands it, and the serial interface answers for the first controller.

#ifndef DREAMPORTS_GAMECUBE_H
#define DREAMPORTS_GAMECUBE_H

#include "console.h"

// how much memory the console has, its 24 MB of MEM1
#define GC_RAM_SIZE 0x01800000

/** The console's memory, as the console keeps it: each number highest byte first. Address 0 here is 0x80000000 to the
 *  processor through its cache and 0xC0000000 round it. */
extern uint8_t gc_ram[GC_RAM_SIZE];

// the registers a game writes, at the addresses its processor sees them, round the cache
enum {
  // the video interface, each register 16 bits
  VI_VTR = 0xCC002000, VI_DCR = 0xCC002002, VI_HTR0 = 0xCC002004, VI_HTR1 = 0xCC002008, VI_VTO = 0xCC00200C, VI_VTE = 0xCC002010,
  VI_BBEI = 0xCC002014, VI_BBOI = 0xCC002018, VI_TFBL = 0xCC00201C, VI_TFBR = 0xCC002020, VI_BFBL = 0xCC002024, VI_BFBR = 0xCC002028,
  VI_DPV = 0xCC00202C, VI_DPH = 0xCC00202E, VI_DI0 = 0xCC002030, VI_HSW = 0xCC002048, VI_HSR = 0xCC00204A, VI_VICLK = 0xCC00206C,
  // the sound processor's audio DMA, which hands the audio interface its samples, each register 16 bits
  DSP_AUDIO_DMA_START_HI = 0xCC005030, DSP_AUDIO_DMA_START_LO = 0xCC005032, DSP_AUDIO_DMA_CONTROL_LEN = 0xCC005036,
  DSP_AUDIO_DMA_BLOCKS_LEFT = 0xCC00503A,
  // the serial interface, which talks to the controllers, each register 32 bits: a channel's out buffer and its two
  // in words, 12 bytes a channel, and how often it polls
  SI_C0_OUT = 0xCC006400, SI_C0_IN_HI = 0xCC006404, SI_C0_IN_LO = 0xCC006408, SI_POLL = 0xCC006430, SI_COM_CSR = 0xCC006434,
  SI_SR = 0xCC006438,
  // the audio interface, each register 32 bits
  AI_CONTROL = 0xCC006C00, AI_VOLUME = 0xCC006C04, AI_SAMPLE_COUNT = 0xCC006C08, AI_INTERRUPT_TIMING = 0xCC006C0C,
};

/** A word, a half-word or a byte read at `address`, as the processor reads it there: from memory, through the cache or
 *  round it, or from a register. */
uint32_t gc_read32(uint32_t address);
uint16_t gc_read16(uint32_t address);
uint8_t gc_read8(uint32_t address);
/** A word, a half-word or a byte written at `address`, as the processor writes it there, with what the chip whose
 *  register it is does. */
void gc_write32(uint32_t address, uint32_t value);
void gc_write16(uint32_t address, uint16_t value);
void gc_write8(uint32_t address, uint8_t value);

/** Paints the page's picture with the field the video interface shows, as the console's reference does. For game_draw. */
void gc_show(void);
/** Plays the samples the audio interface takes from memory, at its own rate, as the console's reference hands them on.
 *  For game_sound. */
void gc_sound(float *left, float *right, int count);

// What a game defines, as on every console (kit/c/README.md).
void game_start(void);
void game_step(uint32_t buttons);
void game_draw(void);
void game_sound(float *left, float *right, int count);

#endif
