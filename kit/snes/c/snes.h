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
 * to the picture's registers changes what the next frame draws, and one to $420B moves memory by DMA at once. A write
 * to a port, $2140 to $2143, is for the sound program, and reading one gives what that last wrote there.
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

// The sound processor's side. The console's sound processor, an SPC700, runs a program of its own, which the main one
// sends it through four ports as the game starts, and a game's C has that program's twins too, run by the kit beside
// game_step, as its original runs beside the main processor (kit/snes/c/README.md). Its 64 KB of memory, where its
// program keeps its values and the sound chip reads its samples and writes its echo:
extern uint8_t snes_aram[0x10000];
/**
 * Reads the sound processor's register at `address`, $00F0 to $00FF, as its original's load does: the sound chip's
 * through $F2 and $F3, what the main processor wrote to the ports at $F4 to $F7, and a timer's count at $FD to $FF,
 * which a read clears. Any other address reads the sound processor's memory.
 */
uint8_t snes_spc_read(uint16_t address);
/** Writes the sound processor's register at `address`, $00F0 to $00FF, and its memory there, as the console writes
 *  both: the timers and ports at $F1, the sound chip through $F2 and $F3, the ports the main processor reads at $F4 to
 *  $F7, and the timers' periods at $FA to $FC. Any other address writes only the memory. */
void snes_spc_write(uint16_t address, uint8_t value);
/** Ends the sound program's turn here, where its original waits for one of its timers or a port in a loop: it goes on
 *  from here when a timer next counts, or once the main program has written a port and reads one. Only as WebAssembly. */
void snes_spc_wait(void);

// What a game defines, as on every console (kit/c/README.md). game_step is what the original's processor does in one
// frame's V-blank and after it, up to the next: the kit then draws the frame's lines from the registers as it left them.
void game_start(void);
void game_step(uint32_t buttons);
void game_draw(void);
/** The game's own sound, added to what the console's sound chip plays, which is already there. */
void game_sound(float *left, float *right, int count);
/** What a game whose original sends the sound processor a program defines: that program's twin, from `address`, where
 *  the console's start-up program sends the sound processor once the main program has sent it there. The kit runs it
 *  beside game_step, and it waits with snes_spc_wait. A game that leaves it out has a sound processor that stops. */
void game_spc(uint16_t address);

#endif
