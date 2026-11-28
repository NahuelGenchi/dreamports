// The engine's backgrounds.
#include "time.h"
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

  // (timed for a background with nothing to clear, a tiled one's clearing and the loop's step on; the fill's tile is on
  // the stack, as the original's is)
  for (bg = 0; bg < 4; bg++) {
#ifndef MATCHING
    if (gBgSprites_Unknown2[bg][1] == gBgSprites_Unknown2[bg][3] && gBgSprites_Unknown2[bg][0] == gBgSprites_Unknown2[bg][2])
      TIME(bg == 0 ? 0x08002F84 : 0x08002F98, 0x08002FC8, 0x080031B7, IW, IW, IW, IW);
    else if (gBgSprites_Unknown2[bg][1] != gBgSprites_Unknown2[bg][3])
      TIME(bg == 0 ? 0x08002F84 : 0x08002F98, 0x08002FB2, 0x08002FCB, IW, IW);
    else
      TIME(bg == 0 ? 0x08002F84 : 0x08002F98, 0x08002FC6, 0x08002FCB, IW, IW, IW, IW);
#endif
    if (gBgSprites_Unknown2[bg][1] != gBgSprites_Unknown2[bg][3] || gBgSprites_Unknown2[bg][0] != gBgSprites_Unknown2[bg][2]) {
      u16 cnt = gBgCntRegs[bg];
      u8 *map = (u8 *)VRAM + ((cnt & 0x1F00) << 3);
      u8 y = gBgSprites_Unknown2[bg][1];
      u8 x = gBgSprites_Unknown2[bg][0];

      TIME(0x08002FCA, 0x08002FF4, bg > 1 ? 0x08002FF7 : 0x080030DD, IW, IW, IW);
      if (bg > 1) TIME(0x08002FF6, 0x08003000, (gDispCnt & 3) ? 0x08003003 : 0x080030DD, IW);
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
        TIME(0x080030DC, 0x080030F2, width == 64 ? 0x080030F5 : 0x080030F7, IW);
        TIME(width == 64 ? 0x080030F4 : 0x080030F6, 0x080030FE, gBgSprites_Unknown2[bg][2] == 0xFF ? 0x08003101 : 0x0800314D, IW);
        if (gBgSprites_Unknown2[bg][2] == 0xFF) {
          DMA3_FILL16(gBgSprites_Unknown1[bg], map + y * width * 2, (gBgSprites_Unknown2[bg][3] - y) * width * 2);
          TIME(0x08003100, 0x08003138, 0x080031A1, IW, width * 2, IW, 0x040000D4, 0x040000D8, IW, gBgSprites_Unknown2[bg][3] - y,
               0x040000DC, 0x040000DC);
        } else {
          TIME(0x0800314C, 0x0800315C, y > gBgSprites_Unknown2[bg][3] ? 0x080031A1 : 0x0800315F, IW);
          for (; y <= gBgSprites_Unknown2[bg][3]; y++) {
            DMA3_FILL16(gBgSprites_Unknown1[bg], map + y * width * 2, (gBgSprites_Unknown2[bg][2] - x + 1) * 2);
            TIME(y == gBgSprites_Unknown2[bg][1] ? 0x0800315E : 0x0800316A, 0x0800319E, (u8)(y + 1) <= gBgSprites_Unknown2[bg][3] ? 0x0800316B : 0x080031A1, IW, y,
                 IW, 0x040000D4, 0x040000D8, IW, 0x040000DC, 0x040000DC, IW);
          }
        }
      }
      DMA3_FILL32(0, gBgSprites_Unknown2[bg], 4);
      TIME(0x080031A0, 0x080031B4, 0x080031B7, DMA3);
    }
    TIME(0x080031B6, bg + 1 < 4 ? 0x080031C0 : 0x080031BE, bg + 1 < 4 ? 0x08002F99 : 0x080031C3);
  }
  TIME(0x080031C2, 0x080031D2, BACK);
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
#define BG_SPRITE_OAM(from, to, fetching) DMA3_SET(from, to, 0x80000003)
#define ARM_LDR(at) (*(const vu32 *)(at))
#define ARM_LDRH(at) ((u32)*(const vu16 *)(at))
#define ARM_LDRSH(at) ((s32)*(const volatile s16 *)(at))
// A local the C reads before it ever sets it is, as the console's compiler leaves it, what its stack held there.
#define BG_SPRITE_LEFTOVER(local, at) ((void)0)
#else
/** A halfword stored where the console has the address, the lowest bit dropped as its store drops it (hardware.c). */
void console_store16(u32 at, u16 value);
/** DMA channel 3 started as the console's is, copying into a value of the Dreamport's own, as onto the console's stack,
 *  with where the original's processor is fetching as it starts, which a register nobody can read gives its first unit. */
