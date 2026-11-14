// The Time Attack menu, translated from front/timeattack.js (SAT-R's src/game/sa1/menus/time_attack.c:
// CreateTimeAttackMenu and its tasks), from the main menu's Time Attack. It fades in from black over 16 frames to the
// character select's song: a picture in the save's language with two entries, one to start a run and one to see the
// records, and a bar of sprites behind the chosen one that slides left along it, half a pixel a frame. Up and Down
// move the bar between the entries, wrapping round, with the main menu's key repeat. B fades the screen out to black
// over 16 frames, the song going on, stops the song and opens the main menu again, which fades in with Game Start
// chosen. A fades out too, and leaves for the character select, in Time Attack mode (Start), or the course select
// (Records), the song going on.

#include "sa.h"

// by the save's language (0 Japanese, 1 English): the choice bar's animation, which the USA ROM numbers two lower
// than the decompilation's European one (882 and 881)
static const uint16_t ANIM_BAR[2] = { 880, 879 };
enum { ANIM_FRAME = 860, ENTRIES = 2, START = 0, RECORDS = 1 };
// the bar's variant by entry, then language
static const uint8_t BAR_VARIANTS[2][2] = { { 1, 1 }, { 0, 0 } };
#define BAR_SPEED 0x80
#define BAR_WRAP 0x8000
#define BAR_SPACE 128
#define SCREEN_RIGHT 224
// the picture's blocks in the ROM from where its colours start: the Japanese one's colours (256), tiles (113 of 8
// bits a pixel) and 32 x 20 map, then the English one's with 131 tiles
static const struct { uint32_t palette, paletteSize, tiles, tilesSize, layout, layoutSize; } PICTURES[2] = {
  { 0, 0x200, 0x200, 0x1C40, 0x1E40, 0x500 },
  { 0x2340, 0x200, 0x2540, 0x20C0, 0x4600, 0x500 },
};

static struct { int32_t unk70; int entry, unk76; Sprite s, s2; Fade fade; } menu;

static void choose_entry(Task *t);

static void menu_sprite(Sprite *s, uint16_t anim, uint32_t dest) {
  sprite_init(s);
  s->graphics.anim = anim;
  s->graphics.dest = dest;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
}

/** CreateTimeAttackMenu. */
void create_time_attack_menu(void) {
  int lang = SAVE_UI_LANGUAGE;
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0xF84;
  e.bgScroll[1] = 0;
  memset(&menu, 0, sizeof menu);
  menu_sprite(&menu.s, ANIM_BAR[lang], OBJ_VRAM);
  menu.s.x = 0xE0; menu.s.y = 0x40; menu.s.oamFlags = 0x3C0; menu.s.variant = BAR_VARIANTS[0][lang];
  menu_sprite(&menu.s2, ANIM_FRAME, OBJ_VRAM + 0x2000);
  menu.s2.x = 0; menu.s2.y = 0x40; menu.s2.oamFlags = 0x400;
  create_task(choose_entry, &menu, 0x2000, 0, NULL);
  update_sprite(&menu.s, 0);
  update_sprite(&menu.s2, 0);

  create_ui_task();
  ui_gfx_stack_init();
  int p = lang != 0 ? 1 : 0;
  UiGfx g = { 0 };
  g.uiGfxID = 0x80; g.unk2B = 0; g.unk28 = 0; g.unk29 = 0; g.unk2A = 0x15;
  g.tiles = OFFSET_TIME_ATTACK_MENU + PICTURES[p].tiles; g.tilesSize = PICTURES[p].tilesSize;
  g.palette = OFFSET_TIME_ATTACK_MENU + PICTURES[p].palette; g.paletteSize = PICTURES[p].paletteSize;
  g.layout_ = OFFSET_TIME_ATTACK_MENU + PICTURES[p].layout; g.layoutSize = PICTURES[p].layoutSize;
  load_ui_gfx(&g);
  menu.fade = create_fade(0, 1, 2, 0, 0x200, 0x10);
  fade_step(&menu.fade);
  play_song_or_continue(SONG_CHARACTER_SELECTION);   // nothing plays as the main menu leaves
}

