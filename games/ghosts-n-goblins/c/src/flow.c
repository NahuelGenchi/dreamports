// Ghosts'n Goblins Dreamport: the game's own task, from the original's code at $C8C4, which takes a game from Start on
// the title screen into its first stage: the "PLAYER 1 READY" screen, the stage's tiles and colours from the player's
// copy, the stage's first screen, drawn a column a round with the picture off, the scene the game opens with, and then
// the stage itself, with the score, the time and the weapon at the top, where it has a turn every round. When Arthur
// dies a life is lost, and the next starts with the same screen, then the map of the stages, and the stage again.
//
// So far a stage's round does little: its time counts down, the zombies come out of the ground (enemies.c), and the
// stage's own objects are only placed when they're things to pick up. The demonstration, a second player's turn, and the stage the
// title screen's secret chooses aren't ported yet either.

#include "game.h"

#define DEMONSTRATION RAM[0x94]
#define PLAYER RAM[0xBA]          // whose turn it is, 0 or 1
#define LIVES 0x0715              // each player's
#define STAGE RAM[0xC2]           // the place in the game, which the stage's tables are read by,
#define STAGE_SET RAM[0xCF]       // and which of the stages' sets of tiles it uses
#define VIEW_HELD RAM[0xBC]       // on while the view is moved to draw the stage's first screen, so the stage's edges don't stop it
#define VIEW_X_SCREEN RAM[0x65]   // which screen across the stage the view is at
enum { ARTHUR = 0, PRINCESS = 1, SATAN = 2, ARMOUR = 3 };  // the scene's objects, and the "READY" screen's head is the second
enum { TOP_WORDS = 0x16, WEAPON_SHOWN = 0x18 };            // the two objects at the top of a stage's picture
#define STAGE_OBJECTS_PLACED RAM[0xC1]  // how many of the stage's own objects have been placed
#define ROUNDS RAM[0x83]
#define FRAMES_PLAYED RAM[0x4D]         // V-blank counts them: 60 are a second of the stage's time

// $C97C to $C9ED: the screen that says whose turn it is: its words, from $CBD2, Arthur's head, and the lives left.
static void draw_ready_screen(void) {
  took(GAME_READY_COLOURS);
  queue_background_palette(0xCB46);            // sub_CB8B
  took(GAME_READY_WORDS);
  queue_rows(0xCBD2, 0x218B, 2, 9);            // sub_C9F6. A second player's own words, at $CA0D, aren't ported yet.
  took(GAME_READY_FIRST_PLAYER);
  RAM[OBJECT_SHAPE + 1] = 0x1D;
  RAM[OBJECT_SCREEN_Y + 1] = 0x7C;
  RAM[OBJECT_SCREEN_X + 1] = 0x70;
  RAM[OBJECT_COLOURS + 1] = 0x02;
  RAM[OBJECT_FLAGS + 1] = OBJECT_FLAG_SHOWN;
  took(GAME_READY_HEAD);
  // the lives left after this one, as two digits, the first empty below ten. Ten or more, at $C9BA, isn't ported yet.
  RAM[0xA0] = (uint8_t)(RAM[LIVES + PLAYER] - 1);
  RAM[0x9F] = 0xFF;
  took(GAME_READY_LIVES);
  queue_rows(0x009F, 0x21EF, 1, 2);
  took(CALLS);
  picture_on();
}

// $CEF8: the opening scene's four objects, each where the scene starts it, and the task that moves Arthur.
static void start_scene(void) {
  RAM[OBJECT_FLAGS + ARTHUR] = 0xFF;
  RAM[OBJECT_FLAGS + PRINCESS] = RAM[OBJECT_FLAGS + SATAN] = 0x40;
  RAM[OBJECT_FLAGS + ARMOUR] = 0xC0;
  RAM[OBJECT_SHAPE + PRINCESS] = 0xF0;
  RAM[OBJECT_KIND + PRINCESS] = 0x33;
  RAM[OBJECT_KIND + SATAN] = 0x34;
  RAM[OBJECT_KIND + ARMOUR] = 0x10;
  RAM[OBJECT_STATE + ARMOUR] = 0x05;
  RAM[OBJECT_Y + PRINCESS] = 0xBA;
  RAM[OBJECT_X + PRINCESS] = 0x80;
  RAM[OBJECT_Y + SATAN] = 0x40;
  RAM[OBJECT_X + SATAN] = 0xC0;
  RAM[OBJECT_Y + ARMOUR] = 0xBA;
  RAM[OBJECT_X + ARMOUR] = 0x90;
  RAM[OBJECT_Y_SCREEN + PRINCESS] = RAM[OBJECT_X_SCREEN + PRINCESS] = RAM[OBJECT_COUNT + PRINCESS] = 0;
  RAM[OBJECT_Y_SCREEN + SATAN] = RAM[OBJECT_X_SCREEN + SATAN] = RAM[OBJECT_COUNT + SATAN] = 0;
  RAM[OBJECT_Y_SCREEN + ARMOUR] = RAM[OBJECT_X_SCREEN + ARMOUR] = 0;
  SCENE_PLAYING = 0xFF;
  took(SCENE_SET_UP);
  start_task(TASK_ARTHUR);
  took(SCENE_MUSIC_CALLED);
  sound_play(9);
}

