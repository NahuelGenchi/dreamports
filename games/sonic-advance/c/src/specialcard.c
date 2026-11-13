// The special stage's title card, translated from special/card.js (SAT-R's src/game/sa1/ui/game_2_0.c: sub_805C448
// and its tasks), shown as the stage starts (with the stage fading in from black) and again at the checkpoint once it is
// passed, with the goal's target. For 256 frames: a band slides in from the right along the bottom of the screen and up
// to the top, a stripe of the target's picture scrolls past under it, and at the stage's start a word grows from a line
// into the middle of the screen. The target number is loaded into the stripe's picture on the second frame. When the
// card ends, the rings counter starts (specialhud.c).

#include "special.h"

#define CARD_FRAMES 0xFF
// the UI graphics the card uses: the word, the band, the stripe with a target of 1, 2 or 3 digits, the digits
enum { UIGFX_WORD = 50, UIGFX_BAND = 16, UIGFX_DIGITS = 32 };
static const int UIGFX_STRIPE[3] = { 47, 48, 49 };
// the slots they go in (Task_3006240's table, ui.c)
enum { SLOT_STRIPE = 2, SLOT_DIGITS = 3, SLOT_WORD = 4, SLOT_BAND = 8 };
#define PALETTE 6
// the band is eight blank glyphs; the stripe the picture's seven glyphs three times over (gUnknown_08688638, copied onto
// the stack); the word five glyphs
static const char BAND[] = "        ";
static const char STRIPE[] = " !\"#$%& !\"#$%& !\"#$%&";
static const char WORD[] = " !\"#$";

// a piece of the card: its frame count, which the card hands it, how far its picture has scrolled, and its line
typedef struct { int unk18, unk1A; UiText o; } Piece;
static Piece band, stripe, word;
static struct { int unk18, unk1A; Task *task10, *task14, *taskC; Fade fade; } card;

static void band_step(Task *t);
static void stripe_step(Task *t);
static void word_step(Task *t);
static void card_step(Task *t);

/** sub_805C448: the card, `arg` 1 at the stage's start (with the word and the fade in) and 0 at the checkpoint. The
 *  target shown is sp.target as it is on the card's second frame. */
void sp_title_card_create(int arg) {
  create_ui_task_keeping(spUiSlots);
  ui_gfx_stack_init();
  band = (Piece){ 0 };
  band.o = (UiText){ .unkA = 0xF0, .unkC = 0x7E, .unkE = 8, .unk10 = SLOT_BAND, .unk12 = PALETTE, .unk16 = 1, .unk8 = 0xA };
  card.task10 = create_task(band_step, &band, 0x2120, 0, NULL);
  stripe = (Piece){ 0 };
  stripe.o = (UiText){ .unkA = 0x100, .unkC = 0x80, .unkE = 9, .unk10 = SLOT_STRIPE, .unk12 = PALETTE, .unk16 = 1, .unk8 = 0 };
  card.task14 = create_task(stripe_step, &stripe, 0x2120, 0, NULL);
  card.taskC = NULL;
  if (arg) {
    word = (Piece){ 0 };
    word.o = (UiText){ .unk0 = 0x100, .unk2 = 0, .unk4 = 0, .unk6 = 0, .unkA = 0x39, .unkC = 0x49, .unkE = 5, .unk10 = SLOT_WORD,
                       .unk12 = PALETTE, .unk16 = 1, .unk8 = 0 };
    card.taskC = create_task(word_step, &word, 0x2120, 0, NULL);
  }
  card.unk18 = 0; card.unk1A = arg;
  card.fade = create_fade(0, 1, 2, 0, 0x60, 1);
  create_task(card_step, &card, 0x2100, 0, NULL);
  if (arg) fade_show(&card.fade);
}

static void load_target(int n);

