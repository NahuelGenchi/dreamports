// The special stage's results, translated from special/results.js (SAT-R's src/game/sa1/ui/game_2_1.c: sub_805D048,
// sub_805C994, sub_805C900, sub_805D4F0 and their tasks), after the stage is lost or after the Chaos Emerald's scene. The
// score is given at once (100 a ring, 10000 for the emerald), and a continue for each one the stage gave and for an
// emerald won again. On the screen, over the cleared layers: a band and a stripe saying how it went, the seven emeralds
// sliding in under the band from frame 50, and the total (from frame 40), the emerald bonus (46) and the rings (52), each
// a label growing from a line with its number beside it. From frame 170 the rings and the bonus count down into the
// total, 100 points a frame, with a tick every 4 frames and a chime when the count ends, which brings in the continues
// won, if any. The screen lasts 616 frames more than the count; in its last 70 everything slides off to the left, and
// then the act starts again.

#include "special.h"

#define EMERALD_BONUS 10000
#define LIFE_EVERY 50000
// the frame the count starts on, and the last frame past the count's length before the act
#define COUNT_FROM 0xAA
#define END_AFTER 615
// the UI graphics: the band, the stripe after a win (then the character's name), after a loss, the labels and the
// continues' digits, the emeralds, the emeralds' colours, the font
enum { UIGFX_BAND = 16, UIGFX_WON = 51, UIGFX_NAME = 11, UIGFX_LOST = 53, UIGFX_LABELS = 52, UIGFX_EMERALDS = 54, UIGFX_FONT = 0 };
static const int UIGFX_EMERALD_COLOURS[3] = { 56, 57, 58 };
// the slots (ui.c)
enum { SLOT_STRIPE = 2, SLOT_LABELS = 3, SLOT_EMERALDS = 4, SLOT_COLOURS = 5, SLOT_DIGITS = 6, SLOT_BAND = 8 };
// the band's eight blank glyphs, the stripe's ten glyphs three times over, and the labels' glyphs in slot 3
static const char BAND[] = "        ";
static const char STRIPE[] = " !\"#$%&'() !\"#$%&'() !\"#$%&'()";
static const char RINGS[] = " !\"", BONUS[] = "#$%", TOTAL[] = "&'(", CONTINUES[] = ")*+";

// a piece of the screen (its task's data): the bonus, the total, the frame count the main task hands it, the count's
// length, the stripe's scroll, the rings, whether the emerald was won, the save's emeralds, the continues won, the
// digits of a number, and its line of text
typedef struct {
  int unk18, unk1C, unk20, unk22, unk24, unk26, unk28, unk29, unk2A;
  char unk2B[8];
  UiText o;
} Piece;
enum { BAND_PIECE, STRIPE_PIECE, CONTINUES_PIECE, TOTAL_PIECE, BONUS_PIECE, RINGS_PIECE, EMERALDS_PIECE, PIECES };
static Piece pieces[PIECES];
static struct { int unk28, unk2A; } results;

static void band_step(Task *t);
static void stripe_step(Task *t);
static void continues_step(Task *t);
static void total_step(Task *t);
static void bonus_step(Task *t);
static void rings_step(Task *t);
static void emeralds_step(Task *t);
static void results_step(Task *t);
static void load_graphics(int arg);

// a line of text (GameOverB / Strc_8052C84), unk16 1 unless said
static UiText line(UiText o) { o.unk16 = 1; return o; }
// a label's line, growing from a line to its size
static UiText scaled(int unk6, int unkC, int unk8) {
  return line((UiText){ .unk0 = 0x100, .unk2 = 0, .unk4 = 0, .unkA = 0x39, .unkC = (uint16_t)unkC, .unkE = 3,
                        .unk10 = SLOT_LABELS, .unk12 = 0xE, .unk6 = (uint16_t)unk6, .unk8 = (uint16_t)unk8 });
}

/**
 * sub_805D048: the results, `arg` 1 after the emerald's scene and 0 otherwise (which picks the stripe's picture; the
 * emerald itself is won by having the stage's target, sp.collected >= sp.target). Updates spGame: the emerald's bit in
 * `emeralds`, `score`, `lives` (one more for each 50000 points passed) and `continues`.
 */
