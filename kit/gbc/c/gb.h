// The Game Boy kit in C, for the Game Boy and the Game Boy Color: what a game written in C sees of the console
// (kit/gbc/c/README.md). It is the console's hardware around its processor, written from how the console is documented
// to behave: its memory with the cartridge's banks, the screen, the sound's four channels, the buttons, the timer and
// the interrupts, on what every console's kit in C shares (kit/c/kit.h). console.h, which the build makes from
// kit/consoles.js, gives the screen, the frame, the sound's rate and the buttons.
//
// A game defines two functions, which the kit calls:
//   void game_start(void)              once, at power-on, with the player's copy in kit_copy and the cartridge in gb_rom
//   void game_step(uint32_t buttons)   every frame, with the buttons held (BUTTON_A and the rest, a bit each)
// Each does what the original's processor does in that time: it reads and writes the console's memory through gb_read
// and gb_write, as the original's loads and stores do, says how long its own code takes with gb_spend, and waits for an
// interrupt with gb_halt, as the original's HALT does. The kit draws the frame and plays its sound as the console
// would, from what was written and when.

#ifndef DREAMPORTS_GB_H
#define DREAMPORTS_GB_H

#include <stddef.h>
#include <stdint.h>
#include "console.h"

// The console's memory, which gb_read and gb_write reach by its addresses, and a game can reach itself. The work
// memory is eight banks of 4 KB on a Game Boy Color and two on a Game Boy: the first at $C000 and one of the others
// at $D000. A recording's start point writes there (tools/README.md, Start points), from $C000 on.
extern uint8_t gb_wram[0x8000];
extern uint8_t gb_hram[0x7F];
// the picture memory, two banks of 8 KB on a Game Boy Color, and the 40 sprites
extern uint8_t gb_vram[0x4000];
extern uint8_t gb_oam[0xA0];

// The cartridge, from the player's copy: its program, `gb_rom_size` bytes, whose header says what kind it is, and its
// own memory, `gb_sram_size` bytes, which the browser keeps when the cartridge has a battery. A write to $0000-$7FFF
// switches its banks, as the cartridge's chip does: none, MBC1, MBC3 without its clock, or MBC5.
extern const uint8_t *gb_rom;
extern uint32_t gb_rom_size;
extern uint8_t *gb_sram;
extern uint32_t gb_sram_size;
/** Keeps gb_sram, as the original writes its battery-backed memory. */
void gb_sram_write(void);

/** 1 when the copy is a Game Boy Color game, which runs with the Game Boy Color's hardware, and 0 for a Game Boy's. */
extern int gb_colour;

/**
 * Writes `value` to `address`, as the processor's store does: the cartridge's chip at $0000-$7FFF, the picture memory,
 * the cartridge's memory, the work memory, the sprites, the hardware's registers at $FF00-$FF7F and $FFFF, and the
 * high memory. The write happens at the time the console has reached (gb_spend).
 */
void gb_write(uint16_t address, uint8_t value);
/** Reads `address`, as the processor's load does. */
uint8_t gb_read(uint16_t address);

// Time. The kit counts the processor's cycles, 4,194,304 a second, four to each of its machine cycles, from power-on.
// A game says how long its original's code takes between two writes, so each write happens when the original's does.
/** Moves the console on by `cycles`. */
void gb_spend(int cycles);
/** The cycles since power-on, counted as the console's reference emulator counts them. */
uint64_t gb_now(void);

// The interrupts' bits, in $FF0F and $FFFF, lowest first as the processor takes them.
enum { GB_VBLANK = 1, GB_STAT = 2, GB_TIMER = 4, GB_SERIAL = 8, GB_JOYPAD = 16 };
/**
 * The processor's HALT with interrupts on: four cycles for the instruction, then the console runs on until an interrupt
 * $FFFF has on is requested, and the processor takes it: the request is taken back, and 20 cycles later the
 * interrupt's code starts. Returns its bit. Returns 0 when the frame ends first, or has ended: game_step returns, and
 * the next frame's calls it again, which waits on from there.
 */
int gb_halt(void);
/**
 * What the processor does between two instructions with interrupts on: if one that $FFFF has on is requested, it takes
 * it, in 20 cycles, and this returns its bit. Otherwise 0, and no time passes. For the instruction after an
 * interrupt's code returns, or after EI. Returns -1 once the frame has ended, taking nothing: game_step returns, as
 * the next frame's buttons aren't known yet, and the next frame's asks again first.
 */
int gb_interrupt(void);
/** Whether this frame's picture is complete: the time has reached the start of its V-blank. */
int gb_frame_ended(void);
/** The frame the console's time is in, counted as the proof tools count them: -1 for the emulator's own first frame,
 *  which nothing is compared with and game_start runs through, and 0 in the first game_step. */
int gb_frame(void);
/** The buttons game_step was given. */
uint32_t gb_buttons(void);
/**
 * For a start point (kit_start_point): plays `frames` frames of the game with no button held and nothing shown or
 * heard, as a recording that starts later has the original do. Called from game_start, once what it does at power-on
 * is done; the game then sets what the start point names.
 */
void gb_play_ahead(int frames);

// what a game defines
void game_start(void);
void game_step(uint32_t buttons);

#endif
