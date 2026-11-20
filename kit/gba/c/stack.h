// The console's stack, for a game that keeps the console's memory at the console's addresses and has to leave in it
// what the original leaves: the return addresses and saved registers its functions push, and the locals they keep
// there, which a later function can read without setting, as a struct whose fields it never fills (kit/gba/c/README.md,
// The console's stack).
//
// A game's twins say what they push and where they keep their locals, as the console's compiler lays out the same C,
// and the values come from that C: a function's entry writes its pushes where the console's stack pointer is, its
// return leaves them there, and a call says where it comes back to and what its saved registers hold. A value the
// game's C can't give is left out: the byte stays as it was, and gba_stack_gaps() counts it.

#ifndef DREAMPORTS_GBA_STACK_H
#define DREAMPORTS_GBA_STACK_H

#include <stdint.h>

/** A register a function's start pushes (0 to 12, 14 for lr), and where, from the stack pointer as it was called. */
typedef struct { int8_t reg; int16_t slot; } gba_push;

/** What a function's start does to the stack: its pushes, and how many bytes more it takes for its locals. `unproven`
 *  is for a function whose code isn't proven to be the original's. GBA_STACK_UNPROVEN: its frame takes its room, so
 *  the frames below it are where the console has them, but nothing is written for its pushes, and no register's value
 *  is known in it. GBA_STACK_START_PROVEN: its start is the original's, though the rest isn't proven, so its pushes
 *  are written, and a register it doesn't push is in it what its caller left, as the console's compiler changes no
 *  register it doesn't save; the ones it pushes hold nothing known in it. */
typedef struct { uint8_t count; const gba_push *pushes; uint16_t frame; uint8_t unproven; } gba_frame;
enum { GBA_STACK_PROVEN = 0, GBA_STACK_UNPROVEN = 1, GBA_STACK_START_PROVEN = 2 };

/** The stack from `sp`, as the console's start leaves it for the game: the registers r0 to r12 at 0, as the
 *  emulator's BIOS leaves them for the cartridge's first instruction, which the game's own start may then change. */
void gba_stack_start(uint32_t sp);

/** For the function check: a call of the original's starts on the stack at `sp`, with nothing of its registers known
 *  to the twin's C, and gba_stack_lowest() then gives the lowest the stack pointer went since, as the check puts that
 *  much of the stack back after a call, as it does after the original's (tools/README.md, The console's stack). */
void gba_stack_begin(uint32_t sp);
uint32_t gba_stack_lowest(void);

/** The stack from `sp` after a soft reset through the BIOS, which leaves each register as it was. */
void gba_stack_reset(uint32_t sp);

/** From here on in the function running, register `reg` holds `value`, or nothing the game's C can give. */
void gba_stack_reg(int reg, uint32_t value);
void gba_stack_unknown(int reg);

/** For a game that keeps some of the console's memory away from the console's address, as the kit keeps a save's
 *  flash: `console` gives the console's address for a pointer of the game's into such memory, and any other value as
 *  it is. gba_stack_address(pointer) is that, and the pointer itself with no function given: what goes on the stack
 *  for a value that is a pointer in the game's C. */
void gba_stack_addresses(uint32_t (*console)(uint32_t pointer));
uint32_t gba_stack_address(uint32_t pointer);

/** The next function entered is called from the instruction before `return_address`, odd in Thumb code, with
 *  nothing known of r0 to r3 and r12, which hold its arguments and what the call goes through. */
void gba_stack_call(uint32_t return_address);

/** A function's start: its pushes written below the stack pointer, which goes down past them and its locals. Gives
 *  what gba_stack_leave takes back, for a variable with __attribute__((cleanup)). */
uint32_t gba_stack_enter(const gba_frame *frame);

/** The function's return: the stack pointer and the saved registers as they were before it, its pushes left behind. */
void gba_stack_leave(uint32_t *entered);

/** An interrupt is taken: its handler runs on the stack the game's start set for interrupts, `stack`, below the six
 *  registers the BIOS saves there, and goes back to `back` in the BIOS. gba_stack_interrupted() gives the stopped code
 *  its stack and its registers back once the handler is done. */
void gba_stack_interrupt(uint32_t stack, uint32_t back);
void gba_stack_interrupted(void);

/** Where the running function's frame starts, the stack pointer after its start. */
uint32_t gba_stack_sp(void);

/** The console's address of a local the function keeps at `at` from its frame's start. */
void *gba_stack_local(int32_t at);

/** A store of `bytes` of `value` at `at` from the frame's start, as the function's own code stores a register there. */
void gba_stack_store(int32_t at, uint32_t value, int bytes);

/** How many bytes the stack left out, as nothing gave their value. */
uint32_t gba_stack_gaps(void);

// A routine the original has in hand-written assembly, whose twin is C (tools/README.md, The console's stack): its frame
// is its table's in the kit, and the stack tool pairs points of the twin's C, its anchors, with points of the
// routine's: its calls, its exits and the runs its twin times. Anchor 0 is the start. Between two anchors the routine
// stores what a step says, each value one the twin's C works out at the second anchor, where the Dreamport has it.

/** A value for the stack, or GBA_STACK_NONE where nothing the Dreamport holds gives it. */
#define GBA_STACK_NONE ((uint64_t)1 << 32)
/** A store of a step: `bytes` at `slot` from where the stack pointer was as the routine started, of the value
 *  `value` among those the anchor gives, or none known with 0xFF. */
typedef struct { int16_t slot; uint8_t bytes; uint8_t value; } gba_asm_write;
/** From anchor `from` to anchor `to`, the routine makes `count` stores, from `first` on. */
typedef struct { uint8_t from, to; uint16_t first, count; } gba_asm_step;
/** A routine's steps and stores, and for each anchor that's a call, where its stack pointer is then from where it
 *  started, or GBA_STACK_NO_SP. */
typedef struct { const gba_asm_step *steps; uint16_t count; const gba_asm_write *writes; const int16_t *sp; } gba_asm;
#define GBA_STACK_NO_SP INT16_MIN

/** A twin of a routine in assembly starts: nothing is stored yet, as the routine may store nothing before it leaves. */
uint32_t gba_stack_asm_enter(const gba_asm *routine);
/** The twin reaches anchor `anchor`: the routine's stores since the last anchor reached, with `values`. */
void gba_stack_asm_at(int anchor, const uint64_t *values);
/** The running routine's caller's register `reg` as it started (14 for where it goes back to), its stack pointer then
 *  with `offset` added, and `bytes` of the Dreamport's own memory at the console's address `at`, the work memory's. */
uint64_t gba_stack_asm_caller(int reg);
uint64_t gba_stack_asm_sp(int32_t offset);
uint64_t gba_stack_peek(uint32_t at, int bytes);
/** Register `reg` holds `value` from here, or nothing known for GBA_STACK_NONE. */
void gba_stack_set(int reg, uint64_t value);
/** The next function entered goes on with the running one's frame, as the original jumps to it. */
void gba_stack_jump(void);
/** The next function entered is called where the routine's table pairs no call of its own: what it pushes is left out. */
void gba_stack_asm_unpaired(void);

#endif
