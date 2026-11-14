// The Time Attack records screen, translated from front/timeattackrecord.js (SAT-R's src/game/sa1/ui/time_attack_record.c:
// CreateTimeAttackRecord and its tasks), which the course select shows for an act when the Time Attack menu asked for the
// records: the character's card over bands that slide to and fro, the zone's name and the act's, the course's name, and
// the character's three best times on the act. Left and Right change the character, wrapping round the four; B goes back
// to the course select.

#include "sa.h"

enum { UIGFX_TIMER_DIGITS = 32, UIGFX_OPTIONS = 0x80, TIMES_PER_COURSE = 3, FIRST_FRAMES = 8 };
// the USA ROM numbers the course's name (884 in the decompilation) 882; the cursor keeps its 857
enum { ANIM_NAME = 882, ANIM_CURSOR = 857 };
// the tables in the ROM: the zones' names and the acts' (an animation and its variant each), the cursor's eight
// offsets in turn, and the characters' names
enum { ZONES_AT = 0, ACTS_AT = 0x18, WOBBLE_AT = 0x20, NAMES_AT = 0x28 };
// by character, the back of the card (its tiles and map), and the sizes of its back layer's tiles and of its front's
// (the layout of both is 0x500 bytes)
static const uint32_t BACKS[4][2] = { { 0x6901D0, 0x691AD0 }, { 0x693890, 0x6954D0 }, { 0x689450, 0x68AC50 }, { 0x68C850, 0x68E0D0 } };
static const uint32_t BACK_SIZES[4] = { 0x1900, 0x1C40, 0x1800, 0x1880 }, FRONT_SIZES[4] = { 0x9C0, 0x680, 0x7C0, 0x4C0 };
#define MAP_SIZE 0x500
#define PALETTE_SIZE 0x200
#define CARD_SIZE 16

static struct {
  int course, frame, wait, leaving, shown, previous;   // unkD4, unkDE, unkDF, unkDC, unkDD
  Fade fade;
  UiText text;
  Task *tasks[2];
  Sprite sprites[3], cursor, name;
} record;

static void record_sprite(Sprite *s, uint16_t anim, uint32_t dest, int variant, int x, int y) {
  sprite_init(s);
  s->graphics.anim = anim;
  s->graphics.dest = dest;
  s->oamFlags = 0;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->frameFlags = 0x2000;
  s->variant = (uint8_t)variant;
  s->x = (int16_t)x;
  s->y = (int16_t)y;
}

// the card's two layers for `who`, as sub_8060C88 and sub_8061480 load them: the back, only this screen's, on layer 1,
// and the front, the one the card before the act has, on layer 0
static void load_card(int who) {
  UiSlot noLayout = { 0 };
  uint32_t front = OFFSET_TIME_ATTACK_CARDS + (uint32_t)who * 2 * CARD_SIZE;
  UiGfx back = { 0 };
  back.uiGfxID = UIGFX_OPTIONS; back.unk2B = 1; back.layout = &noLayout;
  back.tiles = BACKS[who][0]; back.tilesSize = BACK_SIZES[who]; back.layout_ = BACKS[who][1]; back.layoutSize = MAP_SIZE;
  back.unk29 = 1; back.unk2A = 0x11;
  load_ui_gfx(&back);
  UiGfx g = { 0 };
  g.uiGfxID = UIGFX_OPTIONS; g.unk2B = 0; g.layout = &noLayout;
  g.tiles = rom_ptr(front); g.tilesSize = FRONT_SIZES[who];
  g.palette = rom_ptr(front + 8); g.paletteSize = PALETTE_SIZE; g.layout_ = rom_ptr(front + 12); g.layoutSize = MAP_SIZE;
  g.unk28 = 0; g.unk29 = 0; g.unk2A = 0x15;
  load_ui_gfx(&g);
}

static void run(Task *t);
static void show_times(Task *t);
static void show_name(Task *t);

/** CreateTimeAttackRecord for the act `course` (the row's number less one). */
void create_time_attack_record(int course) {
  uint32_t tables = OFFSET_TIME_ATTACK_RECORD_TABLES;
  create_ui_task();
  e.dispCnt = 0x1340;
  play_song(SONG_VS_RECORD);
  e.bgCnt[0] = 0x1D83;
  e.bgCnt[1] = 0x1886;
  for (int i = 0; i < 4; i++) e.bgScroll[i] = 0;
  // sub_8060C88
  ui_gfx_stack_init();
  load_card(0);
  UiSlot layout;
  UiGfx digits = { 0 };
  ui_graphics(UIGFX_TIMER_DIGITS, &digits.tiles, &digits.palette, &layout);
  digits.uiGfxID = UIGFX_TIMER_DIGITS; digits.unk2B = 2; digits.layout = &layout;
  digits.tilesSize = 0x580; digits.paletteSize = 0x20; digits.unk28 = 2; digits.vramC = OBJ_VRAM + 0x20; digits.unk2A = 0xD;
  load_ui_gfx(&digits);

  memset(&record, 0, sizeof record);
  record.course = course;
  record.wait = FIRST_FRAMES;
  record.fade = create_fade(0, 1, 2, 0, 0x100, 8);
  record.text = (UiText){ .unk10 = 2, .unk12 = 2, .unk16 = 1 };
  create_task(run, &record, 0x2000, 0, NULL);
  uint32_t zone = tables + ZONES_AT + (uint32_t)(course >> 1) * 4, act = tables + ACTS_AT + (uint32_t)(course & 1) * 4;
  record_sprite(&record.sprites[0], (uint16_t)rom_u16(zone), OBJ_VRAM + 0xC80, (int)rom_u16(zone + 2), 17, 24);
  record_sprite(&record.sprites[1], (uint16_t)rom_u16(act), OBJ_VRAM + 0x1900, (int)rom_u16(act + 2), 85, 27);
  record_sprite(&record.sprites[2], ANIM_NAME, OBJ_VRAM + 0x2580, 2, 21, 81);
  record_sprite(&record.cursor, ANIM_CURSOR, OBJ_VRAM + 0x3200, 0, 20, 80);
  for (int i = 0; i < 3; i++) update_sprite(&record.sprites[i], 0);
  update_sprite(&record.cursor, 0);
  record.tasks[0] = create_task(show_times, &record, 0x2030, 0, NULL);
  record_sprite(&record.name, 0, OBJ_VRAM + 0x8E0, 8, 20, 61);
  record.tasks[1] = create_task(show_name, &record, 0x2080, 0, NULL);
  fade_step(&record.fade);
  play_song_or_continue(SONG_VS_RECORD);
}

