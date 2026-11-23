// A sprite's animation: the game's tables of sprites, and the commands an animation is a list of.
#ifndef ANIMATION_H
#define ANIMATION_H
#include "sprite.h"

#define SPRITE_FLAG_MASK_18 0x40000
#define SPRITE_FLAG_MASK_19 0x80000

/** What the game's sprites are made of: each animation's variants' commands, each frame's size, its sprites' tiles
 *  and colours. */
struct SpriteTables {
  /* 0x00 */ const s32 *const *const *animations;
  /* 0x04 */ const u8 (*const *dimensions)[12];
  /* 0x08 */ const u16 *const *oamData;
  /* 0x0C */ const u16 *palettes;
  /* 0x10 */ const u8 *tiles_4bpp;
  /* 0x14 */ const u8 *tiles_8bpp;
};

/** The command that loads tiles: which, and how many. */
struct ACmd_GetTiles {
  /* 0x00 */ s32 cmdId;
  /* 0x04 */ s32 tileIndex;
  /* 0x08 */ s32 numTilesToCopy;
};

/** The command that loads colours: which, how many, and where in the sprite's palette. */
struct ACmd_GetPalette {
  /* 0x00 */ s32 cmdId;
  /* 0x04 */ s32 palId;
  /* 0x08 */ u16 numColors;
  /* 0x0A */ u16 insertOffset;
};

/** A frame shown: for how long, and which. */
struct ACmd_ShowFrame {
  /* 0x00 */ s32 delay;
  /* 0x04 */ s32 index;
};

typedef s32 (*AnimationCommandFunc)(void *cursor, struct Sprite *s);

extern const struct SpriteTables *gRefSpriteTablesFull;
/** The commands, by their number: -1 is the first. */
extern const AnimationCommandFunc gAnimCmdTable[12];

s32 animCmd_GetTiles(void *cursor, struct Sprite *s);
s32 animCmd_GetPalette(void *cursor, struct Sprite *s);

#endif
