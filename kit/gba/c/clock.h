// The Game Boy Advance's time, as the reference emulator keeps it (mGBA 0.10.5, which `prove` plays the original in),
// for a game that has to end its frames where the console does: in the middle of its work, as a game's power-on is
// when the console's first frames end before the game first waits for one (kit/gba/c/README.md, The console's time).
//
// It is one helper that owns every cycle: each instruction's time, by its kind, from the wait states of the memory it
// runs from and reaches, with the cartridge's prefetch; the DMA channels', the timers' and the sound's FIFO time
// between instructions; the interrupts the processor takes, and its waits for one; the BIOS's own code for the calls a
// game makes to it; and where each frame ends. A game says which of the original's instructions it has just done the
// work of, and the clock says when a frame is over.

#ifndef DREAMPORTS_GBA_CLOCK_H
#define DREAMPORTS_GBA_CLOCK_H

#include <stdint.h>

/** One access of an instruction to memory: its address, how many bytes (1, 2 or 4, or for a block move 0x100 and
 *  how many words), whether it writes, and what, for a write of WAITCNT, which changes the instruction's own waits. */
typedef struct { uint32_t address, bytes, writes, value; } gba_access;

/** The console at power-on: time 0, the wait states and the display as the emulator starts them, and the BIOS's own
 *  start, up to the cartridge's first instruction. */
void gba_clock_start(void);

/** The cycles since power-on. */
uint64_t gba_clock_now(void);

/** When the instruction timed last started. */
uint64_t gba_clock_started(void);

/** When frame `frame` ends, which is when the display reaches its V-blank: the first instruction that starts at this
 *  time or later is the frame's last. For a frame still to come it's when it will with no interrupt taken before. */
uint64_t gba_clock_frame_end(uint32_t frame);

/** One Thumb instruction of the original, at `pc`, with its opcode `op`, which went on to `next` (odd to stay in Thumb
 *  code, as a bx's target says). `value` is what a mul multiplies by, its first register, and 0 otherwise. Its
 *  accesses to memory are `access`, `count` of them. The events due before it run first. */
void gba_clock_thumb(uint32_t pc, uint16_t op, uint32_t next, uint32_t value, const gba_access *access, int count);

/** One ARM instruction, the same, with the flags it ran with (`cpsr`, for its condition). */
void gba_clock_arm(uint32_t pc, uint32_t op, uint32_t next, uint32_t cpsr, uint32_t value, const gba_access *access, int count);

/** A swi, from the Thumb instruction at `pc`: the BIOS's code for it, as the emulator's own BIOS runs it, with its
 *  arguments, and back to the instruction after. CpuSet (11) calls `unit` for each halfword or word it fills or
 *  copies, as its store runs, for the game to do that work then. Halt (2), IntrWait (4) and VBlankIntrWait (5) halt
 *  the processor until an interrupt wakes it, the frames that end meanwhile ended and the game's handler run from
 *  inside the call, and the two waits go on until the handler has acknowledged one they wait for (gba_clock_on_wait);
 *  they leave IME on. Before it, what the game wrote to the registers in work it didn't time, which no run will
 *  take, takes effect as the register's state: a DMA it started at once has copied already. Gives 0, or -1 for a call
 *  the clock doesn't know. */
int gba_clock_swi(uint32_t pc, uint8_t number, uint32_t r0, uint32_t r1, uint32_t r2, void (*unit)(uint32_t index));

/** A register the instruction timed last writes, as it runs: the DMA channels', the timers', the sound's and WAITCNT. */
void gba_clock_write16(uint32_t address, uint16_t value);

// ---------------------------------------------------------------------------------------------------------------
// The interrupts. The clock keeps IE, IF, IME and DISPSTAT as the game's stores of them say, and raises the display's
// three interrupts, the V-blank's as each frame ends, each line's H-blank's and the line count's, and each timer's, as
// it overflows with its interrupt on. With a bit of IF that IE has too, the processor is asked 7 cycles later, as in
// the emulator: halted, it wakes, and with IME on and a handler given it takes the interrupt before the next
// instruction told to the clock. The clock then times the BIOS's code to the handler, calls the game's, which does
// the handler's work and says its runs, and times the BIOS's way back to the instruction. In the emulator the jump to
// the interrupt's vector can move the display's lines, and so every frame's end after it, 2 cycles on, and the clock
// moves them the same. A game with no handler given takes none, and its frames end where they did.

/** The game's interrupt handler, the code at `address`, which the game keeps at 0x03007FFC: `handler` does its work
 *  and says its runs, the last going back to GBA_CLOCK_BIOS_BACK, or to GBA_CLOCK_BACK from Thumb code. A write of
 *  IF has to be told with gba_clock_written, as what it writes isn't what the register holds after. */