// sub_CF73: the tiles every stage uses, 1,792 bytes from bank 0, and then this stage's own, 4 KB from the bank and place
// the tables at $CC9B and $CCA2 give. Called each turn until it's DONE.
static wait load_stage_tiles(uint8_t *step) {
  enum { EVERY_STAGES, OWN };
  static uint8_t loading;
  wait how;
  if (*step == EVERY_STAGES) {
    if (!loading) {
      switch_bank(0);
      took(STAGE_TILES_BEGIN);
    }
    how = load_tiles(&loading, 0x8000, 0x0000, 0x0E);
    if (how != DONE) return how;
    *step = OWN;
  }
  if (!loading) {
    switch_bank(cart(7, (uint16_t)(0xCC9B + STAGE_SET)));
    took(STAGE_TILES_OWN);
  }
  how = load_tiles(&loading, (uint16_t)(cart(7, (uint16_t)(0xCCA2 + STAGE_SET)) << 8), 0x1000, 0x20);
  if (how != DONE) return how;
  *step = EVERY_STAGES;
  return DONE;
}

// sub_D871: the stage's colours, from where its bank's list at $801C points.
static void queue_stage_colours(void) {
  took(STAGE_COLOURS_FOUND);
  queue_background_palette(peek16((uint16_t)(0x801C + STAGE * 2)));
}

// sub_CFB0: the stage's own bank, its map, and the view's task, with the view where the table at $CCC5 starts it. Then, at
// $D004, the view moves 8 pixels a round, so the view's task draws a column each time, until it's at the screen the table
// at $CCFD gives. Called each turn until it's DONE.
static wait draw_first_screen(uint8_t *step) {
  enum { START, MOVES, MOVED };
  for (;;) switch (*step) {
    case START:
      BANK_HOME = cart(7, (uint16_t)(0xCC94 + STAGE_SET));
      switch_bank(BANK_HOME);
      COLUMN_READY = 0;
      set_ram16(0x95, peek16((uint16_t)(0x8000 + cart(7, (uint16_t)(0xCD46 + STAGE_SET)))));
      took(FIRST_SCREEN_BEGINS);
      start_task(TASK_VIEW);
      RAM[0x64] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4));
      RAM[0x65] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4 + 1));
      RAM[0x67] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4 + 2));
      RAM[0x68] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4 + 3));
      RAM[0x66] = RAM[0x63] = RAM[0x5F] = RAM[0x60] = RAM[0x61] = RAM[0x5C] = 0;
      VIEW_HELD = 0xFF;
      took(FIRST_SCREEN_VIEW_SET);
      *step = MOVES;
      break;
    case MOVES:
      RAM[0x5D] = 8;
      ROUNDS = 0;
      took(FIRST_SCREEN_MOVES);
      *step = MOVED;
      return YIELDS;
    case MOVED:
      if ((0xCCFD & 0xFF) + STAGE > 0xFF) took(READ_PAST_PAGE);   // the table's entries from the fourth on
      if (cart(7, (uint16_t)(0xCCFD + STAGE)) != VIEW_X_SCREEN) {
        took(FIRST_SCREEN_NOT_THERE);
        *step = MOVES;
        break;
      }
      VIEW_HELD = 0;
      took(FIRST_SCREEN_THERE);
      *step = START;
      return DONE;
  }
}

// What the game's task's X register holds, which the original mixes into $CA every fourth round: 12 after the score's
// digits, and then the last object it placed.
static uint8_t last_index;

// sub_D8D8: the score's six digits at the top of the picture, empty until its first that isn't 0. It leaves 12 in the
// processor's X register.
static uint8_t show_score(void) {
  uint8_t empty = 0xFF, digit = 0;
  took(SCORE_SHOWN_BEGINS);
  for (uint8_t at = PLAYER; at < 0x0C; at += 2, digit += 2) {
    if (RAM[0x04E0 + at]) empty = 0;
    RAM[0x06E0 + digit] = RAM[0x04E0 + at] ? RAM[0x04E0 + at] : empty;
    took(RAM[0x04E0 + at] ? SCORE_DIGIT : SCORE_DIGIT_EMPTY);
    took(at + 2 < 0x0C ? GOES_ROUND : GOES_ON);
  }
  took(RETURNS);
  RAM[0xE4] = empty;
  return digit;
}