void console_dma3_into(u32 src, void *dest, u32 control, u32 fetching);
#define BG_SPRITE_STORE16(at, value) console_store16((u32)(at), (value))
#define BG_SPRITE_OAM(from, to, fetching) console_dma3_into((u32)(from), to, 0x80000003, (fetching))
#define ARM_LDR(at) ({ u32 at_ = (u32)(at), w_ = *(const u32 *)(at_ & ~3u), by_ = (at_ & 3) * 8; by_ ? w_ >> by_ | w_ << (32 - by_) : w_; })
#define ARM_LDRH(at) ({ u32 at_ = (u32)(at), h_ = *(const u16 *)(at_ & ~1u); at_ & 1 ? h_ >> 8 | h_ << 24 : h_; })
#define ARM_LDRSH(at) ({ u32 at_ = (u32)(at); at_ & 1 ? (s32)*(const s8 *)at_ : (s32)*(const s16 *)at_; })
// A local the C reads before it ever sets it, which the original keeps at `at` in its frame, below its eight pushes and
// its 0x44 bytes of locals: what the console's stack held there, as the Dreamport keeps it (kit/gba/c/stack.h), from
// where the stack pointer was as the function was called.
#include "stack.h"
#define BG_SPRITE_LEFTOVER(local, at) ((local) = (u32)gba_stack_peek((u32)gba_stack_asm_sp(-0x64 + (at)), 4))
#endif

/** 0x08002958, sa2__sub_80039E4, dp:unaligned: in the V-blank, each sprite the game put on a background is drawn into
 *  that background's tile map, each part of each of its frame's pieces a tile number: in a rotating background, a byte
 *  a tile, two at a time; in a tiled one, a halfword a tile with its palette and flips. Gives back FALSE outside the
 *  V-blank, the step not done, and TRUE once the sprites are drawn and the list emptied. */
bool32 sa2__sub_80039E4(void) {
  u16 oam[3];
  u32 tileShift = 5, rowBytes, tilesX, tilesY, rows, left, i, part, nextPart;
  u32 bgVram, bgBase, cnt, bgId, s, dims, from, flags, anim;
  // the byte waiting for its neighbour in a rotating background's map, kept at 0x24 in the original's frame: it's set
  // only at an even byte, so a row whose first byte is odd puts beside it what the stack held there
  u32 held;
  s32 x, y, step;
  u32 at, row;
  u16 tile;

  BG_SPRITE_LEFTOVER(held, 0x24);

  // (timed up to the first sprite: the display's status looked at at its load's time, and the ways out before it)
  TIME(0x08002958, 0x08002968, 0x0800296B);
  if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) {
    TIME(0x0800296A, 0x08002972, 0x08002975, 0x04000004);
    TIME(0x08002974, 0x08002976, 0x08002E3F);
    TIME(0x08002E3E, 0x08002E4C, BACK);
    return FALSE;
  }
  TIME(0x0800296A, 0x08002972, 0x0800297D, 0x04000004);
  if (gBgSpritesCount == 0) {
    TIME(0x0800297C, 0x08002984, 0x08002E3D, IW);
    TIME(0x08002E3C, 0x08002E4C, BACK);
    return TRUE;
  }
  TIME(0x0800297C, 0x08002982, 0x08002987, IW);

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
        BG_SPRITE_OAM(from, oam, 0x08002A4E);
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
        BG_SPRITE_OAM(from, oam, 0x08002C00);
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

// ---------------------------------------------------------------------------------------------------------------
// The V-blank's fourth step. SAT-R/sa1 keeps it as assembly, with a sketch of its C that is SA2's in places, so this
// is written from the instructions.