void sp_results_create(int arg) {
  create_ui_task_keeping(spUiSlots);
  for (int i = 0; i < 8; i++) e.bgScroll[i] = 0;

  int won = 0, bonus = 0, had = 0;
  if ((sp.collected & 0xFFFF) >= (sp.target & 0xFFFF)) {
    play_song(SONG_SPECIAL_STAGE_WIN);
    won = 1;
    bonus = EMERALD_BONUS;
    if ((spGame.emeralds >> spStageIndex) & 1) had = 1;
    else spGame.emeralds = (spGame.emeralds | (1 << spStageIndex)) & 0xFF;
  } else play_song(SONG_SPECIAL_STAGE_LOSE);
  int emeralds = spGame.emeralds & 0xFF, rings = sp.collected & 0xFFFF;
  int continues = (sp.extra + had) & 0xFF;
  spGame.continues = (int8_t)(spGame.continues + continues);
  // INCREMENT_SCORE_A, a life without the 1-up jingle; the original also checks that the game is single player, which
  // it always is here
  uint32_t before = spGame.score;
  spGame.score += (uint32_t)(bonus + rings * 100);
  if (spGame.score / LIFE_EVERY != before / LIFE_EVERY) spGame.lives = (spGame.lives + 1) & 0xFF;
  // how many frames the count takes: the larger of the rings and the bonus's hundreds
  int count = bonus > rings * 100 ? (bonus / 100) & 0xFFFF : rings;
  ui_gfx_stack_init();

  static const TaskMain steps[PIECES] = { band_step, stripe_step, continues_step, total_step, bonus_step, rings_step, emeralds_step };
  UiText lines[PIECES] = {
    line((UiText){ .unkA = 0xF0, .unkC = 0x7E, .unkE = 8, .unk10 = SLOT_BAND, .unk12 = 0xE, .unk8 = 0xA }),
    line((UiText){ .unkA = 0x100, .unkC = 0x80, .unkE = 9, .unk10 = SLOT_STRIPE, .unk12 = 0xF, .unk8 = 0 }),
    scaled(0, 0x49, 0x18), scaled(1, 0x39, 0x10), scaled(2, 0x39, 8), scaled(3, 0x39, 0),
    line((UiText){ .unkA = 0, .unkC = 0x29, .unkE = 1, .unk10 = SLOT_EMERALDS, .unk12 = 0xD, .unk8 = 0 }),
  };
  for (int i = 0; i < PIECES; i++) {
    Piece *p = &pieces[i];
    *p = (Piece){ .unk18 = bonus, .unk22 = count, .unk26 = rings, .unk28 = won, .unk29 = emeralds, .unk2A = continues };
    p->o = lines[i];
    create_task(steps[i], p, 0x2120, 0, NULL);
  }
  results.unk28 = 0; results.unk2A = count;
  create_task(results_step, &results, 0x2100, 0, NULL);

  // every layer's map cleared in the next V-blank (gBgSprites_Unknown1 and 2)
  for (int i = 0; i < 4; i++) {
    e.mapFill[i].value = 0;
    e.mapFill[i].rect[0] = 0; e.mapFill[i].rect[1] = 0; e.mapFill[i].rect[2] = 0xFF; e.mapFill[i].rect[3] = 0x20;
  }
  load_graphics(arg);
}

// a load of UI graphics `id` into sprite VRAM at `dest`, its layout into `slot` and its colours into row `row`
static void load(int id, int slot, uint32_t dest, uint32_t size, uint32_t paletteSize, int row, int flags, uint32_t from) {
  uint32_t tiles, palette;
  UiSlot layout;
  ui_graphics(id, &tiles, &palette, &layout);
  UiGfx g = { 0 };
  g.layout = &layout; g.unk2B = slot; g.tiles = tiles + from; g.tilesSize = size; g.palette = palette;
  g.paletteSize = paletteSize; g.unk28 = (uint8_t)row; g.vramC = OBJ_VRAM + dest; g.unk2A = (uint8_t)flags;
  load_ui_gfx(&g);
}

// sub_805C994: the graphics, and the sprites' colours rows 9 to 15
static void load_graphics(int arg) {
  load(UIGFX_BAND, SLOT_BAND, 0x77A0, 0x200, 0x20, 14, 0xD, 0);
  if (arg) {
    // the stripe after the emerald: the character's name (six of its colours), then the rest of the picture
    load(UIGFX_WON, SLOT_STRIPE, 0x69A0, 0xE00, 0x20, 15, 0xD, 0);
    load(UIGFX_NAME + spGame.character, SLOT_STRIPE, 0x63A0, 0x600, 0xC, 15, 0xD, 0);
  } else load(UIGFX_LOST, SLOT_STRIPE, 0x63A0, 0x1400, 0x20, 15, 0xD, 0);
  load(UIGFX_LABELS, SLOT_LABELS, 0x52A0, 0x1100, 0x20, 14, 0xD, 0);
  load(UIGFX_EMERALDS, SLOT_EMERALDS, 0x4CA0, 0x600, 0x20, 13, 0xD, 0);
  // the emeralds' other colours only
  for (int i = 0; i < 3; i++) load(UIGFX_EMERALD_COLOURS[i], SLOT_COLOURS, 0x4CA0, 0x20, 0x20, 12 - i, 0xC, 0);
  load(UIGFX_FONT, SLOT_DIGITS, 0x4A20, 0x280, 0x20, 9, 0xD, 0x400);
}