// The score is six digits and a seventh that's always 0, a byte each, the two players' turn about from $04E0. The best
// score, seven digits at $8D, takes any score that passes it. The life a score gives, at $D9BF, isn't ported yet.
void add_score(uint8_t x, uint8_t y) {
  RAM[0x25] = RAM[0x24] = 0;
  took(SCORE_TENS_AND_HUNDREDS);
  add_score_with_thousands(x, y);
}
void add_score_with_thousands(uint8_t x, uint8_t y) {
  enum { SCORE = 0x04E0, BEST = 0x8D, HOLDS_BEST = 0x04EE, DIGITS = 6 };
  static const uint8_t ADDED[] = { 0x26, 0x27, 0x24, 0x25 };   // where what's added to each digit is, from the last
  RAM[0xA8] = x;
  RAM[0xA9] = y;
  if (DEMONSTRATION) { took(SCORE_NOT_IN_DEMONSTRATION); return; }
  took(SCORE_BEGINS);
  uint8_t carried = 0;
  for (unsigned digit = 0; digit < DIGITS; digit++) {
    uint16_t at = (uint16_t)(SCORE + (DIGITS - 1 - digit) * 2 + PLAYER);
    uint8_t sum = (uint8_t)(RAM[at] + (digit < sizeof ADDED ? RAM[ADDED[digit]] : 0) + carried);
    carried = sum >= 10;
    RAM[at] = carried ? (uint8_t)(sum - 10) : sum;
    took(digit == 0 ? SCORE_FIRST_DIGIT : digit < sizeof ADDED ? SCORE_NEXT_DIGIT : SCORE_LAST_DIGITS);
    took(carried ? SCORE_DIGIT_OVER_NINE : SCORE_DIGIT_KEPT);
  }
  took(SCORE_BEST_BEGINS);
  int beats = 0;
  for (unsigned digit = 0; digit <= DIGITS; digit++) {
    uint8_t best = RAM[BEST + digit], mine = RAM[SCORE + PLAYER + digit * 2];
    if (best < mine) { took(SCORE_BEATS_BEST); beats = 1; break; }
    if (best != mine) { took(SCORE_BELOW_BEST); break; }
    took(SCORE_SAME_DIGIT);
    took(digit < DIGITS ? GOES_ROUND : SCORE_SAME_AS_BEST);
  }
  if (beats) {
    for (unsigned digit = 0; digit <= DIGITS; digit++) RAM[BEST + digit] = RAM[SCORE + PLAYER + digit * 2];
    took(SCORE_BEST_KEPT);
    if (RAM[HOLDS_BEST + PLAYER]) took(SCORE_BEST_MARKED_ALREADY);
    else {
      RAM[HOLDS_BEST + (PLAYER ^ 1)] = PLAYER ^ 1;
      RAM[HOLDS_BEST + PLAYER] = 0xFF;
      took(SCORE_BEST_MARKED);
    }
  }
  took(SCORE_LIFE_LOOKED_AT);
  took(CALLS);
  show_score();
  took(SCORE_ENDS);
}

// $D17A: the words at the top of a stage's picture. They're one object, whose shape is kept in work memory at $06D6,
// from the copy's at $CD16, so the score, the lives and the time can be written into it; the weapon Arthur has is another.
static void start_top_of_picture(void) {
  for (int i = 0; i < 0x28; i++) RAM[0x06D6 + i] = cart(7, (uint16_t)(0xCD16 + i));
  took(TOP_SHAPE_COPIED);
  took(CALLS);
  last_index = show_score();
  RAM[OBJECT_SCREEN_X + TOP_WORDS] = cart(7, (uint16_t)(0xCD44 + PLAYER));
  RAM[0x06D8] = (uint8_t)(PLAYER + 1);
  RAM[OBJECT_FLAGS + TOP_WORDS] = OBJECT_FLAG_SHOWN;
  RAM[OBJECT_SCREEN_Y + TOP_WORDS] = 0x20;
  RAM[OBJECT_SHAPE + TOP_WORDS] = 0xFF;
  RAM[OBJECT_COLOURS + TOP_WORDS] = 0x20;
  took(TOP_WORDS_PLACED);
  // sub_D9F8: the lives left after this one. Ten or more, at $DA08, isn't ported yet.
  RAM[0x22] = 0;
  RAM[0x0702] = (uint8_t)(RAM[LIVES + PLAYER] - 1);
  RAM[0x0700] = 0;
  took(TOP_LIVES);
  // sub_D82B: the stage's time, three digits from the table at $D847
  RAM[0x06F6] = cart(7, (uint16_t)(0xD847 + STAGE * 3));
  RAM[0x06FA] = cart(7, (uint16_t)(0xD847 + STAGE * 3 + 1));
  RAM[0x06FC] = cart(7, (uint16_t)(0xD847 + STAGE * 3 + 2));
  took(TOP_TIME);
}

// sub_CAFD: the stage's music, unless it plays already.
static void stage_music(void) {
  if (!RAM[0x0709]) took(STAGE_MUSIC_KEPT);
  else if (DEMONSTRATION) took(STAGE_MUSIC_DEMONSTRATION);
  else {
    RAM[0x0709] = 0;
    took(STAGE_MUSIC_BEGINS);
    sound_reset();
    took(STAGE_MUSIC_CHOSEN);
    sound_play((uint8_t)((STAGE_SET >> 1) + 2));
  }
}

// $D341: the view has passed the screen where the stage's next part begins, which the copy's list at $CD0B gives for
// each. The part has its own list of objects, set of tiles for the tiles' task, and time, and the objects of the last
// part that aren't shown are gone. The parts 2, 5 and 6 keep the time and the counts.
static void next_part(void) {
  RAM[0xAC + PLAYER]++;
  STAGE++;
  RAM[0xDA] = cart(7, (uint16_t)(0xCCB7 + STAGE));
  STAGE_OBJECTS_PLACED = 0;
  RAM[0xBD] = 0;
  took(NEXT_PART_BEGINS);
  if (STAGE == 2 || STAGE == 5 || STAGE == 6) took(STAGE == 2 ? NEXT_PART_KEEPS_2 : STAGE == 5 ? NEXT_PART_KEEPS_5 : NEXT_PART_KEEPS_6);
  else {
    RAM[0xEA] = RAM[0x0718] = 8;
    took(NEXT_PART_COUNTS);
    if (RAM[0x0709]) {
      took(NEXT_PART_MUSIC_CALLED);
      stage_music();
    } else took(BRANCH_TAKEN);
    RAM[0x06F6] = cart(7, (uint16_t)(0xD847 + STAGE * 3));
    RAM[0x06FA] = cart(7, (uint16_t)(0xD847 + STAGE * 3 + 1));
    RAM[0x06FC] = cart(7, (uint16_t)(0xD847 + STAGE * 3 + 2));
    took(NEXT_PART_TIME);
  }
  took(NEXT_PART_CLEARS);
  for (uint8_t object = 1; object <= 0x10; object++) {
    if (object == 0x10) took(READ_PAST_PAGE);
    if (RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN) took(NEXT_PART_OBJECT_KEPT);
    else {
      RAM[OBJECT_FLAGS + object] = 0;
      took(NEXT_PART_OBJECT_CLEARED);
    }
    took(object < 0x10 ? GOES_ROUND : GOES_ON);
  }
}

