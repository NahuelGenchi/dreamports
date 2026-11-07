// The title screen and the main menu, translated from front/title.js (SAT-R's src/game/sa1/menus/title_screen.c:
// CreateTitleScreen, CreateMainMenu and the tasks after them), after the intro. The background fades in from white
// over 49 frames, then the logo zooms in from four times its size over 13, slowing as it comes. A second after the
// copyright line shows, "PRESS START" blinks above it, on and off every 32 frames, and Start opens the main menu: the
// five items where "PRESS START" was, the chosen one lit. Up and Down move through them, wrapping round, with the key
// repeat, and A on Game Start, VS, Time Attack or Options fades the screen to black and stops the music. Game Start
// opens the character select; the rest, and the title screen's demos, aren't in C yet. A on Tiny Chao Garden does
// nothing.
//
// The logo, "PRESS START" and the menu's items are in the save's language, Japanese or English; the copyright line is
// the international release's in both.

#include "sa.h"
#include "act.h"

// by the save's language (0 Japanese, 1 English): the logo's tilemap, and "PRESS START"'s and the items' animation
static const uint16_t TM_TITLE_LOGO[2] = { 73, 74 };
#define TM_TITLE_BG 75
static const uint16_t ANIM_PRESS_START[2] = { 778, 779 };
#define ANIM_CHAO_HOVER_SIDE 699
#define ANIM_TITLE_COPYRIGHT 780
// the copyright line's variant: the international release's (2002), where 0 is the Japanese one's (2001)
#define COPYRIGHT_VARIANT 1
// the tiles the original gives each sprite: "PRESS START"'s are the Japanese one's, the bigger of the two
#define PRESS_START_TILES (23 * 2)
#define COPYRIGHT_TILES (3 * 30)
enum { MENU_ITEMS = 5, MENU_TOP = 93, MENU_SPACE = 14 };
enum { GAME_START = 0, VS = 1, TIME_ATTACK = 2, OPTIONS = 3 };
static const uint8_t ITEM_TILES[5] = { 28, 16, 28, 20, 40 };
static const uint8_t ITEM_VARIANTS[10] = { 1, 1, 2, 2, 3, 3, 4, 4, 5, 5 };   // by item, then language
#define BLEND_STEP 0x55
#define BLEND_END 0x1000
#define DEMO_WAIT 900
#define DEMO_READY 60   // and how long before it the next demo's act is read from the ROM
enum { RUNNING = 1, ENDED = 0 };
#define SINGLE_PLAYER 0   // gGameMode

void create_character_select(int character);
void create_time_attack_menu(void);
void create_mode_select(void);
void create_options_menu(void);
void create_main_menu(int back);

// a sprite of the title screen or the menu: its animation from the start, at normal speed
static void title_sprite(Sprite *s, uint16_t anim, uint32_t dest) {
  sprite_init(s);
  s->graphics.anim = anim;
  s->graphics.dest = dest;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
}
// the logo's layer, `scale` / 256 times the logo's size with the logo's (141, 26) at (192, 30) on the screen
static void place_logo(int scale) { transform_background(&e.bgAffine[0], 0, scale, scale, 0x8D, 0x1A, 0xC0, 30); }

static void title_background(Background *bg) {
  background_init(bg);
  bg->layoutVram = 20 * 0x800; bg->tilemapId = TM_TITLE_BG; bg->targetTilesX = 30; bg->targetTilesY = 20; bg->flags = 4;
}
static void logo_background(Background *bg) {
  background_init(bg);
  bg->graphics.dest = 3 * 0x4000; bg->layoutVram = 22 * 0x800; bg->tilemapId = TM_TITLE_LOGO[SAVE_UI_LANGUAGE];
  bg->targetTilesX = 24; bg->targetTilesY = 10; bg->flags = 4 | 2;
}
// the layers' maps cleared, the logo's to tile 255, which is cleared too (and the sprites' first two tiles with it)
static void clear_maps(void) {
  e.mapFill[0].value = 0;
  e.mapFill[0].rect[0] = 0; e.mapFill[0].rect[1] = 0; e.mapFill[0].rect[2] = 0xFF; e.mapFill[0].rect[3] = 0x20;
  e.mapFill[2].value = 0xFF;
  e.mapFill[2].rect[0] = 0; e.mapFill[2].rect[1] = 0; e.mapFill[2].rect[2] = 0xFF; e.mapFill[2].rect[3] = 0x20;
  memset(gba_vram, 0, 64);
  memset(gba_vram + 0xFFC0, 0, 0x80);
}

