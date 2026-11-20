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

/** The stack from `sp`, as the console's start leaves it for the game, with no register's value known. */
void gba_stack_start(uint32_t sp);

/** From here on in the function running, register `reg` holds `value`, or nothing the game's C can give. */
void gba_stack_reg(int reg, uint32_t value);
void gba_stack_unknown(int reg);

/** For a game that keeps some of the console's memory away from the console's address, as the kit keeps a save's
 *  flash: `console` gives the console's address for a pointer of the game's into such memory, and any other value as
 *  it is. gba_stack_address(pointer) is that, and the pointer itself with no function given: what goes on the stack
 *  for a value that is a pointer in the game's C. */
void gba_stack_addresses(uint32_t (*console)(uint32_t pointer));
uint32_t gba_stack_address(uint32_t pointer);

/** The next function entered is called from the instruction before `return_address`, odd in Thumb code. */
void gba_stack_call(uint32_t return_address);

/** A function's start: its pushes written below the stack pointer, which goes down past them and its locals. Gives
 *  what gba_stack_leave takes back, for a variable with __attribute__((cleanup)). */
uint32_t gba_stack_enter(const gba_frame *frame);

/** The function's return: the stack pointer and the saved registers as they were before it, its pushes left behind. */
void gba_stack_leave(uint32_t *entered);

/** Where the running function's frame starts, the stack pointer after its start. */
uint32_t gba_stack_sp(void);

/** The console's address of a local the function keeps at `at` from its frame's start. */
void *gba_stack_local(int32_t at);

/** A store of `bytes` of `value` at `at` from the frame's start, as the function's own code stores a register there. */
void gba_stack_store(int32_t at, uint32_t value, int bytes);

/** How many bytes the stack left out, as nothing gave their value. */
uint32_t gba_stack_gaps(void);

#endif
