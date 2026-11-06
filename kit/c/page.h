// What the kits in C use to meet the page (kit/c/game.js as WebAssembly, a kit's native.c on a computer), which a
// game doesn't need: a function the page calls by name, and the save memory the page keeps.

#ifndef DREAMPORTS_PAGE_H
#define DREAMPORTS_PAGE_H

#include <stdint.h>

#ifdef __wasm__
#define EXPORT(name) __attribute__((export_name(name)))
#define IMPORT(name) __attribute__((import_module("dreamports"), import_name(name)))
#else
#define EXPORT(name)
#define IMPORT(name)
#endif

// what the page gives: the save memory's bytes it kept, and a place to keep them
IMPORT("save_read") void host_save_read(uint8_t *bytes, uint32_t size);
IMPORT("save_write") void host_save_write(const uint8_t *bytes, uint32_t size);

// the picture's size as the game last gave it to kit_screen (kit.c)
int dp_width(void);
int dp_height(void);

#endif
