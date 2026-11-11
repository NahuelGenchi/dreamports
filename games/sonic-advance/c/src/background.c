// A background from the ROM's tilemap table, translated from gba/background.js (SAT-R's src/background.c:
// DrawBackground): its tiles go in the graphics queue, its colours into the background palette, and its map into the
// queue the V-blank copies to the layer's map (engine.c).

#include "sa.h"

#define DISABLE_TILESET_UPDATE 0x8
#define DISABLE_PALETTE_UPDATE 0x10

void background_init(Background *bg) { memset(bg, 0, sizeof *bg); }

/** DrawBackground, with the tilemap table at OFFSET_TILEMAPS (rom/tilemaps.js tilemapHeader). */
void draw_background(Background *bg) {
  uint32_t at = rom_ptr(OFFSET_TILEMAPS + bg->tilemapId * 4);
  bg->xTiles = (uint16_t)rom_u16(at); bg->yTiles = (uint16_t)rom_u16(at + 2);
  bg->graphics.src = rom_ptr(at + 8);
  bg->graphics.size = rom_u32(at + 12) & 0xFFFF;
  bg->graphics.ram = NULL;
  if (!(bg->flags & DISABLE_TILESET_UPDATE)) {
    queue_graphics(&bg->graphics);
    bg->flags ^= DISABLE_TILESET_UPDATE;
  }
  bg->paletteOffset = (uint8_t)rom_u16(at + 20);
  if (!(bg->flags & DISABLE_PALETTE_UPDATE)) {
    uint32_t palette = rom_ptr(at + 16), length = rom_u16(at + 22);
    for (uint32_t i = 0; i < length; i++) e.bgPalette[(bg->paletteOffset + i) & 0xFF] = (uint16_t)rom_u16(palette + i * 2);
    e.flags |= 0x1;
    bg->flags ^= DISABLE_PALETTE_UPDATE;
  }
  bg->layout = rom_ptr(at + 24);
  queue_background(bg);
}

/** UpdateBgAnimationTiles on a layer of its own: its tiles change every animDelay updates; frame 0 is the tileset,
 *  frame k the k-th block stored after it. `frame` and `delay` are its animFrameCounter and animDelayCounter. */
void animate_background(Background *bg, int *frame, int *delay) {
  uint32_t at = rom_ptr(OFFSET_TILEMAPS + bg->tilemapId * 4);
  int frames = rom_u8(at + 6), wait = rom_u8(at + 7);
  uint32_t tileSize = rom_u16(at + 4), tiles = rom_ptr(at + 8), tilesSize = rom_u32(at + 12);
  if (frames <= 0 || ++*delay < wait) return;
  *delay = 0;
  if (++*frame >= frames) *frame = 0;
  bg->graphics.src = *frame == 0 ? tiles : tiles + tilesSize + (uint32_t)(*frame - 1) * tileSize;
  bg->graphics.size = tileSize;
  queue_graphics(&bg->graphics);
}

/**
 * sub_8003EE4: a rotating layer's registers for an `angle` of 0 to 1023, the map drawn `scaleX` / 256 and `scaleY` /
 * 256 times its size, so that its point (x, y) shows at (cx, cy) on the screen.
 */
void transform_background(Affine *affine, int angle, int scaleX, int scaleY, int x, int y, int cx, int cy) {
  int cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  int kx = scaleX ? s16(0x10000 / scaleX) : 0, ky = scaleY ? s16(0x10000 / scaleY) : 0;   // the BIOS's Div
  affine->pa = s16((cos * kx) >> 8);
  affine->pb = s16((sin * kx) >> 8);
  affine->pc = s16(((-SINE[angle] >> 6) * ky) >> 8);
  affine->pd = s16((cos * ky) >> 8);
  cx = s16(-cx); cy = s16(-cy);
  affine->x = affine->pa * cx + affine->pb * cy + x * 256;
  affine->y = affine->pc * cx + affine->pd * cy + y * 256;
}