// background.flags, as this step reads them: a background that scrolls, copied only when it moves onto another tile
// and kept within its map; a map turned upside down, its rows from the bottom; and one turned left to right, each row
// from its end. A tile turned so has the matching flip bits of its number changed.
#define BACKGROUND_SCROLLS 0x20
#define BACKGROUND_FLIP_Y 0x80
#define BACKGROUND_FLIP_X 0x100
#define TILE_FLIP_X 0x400
#define TILE_FLIP_Y 0x800

/** The backgrounds' scroll registers as the game keeps them (core.h has them). The BIOS's division (hardware.c). */
s32 Div(s32 num, s32 denom);

#ifdef MATCHING
#define BG_COPY(from, to, control) DMA3_SET(from, to, control)
#define BG_MAP_LDRH(at) ARM_LDRH(at)
#define BG_MAP_LDRB(at) (*(const u8 *)(at))
#else
#define BG_COPY(from, to, control) console_dma3((u32)(from), (u32)(to), (control))
/** A halfword loaded where the console has the address, in whichever memory shows there (hardware.c): a map's rows
 *  read backwards can run off the start of a memory, which shows again below it. */
u16 console_load16(u32 at);
u8 console_load8(u32 at);
#define BG_MAP_LDRB(at) console_load8((u32)(at))
#define BG_MAP_LDRH(at) ({ u32 at_ = (u32)(at), h_ = console_load16(at_); at_ & 1 ? h_ >> 8 | h_ << 24 : h_; })
#endif

// The original keeps sixteen words of its own on the stack, under its eight pushes, and reads them back as it goes. A
// pointer can lead a read into them, and a copy long enough writes over them, after which the original goes on with
// what the copy left. So each is stored where and when the original stores it and read back where it reads it. `frame`
// is where they start, 0x60 bytes under the stack pointer as the function was called: the map's width at 0, a wide
// row's second half at 4, a tile's bytes at 8, a row's at 12, the column and row the view starts at at 16 and 20, a
// level's block column, the column in it, a run's bytes and the next column at 24, 28, 32 and 56, or at 36, 40, 44 and
// 52 when it scrolls, the columns past the map's edge, 16 bits up, at 48, and a DMA's control or the place a turned
// tile goes at 60.
#ifdef MATCHING
// (the stack takes the frame's room from what the console's compiler makes of this C: the six registers it pushes for
// it, a word it keeps beside these, and 17 words here are the original's 96 bytes, its eight pushes and sixteen words,
// so the stack goes as far down as the original's and no further)
#define BG_FRAME_ROOM u32 frameRoom[17];
#define BG_FRAME_AT() ((u32)frameRoom)
#define BG_FRAME_PUSHES(frame) ((void)0)
#define BG_SLOT(frame, at) (*(vu32 *)((frame) + (at)))
#define BG_FRAME(frame, at, value) (BG_SLOT(frame, at) = (u32)(value))
#else
#define BG_FRAME_ROOM
#define BG_FRAME_AT() ((u32)gba_stack_asm_sp(-0x60))
// The eight pushes above them, as the original's start makes them: lr, r7, r6, r5 and r4, then r10, r9 and r8 through
// r7, r6 and r5, each as whoever called the function left it, where the stack knows it.
#define BG_FRAME_PUSH(frame, at, reg) do { \
    uint64_t v_ = gba_stack_asm_caller(reg); \
    if (v_ != GBA_STACK_NONE) BG_FRAME(frame, at, (u32)v_); \
  } while (0)
#define BG_FRAME_PUSHES(frame) do { \
    BG_FRAME_PUSH(frame, 0x40, 8); BG_FRAME_PUSH(frame, 0x44, 9); BG_FRAME_PUSH(frame, 0x48, 10); BG_FRAME_PUSH(frame, 0x4C, 4); \
    BG_FRAME_PUSH(frame, 0x50, 5); BG_FRAME_PUSH(frame, 0x54, 6); BG_FRAME_PUSH(frame, 0x58, 7); BG_FRAME_PUSH(frame, 0x5C, 14); \
  } while (0)