// $D16E: a stage starts: Arthur's task, the picture, the top of the picture, the stage's counts all at their start, a
// round every three frames from here on, and the stage's music. What stages after the second set up, at $D1B5 and
// $D26A, and two weapons' own places at the top, at $D1F9, aren't ported yet.
static void start_stage(void) {
  took(STAGE_START_ARTHUR);
  start_task(TASK_ARTHUR);
  took(CALLS);
  picture_on();
  took(DEMONSTRATION ? STAGE_START_NO_TOP : STAGE_START_TOP);
  if (!DEMONSTRATION) start_top_of_picture();
  took(STAGE_START_NO_BANNER);
  took(STAGE_START_WEAPON);
  RAM[OBJECT_SHAPE + WEAPON_SHOWN] = RAM[0xC5 + PLAYER];
  RAM[OBJECT_FLAGS + WEAPON_SHOWN] = OBJECT_FLAG_SHOWN;
  RAM[OBJECT_SCREEN_Y + WEAPON_SHOWN] = 0xD4;
  RAM[OBJECT_SCREEN_X + WEAPON_SHOWN] = 0x80;
  static const uint16_t CLEARED[] = { 0xC3, 0xC4, 0xBD, 0xBC, 0x81, 0xD0, 0xE3, 0xE2, 0xE1, 0xE7, 0xE9, 0x0707, 0xEB, 0x070A, 0x070B, 0x070C, 0x0717, 0x0719 };
  for (unsigned i = 0; i < sizeof CLEARED / sizeof *CLEARED; i++) RAM[CLEARED[i]] = 0;
  RAM[0xCE] = 1;
  FRAMES_A_ROUND = 3;
  RAM[0xDF] = RAM[0xE8] = RAM[0x0709] = 0xFF;
  // how hard the game is for this player, which three of its counts are worked out from
  RAM[0xD2] = (uint8_t)(RAM[0xAA + PLAYER] << 1);
  RAM[0xD3] = (uint8_t)(RAM[0xAA + PLAYER] << 2);
  RAM[0x5B] = (uint8_t)(RAM[0xAA + PLAYER] << 3);
  RAM[0xEA] = RAM[0x0718] = 8;
  took(STAGE_START_COUNTS);
  FRAMES_PLAYED = 0;
  took(STAGE_START_TIME);
  stage_music();
}

// sub_D596: the stage's own objects, from where its bank's list at $8038 points, eight bytes each: the screen Arthur has
// to reach, a kind, and where it is. Each is placed once Arthur is on its screen, in the first free object. Only the
// kinds the table at $D5FB sends to $D71B, $D72B, $D804, $D6B9 and $D670 are ported, which are placed as they're listed.
static uint8_t listed_byte(uint16_t listed, uint8_t on) {
  if ((listed & 0xFF) + on > 0xFF) took(READ_PAST_PAGE);
  return peek((uint16_t)(listed + on));
}
static void place_stage_objects(void) {
  uint16_t listed = (uint16_t)(peek16((uint16_t)(0x8038 + STAGE * 2)) + STAGE_OBJECTS_PLACED * 8);
  set_ram16(0x26, listed);
  took(STAGE_OBJECT_LISTED);
  uint8_t screen = peek(listed), arthurs = RAM[OBJECT_X_SCREEN + ARTHUR];
  if (screen == 0x80) { took(STAGE_OBJECTS_OVER); return; }
  if (screen > arthurs) { took(STAGE_OBJECT_NOT_YET); return; }
  took(screen == arthurs ? STAGE_OBJECT_ON_ITS_SCREEN : STAGE_OBJECT_PAST_ITS_SCREEN);
  uint8_t kind = listed_byte(listed, 2);
  set_ram16(0x24, (uint16_t)(0xD5FB + kind * 2));
  set_ram16(0x22, cart(7, ram16(0x24)) | cart(7, (uint16_t)(ram16(0x24) + 1)) << 8);
  took(STAGE_OBJECT_KIND);
  if (RAM[0x24] == 0xFF) took(READ_PAST_PAGE);   // the entry's second byte, when its first is a page's last
  // a kind's own routine: $D71B, whose state starts at 0, or $D72B, whose state the list gives, which $D804 jumps to
  // and $D6B9, which leaves the state as the object's last user left it, and which $D670 jumps to
  // and $D706, a moving platform's, which gives it a heading and a shape too
  enum { STATE_ZERO = 0xD71B, STATE_LISTED = 0xD72B, STATE_LISTED_TOO = 0xD804, STATE_KEPT = 0xD6B9, STATE_KEPT_TOO = 0xD670, PLATFORM = 0xD706 };
  uint16_t routine = ram16(0x22);
  if (routine == STATE_LISTED_TOO) { took(JUMPS); routine = STATE_LISTED; }
  if (routine == STATE_KEPT_TOO) { took(JUMPS); routine = STATE_KEPT; }
  if (routine != STATE_ZERO && routine != STATE_LISTED && routine != STATE_KEPT && routine != PLATFORM) return;
  took(CALLS);
  uint8_t object = free_object();
  if (object == NO_OBJECT) {
    took(STAGE_OBJECT_NO_ROOM);
    return;
  }
  took(routine == STATE_ZERO ? STAGE_OBJECT_STATE : routine == STATE_LISTED ? STAGE_OBJECT_STATE_LISTED : routine == PLATFORM ? STAGE_OBJECT_PLATFORM : STAGE_OBJECT_STATE_KEPT);
  last_index = object;
  if (routine == PLATFORM) {
    RAM[OBJECT_HEADING + object] = 0x0C;
    RAM[OBJECT_SHAPE + object] = 0x5F;
  }
  if (routine != STATE_KEPT) RAM[OBJECT_STATE + object] = routine == STATE_ZERO ? 0 : listed_byte(listed, 1);
  RAM[0x0647 + object] = 0;
  RAM[OBJECT_COUNT + object] = 0;
  RAM[OBJECT_KIND + object] = kind;
  RAM[OBJECT_X + object] = listed_byte(listed, 3);
  RAM[OBJECT_X_SCREEN + object] = listed_byte(listed, 4);
  RAM[OBJECT_Y + object] = listed_byte(listed, 5);
  RAM[OBJECT_Y_SCREEN + object] = listed_byte(listed, 6);
  RAM[OBJECT_FLAGS + object] = listed_byte(listed, 7);
  if ((listed & 0xFF) + 2 > 0xFF) took(READ_PAST_PAGE);   // the kind is read again there
  STAGE_OBJECTS_PLACED++;
  took(STAGE_OBJECT_FILLED);
}

