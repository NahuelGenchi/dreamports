// The card before a Time Attack run, translated from front/timeattackcard.js (SAT-R's
// src/game/sa1/ui/time_attack_records.c: CreateTimeAttackRecords and its task): the course select's A on an act shows
// the character's card over bands that slide to and fro, the zone's name and the act's, the course's name rolling along
// under them, and the character's three best times there, for 240 frames, the music of the course select still
// playing. A or B cut it short, to the frame before it fades out. The act starts as the card ends.

#include "sa.h"

enum { UIGFX_TIMER_DIGITS = 32, UIGFX_OPTIONS = 0x80, CARD_SIZE = 16, TIMES_PER_COURSE = 3 };
#define MAX_COURSE_TIME (10 * 3600)
// the table of cards (gCharacterCards): by character a front picture (layer 0) and a back one (layer 1), each with its
// tiles, their size, colours and map; the zones' names, the acts' and the courses', each with the room its tiles take in
// sprite memory, its animation and its variant (gUnknown_0868B814, 0868B838, 0868B844)
enum { ZONES_AT = 0x80, ACTS_AT = 0xA4, COURSES_AT = 0xB0, COURSES_PER_LANGUAGE = 12 };
enum { COLON = 0x2A, NINE = 0x29, FIVE = 0x25, ZERO = 0x20 };
enum { FIRST_FRAMES = 0x20, LAST_FRAMES = 0xCF, FADE_AT = 0xD0, END_AT = 0xF0 };

/**
 * sub_806A02C and sub_806BDC4: the seven characters of a time, M:SS:CC, as the UI font has them (the digits start at
 * 0x20, the colon is 0x2A); 10:00 and over, which no run has set, reads 9:59:99.
 */
void time_codes(uint32_t time, char out[8]) {
  if (time >= MAX_COURSE_TIME) {
    const char most[8] = { NINE, COLON, FIVE, NINE, COLON, NINE, NINE, 0 };
    memcpy(out, most, 8);
    return;
  }
  uint32_t seconds = time / 60, minutes = seconds / 60, second = seconds - minutes * 60;
  uint32_t hundredths = ((time - seconds * 60) * 200 + 60) / 120;   // gMillisUnpackTable, to the nearest
  out[0] = (char)(ZERO + minutes); out[1] = COLON; out[2] = (char)(ZERO + second / 10); out[3] = (char)(ZERO + second % 10);
  out[4] = COLON; out[5] = (char)(ZERO + hundredths / 10); out[6] = (char)(ZERO + hundredths % 10); out[7] = 0;
}

static void card_sprite(Sprite *s, uint16_t anim, uint32_t dest, int variant, int x, int y) {
  sprite_init(s);
  s->graphics.anim = anim;
  s->graphics.dest = dest;
  s->oamFlags = 0x480;
  s->frameFlags = 0x2000;
  s->animSpeed = 0x10;
  s->prevVariant = 0xFF;
  s->variant = (uint8_t)variant;
  s->x = (int16_t)x;
  s->y = (int16_t)y;
}

void table_sprite(Sprite *s, uint32_t at) {
  card_sprite(s, (uint16_t)rom_u16(at + 2), vram_malloc(rom_u16(at)), (int)rom_u16(at + 4), 0, 0);
}

static struct {
  uint32_t vram;
  int frame, scroll, y;   // unk104, unk108, qUnkY
  char times[TIMES_PER_COURSE][8];
  Fade fade;
  UiText text;
  Sprite sprites[3], name;
} card;

/** TimeAttackRecordsInitUI: the digits' tiles in sprite memory at `vram`, and the character's two cards. */
static void load_graphics(uint32_t vram) {
  UiSlot layout;
  UiGfx digits = { 0 };
  ui_graphics(UIGFX_TIMER_DIGITS, &digits.tiles, &digits.palette, &layout);
  digits.uiGfxID = UIGFX_TIMER_DIGITS; digits.unk2B = 1; digits.layout = &layout;
  digits.tilesSize = 0x580; digits.paletteSize = 0x20; digits.unk28 = 6; digits.vramC = vram; digits.unk2A = 0xD;
  load_ui_gfx(&digits);
  for (int layer = 1; layer >= 0; layer--) {
    uint32_t at = OFFSET_TIME_ATTACK_CARDS + (uint32_t)(ctx.character * 2 + layer) * CARD_SIZE;
    UiGfx g = { 0 };
    g.uiGfxID = UIGFX_OPTIONS; g.unk2B = layer ? 0 : 2; g.layout = &layout;
    g.tiles = rom_ptr(at); g.tilesSize = rom_u32(at + 4); g.palette = rom_ptr(at + 8); g.layout_ = rom_ptr(at + 12);
    g.paletteSize = 0x200; g.layoutSize = 0x600; g.unk28 = 0; g.unk29 = (uint8_t)layer; g.unk2A = layer ? 0x11 : 0x15;
    load_ui_gfx(&g);
  }
}

