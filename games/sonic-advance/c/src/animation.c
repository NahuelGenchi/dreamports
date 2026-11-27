// A sprite's animation.
#include "animation.h"
#include "core.h"

// where a command is in its list, in words
#define ReadInstruction(script, cursor) ((void *)(script) + (cursor) * sizeof(s32))

/** UpdateSpriteAnimation, 0x080034CC: a sprite a frame on in its animation. A new animation or variant starts at its
 *  first command. When the frame shown has had its time, the commands up to the next frame run, each as the table
 *  says, and the next frame shows for its own time. Gives back 0 when the animation is over, and what a command that
 *  ended it gave. */
s32 UpdateSpriteAnimation(struct Sprite *s) {
  if (s->prevVariant != s->variant || s->prevAnim != s->graphics.anim) {
    s->graphics.size = 0;
    s->prevVariant = s->variant;
    s->prevAnim = s->graphics.anim;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->frameFlags &= ~SPRITE_FLAG_ANIM_OVER;
  }

  if (s->frameFlags & SPRITE_FLAG_ANIM_OVER) return 0;

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
      ret = CALL(gAnimCmdTable[~*cmd])((void *)cmd, s);
      if (ret != 1) {
#ifdef MATCHING
        register const s32 *newScript asm("r2");
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

/** 0x080035F4, animCmd_GetTiles: the frame's tiles, by the command's index, go on the list to copy to video memory,
 *  unless the sprite keeps its own. */
s32 animCmd_GetTiles(void *cursor, struct Sprite *s) {
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

/** 0x08004A84, animCmd_GetPalette: the command's colours go to the sprites' palette, unless the sprite keeps its own. */
s32 animCmd_GetPalette(void *cursor, struct Sprite *s) {
  struct ACmd_GetPalette *cmd = cursor;

  s->animCursor += 3;
  if (!(s->frameFlags & SPRITE_FLAG_MASK_18)) {
    s32 paletteIndex = cmd->palId;

    DMA3_COPY32(&gRefSpriteTablesFull->palettes[paletteIndex * 16], &gObjPalette[s->palId * 16 + cmd->insertOffset], cmd->numColors * 2);
    gFlags |= 0x2;
  }
  return 1;
}

/** The command that sets one of a sprite's hitboxes, flipped to match the sprite's flags, or clears it when all four
 *  bounds are zero. */
struct ACmd_Hitbox {
  /* 0x00 */ s32 cmdId;
  /* 0x04 */ struct Hitbox hitbox;
};

/** 0x08003660, animCmd_AddHitbox: copies the command's hitbox into the sprite, clears it if all four bounds are zero,
 *  and mirrors its vertical or horizontal bounds when the sprite is flipped. */
s32 animCmd_AddHitbox(void *cursor, struct Sprite *s) {
  struct ACmd_Hitbox *cmd = cursor;
  s32 index = cmd->hitbox.index & 0xF;

  s->animCursor += 3;
  DMA3_COPY32(&cmd->hitbox, &s->hitboxes[index], 8);

  if (cmd->hitbox.left == 0 && cmd->hitbox.top == 0 && cmd->hitbox.right == 0 && cmd->hitbox.bottom == 0) {
    s->hitboxes[index].index = -1;
  } else {
    if (s->frameFlags & 0x800) {
      s->hitboxes[index].top ^= s->hitboxes[index].bottom;
      s->hitboxes[index].bottom ^= s->hitboxes[index].top;
      s->hitboxes[index].top ^= s->hitboxes[index].bottom;
      s->hitboxes[index].top = -s->hitboxes[index].top;
      s->hitboxes[index].bottom = -s->hitboxes[index].bottom;
    }
    if (s->frameFlags & 0x400) {
      s->hitboxes[index].left ^= s->hitboxes[index].right;
      s->hitboxes[index].right ^= s->hitboxes[index].left;
      s->hitboxes[index].left ^= s->hitboxes[index].right;
      s->hitboxes[index].left = -s->hitboxes[index].left;
      s->hitboxes[index].right = -s->hitboxes[index].right;
    }
  }
  return 1;
}
