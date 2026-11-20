// The sprites' list: each sprite drawn takes entries of the console's list, in the order its oamFlags asks, and the
// list goes to the console in the V-blank.
#include "animation.h"
#include "core.h"
#include "time.h"

#define SPRITE_FLAG_MASK_ROT_SCALE 0x1F
#define SPRITE_FLAG_MASK_ROT_SCALE_ENABLE 0x20
#define SPRITE_FLAG_MASK_ROT_SCALE_DOUBLE_SIZE 0x40
#define SPRITE_FLAG_MASK_OBJ_MODE 0x180
#define SPRITE_FLAG_MASK_X_FLIP 0x400
#define SPRITE_FLAG_MASK_Y_FLIP 0x800
#define SPRITE_FLAG_MASK_PRIORITY 0x3000
#define SPRITE_FLAG_MASK_17 0x20000
#define GET_SPRITE_OAM_ORDER(s) (((s)->oamFlags & 0x7C0) >> 6)
#define DISPLAY_WIDTH 240

/** What OamMalloc gives when the list is full. */
extern void *iwram_end;
/** Each list entry's place in the list that goes to the console. */
extern u8 gOamMallocCopiedOrder[128];
/** Each shape and size of sprite's width and height. */
extern const u8 gOamShapesSizes[12][2];

struct OamData *OamMalloc(u8 order);

/** DisplaySprite, 0x08004158: a sprite's frame on the screen, an entry of the list for each of its parts, flipped,
 *  turned and placed as its flags say, unless it's off the screen or has no frame. */
void DisplaySprite(struct Sprite *sprite) {
  struct OamData *oam;
  s32 x, y, sprWidth, sprHeight;
  u8 i;
  u32 sprX, sprY;
  const u16 *oamData;

  if (sprite->dimensions != (const struct SpriteDimensions *)-1) {
    const struct SpriteDimensions *sprDims = sprite->dimensions;

    sprite->numSubFrames = sprDims->numSubframes;
    x = sprite->x;
    y = sprite->y;
    if (sprite->frameFlags & SPRITE_FLAG_MASK_17) {
      x -= gSpriteOffset.x;
      y -= gSpriteOffset.y;
    }

    sprWidth = sprDims->width;
    sprHeight = sprDims->height;
    if (sprite->frameFlags & SPRITE_FLAG_MASK_ROT_SCALE_ENABLE) {
      if (sprite->frameFlags & SPRITE_FLAG_MASK_ROT_SCALE_DOUBLE_SIZE) {
        x -= sprDims->width / 2;
        y -= sprDims->height / 2;
        sprWidth *= 2;
        sprHeight *= 2;
      }
    } else {
      if (sprite->frameFlags & SPRITE_FLAG_MASK_Y_FLIP) y -= sprHeight - sprDims->offsetY;
      else y -= sprDims->offsetY;
      if (sprite->frameFlags & SPRITE_FLAG_MASK_X_FLIP) x -= sprWidth - sprDims->offsetX;
      else x -= sprDims->offsetX;
    }

    if (x + sprWidth >= 0 && x <= DISPLAY_WIDTH && y + sprHeight >= 0 && y <= DISPLAY_HEIGHT) {
      for (i = 0; i < sprDims->numSubframes; i++) {
        oamData = gRefSpriteTablesFull->oamData[sprite->graphics.anim];
        oam = OamMalloc(GET_SPRITE_OAM_ORDER(sprite));
        if (iwram_end == oam) return;
        if (i == 0) sprite->oamBaseIndex = gOamFreeIndex - 1;

        DMA3_COPY16(&oamData[((sprDims->oamIndex & 0x3FFF) + i) * 3], oam, 6);
        sprX = oam->attr1 & 0x1FF;
        sprY = oam->attr0 & 0xFF;
        oam->attr1 &= 0xFE00;
        oam->attr0 &= 0xFE00;
        oam->attr2 += sprite->palId << 12;

        if (sprite->frameFlags & SPRITE_FLAG_MASK_ROT_SCALE_ENABLE) {
          oam->attr0 |= 0x100;
          if (sprite->frameFlags & SPRITE_FLAG_MASK_ROT_SCALE_DOUBLE_SIZE) oam->attr0 |= 0x200;
          oam->attr1 |= (sprite->frameFlags & SPRITE_FLAG_MASK_ROT_SCALE) << 9;
        } else {
          u32 flipY, r6, shapeAndSize;

          shapeAndSize = ((oam->attr0 & 0xC000) >> 12);
          shapeAndSize |= ((oam->attr1 & 0xC000) >> 14);
          flipY = sprite->frameFlags >> 11;
          r6 = 1;
          if ((((sprDims->flip >> 1) ^ flipY) & r6) != 0) {
            oam->attr1 ^= 0x2000;
            sprY = sprHeight - gOamShapesSizes[shapeAndSize][1] - sprY;
          }
          if (((sprite->frameFlags >> 10) & r6) != (sprDims->flip & 1)) {
            oam->attr1 ^= 0x1000;
            sprX = sprWidth - gOamShapesSizes[shapeAndSize][0] - sprX;
          }
        }

        oam->attr0 |= (sprite->frameFlags & SPRITE_FLAG_MASK_OBJ_MODE) * 8;
        oam->attr2 |= (sprite->frameFlags & SPRITE_FLAG_MASK_PRIORITY) >> 2;
        oam->attr0 += ((y + sprY) & 0xFF);
        oam->attr1 += ((x + sprX) & 0x1FF);
        if (oam->attr0 & (1 << 13)) oam->attr2 += oam->attr2 & 0x3FF;
        oam->attr2 += ((u32)sprite->graphics.dest - 0x06010000) / 32;
      }
    }
  }
}