// sub_80613D0: the zone's name and the act's, the course's, and the cursor either side, going in and out
static void show(void) {
  for (int i = 0; i < 3; i++) {
    update_sprite(&record.sprites[i], 0);
    display_sprite(&record.sprites[i]);
  }
  Sprite *s = &record.cursor;
  update_sprite(s, 0);
  int offset = (int)rom_u8(OFFSET_TIME_ATTACK_RECORD_TABLES + WOBBLE_AT + ((record.frame / 10) & 0xFF) % 8);
  s->frameFlags |= SPRITE_X_FLIP;
  s->x = (int16_t)(offset + 15);
  display_sprite(s);
  s->frameFlags &= ~SPRITE_X_FLIP;
  s->x = (int16_t)(240 - (offset + 15));
  display_sprite(s);
}

// sub_8061144: the frame counter, Left and Right changing the character and B leaving; the bands; the sprites
static void run(Task *t) {
  Fade *fade = &record.fade;
  record.frame++;
  if (record.wait == 0 && !record.leaving) {
    if (e.repeated & KEY_RIGHT) {
      play_song(SONG_MENU_CURSOR);
      record.wait = 2;
      record.previous = record.shown;
      record.shown = (record.shown + 1) & 3;
    } else if (e.repeated & KEY_LEFT) {
      play_song(SONG_MENU_CURSOR);
      record.wait = 2;
      record.previous = record.shown;
      record.shown = (record.shown - 1) & 3;
    }
    if (e.pressed & KEY_B) {
      play_song(SONG_RETURN);
      record.leaving = 1;
      fade->unk4 = 1;
      fade->unk6 = s16(0x2000 - (fade->unk6 & 0xFFFF));
    }
  } else if (record.wait != 0) record.wait--;
  fade_step(fade);
  if (record.leaving && fade->unk6 > 0x1800 && fade->unk4 == 1) {
    e.flags &= ~FLAGS_HBLANK_COPY;
    stop_song(SONG_VS_RECORD);
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    for (int i = 0; i < 2; i++) destroy_task(record.tasks[i]);
    destroy_task(t);
    create_course_select_records();
    return;
  }
  e.flags |= FLAGS_HBLANK_COPY;
  set_hblank_copy(REG_BG0HOFS, 4);
  // bands of 24 lines, each way round in turn
  uint32_t offset = (uint32_t)record.frame & 0xFFFF;
  for (int line = 0; line < 160;) {
    for (int i = 0; i < 24 && line < 160; i++, line++) {
      put16(e.primary + line * 4, offset & 0x1FF);
      put16(e.primary + line * 4 + 2, 0);
    }
    offset = -offset & 0xFFFF;
  }
  show();
}

// the character whose card and times are up: the one before, for the first frame after Left or Right
static int who_shows(void) { return record.wait < 2 ? record.shown : record.previous; }

// sub_8061480: once a change has been made, the new character's card; then the three times
static void show_times(Task *t) {
  (void)t;
  UiText *o = &record.text;
  int who = who_shows();
  if (record.wait == 1) {
    ui_gfx_stack_init();
    load_card(record.shown);
  }
  for (int i = 0; i < TIMES_PER_COURSE; i++) {
    o->unkE = 1;
    o->unkA = 0x2C;
    o->unkC = (uint16_t)((i << 4) + 92);
    char rank[2] = { (char)(0x21 + i), 0 };
    draw_ui_glyphs(rank, o, 0);
    o->unkE = 7;
    o->unkA = 0x54;
    o->unkC = (uint16_t)((i << 4) + 92);
    char codes[8];
    time_codes(save_time_record(who, record.course, i), codes);
    draw_ui_glyphs(codes, o, 0);
  }
}

// Task_8061830: the character's name
static void show_name(Task *t) {
  (void)t;
  Sprite *s = &record.name;
  uint32_t at = OFFSET_TIME_ATTACK_RECORD_TABLES + NAMES_AT + (uint32_t)who_shows() * 4;
  s->graphics.anim = (uint16_t)rom_u16(at);
  s->variant = (uint8_t)rom_u16(at + 2);
  s->prevVariant = 0xFF;
  update_sprite(s, 0);
  display_sprite(s);
}
