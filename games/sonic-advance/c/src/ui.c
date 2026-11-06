// What Sonic Advance's screens share for their pictures, their lines of text and their fades, translated from
// front/ui.js (SAT-R's src/game/sa1/stage/ui_rendering.c and stage_ui.c). A screen loads a picture's tiles and map
// into a layer, or a set of sprite glyphs into sprite VRAM, and its colours, through a stack of 16 graphics-queue
// entries kept in a task of its own; it starts the stack over before each set of loads. The task also keeps the slots,
// one per set of glyphs, saying where a set's first tile is and how its glyphs are laid out; a line of text is a row
// of sprites, one per glyph of a slot. The fades darken or brighten the screen through the blend registers, inside a
// window that covers all of it.

#include "sa.h"

#define UI_TASK_PRIORITY 0x1800
#define UI_GFX_SLOTS 16
#define UI_GLYPH_SLOTS 30
#define GLYPH_BASE 0x20   // a glyph's character code: glyph 0 is ' ', glyph 1 '!' and so on
#define UI_ENTRY 28

typedef struct UiGfxEntry { struct UiGfxEntry *next; Graphics graphics; } UiGfxEntry;
static struct { UiGfxEntry *first; UiGfxEntry gfx[UI_GFX_SLOTS]; UiSlot slots[UI_GLYPH_SLOTS]; } ui;

static void ui_task(Task *t) { (void)t; }
static void ui_task_destroyed(Task *t) { (void)t; e.uiTask = NULL; }

/**
 * sub_80535FC: the task holding the stack and the slots, unless there is one. The original never sets the slots when
 * it makes the task, so they hold whatever its memory held: 0 for the screens before the act.
 */
void create_ui_task(void) {
  if (e.uiTask) return;
  memset(&ui, 0, sizeof ui);
  e.uiTask = create_task(ui_task, &ui, UI_TASK_PRIORITY, 0, ui_task_destroyed);
  ui_gfx_stack_init();
}

/** UiGfxStackInit: the stack from its first entry again; the last entry's link is never set. */
void ui_gfx_stack_init(void) {
  for (int i = 0; i < UI_GFX_SLOTS - 1; i++) ui.gfx[i].next = &ui.gfx[i + 1];
  ui.first = &ui.gfx[0];
}

static Graphics *ui_gfx_stack_pop(void) {
  UiGfxEntry *cur = ui.first;
  if (!cur) return NULL;
  ui.first = cur->next;
  return &cur->graphics;
}

UiSlot *ui_slots(void) { return ui.slots; }

/**
 * Entry `id` of the UI graphics table (gUiGraphics): its tiles and colours (ROM offsets), and in `layout` how its
 * glyphs are laid out, as sub_80528AC copies it into a slot.
 */
void ui_graphics(int id, uint32_t *tiles, uint32_t *palette, UiSlot *layout) {
  uint32_t at = OFFSET_UI_GRAPHICS + id * UI_ENTRY;
  *tiles = rom_ptr(at);
  *palette = rom_ptr(at + 4);
  layout->unk4 = rom_s32(at + 8);
  layout->unk8 = (uint8_t)rom_u32(at + 12);
  layout->unk9 = (uint8_t)rom_u32(at + 16);
  layout->unkA = (uint8_t)rom_u32(at + 20);
  layout->unkB = (uint8_t)rom_u32(at + 24);
}

static void queue(uint32_t src, uint32_t dest, uint32_t size) {
  Graphics *g = ui_gfx_stack_pop();
  if (!g) return;
  g->src = src; g->dest = dest; g->size = size & 0xFFFF; g->ram = NULL;
  queue_graphics(g);
}

/**
 * sub_80528AC: loads `gfx`'s tiles, map and colours, as unk2A says (1 the tiles, 0x10 the map, 4 the colours, and 8
 * for sprites). Every load with a slot sets its layout. Sprite tiles go to vramC and the colours to the sprites'
 * palette, and the slot's first tile becomes vramC's. A layer's tiles go to its character block, a tile in unless
 * uiGfxID has 0x80, and its map to its screen block.
 */
