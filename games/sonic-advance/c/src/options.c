// The Options menu, translated from front/options.js (SAT-R's src/game/sa1/menus/options.c: CreateOptionsMenu and its
// tasks), from the main menu's Options. It fades in from black over 32 frames to the song of Scrap Brain Zone's remix:
// OPTIONS scrolling along a blue bar at the top, and under it the eight items, with the cursor beside the chosen one,
// which is drawn a little to the right. Up and Down choose, wrapping round.
//
// A on LEVEL, TIME UP or BUTTON CONFIG. lights the item, and Left and Right then set it, straight into the save in
// memory; A or B puts it down. A on DELETE GAME DATA asks DELETE ALL DATA? and then REALLY?, over the menu, Left and
// Right choosing YES or NO; A on NO or B goes back a step. YES on both empties the save in memory but for its language.
// END, or B anywhere on the menu, fades it out to black, writes the save (14 frames in which nothing runs) and goes
// back to the main menu, which fades in with Game Start chosen and no music.
//
// PLAYER DATA, SOUND TEST and LANGUAGE open screens that aren't in C yet, so A on them does nothing, as Tiny Chao
// Garden's does on the main menu. Erasing the save in the browser isn't in the kit in C yet, so DELETE GAME DATA
// empties the save in memory only: the save the browser keeps comes back on a reload until the next write.

#include "sa.h"

void create_main_menu(int back);

enum { SONG_OPTIONS = 11, ERASE_FRAMES = 1 };   // MUS_OPTIONS: the Options menu (Scrap Brain Zone's remix); the flash erase keeps the CPU busy a frame
#define WIN_RANGE(a, b) (((a) << 8) | (b))   // a window's two ends, as the original's WIN_RANGE packs them
#define ITEMS 8
enum {
  ITEM_PLAYER_DATA, ITEM_LEVEL, ITEM_TIME_UP, ITEM_SOUND_TEST, ITEM_LANGUAGE, ITEM_BUTTON_CONFIG, ITEM_DELETE, ITEM_END,
};
enum { ANIM_CURSOR = 857, ANIM_BAR = 867, ANIM_PROMPT = 877, ANIM_COLOURS = 863, LANGUAGE_VARIANT = 10, COLOURS_VARIANT = 15 };
enum { CHOICE_YES = 1, CHOICE_NO = 2 };   // the question's choice, as the menu's state holds it while it asks
enum { DIFFICULTY_NORMAL = 0, DIFFICULTY_EASY = 1, BUTTONS_NORMAL = 0, BUTTONS_REVERSE = 1 };
enum { SAVE_DIFFICULTY = 0x18, SAVE_TIME_LIMIT = 0x1A, SAVE_BUTTONS = 0x1B };
enum { WINDOWS_OFF_BITS = 0xE000 };   // DISPCNT_WIN0_ON | DISPCNT_WIN1_ON | DISPCNT_OBJWIN_ON

// by the save's language (0 Japanese, 1 English): the items' and the language's animation, and the title's
static const uint16_t ANIM_ITEMS[2] = { 866, 863 }, ANIM_TITLE[2] = { 865, 864 };
static const uint8_t ITEM_TILES[ITEMS] = { 0x1A, 0x0C, 0x10, 0x18, 0x14, 0x1E, 0x24, 0x08 };
// the values' variants: LEVEL by the difficulty, TIME UP by the time limit (ON, OFF), BUTTON CONFIG. by its setting
static const uint8_t LEVEL_VARIANTS[2] = { 11, 12 }, TIME_UP_VARIANTS[2] = { 8, 9 }, BUTTON_VARIANTS[2] = { 13, 14 };
// the question's variants: DELETE ALL DATA? by language, then REALLY? by language
static const uint8_t PROMPT_VARIANTS[4] = { 2, 0, 3, 1 };
// the window over YES or NO as WIN1H and WIN1V, by language and then the choice (the original's gUnknown_080BB38E)
static const uint16_t PROMPT_WINDOWS[4][2] = {
  { WIN_RANGE(80, 110), WIN_RANGE(86, 102) }, { WIN_RANGE(122, 158), WIN_RANGE(86, 102) },
  { WIN_RANGE(83, 116), WIN_RANGE(86, 102) }, { WIN_RANGE(130, 156), WIN_RANGE(86, 102) },
};

// the menu's state, as the original's OptionsMenu holds it: its sprites, the cursor (unk33E), the title's scroll
// (unk33C), and whether an item or a question is lit (unk33F, 0 while neither is)
static struct {
  int state, scroll, cursor;
  Sprite cursorSprite, items[ITEMS], level, timeUp, language, buttons, prompt, bar, title, colours;
  Fade fade;
} menu;
static Task *menu_task;