// Task_805C594: hands its frame count to the pieces; at the stage's start, the fade in from black from frame 21 to 105;
// on the second frame, the target's graphics; after 256 frames, the end
static void card_step(Task *t) {
  band.unk18 = card.unk18;
  stripe.unk18 = card.unk18;
  if (card.unk1A) {
    word.unk18 = card.unk18;
    if (card.unk18 < 106) {
      if (card.unk18 > 20) fade_step(&card.fade);
      else fade_show(&card.fade);
    }
  }
  if (++card.unk18 > CARD_FRAMES) {
    e.dispCnt &= ~0xE000;
    e.bldCnt = 0;
    e.bldY = 0;
    sp_hud_create();
    destroy_task(card.task14);
    destroy_task(card.task10);
    if (card.unk1A) destroy_task(card.taskC);
    destroy_task(t);
    return;
  }
  if (card.unk18 == 2) load_target(sp.target & 0xFFFF);
}

// a load of UI graphics `id` into sprite VRAM at `dest`, its layout into `slot`, and its colours into the card's
// palette; `from` bytes into its tiles
static void load(int id, int slot, uint32_t dest, uint32_t size, uint32_t from) {
  uint32_t tiles, palette;
  UiSlot layout;
  ui_graphics(id, &tiles, &palette, &layout);
  UiGfx g = { 0 };
  g.layout = &layout; g.unk2B = slot; g.tiles = tiles + from; g.tilesSize = size; g.palette = palette; g.paletteSize = 0x20;
  g.unk28 = PALETTE; g.vramC = OBJ_VRAM + dest; g.unk2A = 0xD;
  load_ui_gfx(&g);
}

// a digit of the target: its top two tiles at `top` and its bottom two at `bottom`, in the stripe's picture
static void load_digit(int digit, uint32_t top, uint32_t bottom) {
  load(UIGFX_DIGITS, SLOT_DIGITS, top, 0x40, (uint32_t)digit << 7);
  load(UIGFX_DIGITS, SLOT_DIGITS, bottom, 0x40, ((uint32_t)digit << 7) + 0x40);
}

/**
 * sub_805BC94: the word, the band and the stripe (the picture for a target of `n`'s number of digits), then the target's
 * digits into the stripe's picture. A target of 100 or more leaves out its leading zeros, which none has.
 */
static void load_target(int n) {
  int digits = ((n / 100) & 0xFF) != 0 ? 3 : ((n / 10) & 0xFF) != 0 ? 2 : 1;
  load(UIGFX_WORD, SLOT_WORD, 0x5DA0, 0xA00, 0);
  load(UIGFX_BAND, SLOT_BAND, 0x77A0, 0x200, 0);
  load(UIGFX_STRIPE[digits - 1], SLOT_STRIPE, 0x67A0, 0xE00, 0);
  if (digits == 3) {
    int leading = 1;
    int hundreds = (n / 100) & 0xFF;
    n = (n % 100) & 0xFFFF;
    if (hundreds != 0) { leading = 0; load_digit(hundreds, 0x69E0, 0x6A60); }
    int tens = (n / 10) & 0xFF;
    n = (n % 10) & 0xFFFF;
    if (tens != 0 || !leading) { leading = 0; load_digit(tens, 0x6BA0, 0x6C20); }
    if ((n & 0xFF) != 0 || !leading) load_digit(n & 0xFF, 0x6BE0, 0x6C60);
  } else if (digits == 2) {
    load_digit((n / 10) & 0xFF, 0x69E0, 0x6A60);
    load_digit((n % 10) & 0xFFFF, 0x6BA0, 0x6C20);
  } else load_digit(n & 0xFF, 0x69E0, 0x6A60);
}

// Task_805C6B0: the band, sliding in from the right from frame 16 to 26, rising 8 lines a frame from frame 34 to the
// top, and from frame 246 sliding off to the left a glyph at a time
static void band_step(Task *t) {
  Piece *d = t->data;
  UiText *o = &d->o;
  if (d->unk18 > 0xF5) {
    if (s16(o->unkA) < -0x20) {
      o->unkA = u16(o->unkA + 0x20);
      if (o->unkE != 0) o->unkE = u16(o->unkE - 1);
    }
    o->unkA = u16(o->unkA - 0x1A);
  } else if (d->unk18 > 0x2D) o->unkC = 0x11;
  else if (d->unk18 > 0x21) o->unkC = u16(o->unkC - 8);
  else if (d->unk18 > 0x19) o->unkA = u16(-0x10);
  else if (d->unk18 > 0xF) {
    o->unkA = u16(o->unkA - 0x1A);
    if (s16(o->unkA) < -0x10) o->unkA = u16(-0x10);
  }
  draw_ui_text(BAND, o, 0);
}