void load_ui_gfx(const UiGfx *gfx) {
  UiSlot *slot = gfx->unk2B < 0 ? NULL : &ui.slots[gfx->unk2B];
  if (slot && gfx->layout) {
    slot->unk4 = gfx->layout->unk4; slot->unk8 = gfx->layout->unk8; slot->unk9 = gfx->layout->unk9;
    slot->unkA = gfx->layout->unkA; slot->unkB = gfx->layout->unkB;
  }
#define COLOUR(i) (gfx->colours ? gfx->colours[i] : (uint16_t)rom_u16(gfx->palette + (i) * 2))
  if (gfx->unk2A & 0x8) {
    if (gfx->unk2A & 0x1) queue(gfx->tiles, gfx->vramC, gfx->tilesSize);
    if (gfx->unk2A & 0x4) {
      for (uint32_t i = 0; i < gfx->paletteSize >> 1; i++) e.objPalette[(gfx->unk28 * 16 + i) & 0xFF] = COLOUR(i);
      e.flags |= 0x2;
    }
    if (slot) slot->unk0 = (gfx->vramC - OBJ_VRAM) >> 5;
    return;
  }
  uint32_t cnt = e.bgCnt[gfx->unk29];
  uint32_t vram = ((cnt >> 2) & 3) * 0x4000 + (gfx->uiGfxID & 0x80 ? 0 : 32);
  uint32_t layout = (cnt & 0x1F00) << 3;
  if (gfx->unk2A & 0x1) queue(gfx->tiles, vram, gfx->tilesSize);
  if (gfx->unk2A & 0x10) queue(gfx->layout_, layout, gfx->layoutSize);
  if (gfx->unk2A & 0x4) {
    for (uint32_t i = 0; i < gfx->paletteSize >> 1; i++) e.bgPalette[(gfx->unk28 * 16 + i) & 0xFF] = COLOUR(i);
    e.flags |= 0x1;
  }
#undef COLOUR
}

// a character of a line of text, 0 past its end as after a C string's last character
static uint32_t text_at(const char *text, int i) {
  for (int k = 0; k < i; k++) if (!text[k]) return 0;
  return (uint8_t)text[i];
}

// one sprite of a line of text into OAM at `order`; false once OAM is full
static int put_glyph(uint32_t order, uint32_t a0, uint32_t a1, uint32_t a2) {
  int k = alloc_oam(order);
  if (k < 0) return 0;
  e.oamMalloc[k * 4] = (uint16_t)a0; e.oamMalloc[k * 4 + 1] = (uint16_t)a1; e.oamMalloc[k * 4 + 2] = (uint16_t)a2;
  return 1;
}

/**
 * sub_8052F78 (semi-transparent sprites) and, with `solid`, sub_80530CC: `o->unkE` glyphs of `text` from slot
 * `o->unk10`, side by side from (o->unkA, o->unkC), in palette `o->unk12` at OAM order `o->unk8 >> 3`.
 */
void draw_ui_text(const char *text, const UiText *o, int solid) {
  if (!o->unk16) return;   // rows of text (unk16 = 0) aren't ported
  const UiSlot *slot = &ui.slots[o->unk10];
  uint32_t step = slot->unkA * 8, order = (o->unk8 >> 3) & 0xFF;
  uint32_t a0 = (slot->unk9 << 14) + (o->unkC & 0xFF) + (solid ? 0 : 0x400);
  uint32_t a1 = (slot->unk8 << 14) + (o->unkA & 0x1FF);
  uint32_t a2 = ((uint32_t)o->unk12 << 12) | (slot->unk0 & 0x3FF);
  for (int i = 0; i < s16(o->unkE); i++) {
    uint32_t c = (a2 + (text_at(text, i) - GLYPH_BASE) * slot->unk4) & 0xFFFF;
    if (!put_glyph(order, a0, a1, c)) break;
    a1 = (a1 + step) & 0xFFFF;
  }
}

/**
 * sub_805321C and, with `behind`, sub_805345C: as sub_80530CC, but each glyph i goes to OAM order (o->unk8 + i) >> 3,
 * and sub_805345C's are in priority 2, behind layers of priority 0 to 2.
 */
void draw_ui_glyphs(const char *text, const UiText *o, int behind) {
  if (!o->unk16 && !behind) return;   // rows of text (unk16 = 0) aren't ported
  const UiSlot *slot = &ui.slots[o->unk10];
  uint32_t step = slot->unkA * 8;
  uint32_t a0 = (slot->unk9 << 14) + (o->unkC & 0xFF);
  uint32_t a1 = (slot->unk8 << 14) + (o->unkA & 0x1FF);
  uint32_t a2 = ((uint32_t)o->unk12 << 12) | (slot->unk0 & 0x3FF) | (behind ? 0x800 : 0);
  for (int i = 0; i < s16(o->unkE); i++) {
    uint32_t c = (a2 + (text_at(text, i) - GLYPH_BASE) * slot->unk4) & 0xFFFF;
    if (!put_glyph(((o->unk8 + i) >> 3) & 0xFF, a0, a1, c)) break;
    a1 = (a1 + step) & 0xFFFF;
  }
}

