// The Super Nintendo's kit in C, on what every console's kit in C shares (kit/c/README.md). A game's C keeps its values
// where the original does, at the console's own 24-bit addresses: its work memory at $7E0000, its save memory and its
// cartridge's ROM where the cartridge's map puts them. It reads and writes the console's hardware registers, $2100 to
// $21FF and $4000 to $43FF, through snes_read and snes_write, as its original's loads and stores do, and the kit draws
// each frame from what was written, as the console's picture unit does (kit/snes/c/README.md).

#ifndef DREAMPORTS_SNES_H
#define DREAMPORTS_SNES_H

#include <stdint.h>
#include "console.h"

// The console's 128 KB of work memory, at $7E0000 to $7FFFFF, which the original also sees at $0000 to $1FFF of the
// banks below $40 and from $80 to $BF.
#define SNES_RAM ((uint8_t *)0x7E0000)
#define SNES_RAM_SIZE 0x20000

// The hardware's registers as the kit keeps them, a byte each: those of the picture, the sound processor's ports and
// the work memory's port, $2100 to $21FF, and the processor's own, $4000 to $43FF, at their addresses in bank $00.
#define SNES_B_REGISTERS ((uint8_t *)0x2100)
#define SNES_CPU_REGISTERS ((uint8_t *)0x4000)

/**
 * Writes `value` to the register at `address`, $2100 to $21FF or $4000 to $43FF, as the original's store does. The
 * sound processor's four ports are seen again every four bytes up to $217F. A write to $2180 puts the byte in the work
 * memory where $2181 to $2183 point, and moves them on; one to $4203 multiplies it by $4202 into $4216 and $4217; one
 * to $4206 divides $4204 and $4205 by it, the quotient into $4214 and $4215 and what's left into $4216 and $4217, or
 * $FFFF and the number itself when it's 0. The results are there at once, as the reference emulator has them. A write
 * to the picture's registers changes what the next frame draws, and one to $420B moves memory by DMA at once.
 */
void snes_write(uint16_t address, uint8_t value);
/** Reads the register at `address`, as the original's load does: $2180 reads the work memory where $2181 to $2183
 *  point and moves them on, and reading $4210 or $4211 clears its top bit, as the console does. */
uint8_t snes_read(uint16_t address);

// The picture unit's own memories, which only its registers reach on the console: 64 KB of video memory, 256 colours
// of 15 bits, red lowest, and the table of 128 sprites with its 32 bytes more.
extern uint8_t snes_vram[0x10000];
extern uint16_t snes_cgram[256];
extern uint8_t snes_oam[544];

// The cartridge, from the player's copy: its ROM, without a copier's header, and whether it's seen 32 KB to a bank
// (LoROM) or 64 (HiROM), as its header says.
extern const uint8_t *snes_rom;
extern uint32_t snes_rom_size;
extern int snes_hirom;
/** A byte at a 24-bit address of the console's own memories, as DMA reads them: the work memory, the ROM and the save
 *  memory, wherever the cartridge's map shows them; anything else reads 0. */
uint8_t snes_bus(uint32_t address);

// What a game defines, as on every console (kit/c/README.md). game_step is what the original's processor does in one
// frame's V-blank and after it, up to the next: the kit then draws the frame's lines from the registers as it left them.
void game_start(void);
void game_step(uint32_t buttons);
void game_draw(void);
void game_sound(float *left, float *right, int count);

#endif
