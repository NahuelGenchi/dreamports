// The staff credits and, without all seven Chaos Emeralds, the message after them (SAT-R decompilation,
// src/game/sa1/ui/staff_credits.c and collect_chaos_emeralds_msg.c), as the JavaScript version's engine/credits.js has
// them. The list scrolls up from below, its lines written in sprites, one a letter, between a black band 36 lines tall
// at the top and one 28 tall at the bottom (the two windows, darkened all the way); the company logos come up among the
// lines, the last one stopping in the middle with the copyright under it. One task counts the frames, a second writes
// the lines and a third shows the logos. Then "Hey, go collect all the Chaos Emeralds!" under Eggman holding one, and
// the SEGA logo.

#include "sa.h"

enum {
  SONG_STAFF_CREDITS = 40,
  ANIM_LOGOS = 740, ANIM_COPYRIGHT = 741, ANIM_EGGMAN = 739,
  // the list: 334 lines of a length, a palette, a y offset and 25 letters, with the rows the four logos come at before it
  OFFSET_LIST = 0x6815B4, LINE = 32, OFFSET_LOGO_ROWS = OFFSET_LIST - 24, LOGOS = 4,
  // the message's animation by the save's language, and its variant
  OFFSET_MESSAGE_ANIMS = 0x684550, OFFSET_MESSAGE_VARIANTS = 0x684554,
  // the message's colours (gUnknown_086CC774)
  OFFSET_MESSAGE_COLOURS = 0x6C5650,
  UIGFX_FONT = 0, UIGFX_MESSAGE = 43, UIGFX_BLACK = 45, UIGFX_NAMES = 59, UIGFX_HEADINGS = 60,
  SLOT_FONT = 7, SLOT_NAMES = 8,
  STOP = 8334, FADE_AT = 8520, END_AT = 8550,   // Task_805E698
  ROWS = 7,
  MESSAGE_FRAMES = 400, MESSAGE_FADE = 340,     // Task_80698F4
};
#define WIN(a, b) ((uint16_t)(((a) << 8) | (b)))

static struct {
  Fade fade;
  int count;            // the main task's own
  int shown;            // what it gives the other two
  uint32_t textScroll, logoScroll;
  Sprite logo, copyright;
  Task *text, *logos;
} credits;

static struct {
  Fade fade;
  int count;
  Sprite sprites[3];
} message;

// the list's scroll, 8.8 px a frame, moved on the even frames: Div(0x143000, 0x201C) + 1
static uint32_t scroll_of(int shown) { return (uint32_t)(shown * (bios_div(0x143000, 0x201C) + 1)); }

// Task_805E758: the lines in the window, from the list's scroll
static void text(Task *t) {
  (void)t;
  if (!(credits.shown & 1)) credits.textScroll = scroll_of(credits.shown);
  int32_t top = (int32_t)(credits.textScroll >> 8) - 12;
  int moving = (uint32_t)top > 0x8A;
  uint32_t first = moving ? ((credits.textScroll >> 8) - 0x86) >> 4 : 0;
  int offset = moving ? ((int32_t)(credits.textScroll >> 8) - 0x96) % 16 + 8 : 0;
  int rows = first < 0x139 ? ROWS : (uint8_t)(67 - first);
  int y = 0x24;
  for (int i = 0; i < rows; i++) {
    uint32_t at = OFFSET_LIST + (first + (uint32_t)i) * LINE;
    int length = (int)rom_u8(at), dy = (int8_t)rom_u8(at + 2);
    if (length) {
      int16_t lineY = (int16_t)(moving ? dy + y - offset : dy + 0x8A - top + y);
      if (lineY >= 0x8B) break;
      UiText o = { .unk8 = (uint16_t)(i * 16), .unkA = (uint16_t)(120 - length * 4), .unkC = (uint16_t)lineY, .unkE = (uint16_t)length,
        .unk10 = SLOT_FONT, .unk12 = (uint16_t)(rom_u8(at + 1) + 14), .unk16 = 1 };
      draw_ui_letters((const char *)(gba_rom + at + 3), &o);
    }
    y += 16;
  }
}

