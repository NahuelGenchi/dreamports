// The language screen, translated from front/language.js (CreateEditLanguageScreen and its tasks, as the USA ROM has
// them). A new game, with no save, starts with it. It fades in from black over 32 frames: LANGUAGE on an orange band,
// にほんご (Japanese) and ENGLISH in a black box, the cursor beside the save's language, and the buttons along the
// bottom, all of it in the language the cursor is on. Once it has faded in, Up or Down moves the cursor to the other
// one. A or Start keeps the choice in the save; the screen fades out to black over 32 frames, the music stops, the save
// is written (14 frames in which nothing runs) and the SEGA logo starts. At power-on the screen leaves its sixth sprite
// (A OK) out, though it loads it. The Options menu's LANGUAGE, which opens it too, isn't in C yet.

#include "sa.h"

typedef struct { uint16_t anims[2]; uint8_t variant, tiles; int16_t x, y; } LangSprite;
// the sprites: by the language (0 Japanese, 1 English) their animation, then their variant, their tiles and where
static const LangSprite TITLE = { { 865, 864 }, 2, 26, 120, 17 };
static const LangSprite JAPANESE = { { 866, 866 }, 10, 12, 141, 70 };
static const LangSprite ENGLISH = { { 863, 863 }, 10, 16, 147, 98 };
#define BUTTON(variant, tiles, x) { { 862, 861 }, variant, tiles, x, 140 }
static const LangSprite SELECT = BUTTON(0, 20, 56), OK = BUTTON(1, 20, 124), BACK = BUTTON(2, 16, 196), START_OK = BUTTON(3, 32, 164);
// from the Options menu, then at power-on, and how many of them are shown
static const LangSprite *const SPRITES[2][6] = { { &TITLE, &JAPANESE, &ENGLISH, &SELECT, &OK, &BACK }, { &TITLE, &JAPANESE, &ENGLISH, &SELECT, &START_OK, &OK } };
static const int SHOWN[2] = { 6, 5 };
#define ANIM_CURSOR 857
#define CURSOR_TILES 4
// the cursor, beside the language: (x, y) by language
static const int16_t CURSOR[2][2] = { { 81, 62 }, { 73, 91 } };
// the picture: 256 colours, its 8-bit tiles and its map, one after the other; the original copies 0x1140 bytes of
// tiles, on past them into the map and beyond
enum { BG_PALETTE = 0, BG_TILES = 0x200, BG_LAYOUT = 0xB40, BG_PALETTE_SIZE = 0x200, BG_TILES_SIZE = 0x1140, BG_LAYOUT_SIZE = 0x500 };

static struct { int at, lang; Sprite sprites[6], cursor; Fade fade; } screen;   // unk28C, unk28D

// a sprite of the screen: its animation from the start, at normal speed, in front (order 18)
static void lang_sprite(Sprite *s, uint16_t anim, uint32_t dest) {
  sprite_init(s);
  s->graphics.dest = dest;
  s->graphics.anim = anim;
  s->prevVariant = 0xFF;
  s->animSpeed = 0x10;
  s->frameFlags = 0x2000;
  s->oamFlags = 0x480;
}

static void choose(Task *t);
static void free_screen(Task *t);

/** CreateEditLanguageScreen: at power-on with `newGame`. */
void create_language_screen(int newGame) {
  int at = newGame ? 1 : 0;
  memset(e.firstRepeat, 20, 10);
  memset(e.nextRepeat, 8, 10);
  create_ui_task();
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1E83;
  ui_gfx_stack_init();
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;
  screen.at = at;
  screen.lang = SAVE_UI_LANGUAGE;
  create_task(choose, &screen, 0x2000, 0, free_screen);
  for (int i = 0; i < 6; i++) {
    const LangSprite *d = SPRITES[at][i];
    Sprite *s = &screen.sprites[i];
    lang_sprite(s, d->anims[screen.lang], vram_malloc(d->tiles));
    s->x = d->x; s->y = d->y; s->variant = d->variant;
    update_sprite(s, 0);
  }
  lang_sprite(&screen.cursor, ANIM_CURSOR, vram_malloc(CURSOR_TILES));
  screen.cursor.x = 33; screen.cursor.y = 25;
  update_sprite(&screen.cursor, 0);
  screen.fade = create_fade(0, 1, 2, 0, 0x100, 0x10);
  fade_step(&screen.fade);
  UiGfx gfx = { 0 };
  gfx.uiGfxID = 0x80; gfx.unk28 = 0; gfx.unk29 = 0; gfx.unk2A = 0x15; gfx.unk2B = -1;
  gfx.tiles = OFFSET_LANGUAGE_BACKGROUND + BG_TILES; gfx.tilesSize = BG_TILES_SIZE;
  gfx.palette = OFFSET_LANGUAGE_BACKGROUND + BG_PALETTE; gfx.paletteSize = BG_PALETTE_SIZE;
  gfx.layout_ = OFFSET_LANGUAGE_BACKGROUND + BG_LAYOUT; gfx.layoutSize = BG_LAYOUT_SIZE;
  load_ui_gfx(&gfx);
}

