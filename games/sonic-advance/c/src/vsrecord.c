// The VS record, translated from front/vsrecord.js (SAT-R's src/game/sa1/ui/vs_record.c: CreateVsRecord and its two
// tasks, the list's only in assembly), from the player data menu's VS RECORD. It fades in from black over 32 frames to its
// own song. At the top, over a frame, are the player's name and their own multiplayer wins, losses and draws; under it a
// list of the ten players they have met, by most wins, each with the wins, losses and draws against them. Up and Down,
// held, scroll the list a pixel a frame, nine rows in view at a time, and arrows show which way it goes on. B, once the
// fade is three quarters in, turns it round, and when it is three quarters dark again the player data menu starts.
//
// The list is a layer of its own (layer 1) under the frame (layer 0), and its rows are sprites behind the frame, so they
// scroll out under it.

#include "sa.h"

enum { ANIM_ARROW = 745, ANIM_COVER = 872, ARROW_TILES = 0x16400, COVER_TILES = 0x17080, ASCII_GFX = 0, NAME_BOX_GFX = 60 };
enum { LOWERCASE = 0x70, LOWERCASE_COUNT = 26 };
// a record: the player's id (4 bytes), their name (8), wins (0xFF for no player), losses and draws, and a byte that stays
// where it is when records swap
enum { RECORDS = 10, RECORD_SIZE = 16, ROWS = 9, NAME = 4, WINS = 12, LOSSES = 13, DRAWS = 14, NO_PLAYER = 0xFF };
enum { SCROLL_END = 0x4200 };   // how far the list scrolls, in 8.8 pixels
enum { COVER = 0x8A, DIGIT = 0x30 };   // a glyph past the font's characters, which covers the plural's S; the digits' first
enum { OWN_WINS = 0x425, OWN_LOSSES = 0x426, OWN_DRAWS = 0x427 };

// the frame (layer 0) and the list (layer 1), each Japanese then English, from the block's start: colours, then tiles, then
// the map
typedef struct { uint32_t at, tilesSize, layoutSize; } Picture;
static const Picture FRAMES[2] = { { 0, 0x7C0, 0x500 }, { 0xCE0, 0x940, 0x500 } };
static const Picture LISTS[2] = { { 0x1B40, 0x620, 0x580 }, { 0x2700, 0x600, 0x580 } };

// the screen's task's state (its frames and the list's scroll, unk40 and unk44) and the list's (unkE8 and unkEC), which
// the screen's hands on each frame
static struct {
  Fade fade;
  uint32_t scroll;
  int frame;
  Sprite arrow;
  Task *list;
} screen;
static struct {
  uint32_t scroll;
  int frame;
  UiText text;
  Sprite cover;
  uint8_t records[RECORDS * RECORD_SIZE];
} list;

static void scroll_list(Task *t);
static void draw_records(Task *t);
static void no_dtor(Task *t) { (void)t; }

// SwapRecords: all but the last byte
static void swap_records(int i, int j) {
  for (int k = 0; k < RECORD_SIZE - 1; k++) {
    uint8_t c = list.records[i * RECORD_SIZE + k];
    list.records[i * RECORD_SIZE + k] = list.records[j * RECORD_SIZE + k];
    list.records[j * RECORD_SIZE + k] = c;
  }
}

static void load_picture(const Picture *p, int layer) {
  UiGfx g = { 0 };
  g.uiGfxID = 0x80; g.unk2B = layer; g.unk28 = (uint8_t)layer; g.unk29 = (uint8_t)layer; g.unk2A = 0x15;
  g.palette = OFFSET_VS_RECORD_BACKGROUNDS + p->at; g.paletteSize = 0x20;
  g.tiles = g.palette + 0x20; g.tilesSize = p->tilesSize;
  g.layout_ = g.tiles + p->tilesSize; g.layoutSize = p->layoutSize;
  load_ui_gfx(&g);
}