// Task_805E888: the logo whose row of the list is in sight, the last one held in the middle once it is there, with the
// copyright 40 px under it. Its animation only runs while it is shown
static void logos(Task *t) {
  (void)t;
  if (!(credits.shown & 1)) credits.logoScroll = scroll_of(credits.shown);
  int32_t top = (int32_t)(credits.logoScroll >> 8) - 12;
  if ((uint32_t)top <= 0x9A) return;
  uint32_t row = (uint32_t)(top - 0x8A) >> 4;
  int offset = (top - 0x8A - 0x10) % 16 + 4, which = 0xFF, at = 0;
  for (int i = 0; i < 10 && which == 0xFF; i++)
    for (int j = 0; j < LOGOS; j++) if (rom_u16(OFFSET_LOGO_ROWS + j * 4) == row + (uint32_t)i) { which = j; at = i; break; }
  if (row >= rom_u16(OFFSET_LOGO_ROWS + 3 * 4) - 3) { which = 3; at = 0; }
  if (which == 0xFF) return;
  Sprite *s = &credits.logo;
  s->y = (int16_t)(24 - offset + at * 16);
  if (s->y >= 0x9B) return;
  s->x = 120;
  if (which > 0) { s->graphics.anim = ANIM_LOGOS; s->variant = (uint8_t)which; }
  if (which == 3) {
    if (s->y < 80) s->y = 80;
    Sprite *c = &credits.copyright;
    c->x = 120; c->y = (int16_t)(s->y + 40);
    update_sprite(c, 0);
    display_sprite(c);
  }
  update_sprite(s, 0);
  display_sprite(s);
}

// Task_805E698: the count the other two go by, the fade to black at the end, and what comes after
static void run(Task *t) {
  credits.shown = credits.count < STOP ? credits.count : STOP;
  credits.count++;
  int faded = credits.count > FADE_AT ? fade_step(&credits.fade) : 0;
  if (credits.count > END_AT && faded) {
    e.dispCnt &= (uint16_t)~0xE000;
    e.bldCnt = 0; e.bldY = 0;
    destroy_task(credits.text);
    destroy_task(credits.logos);
    destroy_task(t);
    if (SAVE_CHAOS_EMERALDS != ALL_EMERALDS) create_emerald_message();
    else create_sega_logo();
  }
}

// sub_805E1E8: the font in the sprites' tiles, the names' colours and the headings' in sprite palette rows 15 and 14,
// and the black tile on BG1
static void load_pictures(void) {
  UiSlot layout;
  UiGfx gfx = { .unk2A = 13, .vramC = OBJ_VRAM + 0x400, .paletteSize = 32, .layout = &layout };
  uint32_t unused;
  gfx.unk2B = SLOT_NAMES; gfx.uiGfxID = UIGFX_NAMES; gfx.tilesSize = 32; gfx.unk28 = 15;
  ui_graphics(UIGFX_NAMES, &gfx.tiles, &gfx.palette, &layout);
  load_ui_gfx(&gfx);
  gfx.unk2B = SLOT_FONT; gfx.uiGfxID = UIGFX_FONT; gfx.tilesSize = 236 * 32; gfx.unk28 = 14;
  ui_graphics(UIGFX_FONT, &gfx.tiles, &unused, &layout);
  ui_graphics(UIGFX_HEADINGS, &unused, &gfx.palette, &(UiSlot){0});
  load_ui_gfx(&gfx);
  gfx.unk2B = 0; gfx.uiGfxID = UIGFX_BLACK; gfx.tilesSize = 32; gfx.unk28 = 0; gfx.unk29 = 1; gfx.unk2A = 5;
  ui_graphics(UIGFX_BLACK, &gfx.tiles, &gfx.palette, &layout);
  load_ui_gfx(&gfx);
}