/**
 * front/ui.js's drawUiTextRotated: `o->unkE` glyphs of `text` side by side from (o->unkA, o->unkC), each a rotating sprite
 * twice its size on affine parameters `o->unk6`, which `o->unk4` (the angle) and the scales `o->unk0` and `o->unk2` set.
 */
void draw_ui_text_rotated(const char *text, const UiText *o) {
  const UiSlot *slot = &ui.slots[o->unk10];
  set_ui_affine(o->unk4, s16(o->unk0), s16(o->unk2), o->unk6);
  uint32_t index = o->unk6, order = (o->unk8 >> 3) & 0xFF;
  uint32_t a0 = (slot->unk9 << 14) | 0x300 | (o->unkC & 0xFF);
  uint32_t a2 = ((uint32_t)o->unk12 << 12) | (slot->unk0 & 0x3FF);
  for (int i = 0; i < s16(o->unkE); i++) {
    uint32_t a1 = (slot->unk8 << 14) | (index << 9) | ((((uint32_t)(slot->unkA * i) << 3) + o->unkA) & 0x1FF);
    uint32_t c = (a2 + (text_at(text, i) - GLYPH_BASE) * slot->unk4) & 0xFFFF;
    if (!put_glyph(order, a0, a1, c)) break;
  }
}

/**
 * sub_80047A0: affine parameters `index` of OAM for `angle` (0–1023) and the scales `sx` and `sy` (8.8), written
 * straight into the OAM buffer, where the V-blank's copy of the sprites leaves them.
 */
void set_ui_affine(int angle, int sx, int sy, int index) {
  int cos = SINE[angle + 256] >> 6, sin = SINE[angle] >> 6;
  int res = s16(sx) ? s16(0x10000 / s16(sx)) : 0;
  e.oamBuffer[(index * 4 + 0) * 4 + 3] = (uint16_t)((cos * res) >> 8);
  e.oamBuffer[(index * 4 + 1) * 4 + 3] = (uint16_t)((sin * res) >> 8);
  res = s16(sy) ? s16(0x10000 / s16(sy)) : 0;
  e.oamBuffer[(index * 4 + 2) * 4 + 3] = (uint16_t)(((-SINE[angle] >> 6) * res) >> 8);
  e.oamBuffer[(index * 4 + 3) * 4 + 3] = (uint16_t)((cos * res) >> 8);
}

/** A fade (StrcUi_805423C). */
Fade create_fade(int16_t unk0, uint16_t unk2, uint16_t unk4, int16_t unk6, int16_t unk8, uint16_t unkA) {
  Fade f = { unk0, unk2, unk4, unk6, unk8, unkA };
  return f;
}

// both fades: the window over the whole screen, and the blend set for how far the fade is
static void apply_fade(const Fade *f, int step) {
  e.dispCnt |= f->unk2 ? 0x4000 : 0x2000;
  if (f->unkA & 0x1) { e.bldCnt = 0x3F3F; e.bldAlpha = 16; }
  else if (step && f->unkA & 0x10) { e.bldCnt = 0x203F; e.bldAlpha = 0; }
  else if ((f->unkA & 0xFF) == 0) { e.bldCnt = 0x0F; e.bldAlpha = 0; }
  else if (step && f->unkA & 0x8) e.bldCnt = 0x3F3F;
  if (f->unk2) { e.winRegs[1] = 0x00F0; e.winRegs[3] = 0x00A0; e.winRegs[4] |= 0x3F00; }
  else { e.winRegs[0] = 0x00F0; e.winRegs[2] = 0x00A0; e.winRegs[4] |= 0x3F; }
  e.winRegs[5] |= 0x1F;
  e.bldCnt |= f->unk4 & 0xC ? 0x80 : 0xC0;
  uint32_t y = (uint32_t)(f->unk4 & 5 ? f->unk6 >> 8 : 32 - (f->unk6 >> 8)) & 0xFFFF;
  if (y >= 32) y = 32;
  e.bldY = (uint16_t)(y >> 1);
}

/** sub_805423C: the fade as it is, then a step on (once it has waited); true once it has reached its end. */
int fade_step(Fade *f) {
  apply_fade(f, 1);
  uint32_t r2 = (uint16_t)f->unk6;
  if (f->unk0 != 0) {
    f->unk0 = f->unk0 >= f->unk8 ? s16(f->unk0 - f->unk8) : 0;
    return 0;
  }
  f->unk6 = s16(r2 + f->unk8);
  if (f->unk6 >= 0x2000) { f->unk6 = 0x2000; return 1; }
  return 0;
}

/** sub_80543A4: the fade as it is, without a step. */
void fade_show(Fade *f) { apply_fade(f, 0); }
