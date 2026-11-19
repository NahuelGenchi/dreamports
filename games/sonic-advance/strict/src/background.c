// The engine's backgrounds.
#include "background.h"
#include "animation.h"
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

// ---------------------------------------------------------------------------------------------------------------
// The sprites the game draws into a background's tile map, in the V-blank. Written from the original's instructions:
// SAT-R/sa1 keeps this function as assembly, with a sketch of its C.

/** The sprites the game put on backgrounds this frame, and how many. */
extern struct Sprite *gBgSprites[];
extern u8 gBgSpritesCount;
extern u16 gBgCntRegs[4];
/** Each sprite shape and size's width and height in pixels. */
extern const u8 gOamShapesSizes[12][2];

// Each value read through a pointer, as the processor reads it: a word or a halfword where one starts, and where one
// doesn't, the word around it turned round to the address, a halfword the same, and a signed halfword only the byte
// there. A frame's sizes, from `dims`, are read so (BgSpriteDims below: flip and oamIndex bytes, numSubframes, width
// and height halfwords, offsetX and offsetY signed halfwords, at 0, 1, 2, 4, 6, 8 and 0x0A).
#ifdef MATCHING
#define BG_SPRITE_STORE16(at, value) (*(vu16 *)(at) = (value))
#define BG_SPRITE_OAM(from, to) DMA3_SET(from, to, 0x80000003)
#define ARM_LDR(at) (*(const vu32 *)(at))
#define ARM_LDRH(at) ((u32)*(const vu16 *)(at))
#define ARM_LDRSH(at) ((s32)*(const volatile s16 *)(at))
#else
/** A halfword stored where the console has the address, the lowest bit dropped as its store drops it (hardware.c). */
void console_store16(u32 at, u16 value);
/** DMA channel 3 started as the console's is, copying into a value of the Dreamport's own, as onto the console's stack. */
void console_dma3_into(u32 src, void *dest, u32 control);
#define BG_SPRITE_STORE16(at, value) console_store16((u32)(at), (value))
#define BG_SPRITE_OAM(from, to) console_dma3_into((u32)(from), to, 0x80000003)
#define ARM_LDR(at) ({ u32 at_ = (u32)(at), w_ = *(const u32 *)(at_ & ~3u), by_ = (at_ & 3) * 8; by_ ? w_ >> by_ | w_ << (32 - by_) : w_; })
#define ARM_LDRH(at) ({ u32 at_ = (u32)(at), h_ = *(const u16 *)(at_ & ~1u); at_ & 1 ? h_ >> 8 | h_ << 24 : h_; })
#define ARM_LDRSH(at) ({ u32 at_ = (u32)(at); at_ & 1 ? (s32)*(const s8 *)at_ : (s32)*(const s16 *)at_; })
#endif

/** 0x08002958, sa2__sub_80039E4, dp:unaligned: in the V-blank, each sprite the game put on a background is drawn into
 *  that background's tile map, each part of each of its frame's pieces a tile number: in a rotating background, a byte
 *  a tile, two at a time; in a tiled one, a halfword a tile with its palette and flips. Gives back FALSE outside the
 *  V-blank, the step not done, and TRUE once the sprites are drawn and the list emptied. */