static void choose_item(Task *t);
static void draw_menu(void);
static void ask_delete(Task *t);
static void confirm_delete(Task *t);
static void fade_out(Task *t);
static void leave_menu(Task *t);
static void free_menu(Task *t);
static void set_level(Task *t);
static void set_time_up(Task *t);
static void set_buttons(Task *t);
static void delete_game_data(Task *t);
static void pick_end(Task *t);
static void after_erase(void);
static void back_to_main_menu(void);

// a value beside its item, as the save has it: its words in the save's language
static void show_value(Sprite *s, int x, int y, int variant) {
  s->x = (int16_t)x;
  s->y = (int16_t)y;
  s->prevVariant = 0xFF;
  s->graphics.anim = ANIM_ITEMS[SAVE_UI_LANGUAGE];
  s->variant = (uint8_t)variant;
  update_sprite(s, 0);
  display_sprite(s);
}

static void show_prompt(int variant) {
  menu.prompt.variant = (uint8_t)variant;
  menu.prompt.prevVariant = 0xFF;
  update_sprite(&menu.prompt, 0);
}

// the window over the question's choice (WIN1H and WIN1V)
static void set_prompt_window(int index) {
  e.winRegs[1] = PROMPT_WINDOWS[index][0];
  e.winRegs[3] = PROMPT_WINDOWS[index][1];
}

/** CreateOptionsMenu. */
void create_options_menu(void) {
  int lang = SAVE_UI_LANGUAGE;
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E03;
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;
  create_ui_task();
  ui_gfx_stack_init();
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0;
  e.bldY = 0;

  memset(&menu, 0, sizeof menu);
  menu_task = create_task(choose_item, &menu, 0x2000, 0, free_menu);
  vs_sprite(&menu.cursorSprite, ANIM_CURSOR, vram_malloc(0x16), 0, 0, 0x3C0, 0, 0);
  update_sprite(&menu.cursorSprite, 0);
  for (int i = 0; i < ITEMS; i++) {
    vs_sprite(&menu.items[i], ANIM_ITEMS[lang], vram_malloc(ITEM_TILES[i]), 25, i * 16 + 38, 0x3C0, i, 0);
    update_sprite(&menu.items[i], 0);
  }
  vs_sprite(&menu.level, ANIM_ITEMS[lang], vram_malloc(0x10), 220, 54, 0x3C0, LEVEL_VARIANTS[save.bytes[SAVE_DIFFICULTY]], 0);
  update_sprite(&menu.level, 0);
  vs_sprite(&menu.timeUp, ANIM_ITEMS[lang], vram_malloc(8), 220, 70, 0x3C0, TIME_UP_VARIANTS[save.bytes[SAVE_TIME_LIMIT]], 0);
  update_sprite(&menu.timeUp, 0);
  vs_sprite(&menu.language, ANIM_ITEMS[lang], vram_malloc(0x10), 220, 102, 0x3C0, LANGUAGE_VARIANT, 0);
  update_sprite(&menu.language, 0);
  vs_sprite(&menu.buttons, ANIM_ITEMS[lang], vram_malloc(0x10), 220, 118, 0x3C0, BUTTON_VARIANTS[save.bytes[SAVE_BUTTONS]], 0);
  update_sprite(&menu.buttons, 0);
  vs_sprite(&menu.prompt, ANIM_PROMPT, vram_malloc(0x90), 120, 80, 0, PROMPT_VARIANTS[lang], 0);
  update_sprite(&menu.prompt, 0);
  vs_sprite(&menu.bar, ANIM_BAR, vram_malloc(12), 0, 7, 0x40, 0, 0);
  update_sprite(&menu.bar, 0);
  vs_sprite(&menu.title, ANIM_TITLE[lang], vram_malloc(0x16), 0, 17, 0, 0, 0);
  update_sprite(&menu.title, 0);
  // never shown: it loads the lit items' colours
  vs_sprite(&menu.colours, ANIM_COLOURS, vram_malloc(1), 239, 159, 0, COLOURS_VARIANT, 0x80000);
  update_sprite(&menu.colours, 0);

  UiGfx gfx = { 0 };
  gfx.uiGfxID = 0x80; gfx.unk28 = 0; gfx.unk29 = 0; gfx.unk2A = 0x15; gfx.unk2B = -1;
  gfx.tiles = OFFSET_OPTIONS_BACKGROUND + 0x20; gfx.tilesSize = 0xA0;
  gfx.palette = OFFSET_OPTIONS_BACKGROUND; gfx.paletteSize = 0x20;
  gfx.layout_ = OFFSET_OPTIONS_BACKGROUND + 0xC0; gfx.layoutSize = 0x500;
  load_ui_gfx(&gfx);
  menu.fade = create_fade(0, 1, 2, 0, 0x100, 0x10);
  fade_step(&menu.fade);
  play_song(SONG_OPTIONS);
}

