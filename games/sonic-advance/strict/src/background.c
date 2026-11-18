// The engine's backgrounds.
#include "background.h"
#include "core.h"
#include "stage.h"

/** DrawBackground, 0x080019C0: a background takes its tile map's size, tiles, colours and map. Its tiles go on the
 *  list to copy to video memory and its colours to the backgrounds' palette, each once, and the background on the list
 *  of those to draw in the next V-blank. */
void DrawBackground(struct Background *background) {
  const struct MapHeader *mapHeader = gTilemapsRef[background->tilemapId];
  const u16 *pal;
  u32 palSize;
  u16 gfxSize;

  background->xTiles = mapHeader->xTiles;
  background->yTiles = mapHeader->yTiles;
  background->graphics.src = mapHeader->tiles;
  gfxSize = mapHeader->tilesSize;
  background->graphics.size = gfxSize;

  if (!(background->flags & BACKGROUND_DISABLE_TILESET_UPDATE)) {
    gVramGraphicsCopyQueue[gVramGraphicsCopyQueueIndex] = &background->graphics;
    gVramGraphicsCopyQueueIndex = (gVramGraphicsCopyQueueIndex + 1) & 31;
    background->flags ^= BACKGROUND_DISABLE_TILESET_UPDATE;
  }

  pal = mapHeader->palette;
  palSize = mapHeader->palLength;
  background->paletteOffset = mapHeader->palOffset;

  if (!(background->flags & BACKGROUND_DISABLE_PALETTE_UPDATE)) {
    DMA3_COPY16(pal, gBgPalette + background->paletteOffset, palSize * sizeof(*pal));
    gFlags |= FLAGS_UPDATE_BACKGROUND_PALETTES;
    background->flags ^= BACKGROUND_DISABLE_PALETTE_UPDATE;
  }

  background->layout = mapHeader->map;

  if (background->flags & BACKGROUND_FLAG_IS_LEVEL_MAP) {
    background->metatileMap = mapHeader->metatileMap;
    background->mapWidth = mapHeader->mapWidth;
    background->mapHeight = mapHeader->mapHeight;
  }

  gBackgroundsCopyQueue[gBackgroundsCopyQueueIndex] = background;
  gBackgroundsCopyQueueIndex = (gBackgroundsCopyQueueIndex + 1) & 15;
}

/** 0x08002F84, sub_8004010: one of the V-blank's steps. Each background with a stretch of its map marked to clear,
 *  from the first column and row in gBgSprites_Unknown2 to the last, has it filled with the tile gBgSprites_Unknown1
 *  names, a row at a time or, with no last column, to the last row at once, and its mark cleared. */
u32 sub_8004010(void) {
  u8 bg;

  for (bg = 0; bg < 4; bg++) {
    if (gBgSprites_Unknown2[bg][1] != gBgSprites_Unknown2[bg][3] || gBgSprites_Unknown2[bg][0] != gBgSprites_Unknown2[bg][2]) {
      u16 cnt = gBgCntRegs[bg];
      u8 *map = (u8 *)VRAM + ((cnt & 0x1F00) << 3);
      u8 y = gBgSprites_Unknown2[bg][1];
      u8 x = gBgSprites_Unknown2[bg][0];

      if (bg > 1 && (gDispCnt & 3)) {
        // a rotating background's map: a byte a tile, its width by its size
        u16 width;
        map += x;
        width = 16 << (cnt >> 14);
        if (gBgSprites_Unknown2[bg][3] == 0xFF) {
          u16 tile = gBgSprites_Unknown1[bg];
          tile |= tile << 8;
          DMA3_FILL16(tile, map + y * width, (gBgSprites_Unknown2[bg][3] - y) * width);
        } else {
          for (; y <= gBgSprites_Unknown2[bg][3]; y++) {
            u16 tile = gBgSprites_Unknown1[bg];
            tile |= tile << 8;
            DMA3_FILL16(tile, map + y * width, (gBgSprites_Unknown2[bg][2] - x + 1) >> 1);
          }
        }
      } else {
        // a text background's map: a halfword a tile, 32 or 64 tiles wide
        int width = 32;
        map += x * 2;
        if ((u8)((gBgCntRegs[bg] >> 14) - 2) <= 1) width = 64;
        if (gBgSprites_Unknown2[bg][2] == 0xFF) {
          DMA3_FILL16(gBgSprites_Unknown1[bg], map + y * width * 2, (gBgSprites_Unknown2[bg][3] - y) * width * 2);
        } else {
          for (; y <= gBgSprites_Unknown2[bg][3]; y++) {
            DMA3_FILL16(gBgSprites_Unknown1[bg], map + y * width * 2, (gBgSprites_Unknown2[bg][2] - x + 1) * 2);
          }
        }
      }
      DMA3_FILL32(0, gBgSprites_Unknown2[bg], 4);
    }
  }
  return 1;
}