// sub_806012C: the frame and the list by language, their colours in palette rows 0 and 1; the font's glyphs at the start
// of sprite VRAM, in sprite palette row 2, for slot 2; then the name box's colours over them, its slot 3 starting at the
// same tile. The layers' slots are left as the stack held them.
static void load_graphics(void) {
  int lang = SAVE_UI_LANGUAGE;
  ui_gfx_stack_init();
  load_picture(&FRAMES[lang], 0);
  load_picture(&LISTS[lang], 1);
  UiSlot fontLayout, boxLayout;
  uint32_t fontTiles, fontPalette, boxTiles, boxPalette;
  ui_graphics(ASCII_GFX, &fontTiles, &fontPalette, &fontLayout);
  UiGfx f = { 0 };
  f.uiGfxID = ASCII_GFX; f.unk2B = 2; f.layout = &fontLayout; f.unk28 = 2; f.unk2A = 0xD; f.vramC = OBJ_VRAM;
  f.tiles = fontTiles; f.tilesSize = 0x1B80; f.palette = fontPalette; f.paletteSize = 0x20;
  load_ui_gfx(&f);
  ui_graphics(NAME_BOX_GFX, &boxTiles, &boxPalette, &boxLayout);
  UiGfx b = { 0 };
  b.uiGfxID = NAME_BOX_GFX; b.unk2B = 3; b.layout = &boxLayout; b.unk28 = 2; b.unk2A = 0xC; b.vramC = OBJ_VRAM;
  b.tiles = boxTiles; b.tilesSize = 0x20; b.palette = boxPalette; b.paletteSize = 0x20;
  load_ui_gfx(&b);
}

/** CreateVsRecord. */
void create_vs_record(void) {
  create_ui_task();
  e.dispCnt = 0x1340;
  stop_song(SONG_PLAYER_DATA);
  play_song(SONG_VS_RECORD);
  e.bgCnt[0] = 0x1F00;
  e.bgCnt[1] = 0x1E07;
  for (int i = 0; i < 4; i++) e.bgScroll[i] = 0;
  load_graphics();

  memset(&screen, 0, sizeof screen);
  memset(&list, 0, sizeof list);
  screen.fade = create_fade(0, 1, 2, 0, 0x100, 8);
  create_task(scroll_list, &screen, 0x2000, 0, no_dtor);
  list.text = (UiText){ .unk10 = 2, .unk12 = 2, .unk16 = 1 };
  vs_sprite(&list.cover, ANIM_COVER, COVER_TILES, 0, 0, 0, 0, 0);
  memcpy(list.records, SAVE_MULTIPLAYER_SCORES, sizeof list.records);
  screen.list = create_task(draw_records, &list, 0x2030, 0, NULL);
  update_sprite(&list.cover, 0);
  vs_sprite(&screen.arrow, ANIM_ARROW, ARROW_TILES, 0, 0, 0, 0, 0);
  update_sprite(&screen.arrow, 0);

  // the records by wins, most first, as signed bytes (so no player last)
  for (int i = 0; i < RECORDS - 1; i++)
    for (int j = i + 1; j < RECORDS; j++)
      if ((int8_t)list.records[i * RECORD_SIZE + WINS] < (int8_t)list.records[j * RECORD_SIZE + WINS]) swap_records(i, j);
  fade_step(&screen.fade);
  play_song(SONG_VS_RECORD);
}

// Task_VsRecordInit: Up and Down, held, scroll the list; the fade; B once it is three quarters in turns it round, and three
// quarters out the screen ends. The arrows, above and below the list, while it can go that way.
static void scroll_list(Task *t) {
  Fade *fade = &screen.fade;
  uint32_t scroll = screen.scroll;
  int frame = screen.frame + 1;
  if (scroll != 0 && (e.input & KEY_UP)) {
    uint32_t next = scroll - 0x100;
    scroll = (next >> 8) ? next : 0;
  } else if (scroll < SCROLL_END && (e.input & KEY_DOWN)) {
    uint32_t next = scroll + 0x100;
    scroll = (next >> 8) < SCROLL_END ? next : SCROLL_END;
  }
  screen.frame = list.frame = frame;
  screen.scroll = list.scroll = scroll;
  fade_step(fade);
  if (fade->unk6 > 0x1800) {
    if ((e.pressed & KEY_B) && fade->unk4 != 1) {
      play_song(SONG_RETURN);
      fade->unk4 = 1;
      fade->unk6 = (int16_t)(0x2000 - (uint16_t)fade->unk6);
      play_song(SONG_RETURN);
    }
    if (fade->unk6 > 0x1800 && fade->unk4 == 1) {
      stop_song(SONG_VS_RECORD);
      destroy_task(screen.list);
      destroy_task(t);
      // layers 1 and 2's maps cleared in the next V-blank
      vs_clear_map(1, 0x20);
      vs_clear_map(2, 0x20);
      create_player_data_menu();
      return;
    }
  }
  Sprite *s = &screen.arrow;
  update_sprite(s, 0);
  s->x = 233;
  if (scroll != 0) {
    s->y = 70;
    s->frameFlags &= ~SPRITE_Y_FLIP;
    display_sprite(s);
  }
  if (scroll != SCROLL_END) {
    s->y = 138;
    s->frameFlags |= SPRITE_Y_FLIP;
    display_sprite(s);
  }
}

