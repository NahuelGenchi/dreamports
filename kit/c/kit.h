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
 * The cartridge's save memory, `size` bytes, with what the browser kept of it, or zeros the first time. It is the
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
 * The picture the page shows this frame, `width` × `height` words, red in the lowest byte and 0xFF above blue, as an
 * ImageData holds them, at the size the game shows now, which can change from one frame to the next. The same words
 * as the last frame's while the size stays the same.
 */
uint32_t *kit_screen(int width, int height);

#endif
