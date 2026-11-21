// What the engine draws: a sprite, and the list of commands that is its animation.
#ifndef SPRITE_H
#define SPRITE_H
#include "console.h"

#define SPRITE_FLAG_ANIM_OVER 0x4000

/** A sprite, as far as the twins written so far name it. */
struct Sprite {
  /* 0x00 */ u8 filler0[0x10];
  /* 0x10 */ u32 frameFlags;
  /* 0x14 */ u16 animCursor;   // where it is in its animation, in 32-bit words
};

/** The command that sends an animation back: how many words. */
struct ACmdJumpBack {
  /* 0x00 */ s32 id;
  /* 0x04 */ s32 offset;
};

s32 animCmd_JumpBack(void *cursor, struct Sprite *s);
s32 animCmd_End(void *cursor, struct Sprite *s);

#endif
