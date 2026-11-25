// The console's memory: the scratchpad, the video memory and the main memory, each where the processor sees it. As
// WebAssembly they are at the console's own addresses in the game's memory, which the build leaves free below the
// game's own values (tools/lib/c.mjs), so a twin's C reads and writes an address as its original does, and
// psp_memory only takes an address's mirror off. On a computer they are three stretches of the program's own.

#include "psp-kit.h"

// what's left of an address once its mirror is off: the uncached and the kernel's views are the same memory
#define PLACE 0x0FFFFFFF
// the video memory is seen four times over, 2 MB each, up to 0x04800000
#define VRAM_MIRRORS 0x00800000

#ifndef __wasm__
static uint8_t *scratchpad, *vram, *ram;
#endif

void memory_power(void) {
#ifndef __wasm__
  if (!ram) {
    scratchpad = kit_alloc(PSP_SCRATCHPAD_SIZE);
    vram = kit_alloc(PSP_VRAM_SIZE);
    ram = kit_alloc(PSP_RAM_SIZE);
  }
  __builtin_memset(scratchpad, 0, PSP_SCRATCHPAD_SIZE);
  __builtin_memset(vram, 0, PSP_VRAM_SIZE);
  __builtin_memset(ram, 0, PSP_RAM_SIZE);
#endif
  // as WebAssembly the memory starts as zeros, and the game starts once
}

void *psp_memory(uint32_t address) {
  uint32_t place = address & PLACE;
  if (place >= PSP_RAM && place < PSP_RAM + PSP_RAM_SIZE) {
#ifdef __wasm__
    return (void *)(uintptr_t)place;
#else
    return ram + (place - PSP_RAM);
#endif
  }
  if (place >= PSP_VRAM && place < PSP_VRAM + VRAM_MIRRORS) {
    place = PSP_VRAM + ((place - PSP_VRAM) & (PSP_VRAM_SIZE - 1));
#ifdef __wasm__
    return (void *)(uintptr_t)place;
#else
    return vram + (place - PSP_VRAM);
#endif
  }
  if (place >= PSP_SCRATCHPAD && place < PSP_SCRATCHPAD + PSP_SCRATCHPAD_SIZE) {
#ifdef __wasm__
    return (void *)(uintptr_t)place;
#else
    return scratchpad + (place - PSP_SCRATCHPAD);
#endif
  }
  return 0;
}

uint8_t psp_read8(uint32_t address) {
  const uint8_t *at = psp_memory(address);
  return at ? *at : 0;
}
uint16_t psp_read16(uint32_t address) {
  uint16_t value = 0;
  const void *at = psp_memory(address);
  if (at) __builtin_memcpy(&value, at, 2);
  return value;
}
uint32_t psp_read32(uint32_t address) {
  uint32_t value = 0;
  const void *at = psp_memory(address);
  if (at) __builtin_memcpy(&value, at, 4);
  return value;
}
void psp_write8(uint32_t address, uint8_t value) {
  uint8_t *at = psp_memory(address);
  if (at) *at = value;
}
void psp_write16(uint32_t address, uint16_t value) {
  void *at = psp_memory(address);
  if (at) __builtin_memcpy(at, &value, 2);
}
void psp_write32(uint32_t address, uint32_t value) {
  void *at = psp_memory(address);
  if (at) __builtin_memcpy(at, &value, 4);
}
