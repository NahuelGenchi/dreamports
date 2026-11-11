// Sprites as the engine runs them, translated from gba/sprite.js (SAT-R's src/sprite.c: UpdateSpriteAnimation,
// DisplaySprite): a sprite steps through its animation script, which queues its tiles for VRAM and loads its colours,
// and each frame it is shown puts its frame's OAM pieces into the engine's OAM, flipped, placed and given its tiles,
// palette, priority and order. The scripts and frames are the ROM's sprite tables.

#include "sa.h"

static const uint8_t OBJ_SIZES[16][2] = {
  {8, 8}, {16, 16}, {32, 32}, {64, 64}, {16, 8}, {32, 8}, {32, 16}, {64, 32}, {8, 16}, {8, 32}, {16, 32}, {32, 64},
  {8, 8}, {8, 8}, {8, 8}, {8, 8},
};
enum { RUNNING = 1, ANIM_CHANGED = -1, ENDED = 0 };

SpriteTables sprites;

void sprite_init(Sprite *s) {
  memset(s, 0, sizeof *s);
  s->graphics.dest = OBJ_VRAM;
  s->dimensions = NO_FRAME;
  s->prevAnim = 0xFFFF;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->hitboxes[0].index = -1;
}

// the animation commands, by their negative ids
static int command(Sprite *s, uint32_t at, int background) {
  int32_t id = rom_s32(at);
  switch (id) {
    case -1: {   // GetTiles
      s->animCursor += 3;
      if (!(s->frameFlags & SPRITE_KEEP_TILES)) {
        int32_t index = rom_s32(at + 4);
        uint32_t count = rom_u32(at + 8);
        if (index < 0) {
          // the tiles before the table's, past every byte of the copy as the JavaScript version reads them
          uint64_t src = (uint64_t)sprites.tiles8 + (uint32_t)(index * 64);
          s->graphics.src = src > 0xFFFFFFFFu ? 0xFFFFFFFFu : (uint32_t)src;
          s->graphics.size = (count * 64) & 0xFFFF;
        } else { s->graphics.src = sprites.tiles4 + index * 32; s->graphics.size = (count * 32) & 0xFFFF; }
        queue_graphics(&s->graphics);
      }
      return RUNNING;
    }
    case -2: {   // GetPalette: a 32-bit copy, so an odd colour count leaves its last colour out
      s->animCursor += 3;
      if (!(s->frameFlags & SPRITE_KEEP_PALETTE)) {
        uint32_t pal = sprites.palettes + rom_s32(at + 4) * 32, count = rom_u16(at + 8), insert = rom_u16(at + 10);
        uint32_t n = (count * 2) >> 2 << 1;
        uint16_t *colours = background ? e.bgPalette : e.objPalette;
        for (uint32_t i = 0; i < n; i++) {
          uint32_t colour = (s->palId * 16 + insert + i) & 0xFF;
          colours[colour] = (uint16_t)rom_u16(pal + i * 2);
          // a script's colours go over the spotlights' run-over ones, which only show until it loads them again
          if (!background && colour < 16) { spriteRow.written &= ~(1u << colour); spriteRow.loaded |= 1u << colour; }
        }
        e.flags |= background ? 0x1 : 0x2;
      }
      return RUNNING;
    }
    case -3: s->animCursor = (uint16_t)(s->animCursor - rom_s32(at + 4)); return RUNNING;   // JumpBack
    case -4: s->frameFlags |= SPRITE_ANIM_OVER; return ENDED;                               // End
    case -5: s->animCursor += 2; play_song((int)rom_u16(at + 4)); return RUNNING;           // PlaySoundEffect
    case -6: {   // AddHitbox: none if it is all 0, else turned with the sprite
      s->animCursor += 3;
      Hitbox b = { rom_s32(at + 4), s8(rom_u8(at + 8)), s8(rom_u8(at + 9)), s8(rom_u8(at + 10)), s8(rom_u8(at + 11)) };
      if (!b.left && !b.top && !b.right && !b.bottom) b.index = -1;
      else {
        if (s->frameFlags & SPRITE_Y_FLIP) { int8_t t = b.top; b.top = s8(-b.bottom); b.bottom = s8(-t); }
        if (s->frameFlags & SPRITE_X_FLIP) { int8_t l = b.left; b.left = s8(-b.right); b.right = s8(-l); }
      }
      s->hitboxes[rom_u32(at + 4) & 0xF] = b;
      return RUNNING;
    }
    case -7: s->animCursor += 2; s->x = s16(s->x + rom_s16(at + 4)); s->y = s16(s->y + rom_s16(at + 6)); return RUNNING;
    case -8: s->animCursor += 3; return RUNNING;
    case -9:     // SetIdAndVariant
      s->animCursor += 2;
      s->graphics.anim = (uint16_t)rom_u16(at + 4); s->prevVariant = 0xFF; s->variant = (uint8_t)rom_u16(at + 6);
      return ANIM_CHANGED;
    case -10: s->animCursor += 4; return (int)at;   // returns its own address, which ends the frame's commands
    case -11: s->animCursor += 2; s->frameFlags = (s->frameFlags & ~SPRITE_PRIORITY) | (rom_u32(at + 4) << 12); return RUNNING;
    case -12: s->animCursor += 2; s->oamFlags = (uint16_t)(rom_u32(at + 4) << 6); return RUNNING;
    default: s->frameFlags |= SPRITE_ANIM_OVER; return ENDED;   // not an animation command
  }
}

