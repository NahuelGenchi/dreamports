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
