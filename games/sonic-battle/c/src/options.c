// options.js in C: the options screen, chosen last on the main menu, translated from the JavaScript version in
// games/sonic-battle/src/options.js a function at a time. The original's functions are named by their address, as the
// JavaScript names them: 0x08037d44 the first frame, 0x080380e4 its wrapper, 0x080380f4 and 0x080381e4 the interrupts,
// 0x08038448 and 0x08038698 the handlers, 0x08037148 and 0x080375d8 the texts, the bars' 0x08037b10, 0x080382bc and
// 0x08038360, and the moves' 0x08038724, 0x0803876c, 0x0803878c, 0x080387b4 and 0x080387dc. Four choices: the language,
// a music test, a sound test and deleting the save, which asks first.
//
// The screen runs as a list of nodes, as the main menu does (menu.c), with the sprites and the font the JavaScript kit's
// menu.js and mini-games.js give it.

#include "game.h"
#include "menu.h"
#include "text.h"

#define CARTRIDGE 0x08000000u
#define PALETTE 0x05000000u
#define VRAM 0x06000000u

#define DISPCNT 0x00
#define BG1CNT 0x0A
#define BG2CNT 0x0C
#define BG3VOFS 0x1E

// the cartridge's table of the display registers the first frame writes, and how many
#define REGISTERS 0x08158674u
#define REGISTER_COUNT 16
// gUnknown_081586b4: each label's x, y, text and alignment, four bytes each, and which is which
#define LABELS 0x081586B4u
#define HEADINGS 3
#define LANGUAGE_ROW 3
#define MUSIC_ROW 4
#define SOUND_ROW 5
#define DELETE_ROW 6
#define LANGUAGE_NAMES 8
#define DELETE_ASK 14
#define DELETE_NO 15
#define DELETE_YES 16
// gUnknown_08edced0: the texts' list for each language
#define TEXTS 0x08EDCED0u
// gUnknown_08071460 and gUnknown_080714ae: the songs and sounds the two tests play, and their last numbers
#define MUSIC 0x08071460u
#define SOUNDS 0x080714AEu
#define LAST_MUSIC 38
#define LAST_SOUND 197
#define LAST_LANGUAGE 5
// the digits' first letter in the font, and the end of a text
#define DIGITS 128
#define END 0xFFFE
// the font: 32 bytes of pixels for each letter, and for each byte of pixels, what it keeps of a word of VRAM and which
// of its nibbles it sets

// the stretches of VRAM the rows' texts and the chosen one's copy are drawn into, and what's in each row
#define ROWS_TILES 0x06008020u
#define ROWS_WIDTH 24
#define ROWS_HEIGHT 18
#define ROW_STRIDE 576
#define CHOSEN_TILES 0x06017A00u
#define CHOSEN_BYTES 0x600
#define CHOSEN_HEIGHT 2
static const uint32_t ROW_STARTS[4] = {0x06008078, 0x060080F8, 0x06008138, 0x060081B8};
#define VALUE_X 160
#define TEXT_COLOUR 2

// the bars' pieces of map, each unpacked to a row of it at the next V-blank: unlit and lit, the top and the bottom
#define BAR_OFF_TOP 0x081589B4u
#define BAR_OFF_BOTTOM 0x08158A14u
#define BAR_OFF_NEXT 0x08158A44u
#define BAR_OFF_END 0x081589E8u
#define BAR_ON_TOP 0x08158958u
#define BAR_ON_BOTTOM 0x08158904u
#define BAR_ON_NEXT 0x08158930u
#define BAR_ON_END 0x081588ECu

// the two sprites at the top, the cursor's parts and the chosen text's, which is a copy kept so its place can change
#define RECORDS 0x08EDCD0Cu
#define RECORD_BYTES 16
#define CURSOR_PARTS 0x08159FD4u
#define CHOSEN_PARTS 0x08159FC4u
#define CHOSEN_PARTS_BYTES 16
#define CHOSEN_TILE 96
// gUnknown_08edcee8 and gUnknown_08edcef4: where the cursor and the chosen text sit on each row
#define CURSOR_Y 0x08EDCEE8u
#define CHOSEN_Y 0x08EDCEF4u
#define CURSOR_X 120
#define CHOSEN_X 207
#define CHOSEN_MOVING_X 199
// gUnknown_08edcd2c: the display status each row's frame gives for the second interrupt, whose line is its top byte
#define LINES 0x08EDCD2Cu