// the bar, repeated along the screen as it slides left, and the frame round the chosen entry
static void draw_menu(void) {
  int lang = SAVE_UI_LANGUAGE;
  menu.unk70 += BAR_SPEED;
  if (menu.unk70 > BAR_WRAP) menu.unk70 -= BAR_WRAP;
  Sprite *s = &menu.s;
  s->y = (int16_t)(menu.entry * 24 + 64);
  s->variant = BAR_VARIANTS[menu.entry][lang];
  update_sprite(s, 0);
  for (int x = (menu.unk70 >> 8) - BAR_SPACE; SCREEN_RIGHT - x > 0; x += BAR_SPACE) {
    s->x = (int16_t)(SCREEN_RIGHT - x);
    display_sprite(s);
  }
  s = &menu.s2;
  s->y = (int16_t)(menu.entry * 24 + 54);
  for (int i = 0; i < 8; i++) {
    s->x = (int16_t)(i * 32);
    display_sprite(s);
  }
}

static void choose(Task *t);

// Task_TimeAttackMenu: the menu shown while it fades in; once it has, the windows and the blend off
static void choose_entry(Task *t) {
  draw_menu();
  if (fade_step(&menu.fade)) {
    e.dispCnt &= ~0xE000;
    e.bldCnt = 0;
    e.bldY = 0;
    t->main = choose;
  }
}

// sub_8010580: the windows and the blend off, the layer's map cleared, and the main menu, fading in; then the song
// stops
static void leave_menu(Task *t) {
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0;
  e.bldY = 0;
  e.mapFill[0].value = 0;
  e.mapFill[0].rect[0] = 0; e.mapFill[0].rect[1] = 0; e.mapFill[0].rect[2] = 0xFF; e.mapFill[0].rect[3] = 0x20;
  destroy_task(t);
  create_main_menu(1);
  stop_song(SONG_CHARACTER_SELECTION);
}

// Task_80103C4: Up and Down choose, A fades the menu out and, once black, leaves for the entry's screen
// (TimeAttack_CreateStartMenu, the character select in Time Attack mode, or TimeAttack_CreateRecordsMenu, the course
// select that shows the records), and B for the main menu
static void choose(Task *t) {
  Fade *fade = &menu.fade;
  if (fade->unk4 != 1) {
    if (e.repeated & KEY_UP) {
      menu.unk70 = 0;
      play_song(SONG_MENU_CURSOR);
      menu.entry = (menu.entry - 1) & 0xFF;
      if (menu.entry > ENTRIES - 1) menu.entry = ENTRIES - 1;
    } else if (e.repeated & KEY_DOWN) {
      menu.unk70 = 0;
      play_song(SONG_MENU_CURSOR);
      if (++menu.entry > ENTRIES - 1) menu.entry = 0;
    }
    if (e.pressed & KEY_A) {
      fade->unk4 = 1;
      fade->unk6 = 0;
      menu.unk76 = 1;
      play_song(SONG_SELECT);
    } else if (e.pressed & KEY_B) {
      fade->unk4 = 1;
      fade->unk6 = 0;
      menu.unk76 = 2;
      play_song(SONG_RETURN);
    }
  } else if (fade_step(fade)) {
    if (menu.unk76 & 1) {
      destroy_task(t);
      if (menu.entry == START) {
        ctx.gameMode = GAME_MODE_TIME_ATTACK;
        create_character_select(0);
      } else {
        ctx.gameMode = GAME_MODE_SINGLE_PLAYER;
        create_course_select_records();
      }
      return;
    }
    leave_menu(t);
    return;
  }
  draw_menu();
  // CreateMainMenu's DmaFill32 over the sprites' first tiles (BG_CHAR_ADDR_FROM_BGCNT(2) + 0x3FC0 overflowing) already
  // shows in the original's picture on the frame before the leave, with the rest of the screen as it was
  if (menu.unk76 == 2 && fade->unk4 == 1 && fade->unk6 + fade->unk8 >= 0x2000) memset(gba_vram + OBJ_VRAM, 0, 0x40);
}
