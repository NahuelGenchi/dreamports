// The console's memory at the console's own addresses, for a game whose every function is a twin of one of the
// original's (docs/STANDARD.md): a value the original keeps at 0x03000F00 is at 0x03000F00 here, an address kept in
// memory means the same in both, and the proof tools compare the whole of it with the original's after every frame
// (tools/README.md, Memory at the console's addresses). A game that doesn't call gba_console_memory has none of this.

#include "gba.h"

#ifdef __wasm__
void gba_console_memory(int cartridge) {
  // lowest first, as kit_memory_keep takes them
  kit_memory_keep(GBA_EWRAM, GBA_EWRAM + GBA_EWRAM_BYTES);
  kit_memory_keep(GBA_IWRAM, GBA_IWRAM + GBA_IWRAM_BYTES);
  if (!cartridge) return;
  // the player's copy again, where the console has the cartridge, so the addresses its data is known by are real
  kit_memory_keep(GBA_CARTRIDGE, GBA_CARTRIDGE + kit_copy_size);
  __builtin_memcpy((void *)GBA_CARTRIDGE, kit_copy, kit_copy_size);
  kit_copy = (const uint8_t *)GBA_CARTRIDGE;
}
#else
void gba_console_memory(int cartridge) {
  (void)cartridge;
  kit_memory_keep(GBA_EWRAM, GBA_EWRAM + GBA_EWRAM_BYTES);
}
#endif

void gba_vram_write8(uint32_t at, uint8_t value) {
  if (at >= sizeof gba_vram) return;
  // the sprites' tiles start further on in the three bitmap modes
  uint32_t sprites = (gba_io[REG_DISPCNT >> 1] & 7) >= 3 ? 0x14000 : 0x10000;
  if (at >= sprites) return;
  gba_vram[at & ~1u] = value;
  gba_vram[at | 1] = value;
}