static uint32_t script_of(const Sprite *s) {
  return rom_ptr(rom_ptr(sprites.anims + s->graphics.anim * 4) + s->variant * 4);
}

/** UpdateSpriteAnimation: 1 while the animation runs, 0 once it has ended. With `background`,
 *  UpdateSpriteAnimation_BG instead, which the palette animations run on: an ended animation stays ended even if it
 *  is changed, and its colours load into the backgrounds' palette. */
int update_sprite(Sprite *s, int background) {
  if (background && s->frameFlags & SPRITE_ANIM_OVER) return ENDED;
  if (s->prevVariant != s->variant || s->prevAnim != s->graphics.anim) {
    s->graphics.size = 0;
    s->prevVariant = s->variant;
    s->prevAnim = s->graphics.anim;
    s->animCursor = 0;
    s->qAnimDelay = 0;
    s->frameFlags &= ~SPRITE_ANIM_OVER;
  }
  if (s->frameFlags & SPRITE_ANIM_OVER) return ENDED;
  if (s->qAnimDelay > 0) {
    s->qAnimDelay = s16(s->qAnimDelay - s->animSpeed * 16);
    return RUNNING;
  }
  uint32_t script = script_of(s);
  for (uint32_t at = script + s->animCursor * 4; rom_s32(at) < 0; at = script + s->animCursor * 4) {
    int result = command(s, at, background);
    if (result == RUNNING) continue;
    if (result != ANIM_CHANGED) return result;
    script = script_of(s);
    s->animCursor = 0;
  }
  uint32_t at = script + s->animCursor * 4;
  s->qAnimDelay = s16(s->qAnimDelay + (rom_s32(at) << 8) - s->animSpeed * 0x10);
  int32_t frame = rom_s32(at + 4);
  s->dimensions = frame == -1 ? NO_FRAME : rom_ptr(sprites.dims + s->graphics.anim * 4) + frame * 12;
  s->animCursor = (uint16_t)(s->animCursor + 2);
  return RUNNING;
}

static int16_t reciprocal(int16_t scale) { return scale ? s16(0x10000 / scale) : 0; }

/**
 * TransformSprite's rotation matrix: `tf` (rotation 0–1023 a turn, qScaleX, qScaleY in 8.8) into the sprite's
 * affine parameters (its frameFlags' ROT_SCALE) in the OAM buffer.
 */
void rotate_sprite(Sprite *s, const Transform *tf) {
  int angle = tf->rotation & 1023, cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  int index = s->frameFlags & SPRITE_ROT_SCALE;
  int rx = reciprocal(tf->qScaleX), ry = reciprocal(tf->qScaleY);
  e.oamBuffer[(index * 4 + 0) * 4 + 3] = (uint16_t)((cos * rx) >> 8);
  e.oamBuffer[(index * 4 + 1) * 4 + 3] = (uint16_t)((sin * rx) >> 8);
  e.oamBuffer[(index * 4 + 2) * 4 + 3] = (uint16_t)((-sin * ry) >> 8);
  e.oamBuffer[(index * 4 + 3) * 4 + 3] = (uint16_t)((cos * ry) >> 8);
}

