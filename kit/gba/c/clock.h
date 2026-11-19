// The Game Boy Advance's time, as the reference emulator keeps it (mGBA 0.10.5, which `prove` plays the original in),
// for a game that has to end its frames where the console does: in the middle of its work, as a game's power-on is
// when the console's first frames end before the game first waits for one (kit/gba/c/README.md, The console's time).
//
// It is one helper that owns every cycle: each instruction's time, by its kind, from the wait states of the memory it
// runs from and reaches, with the cartridge's prefetch; the DMA channels', the timers' and the sound's FIFO time
// between instructions; the BIOS's own code for the calls a game makes to it; and where each frame ends. A game says
// which of the original's instructions it has just done the work of, and the clock says when a frame is over.

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

/** When frame `frame` ends: the first instruction that starts at this time or later is the frame's last. */
uint64_t gba_clock_frame_end(uint32_t frame);

/** One Thumb instruction of the original, at `pc`, with its opcode `op`, which went on to `next` (odd to stay in Thumb
 *  code, as a bx's target says). `value` is what a mul multiplies by, its first register, and 0 otherwise. Its
 *  accesses to memory are `access`, `count` of them. The events due before it run first. */
void gba_clock_thumb(uint32_t pc, uint16_t op, uint32_t next, uint32_t value, const gba_access *access, int count);

/** One ARM instruction, the same, with the flags it ran with (`cpsr`, for its condition). */
void gba_clock_arm(uint32_t pc, uint32_t op, uint32_t next, uint32_t cpsr, uint32_t value, const gba_access *access, int count);

/** A swi, from the Thumb instruction at `pc`: the BIOS's code for it, as the emulator's own BIOS runs it, with its
 *  arguments, and back to the instruction after. CpuSet calls `unit` for each halfword or word it fills or copies, as
 *  its store runs, for the game to do that work then. Gives 0, or -1 for a call the clock doesn't know. */
int gba_clock_swi(uint32_t pc, uint8_t number, uint32_t r0, uint32_t r1, uint32_t r2, void (*unit)(uint32_t index));

/** A register the instruction timed last writes, as it runs: the DMA channels', the timers', the sound's and WAITCNT. */
void gba_clock_write16(uint32_t address, uint16_t value);

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
 *  sound's and WAITCNT, whose time the store's decides. */
void gba_clock_written(uint32_t address, uint16_t value);

/** The Thumb instructions from `from` to `to`, one after another, the last going on to `next` (odd to stay in Thumb
 *  code), whose work the game has done. Each load or store among them that doesn't read the program counter or the
 *  stack takes the next address of `at` (`count` of them), and a mul takes the next as its first register's value. */
void gba_clock_run(uint32_t from, uint32_t to, uint32_t next, const uint32_t *at, int count);

/** How many stores to the work memory came after a frame's end inside the run it ended in: what the Dreamport's frame
 *  has and the console's doesn't. */
int gba_clock_late(void);

/** The same for ARM code, read a word at a time, all of it run always, as a cartridge's start is. */
void gba_clock_run_arm(uint32_t from, uint32_t to, uint32_t next, const uint32_t *at, int count);

#endif
