// The name input, translated from front/nameinput.js (SAT-R's src/game/sa1/ui/player_name_input_menu.c:
// CreatePlayerNameInputMenu, sub_8058830 and Task_80595DC). Over a picture (layer 2), a grid of characters (layer 1) eight
// rows of ten, six in view, with the name in a bar above it. It fades in from black over 32 frames to the player data's
// song.
//
// The d-pad moves a pulsing cursor over the grid, wrapping round its columns and, past its top or bottom row, round its
// rows. A held direction repeats from its 16th frame, every 5 after that. The cell under the cursor is lit, but not on a
// frame a key is pressed or with six characters in the name. A adds the character to the name where its cursor (a bobbing
// mark under the bar) is, and moves that on; B takes out the character before it. L and R, and A on the grid's ← and →,
// move it. Start, or a sixth character, takes the grid's cursor to END; A on END with a name that isn't blank fades out
// over 32 frames, and 61 frames after END the name goes into the save, which is written if it changed. The grid's
// characters glow, dimming and brightening every 47 frames.
//
// The name is kept as the bar's tiles, two rows of two a character, which go into layer 1's map every frame, in the rows
// above the grid that the scroll has taken out of view. In C the name input comes only from the VS menus, which go on to
// the mode select (modeselect.c) after it; the player data menu it leads to otherwise isn't in C yet.

#include "sa.h"

enum { PICTURE_GFX = 0x23, GRID_GFX = 0x24, GLOW_GFX = 0x25, CURSORS_GFX = 0x26 };
// from OFFSET_NAME_INPUT_MAPS: the picture's map, the grid's and the grid with its cells lit
enum { PICTURE_MAP = 0, GRID_MAP = 0x1000, LIT_MAP = 0x1800 };
// from OFFSET_NAME_INPUT_CHARS: the characters by grid cell, each character's tile from ' ', and the cursors' glyphs
enum { TILES = 0x4E, GRID_CURSOR = 0x124, NAME_CURSOR = 0x128 };
enum { COLUMNS = 10, ROWS_IN_VIEW = 6, LAST_TOP = 2 };
// a cell's code, (row × 20 + column) × 2: its character's first tile from the grid's first; the bottom row's ←, → and END
enum { MOVE_LEFT = 0x126, MOVE_RIGHT = 0x128, END = 0x12A };
// a character's four tiles in the bar (palette row 2), from its code; a blank one's
enum { TOP_LEFT = 0x2001, TOP_RIGHT = 0x2002, BOTTOM_LEFT = 0x2015, BOTTOM_RIGHT = 0x2016 };
static const uint16_t BLANK[4] = { 0x20DB, 0x20DC, 0x20EF, 0x20F0 };
enum { REPEAT = 0xF, REPEAT_BACK = 5 };
// the directions whose holding is counted (unk58 to unk64)
static const uint16_t DIRECTIONS[4] = { KEY_RIGHT, KEY_LEFT, KEY_UP, KEY_DOWN };

static struct {
  int16_t column, row, top, pulse, glow, frames, length;   // unk24, unk28, unk54, unk2C, unk30, unkFC, unkF8
  uint16_t held[4];                                      // by DIRECTIONS
  UiText o;
  Fade fade;
  uint16_t colours[16];                                  // unk34
  uint16_t bar[2][NAME_LENGTH * 2];                      // unkC8 and unkE0
  Graphics gfx[8];                                       // gfx68 to gfxBC
} input;

static void name_loop(Task *t);

static void load(int id, int slot, int unk28, int unk29, int unk2A, uint32_t tilesSize, uint32_t layout, uint32_t layoutSize, uint32_t vramC) {
  UiSlot glyphs;
  UiGfx g = { 0 };
  ui_graphics(id, &g.tiles, &g.palette, &glyphs);
  g.uiGfxID = (uint8_t)id; g.unk2B = slot; g.layout = &glyphs; g.unk28 = (uint8_t)unk28; g.unk29 = (uint8_t)unk29; g.unk2A = (uint8_t)unk2A;
  g.tilesSize = tilesSize; g.paletteSize = 0x20; g.layout_ = layout; g.layoutSize = layoutSize; g.vramC = vramC;
  load_ui_gfx(&g);
}

// a character of the bar from its first tile
static void set_char(int i, uint32_t tile) {
  input.bar[0][i * 2] = (uint16_t)tile;
  input.bar[0][i * 2 + 1] = (uint16_t)(tile + (TOP_RIGHT - TOP_LEFT));
  input.bar[1][i * 2] = (uint16_t)(tile + (BOTTOM_LEFT - TOP_LEFT));
  input.bar[1][i * 2 + 1] = (uint16_t)(tile + (BOTTOM_RIGHT - TOP_LEFT));
}