/** CreateStaffCredits */
void create_staff_credits(void) {
  destroy_tasks(1, 0x1800);
  destroy_tasks(0x1801, 0xFFFF);
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt = 0x1240;
  e.bgCnt[1] = 0x1907;
  for (int i = 2; i < 6; i++) e.bgScroll[i] = 0;

  memset(&credits, 0, sizeof credits);
  credits.count = credits.shown = 0x30;
  vs_sprite(&credits.logo, ANIM_LOGOS, OBJ_VRAM + 0x4000, 0, 0, 0x480, 0, 0);
  update_sprite(&credits.logo, 0);
  vs_sprite(&credits.copyright, ANIM_COPYRIGHT, OBJ_VRAM + 0x6000, 120, 0, 0x480, 1, 0);
  update_sprite(&credits.copyright, 0);
  credits.logos = create_task(logos, NULL, 0x6200, 0, NULL);
  credits.text = create_task(text, NULL, 0x6120, 0, NULL);
  create_task(run, NULL, 0x6000, 0, NULL);
  credits.fade = create_fade(0, 0, 1, 0, 0x80, 8);

  // BG1's first tiles cleared, and its map filled with the black tile
  memset(gba_vram + 0x4000, 0, 0x40);
  e.mapFill[1].value = 1;
  e.mapFill[1].rect[0] = 0; e.mapFill[1].rect[1] = 0; e.mapFill[1].rect[2] = 0xFF; e.mapFill[1].rect[3] = 0x14;
  e.dispCnt |= 0x6000;
  e.winRegs[0] = WIN(0, 240); e.winRegs[2] = WIN(0, 36);
  e.winRegs[1] = WIN(0, 240); e.winRegs[3] = WIN(160 - 28, 160);
  e.winRegs[4] = 0x3F3F; e.winRegs[5] = 0x1F;
  e.bldCnt = 0x1FDF; e.bldAlpha = 0x10; e.bldY = 0x10;
  load_pictures();
  play_song(SONG_STAFF_CREDITS);
}

// Task_80698F4: the sprites stay on their first frame
static void message_run(Task *t) {
  if (++message.count > MESSAGE_FRAMES) {
    e.dispCnt &= 0x1FFF;
    e.bldCnt = 0; e.bldY = 0;
    destroy_task(t);
    create_sega_logo();
    return;
  }
  if (message.count == MESSAGE_FADE) { message.fade.unk6 = 0; message.fade.unk4 = 1; }
  fade_step(&message.fade);
  for (int i = 0; i < 3; i++) display_sprite(&message.sprites[i]);
}

/** CreateGetAllChaosEmeraldsMessage: BG0's tile, the text in the save's language and Eggman, in two sprites, in from black */
void create_emerald_message(void) {
  create_ui_task();
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1D03;
  e.bgScroll[0] = 0; e.bgScroll[1] = 0;
  ui_gfx_stack_init();
  UiSlot layout;
  UiGfx gfx = { .unk2B = 0, .uiGfxID = UIGFX_MESSAGE, .tilesSize = 32, .palette = OFFSET_MESSAGE_COLOURS, .paletteSize = 32,
    .unk28 = 0, .unk29 = 0, .unk2A = 5 };
  uint32_t unused;
  ui_graphics(UIGFX_MESSAGE, &gfx.tiles, &unused, &layout);
  load_ui_gfx(&gfx);
  e.mapFill[0].value = 1;
  e.mapFill[0].rect[0] = 0; e.mapFill[0].rect[1] = 0; e.mapFill[0].rect[2] = 0xFF; e.mapFill[0].rect[3] = 0x14;

  memset(&message, 0, sizeof message);
  create_task(message_run, NULL, 0x2000, 0, NULL);
  int language = SAVE_UI_LANGUAGE & 1;
  vs_sprite(&message.sprites[0], (uint16_t)rom_u16(OFFSET_MESSAGE_ANIMS + language * 2), OBJ_VRAM, 120, 120, 0x480,
    (int)rom_u8(OFFSET_MESSAGE_VARIANTS + language), 0x2000);
  vs_sprite(&message.sprites[1], ANIM_EGGMAN, OBJ_VRAM + 0x2000, 136, 90, 0x480, 0, 0x2000);
  vs_sprite(&message.sprites[2], ANIM_EGGMAN, OBJ_VRAM + 0x4000, 136, 90, 0x480, 1, 0x2000);
  for (int i = 0; i < 3; i++) update_sprite(&message.sprites[i], 0);
  message.fade = create_fade(0, 1, 2, 0, 0x100, 8);
  fade_step(&message.fade);
}
