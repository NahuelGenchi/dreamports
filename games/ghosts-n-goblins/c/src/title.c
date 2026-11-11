// Ghosts'n Goblins Dreamport: the title screen's task, from the original's code at $C3DC. It draws the title screen from
// the player's copy, a part each turn with the picture off, and then waits for Start. The title screen was first
// written for the Dreamport by klaudito70, who found where the copy keeps each part of it.

#include "game.h"

// the title screen's own places in work memory
#define TITLE_TIME 0x86          // how long the title screen waits before the demonstration, 16 bits
#define SELECT_HELD RAM[0x88]    // counts down while Select is held, so the sword moves once and then every tenth round
#define PLAYERS_CHOSEN RAM[0xA3] // the line the sword points at: 0 for one player, 1 for two
#define PLAYERS RAM[0xA2]
#define SECRET_STEP RAM[0xA7]    // how far into the title screen's secret buttons the player is, or $FF once wrong
#define SECRET_HELD RAM[0x84]
#define BLINK RAM[0x83]
#define GAME_PLAYED RAM[0xBB]    // on once a game has been played since power-on
enum { SWORD = 0 };              // the title screen's object
enum { SWORD_TOP = 0x92, SWORD_STEP = 0x10, SWORD_END = 0xC2 };

// sub_EF20
static uint8_t start_held(void) {
  took(START_READ);
  return PAD_1 & PAD_START;
}

// sub_C744: a player's score, seven digits kept every other byte from $04E0, ready to be drawn from $B3.
static void score_digits(uint8_t player) {
  took(TITLE_SCORE_DIGITS);
  for (int digit = 0; digit < 7; digit++) RAM[0xB3 + digit] = RAM[0x04E0 + player + digit * 2];
}

// One row of the title screen's words or digits.
static void queue_title_row(uint16_t from, uint16_t to, uint8_t wide) {
  took(TITLE_ROW_SET_UP);
  queue_rows(from, to, 1, wide);
}

// sub_C69C: the scores at the top, with the words above them from $C86C: the first player's, the best, and the second
// player's when two can play.
static void draw_scores(void) {
  score_digits(0);
  queue_title_row(0x00B3, 0x2062, 7);
  queue_title_row(0x008D, 0x206C, 7);
  took(PLAYERS ? TITLE_TWO_PLAYERS : TITLE_ONE_PLAYER);
  if (PLAYERS) {
    score_digits(1);
    queue_title_row(0x00B3, 0x2076, 7);
  }
  queue_title_row(0xC86C, 0x2044, 3);
  queue_title_row(0xC872, 0x204E, 3);
  took(PLAYERS ? TITLE_TWO_PLAYERS : TITLE_ONE_PLAYER);   // with one player, its jump is the one that yields
  if (PLAYERS) {
    queue_title_row(0xC86F, 0x2058, 3);
    took(JUMPS);
  }
}

// $C45B: the title screen's secret, a run of buttons the copy keeps from $C61C, after Right with A or B three times.
static void follow_secret_buttons(void) {
  if (SECRET_STEP < 3) {
    if (!(PAD_1 & 0x01)) { SECRET_HELD = 0; took(SECRET_NOT_RIGHT); }
    else if (!(PAD_1 & (PAD_A | PAD_B))) { SECRET_HELD = 0; took(SECRET_NO_BUTTON); }
    else if (SECRET_HELD) took(SECRET_STILL_HELD);
    else { SECRET_STEP++; SECRET_HELD = 0xFF; took(SECRET_STEP_TAKEN); }
  } else if (SECRET_STEP == 0xFF) took(SECRET_WRONG_BEFORE);
  else if (PAD_1 == 0) { SECRET_HELD = 0; took(SECRET_NOTHING_HELD); }
  else if (SECRET_HELD) took(SECRET_SAME_HELD);
  else if (cart(7, (uint16_t)(0xC61C + SECRET_STEP - 3)) == PAD_1) { SECRET_HELD = 0xFF; SECRET_STEP++; took(SECRET_RIGHT); }
  else { SECRET_STEP = 0xFF; took(SECRET_WRONG); }
}