/**
 * TransformSprite: `tf` as the sprite's rotation matrix, and the sprite placed so that its frame's anchor stays at
 * (x, y) once turned and scaled. It reads the frame the sprite last showed; without one it does nothing.
 */
void transform_sprite(Sprite *s, const Transform *tf) {
  if (s->dimensions == NO_FRAME) return;
  rotate_sprite(s, tf);
  uint32_t d = s->dimensions;
  int w = rom_u16(d + 4), h = rom_u16(d + 6), offsetX = rom_s16(d + 8), offsetY = rom_s16(d + 10);
  int angle = tf->rotation & 1023, cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  int kx = tf->qScaleX < 0 ? -tf->qScaleX : tf->qScaleX, ky = tf->qScaleY < 0 ? -tf->qScaleY : tf->qScaleY;
  int u0 = s16((cos * kx) >> 8), u1 = s16((-sin * kx) >> 8), u2 = s16((sin * ky) >> 8), u3 = s16((cos * ky) >> 8);
  int ax = (tf->qScaleX > 0 ? offsetX : w - offsetX) - (w >> 1), ay = (tf->qScaleY > 0 ? offsetY : h - offsetY) - (h >> 1);
  s->x = s16(tf->x - ((u0 * ax + u1 * ay + ((w >> 1) << 8)) >> 8));
  s->y = s16(tf->y - ((u2 * ax + u3 * ay + ((h >> 1) << 8)) >> 8));
}

/** DisplaySprite: the sprite's frame into OAM at (x, y), if any of it is on screen. */
void display_sprite(Sprite *s) {
  if (s->dimensions == NO_FRAME) return;
  uint32_t d = s->dimensions;
  uint32_t flip = rom_u8(d), oamIndex = rom_u8(d + 1), pieces = rom_u16(d + 2);
  int w = rom_u16(d + 4), h = rom_u16(d + 6);
  int offsetX = rom_s16(d + 8), offsetY = rom_s16(d + 10);
  s->numSubFrames = (uint8_t)pieces;
  int x = s->x, y = s->y;
  uint32_t ff = s->frameFlags;
  if (ff & SPRITE_ROT_SCALE_ENABLE) {
    if (ff & SPRITE_DOUBLE_SIZE) { x -= w >> 1; y -= h >> 1; w *= 2; h *= 2; }
  } else {
    y -= ff & SPRITE_Y_FLIP ? h - offsetY : offsetY;
    x -= ff & SPRITE_X_FLIP ? w - offsetX : offsetX;
  }
  int shown = x + w >= 0 && x <= 240 && y + h >= 0 && y <= 160;
  uint32_t oamData = rom_ptr(sprites.oam + s->graphics.anim * 4), order = (s->oamFlags & 0x7C0) >> 6;
  for (uint32_t i = 0; i < pieces; i++) {
    uint32_t src = oamData + ((oamIndex & 0x3FFF) + i) * 6;
    uint32_t a0 = rom_u16(src), a1 = rom_u16(src + 2), a2 = rom_u16(src + 4);
    int sprX = a1 & 0x1FF, sprY = a0 & 0xFF;
    a1 &= 0xFE00; a0 &= 0xFE00;
    a2 = (a2 + ((uint32_t)s->palId << 12)) & 0xFFFF;
    if (ff & SPRITE_ROT_SCALE_ENABLE) {
      a0 |= 0x100;
      if (ff & SPRITE_DOUBLE_SIZE) a0 |= 0x200;
      a1 |= (ff & SPRITE_ROT_SCALE) << 9;
    } else {
      const uint8_t *size = OBJ_SIZES[((a0 & 0xC000) >> 12) | ((a1 & 0xC000) >> 14)];
      if ((((flip >> 1) ^ (ff >> 11)) & 1) != 0) { a1 ^= 0x2000; sprY = h - size[1] - sprY; }
      if (((ff >> 10) & 1) != (flip & 1)) { a1 ^= 0x1000; sprX = w - size[0] - sprX; }
    }
    a0 |= (ff & SPRITE_OBJ_MODE) * 8;
    a2 |= (ff & SPRITE_PRIORITY) >> 2;
    a0 = (a0 + ((y + sprY) & 0xFF)) & 0xFFFF;
    a1 = (a1 + ((x + sprX) & 0x1FF)) & 0xFFFF;
    if (a0 & 0x2000) a2 = (a2 + (a2 & 0x3FF)) & 0xFFFF;
    a2 = (a2 + (uint32_t)((int32_t)(s->graphics.dest - OBJ_VRAM) >> 5)) & 0xFFFF;
    if (!shown) continue;
    int k = alloc_oam(order);
    if (k < 0) { shown = 0; continue; }
    if (i == 0) s->oamBaseIndex = (uint8_t)(e.oamFreeIndex - 1);
    e.oamMalloc[k * 4] = (uint16_t)a0; e.oamMalloc[k * 4 + 1] = (uint16_t)a1; e.oamMalloc[k * 4 + 2] = (uint16_t)a2;
  }
}