#define BG_SLOT(frame, at) (*(const vu32 *)((frame) + (at)))
// (through the kit's stack, from where the running function's own frame starts, so the stack knows how far down it went)
#define BG_FRAME(frame, at, value) gba_stack_store((s32)((frame) + (at) - gba_stack_sp()), (u32)(value), 4)
#endif
#define L(at) BG_SLOT(frame, at)
#define S(at, value) BG_FRAME(frame, at, value)

// `rows` rows of the map, a tile at a time, each turned by `flip`: across, from `from`, forward or back, as many as the
// background is wide, read again after each tile, or, `wrapped`, `w` and then the count kept at 48, none when `w` is 0
// or below, as a wrap past the map's edge by a negative count has; down, `from` moves `step` bytes a row and `to` a
// row of video memory, read from the stack each row. When `keeps`, the place each tile goes is kept at 60 before the
// tile is read, and read back for the store.
static void bg_rows_by_tile(const struct Background *bg, u32 to, u32 from, u16 rows, u32 step, u32 flip, int back, u32 frame, int keeps, int wrapped, s32 w) {
  while (rows-- != 0) {
    u32 next = to + L(12);
    u16 k = 0;
    if (wrapped ? 0 < w : k < bg->targetTilesX) {
      s32 until = wrapped ? (s32)L(48) >> 16 : 0;
      do {
        u32 tile;
        if (keeps) S(60, to + k * 2u);
        tile = BG_MAP_LDRH(back ? from - k * 2u : from + k * 2u) ^ flip;
        BG_SPRITE_STORE16(keeps ? L(60) : to + k * 2u, (u16)tile);
        k++;
      } while (wrapped ? (s32)k < until : k < bg->targetTilesX);
    }
    to = next;
    from += step;
  }
}

// A level's map, built of blocks of tiles that the block map names a byte each, from the column and row kept at 16
// and 20: as much of each block's rows at a time as the background shows, each row by DMA. One that scrolls keeps its
// block column, the column in it, a run's bytes and the next column in other places than one that doesn't.
static void bg_copy_level(struct Background *bg, u32 frame, int scrolled) {
  s32 i = 0;
  if (!(i < (s32)bg->targetTilesX)) return;
  do {
    s32 at = (s32)L(16) + i;
    s32 blockX = Div(at, bg->xTiles);
    s32 xt, inX, rowsLeft, across, cols, j = 0;
    S(scrolled ? 36 : 24, blockX);
    xt = bg->xTiles;
    inX = at - blockX * xt;
    S(scrolled ? 40 : 28, inX);
    rowsLeft = bg->targetTilesY;
    across = (s32)bg->targetTilesX - i;
    cols = xt - (scrolled ? (s32)L(40) : inX);
    if (cols > across) cols = across;
    S(scrolled ? 44 : 32, cols * (s32)L(8));
    S(scrolled ? 52 : 56, cols + i);
    if (j < rowsLeft) {
      do {
        s32 atY = (s32)L(20) + j;
        s32 blockY = Div(atY, bg->yTiles);
        s32 yTiles = bg->yTiles;
        s32 inY = atY - blockY * yTiles;
        s32 count = yTiles - inY;
        u32 block = BG_MAP_LDRB((u32)bg->metatileMap + (u32)bg->mapWidth * (u32)blockY + L(scrolled ? 36 : 24));
        u32 xt2 = bg->xTiles;
        u32 from = block * xt2 * (u32)yTiles;
        u32 to;
        from += (u32)inY * xt2 + L(scrolled ? 40 : 28);
        from *= L(8);
        from += (u32)bg->layout;
        to = (u32)bg->layoutVram + bg->unk24;
        to += (u32)j * L(12);
        to += bg->unk22;
        to += (u32)i * L(8);
        j += count;
        if (count > rowsLeft) count = rowsLeft;
        rowsLeft -= count;
        if (count != 0) {
          s32 bytes = (s32)L(scrolled ? 44 : 32);
          u32 step;
          S(60, (bytes + (s32)((u32)bytes >> 31)) >> 1);
          S(60, L(60) | 0x80000000u);
          step = L(0) * L(8);
          do {
            BG_COPY(from, to, L(60));
            to += L(12);
            from += step;
          } while (--count != 0);
        }
      } while (j < (s32)bg->targetTilesY);
    }
    i = (s32)L(scrolled ? 52 : 56);
  } while (i < (s32)bg->targetTilesX);
}