// Task_OptionsMenuMain: once the fade has come in, Up and Down choose and A picks; B ends the menu
static void choose_item(Task *t) {
  menu.state = 0;
  e.bgScroll[0] = 0;
  if (fade_step(&menu.fade) && menu.fade.unk4 == 2) {
    if (e.repeated & KEY_UP) {
      play_song(SONG_MENU_CURSOR);
      menu.cursor = (menu.cursor + ITEMS - 1) % ITEMS;
    } else if (e.repeated & KEY_DOWN) {
      play_song(SONG_MENU_CURSOR);
      menu.cursor = (menu.cursor + 1) % ITEMS;
    }
    if (e.pressed & KEY_A) {
      if (menu.cursor != ITEM_PLAYER_DATA && menu.cursor != ITEM_SOUND_TEST && menu.cursor != ITEM_LANGUAGE) {
        play_song(SONG_SELECT);
        menu.state = 1;
        switch (menu.cursor) {
          case ITEM_LEVEL: t->main = set_level; break;
          case ITEM_TIME_UP: t->main = set_time_up; break;
          case ITEM_BUTTON_CONFIG: t->main = set_buttons; break;
          case ITEM_DELETE: delete_game_data(t); return;
          case ITEM_END: pick_end(t); return;
        }
        draw_menu();
        return;
      }
    } else if (e.pressed & KEY_B) {
      play_song(SONG_RETURN);
      pick_end(t);
      return;
    }
  }
  draw_menu();
}

// sub_8010CB4: the cursor, the items (the chosen one moved right, and lit while it is being set), the values as the save
// has them, the bar, and OPTIONS scrolling left a pixel a frame
static void draw_menu(void) {
  Sprite *s = &menu.cursorSprite;
  s->x = 9;
  s->y = (int16_t)(menu.cursor * 16 + 28);
  display_sprite(s);
  for (int i = 0; i < ITEMS; i++) {
    Sprite *item = &menu.items[i];
    if (menu.cursor == i) {
      item->palId = menu.state != 0 ? 1 : 0;
      item->x = 30;
    } else {
      item->x = 25;
    }
    item->y = (int16_t)(i * 16 + 38);
    display_sprite(item);
  }
  show_value(&menu.level, 220, 54, LEVEL_VARIANTS[save.bytes[SAVE_DIFFICULTY]]);
  show_value(&menu.timeUp, 220, 70, TIME_UP_VARIANTS[save.bytes[SAVE_TIME_LIMIT]]);
  menu.language.x = 220;
  menu.language.y = 102;
  display_sprite(&menu.language);
  show_value(&menu.buttons, 220, 118, BUTTON_VARIANTS[save.bytes[SAVE_BUTTONS]]);
  for (int i = 0; i < 8; i++) {
    menu.bar.x = (int16_t)(i * 32);
    menu.bar.y = 15;
    display_sprite(&menu.bar);
  }
  if (++menu.scroll >= 100) menu.scroll -= 100;
  for (int i = 0; i < 4; i++) {
    menu.title.x = (int16_t)(100 * i - menu.scroll);
    menu.title.y = 17;
    display_sprite(&menu.title);
  }
}

// sub_8010E90, sub_8010F00 and sub_8010F70: Left and Right set the save's byte, A or B puts the item down
static void set_setting(Task *t, int at, uint8_t left, uint8_t right) {
  if (e.repeated & KEY_LEFT) {
    play_song(SONG_MENU_CURSOR);
    save.bytes[at] = left;
  } else if (e.repeated & KEY_RIGHT) {
    play_song(SONG_MENU_CURSOR);
    save.bytes[at] = right;
  }
  draw_menu();
  if (e.pressed & (KEY_A | KEY_B)) {
    play_song(SONG_SELECT);
    t->main = choose_item;
  }
}
static void set_level(Task *t) { set_setting(t, SAVE_DIFFICULTY, DIFFICULTY_EASY, DIFFICULTY_NORMAL); }
static void set_time_up(Task *t) { set_setting(t, SAVE_TIME_LIMIT, 1, 0); }
static void set_buttons(Task *t) { set_setting(t, SAVE_BUTTONS, BUTTONS_NORMAL, BUTTONS_REVERSE); }

// sub_8011104: DELETE ALL DATA? with NO chosen, and the window over NO brightened. Left and Right choose the window;
// A on NO or B closes it, and A on YES asks REALLY?
static void choose_answer(int lang) {
  if (e.repeated & KEY_LEFT) {
    play_song(SONG_MENU_CURSOR);
    menu.state = CHOICE_YES;
  } else if (e.repeated & KEY_RIGHT) {
    play_song(SONG_MENU_CURSOR);
    menu.state = CHOICE_NO;
  }
  set_prompt_window((menu.state - 1) + lang * 2);
}

