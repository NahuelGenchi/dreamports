// Sprites as the engine runs them, as the JavaScript version's sprite.js has them: a sprite keeps its frame's number
// rather than its address, the frame's flips are in the top two bits of its OAM index, and its palette command copies
// every colour it names. The scripts and frames are the ROM's sprite tables, at 0x083314F0 (0x080003B8 loads the
// address).

#include "core.h"

#define TABLES 0x3314F0u
enum { ANIMATIONS = 0, DIMENSIONS = 1, OAM_DATA = 2, PALETTES = 3, TILES_4BPP = 4, TILES_8BPP = 5 };
enum { RUNNING = 1, ANIM_CHANGED = -1, ENDED = 0 };
#define ANIM_OVER 0x4000u
#define NO_TILES (1u << 19)
#define NEW_FRAME (1u << 26)

static const uint8_t OBJ_SIZES[12][2] = {
  {8, 8}, {16, 16}, {32, 32}, {64, 64}, {16, 8}, {32, 8}, {32, 16}, {64, 32}, {8, 16}, {8, 32}, {16, 32}, {32, 64},
};

static uint32_t table(int field) { return rom_ptr(TABLES + field * 4); }

void sprite_init(Sprite *s, uint32_t tiles, uint16_t anim, uint8_t variant, uint16_t oamFlags) {
  memset(s, 0, sizeof *s);
  s->tiles = tiles;
  s->anim = anim;
  s->variant = variant;
  s->prevAnim = 0xFFFF;
  s->prevVariant = 0xFF;
  s->frameNum = -1;
  s->animSpeed = 0x10;
  s->oamFlags = oamFlags;
}

// the animation commands, by their negative ids (animCmdTable)
static int command(Sprite *s, uint32_t at) {
  switch (rom_s32(at)) {
    case -1: {   // GetTiles
      s->animCursor += 3;
      int32_t index = rom_s32(at + 4);
      uint32_t count = rom_u32(at + 8);
      if (s->frameFlags & NO_TILES) return RUNNING;
      if (index < 0) queue_graphics(table(TILES_8BPP) + (uint32_t)(index * 64), s->tiles, (count * 64) & 0xFFFF);
      else queue_graphics(table(TILES_4BPP) + index * 32, s->tiles, (count * 32) & 0xFFFF);
      return RUNNING;
    }
    case -2: {   // GetPalette
      s->animCursor += 3;
      uint32_t from = table(PALETTES) + rom_s32(at + 4) * 32, count = rom_u16(at + 8), insert = rom_u16(at + 10);
      for (uint32_t i = 0; i < count; i++) c.objPalette[(s->palId * 16 + insert + i) & 0xFF] = rom_u16(from + i * 2);
      c.flags |= FLAGS_UPDATE_OBJ_PALETTES;
      return RUNNING;
    }
    case -3: s->animCursor = (uint16_t)(s->animCursor - rom_s32(at + 4)); return RUNNING;   // JumpBack
    case -4: s->frameFlags |= ANIM_OVER; return ENDED;                                     // End
    case -5: s->animCursor += 2; play_song(rom_u16(at + 4)); return RUNNING;               // PlaySoundEffect
    case -6: {                                                                             // AddHitbox
      s->animCursor += 3;
      Hitbox *box = &s->hitboxes[rom_u32(at + 4) & 15];
      int8_t l = (int8_t)rom_u8(at + 8), t = (int8_t)rom_u8(at + 9), r = (int8_t)rom_u8(at + 10), b = (int8_t)rom_u8(at + 11);
      *box = (Hitbox){ rom_s32(at + 4), l, t, r, b };
      if (l == r && t == b) box->index = -1;
      else {
        if (s->frameFlags & SPRITE_Y_FLIP) { box->top = (int8_t)-b; box->bottom = (int8_t)-t; }
        if (s->frameFlags & SPRITE_X_FLIP) { box->left = (int8_t)-r; box->right = (int8_t)-l; }
      }
      return RUNNING;
    }
    case -7:                                                                               // TranslateSprite
      s->animCursor += 2;
      s->x = (int16_t)(s->x + rom_s16(at + 4));
      s->y = (int16_t)(s->y + rom_s16(at + 6));
      return RUNNING;
    case -8: s->animCursor += 3; return RUNNING;
    case -9:                                                                               // SetIdAndVariant
      s->animCursor += 2;
      s->anim = (uint16_t)rom_u16(at + 4);
      s->prevVariant = 0xFF;
      s->variant = (uint8_t)rom_u16(at + 6);
      return ANIM_CHANGED;
    case -10: s->animCursor += 4; return (int)at;                                          // its own address ends the frame's commands
    case -11: s->animCursor += 2; s->frameFlags = (s->frameFlags & ~SPRITE_PRIORITY) | rom_u32(at + 4) << 12; return RUNNING;
    case -12: s->animCursor += 2; s->oamFlags = (uint16_t)(rom_u32(at + 4) << 6); return RUNNING;
    default: s->frameFlags |= ANIM_OVER; return ENDED;   // a command the game's screens never use so far
  }
}

static uint32_t script_of(const Sprite *s) { return rom_ptr(rom_ptr(table(ANIMATIONS) + s->anim * 4) + s->variant * 4); }

