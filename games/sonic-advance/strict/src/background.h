// A background of the screen as the engine draws one: its tiles, and the map that lays them out.
#ifndef BACKGROUND_H
#define BACKGROUND_H
#include "console.h"
#include "sprite.h"

// background.flags
#define BACKGROUND_DISABLE_TILESET_UPDATE 0x08
#define BACKGROUND_DISABLE_PALETTE_UPDATE 0x10
#define BACKGROUND_FLAG_IS_LEVEL_MAP 0x40

/** One of the game's tile maps, as gTilemapsRef holds them: its tiles, colours and map. */
struct MapHeader {
  /* 0x00 */ u16 xTiles;
  /* 0x02 */ u16 yTiles;
  /* 0x04 */ u16 animTileSize;
  /* 0x06 */ u8 animFrameCount;
  /* 0x07 */ u8 animDelay;
  /* 0x08 */ const u8 *tiles;
  /* 0x0C */ u32 tilesSize;
  /* 0x10 */ const u16 *palette;
  /* 0x14 */ u16 palOffset;
  /* 0x16 */ u16 palLength;
  /* 0x18 */ const u16 *map;
  /* 0x1C */ const u16 *metatileMap;
  /* 0x20 */ u16 mapWidth;
  /* 0x22 */ u16 mapHeight;
};

/** The backgrounds to copy to video memory in the next V-blank, and where the list is. */
extern struct Background *gBackgroundsCopyQueue[16];


/** A background: which of the game's tile maps it shows, where in video memory, and how much of it. */
struct Background {
  /* 0x00 */ struct GraphicsData graphics;
  /* 0x0C */ u16 *layoutVram;
  /* 0x10 */ const u16 *layout;
  /* 0x14 */ u16 xTiles;
  /* 0x16 */ u16 yTiles;
  /* 0x18 */ u16 unk18;
  /* 0x1A */ u16 unk1A;
  /* 0x1C */ u16 tilemapId;
  /* 0x1E */ u16 unk1E;
  /* 0x20 */ u16 unk20;
  /* 0x22 */ u16 unk22;
  /* 0x24 */ u16 unk24;
  /* 0x26 */ u16 targetTilesX;
  /* 0x28 */ u16 targetTilesY;
  /* 0x2A */ u8 paletteOffset;
  /* 0x2B */ u8 animFrameCounter;
  /* 0x2C */ u8 animDelayCounter;
  /* 0x2E */ u16 flags;
  /* 0x30 */ u16 scrollX;
  /* 0x32 */ u16 scrollY;
  /* 0x34 */ u16 prevScrollX;
  /* 0x36 */ u16 prevScrollY;
  /* 0x38 */ const u16 *metatileMap;
  /* 0x3C */ u16 mapWidth;
  /* 0x3E */ u16 mapHeight;
};

void DrawBackground(struct Background *background);
u32 sub_8004010(void);

/** The V-blank's step that copies the backgrounds on the list to video memory (background.c). */
bool32 sa2__sub_8002B20(void);
/** The V-blank's step that draws the sprites the game put on backgrounds into their tile maps (background.c). */
bool32 sa2__sub_80039E4(void);

#endif