static void run(Task *t);
static void destroyed(Task *t);

/** CreateTimeAttackRecords, for the act ctx.currentLevel. */
void create_time_attack_card(void) {
  int level = ctx.currentLevel;
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1340;
  e.bgCnt[0] = 0x1E83;
  e.bgCnt[1] = 0x1C86;
  for (int i = 0; i < 4; i++) e.bgScroll[i] = 0;
  memset(&card, 0, sizeof card);
  card.vram = vram_malloc(44);
  load_graphics(card.vram);
  card.y = -90 * 0x100;
  for (int rank = 0; rank < TIMES_PER_COURSE; rank++) time_codes(save_time_record(ctx.character, level, rank), card.times[rank]);
  card.fade = create_fade(0, 1, 2, 0, 0x100, 0x10);
  card.text = (UiText){ .unk8 = 0x18, .unkA = 0xF0, .unkC = 0x8C, .unkE = 8, .unk10 = 1, .unk12 = 6, .unk16 = 1 };
  create_task(run, &card, 0x2000, 0, destroyed);
  uint32_t at = OFFSET_TIME_ATTACK_CARDS;
  int zone = level >> 1, act = level & 1;
  table_sprite(&card.sprites[0], at + ZONES_AT + (uint32_t)zone * 6);
  card.sprites[0].x = 25; card.sprites[0].y = 24;
  table_sprite(&card.sprites[1], at + ACTS_AT + (uint32_t)act * 6);
  card.sprites[1].x = 93; card.sprites[1].y = 27;
  card_sprite(&card.sprites[2], (uint16_t)rom_u16(at + ACTS_AT + 2), vram_malloc(0xC), 2, 25, 80);
  table_sprite(&card.name, at + COURSES_AT + (uint32_t)(SAVE_UI_LANGUAGE * COURSES_PER_LANGUAGE + level) * 6);
  card.name.x = -90; card.name.y = 48;
  for (int i = 0; i < 3; i++) update_sprite(&card.sprites[i], 0);
  update_sprite(&card.name, 0);
  fade_step(&card.fade);
  play_song_or_continue(SONG_COURSE_SELECTION);
}

// sub_806BD24: the three sprites, the course's name rolling along, and the records' lines
static void show(void) {
  UiText *o = &card.text;
  for (int i = 0; i < 3; i++) display_sprite(&card.sprites[i]);
  Sprite *s = &card.name;
  s->x = (int16_t)(card.y >> 8);
  while (s->x < 500) {
    display_sprite(s);
    s->x = (int16_t)(s->x + 200);
  }
  for (int i = 0; i < TIMES_PER_COURSE; i++) {
    o->unkE = 1;
    o->unkA = 0x2C;
    o->unkC = (uint16_t)(i * 0x10 + 0x5C);
    char rank[2] = { (char)(0x21 + i), 0 };
    draw_ui_text(rank, o, 0);
    o->unkE = 7;
    o->unkA = 0x50;
    draw_ui_text(card.times[i], o, 0);
  }
}

// Task_806BBC0: a frame; at its 241st the card goes and the act starts
static void run(Task *t) {
  Fade *fade = &card.fade;
  int frame = card.frame + 1;
  card.scroll++;
  if (frame > END_AT) {
    e.flags &= ~FLAGS_HBLANK_COPY;
    stop_song(SONG_COURSE_SELECTION);
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0;
    e.bldY = 0;
    destroy_task(t);
    // the card's task makes the act, whose stage init starts its song then, at full volume in Time Attack
    front_time_attack_play(ctx.currentLevel);
    return;
  }
  if (frame == FADE_AT) {
    fade->unk4 = 1;
    fade->unk6 = 0;
  } else if ((e.pressed & (KEY_A | KEY_B)) && frame > FIRST_FRAMES && frame <= LAST_FRAMES) frame = LAST_FRAMES;
  set_hblank_copy(REG_BG0HOFS, 4);
  // bands of 24 lines, each way round in turn
  uint32_t offset = (uint32_t)card.scroll & 0xFF;
  for (int line = 0; line < 160;) {
    for (int i = 0; i < 24 && line < 160; i++, line++) {
      put16(e.primary + line * 4, offset & 0x1FF);
      put16(e.primary + line * 4 + 2, 0);
    }
    offset = -offset & 0xFFFF;
  }
  card.frame = frame;
  fade_step(fade);
  card.y -= 2 * 0x100;
  if (card.y < -200 * 0x100) card.y += 200 * 0x100;
  show();
}

// TaskDestructor_806BF38
static void destroyed(Task *t) {
  (void)t;
  for (int i = 0; i < 3; i++) vram_free(card.sprites[i].graphics.dest);
  vram_free(card.name.graphics.dest);
  vram_free(card.vram);
}