static struct { int32_t qBlend, unkE2, unkE4, unkE6; Sprite s, s2; Background bg, bg2; } title;

static void fade_in(Task *t);
static void zoom_in(Task *t);
static void wait_for_start(Task *t);
static void free_title(Task *t);

/** CreateTitleScreen. With `playMusic`, the title's music starts. */
void create_title_screen(int playMusic) {
  int lang = SAVE_UI_LANGUAGE;
  e.dispCnt = 0x41;
  e.bgCnt[2] = 0x568D;
  e.bgCnt[0] = 0x1482;
  for (int i = 0; i < 6; i++) e.bgScroll[i] = 0;
  clear_maps();

  title.qBlend = BLEND_END; title.unkE2 = 0; title.unkE4 = 0; title.unkE6 = 0;
  title_sprite(&title.s, ANIM_PRESS_START[lang], vram_malloc(PRESS_START_TILES));
  title.s.x = 120; title.s.y = 113; title.s.oamFlags = 0x400; title.s.frameFlags = 0x1000;
  title_sprite(&title.s2, ANIM_TITLE_COPYRIGHT, vram_malloc(COPYRIGHT_TILES));
  title.s2.x = 0; title.s2.y = 134; title.s2.variant = COPYRIGHT_VARIANT; title.s2.oamFlags = 0x400; title.s2.frameFlags = 0x1000;
  title_background(&title.bg);
  logo_background(&title.bg2);
  create_task(fade_in, &title, 0x2000, 0, free_title);
  e.bldCnt = 0x20A5;
  e.bldY = (uint16_t)(title.qBlend >> 8);
  update_sprite(&title.s, 0);
  update_sprite(&title.s2, 0);
  draw_background(&title.bg);
  if (playMusic) play_song(SONG_TITLE_FANFARE);
}

// Task_LoadGameLogo: the background and the sprites shown, the logo's picture loaded, and the screen less white each
// frame. The first screen after a soft reset, which isn't in C yet, takes a frame longer.
static void fade_in(Task *t) {
  e.dispCnt |= 0x100 | 0x1000;
  if (title.qBlend == BLEND_END) draw_background(&title.bg2);
  title.qBlend = s16(title.qBlend - BLEND_STEP);
  e.bldY = (uint16_t)(title.qBlend >> 8);
  if (title.qBlend <= 0) {
    title.unkE4 = 0x400;
    title.unkE6 = 0xFFF0;
    e.bldY = 0;
    t->main = zoom_in;
  }
}

// Task_800D7EC: the logo shown, coming in 16 / 256 of its size, then 8 more each frame, until it is its size
static void zoom_in(Task *t) {
  e.dispCnt |= 0x400;
  title.unkE4 = s16(title.unkE4 + title.unkE6);
  title.unkE6 = (title.unkE6 - 8) & 0xFFFF;
  if (title.unkE4 < 0x100) {
    title.unkE4 = 0x100;
    title.unkE2 = 0;
    t->main = wait_for_start;
  }
  place_logo(title.unkE4);
}

static void to_menu(Task *t);
static void to_demo(Task *t);

// sub_800D878: after 60 frames "PRESS START" blinks and Start opens the menu, and after 900 a demo starts
static void wait_for_start(Task *t) {
  title.unkE2 = (title.unkE2 + 1) & 0xFFFF;
  if (title.unkE2 > 60) {
    if (e.pressed & KEY_START) {
      play_song(SONG_SELECT);
      t->main = to_menu;
      return;
    }
    if (!((title.unkE2 - 60) & 0x20)) display_sprite(&title.s);
  }
  display_sprite(&title.s2);
  if (title.unkE2 > DEMO_WAIT) t->main = to_demo;
}