// A background that doesn't scroll, copied whole: by DMA a row at a time, or, turned, a tile at a time. A 512-wide
// tiled background whose rows run past its first 256 pixels has each row in two, the second half as many bytes on as
// 4 keeps. `xt` is the map's width as the step first read it back.
static void bg_copy_whole(struct Background *bg, u32 flags, u32 affine, u32 xt, u32 frame) {
  u32 to = (u32)bg->layoutVram + bg->unk24 * L(12);
  u32 left = bg->unk22, from, size, step;
  u16 rows;
  to += left * L(8);
  rows = bg->targetTilesY;
  if (flags & BACKGROUND_FLIP_X) {
    if (flags & BACKGROUND_FLIP_Y) {
      from = (u32)bg->layout + (u32)(bg->unk20 + rows - 1) * xt * L(8);
      size = L(8);
      from += (u32)(bg->unk1E + bg->targetTilesX - 1) * size;
      if (rows == 0) return;
      step = L(0) * size;
      bg_rows_by_tile(bg, to, from, rows, 0u - step, TILE_FLIP_X | TILE_FLIP_Y, 1, frame, 0, 0, 0);
    } else {
      from = (u32)bg->layout + (u32)bg->unk20 * xt * L(8);
      size = L(8);
      from += (u32)(bg->unk1E + bg->targetTilesX - 1) * size;
      if (rows == 0) return;
      step = L(0) * size;
      bg_rows_by_tile(bg, to, from, rows, step, TILE_FLIP_X, 1, frame, 0, 0, 0);
    }
  } else if (flags & BACKGROUND_FLIP_Y) {
    from = (u32)bg->layout + (u32)(bg->unk20 + rows - 1) * xt * L(8);
    size = L(8);
    from += (u32)bg->unk1E * size;
    if (rows == 0) return;
    step = L(0) * size;
    bg_rows_by_tile(bg, to, from, rows, 0u - step, TILE_FLIP_Y, 0, frame, 0, 0, 0);
  } else if ((affine & 1) && L(8) == 2 && (s32)(32 - left) > 0 && (s32)(bg->targetTilesX + left - 32) > 0) {
    u32 first = (32 - left) * 2, second = (bg->targetTilesX + left - 32) * 2;
    u32 control1 = 0x80000000u | (u32)((s32)first >> 1), control2 = 0x80000000u | (u32)((s32)second >> 1);
    from = (u32)bg->layout + (u32)bg->unk20 * xt * 2 + (u32)bg->unk1E * 2;
    while (rows-- != 0) {
      BG_COPY(from, to, control1);
      BG_COPY(from + first, to + L(4), control2);
      to += L(12);
      step = L(0);
      from += step * L(8);
    }
  } else {
    size = L(8);
    from = (u32)bg->layout + (u32)bg->unk20 * xt * size + (u32)bg->unk1E * size;
    if (rows == 0) return;
    step = L(0) * size;
    while (rows-- != 0) {
      BG_COPY(from, to, 0x80000000u | (u32)((s32)(bg->targetTilesX * L(8)) >> 1));
      to += L(12);
      from += step;
    }
  }
}