/** CreatePlayerNameInputMenu. */
void create_name_input(void) {
  e.bgCnt[1] = 0x1C06;
  e.bgCnt[2] = 0x1A09;
  for (int i = 2; i < 6; i++) e.bgScroll[i] = 0;
  e.dispCnt = 0x3640;
  e.bldCnt = 0x1F;
  e.winRegs[0] = 1;
  e.winRegs[2] = 1;
  create_ui_task();
  memset(&input, 0, sizeof input);
  // the cursors' glyphs (unk0, a Strc_8052C84 that is also drawn as a GameOverB)
  input.o.unkA = 0x1E; input.o.unkC = 0x1E; input.o.unkE = 1; input.o.unk10 = 3; input.o.unk16 = 1;
  input.fade = create_fade(0, 1, 2, 0, 0x100, 1);
  create_task(name_loop, &input, 0x2000, 0, NULL);

  uint8_t *name = SAVE_PLAYER_NAME;
  for (int i = 0; i < NAME_LENGTH; i++) {
    if (((name[i] - 0x20) & 0xFF) > 0x69) name[i] = 0x20;
    // the table's tiles are 0x1000 on from the grid's codes
    set_char(i, rom_u16(OFFSET_NAME_INPUT_CHARS + TILES + (name[i] - 0x20) * 2) + (TOP_LEFT - 0x1000));
  }
  int last = NAME_LENGTH - 1;
  while (last >= 0 && name[last] == 0x20) last--;
  input.length = (int16_t)(last + 1);

  ui_gfx_stack_init();
  load(PICTURE_GFX, 0, 0, 2, 0x15, 0x5000, OFFSET_NAME_INPUT_MAPS + PICTURE_MAP, 0x500, 0);
  load(GRID_GFX, 1, 0, 1, 0x15, 0x2800, OFFSET_NAME_INPUT_MAPS + GRID_MAP, 0x800, 0);
  load(GLOW_GFX, 1, 2, 1, 4, 0, 0, 0, 0);
  load(CURSORS_GFX, 3, 0, 0, 0xD, 0x100, 0, 0, OBJ_VRAM + 0x2000);
  fade_step(&input.fade);
  play_song_or_change(SONG_PLAYER_DATA);
}

// the code of the cell under the grid's cursor
static uint32_t cell_code(void) {
  return (uint32_t)((((((uint16_t)(input.top + input.row)) & 7) * 20 + (uint16_t)input.column) * 2) & 0xFFFF);
}

// a copy into layer 1's map, at `dest` in it, from the ROM or from `ram`
static void queue_map(Graphics *g, uint32_t src, uint32_t dest, uint32_t size, const uint8_t *ram) {
  g->src = src;
  g->dest = dest + ((e.bgCnt[1] & 0x1F00) << 3);
  g->size = size;
  g->ram = ram;
  queue_graphics(g);
}
// one of a cell's two rows, from the grid's map or the lit one
static void cell(Graphics *g, uint32_t map, int c, int r, int line) {
  uint32_t at = (uint32_t)((c << 2) + line + (r << 7)) & 0x7FF;
  queue_map(g, OFFSET_NAME_INPUT_MAPS + map + (at & 0x3FF), at, 4, NULL);
}

static void close_input(Task *t);

// a direction pressed or held long enough, which comes back 5 frames later while held
static int moves(int k, uint16_t *keys) {
  if (!(e.pressed & DIRECTIONS[k]) && s16(input.held[k]) <= REPEAT) return 0;
  play_song(SONG_MENU_CURSOR);
  input.held[k] = (uint16_t)(input.held[k] - REPEAT_BACK);
  *keys |= DIRECTIONS[k];
  return 1;
}
enum { RIGHT = 0, LEFT = 1, UP = 2, DOWN = 3 };