#define DELETE 3
#define DELETE_ASKING 4
#define SOUND_MOVE 401
#define SOUND_ASK 402
#define SOUND_MADE 404
#define SOUND_BACK 405
#define OPTIONS_SONG 1

// how many letters a frame's handler draws before its sound starts late, as mGBA measures it
#define LETTERS_BEFORE_THE_LIBRARY 24
// how many letters of the screen's first frame take it past a second V-blank
#define LETTERS_PAST_A_FRAME 75
// the time 0x080217d0 takes to write the save, and 0x08021980 to read it back and find nothing changed
#define SAVING_FRAMES 18
#define READING_FRAMES 3

static int selection, shift, music, sound, deleting, letters, late_sound;
static int value_width[5];
static uint32_t texts;

static void optionsChoosing(Node *node);
static void asking(Node *node);
static void leaveToMenu(Node *node);
static void leaveDeleting(Node *node);
static void moveUp(Node *node);
static void moveDown(Node *node);
static void moved(Node *node);
static void barOn(Node *node);
static void slideOut(Node *node);
static void saving(void);
static void restarting(void);
static void optionsDisplayOn(void);

static uint16_t letters_buffer[96];

/** A text as its letters, up to its end, into `out`, and how many. */
static int readLetters(uint32_t text, uint16_t *out, int most) {
  int count = 0;
  uint32_t at = text;
  while (count < most) {
    uint16_t token = read16(at);
    out[count++] = token;
    at += 2;
    if (token == END) break;
  }
  return count;
}

/** A text's width from `first` on, as 0x08020ad0 gives it. */
static int widthFrom(const uint16_t *text, int first) {
  int width = 0;
  for (int i = first; text[i] != END; i++) {
    uint16_t token = text[i];
    if (token == 0xFFFD) width = 0;
    else if (token == 0xFFFB || token == 0xFFFA || token == 0xFFF9) i++;
    else if (token != 0xFFFC && token != 0xFFF8 && token != 0xFFF7) width += glyphWidth(token);
  }
  return width;
}

/** 0x080200f8, the list's first node: no sprite has asked yet this frame, and no matrix is taken. */
static void frameStart(Node *node) { (void)node; menuStartFrame(); }

/** 0x0801f9d8: a sprite that only asks to be drawn. */
static void drawOnly(Node *node) { menuDraw(node->place); }

/** 0x08030d20: the scrolling layer, a line every other frame. */
static void scroll(Node *node) {
  node->count = node->count - 1;
  queueRegister(BG3VOFS, (uint16_t)((node->count & 0x1FE) >> 1));
}

/** Where a label says it goes, and its text in the language the screen opened with. */
static void label(int number, int *x, int *y, uint32_t *text, int *alignment) {
  uint32_t at = LABELS - CARTRIDGE + (uint32_t)number * 4;
  *x = gba_rom[at];
  *y = gba_rom[at + 1];
  *text = read32(texts + (uint32_t)gba_rom[at + 2] * 4);
  *alignment = gba_rom[at + 3];
}

/** The letters from `x` and `y`, each a byte further along by its width, as 0x08038204 and the texts' own loops do. */
static void putLetters(int x, int y, const uint16_t *text) {
  int left = u8(x);
  for (int i = 0; text[i] != END; i++) {
    left = u8(left + putGlyph(left, y, text[i], TEXT_COLOUR));
    letters++;
  }
}

/** A label's text, moved left by its width or half of it as the label says, with `y` in place of the label's when given. */
static void putLabelBuffer(int number, const uint16_t *text, int y) {
  int x, atY, alignment;
  uint32_t from;
  label(number, &x, &atY, &from, &alignment);
  if (alignment == 1) x -= widthFrom(text, 0);
  else if (alignment == 2) x -= widthFrom(text, 0) >> 1;
  putLetters(x, y < 0 ? atY : y, text);
}

/** A label's text, read from the cartridge. */
static void putLabel(int number, int y) {
  int x, atY, alignment;
  uint32_t from;
  label(number, &x, &atY, &from, &alignment);
  readLetters(from, letters_buffer, 96);
  putLabelBuffer(number, letters_buffer, y);
}

/** A number as its digits, with the first of them blanked while they're zero, and how many were. */
static int digits(int number, int count, uint16_t *out) {
  int n = 0, skip = 0;
  for (int unit = count == 2 ? 10 : count == 3 ? 100 : 1; unit >= 1; unit /= 10) out[n++] = (uint16_t)((number / unit) % 10 + DIGITS);
  while (skip < count - 1 && out[skip] == DIGITS) {
    out[skip] = 0;
    skip++;
  }
  out[n] = END;
  return skip;
}