/** 0x080BF0C4, UpdateSpriteAnimation: 1 while the animation runs, 0 once it has ended. */
int update_sprite(Sprite *s) {
  if (s->prevVariant != s->variant || s->prevAnim != s->anim) {
    s->prevVariant = s->variant;
    s->prevAnim = s->anim;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->frameFlags &= ~ANIM_OVER;
  }
  if (s->frameFlags & ANIM_OVER) return ENDED;
  if (s->qAnimDelay > 0) {
    s->qAnimDelay = (int16_t)(s->qAnimDelay - s->animSpeed * 16);
    return RUNNING;
  }
  uint32_t script = script_of(s);
  for (uint32_t at = script + s->animCursor * 4; rom_s32(at) < 0; at = script + s->animCursor * 4) {
    int result = command(s, at);
    if (result == RUNNING) continue;
    if (result != ANIM_CHANGED) return result;
    script = script_of(s);
    s->animCursor = 0;
  }
  uint32_t at = script + s->animCursor * 4;
  s->qAnimDelay = (int16_t)(s->qAnimDelay + (rom_s32(at) << 8) - s->animSpeed * 0x10);
  s->frameNum = rom_s32(at + 4);
  s->frameFlags |= NEW_FRAME;
  s->animCursor += 2;
  return RUNNING;
}

static uint32_t dimensions_of(const Sprite *s) {
  uint32_t n = (uint32_t)s->frameNum;
  return rom_ptr(table(DIMENSIONS) + s->anim * 4) + (n >> 28 == 0 ? n * 12 : (n & 0xFFFFFFF) * 16);
}

/** 0x080BFFB4, DisplaySprite: the sprite's frame into OAM at (x, y), if any of it is on screen. */
void display_sprite(Sprite *s) {
  if (s->frameNum == -1) return;
  uint32_t d = dimensions_of(s), ff = s->frameFlags;
  uint32_t oamIndex = rom_u16(d), pieces = rom_u16(d + 2);
  int w = (int)rom_u16(d + 4), h = (int)rom_u16(d + 6), x = s->x, y = s->y;
  uint32_t attr0 = 0, attr1 = 0, yFlip = 0, xFlip = 0;
  if (ff & SPRITE_ROT_SCALE_ENABLE) {
    attr0 |= 0x100;
    attr1 |= (ff & SPRITE_ROT_SCALE) << 9;
    if (ff & SPRITE_DOUBLE_SIZE) {
      x -= w >> 1;
      y -= h >> 1;
      w *= 2;
      h *= 2;
      attr0 |= 0x200;
    }
  } else {
    y -= ff & SPRITE_Y_FLIP ? h - rom_s16(d + 10) : rom_s16(d + 10);
    x -= ff & SPRITE_X_FLIP ? w - rom_s16(d + 8) : rom_s16(d + 8);
    yFlip = ((ff >> 11) & 1) != (oamIndex >> 15);
    xFlip = ((ff >> 10) ^ (oamIndex >> 14)) & 1;
  }
  if (w != 0 && !(x + w >= 0 && x <= SCREEN_W && y + h >= 0 && y <= SCREEN_H)) return;
  attr0 |= (ff & SPRITE_OBJ_MODE) << 3;
  uint32_t attr2 = (ff & SPRITE_PRIORITY) >> 2 | (uint32_t)s->palId << 12;
  uint32_t oamData = rom_ptr(table(OAM_DATA) + s->anim * 4), order = (s->oamFlags & 0x7C0) >> 6;
  for (uint32_t i = 0; i < pieces; i++) {
    int k = alloc_oam(order);
    if (k < 0) return;
    if (i == 0) s->oamBaseIndex = k;
    uint32_t src = oamData + ((oamIndex & 0x3FFF) + i) * 6;
    uint32_t a0 = rom_u16(src), a1 = rom_u16(src + 2), a2 = rom_u16(src + 4);
    int sprX = (int)(a1 & 0x1FF), sprY = (int)(a0 & 0xFF);
    a1 &= 0xFE00;
    a0 &= 0xFE00;
    if (yFlip || xFlip) {
      const uint8_t *size = OBJ_SIZES[((a0 & 0xC000) >> 12) | ((a1 & 0xC000) >> 14)];
      if (yFlip) {
        a1 ^= 0x2000;
        sprY = h - size[1] - sprY;
      }
      if (xFlip) {
        a1 ^= 0x1000;
        sprX = w - size[0] - sprX;
      }
    }
    a0 = ((a0 + ((uint32_t)(y + sprY) & 0xFF)) & 0xFFFF) | attr0;
    a1 = ((a1 + ((uint32_t)(x + sprX) & 0x1FF)) & 0xFFFF) | attr1;
    a2 = (a2 | attr2) & 0xFFFF;
    if (a0 & 0x2000) a2 = (a2 + (a2 & 0x3FF)) & 0xFFFF;
    a2 = (a2 + ((s->tiles - OBJ_VRAM) >> 5)) & 0xFFFF;
    oam_malloc[k * 4] = (uint16_t)a0;
    oam_malloc[k * 4 + 1] = (uint16_t)a1;
    oam_malloc[k * 4 + 2] = (uint16_t)a2;
  }
  // a frame whose tiles are listed one by one (frameNum's top bits): those tiles, the first time it shows
  if ((uint32_t)s->frameNum >> 28 == 1 && (ff & NEW_FRAME)) {
    s->frameFlags &= ~NEW_FRAME;
    uint32_t word = rom_u32(d + 12), count = word >> 24;
    uint32_t list = rom_ptr(TABLES + 0x18) + (word & 0xFFFFFF) * 4;
    int32_t first = rom_s32(list);
    uint32_t size = first >= 0 ? 32 : 64, tiles = table(first >= 0 ? TILES_4BPP : TILES_8BPP);
    uint32_t from = tiles + (uint32_t)first * size, dest = s->tiles, total = size;
    list += 4;
    for (uint32_t i = 1; i < count; i++, list += 4) {
      uint32_t at = tiles + (uint32_t)rom_s32(list) * size;
      if (from + total == at) total += size;
      else {
        queue_graphics(from, dest, total);
        dest += total;
        total = size;
        from = at;
      }
    }
    queue_graphics(from, dest, total);
  }
}