// sub_805D4F0: hands its frame count to the pieces, counts the rings and the bonus into the total from frame 170, one a
// frame, and plays the count's sounds; then the act again
static void results_step(Task *t) {
  (void)t;
  Piece *continues = &pieces[CONTINUES_PIECE], *total = &pieces[TOTAL_PIECE], *bonus = &pieces[BONUS_PIECE], *rings = &pieces[RINGS_PIECE];
  for (int i = 0; i < PIECES; i++) pieces[i].unk20 = results.unk28 & 0xFFFF;
  if (results.unk28 > COUNT_FROM - 1) {
    if (rings->unk26 != 0) {
      rings->unk26 = (rings->unk26 - 1) & 0xFFFF;
      total->unk1C += 100;
    }
    if (bonus->unk18 != 0) {
      bonus->unk18 -= 100;
      total->unk1C += 100;
    }
  }
  results.unk28 = s16(results.unk28 + 1);
  if (results.unk2A + END_AFTER < results.unk28) {
    // the original then moves the act's checkpoint and starts the act (CreateGameStage), which special_stage_back does
    destroy_tasks(0, 0xFFFF);
    clear_queues();
    special_stage_back();
    return;
  }
  if (results.unk28 == results.unk2A + COUNT_FROM) play_song(continues->unk2A != 0 ? SONG_RESULT_CONTINUE : SONG_RESULT_COUNTER_DONE);
  if (results.unk28 > COUNT_FROM && results.unk28 < results.unk2A + COUNT_FROM && results.unk28 % 4 == 0) play_song(SONG_RESULT_COUNTER);
}

// Task_805D684: the band, as the title card's (specialcard.c) but rising 6 lines a frame from frame 34 to the top, and
// leaving in the screen's last 70 frames
static void band_step(Task *t) {
  Piece *d = t->data;
  UiText *o = &d->o;
  int n = s16(d->unk20);
  if (n > d->unk22 + 0x221) {
    if (s16(o->unkA) < -32) {
      o->unkA = u16(o->unkA + 32);
      if (o->unkE != 0) o->unkE = u16(o->unkE - 1);
    }
    o->unkA = u16(o->unkA - 0x1A);
  } else if (n > 0x31) o->unkC = 0x11;
  else if (n > 0x21) o->unkC = u16(o->unkC - 6);
  else if (n > 0x19) o->unkA = u16(-0x10);
  else if (n > 0xF) {
    o->unkA = u16(o->unkA - 0x1A);
    if (s16(o->unkA) < -0x10) o->unkA = u16(-0x10);
  }
  draw_ui_text(BAND, o, 0);
}

// the stripe's picture a glyph further on, as it scrolls past one
static void stripe_scroll(Piece *d) {
  if (s16(d->o.unkA) < -0x1F) {
    d->o.unkA = u16(d->o.unkA + 0x20);
    d->unk24 = (d->unk24 + 1) % 10;
  }
}

// Task_805D720: the stripe, as the title card's, ten glyphs round
static void stripe_step(Task *t) {
  Piece *d = t->data;
  UiText *o = &d->o;
  int n = s16(d->unk20);
  if (n > d->unk22 + 0x221) {
    o->unkA = u16(o->unkA - 0x1C);
    if (s16(o->unkA) < -0x1F) {
      if (o->unkE != 0) o->unkE = u16(o->unkE - 1);
      o->unkA = u16(o->unkA + 0x20);
      d->unk24 = (d->unk24 + 1) % 10;
    }
    draw_ui_text(STRIPE + d->unk24, o, 0);
  } else if (n > 49) {
    o->unkC = 0x13;
    o->unkA = u16(o->unkA - 2);
    stripe_scroll(d);
    draw_ui_text(STRIPE + d->unk24, o, 0);
  } else if (n > 33) {
    o->unkC = u16(o->unkC - 6);
    o->unkA = u16(o->unkA - 2);
    stripe_scroll(d);
    draw_ui_text(STRIPE + d->unk24, o, 0);
  } else if (n > 0x19) {
    o->unkA = u16(o->unkA - 2);
    o->unkE = 9;
    stripe_scroll(d);
    draw_ui_text(STRIPE + d->unk24, o, 0);
  } else if (n > 0xF) {
    o->unkA = u16(o->unkA - 0x1C);
    if (s16(o->unkA) < 0xF0) {
      o->unkE = u16(9 - (s16(o->unkA) >> 5));
      stripe_scroll(d);
      draw_ui_text(STRIPE + d->unk24, o, 0);
    }
  }
}