/** A row's number, right up against the column its values end at. */
static int putNumber(int number, int count, int y) {
  uint16_t text[8];
  int skip = digits(number, count, text);
  putLetters(VALUE_X - widthFrom(text, 0), y, text);
  return widthFrom(text, skip);
}

/** 0x08037148: a row of the screen's text, cleared and drawn again, and how wide its value is, for the chosen text's place. */
static void drawRow(int row) {
  textInto(ROWS_TILES, ROWS_WIDTH, ROWS_HEIGHT);
  for (int y = 0, at = (int)(ROW_STARTS[row] - VRAM); y < ROWS_WIDTH; y++, at += ROW_STRIDE) {
    for (int i = 0; i < 64; i++) gba_vram[at + i] = 0;
  }
  if (row == 0) {
    putLabel(LANGUAGE_ROW, -1);
    {
      int x, atY, alignment;
      uint32_t from;
      label(LANGUAGE_NAMES + g.language, &x, &atY, &from, &alignment);
      readLetters(from, letters_buffer, 96);
      value_width[0] = widthFrom(letters_buffer, 0);
      putLabelBuffer(LANGUAGE_NAMES + g.language, letters_buffer, -1);
    }
  } else if (row == 1) {
    int x, y, alignment;
    uint32_t from;
    label(MUSIC_ROW, &x, &y, &from, &alignment);
    putLabel(MUSIC_ROW, -1);
    value_width[1] = putNumber(music, 2, y);
  } else if (row == 2) {
    int x, y, alignment;
    uint32_t from;
    label(SOUND_ROW, &x, &y, &from, &alignment);
    putLabel(SOUND_ROW, -1);
    value_width[2] = putNumber(sound, 3, y);
  } else {
    putLabel(DELETE_ROW, -1);
    value_width[3] = 0;
  }
}

/** 0x080375d8: the chosen row's text again, in the sprites' tiles. */
static void drawChosen(int row) {
  textInto(CHOSEN_TILES, ROWS_WIDTH, CHOSEN_HEIGHT);
  for (int i = 0; i < CHOSEN_BYTES; i++) gba_vram[(CHOSEN_TILES - VRAM) + i] = 0;
  if (row == 0) {
    putLabel(LANGUAGE_ROW, 0);
    putLabel(LANGUAGE_NAMES + g.language, 0);
  } else if (row == 1) {
    putLabel(MUSIC_ROW, 0);
    putNumber(music, 2, 0);
  } else if (row == 2) {
    putLabel(SOUND_ROW, 0);
    putNumber(sound, 3, 0);
  } else if (row == DELETE) {
    putLabel(DELETE_ROW, 0);
  } else {
    putLabel(DELETE_ASK, 0);
    {
      int x, atY, alignment;
      uint32_t from;
      label(deleting ? DELETE_YES : DELETE_NO, &x, &atY, &from, &alignment);
      readLetters(from, letters_buffer, 96);
      value_width[DELETE_ASKING] = widthFrom(letters_buffer, 0);
      putLabelBuffer(deleting ? DELETE_YES : DELETE_NO, letters_buffer, 0);
    }
  }
}

// each row's two pieces of the bar's map, as 0x08037b10, 0x080382bc, 0x08038360 and 0x08037c30 give them
static const uint32_t BAR_PLACES[4][2] = {
  {0x0600E980, 0x0600EA00}, {0x0600EA80, 0x0600EB00}, {0x0600EB00, 0x0600EB80}, {0x0600EC00, 0x0600EC80},
};
static const uint32_t BAR_OFF[4][2] = {
  {BAR_OFF_TOP, BAR_OFF_BOTTOM}, {BAR_OFF_TOP, BAR_OFF_NEXT}, {BAR_OFF_NEXT, BAR_OFF_BOTTOM}, {BAR_OFF_TOP, BAR_OFF_END},
};
static const uint32_t BAR_ON[4][2] = {
  {BAR_ON_TOP, BAR_ON_BOTTOM}, {BAR_ON_TOP, BAR_ON_NEXT}, {BAR_OFF_END, BAR_ON_BOTTOM}, {BAR_ON_TOP, BAR_ON_END},
};

