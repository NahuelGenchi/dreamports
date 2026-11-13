// The special stage's rings counter, translated from special/hud.js (SAT-R's src/game/sa1/stage/stage_ui.c:
// CreateSpecialStageUI, Task_SpecialStageUIMain and sub_8054068): at the top of the screen, a panel with the rings
// collected and, under them, the rings the stage asks for, each up to 999. The panel drops in from above over the first
// 30 frames, the collected count from frame 20 to 40 and the target from frame 15 to 35. A count of 0 blinks, 16 frames a
// plain 0 and 16 a red one (twice as fast when both counts are 0, as they share the blink's frame count).

#include "special.h"

enum { UIGFX_FONT = 0, UIGFX_PANEL = 46 };
// the font's '0'-'9' and ':' (tiles 32 on) and its red '0' (tiles 124 on), the panel; their slots
enum { FONT_DIGITS = 32, FONT_RED = 124 };
enum { SLOT_DIGITS = 0, SLOT_PANEL = 3 };
enum { DIGITS = 0x175E0, RED = 0x178A0, PANEL = 0x17BE0 };   // VRAM_RESERVED_UI_DIGITS_E, _F and _G
#define DIGIT(c) (0x20 + (c))   // UI_DIGIT

static struct {
  char digitsRings[4], unk10[4];
  int ringCount, unk48, unk4C;
  uint32_t zero;   // the blinking 0's four glyphs, 8 frames each (gUnknown_0865F174: plain, red, red, plain) and the
                   // panel's one (gUnknown_0865F178), which the copy keeps just before the font's tiles
} ui;
static Task *hudTask;

static void hud_step(Task *t);
static void hud_gone(Task *t) { (void)t; hudTask = NULL; }

static void load(int id, int slot, uint32_t from, uint32_t dest, uint32_t size, int row, int flags) {
  uint32_t tiles, palette;
  UiSlot layout;
  ui_graphics(id, &tiles, &palette, &layout);
  UiGfx g = { 0 };
  g.layout = &layout; g.unk2B = slot; g.tiles = tiles + from; g.tilesSize = size; g.palette = palette; g.paletteSize = 32;
  g.unk28 = (uint8_t)row; g.vramC = dest; g.unk2A = (uint8_t)flags;
  load_ui_gfx(&g);
}

/**
 * CreateSpecialStageUI: the counter's task, and its graphics (sub_8054068), through the title card's UI task. The original
 * never sets the blink's frame count (unk48), so it starts at whatever the task's memory held: sp.hudBlink here: at a
 * stage's start the line the fall's last streak was on (the random numbers place the streaks), and 0 after the
 * checkpoint; the pause sign's y when the pause menu was opened before the counter was made (specialstage.c). A count
 * past 31 shows its first 0 from a byte past the four glyphs, and then goes on from its value modulo 32.
 */
void sp_hud_create(void) {
  memset(&ui, 0, sizeof ui);
  ui.unk48 = sp.hudBlink & 0xFFFF;
  uint32_t tiles, palette;
  UiSlot layout;
  ui_graphics(UIGFX_FONT, &tiles, &palette, &layout);
  ui.zero = tiles - 8;
  hudTask = create_task(hud_step, &ui, 0x1180, 0, hud_gone);
  ui_gfx_stack_init();
  load(UIGFX_FONT, SLOT_DIGITS, FONT_RED * 32, RED, 6 * 32, 6, 0x9);
  load(UIGFX_FONT, SLOT_DIGITS, FONT_DIGITS * 32, DIGITS, 22 * 32, 6, 0xD);
  load(UIGFX_PANEL, SLOT_PANEL, 0, PANEL, 32 * 32, 10, 0xD);
}

/** Whether the rings counter's task runs: not before the title card has made it, nor in the checkpoint's. */
int sp_hud_runs(void) { return hudTask != NULL; }

// a count's three digits, 999 past it
static void digits_of(int n, char *out) {
  if (n > 999) { out[0] = out[1] = out[2] = DIGIT(9); return; }
  for (int i = 0; i < 3; i++) {
    int q = n / 10;
    out[2 - i] = (char)DIGIT(n - q * 10);
    n = q;
  }
}

// where a count is as it drops in: from `from` lines down to `to`, over the 20 frames from frame `start`
static int drop_in(int n, int start, int from, int to) {
  return n >= start && n < start + 20 ? ((n - start) << 6) / 20 + from : n >= start + 20 ? to : from;
}

// one glyph from the copy, as a line of text
static void rom_glyph(char out[2], uint32_t at) { out[0] = (char)rom_u8(at); out[1] = 0; }

// a count: one digit, two or three; a 0 blinks, from the blinking 0's glyphs (four, 8 frames each; the frame count can
// start anywhere up to 255 and read past them, see sp_hud_create)
static void count(UiText *o, int *r7, int value, const char *digits, int left) {
  if (value < 10) {
    o->unkA = (uint16_t)(left + 12);
    o->unkE = 1;
    if (value == 0) {
      char glyph[2];
      rom_glyph(glyph, ui.zero + (uint32_t)(*r7 >> 3));
      *r7 = ((*r7 + 1) & 0xFF) % 32;
      ui.unk48 = *r7;
      draw_ui_text(glyph, o, 1);
    } else draw_ui_text(digits + 2, o, 1);
  } else if (value < 100) {
    o->unkA = (uint16_t)(left + 8);
    o->unkE = 2;
    draw_ui_text(digits + 1, o, 1);
  } else {
    o->unkA = (uint16_t)(left + 4);
    o->unkE = 3;
    draw_ui_text(digits, o, 1);
  }
}

// Task_SpecialStageUIMain
static void hud_step(Task *t) {
  (void)t;
  int r7 = ui.unk48 & 0xFF;
  int n = s16(ui.unk4C + 1);
  ui.unk4C = n;
  const int x = 90, targetX = 114;
  UiText o = { .unk8 = 24, .unkA = x + 4, .unkC = (uint16_t)drop_in(n, 10, -70, -6), .unkE = 1, .unk10 = SLOT_PANEL, .unk12 = 10, .unk16 = 1 };
  char panel[2];
  rom_glyph(panel, ui.zero + 4);
  draw_ui_text(panel, &o, 1);

  int collected = sp.collected & 0xFFFF;
  digits_of(collected, ui.digitsRings);
  ui.ringCount = collected;
  o.unkC = (uint16_t)drop_in(n, 20, -64, 0);
  o.unk12 = 6; o.unk8 = 16; o.unk10 = SLOT_DIGITS; o.unk16 = 1;
  count(&o, &r7, collected, ui.digitsRings, x);

  int target = sp.target & 0xFFFF;
  digits_of(target, ui.unk10);
  ui.ringCount = target;
  o.unkC = (uint16_t)drop_in(n, 15, -52, 12);
  o.unk12 = 6; o.unk8 = 16; o.unk10 = SLOT_DIGITS; o.unk16 = 1;
  count(&o, &r7, target, ui.unk10, targetX);
}
