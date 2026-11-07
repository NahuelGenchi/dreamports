// The NES kit in C: what a game written in C sees of the console (kit/nes/c/README.md). It is the console's picture
// and sound hardware, the PPU and the APU, written from how the console is documented to behave, with the cartridge's
// memory and the controller, on what every console's kit in C shares (kit/c/kit.h): the copy, the save memory, the
// start point's words and memory. console.h, which the build makes from kit/consoles.js, gives the screen, the frame,
// the sound's rate and the buttons.
//
// A game defines two functions, which the kit calls:
//   void game_start(void)              once, with the player's copy in kit_copy and the cartridge in nes_prg and nes_chr
//   void game_step(uint32_t buttons)   every frame, with the buttons held (BUTTON_A and the rest, a bit each, in the
//                                      order the controller sends them: A, B, Select, Start, Up, Down, Left, Right)
// Each step is what the original's CPU does from one frame's V-blank to the next's: it writes the hardware through
// nes_write, as the original's stores to $2000-$2007 and $4000-$4017 do, and reads it through nes_read. The kit draws
// the frame and plays its sound as the console would, from what was written and when.

#ifndef DREAMPORTS_NES_H
#define DREAMPORTS_NES_H

#include <stddef.h>
#include <stdint.h>
#include "console.h"

// The console's 2 KB of work memory, $0000-$07FF, where a recording's start point writes (tools/README.md, Start
// points). A game that keeps its own variables where the original does keeps them here, so a start point finds them.
extern uint8_t nes_ram[0x800];

// The cartridge, from the player's copy's iNES header: its program, `nes_prg_size` bytes, and its tiles, `nes_chr_size`
// bytes, or 8 KB of tile memory of its own when the copy has none. `nes_mapper` is the header's mapper number, and the
// work memory at $6000-$7FFF, `nes_wram`, is kept in the browser when the header says the cartridge has a battery.
extern const uint8_t *nes_prg;
extern uint32_t nes_prg_size;
extern uint8_t *nes_chr;
extern uint32_t nes_chr_size;
extern int nes_mapper;
extern uint8_t nes_wram[0x2000];
/** Keeps nes_wram, as the original writes its battery-backed memory. */
void nes_wram_write(void);

/** Reads the program the way the CPU sees it at `address`, $8000-$FFFF, with a 16 KB program at both halves. */
uint8_t nes_prg_byte(uint16_t address);

// How the console's 2 KB of name tables fill the PPU's four, as the cartridge wires them.
enum { NES_MIRROR_HORIZONTAL, NES_MIRROR_VERTICAL, NES_MIRROR_ONE_LOW, NES_MIRROR_ONE_HIGH };
/** Wires the name tables, as a cartridge whose mapper chooses does. The header's choice is made before game_start. */
void nes_mirroring(int mirroring);
/** Shows the 1 KB of tiles at `bytes` as the pattern tables' `slot`th KB, 0 to 7, as a mapper that switches tiles does. */
void nes_chr_bank(int slot, uint8_t *bytes);

/**
 * Writes `value` to `address`, as the CPU's store does: the PPU's registers at $2000-$2007 (and their mirrors to
 * $3FFF), $4014 to copy a page of work memory to the sprites, the APU's at $4000-$4013, $4015 and $4017, and the
 * controller's at $4016. The write happens at the time the frame has reached (nes_spend).
 */
void nes_write(uint16_t address, uint8_t value);
/** Reads `address`, as the CPU's load does: $2002, $2004, $2007, $4015, and $4016-$4017 for the two controllers' next
 *  bits (first controller in bits 0-7 of `buttons`, second in bits 8-15). */
uint8_t nes_read(uint16_t address);

// Time within a frame. A step starts when the original's V-blank interrupt starts, and its writes happen then, unless
// it moves on first. Most games write the hardware only in V-blank and need nothing else. One that changes the picture
// partway down the screen says when.
/** Moves the frame on by `cycles` of the CPU's, as the original's code between two writes takes. */
void nes_spend(int cycles);
/** Moves the frame on to the start of the visible line `line`, 0 to 239, if it isn't past it already. */
void nes_wait_line(int line);
/** Moves the frame on to when $2002 first shows sprite 0's hit, as a game that waits for it does, and gives 1, or to
 *  the end of the picture and 0 when sprite 0 hits nothing this frame. */
int nes_wait_sprite0(void);
/** Where the frame is: the PPU's dot, 341 to a line, counted from the start of the frame's V-blank. */
int nes_now(void);
/** The dot $2002's top bit goes on at, in a frame whose V-blank starts: a game that times its own code by the CPU's
 *  cycles, as one that waits for V-blank by reading $2002 does, can't have read it on before then. */
#define NES_VBLANK_DOT 341
/** The dot the PPU asks for the V-blank interrupt at, when $2000's top bit is on. The CPU takes it once it finishes the
 *  instruction it's in, and 7 cycles later the interrupt's code starts: at NES_NMI_DOT + 21 at the soonest, where a
 *  step starts. */
#define NES_NMI_DOT 353
/** How many dots frame `frame` lasts, as nes_frame counts them: frames -1 and 0, the emulator's first two, before the
 *  PPU is warm, and then every other frame a dot shorter. A game that times its own code across frames needs it. */
int nes_frame_length(int frame);
/** How many frames have run before this one, counted from power-on as the proof tools count them: frame 0 is the
 *  console's second, and it shows a grey screen, as the PPU warms up and V-blank never starts until frame 1. */
uint32_t nes_frame(void);
/** For a start point (kit_start_point): the console as if `frame` frames had run since power-on, its PPU warm and its
 *  sound's time on. Called from game_start, whose writes then set the hardware up as the original had it there. */
void nes_start_at(uint32_t frame);

/** The buttons game_step was given, in the controller's order, as $4016 sends them a bit at a time. */
uint32_t nes_buttons(void);

// what a game defines
void game_start(void);
void game_step(uint32_t buttons);

#endif