bool32 sa2__sub_80039E4(void) {
  u16 oam[3];
  u32 tileShift = 5, rowBytes, tilesX, tilesY, rows, left, i, part, nextPart;
  u32 bgVram, bgBase, cnt, bgId, s, dims, from, flags, anim;
  u32 held = 0;   // the byte waiting for its neighbour in a rotating background's map
  s32 x, y, step;
  u32 at, row;
  u16 tile;

  if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) return FALSE;
  if (gBgSpritesCount == 0) return TRUE;

  for (i = 0; i < gBgSpritesCount; i = (u8)(i + 1)) {
    s = (u32)gBgSprites[i];
    dims = ARM_LDR(s + 0x0C);
    if (dims == 0xFFFFFFFF) continue;

    flags = ARM_LDR(s + 0x10);
    bgId = (flags & 0x18000) >> 15;
    cnt = gBgCntRegs[bgId];
    bgVram = ((cnt & 0xC) << 12) + VRAM;
    bgBase = ((cnt & 0x1F00) << 3) + VRAM;
    if (cnt & 0x80) tileShift = 6;
    // the frame's pieces: the tables' list of each animation's pieces, this animation's, and this frame's first
    from = ARM_LDR((u32)gRefSpriteTablesFull + 8);
    anim = ARM_LDRH(s + 0x0A);
    from = ARM_LDR(from + anim * 4);
    from += *(const u8 *)(dims + 1) * 6;

    if (bgId > 1 && (gDispCnt & 3) != 0) {
      // a rotating background: a byte a tile, its rows as wide as the background, 16 pixels at a time across
      rowBytes = (0x100000u << (cnt >> 14)) >> 16;
      for (part = 0; part < ARM_LDRH(dims + 2); part = nextPart) {
        BG_SPRITE_OAM(from, oam);
        from += 6;
        tilesX = gOamShapesSizes[(oam[0] & 0xC000) >> 12 | (oam[1] & 0xC000) >> 14][0] >> 3;
        tilesY = gOamShapesSizes[(oam[0] & 0xC000) >> 12 | (oam[1] & 0xC000) >> 14][1] >> 3;
        y = ARM_LDRSH(s + 0x18) - ARM_LDRSH(dims + 0x0A);
        x = (ARM_LDRSH(s + 0x16) - ARM_LDRSH(dims + 0x08)) & ~0xF;
        row = bgBase + (u32)(((s32)((oam[0] & 0xFF) + y) >> 3) * (s32)rowBytes);
        tile = (u16)(((ARM_LDR(s + 4) - bgVram) >> tileShift) + (oam[2] & 0x3FF)) & 0xFF;
        rows = (u8)(tilesY - 1);
        nextPart = (u8)(part + 1);
        if (tilesY == 0) continue;
        for (;;) {
          at = row + (u32)((s32)((oam[1] & 0x1FF) + x) >> 3);
          left = (u8)(tilesX - 1);
          if (tilesX != 0) {
            for (;;) {
              if (!(at & 1)) {
                held = tile;
              } else {
                held = (u16)(held | (u32)tile << 8);
                BG_SPRITE_STORE16(at, (u16)held);
              }
              tile = (u16)(tile + 1);
              at++;
              if (left == 0) break;
              left = (u8)(left - 1);
            }
          }
          // a byte left over at an odd address: the processor's halfword load there turns the halfword round, so
          // the byte beside it it meant to keep comes back 0, and goes in so
          if (at & 1) BG_SPRITE_STORE16(at, (u16)held);
          row += (u32)(s32)(s8)rowBytes;
          if (rows == 0) break;
          rows = (u8)(rows - 1);
        }
      }
    } else {
      // a tiled background: a halfword a tile, with the sprite's palette and its flips, 8 pixels at a time
      rowBytes = (u8)((gBgCntRegs[bgId] >> 14) - 2) <= 1 ? 0x40 : 0x20;
      for (part = 0; part < ARM_LDRH(dims + 2); part = nextPart) {
        u32 oamY, oamX, shapeSize, flip;
        s32 across;
        BG_SPRITE_OAM(from, oam);
        from += 6;
        shapeSize = (oam[0] & 0xC000) >> 12 | (oam[1] & 0xC000) >> 14;
        tilesX = gOamShapesSizes[shapeSize][0] >> 3;
        tilesY = gOamShapesSizes[shapeSize][1] >> 3;
        oamX = oam[1] & 0x1FF;
        oamY = oam[0] & 0xFF;
        oam[2] = (u16)(oam[2] + (*(const u8 *)(s + 0x25) << 12));

        flip = *(const u8 *)dims;
        if (((flip >> 1) ^ (ARM_LDR(s + 0x10) >> 11)) & 1) {
          oam[1] ^= 0x2000;
          y = ARM_LDRSH(s + 0x18) + ((*(const u8 *)dims & 1) ? ARM_LDRSH(dims + 0x0A) : (s32)(ARM_LDRH(dims + 6) - ARM_LDRSH(dims + 0x0A))) - 8;
          oamY = (u16)-oamY;
        } else {
          y = ARM_LDRSH(s + 0x18) - ARM_LDRSH(dims + 0x0A);
        }
        if (((ARM_LDR(s + 0x10) >> 10) & 1) != (*(const u8 *)dims & 1u)) {
          oam[1] ^= 0x1000;
          x = ARM_LDRSH(s + 0x16) + ((*(const u8 *)dims & 1) ? ARM_LDRSH(dims + 0x08) : (s32)(ARM_LDRH(dims + 4) - ARM_LDRSH(dims + 0x08))) - 8;
          oamX = (u16)-oamX;
        } else {
          x = ARM_LDRSH(s + 0x16) - ARM_LDRSH(dims + 0x08);
        }
        x &= ~0xF;
        y &= ~7;
        step = (oam[1] & 0x1000) ? -2 : 2;
        // a row of the map on, as a signed byte of twice its width, back for a piece turned upside down
        across = (s32)(s8)(u8)(((oam[1] & 0x2000) ? 0u - (rowBytes << 25) : rowBytes << 25) >> 24);
        row = bgBase + (u32)(((s32)(y + (s16)oamY) >> 2) * (s32)rowBytes);
        tile = (u16)(((ARM_LDR(s + 4) - bgVram) >> tileShift) + (oam[2] & 0xF3FF) + ((oam[1] & 0x3000) >> 2));
        rows = (u8)(tilesY - 1);
        nextPart = (u8)(part + 1);
        if (tilesY == 0) continue;
        for (;;) {
          at = row + (u32)((s32)((s16)oamX + x) >> 2);
          left = (u8)(tilesX - 1);
          if (tilesX != 0) {
            for (;;) {
              BG_SPRITE_STORE16(at, tile);
              tile = (u16)(tile + 1);
              at += (u32)step;
              if (left == 0) break;
              left = (u8)(left - 1);
            }
          }
          row += (u32)across;
          if (rows == 0) break;
          rows = (u8)(rows - 1);
        }
      }
    }
  }
  gBgSpritesCount = 0;
  return TRUE;
}
