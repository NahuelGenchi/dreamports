// Sprites and their animations.
#include "sprite.h"

/** animCmd_JumpBack, 0x08004AF0: the animation goes back as many words as the command says, and goes on. */
s32 animCmd_JumpBack(void *cursor, struct Sprite *s) {
  struct ACmdJumpBack *cmd = cursor;

  s->animCursor -= cmd->offset;
  return 1;
}

/** animCmd_End, 0x08004AFC: the animation is over. */
s32 animCmd_End(void *cursor, struct Sprite *s) {
  s->frameFlags |= SPRITE_FLAG_ANIM_OVER;
  return 0;
}