// A background that scrolls: kept within its map, unless it's a level's, its scroll's last 3 bits to the scroll
// registers, and copied when it has moved onto another tile, from the tile it's on. Past the map's right edge, the
// columns left over come from the map's left edge, after the rest. `xTiles` is the map's width as the step first read
// it back.
static void bg_copy_scrolled(struct Background *bg, u32 flags, u32 bgId, u32 xTiles, u32 frame) {
  u32 x = bg->scrollX, tileX, xt, tX, from, to, size, step, end;
  u16 wrap, rows;
  s32 w;
  if (!(flags & BACKGROUND_FLAG_IS_LEVEL_MAP)) {
    u32 yTiles = bg->yTiles, y = bg->scrollY;
    while ((s32)x >= (s32)(xTiles << 3)) {
      bg->scrollX = (u16)(bg->scrollX - (xTiles << 3));
      x = bg->scrollX;
    }
    x = bg->scrollX;
    while ((s32)y >= (s32)(yTiles << 3)) {
      bg->scrollY = (u16)(bg->scrollY - (yTiles << 3));
      y = bg->scrollY;
    }
  }
  gBgScrollRegs[bgId][0] = (s16)(x & 7);
  gBgScrollRegs[bgId][1] = (s16)(bg->scrollY & 7);

  tileX = bg->prevScrollX >> 3;
  x = bg->scrollX;
  if (tileX == x >> 3 && bg->prevScrollY >> 3 == bg->scrollY >> 3) return;
  tileX = x >> 3;
  flags = bg->flags;
  if (flags & BACKGROUND_FLAG_IS_LEVEL_MAP) {
    S(16, (u16)(tileX + bg->unk1E));
    S(20, (u16)((bg->scrollY >> 3) + bg->unk20));
    bg_copy_level(bg, frame, 1);
    return;
  }

  S(16, (u16)(bg->unk1E + tileX));
  S(20, (u16)((bg->scrollY >> 3) + bg->unk20));
  to = (u32)bg->layoutVram + bg->unk24 * L(12);
  to += bg->unk22 * L(8);
  tX = bg->targetTilesX;
  end = L(16) + tX;
  xt = bg->xTiles;
  wrap = (s32)(end + 1) > (s32)xt ? (u16)(end - (xt - 1)) : 0;
  rows = (u16)(bg->targetTilesY + 1);
  if (flags & BACKGROUND_FLIP_X) {
    size = L(8);
    if (flags & BACKGROUND_FLIP_Y) from = (u32)bg->layout + (u32)(bg->unk20 + rows - 1) * xt * size + (u32)(bg->unk1E + tX - 1) * size;
    else from = (u32)bg->layout + (u32)bg->unk20 * xt * size + (u32)(bg->unk1E + tX - 1) * size;
    if (rows != 0) {
      step = L(0) * size;
      if (flags & BACKGROUND_FLIP_Y) bg_rows_by_tile(bg, to, from, rows, 0u - step, TILE_FLIP_X | TILE_FLIP_Y, 1, frame, 1, 0, 0);
      else bg_rows_by_tile(bg, to, from, rows, step, TILE_FLIP_X, 1, frame, 1, 0, 0);
    }
  } else if (flags & BACKGROUND_FLIP_Y) {
    from = (u32)(L(20) + rows - 1) * xt;
    size = L(8);
    from = (u32)bg->layout + from * size;
    from += L(16) * size;
    if (rows != 0) {
      step = L(0) * size;
      bg_rows_by_tile(bg, to, from, rows, 0u - step, TILE_FLIP_Y, 0, frame, 1, 0, 0);
    }
  } else {
    from = L(20) * xt;
    size = L(8);
    from = (u32)bg->layout + from * size;
    from += L(16) * size;
    if (rows != 0) {
      s32 before = (s16)wrap - 1, units;
      step = L(0);
      step *= L(8);
      while (rows-- != 0) {
        units = (s32)((u32)(bg->targetTilesX - before) * L(8));
        BG_COPY(from, to, 0x80000000u | (u32)((units + (s32)((u32)units >> 31)) >> 1));
        to += L(12);
        from += step;
      }
    }
  }

  w = (s16)wrap;
  if (w == 0) return;
  to = (u32)bg->layoutVram + bg->unk24 * L(12);
  xt = bg->xTiles;
  to += (u32)(bg->unk22 + xt - L(16)) * L(8);
  rows = (u16)(bg->targetTilesY + 1);
  flags = bg->flags;
  if (flags & BACKGROUND_FLIP_X) {
    if (flags & BACKGROUND_FLIP_Y) {
      from = (u32)(L(20) + rows - 1) * xt;
      size = L(8);
      from = (u32)bg->layout + from * size + (u32)(w - 1) * size;
      if (rows == 0) return;
      step = L(0) * size;
      bg_rows_by_tile(bg, to, from, rows, 0u - step, TILE_FLIP_X | TILE_FLIP_Y, 1, frame, 0, 0, 0);
    } else {
      from = L(20) * xt;
      size = L(8);
      from = (u32)bg->layout + from * size + (u32)(w - 1) * size;
      if (rows == 0) return;
      step = L(0);
      step *= L(8);
      bg_rows_by_tile(bg, to, from, rows, step, TILE_FLIP_X, 1, frame, 0, 0, 0);
    }
  } else if (flags & BACKGROUND_FLIP_Y) {
    from = (u32)(L(20) + rows - 1) * xt;
    size = L(8);
    from = (u32)bg->layout + from * size;
    if (rows == 0) return;
    S(48, (u32)wrap << 16);
    step = L(0) * size;
    bg_rows_by_tile(bg, to, from, rows, 0u - step, TILE_FLIP_Y, 0, frame, 1, 1, w);
  } else {
    s32 units;
    u32 control;
    from = L(20) * xt;
    size = L(8);
    from = (u32)bg->layout + from * size;
    if (rows == 0) return;
    units = w * (s32)L(8);
    control = 0x80000000u | (u32)((units + (s32)((u32)units >> 31)) >> 1);
    step = L(0);
    step *= L(8);
    while (rows-- != 0) {
      BG_COPY(from, to, control);
      to += L(12);
      from += step;
    }
  }
}