// $8400 in bank 2: what comes at Arthur by itself: the zombies and the flying knights (enemies.c), the forest's enemies
// (forest.c), and four other routines, at $8574, $867A, $880A and $8748, which have nothing to do in the first stage and
// aren't ported yet.
static void stage_dangers(void) {
  took(DANGERS_OTHERS);
  zombies_come(&last_index);
  knights_come(&last_index);
  forest_enemies_come(&last_index);
}

// $D38D: the stage's time, which the top of the picture shows as a minute and two digits of seconds. V-blank counts
// frames, and 60 of them take a second off. With none left Arthur dies, and in the last quarter of a minute the music
// changes to hurry him.
static void count_time_down(void) {
  enum { MINUTES = 0x06F6, TENS = 0x06FA, ONES = 0x06FC };
  if (FRAMES_PLAYED < 60) { took(TIME_NO_SECOND); return; }
  FRAMES_PLAYED -= 60;
  took(TIME_SECOND);
  if (RAM[ONES]--) took(TIME_ONES);
  else {
    RAM[ONES] = 9;
    if (RAM[TENS]--) took(TIME_TENS);
    else {
      RAM[TENS] = 5;
      RAM[MINUTES]--;
      took(TIME_MINUTES);
    }
  }
  took(TIME_LEFT_LOOKED_AT);
  if (RAM[ONES] | RAM[TENS] | RAM[MINUTES]) took(TIME_IS_LEFT);
  else {
    RAM[OBJECT_FLAGS + ARTHUR] |= 0x01;   // he's hit, and dies of it
    RAM[0xBD] = 0xFF;
    took(TIME_IS_OVER);
  }
  if (RAM[0x0709]) { took(TIME_HURRY_PLAYS); return; }
  if (RAM[MINUTES]) { took(TIME_MINUTES_LEFT); return; }
  took(TIME_SECONDS_LEFT);
  if (RAM[TENS] * 10 + RAM[ONES] >= 16) { took(TIME_ENOUGH); return; }
  took(TIME_HURRY_CALLED);
  sound_play(0x0B);
  RAM[0x0709] = 0xFF;
  took(TIME_HURRY_SET);
}

// $D284: the game's turn each round of a stage: this player's buttons, the stage's colours again every fourth round,
// the stage's time, its objects and its dangers. Start, which pauses, at $D88C, the end of the stage, at $D341, and what
// happens when Arthur dies aren't ported yet.
static int stage_round(void) {
  RAM[0x89] = PAD_1;
  RAM[0x8A] = RAM[0x44];
  PAD_NOW = RAM[0x89 + PLAYER];
  took(GAME_ROUND_BEGINS);
  // $D2AA: a sound an enemy has asked for is played once its rounds have passed without it asking again
  if (!RAM[0xEB] && RAM[0xE8] != 0xFF) {
    if (++RAM[0xE7] < RAM[0xE9]) took(ASKED_SOUND_WAITS);
    else {
      took(ASKED_SOUND_PLAYS);
      sound_play(RAM[0xE8]);
      RAM[0xE8] = 0xFF;
      RAM[0xE7] = 0;
      took(ASKED_SOUND_PLAYED);
    }
  }
  uint8_t mixed = ROUNDS & 3;
  if (mixed) took(GAME_ROUND_NO_COLOURS);
  else {
    took(GAME_ROUND_COLOURS);
    queue_stage_colours();
    mixed = last_index;
  }
  ROUNDS++;
  RAM[0xCA] = (uint8_t)((mixed + ROUNDS) & 0x0F);
  took(GAME_ROUND_MIX);
  took(GAME_ROUND_CHECKS);
  if (STAGE_SET < 4 && cart(7, (uint16_t)(0xCD0B + STAGE)) < RAM[0x65]) next_part();
  // the time stands still while $C9 is on, and once it's over
  if (RAM[0xC9]) took(TIME_STOPPED);
  else if (RAM[0xBD]) took(TIME_OVER_ALREADY);
  else {
    took(TIME_LOOKED_AT);
    count_time_down();
  }
  took(GAME_ROUND_OBJECTS);
  if (!RAM[0xEB]) {
    place_stage_objects();
    took(GAME_ROUND_DANGERS);
    switch_bank(2);
    stage_dangers();
    switch_bank(BANK_HOME);
    took(GAME_ROUND_AFTER);
  }
  if (RAM[0x81]) {
    took(GAME_LIFE_IS_OVER);
    return 1;
  }
  took(GAME_ROUND_ENDS);
  return 0;
}