// sub_805C900: a number in seven digits (leading zeros as blanks): the rings' points (0), the bonus (1), the total (2) or
// the continues (3, whose digits other than 0 are 11 glyphs on, in the labels' picture); returns the first digit shown
static int digits_of(Piece *d, int which) {
  int n = which == 0 ? d->unk26 * 100 : which == 1 ? d->unk18 : which == 2 ? d->unk1C : d->unk2A;
  for (int i = 6; i >= 0; i--) {
    int q = n / 10, c = n - q * 10 + 0x20;
    d->unk2B[i] = (char)c;
    if (n != q * 10 && which == 3) d->unk2B[i] = (char)(c + 0xB);
    n = q;
  }
  d->unk2B[7] = 0;
  int first = 0;
  while (first < 7 && d->unk2B[first] == 0x20) first++;
  return first;
}

typedef int (*Value)(const Piece *d);
typedef void (*Number)(Piece *d);

// a label growing from a line to its height in 8 steps from frame `grow` + 1, then still at (0x29, y); in the screen's
// last 70 frames it slides off to the left until it is past x -128. `number` draws the number beside it.
static void label(Piece *d, const char *text, int grow, int y, Number number) {
  UiText *o = &d->o;
  int n = s16(d->unk20);
  if (n > d->unk22 + 0x221) {
    o->unkC = (uint16_t)y;
    o->unkA = u16(o->unkA - 0x1C);
    if (s16(o->unkA) < -0x80) {
      o->unkE = 0;
      o->unkA = u16(-0x80);
    } else draw_ui_text(text, o, 0);
    number(d);
  } else if (n > grow + 6) {
    o->unk2 = u16(o->unk2 + 0x20);
    if (o->unk2 >= 0x100) {
      o->unk2 = 0x100;
      o->unkA = 0x29;
      o->unkC = (uint16_t)y;
      draw_ui_text(text, o, 0);
    } else {
      o->unkA = 0x19;
      o->unkC = u16(y + 10 - (o->unk2 >> 4));
      draw_ui_text_affine(text, o);
    }
    number(d);
  } else if (n > grow) {
    o->unkA = 0x19;
    o->unkC = u16(y + 10 - (o->unk2 >> 4));
    o->unk2 = u16(o->unk2 + 0x20);
    if (o->unk2 >= 0x100) o->unk2 = 0x100;
    draw_ui_text_affine(text, o);
    number(d);
  }
}

// how far a number has slid to the left in the screen's last 70 frames, 28 pixels a frame
static int slide(const Piece *d) { return d->unk20 > d->unk22 + 545 ? s16((d->unk20 - 545 - d->unk22) * 0x1C) : 0; }

// sub_805DE0C, sub_805DBF0 and sub_805D9E4: a number in the font's digits (slot 6, palette 9), right-aligned against x
// 195 on line `y`, or a blank where it is 0; growing from a line with its label
static void number(Piece *d, int which, int value, int y) {
  if (d->unk20 > d->unk22 + 558) return;
  UiText *o = &d->o;
  uint16_t keepX = o->unkA, keepY = o->unkC;
  int left = slide(d);
  o->unk10 = SLOT_DIGITS;
  o->unk12 = 9;
  int first = digits_of(d, which);
  const char *digits = d->unk2B + first;
  if (o->unk2 == 0x100) {
    o->unkC = (uint16_t)y;
    if (value != 0) {
      o->unkE = (uint16_t)(7 - first);
      o->unkA = u16(195 - left - o->unkE * 8);
      draw_ui_text(digits, o, 0);
    } else {
      o->unkE = 1;
      o->unkA = u16(0xBB - left);
      draw_ui_text(" ", o, 0);
    }
  } else {
    o->unkC = u16(y + 13 - (o->unk2 >> 4) - o->unk2 / 25);
    if (value != 0) {
      o->unkE = (uint16_t)(7 - first);
      o->unkA = (uint16_t)((6 - o->unkE) * 8 + 0x8F);
      draw_ui_text_affine(digits, o);
    } else {
      o->unkE = 1;
      o->unkA = 0xB7;
      draw_ui_text_affine(" ", o);
    }
  }
  o->unkA = keepX;
  o->unkC = keepY;
}

