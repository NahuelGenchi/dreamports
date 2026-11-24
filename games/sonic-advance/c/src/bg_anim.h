// Text written on a background, and the commands of an animation drawn into one.
#ifndef BG_ANIM_H
#define BG_ANIM_H
#include "sprite.h"

/** The command that starts a sound: which. */
struct ACmd_PlaySoundEffect {
  /* 0x00 */ s32 cmdId;
  /* 0x04 */ u16 songId;
};

/** The command that moves a sprite: how far across and down. */
struct ACmd_TranslateSprite {
  /* 0x00 */ s32 cmdId;
  /* 0x04 */ u16 x;
  /* 0x06 */ u16 y;
};

/** The command that gives a sprite another animation: which, and which of its variants. */
struct ACmd_SetIdAndVariant {
  /* 0x00 */ s32 cmdId;
  /* 0x04 */ u16 animId;
  /* 0x06 */ u16 variant;
};

u32 sub_80031E8(void *dest, const void *font, u16 x, u16 y, u8 bg, const u8 *text, u8 palette);

s32 animCmd_GetPalette_BG(void *cursor, struct Sprite *s);
s32 animCmd_JumpBack_BG(void *cursor, struct Sprite *s);
s32 animCmd_End_BG(void *cursor, struct Sprite *s);
s32 animCmd_PlaySoundEffect_BG(void *cursor, struct Sprite *s);
s32 animCmd_TranslateSprite_BG(void *cursor, struct Sprite *s);
s32 animCmd_8_BG(void *cursor, struct Sprite *s);
s32 animCmd_SetIdAndVariant_BG(void *cursor, struct Sprite *s);
s32 animCmd_10_BG(void *cursor, struct Sprite *s);
s32 animCmd_11_BG(void *cursor, struct Sprite *s);
s32 animCmd_12_BG(void *cursor, struct Sprite *s);

#endif
