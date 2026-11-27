// A sprite drawn into a background and its animation, text written on a background, and the commands of an animation
// drawn into one.
#include "bg_anim.h"
#include "animation.h"
#include "core.h"
#include "screen.h"

/** Which background a sprite is drawn into, in its flags. */
#define SPRITE_FLAG_MASK_BG_ID 0x18000
// where a command is in its list, in words
#define ReadInstruction(script, cursor) ((void *)(script) + (cursor) * sizeof(s32))

/** The sprites the game put on a background this frame, for the V-blank to draw (background.c). */
extern struct Sprite *gBgSprites[];
/** The commands of an animation drawn into a background, by their number: -1 is the first. */
extern const AnimationCommandFunc gAnimCmdTable_BG[12];
s32 Mod(s32 num, s32 denom);

/** UpdateSpriteAnimation_BG, 0x08002658: a sprite drawn into a background, a frame on in its animation. As
 *  UpdateSpriteAnimation, but an animation that is over stays over even when it's given another, and the commands
 *  are the backgrounds' own. */
s32 UpdateSpriteAnimation_BG(struct Sprite *s) {
  if (s->frameFlags & SPRITE_FLAG_ANIM_OVER) return 0;

  if (s->prevVariant != s->variant || s->prevAnim != s->graphics.anim) {
    s->graphics.size = 0;
    s->prevVariant = s->variant;
    s->prevAnim = s->graphics.anim;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->frameFlags &= ~SPRITE_FLAG_ANIM_OVER;
  }

  if (s->qAnimDelay > 0) {
    s->qAnimDelay -= s->animSpeed * 16;
  } else {
    s32 ret;
    const s32 *cmd;
    const s32 *script;
    const s32 *const *variants;

    variants = gRefSpriteTablesFull->animations[s->graphics.anim];
    script = variants[s->variant];
    cmd = ReadInstruction(script, s->animCursor);
    while (*cmd < 0) {
      ret = CALL(gAnimCmdTable_BG[~*cmd])((void *)cmd, s);
      if (ret != 1) {
#ifdef MATCHING
        register const s32 *newScript asm("r1");
#else
        const s32 *newScript;
#endif
        if (ret != -1) return ret;
        variants = gRefSpriteTablesFull->animations[s->graphics.anim];
        newScript = variants[s->variant];
        s->animCursor = 0;
        script = newScript;
      }
      cmd = ReadInstruction(script, s->animCursor);
    }

    s->qAnimDelay += ((const struct ACmd_ShowFrame *)cmd)->delay << 8;
    s->qAnimDelay -= s->animSpeed * 0x10;
    {
      s32 frame = ((const struct ACmd_ShowFrame *)cmd)->index;

      if (frame != -1) {
        const struct SpriteTables *sprTables = gRefSpriteTablesFull;
        s->dimensions = (const struct SpriteDimensions *)&sprTables->dimensions[s->graphics.anim][frame];
      } else {
        s->dimensions = (const struct SpriteDimensions *)-1;
      }
    }
    s->animCursor += 2;
  }
  return 1;
}

/** animCmd_GetTiles_BG, 0x08002778: the frame's tiles, by the command's index, go on the list to copy to video
 *  memory, unless the sprite keeps its own. */
s32 animCmd_GetTiles_BG(void *cursor, struct Sprite *s) {
  struct ACmd_GetTiles *cmd = cursor;

  s->animCursor += 3;
  if ((s->frameFlags & SPRITE_FLAG_MASK_19) == 0) {
    s32 tileIndex = cmd->tileIndex;

    if (tileIndex < 0) {
      s->graphics.src = &gRefSpriteTablesFull->tiles_8bpp[tileIndex * 64];
      s->graphics.size = cmd->numTilesToCopy * 64;
    } else {
      s->graphics.src = &gRefSpriteTablesFull->tiles_4bpp[tileIndex * 32];
      s->graphics.size = cmd->numTilesToCopy * 32;
    }
    gVramGraphicsCopyQueue[gVramGraphicsCopyQueueIndex] = &s->graphics;
    gVramGraphicsCopyQueueIndex = (gVramGraphicsCopyQueueIndex + 1) & 31;
  }
  return 1;
}

/** DisplaySprite_BG, 0x08002888: the sprite goes on the list of those the V-blank draws into a background, and its
 *  background is scrolled so the frame's corner comes where the sprite is: a rotating background by its own
 *  registers, any other by its scroll. */
void DisplaySprite_BG(struct Sprite *s) {
  const struct SpriteDimensions *dims;

  gBgSprites[gBgSpritesCount] = s;
  gBgSpritesCount++;

  if (s->dimensions != (void *)-1) {
    u32 bg;

    dims = s->dimensions;
    bg = (s->frameFlags & SPRITE_FLAG_MASK_BG_ID) >> 15;
    if (bg > 1 && (gDispCnt & 3)) {
      s32 x, y;

      x = Mod(dims->offsetX - s->x, 16);
      gBgAffineRegs[bg - 2].x = x << 8;

      y = Mod(dims->offsetY - s->y, 8);
      gBgAffineRegs[bg - 2].y = y << 8;
    } else {
      s32 x, y;

      x = Mod(dims->offsetX - s->x, 16);
      gBgScrollRegs[bg][0] = x;

      y = Mod(dims->offsetY - s->y, 8);
      gBgScrollRegs[bg][1] = y;
    }
  }
}