// a count as two glyphs: a space and the digit under 10, else its tens and units
static void two_digits(int n, char out[2]) {
  if (n > 9) { out[0] = (char)(n / 10 + DIGIT); out[1] = (char)(n % 10 + DIGIT); }
  else { out[0] = 0x20; out[1] = (char)(n + DIGIT); }
}

static int lower(uint8_t c) { return (uint8_t)(c - LOWERCASE) < LOWERCASE_COUNT; }

// one of the player's own counts: two digits from x2, or one from x1, covered at `cover` (0 for none) when under 2, with
// the cover sprite first when `sprite` is set
static void own_count(int n, int x2, int x1, int cover, int sprite) {
  UiText *o = &list.text;
  if (n > 9) {
    char d[2];
    two_digits(n, d);
    o->unkE = 2;
    o->unkA = (uint16_t)x2;
    draw_ui_glyphs(d, o, 0);
    return;
  }
  o->unkE = 1;
  o->unkA = (uint16_t)x1;
  char digit = (char)(n + DIGIT);
  if (n < 2 && cover) {
    if (sprite) {
      Sprite *s = &list.cover;
      s->x = 152;
      s->y = 32;
      s->frameFlags &= ~SPRITE_Y_FLIP;
      display_sprite(s);
    }
    draw_ui_glyphs(&digit, o, 0);
    o->unkA = (uint16_t)cover;
    char c = (char)COVER;
    draw_ui_glyphs(&c, o, 0);
  } else draw_ui_glyphs(&digit, o, 0);
}

// Task_8060874: the list's layer scrolled; the player's name and own wins, losses and draws (a count under 2 with the cover
// over the plural's S, and in English a sprite over LOSSES' ES); then the rows in view
static void draw_records(Task *t) {
  (void)t;
  UiText *o = &list.text;
  int lang = SAVE_UI_LANGUAGE;
  uint32_t scroll = list.scroll;
  e.bgScroll[3] = (uint16_t)(((scroll >> 8) - 0x30) & 0x1FF);
  const uint8_t *name = SAVE_PLAYER_NAME;
  o->unkE = 1;
  for (int i = 0; i < NAME_LENGTH; i++) {
    o->unkA = (uint16_t)(i * 8 + 0x1B);
    o->unkC = lower(name[i]) ? 40 : 32;
    draw_ui_glyphs((const char *)&name[i], o, 0);
  }
  o->unkC = 32;
  own_count(save.bytes[OWN_WINS], lang ? 0x5B : 0x59, lang ? 0x63 : 0x61, 0x7E, 0);
  own_count(save.bytes[OWN_LOSSES], lang ? 0x88 : 0x89, lang ? 0x90 : 0x91, lang ? 0xB1 : 0, 1);
  own_count(save.bytes[OWN_DRAWS], 0xB9, 0xC1, 0xE2, 0);

  int first = (int)(scroll >> 12), fine = (int)((scroll >> 8) & 0xF);
  for (int i = 0; i < ROWS; i++) {
    int v = (i + first) & 0xFF;
    if (v > RECORDS - 1) continue;
    const uint8_t *rec = list.records + v * RECORD_SIZE;
    uint16_t y = (uint16_t)(i * 16 - (fine - 0x38));
    o->unkE = 1;
    for (int j = 0; j < NAME_LENGTH; j++) {
      o->unkA = (uint16_t)(j * 8 + 0x3C);
      o->unkC = lower(rec[NAME + j]) ? (uint16_t)(y + 8) : y;
      draw_ui_glyphs((const char *)&rec[NAME + j], o, 1);
    }
    char d[2];
    o->unkC = y;
    o->unkA = 0x80;
    o->unkE = 2;
    if (rec[WINS] == NO_PLAYER) { d[0] = 0x20; d[1] = DIGIT; } else two_digits(rec[WINS], d);
    draw_ui_glyphs(d, o, 1);
    o->unkA = 0xA0;
    two_digits(rec[LOSSES], d);
    draw_ui_glyphs(d, o, 1);
    o->unkA = 0xC0;
    two_digits(rec[DRAWS], d);
    draw_ui_glyphs(d, o, 1);
  }
}