// OptionsSelectDeleteGameData: DELETE ALL DATA? from the next frame, NO chosen, and the window over NO brightened
static void delete_game_data(Task *t) {
  int lang = SAVE_UI_LANGUAGE;
  menu.state = CHOICE_NO;
  show_prompt(PROMPT_VARIANTS[lang]);
  draw_menu();
  e.dispCnt |= 0x4000;
  e.bldCnt = 0x3FBF;
  e.bldAlpha = 0x10;
  e.bldY = 12;
  set_prompt_window(lang * 2 + 1);
  e.winRegs[4] = 0x3F00;   // WININ
  e.winRegs[5] = 0x1F;     // WINOUT
  t->main = ask_delete;
}

// the windows and the blend off, and the question's lit item put down
static void close_question(void) {
  e.dispCnt &= ~WINDOWS_OFF_BITS;
  e.bldCnt = 0;
  e.bldY = 0;
  menu.state = 0;
}

static void ask_delete(Task *t) {
  int lang = SAVE_UI_LANGUAGE;
  choose_answer(lang);
  if (e.pressed & KEY_B || (e.pressed & KEY_A && menu.state != CHOICE_YES)) {
    close_question();
    play_song(SONG_RETURN);
    t->main = choose_item;
  } else if (e.pressed & KEY_A) {
    show_prompt(PROMPT_VARIANTS[lang + 2]);
    menu.state = CHOICE_NO;
    play_song(SONG_SELECT);
    t->main = confirm_delete;
  }
  display_sprite(&menu.prompt);
  draw_menu();
}

// sub_801123C: REALLY? A on NO or B goes back to DELETE ALL DATA?; A on YES stops the music and erases the flash, and the
// save is emptied once that frame's stall is over, keeping its language, and the menu goes on with its music from the start
static void confirm_delete(Task *t) {
  int lang = SAVE_UI_LANGUAGE;
  choose_answer(lang);
  if (e.pressed & KEY_B || (e.pressed & KEY_A && menu.state != CHOICE_YES)) {
    menu.state = CHOICE_NO;
    show_prompt(PROMPT_VARIANTS[lang]);
    play_song(SONG_RETURN);
    t->main = ask_delete;
  } else if (e.pressed & KEY_A) {
    stop_all_songs();
    save_erase();
    engine_stall(ERASE_FRAMES, after_erase);
    return;
  }
  display_sprite(&menu.prompt);
  draw_menu();
}

// the frame the flash's erase keeps the CPU busy for: the save emptied, and the menu back
static void after_erase(void) {
  int lang = SAVE_UI_LANGUAGE;
  play_song(SONG_SELECT);
  save_empty();
  SAVE_UI_LANGUAGE = (uint8_t)lang;
  close_question();
  play_song(SONG_OPTIONS);
  menu_task->main = choose_item;
  display_sprite(&menu.prompt);
  draw_menu();
}

// OptionsSelectEnd: the fade turned round, to black from the next frame
static void pick_end(Task *t) {
  menu.fade.unk4 = 1;
  menu.fade.unk6 = 0;
  fade_step(&menu.fade);
  t->main = fade_out;
  draw_menu();
}

// sub_801176C: once black, the music stops, and the menu ends on the next frame
static void fade_out(Task *t) {
  if (fade_step(&menu.fade)) {
    stop_all_songs();
    t->main = leave_menu;
  }
  draw_menu();
}

// sub_80114A0: the save written (when it has changed), then the main menu, fading in
static void leave_menu(Task *t) {
  destroy_task(t);
  stop_all_songs();
  if (save_write()) engine_stall(WRITE_FRAMES, back_to_main_menu);
  else back_to_main_menu();
}

static void back_to_main_menu(void) {
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0xFF;
  e.bldY = 0;
  create_main_menu(1);
}

// TaskDestructor_OptionsMenu: the sprites' tiles freed
static void free_menu(Task *t) {
  (void)t;
  vram_free(menu.cursorSprite.graphics.dest);
  for (int i = 0; i < ITEMS; i++) vram_free(menu.items[i].graphics.dest);
  vram_free(menu.level.graphics.dest);
  vram_free(menu.timeUp.graphics.dest);
  vram_free(menu.language.graphics.dest);
  vram_free(menu.buttons.graphics.dest);
  vram_free(menu.prompt.graphics.dest);
  vram_free(menu.bar.graphics.dest);
  vram_free(menu.title.graphics.dest);
  vram_free(menu.colours.graphics.dest);
}