/** sub_80031E8, 0x080031E8: a line of text written on a background. Each character's tile is copied from the font to
 *  `dest`, one after the other, and the background's map takes them from column `x` of row `y` on, in the palette
 *  given, up to the text's closing zero. Gives back how many bytes of tiles it copied. */
u32 sub_80031E8(void *dest, const void *font, u16 x, u16 y, u8 bg, const u8 *text, u8 palette) {
  u8 i = 0;
  u16 cnt = gBgCntRegs[bg];
  void *tiles = (void *)VRAM + ((cnt & 0xC) << 12);
  u16 *map = (void *)VRAM + ((cnt & 0x1F00) << 3);

  map = &map[y * 32] + x;

  for (; text[i] != 0; i++) {
    void *tile = dest + i * 32;

    CpuFastSet(font + text[i] * 32, tile, 8);
    // the tile's number among the background's, kept where the background's control was
    cnt = (u32)(tile - tiles) / 32;
    map[i] = cnt | (palette << 12);
  }
  return i * 32;
}

// The commands of an animation drawn into a background, each as the sprites' own (animation.c) but for the colours,
// which go to the backgrounds' palette.

/** animCmd_GetPalette_BG, 0x08003288: the command's colours go to the backgrounds' palette, unless the sprite keeps
 *  its own. */
s32 animCmd_GetPalette_BG(void *cursor, struct Sprite *s) {
  struct ACmd_GetPalette *cmd = cursor;

  s->animCursor += 3;
  if (!(s->frameFlags & SPRITE_FLAG_MASK_18)) {
    s32 paletteIndex = cmd->palId;

    DMA3_COPY32(&gRefSpriteTablesFull->palettes[paletteIndex * 16], &gBgPalette[s->palId * 16 + cmd->insertOffset], cmd->numColors * 2);
    gFlags |= FLAGS_UPDATE_BACKGROUND_PALETTES;
  }
  return 1;
}

/** animCmd_JumpBack_BG, 0x080032F4: the animation goes back as many words as the command says, and goes on. */
s32 animCmd_JumpBack_BG(void *cursor, struct Sprite *s) {
  struct ACmdJumpBack *cmd = cursor;

  s->animCursor -= cmd->offset;
  return 1;
}

/** animCmd_End_BG, 0x08003300: the animation is over. */
s32 animCmd_End_BG(void *cursor, struct Sprite *s) {
  s->frameFlags |= SPRITE_FLAG_ANIM_OVER;
  return 0;
}

/** animCmd_PlaySoundEffect_BG, 0x08003310: the command's sound starts. */
s32 animCmd_PlaySoundEffect_BG(void *cursor, struct Sprite *s) {
  struct ACmd_PlaySoundEffect *cmd = cursor;

  s->animCursor += 2;
  m4aSongNumStart(cmd->songId);
  return 1;
}

/** animCmd_TranslateSprite_BG, 0x08003324: the sprite moves by what the command says. */
s32 animCmd_TranslateSprite_BG(void *cursor, struct Sprite *s) {
  struct ACmd_TranslateSprite *cmd = cursor;

  s->animCursor += 2;
  s->x += cmd->x;
  s->y += cmd->y;
  return 1;
}

/** animCmd_8_BG, 0x08003340: a command of three words that does nothing here. */
s32 animCmd_8_BG(void *cursor, struct Sprite *s) {
  s->animCursor += 3;
  return 1;
}

/** animCmd_SetIdAndVariant_BG, 0x0800334C: the sprite takes the command's animation and variant, and starts it from
 *  its first command. */
s32 animCmd_SetIdAndVariant_BG(void *cursor, struct Sprite *s) {
  struct ACmd_SetIdAndVariant *cmd = cursor;

  s->animCursor += 2;
  s->graphics.anim = cmd->animId;
  s->prevVariant = 0xFF;
  s->variant = cmd->variant;
  return -1;
}

/** animCmd_10_BG, 0x0800336C: a command of four words that does nothing here. The original sets nothing to give
 *  back, so what it gives back is what it was given first, the command's address. */
s32 animCmd_10_BG(void *cursor, struct Sprite *s) {
  s->animCursor += 4;
  return (s32)cursor;
}

/** animCmd_11_BG, 0x08003374: a command of two words that does nothing here. */
s32 animCmd_11_BG(void *cursor, struct Sprite *s) {
  s->animCursor += 2;
  return 1;
}

/** animCmd_12_BG, 0x08003380: a command of two words that does nothing here. */
s32 animCmd_12_BG(void *cursor, struct Sprite *s) {
  s->animCursor += 2;
  return 1;
}