// $D408 and $C8FF: a life is over, once Arthur's task has said so at $81. The sound stops, the weapon he had is kept for
// his next life, the stage's tasks stop, and with a life left the next begins as a game does, but for the opening
// scene, which $A6 now keeps away. The places that send him back to an earlier one, at $D422 and $D42E, a second
// player's turn, at $C91E, and the game's end with no life left, at $C90C, aren't ported yet.
static void lose_life(void) {
  took(CALLS);
  sound_reset();
  RAM[0xC5 + PLAYER] = WEAPON_HELD;
  took(LIFE_OVER_WEAPON_KEPT);
  stop_game_tasks();
  RAM[0xA6] = 0xFF;
  RAM[LIVES]--;
  took(LIFE_LOST);
}

// sub_CD9B: the map of the game's stages, which every life but a game's first starts with: its tiles, 6 KB from bank
// 0, both name tables cleared, the map's picture and the stages' names from where bank 2's lists at $8014 and $8016
// point, and a marker, kind $22, at the place the tables at $CC50 and $CC78 give for the player's. After a second the
// picture moves 112 pixels across, one a round, and stays another second. Called each turn until it's DONE.
static wait show_map(uint8_t *step) {
  enum { TILES, TILES_LOADING, CLEAR_FIRST, FIRST_CLEARING, CLEAR_SECOND, SECOND_CLEARING, PICTURE, NAMES, MARKER, MOVES, MOVED, OVER };
  enum { MARKER_OBJECT = 1, PLACE = 0xAC };
  static uint8_t loading;
  for (;;) switch (*step) {
    case TILES:
      switch_bank(0);
      took(MAP_TILES_BEGIN);
      *step = TILES_LOADING;
      break;
    case TILES_LOADING: {
      wait how = load_tiles(&loading, 0x8800, 0x0800, 0x30);
      if (how != DONE) return how;
      took(MAP_CLEARS_FIRST);
      clear_rows_begin(0);
      *step = CLEAR_FIRST;
      break;
    }
    case CLEAR_FIRST:
    case CLEAR_SECOND:
      clear_rows_queue();
      ++*step;
      return SPINS;
    case FIRST_CLEARING:
      if (!clear_rows_done()) { *step = CLEAR_FIRST; break; }
      took(MAP_CLEARS_SECOND);
      clear_rows_begin(1);
      *step = CLEAR_SECOND;
      break;
    case SECOND_CLEARING:
      if (!clear_rows_done()) { *step = CLEAR_SECOND; break; }
      BANK_HOME = 2;
      switch_bank(2);
      took(MAP_PICTURE);
      queue_rows(peek16(0x8014), 0x21C0, 1, 0xC0);
      took(CALLS);
      *step = NAMES;
      return YIELDS;
    case NAMES:
      took(MAP_NAMES);
      queue_rows(peek16(0x8016), 0x2560, 9, 0x0B);
      BANK_HOME = 2;
      switch_bank(2);
      took(MAP_BANK_AGAIN);
      *step = MARKER;
      return YIELDS;
    case MARKER: {
      took(MAP_SOUND);
      sound_play(1);
      took(CALLS);
      picture_on();
      uint8_t place = RAM[PLACE + PLAYER];
      RAM[OBJECT_X + MARKER_OBJECT] = cart(7, (uint16_t)(0xCC50 + place * 2));
      RAM[OBJECT_X_SCREEN + MARKER_OBJECT] = cart(7, (uint16_t)(0xCC50 + place * 2 + 1));
      RAM[OBJECT_Y + MARKER_OBJECT] = cart(7, (uint16_t)(0xCC78 + place));
      RAM[OBJECT_SHAPE + MARKER_OBJECT] = 0x1B;
      RAM[OBJECT_Y_SCREEN + MARKER_OBJECT] = 0;
      RAM[OBJECT_KIND + MARKER_OBJECT] = 0x22;
      RAM[OBJECT_FLAGS + MARKER_OBJECT] = 0x40;
      took(MAP_MARKER_SET);
      *step = MOVES;
      return sleep_task(60);
    }
    case MOVES:
      SCROLL_X++;
      RAM[0x64]++;   // the view's place across, which puts the marker on the screen
      took(MAP_MOVES);
      *step = MOVED;
      return YIELDS;
    case MOVED:
      if (SCROLL_X < 0x70) {
        took(MAP_NOT_THERE);
        *step = MOVES;
        break;
      }
      took(MAP_THERE);
      *step = OVER;
      return sleep_task(60);
    case OVER:
      RAM[OBJECT_FLAGS + MARKER_OBJECT] = 0;
      took(MAP_ENDS);
      *step = TILES;
      return DONE;
  }
}