// $C4A5: Select moves the sword to the next line, and back to the first after the last.
static void move_sword(void) {
  if (!(PAD_1 & PAD_SELECT)) { SELECT_HELD = 1; took(SWORD_STAYS); return; }
  if (--SELECT_HELD) { took(SWORD_WAITS); return; }
  SELECT_HELD = 10;
  uint8_t y = (uint8_t)(RAM[OBJECT_SCREEN_Y + SWORD] + SWORD_STEP);
  PLAYERS_CHOSEN++;
  took(y >= SWORD_END ? SWORD_BACK_TO_TOP : SWORD_MOVES_DOWN);
  if (y >= SWORD_END) { PLAYERS_CHOSEN = 0; y = SWORD_TOP; }
  RAM[OBJECT_SCREEN_Y + SWORD] = y;
}

wait title_task(void) {
  enum { PICTURE_OFF, SET_UP, FRESH_SCREEN, LOGO, LOGO_ROWS, LOGO_WRITTEN, SCORES, WORDS, COPYRIGHT, DRAWN, TILES, READY, START_FREE, WAIT_START, START_HELD, COUNT_DOWN };
  static uint8_t inner;   // the step of a routine this one calls
  uint8_t *step = &task_step[TASK_TITLE];
  for (;;) switch (*step) {
    case PICTURE_OFF:
      inner = 0;
      *step = SET_UP;
      took(CALLS);
      return picture_off();
    case SET_UP:
      // $C3DF: no sound, nothing waiting to be written, and none of a game's tasks
      took(CALLS);
      sound_reset();
      ROWS_END = 0;
      RAM[ROWS] = 0xFF;
      took(TITLE_TO_TASKS_STOPPED);
      stop_game_tasks();
      COLUMN_READY = WIDE_ROWS_READY = 0;
      SECRET_STEP = 0;
      BANK_HOME = 3;
      switch_bank(3);
      FRAMES_A_ROUND = 2;
      took(TITLE_SETTINGS);
      *step = FRESH_SCREEN;
      break;
    case FRESH_SCREEN: {
      wait how = fresh_screen(&inner);
      if (how != DONE) return how;
      took(CALLS);
      sound_registers_off();
      *step = LOGO;
      took(CALLS);    // sub_C656,
      took(CALLS);    // which starts with the picture off
      return picture_off();
    }
    case LOGO:
      // sub_C668: the logo, eight rows of 20 tiles from where bank 3's $8054 points, two rows a frame
      set_ram16(0x26, peek16(0x8054));
      set_ram16(0x24, 0x2128);
      RAM[0x53] = 4;
      took(TITLE_LOGO_BEGINS);
      *step = LOGO_ROWS;
      break;
    case LOGO_ROWS:
      for (int row = 0; row < 2; row++) {
        took(TITLE_LOGO_ROW);
        queue_rows(ram16(0x26), ram16(0x24), 1, 20);   // sub_C691
      }
      FRAMES_SINCE_ROUND = 0;
      took(TITLE_LOGO_WAITS);
      *step = LOGO_WRITTEN;
      return SPINS;   // $C688
    case LOGO_WRITTEN:
      took(TITLE_LOGO_COUNTED);
      if (--RAM[0x53]) { took(GOES_ROUND); *step = LOGO_ROWS; break; }
      took(GOES_ON);
      took(RETURNS);
      *step = SCORES;
      break;
    case SCORES:
      took(CALLS);
      draw_scores();
      *step = WORDS;
      return YIELDS;
    case WORDS:
      // sub_C753: "1 PLAYER" and "2 PLAYERS", from $C875, and a third line once a game has been played
      took(CALLS);
      queue_title_row(0xC875, 0x224D, 9);
      queue_title_row(0xC87E, 0x228D, 9);
      took(GAME_PLAYED ? TITLE_PLAYED : TITLE_NOT_PLAYED_YET);
      if (GAME_PLAYED) {
        took(TITLE_THIRD_LINE);
        queue_rows(0xC887, 0x22CD, 1, 9);
      }
      took(JUMPS);
      *step = COPYRIGHT;
      return YIELDS;
    case COPYRIGHT:
      // sub_C7CD: three rows of 29 tiles from where bank 3's $8056 points
      took(TITLE_COPYRIGHT);
      queue_rows(peek16(0x8056), 0x2342, 3, 29);
      took(JUMPS);
      *step = DRAWN;
      return YIELDS;
    case DRAWN:
      took(JUMPS);
      picture_on();
      *step = TILES;
      took(CALLS);
      return picture_off();
    case TILES: {
      // sub_C0C9: the title screen's tiles, 8 KB from bank 0, 128 bytes a frame
      if (!inner) took(TITLE_TILES_BEGIN);
      switch_bank(0);
      wait how = load_tiles(&inner, 0x8000, 0x0000, 0x40);
      if (how != DONE) return how;
      took(CALLS);
      picture_on();
      *step = READY;
      took(CALLS);
      return YIELDS;
    }
    case READY:
      // $C41F: not while Start is still held from before
      if (start_held()) {
        took(GOES_ROUND);
        took(CALLS);
        return YIELDS;
      }
      took(GOES_ON);
      set_ram16(TITLE_TIME, 0x01C2);
      RAM[OBJECT_FLAGS + SWORD] = OBJECT_FLAG_SHOWN;
      RAM[OBJECT_SCREEN_Y + SWORD] = SWORD_TOP;
      RAM[OBJECT_SCREEN_X + SWORD] = 0x5C;
      RAM[OBJECT_SHAPE + SWORD] = 0x1B;
      RAM[OBJECT_COLOURS + SWORD] = 0x01;
      SELECT_HELD = 1;
      PLAYERS_CHOSEN = 0;
      took(TITLE_SWORD_SET);
      *step = WAIT_START;
      break;
    case WAIT_START:
      // $C44B: each round until Start
      if (start_held()) {
        took(TITLE_START_IS_HELD);
        *step = START_HELD;
        return YIELDS;
      }
      took(TITLE_START_NOT_HELD);
      follow_secret_buttons();
      move_sword();
      took(CALLS);
      *step = COUNT_DOWN;
      return YIELDS;
    case COUNT_DOWN: {
      // $C4D1: the time left, and the chosen line's colours, which blink through the four at $C628. When the time runs
      // out the original plays its demonstration, $C4F9, which isn't ported yet, so here the title screen stays.
      uint16_t left = ram16(TITLE_TIME);
      set_ram16(TITLE_TIME, (uint16_t)(left - 1));
      if (left == 0) set_ram16(TITLE_TIME, 0);
      BLINK++;
      for (int i = 0; i < 4; i++) RAM[ATTRIBUTES + 0x2A + i] = cart(7, (uint16_t)(0xC628 + ((BLINK >> 2) & 3)));
      took(TITLE_TIME_AND_BLINK);
      *step = WAIT_START;
      break;
    }
    case START_HELD:
      // $C453: once Start is let go, the game. Its third line, to continue, at $C553, isn't ported yet.
      if (start_held()) {
        took(TITLE_START_STILL_HELD);
        return YIELDS;
      }
      for (int i = 0; i < 4; i++) RAM[ATTRIBUTES + 0x2A + i] = 0;
      RAM[0xAC] = RAM[0xAD] = RAM[0xAA] = RAM[0xAB] = RAM[0xA6] = 0;
      RAM[0xC5] = RAM[0xC6] = 0x40;
      PLAYERS = PLAYERS_CHOSEN;
      RAM[0x0715] = RAM[0x0716] = 3;   // each player's lives
      RAM[0x94] = 0;                   // not the demonstration
      took(TITLE_GAME_BEGINS);
      if (GAME_PLAYED) took(TITLE_GAME_PLAYED_BEFORE);
      start_task(TASK_GAME);
      took(CALLS);
      return ENDS;
  }
}
