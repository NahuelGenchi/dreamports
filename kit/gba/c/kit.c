// The rest of the C kit: the player's copy, the save memory, memory for the game, and the few functions the page
// calls, by name, to run the game (game.js as WebAssembly, native.c on a computer).

#include "gba.h"

const uint8_t *gba_rom;
uint32_t gba_rom_size;

#ifdef __wasm__
#define EXPORT(name) __attribute__((export_name(name)))
#define IMPORT(name) __attribute__((import_module("dreamports"), import_name(name)))

// what the page gives: the save memory's bytes it kept, and a place to keep them
IMPORT("save_read") void host_save_read(uint8_t *bytes, uint32_t size);
IMPORT("save_write") void host_save_write(const uint8_t *bytes, uint32_t size);

// memory past what the program takes, given out in turn and never taken back, as a game's memory lasts for the page
extern unsigned char __heap_base;
static uintptr_t heap_top;
void *gba_alloc(size_t size) {
  if (!heap_top) heap_top = (uintptr_t)&__heap_base;
  uintptr_t at = (heap_top + 15) & ~(uintptr_t)15, end = at + size;
  size_t have = __builtin_wasm_memory_size(0) * 65536;
  if (end > have && __builtin_wasm_memory_grow(0, (end - have + 65535) / 65536) == (size_t)-1) __builtin_trap();
  heap_top = end;
  return __builtin_memset((void *)at, 0, size);
}
#else
#include <stdlib.h>
#define EXPORT(name)
void host_save_read(uint8_t *bytes, uint32_t size);
void host_save_write(const uint8_t *bytes, uint32_t size);
void *gba_alloc(size_t size) {
  void *at = calloc(1, size ? size : 1);
  if (!at) abort();
  return at;
}
#endif

static uint8_t *save_bytes;
static uint32_t save_size;
uint8_t *gba_save(uint32_t size) {
  if (!save_bytes) {
    save_bytes = gba_alloc(size);
    save_size = size;
    host_save_read(save_bytes, size);
  }
  return save_bytes;
}
void gba_save_write(void) {
  if (save_bytes) host_save_write(save_bytes, save_size);
}

// what the page calls
static uint32_t *screen;

/** A place for the player's copy, `size` bytes, which the page fills before it calls dp_start. */
EXPORT("dp_rom") uint8_t *dp_rom(uint32_t size) {
  uint8_t *at = gba_alloc(size);
  gba_rom = at;
  gba_rom_size = size;
  return at;
}
/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  if (!screen) screen = gba_alloc(SCREEN_W * SCREEN_H * 4);
  game_start();
}
/** Runs one frame with the buttons in `keys` held. */
EXPORT("dp_step") void dp_step(uint32_t keys) { game_step((uint16_t)keys); }
/** Draws the frame, and gives where its 240 × 160 words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  gba_draw_frame(screen);
  return screen;
}
/** Where the video hardware is, for the page to show the proof tools what it holds (proof.js `video`). */
EXPORT("dp_vram") uint8_t *dp_vram(void) { return gba_vram; }
EXPORT("dp_pal") uint16_t *dp_pal(void) { return gba_pal; }
EXPORT("dp_oam") uint16_t *dp_oam(void) { return gba_oam; }
EXPORT("dp_io") uint16_t *dp_io(void) { return gba_io; }