/** 0x08001AA4 to 0x0800258E, sa2__sub_8002B20: in the V-blank, each background on the list to draw has its map
 *  copied to video memory, from the tile its view starts at: a scrolling one only when it has moved onto another tile.
 *  Gives back FALSE outside the V-blank, the rest left for the next, and TRUE once the list is empty. The code map
 *  keeps the code its long jumps go on into as five functions of their own, of which this is the twin too. */
bool32 sa2__sub_8002B20(void) {
  BG_FRAME_ROOM
  u32 frame = BG_FRAME_AT();
  BG_FRAME_PUSHES(frame);
  // where a wide background's row goes on, kept from one background to the next as the original keeps it
  S(4, 0);
  // (timed with nothing waiting: the way out is the function's end, reached by a `bl` the compiler wrote as a long jump)
  if (gBackgroundsCopyQueueCursor == gBackgroundsCopyQueueIndex) {
    TIME(0x08001AA4, 0x08001AC6, 0x0800258D, IW, IW);
    TIME(0x0800258C, 0x0800259C, BACK);
  } else {
    TIME(0x08001AA4, 0x08001AC2, 0x08001AC9, IW, IW);
  }
  while (gBackgroundsCopyQueueCursor != gBackgroundsCopyQueueIndex) {
    struct Background *bg;
    u32 flags, bgId, affine, xTiles;
    u8 at;
    if (!(REG_READ16(REG_DISPSTAT) & DISPSTAT_VBLANK)) return FALSE;
    REG_READ16(REG_VCOUNT);
    at = gBackgroundsCopyQueueCursor;
    bg = gBackgroundsCopyQueue[at];
    gBackgroundsCopyQueueCursor = (u8)((at + 1) & 15);
    flags = bg->flags;
    if ((flags & BACKGROUND_SCROLLS) && bg->scrollX == bg->prevScrollX && bg->scrollY == bg->prevScrollY) continue;

    S(0, bg->xTiles);
    bgId = flags & 3;
    xTiles = L(0);
    if (bgId > 1 && (gDispCnt & 3)) {
      // a rotating background: a byte a tile, its rows 16 tiles wide or more as its size says
      affine = gBgCntRegs[bgId] >> 14;
      S(12, (0x100000u << affine) >> 16);
      S(8, 1);
    } else {
      // a tiled one: a halfword a tile, 32 to a row
      S(12, 32);
      affine = gBgCntRegs[bgId] >> 14;
      if (affine == 1 || affine == 3) S(4, 0x800);
      S(8, 2);
    }
    S(12, (u16)(L(12) * L(8)));
    flags = bg->flags;
    if (flags & BACKGROUND_SCROLLS) bg_copy_scrolled(bg, flags, bgId, xTiles, frame);
    else if (flags & BACKGROUND_FLAG_IS_LEVEL_MAP) {
      S(16, bg->unk1E);
      S(20, bg->unk20);
      bg_copy_level(bg, frame, 0);
    } else bg_copy_whole(bg, flags, affine, xTiles, frame);

    REG_READ16(REG_VCOUNT);
    bg->prevScrollX = bg->scrollX;
    bg->prevScrollY = bg->scrollY;
  }
  return TRUE;
}
#undef L
#undef S
