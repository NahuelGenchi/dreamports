// How the special stage shows its sprites, translated from special/sprites.js (SAT-R's
// src/game/sa1/special_stage/main.c): every one is scaled by its depth through an affine matrix of OAM, and sprites at
// the same depth share a matrix, of the 16 the stage hands out each frame from the depths it meets (matrix 0 is the
// character's). Sprites of an animation another sprite already loads keep that one's tiles and colours instead of
// loading their own.

#include "special.h"

#define KEEP_GRAPHICS (SPRITE_KEEP_PALETTE | SPRITE_KEEP_TILES)
// the one animation that always loads its own graphics: the bumper's
#define BUMPER_ANIM 797
#define BUMPER_VARIANT 0

/** sub_802D58C: the matrix for sprites `depth` lines ahead, 1 to 16, or 17 once 16 depths are taken. */
int sp_depth_matrix(int depth) {
  int i = 0;
  for (; i < 16; i++) {
    if (sp.depths[i] == SP_NO_DEPTH) { sp.depths[i] = (int16_t)depth; break; }
    if (sp.depths[i] == depth) break;
  }
  return (i + 1) & 0xFF;
}

/** The matrix `index` scaling by (scaleX, scaleY) in 8.8, unless it is set this frame already. */
void sp_set_matrix(int index, int scaleX, int scaleY) {
  if (sp.matrices[index] != 0) return;
  sp.matrices[index] = -1;
  int at = index * 16 + 3;
  e.oamBuffer[at] = (uint16_t)sp_div(0x10000, scaleX);
  e.oamBuffer[at + 4] = 0;
  e.oamBuffer[at + 8] = 0;
  e.oamBuffer[at + 12] = (uint16_t)sp_div(0x10000, scaleY);
}

/** sub_802BE0C: sets the sprite's matrix, and places the sprite so that its frame is scaled around its middle at the
 *  transform's (x, y). */
void sp_transform(Sprite *s, const SpTransform *tf) {
  uint32_t d = s->dimensions;
  if (d == NO_FRAME) return;
  sp_set_matrix(s->frameFlags & 0x1F, tf->scaleX, tf->scaleY);
  int halfW = (int)rom_u16(d + 4) >> 1, halfH = (int)rom_u16(d + 6) >> 1;
  s->x = s16(tf->x - ((tf->scaleX * (rom_s16(d + 8) - halfW) + (halfW << 8)) >> 8));
  s->y = s16(tf->y - ((tf->scaleY * (rom_s16(d + 10) - halfH) + (halfH << 8)) >> 8));
}

/** sub_802B5DC: the first sprite of an animation and variant since the list was last emptied takes its place in it; the
 *  others keep the graphics that one loads, from then on. */
void sp_share_graphics(Sprite *s) {
  uint16_t anim = s->graphics.anim, variant = s->variant;
  if (anim == BUMPER_ANIM && variant == BUMPER_VARIANT) return;
  for (int i = 0; i < 16; i++) {
    if (sp.loaded[i * 2] == anim && sp.loaded[i * 2 + 1] == variant) { s->frameFlags |= KEEP_GRAPHICS; return; }
  }
  for (int i = 0; i < 16; i++) {
    if (sp.loaded[i * 2] == 0 && sp.loaded[i * 2 + 1] == 0) { sp.loaded[i * 2] = anim; sp.loaded[i * 2 + 1] = variant; return; }
  }
}

/** sub_802D560: empties the list of animations being loaded. */
void sp_clear_shared(void) { memset(sp.loaded, 0, 32 * sizeof *sp.loaded); }

/** A sprite's hitbox as a box. */
SpBox sp_box(const Hitbox *h) { return (SpBox){ h->left, h->top, h->right, h->bottom }; }

/** HB_COLLISION: whether box `a` at (ax, ay) and box `b` at (bx, by) touch. */
int sp_touches(int ax, int ay, SpBox a, int bx, int by, SpBox b) {
  int al = ax + a.left, bl = bx + b.left, at = ay + a.top, bt = by + b.top;
  int x = (al <= bl && al + (a.right - a.left) >= bl) || (al >= bl && bl + (b.right - b.left) >= al);
  int y = (at <= bt && at + (a.bottom - a.top) >= bt) || (at >= bt && bt + (b.bottom - b.top) >= at);
  return x && y;
}