/** 0x080382bc and 0x08038360: a row's bar goes off or on, at the next V-blank. */
static void bar(int row, int on) {
  for (int i = 0; i < 2; i++) queueDecompress(BAR_PLACES[row][i], on ? BAR_ON[row][i] : BAR_OFF[row][i]);
}

/** 0x08037b10: the screen opens with the first row's bar on and the second's off. */
static void firstBars(void) {
  bar(0, 1);
  bar(1, 0);
}

/** 0x080388a0: the palettes fade in, and then the choice can be moved. */
static void fadeIn(Node *node) {
  int backgrounds = fadeToward(PALETTE, 0x08158B94, 80);
  int layer = fadeToward(0x050001E0, 0x081327B4, 16);
  int sprites = fadeToward(0x05000200, 0x08159770, 80);
  if (backgrounds && layer && sprites) node->run = optionsChoosing;
}

/** A song or sound played alone, as the tests and the moves do: 0x0801f638 stops all the others. */
static void playAlone(int song) {
  gba_sound_wave_at(283596);   // where the stop comes in its frame, as mGBA measures it, a frame after this one
  gba_sound_stop_all();
  gba_sound_play(song);
}

/** Left or right on a row with a value: it goes round, the row and its copy are drawn again, and a sound says so. */
static void change(int row, int by) {
  if (row == 0) g.language = g.language + by < 0 ? LAST_LANGUAGE : g.language + by > LAST_LANGUAGE ? 0 : g.language + by;
  else if (row == 1) music = music + by < 0 ? LAST_MUSIC : music + by > LAST_MUSIC ? 0 : music + by;
  else if (row == 2) sound = sound + by < 0 ? LAST_SOUND : sound + by > LAST_SOUND ? 0 : sound + by;
  if (row <= 2) {
    letters = 0;
    drawRow(row);
    drawChosen(row);
    // with this many letters to draw, the sound's start comes after the sound library's run in this frame, at the
    // first line, as mGBA measures it, so it starts in the next (notes/a-long-row-starts-its-sound-a-frame-late.md)
    if (letters > LETTERS_BEFORE_THE_LIBRARY) late_sound = SOUND_MOVE;
    else gba_sound_play(SOUND_MOVE);
  }
}

/** 0x08038448: B or Start leaves, A does what the row does, up and down move the choice, left and right its value. */
static void optionsChoosing(Node *node) {
  uint16_t pressed = g.keys.pressed, repeated = g.keys.repeated;
  if (pressed & (KEY_B | KEY_START)) {
    node->run = leaveToMenu;
    playAlone(SOUND_BACK);
  } else if (pressed & KEY_A) {
    if (selection == 1) playAlone(read16(MUSIC + (uint32_t)music * 2));
    else if (selection == 2) playAlone(read16(SOUNDS + (uint32_t)sound * 2));
    else if (selection == DELETE) {
      selection = DELETE_ASKING;
      deleting = 0;
      drawChosen(DELETE_ASKING);
      node->run = asking;
      gba_sound_play(SOUND_ASK);
    }
  }
  if (repeated & KEY_UP) {
    node->run = moveUp;
    playAlone(SOUND_MOVE);
  } else if (repeated & KEY_DOWN) {
    node->run = moveDown;
    playAlone(SOUND_MOVE);
  }
  if (repeated & KEY_LEFT) change(selection, -1);
  else if (repeated & KEY_RIGHT) change(selection, 1);
}

/** 0x08038698: are you sure. A on yes deletes, A on no or B goes back to the row, and left and right change the answer. */
static void asking(Node *node) {
  uint16_t pressed = g.keys.pressed;
  if ((pressed & KEY_B) || ((pressed & KEY_A) && !deleting)) {
    selection = DELETE;
    drawChosen(DELETE);
    node->run = optionsChoosing;
    gba_sound_play(SOUND_BACK);
  } else if (pressed & KEY_A) {
    node->run = leaveDeleting;
    gba_sound_play(SOUND_MADE);
  } else if (pressed & (KEY_LEFT | KEY_RIGHT)) {
    deleting ^= 1;
    drawChosen(DELETE_ASKING);
    gba_sound_play(SOUND_MOVE);
  }
}

/** 0x08038724: the chosen text slides down onto its row, the bar goes off, and the choice goes up, round to the last. */
static void moveUp(Node *node) {
  if (shift > 1) {
    shift--;
    return;
  }
  shift = 0;
  bar(selection, 0);
  selection = selection == 0 ? DELETE : selection - 1;
  node->run = moved;
}