// the stripe's picture a glyph further on, as it scrolls past one
static void stripe_scroll(Piece *d) {
  if (s16(d->o.unkA) < -0x1F) {
    d->o.unkA = u16(d->o.unkA + 0x20);
    d->unk1A = (d->unk1A + 1) % 7;
  }
}

// Task_805C740: the stripe, coming in from the right from frame 16 with the band and scrolling left 2 pixels a frame
// from frame 26, a glyph of the picture at a time; it rises with the band and leaves the same way
static void stripe_step(Task *t) {
  Piece *d = t->data;
  UiText *o = &d->o;
  if (d->unk18 > 0xF5) {
    o->unkA = u16(o->unkA - 0x1C);
    if (s16(o->unkA) < -0x1F) {
      if (o->unkE != 0) o->unkE = u16(o->unkE - 1);
      o->unkA = u16(o->unkA + 0x20);
      d->unk1A = (d->unk1A + 1) % 7;
    }
    draw_ui_text(STRIPE + d->unk1A, o, 0);
  } else if (d->unk18 > 0x2D) {
    o->unkC = 0x13;
    o->unkA = u16(o->unkA - 2);
    stripe_scroll(d);
    draw_ui_text(STRIPE + d->unk1A, o, 0);
  } else if (d->unk18 > 0x21) {
    o->unkC = u16(o->unkC - 8);
    o->unkA = u16(o->unkA - 2);
    stripe_scroll(d);
    draw_ui_text(STRIPE + d->unk1A, o, 0);
  } else if (d->unk18 > 0x19) {
    o->unkA = u16(o->unkA - 2);
    o->unkE = 9;
    stripe_scroll(d);
    draw_ui_text(STRIPE + d->unk1A, o, 0);
  } else if (d->unk18 > 0xF) {
    o->unkA = u16(o->unkA - 0x1C);
    if (s16(o->unkA) <= 0xEF) {
      o->unkE = u16(9 - (s16(o->unkA) >> 5));
      stripe_scroll(d);
      draw_ui_text(STRIPE + d->unk1A, o, 0);
    }
  }
}

// Task_805C83C: the word, from frame 34 growing from a line to its height (16 steps, as double-size scaled sprites,
// moving up as it grows), then still until frame 246, when it slides off to the left until it is past x -128
static void word_step(Task *t) {
  Piece *d = t->data;
  UiText *o = &d->o;
  if (d->unk18 > 0xF5) {
    o->unkC = 0x49;
    o->unkA = u16(o->unkA - 0x1C);
    if (s16(o->unkA) < -0x80) {
      o->unkE = 0;
      o->unkA = u16(-0x80);
    } else draw_ui_text(WORD, o, 0);
  } else if (d->unk18 > 0x2D) {
    o->unk2 = u16(o->unk2 + 0x10);
    if (o->unk2 >= 0x100) {
      o->unk2 = 0x100;
      o->unkA = 0x39;
      o->unkC = 0x49;
      draw_ui_text(WORD, o, 0);
    } else {
      o->unkA = 0x29;
      o->unkC = u16(0x54 - (o->unk2 >> 3));
      draw_ui_text_affine(WORD, o);
    }
  } else if (d->unk18 > 0x21) {
    o->unkA = 0x29;
    o->unkC = u16(0x54 - (o->unk2 >> 3));
    o->unk2 = u16(o->unk2 + 0x10);
    if (o->unk2 >= 0x100) o->unk2 = 0x100;
    draw_ui_text_affine(WORD, o);
  }
}