// sub_8058830: the keys, the cursors, the glow and the bar
static void name_loop(Task *t) {
  Fade *fade = &input.fade;
  UiText *o = &input.o;
  uint16_t keys = e.pressed;
  input.pulse = s16(input.pulse + 1);
  if (input.pulse > 0x20) input.pulse = 0;
  input.glow = s16(input.glow + 1);
  if (input.glow > 0x2E) input.glow = 0;
  input.frames = s16(input.frames + 1);
  if (input.frames <= 59) fade_step(fade);
  else input.frames = 60;
  for (int k = 0; k < 4; k++) input.held[k] = e.input & DIRECTIONS[k] ? (uint16_t)(input.held[k] + 1) : 0;

  int16_t column = input.column, row = input.row, top = input.top;
  if (moves(RIGHT, &keys)) {
    if (++input.column > COLUMNS - 1) input.column = 0;
  } else if (moves(LEFT, &keys)) {
    if (--input.column < 0) input.column = COLUMNS - 1;
  }
  if (moves(DOWN, &keys)) {
    if (++input.row > ROWS_IN_VIEW - 1) {
      input.row = ROWS_IN_VIEW - 1;
      if (++input.top > LAST_TOP) input.row = input.top = 0;
    }
  } else if (moves(UP, &keys)) {
    if (--input.row < 0) {
      input.row = 0;
      if (--input.top < 0) {
        input.row = ROWS_IN_VIEW - 1;
        input.top = LAST_TOP;
      }
    }
  }

  // the grid's cursor, swelling and shrinking over 33 frames, through affine parameters 2
  int p = input.pulse;
  o->unk0 = o->unk2 = (uint16_t)s16((p <= 15 ? 16 - p : p - 15) * 6 + 0x100);
  o->unkA = (uint16_t)s16(((((uint16_t)input.column) << 4) + 0x20) - ((o->unk0 - 0xF0) >> 7));
  o->unkC = (uint16_t)s16(((((uint16_t)input.row) << 4) + 0x28) - ((o->unk2 - 0xF0) >> 7));
  o->unk4 = 0;
  o->unk6 = 2;
  char gridCursor[2] = { (char)rom_u8(OFFSET_NAME_INPUT_CHARS + GRID_CURSOR), 0 };
  draw_ui_text_rotated(gridCursor, o);

  // a cell's two rows in layer 1's map, from the grid's map or the lit one: the cell where the cursor was put back
  // after a key, and the one under it lit
  if ((e.prevInput | keys) & 0xF9) {
    cell(&input.gfx[2], GRID_MAP, column, row + top, 0xA);
    cell(&input.gfx[3], GRID_MAP, column, row + top, 0x4A);
  }
  uint32_t code = cell_code();
  if (e.pressed == 0 && input.length <= NAME_LENGTH - 1) {
    cell(&input.gfx[0], LIT_MAP, input.column, input.row + input.top, 0xA);
    cell(&input.gfx[1], LIT_MAP, input.column, input.row + input.top, 0x4A);
  }

  if (e.pressed & (KEY_L | KEY_R)) {
    if (e.pressed & KEY_L) {
      if (input.length != 0) input.length--;
    } else if (input.length <= NAME_LENGTH - 2) input.length++;
  }
  if (e.pressed & KEY_A && !(e.pressed & KEY_B)) {
    if (code == MOVE_LEFT) {
      if (input.length != 0) input.length--;
    } else if (code == MOVE_RIGHT) {
      if (input.length <= NAME_LENGTH - 1) input.length++;
    } else if (code == END) {
      int blank = 1;
      for (int i = 0; i < NAME_LENGTH * 2; i += 2) if (input.bar[0][i] != BLANK[0]) blank = 0;
      if (!blank) {
        fade->unk6 = 0;
        fade->unk4 = 1;
        input.frames = 0;
        t->main = close_input;
      }
    } else if (input.length <= NAME_LENGTH - 1) {
      set_char(input.length++, code + TOP_LEFT);
    }
    play_song(SONG_SELECT);
  }
  if (e.pressed & KEY_START || (e.pressed & KEY_A && input.length == NAME_LENGTH)) {
    int t7 = input.top & 7;
    input.column = COLUMNS - 1;
    if (t7 <= 1) {
      input.top = LAST_TOP;
      input.row = ROWS_IN_VIEW - 1;
    } else input.row = (int16_t)(7 - t7);
  }
  if ((e.pressed & (KEY_A | KEY_B)) == KEY_B && input.length > 0) {
    input.length--;
    int i = (uint16_t)input.length;
    for (; i <= NAME_LENGTH - 2; i++) {
      for (int r = 0; r < 2; r++) {
        input.bar[r][i * 2] = input.bar[r][i * 2 + 2];
        input.bar[r][i * 2 + 1] = input.bar[r][i * 2 + 3];
      }
    }
    input.bar[0][i * 2] = BLANK[0]; input.bar[0][i * 2 + 1] = BLANK[1];
    input.bar[1][i * 2] = BLANK[2]; input.bar[1][i * 2 + 1] = BLANK[3];
    play_song(SONG_RETURN);
  }

  // the glow: the grid's colours (palette row 1) dimmed to between 18 and 31 thirty-seconds
  ui_gfx_stack_init();
  int g = input.glow, d = g <= 0x16 ? 0x17 - g : g - 0x17;
  int k = (d << 5) / 23;
  int level = 31 - (s16(SINE[(uint32_t)(k << 5) / 60]) >> 7);
  if ((uint32_t)level > 31) level = 31;
  UiSlot glyphs;
  uint32_t glowTiles, glowPalette;
  ui_graphics(GLOW_GFX, &glowTiles, &glowPalette, &glyphs);
  for (int i = 0; i < 16; i++) {
    uint32_t c = rom_u16(glowPalette + i * 2);
    uint32_t r = level * ((c & 0x7C00) >> 10) / 0x20, gr = level * ((c & 0x3E0) >> 5) / 0x20, b = level * (c & 0x1F) / 0x20;
    input.colours[i] = (uint16_t)((r << 10) + (gr << 5) + b);
  }
  UiGfx glow = { 0 };
  glow.uiGfxID = GLOW_GFX; glow.unk2B = 1; glow.layout = &glyphs; glow.unk28 = 1; glow.unk29 = 1; glow.unk2A = 4;
  glow.colours = input.colours; glow.paletteSize = 0x20;
  load_ui_gfx(&glow);

  // the name's cursor, bobbing, unless the name is full or the grid's cursor is on END
  code = cell_code();
  if (input.length <= NAME_LENGTH - 1 && code != END) {
    o->unkA = (uint16_t)(((uint16_t)input.length) * 16 + 0x78);
    int q = input.pulse;
    o->unkC = (uint16_t)s16(0xD - ((q > 0x10 ? 0x10 - q : q - 0x10) >> 2));
    char nameCursor[2] = { (char)rom_u8(OFFSET_NAME_INPUT_CHARS + NAME_CURSOR), 0 };
    draw_ui_glyphs(nameCursor, o, 0);
  }

  // the bar into the two rows above the ones in view; when the grid has scrolled, the rows it was in put back
  int barRow = (input.top - 2) << 7;
  queue_map(&input.gfx[4], 0, (uint32_t)(barRow + 0x1E) & 0x7FF, 0x18, (const uint8_t *)input.bar[0]);
  queue_map(&input.gfx[5], 0, (uint32_t)(barRow + 0x5E) & 0x7FF, 0x18, (const uint8_t *)input.bar[1]);
  if (top != input.top) {
    int below = (top + 6) << 7, was = (top - 2) << 7;
    queue_map(&input.gfx[6], OFFSET_NAME_INPUT_MAPS + GRID_MAP + 0x1E + ((uint32_t)below & 0x7FF), (uint32_t)(was + 0x1E) & 0x7FF, 0x18, NULL);
    queue_map(&input.gfx[7], OFFSET_NAME_INPUT_MAPS + GRID_MAP + 0x1E + ((uint32_t)((input.row == 0 ? was : below) + 0x40) & 0x7FF),
      (uint32_t)((top << 7) - 0xA2) & 0x7FF, 0x18, NULL);
  }
  e.bgScroll[3] = (uint16_t)(((((uint16_t)input.top) << 4) - 0x30) & 0x1FF);
}

