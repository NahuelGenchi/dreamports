// The language screen, which a game with nothing saved starts with (0x08000390 calls it). Six buttons, the one for the
// language chosen in the bright colours and the rest in the dim, the title and the line along the bottom in that
// language, over a layer that scrolls up and to the right a pixel and a half a frame. Up and Down move through the
// languages, going round at either end. A or Start keeps the language; the name entry it goes on to in the original
// isn't in C yet, so the screen stays.

#include "core.h"

#define LANGUAGES 6
// the language a game with nothing saved starts on: English (the save 0x08001DDC clears)
#define FIRST_LANGUAGE 1
enum { SE_SELECT = 0x6A, SE_DPAD_SELECT = 0x6C };
// where the buttons start, with the layer's scroll of -10 taken in (0x0808FF8C)
enum { BUTTON_X = 40, BUTTON_Y = 48, TITLE_X = 120, TITLE_Y = 36, LINE_X = 120, LINE_Y = 150 };

// the tables the sprites come from: the title by language, the line along the bottom, and the buttons with their
// tiles (0x0808FA44), the cursor, and the sprites' colours
#define TITLES 0xD6D70u
#define BUTTONS 0xD6D40u
#define LINES 0xD6D30u
#define CURSOR 0xD6C90u
#define COLOURS 0xD6890u
static uint32_t title_at(int i) { return TITLES + i * 8; }
static uint32_t button_at(int i) { return BUTTONS + i * 8; }
static uint32_t line_at(int i) { return LINES + i * 8; }

static struct {
  int choice;
  int32_t scrollX, scrollY;
  Sprite title, buttons[LANGUAGES], line, cursor;
} screen;

static void choose(Task *t);

/** 0x08000390, then 0x0808F82C: the screen's task, its sprites and its layers. */
void language_screen(void) {
  default_display();
  memset(&screen, 0, sizeof screen);
  screen.choice = FIRST_LANGUAGE;
  c.bgScroll[2] = 0;
  c.bgScroll[3] = 0xFFF6;
  // 0x0808FA44: the sprites' tiles one after the other, and the window that covers the screen
  uint32_t tiles = OBJ_VRAM;
#define SHOWN(s, anim, variant, count, oamFlags) \
  do { sprite_init(s, tiles, (uint16_t)(anim), (uint8_t)(variant), oamFlags); tiles += (count) * 32; update_sprite(s); } while (0)
  SHOWN(&screen.title, rom_u16(title_at(FIRST_LANGUAGE)), rom_u8(title_at(FIRST_LANGUAGE) + 2), 50, 0);
  for (int i = 0; i < LANGUAGES; i++)
    SHOWN(&screen.buttons[i], rom_u16(button_at(i)), rom_u8(button_at(i) + 2), rom_u32(button_at(i) + 4), 0x40);
  SHOWN(&screen.line, rom_u16(line_at(1)), rom_u8(line_at(1) + 2), 42, 0);
  SHOWN(&screen.cursor, rom_u16(CURSOR), rom_u8(CURSOR + 2), rom_u32(CURSOR + 4), 0);
#undef SHOWN
  c.winRegs[0] = 240;
  c.winRegs[2] = 160;
  c.winRegs[4] |= 0x3F;
  c.winRegs[5] |= 0x1F;
  c.bldCnt = 0x3FFF;
  c.bldY = 0;
  // 0x0808F96C: mode 1 with layers 0 and 1, and each layer's picture
  c.dispCnt = 0x1341;
  c.bgCnt[0] = 0x0603;
  c.bgScroll[0] = 0;
  c.bgScroll[1] = 0;
  draw_background(349, 0, 0x3000, 32, 32, 0);
  c.bgCnt[1] = 0x5E06;
  draw_background(350, 0x4000, 0xF000, 30, 20, 1);
  // the sprites' colours (0x080C7194, CpuFastSet), all of them
  for (int i = 0; i < 256; i++) c.objPalette[i] = (uint16_t)rom_u16(COLOURS + i * 2);
  c.flags |= FLAGS_UPDATE_OBJ_PALETTES;
  create_task(choose, &screen, 0x100);
}

// 0x0808FDC4: the buttons, each at its place, the one chosen with the first palette and the rest the second
static void show_buttons(void) {
  for (int i = 0; i < LANGUAGES; i++) {
    Sprite *s = &screen.buttons[i];
    s->x = BUTTON_X;
    s->y = (int16_t)(BUTTON_Y + i * 16);
    s->palId = i == screen.choice ? 0 : 1;
    update_sprite(s);
    display_sprite(s);
  }
}

// 0x0808FEBC: the title, in the language chosen
static void show_title(void) {
  Sprite *s = &screen.title;
  s->anim = (uint16_t)rom_u16(title_at(screen.choice));
  s->variant = (uint8_t)rom_u8(title_at(screen.choice) + 2);
  s->x = TITLE_X;
  s->y = TITLE_Y;
  update_sprite(s);
  display_sprite(s);
}

// 0x0808FE4C: the line along the bottom, the first for Japanese and the second for the rest
static void show_line(void) {
  Sprite *s = &screen.line;
  uint32_t at = line_at(screen.choice ? 1 : 0);
  s->anim = (uint16_t)rom_u16(at);
  s->variant = (uint8_t)rom_u8(at + 2);
  s->x = LINE_X;
  s->y = LINE_Y;
  update_sprite(s);
  display_sprite(s);
}

// 0x0808FF08: the cursor around the button chosen
static void show_cursor(void) {
  Sprite *s = &screen.cursor;
  s->x = BUTTON_X - 1;
  s->y = (int16_t)(BUTTON_Y + screen.choice * 16 + 1);
  display_sprite(s);
}

// 0x0808FC64: the keys, the layer's scroll and the sprites
static void choose(Task *t) {
  (void)t;
  if (c.pressed & (KEY_A | KEY_START)) {
    play_song(SE_SELECT);
    c.language = (uint8_t)screen.choice;
  } else if (c.repeated & (KEY_UP | KEY_DOWN)) {
    play_song(SE_DPAD_SELECT);
    if (c.repeated & KEY_UP) screen.choice = screen.choice == 0 ? LANGUAGES - 1 : screen.choice - 1;
    else screen.choice = screen.choice == LANGUAGES - 1 ? 0 : screen.choice + 1;
  }
  screen.scrollX += 0x180;
  screen.scrollY -= 0x180;
  c.bgScroll[0] = (uint16_t)(screen.scrollX >> 8);
  c.bgScroll[1] = (uint16_t)(screen.scrollY >> 8);
  show_buttons();
  show_title();
  show_line();
  show_cursor();
}