/** 0x080387dc: the same going down, round to the first, which leaves the slide a step from its end. */
static void moveDown(Node *node) {
  if (shift > 1) {
    shift--;
    return;
  }
  bar(selection, 0);
  selection = selection >= DELETE ? 0 : selection + 1;
  node->run = moved;
}

/** 0x0803876c: the new row's copy. */
static void moved(Node *node) {
  drawChosen(selection);
  node->run = barOn;
}

/** 0x0803878c: the new row's bar. */
static void barOn(Node *node) {
  bar(selection, 1);
  shift = 1;
  node->run = slideOut;
}

/** 0x080387b4: the chosen text slides back up off its row, and then the choice can move again. */
static void slideOut(Node *node) {
  if (shift <= 3) shift++;
  else {
    shift = 4;
    node->run = optionsChoosing;
  }
}

/** 0x08038820: every colour fades to black, the language is kept, and the main menu starts again. */
static void leaveToMenu(Node *node) {
  if (!fadeToBlack(PALETTE, 512)) return;
  g.vblank_work = 0;
  g.line_work = 0;
  // 0x08021980 reads the save back, and 0x080217d0 only writes it when it has changed
  if (g.language != g.saved_language) {
    uint8_t *save = gba_save(8);
    g.saved_language = g.language;
    save[0] = 0xA5;
    save[1] = (uint8_t)g.language;
    gba_save_write();
    g.saving_frames = SAVING_FRAMES;
  } else g.saving_frames = READING_FRAMES;
  g.callback = saving;
  node->run = 0;
}

/** The time 0x080217d0 takes, and then the main menu (0x08039e20), whose song comes with its display. */
static void saving(void) {
  if (--g.saving_frames > 0) return;
  showMenu(1);
}

/** 0x08038850: every colour fades to black, and then the save goes (0x0802188c), and the game starts again. */
static void leaveDeleting(Node *node) {
  if (!fadeToBlack(PALETTE, 512)) return;
  g.vblank_work = 0;
  g.line_work = 0;
  {
    uint8_t *save = gba_save(8);
    save[0] = 0;
    save[1] = 0;
    gba_save_write();
  }
  g.language = 1;
  g.saved_language = 1;
  g.mini_games_open = 1;
  g.frames = 1;
  g.saving_frames = SAVING_FRAMES;
  g.restarted = 1;
  g.callback = restarting;
  node->run = 0;
}

static void restarting(void) {
  if (--g.saving_frames > 0) return;
  restartFromStart();
}

/** 0x08038918 and 0x0803895c: the cursor, off the row's end by as far as the slide has gone, and nothing once it's back. */
static void cursor(Node *node) {
  Place *position = &node->place;
  position->x = (int16_t)(shift + CURSOR_X);
  position->y = (int16_t)(read16(CURSOR_Y + (uint32_t)selection * 2) - shift);
  if (shift != 0) menuDraw(*position);
}

static void cursorStart(Node *node) {
  Place *position = &node->place;
  position->parts = CURSOR_PARTS;
  position->tile = 0;
  position->attr2 = 8;
  node->run = cursor;
}

/** 0x080389a8: the chosen text's own parts, a copy with its place for the value's width, and then it draws (0x08038a20). */
static void chosen(Node *node) {
  Place *position = &node->place;
  position->own_parts[5] = (uint8_t)(-(value_width[selection] + 12));
  position->x = (int16_t)(shift + CHOSEN_MOVING_X);
  position->y = (int16_t)(read16(CHOSEN_Y + (uint32_t)selection * 2) + 8 - shift);
  if (selection != DELETE) menuDraw(*position);
}

static void chosenStart(Node *node) {
  Place *position = &node->place;
  for (int i = 0; i < CHOSEN_PARTS_BYTES; i++) position->own_parts[i] = gba_rom[CHOSEN_PARTS - CARTRIDGE + (uint32_t)i];
  position->own = 1;
  position->own_parts[5] = (uint8_t)(-(value_width[selection] + 12));
  position->tile = CHOSEN_TILE;
  position->x = CHOSEN_X;
  position->y = (int16_t)read16(CHOSEN_Y + (uint32_t)selection * 2);
  position->attr2 = 4;
  node->run = chosen;
}

