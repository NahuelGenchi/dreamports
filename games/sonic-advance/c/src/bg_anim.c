// Text written on a background, and the commands of an animation drawn into one.
#include "bg_anim.h"
#include "animation.h"
#include "core.h"
#include "screen.h"

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
