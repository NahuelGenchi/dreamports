// The player data menu, translated from front/playerdata.js (SAT-R's src/game/sa1/menus/player_data.c: CreatePlayerDataMenu
// and its task), from the Options menu's PLAYER DATA. It fades in from black over 32 frames to its own song: a picture with
// NAME, VS RECORD and OK down its left, the cursor beside the chosen one, which is drawn a little to the right, and the
// player's name in a box, six glyphs of the UI font. Up and Down move the cursor, wrapping round. A or B fades the menu out
// to black over 32 frames; then A opens the chosen screen, the name input (nameinput.c), the VS record (vsrecord.c) or, on
// OK, the Options menu, and B the Options menu.

#include "sa.h"

void create_options_menu(void);

enum { ANIM_CURSOR = 857, NAME = 0, OK = 2, ITEMS = 3, ASCII_GFX = 0, NAME_BOX_GFX = 60 };
enum { FIRST_CHAR = 0x20, CHAR_COUNT = 106, LOWERCASE = 0x70, LOWERCASE_COUNT = 26 };
// the picture's colours, tiles and maps (Japanese, then English), one after the other, after the Options menu's
enum { BACKGROUND_TILES = 0x20, BACKGROUND_TILES_SIZE = 0xBA0, BACKGROUND_LAYOUT_SIZE = 0x500 };
static const uint32_t BACKGROUND_LAYOUTS[2] = { 0x10C0, 0xBC0 };
// by the save's language (0 Japanese, 1 English): the items' animation
static const uint16_t ANIM_ITEMS[2] = { 869, 868 };
// NAME, VS RECORD and OK: their variants, heights and tiles
static const uint8_t VARIANTS[ITEMS] = { 1, 0, 2 }, ITEM_Y[ITEMS] = { 0x41, 0x59, 0x81 }, ITEM_TILES[ITEMS] = { 8, 18, 14 };

// the menu's state, as the original's holds it: the keys that end it (pressedKeys), the cursor (unk118) and whether the
// chosen item is lit (unk119)
static struct {
  uint16_t keys;
  int cursor, chosen;
  Sprite cursorSprite, items[ITEMS];
  uint32_t font;
  UiText text;
  Fade fade;
} menu;

static void choose_item(Task *t);
static void free_menu(Task *t);

/** CreatePlayerDataMenu. */
void create_player_data_menu(void) {
  int lang = SAVE_UI_LANGUAGE;
  e.dispCnt = 0x1140;
  e.bgCnt[0] = 0x1B04;
  e.bldCnt = 0;
  e.bldAlpha = 0;
  e.bldY = 0;
  e.bgScroll[0] = 0;
  e.bgScroll[1] = 0;
  memset(&menu, 0, sizeof menu);
  vs_sprite(&menu.cursorSprite, ANIM_CURSOR, vram_malloc(22), 0, 0, 0x3C0, 0, 0);
  create_task(choose_item, &menu, 0x2000, 0, free_menu);
  update_sprite(&menu.cursorSprite, 0);
  for (int i = 0; i < ITEMS; i++) {
    vs_sprite(&menu.items[i], ANIM_ITEMS[lang], vram_malloc(ITEM_TILES[i]), 25, ITEM_Y[i], 0x3C0, VARIANTS[i], 0);
    update_sprite(&menu.items[i], 0);
  }
  create_ui_task();
  ui_gfx_stack_init();

  // the picture into layer 0, its tiles from the block's first; the slot's layout is left as the stack held it
  UiGfx g = { 0 };
  g.uiGfxID = 0x80; g.unk2B = 0; g.unk28 = 0; g.unk29 = 0; g.unk2A = 0x15;
  g.tiles = OFFSET_PLAYER_DATA_BACKGROUND + BACKGROUND_TILES; g.tilesSize = BACKGROUND_TILES_SIZE;
  g.palette = OFFSET_PLAYER_DATA_BACKGROUND; g.paletteSize = 0x20;
  g.layout_ = OFFSET_PLAYER_DATA_BACKGROUND + BACKGROUND_LAYOUTS[lang]; g.layoutSize = BACKGROUND_LAYOUT_SIZE;
  load_ui_gfx(&g);
  // the font's glyphs and colours into sprite palette row 1, for slot 1; then the name box's colours over them, its slot 2
  // starting at the same tile
  UiSlot fontLayout, boxLayout;
  uint32_t fontTiles, fontPalette, boxTiles, boxPalette;
  ui_graphics(ASCII_GFX, &fontTiles, &fontPalette, &fontLayout);
  menu.font = vram_malloc(0xE0);
  UiGfx f = { 0 };
  f.uiGfxID = ASCII_GFX; f.unk2B = 1; f.layout = &fontLayout; f.unk28 = 1; f.unk2A = 0xD; f.vramC = menu.font;
  f.tiles = fontTiles; f.tilesSize = 0x1C00; f.palette = fontPalette; f.paletteSize = 0x20;
  load_ui_gfx(&f);
  ui_graphics(NAME_BOX_GFX, &boxTiles, &boxPalette, &boxLayout);
  UiGfx b = { 0 };
  b.uiGfxID = NAME_BOX_GFX; b.unk2B = 2; b.layout = &boxLayout; b.unk28 = 1; b.unk2A = 0xC; b.vramC = menu.font;
  b.tiles = boxTiles; b.tilesSize = 0x20; b.palette = boxPalette; b.paletteSize = 0x20;
  load_ui_gfx(&b);

  menu.text = (UiText){ .unkA = 0x8C, .unkC = 0x3D, .unkE = 1, .unk10 = 1, .unk12 = 1, .unk16 = 1 };
  // a byte of the name the font hasn't becomes a space
  uint8_t *name = SAVE_PLAYER_NAME;
  for (int i = 0; i < NAME_LENGTH; i++) if ((uint8_t)(name[i] - FIRST_CHAR) >= CHAR_COUNT) name[i] = FIRST_CHAR;
  menu.fade = create_fade(0, 1, 2, 0, 0x100, 0x10);
  fade_step(&menu.fade);
  play_song(SONG_PLAYER_DATA);
}