// Task_SwitchToDemoInit: the act comes next, by itself (engine/demo.js), which isn't in C yet
static void to_demo(Task *t) {
  destroy_task(t);
  front_start_demo();
}

// Task_SwitchToMainMenu
static void to_menu(Task *t) {
  destroy_task(t);
  create_main_menu(0);
}

// TaskDestructor_TitleScreen: the sprites' tiles freed. It frees the running task's, which is always the title
// screen's, since only the title screen destroys itself.
static void free_title(Task *t) {
  (void)t;
  vram_free(title.s.graphics.dest);
  vram_free(title.s2.graphics.dest);
}

static struct { int selectedItem, unk1B0, back; Sprite items[MENU_ITEMS], s; Fade fade; Background bg, bg2; } menu;

static void show_menu(Task *t);
static void choose_item(Task *t);
static void fade_out(Task *t);
static void leave_menu(Task *t);

/**
 * CreateMainMenu: as the title screen opens it (CreateMainMenu(0)), the title screen's layers stay as they are, the
 * logo at its size. Coming `back` from another screen (CreateMainMenu(1)), their maps are cleared and the layers drawn
 * again, and the screen fades in from black over 16 frames.
 */
void create_main_menu(int back) {
  e.dispCnt = 0x1541;
  e.bgCnt[2] = 0x568D;
  e.bgCnt[0] = 0x1482;
  for (int i = 0; i < 6; i++) e.bgScroll[i] = 0;
  menu.selectedItem = 0; menu.unk1B0 = 0; menu.back = back;
  title_sprite(&menu.s, 1, 0x40);
  menu.s.x = 120; menu.s.y = 80; menu.s.frameFlags = 0x10000;
  menu.fade = create_fade(0, 1, 2, 0, 0x200, 1);
  create_task(show_menu, &menu, 0x2000, 0, NULL);
  if (back) {
    // as the title screen does: the maps cleared, the logo's to tile 255, and the tiles it clears straight away
    clear_maps();
    title_background(&menu.bg);
    draw_background(&menu.bg);
    logo_background(&menu.bg2);
    draw_background(&menu.bg2);
  }
  place_logo(0x100);
  if (back) {
    fade_step(&menu.fade);
    // filling both maps and drawing both layers at once takes the console past the next V-blank: the menu's tasks
    // run a frame late
    engine_lag(1, 0);
  }
}

// Task_MainMenuInit: once a fade in has ended, the Chao, which the menu animates but never shows, and the items, shown
// from the next frame; the key repeat set to 20 frames, then 8, and the windows and the blend off
static void show_menu(Task *t) {
  Sprite *s = &menu.s;
  int lang = SAVE_UI_LANGUAGE;
  if (menu.back && !fade_step(&menu.fade)) return;
  if (s->graphics.size == 0) {
    s->x = 0; s->y = 0; s->oamFlags = 0x3C0; s->variant = 0; s->animCursor = 0; s->qAnimDelay = 0; s->prevVariant = 0xFF;
    s->animSpeed = 0x10; s->palId = 0; s->frameFlags = 0x400;
    s->graphics.dest = 0x10000; s->graphics.size = 0; s->graphics.anim = ANIM_CHAO_HOVER_SIDE;
    t->main = choose_item;
  }
  for (int i = 0; i < MENU_ITEMS; i++) {
    Sprite *item = &menu.items[i];
    title_sprite(item, ANIM_PRESS_START[lang], vram_malloc(ITEM_TILES[i]));
    item->x = 120; item->y = (int16_t)(i * MENU_SPACE + MENU_TOP); item->variant = ITEM_VARIANTS[lang + i * 2]; item->oamFlags = 0x3C0;
    update_sprite(item, 0);
  }
  memset(e.firstRepeat, 20, 10);
  memset(e.nextRepeat, 8, 10);
  e.dispCnt &= 0x9FFF;
  e.bldCnt = 0;
  e.bldY = 0;
}