/**
 * DisplaySprite_BG: the sprite as a layer's map instead of OAM, on the layer its frameFlags name, scrolled so that the
 * frame's anchor is at (x, y). In the V-blank (sub_80039E4), each piece of its frame becomes a rectangle of map
 * entries; only a text layer and a frame that isn't flipped are ported, which is all the character select's backdrop
 * needs.
 */
void display_sprite_background(Sprite *s) {
  queue_sprite_map(s);
  if (s->dimensions == NO_FRAME) return;
  int bg = (s->frameFlags >> 15) & 3;
  uint32_t d = s->dimensions;
  e.bgScroll[bg * 2] = (uint16_t)((rom_s16(d + 8) - s->x) % 16);
  e.bgScroll[bg * 2 + 1] = (uint16_t)((rom_s16(d + 10) - s->y) % 8);
}

// sub_80039E4: the frame's pieces, a text layer's map entries each, the tiles laid out as OAM's are
void write_sprite_map(Sprite *s) {
  if (s->dimensions == NO_FRAME) return;
  uint32_t d = s->dimensions, bg = (s->frameFlags >> 15) & 3, cnt = e.bgCnt[bg];
  if ((rom_u8(d) & 3) || s->frameFlags & (SPRITE_X_FLIP | SPRITE_Y_FLIP) || cnt & 0x80) return;   // not ported
  uint32_t base = ((cnt & 0x1F00) << 3) >> 1;
  int first = (int)(s->graphics.dest - ((cnt >> 2) & 3) * 0x4000) >> 5;
  uint32_t oamData = rom_ptr(sprites.oam + s->graphics.anim * 4);
  int left = (s->x - rom_s16(d + 8)) & ~0xF, top = s->y - rom_s16(d + 10);
  for (uint32_t i = 0; i < rom_u16(d + 2); i++) {
    uint32_t src = oamData + (rom_u8(d + 1) + i) * 6, a0 = rom_u16(src), a1 = rom_u16(src + 2), a2 = rom_u16(src + 4);
    const uint8_t *size = OBJ_SIZES[((a0 & 0xC000) >> 12) | ((a1 & 0xC000) >> 14)];
    int column = ((int)(a1 & 0x1FF) + left) >> 3, row = ((int)(a0 & 0xFF) + top) >> 3;
    uint32_t palette = ((a2 >> 12) + s->palId) << 12;
    int tile = (int)(a2 & 0x3FF) + first;
    for (int y = 0; y < size[1] >> 3; y++) {
      for (int x = 0; x < size[0] >> 3; x++) {
        uint32_t at = (base + ((row + y) & 31) * 32 + ((column + x) & 31)) * 2;
        uint16_t v = (uint16_t)(palette | (uint32_t)tile++);
        if (at + 1 < 0x18000) { gba_vram[at] = (uint8_t)v; gba_vram[at + 1] = (uint8_t)(v >> 8); }
      }
    }
  }
}
