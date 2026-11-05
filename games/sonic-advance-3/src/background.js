// A background from the ROM's tilemap table, at 0x080D0624 (0x080003B8 loads the address). Its tiles go in the graphics
// queue, its colours into the backgrounds' palette, and its map into the queue the V-blank copies to the layer's map.

const TILEMAPS = 0xD0624;

/** 0x080BCFFC, DrawBackground: tilemap `id`, its tiles to `dest` and its map to `layoutVram`, both VRAM offsets. */
export function drawBackground(c, { id, dest, layoutVram, targetTilesX, targetTilesY, flags }) {
  const { rom } = c, at = rom.u32(TILEMAPS + id * 4) - 0x08000000;
  c.queueGraphics(rom.u32(at + 8) - 0x08000000, dest, rom.u32(at + 12) & 0xFFFF);
  const palette = rom.u32(at + 16) - 0x08000000, first = rom.u16(at + 20), count = rom.u16(at + 22);
  // BACKGROUND_DISABLE_PALETTE_UPDATE leaves the colours as they are
  if (!(flags & 0x10)) {
    for (let i = 0; i < count; i++) c.bgPalette[(first + i) & 0xFF] = rom.u16(palette + i * 2);
    c.flags |= 0x1;
  }
  c.queueBackground({ layout: rom.u32(at + 24) - 0x08000000, xTiles: rom.u16(at), layoutVram, targetTilesX, targetTilesY, flags });
}

/** Where tilemap `id`'s colours are in the ROM, for the code that loads them itself. */
export function tilemapColours(c, id) {
  return c.rom.u32(c.rom.u32(TILEMAPS + id * 4) - 0x08000000 + 16) - 0x08000000;
}