// once the name is in the save: layers 1 and 2's maps cleared in the next V-blank, and the mode select
static void after(void) {
  destroy_task(e.curTask);
  vs_clear_map(1, 0x20);
  vs_clear_map(2, 0x20);
  create_mode_select();
}
static void after_write(void) {
  sound_vsync_on();
  after();
}

// Task_80595DC: the fade out; on the 61st frame after END the name into the save from the bar, the save written if it
// changed (with the music stopped, the sound's buffer cleared while it writes, and the time it changed as the player's
// id), and the mode select
static void close_input(Task *t) {
  (void)t;
  fade_step(&input.fade);
  input.frames = s16(input.frames + 1);
  if (input.frames <= 60) return;
  uint8_t *name = SAVE_PLAYER_NAME;
  int changed = 0;
  for (int i = 0; i < NAME_LENGTH; i++) {
    uint32_t code = (uint32_t)(s16(input.bar[0][i * 2]) - TOP_LEFT);
    uint8_t c = (uint8_t)rom_u8(OFFSET_NAME_INPUT_CHARS + code / 40 * COLUMNS + ((code % 40) >> 1));
    if (name[i] != c) {
      changed = 1;
      name[i] = c;
    }
  }
  if (changed) {
    save_set_player_id(e.frameCount);
    stop_all_songs();
    sound_vsync_off();
    if (save_write()) {
      engine_stall(WRITE_FRAMES, after_write);
      return;
    }
    sound_vsync_on();
  }
  after();
}