// Task_MainMenu_Select: Up and Down choose, the chosen item a palette row on (Game Start's, unchosen, a row back)
static void choose_item(Task *t) {
  if (e.repeated & KEY_UP) {
    play_song(SONG_MENU_CURSOR);
    menu.selectedItem = (menu.selectedItem - 1) & 0xFF;
    if (menu.selectedItem > MENU_ITEMS - 1) menu.selectedItem = MENU_ITEMS - 1;
  } else if (e.repeated & KEY_DOWN) {
    play_song(SONG_MENU_CURSOR);
    if (++menu.selectedItem > MENU_ITEMS - 1) menu.selectedItem = 0;
  }
  Sprite *s = &menu.s;
  s->x = 72;
  s->y = (int16_t)(menu.selectedItem * MENU_SPACE + 107);
  for (int result; (result = update_sprite(s, 0)) != RUNNING;) if (result == ENDED) break;
  for (int i = 0; i < MENU_ITEMS; i++) {
    Sprite *item = &menu.items[i];
    if (i == menu.selectedItem) item->palId = i != 0 ? 1 : 0;
    else item->palId = i != 0 ? 0 : 255;
    update_sprite(item, 0);
    display_sprite(item);
  }
  // A start point at X Zone opens it here, as the menu hands over to the character select: the act's title card runs
  // without its pictures and its first frame is drawn on the next one, as x-zone-opening does.
  int startLevel = (int)gba_start_number("level", -1);
  if ((e.pressed & KEY_A) && startLevel >= 0 && gba_start_number("power", 0) == 1) {
    act_active = 1;
    act_start(startLevel, (int)gba_start_number("card", -1), (int)gba_start_number("pre", 0));
    act_frame_now();
    destroy_task(t);
    return;
  }
  // Tiny Chao Garden's screen isn't built: A on it does nothing (the original fades out to it too)
  if (e.pressed & KEY_A && menu.selectedItem <= OPTIONS) {
    play_song(SONG_SELECT);
    t->main = fade_out;
    menu.unk1B0 = 0;
    e.bldCnt = 0xFF;   // 0xBF for Tiny Chao Garden
    e.bldY = 0;
  }
}

// Task_800DE44: darker each frame; once black, the layers' maps are cleared
static void fade_out(Task *t) {
  menu.unk1B0 = s16(menu.unk1B0 + BLEND_STEP);
  if (menu.unk1B0 >= BLEND_END) {
    menu.unk1B0 = BLEND_END;
    t->main = leave_menu;
    for (int bg = 0; bg <= 2; bg += 2) {
      e.mapFill[bg].value = 0;
      e.mapFill[bg].rect[0] = 0; e.mapFill[bg].rect[1] = 0; e.mapFill[bg].rect[2] = 0xFF; e.mapFill[bg].rect[3] = 0x20;
    }
    e.flags &= ~FLAGS_HBLANK_COPY;
  }
  e.bldY = (uint16_t)(menu.unk1B0 >> 8);
  for (int i = 0; i < MENU_ITEMS; i++) display_sprite(&menu.items[i]);
}

// Task_800DEE4: the items' tiles freed and the music stopped (a song started on its player, the player cleared and the
// song stopped), then the character select; or the windows and the blend off, and the Time Attack or Options menu
static void leave_menu(Task *t) {
  int item = menu.selectedItem;
  for (int i = 0; i < MENU_ITEMS; i++) vram_free(menu.items[i].graphics.dest);
  destroy_task(t);
  play_song(SONG_BOSS_FIGHT);
  stop_song(SONG_BOSS_FIGHT);
  if (item == GAME_START) {
    ctx.gameMode = SINGLE_PLAYER;
    create_character_select(ctx.character);
    return;
  }
  e.dispCnt &= ~0x6000;
  e.bldCnt = 0;
  e.bldY = 0;
  if (item == TIME_ATTACK) create_time_attack_menu();
  else if (item == VS) create_mode_select();
  else create_options_menu();
}
