// The function check on the NES (../twin.mjs): what its three pieces share. original.c runs one function of the
// cartridge in FCEUmm's own processor, kit.c stands in for the NES kit under the game's C, and check.c gives both the
// same memory and registers and compares what each leaves.
#ifndef DREAMPORTS_TWIN_CHECK_H
#define DREAMPORTS_TWIN_CHECK_H
#include <stdint.h>
#include "contract.h"

// What reaches the hardware, in order: a write and its value, a read and the value it was given, or something the
// kit does that no function can be checked across, such as a wait for a line of the picture.
enum { TWIN_HW_WRITE, TWIN_HW_READ, TWIN_HW_OTHER };
typedef struct { uint8_t kind, value; uint16_t address; } twin_event;
enum { TWIN_HW_MOST = 4096 };
typedef struct { twin_event list[TWIN_HW_MOST]; int count; } twin_events;
/** Notes an event, and gives the value a read gets: the same on both sides, by how many reads came before it. */
uint8_t twin_note(twin_events *into, uint8_t kind, uint16_t address, uint8_t value);
/** Starts the values the hardware's reads give from `seed`, before each side's run. */
void twin_reads_from(uint32_t seed);

// ---- the original's side (original.c)
extern uint8_t orig_ram[0x800];
extern twin_events orig_events;
extern int orig_bank;                // the bank switched in at $8000
extern int orig_astray;              // reads where nothing answers on the cartridge
extern int orig_bank_reads;          // reads of $8000-$BFFF on a cartridge that switches what's there
extern uint8_t orig_stored[0x100];   // the bytes of the stack's page stored to other than by pushing
extern uint8_t orig_read[0x800];     // the bytes of the work memory the function read, or worked on
// the instructions the last call ran: where each is in the program, and how each went on, by its place
enum { TWIN_WENT_ELSEWHERE = 2, TWIN_WENT_ON = 4 };
extern uint32_t *orig_ran_at;
extern uint8_t *orig_ran_ways;
extern uint32_t orig_ran_count;
void orig_init(const uint8_t *prg, uint32_t size, int mapper);
// where a call comes back to, which the JSR that called it leaves on the stack, above S, high byte first, as the address before it
#define TWIN_RETURN_TO 0x4100
/** Runs the function at `pc`, with `bank` at $8000, from `r`, until it returns. The stack pointer it starts with is
 *  `r->S`, with the address it comes back to above it, which the call writes in its memory, as a JSR does. 0 when it
 *  returned with the stack where it was, 1 when it ran too long, 2 when the processor jammed, 3 when it came back with
 *  the stack elsewhere. `r` gets what it left, and `cycles` how long it took, from its first instruction to the end of
 *  its RTS. */
int orig_call(uint16_t pc, int bank, twin_regs *r, long *cycles);

// ---- the twin's side (kit.c), which the game's C runs on
extern twin_events kit_events;
extern long kit_cycles;
extern int kit_spent;                // whether the twin counted any time
void kit_stand_in(uint8_t *copy, uint32_t size);
void kit_begin(void);

// ---- the twins' contracts, as the build writes them from the game's `dp:twin` lines (contract.h)
extern const twin_contract *const twin_contracts[];
extern const int twin_contract_count;
// the byte of work memory the game keeps the number of the bank at $8000 in, or -1 (`dp:bank`)
extern const int twin_bank_at;
// each opcode's way of reading its operand, from the tools' own table (../6502.mjs)
enum { TWIN_M_OTHER, TWIN_M_ZP, TWIN_M_ZPX, TWIN_M_ZPY, TWIN_M_IZX, TWIN_M_IZY };
extern const uint8_t twin_modes[256];

#endif
