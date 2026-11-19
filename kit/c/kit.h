// What every console's kit in C shares (kit/c/README.md): the player's copy, the save memory, the words of the page's
// address, memory for the game, and the picture the page shows. A console with a kit in C of its own, such as the Game
// Boy Advance's (kit/gba/c/gba.h), builds on this, and a game on a console with none includes it with console.h, which
// the build makes from kit/consoles.js: the console's screen, its frame, its sound's rate and its buttons as bits.

#ifndef DREAMPORTS_KIT_H
#define DREAMPORTS_KIT_H

#include <stddef.h>
#include <stdint.h>

// The player's copy of the game, as the page read it, which it checked against the versions the game supports.
extern const uint8_t *kit_copy;
extern uint32_t kit_copy_size;

/**
 * The cartridge's save memory, `size` bytes, with what the browser kept of it, or 0xFF in every byte the first time, as a cartridge never written holds. It is the
 * same memory every call. What its bytes mean is the game's, which calls kit_save_write when the original writes it.
 */
uint8_t *kit_save(uint32_t size);
/** Keeps the save memory's bytes, as the original writes them. */
void kit_save_write(void);

/**
 * The words the page's address gives the game, such as unlocked=1 in ?proof&unlocked=1, which is how the proof tools
 * open a game at a recording's start point (tools/README.md, Start points). The value of the word `name`, read as the
 * page's URLSearchParams reads it: the first one of that name, with + and %XX decoded, "" for a word with no value,
 * and NULL for one that isn't there. It can be read from game_start on.
 */
const char *kit_start_point(const char *name);
/**
 * The value of the word `name` as a whole number, as JavaScript's Number(value) | 0 reads it: decimal, or hexadecimal
 * after 0x, with what follows a decimal point dropped and anything else 0. `absent` when the word isn't there.
 */
int32_t kit_start_number(const char *name, int32_t absent);

/** Memory for the game, zeroed, which lasts as long as the page. */
void *kit_alloc(size_t size);
/**
 * Keeps the memory from address `from` up to `to` for the game alone, zeroed, for a game that keeps its console's
 * memory at the console's own addresses, as one whose every function is a twin does (docs/STANDARD.md): the memory
 * grows to reach it, and kit_alloc gives out only what is above it from then on. A stretch has to be above what the
 * program and kit_alloc have already taken, so a game keeps its stretches in order, lowest first, as it starts. Only
 * as WebAssembly, where addresses are the game's to choose.
 */
void kit_memory_keep(uintptr_t from, uintptr_t to);

/**
 * Ends the frame here, from anywhere in the game's code, and carries on from here when the game next runs: what a
 * console's game does when it waits for the screen from inside a function. The game runs under kit_run, and its build
 * then gets one more pass (tools/README.md, Waiting from inside a function). Only as WebAssembly.
 */
void kit_wait_frame(void);
/** Runs `game`, from its start the first time and from where it last waited after that, until it next waits. Call it
 *  once from game_start or game_step for each of the console's frames, always with the same function. It returns 1
 *  when the game ended its frame, and 0 when it paused partway through it (kit_pause): then game_step returns at once,
 *  doing nothing it does after a frame, and the page calls it again, with the same buttons, once it has what the game
 *  waits for, so the same frame goes on. */
int kit_run(void (*game)(void));
/**
 * Pauses the game where it is, partway through its frame, until the page has what it waits for, such as its disc's
 * sectors (disc.h): the page fetches it and calls dp_step again, and the game goes on from here. Unlike kit_wait_frame
 * it doesn't end the frame. Only as WebAssembly, under kit_run.
 */
void kit_pause(void);
/** Whether the game is paused partway through its frame. A console's kit does its own work before and after a frame,
 *  such as starting and ending its draw list, only when it isn't, as the frame goes on in the page's next call. */
int kit_frame_paused(void);

/**
 * The picture the page shows this frame, `width` × `height` words, red in the lowest byte and 0xFF above blue, as an
 * ImageData holds them, at the size the game shows now, which can change from one frame to the next. The same words
 * as the last frame's while the size stays the same.
 */
uint32_t *kit_screen(int width, int height);

#endif