/** 0x080380f4 and 0x080381a8: the V-blank's two layers low, and the line that lifts them, under the chosen row. */
static void liftLayers(void) {
  gba_write(BG1CNT, 0x1E09);
  gba_write(BG2CNT, 0x1D01);
}

static void vblankWork(void) {
  if (late_sound) {
    gba_sound_play(late_sound);
    late_sound = 0;
  }
  gba_write(BG1CNT, 0x1E0A);
  gba_write(BG2CNT, 0x1D02);
  g.line_work_line = (read16(LINES + (uint32_t)selection * 2) >> 8) - 1;
  g.line_work = liftLayers;
}

/** 0x08037d44's last steps, a frame or two on: its unpacking and letters run past a V-blank or two, as mGBA measures
 *  it, and the bars and the display are queued for the next. */
static void optionsDisplayOn(void) {
  firstBars();
  queueRegister(DISPCNT, 0x1F40);
  g.callback = menuFrame;
  g.vblank_work = vblankWork;
}

static void delayedDisplay(void) { g.callback = optionsDisplayOn; }

/**
 * 0x08037d44: the screen's first frame. The registers, the sprites hidden, the palette black, the pictures, the maps, the
 * screen's text, the list's nodes, and the display queued on for the next V-blank. The song the main menu started goes
 * on fading out behind it.
 */
void startOptions(void) {
  menuWriteRegisters(REGISTERS, REGISTER_COUNT);
  g.queue_count = 0;              // 0x0801fb94
  hideSpriteBuffer();             // 0x0801ff30
  menuReset();
  selection = 0;
  shift = 4;
  music = 0;
  sound = 0;
  deleting = 0;
  letters = 0;
  late_sound = 0;
  for (int i = 0; i < 5; i++) value_width[i] = 0;
  texts = read32(TEXTS + (uint32_t)g.language * 4);
  for (int i = 0; i < 512; i++) gba_pal[i] = 0;
  decompress(0x081586F8, VRAM);
  decompress(0x08132544, 0x06004000);
  decompress(0x08158BF4, 0x06010000);
  decompress(g.language == 0 ? 0x08158E1C : 0x08159314, 0x06010C80);
  for (int i = 0; i < 0x800; i++) gba_vram[(0x0600F800 - VRAM) + i] = 0;
  decompress(0x08158A70, 0x0600F800);
  for (int i = 0; i < 0x800; i++) gba_vram[(0x0600F000 - VRAM) + i] = 0;
  for (int i = 0; i < 0x3620; i++) gba_vram[(0x06008000 - VRAM) + i] = 0;
  for (int x = 0, tile = 0x2001; x < ROWS_WIDTH; x++) {
    for (int y = 0, at = (int)(0x0600F10A - VRAM) + x * 2; y < ROWS_HEIGHT; y++, at += 64, tile++) {
      gba_vram[at] = (uint8_t)(tile & 0xFF);
      gba_vram[at + 1] = (uint8_t)(tile >> 8);
    }
  }
  textInto(ROWS_TILES, ROWS_WIDTH, ROWS_HEIGHT);
  for (int number = 0; number < HEADINGS; number++) putLabel(number, -1);
  for (int row = 0; row < 4; row++) drawRow(row);
  for (int i = 0; i < 0x800; i++) gba_vram[(0x0600E800 - VRAM) + i] = 0;
  decompress(0x08158AD0, 0x0600E900);
  {
    uint32_t to = 0x0600E000;
    for (int y = 0; y < 4; y++) {
      for (int x = 0; x < 4; x++) {
        copyTileBlock(to, 0x081327D4, 8, 8, 0xF200);
        to += 0x10;
      }
      to += 0x1C0;
    }
  }
  menuAddNode(frameStart, menuPlace(0, 0, 0, 0, 0), 0);
  {
    Node *node = menuAddNode(scroll, menuPlace(0, 0, 0, 0, 0), 0);
    node->count = 0;
  }
  menuAddNode(fadeIn, menuPlace(0, 0, 0, 0, 0), 0);
  menuAddNode(cursorStart, menuPlace(0, 0, 0, 0, 0), 1);
  drawChosen(0);
  menuAddNode(drawOnly, menuRecord(RECORDS), 1);
  menuAddNode(drawOnly, menuRecord(RECORDS + RECORD_BYTES), 1);
  menuAddNode(chosenStart, menuPlace(0, 0, 0, 0, 0), 1);
  g.callback = letters > LETTERS_PAST_A_FRAME ? delayedDisplay : optionsDisplayOn;
}
