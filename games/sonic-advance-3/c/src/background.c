// A background from the ROM's tilemap table, at 0x080D0624 (0x080003B8 loads the address). Its tiles go in the graphics
// queue, its colours into the backgrounds' palette, and its map into the queue the V-blank copies to the layer's map.

#include "core.h"

#define TILEMAPS 0xD0624u
// BACKGROUND_DISABLE_PALETTE_UPDATE leaves the colours as they are
#define DISABLE_PALETTE_UPDATE 0x10

/** 0x080BCFFC, DrawBackground: tilemap `id`, its tiles to `dest` and its map to `layoutVram`, both VRAM offsets. */
void draw_background(int id, uint32_t dest, uint32_t layoutVram, uint16_t targetTilesX, uint16_t targetTilesY, uint16_t flags) {
  uint32_t at = rom_ptr(TILEMAPS + id * 4);
  queue_graphics(rom_ptr(at + 8), dest, rom_u32(at + 12) & 0xFFFF);
  uint32_t palette = rom_ptr(at + 16), first = rom_u16(at + 20), count = rom_u16(at + 22);
  if (!(flags & DISABLE_PALETTE_UPDATE)) {
    for (uint32_t i = 0; i < count; i++) c.bgPalette[(first + i) & 0xFF] = rom_u16(palette + i * 2);
    c.flags |= FLAGS_UPDATE_BG_PALETTES;
  }
  queue_background(rom_ptr(at + 24), (uint16_t)rom_u16(at), layoutVram, targetTilesX, targetTilesY, flags);
}