wait game_task(void) {
  enum {
    NEW_GAME, READY_BEGINS, READY_SCREEN, READY_PICTURE_OFF, READY_TILES_BEGIN, READY_TILES, READY_SHOWN, AFTER_READY, STAGE_PICTURE_OFF,
    STAGE_COLOURS, STAGE_ATTRIBUTES, SCENE_START, MAP, MAP_OVER, SCENE_TILES_BEGIN, SCENE_TILES, SCENE_OWN_TILES_BEGIN, SCENE_OWN_TILES, SCENE_COLOURS,
    SCENE_OBJECT_COLOURS, SCENE_SCREEN, SCENE, STAGE_OFF, STAGE_SET_UP, STAGE_TILES, STAGE_OBJECT_TILES_BEGIN, STAGE_OBJECT_TILES,
    STAGE_SCREEN_BEGINS, STAGE_SCREEN, STAGE_WAITS, STAGE_STARTS, STAGE_ROUND, STAGE_ROUND_AGAIN,
  };
  static uint8_t inner, loading;
  uint8_t *step = &task_step[TASK_GAME];
  wait how;
  for (;;) switch (*step) {
    case NEW_GAME:
      // $C8C4: a new game starts with no score, and both players at the first place with five of something at $0711
      if (!DEMONSTRATION) {
        RAM[0xBB] = 0xFF;
        for (int i = 0; i < 14; i++) RAM[0x04E0 + i] = 0;
      }
      PLAYER = 0;
      RAM[0x070D] = RAM[0x070E] = RAM[0x070F] = RAM[0x0710] = RAM[0x0713] = RAM[0x0714] = 0;
      RAM[0x0711] = RAM[0x0712] = 5;
      took(DEMONSTRATION ? GAME_BEGINS_DEMONSTRATION : GAME_BEGINS);
      // sub_D01D
      FRAMES_A_ROUND = 2;
      inner = loading = 0;
      took(GAME_LIFE_BEGINS);
      took(CALLS);
      *step = READY_BEGINS;
      return picture_off();
    case READY_BEGINS:
      // sub_C971
      took(GAME_READY_BEGINS);
      took(CALLS);
      *step = READY_SCREEN;
      break;
    case READY_SCREEN:
      how = fresh_screen(&inner);
      if (how != DONE) return how;
      *step = READY_PICTURE_OFF;
      break;
    case READY_PICTURE_OFF:
      *step = READY_TILES_BEGIN;
      took(CALLS);
      return picture_off();
    case READY_TILES_BEGIN:
      // sub_CB66: the screen's letters, 1 KB of tiles from bank 0's $9000
      switch_bank(0);
      took(GAME_READY_TILES_BEGIN);
      *step = READY_TILES;
      break;
    case READY_TILES:
      how = load_tiles(&loading, 0x9000, 0x1000, 8);
      if (how != DONE) return how;
      switch_bank(BANK_HOME);
      took(GAME_READY_BANK_BACK);
      draw_ready_screen();
      took(GAME_READY_SLEEPS);
      *step = READY_SHOWN;
      return sleep_task(90);
    case READY_SHOWN:
      RAM[OBJECT_FLAGS + 1] = 0;
      took(GAME_READY_OVER);
      took(CALLS);
      *step = AFTER_READY;
      break;
    case AFTER_READY:
      how = fresh_screen(&inner);
      if (how != DONE) return how;
      *step = STAGE_PICTURE_OFF;
      break;
    case STAGE_PICTURE_OFF:
      *step = STAGE_COLOURS;
      took(CALLS);
      return picture_off();
    case STAGE_COLOURS:
      took(GAME_STAGE_COLOURS);
      queue_background_palette(0xCB16);
      *step = STAGE_ATTRIBUTES;
      took(CALLS);
      return picture_off();
    case STAGE_ATTRIBUTES:
      // $D03B: the attributes of the rows above the stage, from $CBEE, and the rest for the view's task to fill
      RAM[0xBF] = RAM[0xC9] = 0;
      for (int i = 0; i < 0x10; i++) RAM[ATTRIBUTES + 0x18 + i] = cart(7, (uint16_t)(0xCBEE + i));
      for (int i = 0; i < 0x80; i++) RAM[ATTRIBUTES + 0x40 + i] = 0xFF;
      took(GAME_ATTRIBUTES);
      took(GAME_NO_STAGE_CHOICE);   // the stage the title screen's secret chooses, at $D065, isn't ported yet
      *step = SCENE_START;
      took(CALLS);
      return picture_off();
    case SCENE_START:
      // $D0D8: the objects' task, and then the map, unless this is a game's first life, at sub_CD8E. A map that
      // $070C asks for, at $CD95, isn't ported yet.
      took(GAME_OBJECTS_BEGIN);
      start_task(TASK_OBJECTS);
      took(GAME_MAP_LOOKED_AT);
      if (!RAM[0xA6]) {
        took(GAME_NO_MAP);
        *step = MAP_OVER;
        break;
      }
      took(GAME_MAP);
      *step = MAP;
      break;
    case MAP:
      how = show_map(&inner);
      if (how != DONE) return how;
      *step = MAP_OVER;
      break;
    case MAP_OVER:
      // sub_CE71: a game's first life opens with the scene, in the first stage, and the others go to the stage
      took(GAME_SCENE_LOOKED_AT);
      if (RAM[0xA6]) {
        took(GAME_NO_SCENE);
        *step = STAGE_OFF;
        break;
      }
      took(GAME_SCENE);
      *step = SCENE_TILES_BEGIN;
      took(CALLS);
      return picture_off();
    case SCENE_TILES_BEGIN:
      STAGE = 0;
      STAGE_SET = 0;
      took(GAME_SCENE_STAGE);
      *step = SCENE_TILES;
      break;
    case SCENE_TILES:
      how = load_stage_tiles(&inner);
      if (how != DONE) return how;
      *step = SCENE_OWN_TILES_BEGIN;
      took(CALLS);
      return YIELDS;
    case SCENE_OWN_TILES_BEGIN:
      // $CE94: and the scene's own, from the seventh entry of the tables at $CCA9 and $CCB0
      switch_bank(cart(7, 0xCCA9 + 6));
      took(GAME_SCENE_OWN_TILES);
      *step = SCENE_OWN_TILES;
      break;
    case SCENE_OWN_TILES:
      how = load_tiles(&loading, (uint16_t)(cart(7, 0xCCB0 + 6) << 8), 0x0700, 0x12);
      if (how != DONE) return how;
      // the tiles' task sends its second list's fourth set while the stage is drawn
      for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
      RAM[0xDA] = 3;
      took(GAME_OBJECT_TILES_ASKED);
      *step = SCENE_COLOURS;
      return YIELDS;
    case SCENE_COLOURS:
      BANK_HOME = 1;
      switch_bank(1);
      took(GAME_SCENE_COLOURS);
      queue_stage_colours();
      *step = SCENE_OBJECT_COLOURS;
      took(CALLS);
      return YIELDS;
    case SCENE_OBJECT_COLOURS:
      took(GAME_SCENE_OBJECT_COLOURS);
      queue_rows(0xCB36, 0x3F10, 1, 0x10);     // the scene's objects' colours
      took(CALLS);
      *step = SCENE_SCREEN;
      break;
    case SCENE_SCREEN:
      how = draw_first_screen(&inner);
      if (how != DONE) return how;
      took(CALLS);
      picture_on();
      start_scene();
      *step = SCENE;
      took(CALLS);
      return YIELDS;
    case SCENE:
      // $CF6C: a turn each round until the scene is over, and then the picture goes off
      if (SCENE_PLAYING) {
        took(GAME_SCENE_WAITS);
        return YIELDS;
      }
      took(GAME_SCENE_OVER);
      *step = STAGE_OFF;
      return picture_off();

    case STAGE_OFF:
      *step = STAGE_SET_UP;
      took(CALLS);
      return picture_off();
    case STAGE_SET_UP:
      // $D0E6: the stage this player is at, with none of its objects placed, and its set of tiles
      STAGE = 0;
      STAGE_OBJECTS_PLACED = 0;
      if (!DEMONSTRATION) STAGE = RAM[0xAC + PLAYER];
      STAGE_SET = cart(7, (uint16_t)(0xCC86 + STAGE));
      took(DEMONSTRATION ? GAME_STAGE_FOUND_DEMONSTRATION : GAME_STAGE_FOUND);
      *step = STAGE_TILES;
      break;
    case STAGE_TILES:
      how = load_stage_tiles(&inner);
      if (how != DONE) return how;
      *step = STAGE_OBJECT_TILES_BEGIN;
      break;
    case STAGE_OBJECT_TILES_BEGIN:
      // $D101: the stage's objects' tiles, from the tables at $CCA9 and $CCB0, and their colours, from $CB26. The last
      // stage's own colours, at $D132, aren't ported yet.
      switch_bank(cart(7, (uint16_t)(0xCCA9 + STAGE_SET)));
      took(GAME_STAGE_OBJECT_TILES);
      *step = STAGE_OBJECT_TILES;
      break;
    case STAGE_OBJECT_TILES:
      how = load_tiles(&loading, (uint16_t)(cart(7, (uint16_t)(0xCCB0 + STAGE_SET)) << 8), 0x0700, 0x12);
      if (how != DONE) return how;
      took(GAME_STAGE_OBJECT_COLOURS);
      queue_rows(0xCB26, 0x3F10, 1, 0x10);
      for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
      RAM[0xDA] = cart(7, (uint16_t)(0xCCB7 + STAGE));
      RAM[0xDF] = 0xFF;
      took(GAME_STAGE_TILES_ASKED);
      *step = STAGE_SCREEN_BEGINS;
      return YIELDS;
    case STAGE_SCREEN_BEGINS:
      took(CALLS);
      *step = STAGE_SCREEN;
      break;
    case STAGE_SCREEN:
      how = draw_first_screen(&inner);
      if (how != DONE) return how;
      *step = STAGE_WAITS;
      took(CALLS);
      return YIELDS;
    case STAGE_WAITS:
      *step = STAGE_STARTS;
      took(CALLS);
      return YIELDS;
    case STAGE_STARTS:
      start_stage();
      *step = STAGE_ROUND;
      break;
    case STAGE_ROUND:
      if (stage_round()) {
        lose_life();
        // sub_D01D
        FRAMES_A_ROUND = 2;
        took(GAME_LIFE_BEGINS);
        took(CALLS);
        *step = READY_BEGINS;
        return picture_off();
      }
      *step = STAGE_ROUND_AGAIN;
      return YIELDS;
    case STAGE_ROUND_AGAIN:
      took(GAME_ROUND_AGAIN);
      *step = STAGE_ROUND;
      break;
  }
}
