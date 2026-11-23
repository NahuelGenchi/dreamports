// What the engine draws: a sprite, and the list of commands that is its animation.
#ifndef SPRITE_H
#define SPRITE_H
#include "console.h"

#define SPRITE_FLAG_ANIM_OVER 0x4000

/** Tiles to copy to video memory. */
struct GraphicsData {
  /* 0x00 */ const void *src;
  /* 0x04 */ void *dest;
  /* 0x08 */ u16 size;
  /* 0x0A */ u16 anim;
};

/** A box a sprite hits or is hit with: none while index is -1. */
struct Hitbox {
  /* 0x00 */ s32 index;
  /* 0x04 */ s8 left, top, right, bottom;
};

/** A frame's size, where it's drawn from, and which of the sprites' list entries make it. */
struct SpriteDimensions {
  /* 0x00 */ u8 flip;
  /* 0x01 */ u8 oamIndex;
  /* 0x02 */ u16 numSubframes;
  /* 0x04 */ u16 width;
  /* 0x06 */ u16 height;
  /* 0x08 */ s16 offsetX;
  /* 0x0A */ s16 offsetY;
};

/** A sprite: its tiles, its animation and where it is on the screen. */
struct Sprite {
  /* 0x00 */ struct GraphicsData graphics;
  /* 0x0C */ const struct SpriteDimensions *dimensions;   // its frame's, or -1 for none
  /* 0x10 */ u32 frameFlags;
  /* 0x14 */ u16 animCursor;   // where it is in its animation, in 32-bit words
  /* 0x16 */ s16 x;
  /* 0x18 */ s16 y;
  /* 0x1A */ u16 oamFlags;
  /* 0x1C */ s16 qAnimDelay;
  /* 0x1E */ u16 prevAnim;
  /* 0x20 */ u8 variant;
  /* 0x21 */ u8 prevVariant;
  /* 0x22 */ u8 animSpeed;
  /* 0x23 */ u8 oamBaseIndex;
  /* 0x24 */ u8 numSubFrames;
  /* 0x25 */ u8 palId;
  /* 0x28 */ struct Hitbox hitboxes[1];
};

#define SPRITE_ANIM_SPEED_1 0x10
#define SPRITE_OAM_ORDER(index) ((index) << 6)
#define SPRITE_PRIORITY(priority) ((priority) << 12)

s32 UpdateSpriteAnimation(struct Sprite *s);
void DisplaySprite(struct Sprite *s);
void *VramMalloc(u32 numTiles);

/** The command that sends an animation back: how many words. */
struct ACmdJumpBack {
  /* 0x00 */ s32 id;
  /* 0x04 */ s32 offset;
};

s32 animCmd_JumpBack(void *cursor, struct Sprite *s);
s32 animCmd_End(void *cursor, struct Sprite *s);

#endif