// sub_805D81C: the continues' number, its one digit in the labels' picture, at x 179 on line 0x7E
static void continues_number(Piece *d) {
  if (d->unk20 > d->unk22 + 558) return;
  UiText *o = &d->o;
  uint16_t keepX = o->unkA, keepY = o->unkC;
  int left = slide(d);
  int first = digits_of(d, 3);
  const char *digits = d->unk2B + first;
  if (o->unk2 == 0x100) {
    o->unkC = 0x7E;
    o->unkE = 1;
    o->unkA = u16(179 - left);
    draw_ui_text(digits, o, 0);
  } else {
    o->unkC = u16(143 - (o->unk2 >> 4) - o->unk2 / 25);
    o->unkE = 1;
    o->unkA = 0xA3;
    draw_ui_text_affine(digits, o);
  }
  o->unkA = keepX;
  o->unkC = keepY;
}

// the labels' fields, set each frame before they are drawn
static void label_line(UiText *o) {
  o->unkE = 3;
  o->unk10 = SLOT_LABELS;
  o->unk12 = 0xE;
}

static void rings_number(Piece *d) { number(d, 0, d->unk26, 0x46); }
static void bonus_number(Piece *d) { number(d, 1, d->unk18, 0x58); }
static void total_number(Piece *d) { number(d, 2, d->unk1C, 0x6A); }

// Task_805DF2C: the rings, on line 0x49
static void rings_step(Task *t) {
  Piece *d = t->data;
  label_line(&d->o);
  label(d, RINGS, 0x33, 0x49, rings_number);
}

// Task_805DD10: the emerald bonus, on line 0x5B, once the emerald is won
static void bonus_step(Task *t) {
  Piece *d = t->data;
  if (!d->unk28) return;
  label_line(&d->o);
  label(d, BONUS, 0x2D, 0x5B, bonus_number);
}

// Task_805DB04: the total, on line 0x6D
static void total_step(Task *t) {
  Piece *d = t->data;
  label_line(&d->o);
  label(d, TOTAL, 0x27, 0x6D, total_number);
}

// Task_805D8EC: the continues, on line 0x81, from when the count ends, if there are any
static void continues_step(Task *t) {
  Piece *d = t->data;
  int n = s16(d->unk20);
  if (d->unk2A == 0 || n < d->unk22 + COUNT_FROM) return;
  label_line(&d->o);
  label(d, CONTINUES, 0x21, 0x81, continues_number);
}

// an emerald's glyph: in its colours if the save has it, two shapes in turn, and grey if not
static void emerald(Piece *d, int i) {
  UiText *o = &d->o;
  if ((d->unk29 >> i) & 1) {
    o->unk12 = (uint16_t)(0xD - (i >> 1));
    draw_ui_text(i & 1 ? "!" : " ", o, 0);
  } else {
    o->unk12 = 0xB;
    draw_ui_text("\"", o, 0);
  }
}

// sub_805E018: the seven emeralds on line 0x29, each a glyph in the emeralds' picture; from frame 50 they slide in from
// the right one after the other, 5 frames apart, slowing down, and 70 frames before the end they slide off to the left
static void emeralds_step(Task *t) {
  Piece *d = t->data;
  UiText *o = &d->o;
  int n = d->unk20;
  if (n > d->unk22 + 545) {
    int left = s16(((n - 545 - d->unk22) & 0xFFFF) * 0x1C);
    for (int i = 0; i < 7; i++) {
      o->unkA = u16((i << 5) - (left - 5));
      if ((i << 5) - (left - 5) > -0x20) emerald(d, i);
    }
  } else if (n > 0x86) {
    for (int i = 0; i < 7; i++) {
      o->unkA = (uint16_t)((i << 5) + 5);
      emerald(d, i);
    }
  } else if (n > 0x31) {
    for (int i = 0; i < 7; i++) {
      int k = (n - 0x31) & 0xFFFF;
      if (k < i * 5) continue;
      k -= i * 5;
      if (k > 50) k = 50;
      o->unkA = u16((i << 5) + (SINE[256] / 80 + 5) - SINE[k * 5] / 80);
      emerald(d, i);
    }
  }
}
