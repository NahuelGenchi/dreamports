// The function check on the Game Boy (../twin.mjs): what its three pieces share. original.cpp runs one function of
// the cartridge in Gambatte's own processor, kit.c stands in for the Game Boy kit under the game's C, and check.c gives
// both the same memory and registers and compares what each leaves.
#ifndef DREAMPORTS_GB_TWIN_CHECK_H
#define DREAMPORTS_GB_TWIN_CHECK_H
#include <stdint.h>
#include "contract.h"

#ifdef __cplusplus
extern "C" {
#endif

// The memory a function's own: the 8 KB of work memory at $C000 and the high memory at $FF80, one after the other.
enum { TWIN_WRAM = 0x2000, TWIN_HRAM = 0x7F, TWIN_MEMORY = TWIN_WRAM + TWIN_HRAM };
/** Where an address of the work memory, its echo or the high memory is in that memory, or -1 for any other. */
int twin_place(uint16_t address);
/** The address of a place in that memory. */
uint16_t twin_address(int place);

// What reaches the hardware, in order: a write and its value, a read and the value it was given, or something the
// kit does that no function can be checked across, such as a wait for an interrupt. The hardware is everything that
// isn't the program or that memory: the cartridge's chip and its own memory, the picture memory, the sprites and the
// registers.
enum { TWIN_HW_WRITE, TWIN_HW_READ, TWIN_HW_OTHER };
typedef struct { uint8_t kind, value; uint16_t address; } twin_event;
enum { TWIN_HW_MOST = 8192 };
typedef struct { twin_event list[TWIN_HW_MOST]; int count; } twin_events;
/** Notes an event, and gives the value a read gets: the same on both sides, by how many reads came before it. */
uint8_t twin_note(twin_events *into, uint8_t kind, uint16_t address, uint8_t value);
/** Starts the values the hardware's reads give from `seed`, before each side's run. */
void twin_reads_from(uint32_t seed);
/** The bank a write to the cartridge's chip switches in at $4000, or -1 for a write that switches none. */
int twin_switched(int chip, int banks, uint16_t address, uint8_t value, int now);
enum { TWIN_CHIP_NONE, TWIN_CHIP_MBC1, TWIN_CHIP_MBC3, TWIN_CHIP_MBC5 };

// ---- the original's side (original.cpp)
extern uint8_t orig_memory[TWIN_MEMORY];
extern twin_events orig_events;
extern int orig_bank;                    // the bank switched in at $4000
extern int orig_astray;                  // reads and writes where the console has nothing
extern int orig_bank_reads;              // reads of $4000-$7FFF before anything said which bank is there
extern uint8_t orig_read[TWIN_MEMORY];   // the bytes of the memory the function read
extern uint8_t orig_stored[TWIN_MEMORY]; // the bytes it stored to other than by pushing
extern uint16_t orig_lowest;             // the lowest the stack pointer went in the last call
extern int orig_ime;                     // whether it left interrupts on, as a return from an interrupt does
// the instructions the last call ran: where each is in the program, and how each went on, by its place
enum { TWIN_WENT_ELSEWHERE = 2, TWIN_WENT_ON = 4 };
extern uint32_t *orig_ran_at;
extern uint8_t *orig_ran_ways;
extern uint32_t orig_ran_count;
void orig_init(const uint8_t *rom, uint32_t size, int colour, int chip);
// where a call comes back to, which the CALL that called it leaves on the stack: an address the console has nothing at
#define TWIN_RETURN_TO 0xFEF0
/** Runs the function at `pc`, with `bank` at $4000, or -1 when nothing says which, from `r`, until it returns. The
 *  stack pointer it starts with is `r->SP`, with the address it comes back to there, which the call writes in its
 *  memory, as a CALL does. 0 when it returned with the stack where it was, 1 when it ran too long, 2 when the
 *  processor met a byte that is no instruction, 3 when it came back with the stack elsewhere, 4 when it stopped to
 *  wait, with HALT or STOP. `r` gets what it left, and `cycles` how long it took, from its first instruction to the
 *  end of its return. */
int orig_call(uint16_t pc, int bank, twin_regs *r, long *cycles);

// ---- the twin's side (kit.c), which the game's C runs on
extern twin_events kit_events;
extern long kit_cycles;
extern int kit_spent;                    // whether the twin counted any time
extern int kit_bank;                     // the bank its writes to the cartridge's chip left at $4000
void kit_stand_in(uint8_t *copy, uint32_t size, int chip);
void kit_begin(int bank);
/** The twin's memory, as the original's is laid out. */
void kit_memory_in(const uint8_t *from);
void kit_memory_out(uint8_t *into);

// ---- the twins' contracts, as the build writes them from the game's `dp:twin` lines (contract.h)
extern const twin_contract *const twin_contracts[];
extern const int twin_contract_count;
// the byte of the memory the game keeps the number of the bank at $4000 in, as an address, or -1 (`dp:bank`)
extern const int twin_bank_at;

#ifdef __cplusplus
}
#endif

#endif