// sub_806AB70: the sprites in the language chosen, each started over, and the cursor beside it
static void draw(void) {
  for (int i = 0; i < SHOWN[screen.at]; i++) {
    Sprite *s = &screen.sprites[i];
    const LangSprite *d = SPRITES[screen.at][i];
    s->graphics.anim = d->anims[screen.lang];
    s->variant = d->variant;
    s->x = d->x;
    s->y = d->y;
    s->prevVariant = 0xFF;
    update_sprite(s, 0);
    display_sprite(s);
  }
  screen.cursor.x = CURSOR[screen.lang][0];
  screen.cursor.y = CURSOR[screen.lang][1];
  display_sprite(&screen.cursor);
}

static void fade_out(Task *t);
static void turn_fade(Task *t) {
  screen.fade.unk4 = 1;
  screen.fade.unk6 = 0;
  t->main = fade_out;
}

// Task_EditLanguageScreenInit: once the fade has come in, Up or Down to the other language; A (or Start at power-on)
// keeps it, and B from the Options menu doesn't; either turns the fade round, to black from the next frame. The bug
// fixes' setting, which waits for the fade, isn't in C yet, so A is read from the first frame as the original reads it.
static void choose(Task *t) {
  int lang = screen.lang;
  int faded = fade_step(&screen.fade), ready = 1;
  if (faded) {
    if (e.repeated & KEY_DOWN) {
      play_song(SONG_MENU_CURSOR);
      lang = lang != 0 ? 0 : 1;
    } else if (e.repeated & KEY_UP) {
      play_song(SONG_MENU_CURSOR);
      lang = lang != 0 ? lang - 1 : 1;
    }
  }
  screen.lang = lang;
  if (ready && e.pressed & (screen.at ? KEY_A | KEY_START : KEY_A)) {
    play_song(SONG_SELECT);
    SAVE_UI_LANGUAGE = (uint8_t)screen.lang;
    turn_fade(t);
  } else if (ready && e.pressed & KEY_B && !screen.at) {
    play_song(SONG_RETURN);
    turn_fade(t);
  }
  draw();
}

// m4aSoundVSyncOn once the save is written, then the SEGA logo
static void after_write(void) {
  sound_vsync_on();
  create_sega_logo();
}

// Task_806AA00: once black, the screen ends; at power-on the music stops and the save is written, then the SEGA logo
// starts (sLangScreenReturnProcs)
static void fade_out(Task *t) {
  if (!fade_step(&screen.fade)) {
    draw();
    return;
  }
  e.dispCnt &= 0x1FFF;
  e.bldCnt = 0;
  e.bldY = 0;
  destroy_task(t);
  if (!screen.at) return;   // the Options menu isn't in C yet
  // the sound engine is off while the save is written (m4aSoundVSyncOff), so its frames stop with the screen's
  stop_all_songs();
  sound_vsync_off();
  if (save_write()) engine_stall(WRITE_FRAMES, after_write);
  else after_write();
}

// TaskDestructor_EditLanguageScreen: the sprites' tiles freed
static void free_screen(Task *t) {
  (void)t;
  for (int i = 0; i < 6; i++) vram_free(screen.sprites[i].graphics.dest);
  vram_free(screen.cursor.graphics.dest);
}
