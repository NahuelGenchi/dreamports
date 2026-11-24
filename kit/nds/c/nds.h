// The Nintendo DS kit in C: what a game written in C sees of the console (kit/nds/c/README.md). It's the console's two
// processors' programs, running side by side by the console's clock, with its main memory, its two screens' display,
// its buttons, its touch screen and its sound, written from how melonDS, the reference emulator, has them, on what every
// console's kit in C shares (kit/c/kit.h). console.h, which the build makes from kit/consoles.js, gives the screens,
// the frame, the sound's rate and the buttons.
//
// A game defines its two programs, as its cartridge has one for each processor, and the kit runs each from power-on:
//   void game_arm9(void)   the ARM9's program, most of a game
//   void game_arm7(void)   the ARM7's, which reads the touch screen and plays the sound
// Each is written as its original runs: it never comes back, and waits for the screen with nds9_wait_vblank or
// nds7_wait_vblank where the original waits for the V-blank. Each reads and writes the hardware and the memory the two
// share through its own processor's functions below, as the original's loads and stores do, at the time its code has
// reached, which nds9_spend and nds7_spend move on: the kit runs the two by the console's clock, so a value one writes
// is there for the other's read only when the console's would be.

#ifndef DREAMPORTS_NDS_H
#define DREAMPORTS_NDS_H

#include <stdint.h>
#include "console.h"

void game_arm9(void);
void game_arm7(void);

// The console's clock, 33,513,982 ticks a second, which the ARM7 runs at and the ARM9 at twice: a line of the screens
// lasts NDS_LINE ticks, a frame 263 lines, and the V-blank starts with line 192.
#define NDS_LINE 2130
#define NDS_FRAME (263 * NDS_LINE)
#define NDS_VBLANK (192 * NDS_LINE)

// The main memory, 4 MB at 0x02000000, seen again every 4 MB up to 0x02FFFFFF. A game that keeps a value where its
// original does keeps it here, and reads and writes it through the functions below where the other processor reads or
// writes it too.
extern uint8_t nds_main[0x400000];

/** What the ARM9 reads at `address`, a byte, a halfword or a word, as its load does: the main memory, and of the
 *  hardware, the display's status, the buttons and the sound's and the display's registers it last wrote. */
uint32_t nds9_read8(uint32_t address);
uint32_t nds9_read16(uint32_t address);
uint32_t nds9_read32(uint32_t address);
/** What the ARM9 writes, as its store does: the main memory, the display's registers, the colours and the power. */
void nds9_write8(uint32_t address, uint32_t value);
void nds9_write16(uint32_t address, uint32_t value);
void nds9_write32(uint32_t address, uint32_t value);
/** The same for the ARM7: the main memory, the buttons with X, Y and the pen (0x04000136), the serial bus to the touch
 *  screen's chip, and the sound's sixteen channels. */
uint32_t nds7_read8(uint32_t address);
uint32_t nds7_read16(uint32_t address);
uint32_t nds7_read32(uint32_t address);
void nds7_write8(uint32_t address, uint32_t value);
void nds7_write16(uint32_t address, uint32_t value);
void nds7_write32(uint32_t address, uint32_t value);

/** Moves the ARM9's time on by `cycles` of its own, two to a tick of the console's clock, as its code between two reads
 *  or writes takes. */
void nds9_spend(uint32_t cycles);
/** Moves the ARM7's time on by `cycles` of its own, one to a tick. */
void nds7_spend(uint32_t cycles);
/** Waits for the next V-blank to start, as the original's loop on the display's status does, and goes on `after` ticks
 *  later, the time the original's loop takes to see it. */
void nds9_wait_vblank(uint32_t after);
void nds7_wait_vblank(uint32_t after);

/** How many frames have run before this one, counted from power-on as the proof tools count them. */
int nds_frame(void);
/** Where a processor's time is, in ticks from power-on. */
uint64_t nds9_now(void);
uint64_t nds7_now(void);

// The hardware's addresses a game names, as the console's documents name them
#define NDS_DISPCNT_A 0x04000000
#define NDS_DISPSTAT 0x04000004
#define NDS_KEYINPUT 0x04000130
#define NDS_EXTKEYIN 0x04000136
#define NDS_SPICNT 0x040001C0
#define NDS_SPIDATA 0x040001C2
#define NDS_POWCNT 0x04000304
#define NDS_DISPCNT_B 0x04001000
#define NDS_SOUND(channel) (0x04000400 + 16 * (channel))
#define NDS_SOUNDCNT 0x04000500
#define NDS_SOUNDBIAS 0x04000504
#define NDS_PALETTE_A 0x05000000
#define NDS_PALETTE_B 0x05000400

#endif