void gba_clock_on_interrupt(uint32_t address, void (*handler)(void));

/** Where a handler goes back to in the emulator's BIOS, in ARM code. */
#define GBA_CLOCK_BIOS_BACK 0x00000194u

/** IF as it stands: a bit for each interrupt raised and not yet acknowledged. */
uint16_t gba_clock_interrupts(void);

/** Raises interrupt `interrupt` (IF's bit, 0 to 13) as the time stands, for the ones the clock doesn't raise itself:
 *  the link cable's, the DMA channels', the buttons' and the cartridge's. */
void gba_clock_raise(int interrupt);

/** The events due before the instruction at `pc` (odd in Thumb code), and an interrupt if the processor takes one
 *  there, before the game does that instruction's work. A run does the same for each of its instructions, after the
 *  game did the run's work. */
void gba_clock_before(uint32_t pc);

/** The game's halfword at 0x03007FF8, where its handler says which interrupts it acknowledged and the BIOS's waits
 *  look for them: `read` gives it and `write` stores it, as gba_clock_swi's IntrWait and VBlankIntrWait do. */
void gba_clock_on_wait(uint16_t (*read)(void), void (*write)(uint16_t value));

/** The frame the clock is in, from 0 at power-on. */
uint32_t gba_clock_frame(void);

/** Whether the last instruction timed was its frame's last: the first to start at or after the frame's end. The
 *  next call to the clock starts the next frame. */
int gba_clock_frame_ended(void);

// ---------------------------------------------------------------------------------------------------------------
// A game's C does the work of a run of the original's instructions, then says which they were, and the clock reads them
// from the cartridge where the console has it (gba_console_memory(1)), or from memory for code the game copied there.
// When a frame ends inside a run, gba_clock_wait, which the game gives, ends the Dreamport's frame after it
// (kit_wait_frame, kit/c/pause.c): a run should end with the last store to the work memory that a frame's end can
// come before, which gba_clock_late() counts the misses of.

/** What ends the Dreamport's frame: kit_wait_frame for a game that waits from inside a function. */
void gba_clock_on_frame_end(void (*wait)(void));

/** A register the game wrote, which waits for the store of it in the next runs: the DMA channels', the timers', the
 *  sound's and WAITCNT, whose time the store's decides. With the time stopped it's written as the time stands. */
void gba_clock_written(uint32_t address, uint16_t value);

/** A run's `next` when its last instruction goes back from a call, to wherever the latest timed call came from. */
#define GBA_CLOCK_BACK 1u

/** The Thumb instructions from `from` to `to`, one after another, the last going on to `next` (odd to stay in Thumb
 *  code, GBA_CLOCK_BACK for back from the call it's in), whose work the game has done. Each load or store among them that doesn't read the program counter or the
 *  stack takes the next address of `at` (`count` of them), and a mul takes the next as its first register's value. */
void gba_clock_run(uint32_t from, uint32_t to, uint32_t next, const uint32_t *at, int count);

/** The game's own copy of the console's registers, each at its distance from 0x04000000, for a run's store to a register
 *  that no gba_clock_written waits for: the clock takes what the copy holds then. */
void gba_clock_registers(const volatile uint16_t *file);

/** The end of the console's time for the game: its runs, swis and calls cost nothing from here, as when it first waits
 *  for a frame, which a game's own frames time from then on. gba_clock_start starts it again. */
void gba_clock_stop(void);

/** Whether the console's time is going: between gba_clock_start or gba_clock_resume and gba_clock_stop. */
int gba_clock_running(void);

/** The console's time again from `time`, cycles from power-on, with the timers and the sound brought up to it: for a
 *  stretch a game times after power-on, as its work in the V-blank from a frame's end (gba_clock_frame_end). */
void gba_clock_resume(uint64_t time);

/** How many stores to the work memory came after a frame's end inside the run it ended in: what the Dreamport's frame
 *  has and the console's doesn't. */
int gba_clock_late(void);

/** The line the display is on as the next instruction starts, which a game that waits for one reads, in the console's
 *  time. */
uint16_t gba_clock_vcount(void);

/** libgcc's __divsi3 at `at`, which the console's compiler calls for a division, for `numerator` and `denominator`: its
 *  path, which the numbers decide, back to `back`. */
void gba_clock_divsi3(uint32_t at, int32_t numerator, int32_t denominator, uint32_t back);

/** The same for ARM code, read a word at a time, as a cartridge's start or its interrupt code: every instruction
 *  runs but a branch that doesn't go where its next does, and each load or store that doesn't read the program
 *  counter, a halfword's too, takes the next address of `at`. */
void gba_clock_run_arm(uint32_t from, uint32_t to, uint32_t next, const uint32_t *at, int count);

#endif