// sub_8011C94: the cursor, the items (the chosen one moved right) and the name, a glyph at a time
static void draw_menu(void) {
  Sprite *s = &menu.cursorSprite;
  s->x = 9;
  s->y = (int16_t)(ITEM_Y[menu.cursor] - 2);
  display_sprite(s);
  for (int i = 0; i < ITEMS; i++) {
    Sprite *item = &menu.items[i];
    if (menu.cursor == i) {
      item->x = 30;
      item->palId = menu.chosen ? 1 : 0;
    } else item->x = 25;
    item->y = ITEM_Y[i];
    display_sprite(item);
  }
  const uint8_t *name = SAVE_PLAYER_NAME;
  for (int i = 0; i < NAME_LENGTH; i++) {
    menu.text.unkA = (uint16_t)(i * 8 + 0x9F);
    menu.text.unkC = (uint8_t)(name[i] - LOWERCASE) < LOWERCASE_COUNT ? 0x44 : 60;
    draw_ui_text((const char *)&name[i], &menu.text, 0);
  }
}

// PlayerDataSelectName, PlayerDataSelectVsRecord and PlayerDataSelectOK
static void pick(Task *t, void (*create)(void)) {
  destroy_task(t);
  create();
}

// Task_PlayerDataMenuInit: once the fade has come in, Up and Down choose, and A or B turns the fade round; once black, A
// opens the chosen screen and B the Options menu
static void choose_item(Task *t) {
  if (fade_step(&menu.fade)) {
    if (menu.fade.unk4 == 2) {
      if (e.repeated & KEY_UP) {
        play_song(SONG_MENU_CURSOR);
        menu.cursor = menu.cursor == NAME ? OK : menu.cursor - 1;
      } else if (e.repeated & KEY_DOWN) {
        play_song(SONG_MENU_CURSOR);
        menu.cursor = menu.cursor == OK ? NAME : menu.cursor + 1;
      }
      if (e.pressed & (KEY_A | KEY_B)) {
        menu.keys = e.pressed;
        menu.fade.unk4 = 1;
        menu.fade.unk6 = 0;
        play_song(e.pressed & KEY_A ? SONG_SELECT : SONG_RETURN);
      }
    } else if (menu.keys & KEY_A) {
      static void (*const PICK[ITEMS])(void) = { create_name_input, create_vs_record, create_options_menu };
      menu.chosen = 1;
      pick(t, PICK[menu.cursor]);
      return;
    } else if (menu.keys & KEY_B) {
      pick(t, create_options_menu);
      return;
    }
  }
  draw_menu();
}

// TaskDestructor_PlayerDataMenu: the sprites' tiles and the font's freed
static void free_menu(Task *t) {
  (void)t;
  vram_free(menu.cursorSprite.graphics.dest);
  for (int i = 0; i < ITEMS; i++) vram_free(menu.items[i].graphics.dest);
  vram_free(menu.font);
}