/** 0x080047FC, OamMalloc: the next entry of the list, at the end of the run of its `order`, or iwram_end when all 128
 *  are taken. */
struct OamData *OamMalloc(u8 order) {
  struct OamData *result;

  if (order > 31) order = 31;
  if (gOamFreeIndex > 127) {
    result = iwram_end;
  } else {
    if ((u8)gOamMallocOrders_StartIndex[order] == 0xFF) {
      gOamMallocBuffer[gOamFreeIndex].fractional = 0xFF;
      gOamMallocOrders_StartIndex[order] = gOamFreeIndex;
      gOamMallocOrders_EndIndex[order] = gOamFreeIndex;
    } else {
      gOamMallocBuffer[gOamFreeIndex].fractional = 0xFF;
      gOamMallocBuffer[(u8)gOamMallocOrders_EndIndex[order]].fractional = gOamFreeIndex;
      gOamMallocOrders_EndIndex[order] = gOamFreeIndex;
    }
    gOamFreeIndex++;
    result = &gOamMallocBuffer[gOamFreeIndex - 1];
  }
  return result;
}

/** 0x08004894, ProcessOamBuffers: the list's entries, run by run in their orders, copied to the list that goes to the
 *  console, the rest hidden. While paused, the sprites drawn before stay, at the list's end. */
void ProcessOamBuffers(void) {
  struct OamData *dstOam = &gOamBuffer[0];
  u8 i = 0;
  s32 r3;
#ifndef MATCHING
  int plain = 0;
#endif

  for (r3 = 0; r3 < 32; r3++) {
    s8 index = gOamMallocOrders_StartIndex[r3];

    TIME(r3 == 0 ? 0x08004894 : 0x080048B2, 0x080048C4, index != -1 ? 0x080048C7 : 0x080048FB, IW);
#ifndef MATCHING
    if (index != -1) TIME(0x080048C6, 0x080048CE, 0x080048D1);
#endif
    while (index != -1) {
      u8 newI;
      u8 *byteArray = gOamMallocCopiedOrder;

      DMA3_COPY16(&gOamMallocBuffer[index], dstOam, 6);
      dstOam++;
      byteArray += index;
      newI = i++;
      *byteArray = newI;
      index = gOamMallocBuffer[index].fractional;
      TIME(0x080048D0, 0x080048F8, index != -1 ? 0x080048D1 : 0x080048FB, DMA3, IW, IW);
    }
    TIME(0x080048FA, 0x080048FE, r3 + 1 < 32 ? 0x080048B3 : 0x08004901);
  }

  if (gFlags & FLAGS_PAUSED) {
    r3 = gOamFreeIndex;
    dstOam = &gOamBuffer[r3];
    while (r3 < gOamFirstPausedIndex) {
      DMA3_FILL16(0x200, dstOam, 6);
      dstOam++;
      r3++;
    }
  } else if (gFlags & FLAGS_PAUSE_GAME) {
    s32 k, l;

    r3 = gOamFreeIndex - 1;
    dstOam = &gOamBuffer[r3];
    for (k = l = 0; r3 >= 0;) {
      s32 size = 6;
      DMA3_COPY16(dstOam - k, &gOamBuffer[127 - l], size);
      k++, r3--, l++;
    }
    gOamFirstPausedIndex = 128 - gOamFreeIndex;
    for (r3 = 0; r3 < gOamFirstPausedIndex; r3++) {
      DMA3_FILL16(0x200, &gOamBuffer[r3], 6);
#ifdef MATCHING
      asm("" ::"r"(r3));
#endif
    }
  } else {
    // (the game not paused is the path timed)
    TIME(0x08004900, 0x0800490C, 0x0800496D, IW);
    TIME(0x0800496C, 0x08004974, 0x080049F5);
    gOamFirstPausedIndex = 0;
#ifndef MATCHING
    plain = 1;
#endif
  }

  gOamFreeIndex = 0;
#ifndef MATCHING
  if (plain && !(gFlags & FLAGS_UPDATE_WITH_CPU_SET)) TIME(0x080049F4, 0x08004A0A, 0x08004A41, IW, IW, IW);
#endif
  if (gFlags & FLAGS_UPDATE_WITH_CPU_SET) {
    CpuFill32(-1, gOamMallocOrders_StartIndex, sizeof(gOamMallocOrders_StartIndex));
    CpuFill32(-1, gOamMallocOrders_EndIndex, sizeof(gOamMallocOrders_EndIndex));
  } else {
    DMA3_FILL32(-1, gOamMallocOrders_StartIndex, sizeof(gOamMallocOrders_StartIndex));
    DMA3_FILL32(-1, gOamMallocOrders_EndIndex, sizeof(gOamMallocOrders_EndIndex));
    TIME(0x08004A40, 0x08004A72, BACK, DMA3, DMA3);
  }
}
