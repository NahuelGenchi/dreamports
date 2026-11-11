// Ghosts'n Goblins Dreamport: the game's own task, from the original's code at $C8C4, which takes a game from Start on
// the title screen into its first stage: the "PLAYER 1 READY" screen, the stage's tiles and colours from the player's
// copy, the stage's first screen, drawn a column a round with the picture off, the scene the game opens with, and then
// the stage itself, with the score, the time and the weapon at the top, where it has a turn every round.
//
// So far a stage's round does little: the time doesn't count down, nothing comes out of the ground, and the stage's own
// objects are only placed when they're things to pick up. The demonstration, a second player's turn, and the stage the
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
  queue_background_palette(0xCB46);            // sub_CB8B
  queue_rows(0xCBD2, 0x218B, 2, 9);            // sub_C9F6. A second player's own words, at $CA0D, aren't ported yet.
  RAM[OBJECT_SHAPE + 1] = 0x1D;
  RAM[OBJECT_SCREEN_Y + 1] = 0x7C;
  RAM[OBJECT_SCREEN_X + 1] = 0x70;
  RAM[OBJECT_COLOURS + 1] = 0x02;
  RAM[OBJECT_FLAGS + 1] = OBJECT_FLAG_SHOWN;
  // the lives left after this one, as two digits, the first empty below ten. Ten or more, at $C9BA, isn't ported yet.
  RAM[0xA0] = (uint8_t)(RAM[LIVES + PLAYER] - 1);
  RAM[0x9F] = 0xFF;
  queue_rows(0x009F, 0x21EF, 1, 2);
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
  start_task(TASK_ARTHUR);
  sound_play(9);
}

// sub_CF73: the tiles every stage uses, 1,792 bytes from bank 0, and then this stage's own, 4 KB from the bank and place
// the tables at $CC9B and $CCA2 give. Called each turn until it's DONE.
static wait load_stage_tiles(uint8_t *step) {
  enum { EVERY_STAGES, OWN };
  static uint8_t loading;
  wait how;
  if (*step == EVERY_STAGES) {
    if (!loading) switch_bank(0);
    how = load_tiles(&loading, 0x8000, 0x0000, 0x0E);
    if (how != DONE) return how;
    *step = OWN;
  }
  if (!loading) switch_bank(cart(7, (uint16_t)(0xCC9B + STAGE_SET)));
  how = load_tiles(&loading, (uint16_t)(cart(7, (uint16_t)(0xCCA2 + STAGE_SET)) << 8), 0x1000, 0x20);
  if (how != DONE) return how;
  *step = EVERY_STAGES;
  return DONE;
}

// sub_D871: the stage's colours, from where its bank's list at $801C points.
static void queue_stage_colours(void) { queue_background_palette(peek16((uint16_t)(0x801C + STAGE * 2))); }

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
      start_task(TASK_VIEW);
      RAM[0x64] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4));
      RAM[0x65] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4 + 1));
      RAM[0x67] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4 + 2));
      RAM[0x68] = cart(7, (uint16_t)(0xCCC5 + STAGE * 4 + 3));
      RAM[0x66] = RAM[0x63] = RAM[0x5F] = RAM[0x60] = RAM[0x61] = RAM[0x5C] = 0;
      VIEW_HELD = 0xFF;
      *step = MOVES;
      break;
    case MOVES:
      RAM[0x5D] = 8;
      ROUNDS = 0;
      *step = MOVED;
      return YIELDS;
    case MOVED:
      if (cart(7, (uint16_t)(0xCCFD + STAGE)) != VIEW_X_SCREEN) { *step = MOVES; break; }
      VIEW_HELD = 0;
      *step = START;
      return DONE;
  }
}

// What the game's task's X register holds, which the original mixes into $CA every fourth round: 12 after the score's
// digits, and then the last object it placed.
static uint8_t last_index;

// $D17A: the words at the top of a stage's picture. They're one object, whose shape is kept in work memory at $06D6,
// from the copy's at $CD16, so the score, the lives and the time can be written into it; the weapon Arthur has is another.
static void start_top_of_picture(void) {
  for (int i = 0; i < 0x28; i++) RAM[0x06D6 + i] = cart(7, (uint16_t)(0xCD16 + i));
  // sub_D8D8: the score's six digits, empty until its first that isn't 0
  uint8_t empty = 0xFF, digit = 0;
  for (uint8_t at = PLAYER; at < 0x0C; at += 2, digit += 2) {
    if (RAM[0x04E0 + at]) empty = 0;
    RAM[0x06E0 + digit] = RAM[0x04E0 + at] ? RAM[0x04E0 + at] : empty;
  }
  RAM[0xE4] = empty;
  last_index = digit;
  RAM[OBJECT_SCREEN_X + TOP_WORDS] = cart(7, (uint16_t)(0xCD44 + PLAYER));
  RAM[0x06D8] = (uint8_t)(PLAYER + 1);
  RAM[OBJECT_FLAGS + TOP_WORDS] = OBJECT_FLAG_SHOWN;
  RAM[OBJECT_SCREEN_Y + TOP_WORDS] = 0x20;
  RAM[OBJECT_SHAPE + TOP_WORDS] = 0xFF;
  RAM[OBJECT_COLOURS + TOP_WORDS] = 0x20;
  // sub_D9F8: the lives left after this one. Ten or more, at $DA08, isn't ported yet.
  RAM[0x22] = 0;
  RAM[0x0702] = (uint8_t)(RAM[LIVES + PLAYER] - 1);
  RAM[0x0700] = 0;
  // sub_D82B: the stage's time, three digits from the table at $D847
  RAM[0x06F6] = cart(7, (uint16_t)(0xD847 + STAGE * 3));
  RAM[0x06FA] = cart(7, (uint16_t)(0xD847 + STAGE * 3 + 1));
  RAM[0x06FC] = cart(7, (uint16_t)(0xD847 + STAGE * 3 + 2));
}

// $D16E: a stage starts: Arthur's task, the picture, the top of the picture, the stage's counts all at their start, a
// round every three frames from here on, and the stage's music. What stages after the second set up, at $D1B5 and
// $D26A, and two weapons' own places at the top, at $D1F9, aren't ported yet.
static void start_stage(void) {
  start_task(TASK_ARTHUR);
  picture_on();
  if (!DEMONSTRATION) start_top_of_picture();
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
  FRAMES_PLAYED = 0;
  // sub_CAFD: the stage's music
  if (RAM[0x0709] && !DEMONSTRATION) {
    RAM[0x0709] = 0;
    sound_reset();
    sound_play((uint8_t)((STAGE_SET >> 1) + 2));
  }
}

// sub_D596: the stage's own objects, from where its bank's list at $8038 points, eight bytes each: the screen Arthur has
// to reach, a kind, and where it is. Each is placed once Arthur is on its screen, in the first free object. Only the
// kinds the table at $D5FB sends to $D71B are ported, which are placed as they're listed.
static void place_stage_objects(void) {
  uint16_t listed = (uint16_t)(peek16((uint16_t)(0x8038 + STAGE * 2)) + STAGE_OBJECTS_PLACED * 8);
  set_ram16(0x26, listed);
  if (peek(listed) == 0x80 || peek(listed) > RAM[OBJECT_X_SCREEN + ARTHUR]) return;
  uint8_t kind = peek((uint16_t)(listed + 2));
  set_ram16(0x24, (uint16_t)(0xD5FB + kind * 2));
  set_ram16(0x22, cart(7, ram16(0x24)) | cart(7, (uint16_t)(ram16(0x24) + 1)) << 8);
  if (ram16(0x22) != 0xD71B) return;
  uint8_t object = 1;   // sub_DA18: the first free one of 16
  while (object < 0x11 && RAM[OBJECT_FLAGS + object]) object++;
  if (object == 0x11) return;
  last_index = object;
  RAM[OBJECT_STATE + object] = 0;
  RAM[0x0647 + object] = 0;
  RAM[OBJECT_COUNT + object] = 0;
  RAM[OBJECT_KIND + object] = kind;
  RAM[OBJECT_X + object] = peek((uint16_t)(listed + 3));
  RAM[OBJECT_X_SCREEN + object] = peek((uint16_t)(listed + 4));
  RAM[OBJECT_Y + object] = peek((uint16_t)(listed + 5));
  RAM[OBJECT_Y_SCREEN + object] = peek((uint16_t)(listed + 6));
  RAM[OBJECT_FLAGS + object] = peek((uint16_t)(listed + 7));
  STAGE_OBJECTS_PLACED++;
}

// $8400 in bank 2: what comes at Arthur by itself. In the first stage's first screens $EA counts rounds down, and each
// time it runs out it starts again from a number that's lower the harder the game is. What comes out of the ground then,
// at $8431, and the rest of this bank's routines, aren't ported yet.
static void stage_dangers(void) {
  if (STAGE != 0 || RAM[OBJECT_X_SCREEN + ARTHUR] >= 5) return;
  if (--RAM[0xEA]) return;
  RAM[0xEA] = (uint8_t)(0x60 - RAM[0x5B]);
}

// $D284: the game's turn each round of a stage: this player's buttons, the stage's colours again every fourth round,
// the stage's objects and its dangers. Start, which pauses, at $D88C, the time counting down, at $D394, the end of the
// stage, at $D341, and what happens when Arthur dies aren't ported yet.
static void stage_round(void) {
  RAM[0x89] = PAD_1;
  RAM[0x8A] = RAM[0x44];
  PAD_NOW = RAM[0x89 + PLAYER];
  uint8_t mixed = ROUNDS & 3;
  if (!mixed) {
    queue_stage_colours();
    mixed = last_index;
  }
  ROUNDS++;
  RAM[0xCA] = (uint8_t)((mixed + ROUNDS) & 0x0F);
  if (RAM[0xEB]) return;
  place_stage_objects();
  switch_bank(2);
  stage_dangers();
  switch_bank(BANK_HOME);
}

wait game_task(void) {
  enum {
    NEW_GAME, READY_SCREEN, READY_PICTURE_OFF, READY_TILES, READY_SHOWN, AFTER_READY, STAGE_PICTURE_OFF, STAGE_COLOURS, STAGE_ATTRIBUTES,
    SCENE_START, SCENE_TILES, SCENE_TILES_LOADED, SCENE_OBJECT_TILES, SCENE_MORE_TILES, SCENE_PALETTE, SCENE_PALETTES, SCENE_SCREEN, SCENE,
    STAGE_OFF, STAGE_SET_UP, STAGE_TILES, STAGE_OBJECT_TILES, STAGE_SCREEN, STAGE_WAITS, STAGE_WAITS_AGAIN, STAGE_STARTS, STAGE_ROUND,
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
      // sub_D01D
      FRAMES_A_ROUND = 2;
      inner = loading = 0;
      *step = READY_SCREEN;
      return picture_off();
    case READY_SCREEN:
      // sub_C971
      how = fresh_screen(&inner);
      if (how != DONE) return how;
      *step = READY_PICTURE_OFF;
      break;
    case READY_PICTURE_OFF:
      *step = READY_TILES;
      return picture_off();
    case READY_TILES:
      // sub_CB66: the screen's letters, 1 KB of tiles from bank 0's $9000
      switch_bank(0);
      how = load_tiles(&loading, 0x9000, 0x1000, 8);
      if (how != DONE) return how;
      switch_bank(BANK_HOME);
      draw_ready_screen();
      *step = READY_SHOWN;
      return sleep_task(90);
    case READY_SHOWN:
      RAM[OBJECT_FLAGS + 1] = 0;
      *step = AFTER_READY;
      break;
    case AFTER_READY:
      how = fresh_screen(&inner);
      if (how != DONE) return how;
      *step = STAGE_PICTURE_OFF;
      break;
    case STAGE_PICTURE_OFF:
      *step = STAGE_COLOURS;
      return picture_off();
    case STAGE_COLOURS:
      queue_background_palette(0xCB16);
      *step = STAGE_ATTRIBUTES;
      return picture_off();
    case STAGE_ATTRIBUTES:
      // $D03B: the attributes of the rows above the stage, from $CBEE, and the rest for the view's task to fill
      RAM[0xBF] = RAM[0xC9] = 0;
      for (int i = 0; i < 0x10; i++) RAM[ATTRIBUTES + 0x18 + i] = cart(7, (uint16_t)(0xCBEE + i));
      for (int i = 0; i < 0x80; i++) RAM[ATTRIBUTES + 0x40 + i] = 0xFF;
      *step = SCENE_START;
      return picture_off();
    case SCENE_START:
      // $D0D8. What a stage the player has reached before starts with, at $CD9B and $CE84, isn't ported yet: a new
      // game goes to the opening scene, in the first stage.
      start_task(TASK_OBJECTS);
      STAGE = 0;
      STAGE_SET = 0;
      *step = SCENE_TILES;
      return picture_off();
    case SCENE_TILES:
      how = load_stage_tiles(&inner);
      if (how != DONE) return how;
      *step = SCENE_TILES_LOADED;
      return YIELDS;
    case SCENE_TILES_LOADED:
      // $CE94: and the scene's own, from the seventh entry of the tables at $CCA9 and $CCB0
      if (!loading) switch_bank(cart(7, 0xCCA9 + 6));
      how = load_tiles(&loading, (uint16_t)(cart(7, 0xCCB0 + 6) << 8), 0x0700, 0x12);
      if (how != DONE) return how;
      *step = SCENE_OBJECT_TILES;
      break;
    case SCENE_OBJECT_TILES:
      // the tiles' task sends its second list's fourth set while the stage is drawn
      for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
      RAM[0xDA] = 3;
      *step = SCENE_MORE_TILES;
      return YIELDS;
    case SCENE_MORE_TILES:
      BANK_HOME = 1;
      switch_bank(1);
      queue_stage_colours();
      *step = SCENE_PALETTE;
      return YIELDS;
    case SCENE_PALETTE:
      queue_rows(0xCB36, 0x3F10, 1, 0x10);     // the scene's objects' colours
      *step = SCENE_SCREEN;
      break;
    case SCENE_SCREEN:
      how = draw_first_screen(&inner);
      if (how != DONE) return how;
      picture_on();
      start_scene();
      *step = SCENE;
      return YIELDS;
    case SCENE:
      // $CF6C: a turn each round until the scene is over, and then the picture goes off
      if (SCENE_PLAYING) return YIELDS;
      *step = STAGE_OFF;
      return picture_off();

    case STAGE_OFF:
      *step = STAGE_SET_UP;
      return picture_off();
    case STAGE_SET_UP:
      // $D0E6: the stage this player is at, with none of its objects placed, and its set of tiles
      STAGE = 0;
      STAGE_OBJECTS_PLACED = 0;
      if (!DEMONSTRATION) STAGE = RAM[0xAC + PLAYER];
      STAGE_SET = cart(7, (uint16_t)(0xCC86 + STAGE));
      *step = STAGE_TILES;
      break;
    case STAGE_TILES:
      how = load_stage_tiles(&inner);
      if (how != DONE) return how;
      *step = STAGE_OBJECT_TILES;
      break;
    case STAGE_OBJECT_TILES:
      // $D101: the stage's objects' tiles, from the tables at $CCA9 and $CCB0, and their colours, from $CB26. The last
      // stage's own colours, at $D132, aren't ported yet.
      if (!loading) switch_bank(cart(7, (uint16_t)(0xCCA9 + STAGE_SET)));
      how = load_tiles(&loading, (uint16_t)(cart(7, (uint16_t)(0xCCB0 + STAGE_SET)) << 8), 0x0700, 0x12);
      if (how != DONE) return how;
      queue_rows(0xCB26, 0x3F10, 1, 0x10);
      for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
      RAM[0xDA] = cart(7, (uint16_t)(0xCCB7 + STAGE));
      RAM[0xDF] = 0xFF;
      *step = STAGE_SCREEN;
      return YIELDS;
    case STAGE_SCREEN:
      how = draw_first_screen(&inner);
      if (how != DONE) return how;
      *step = STAGE_WAITS;
      return YIELDS;
    case STAGE_WAITS:
      *step = STAGE_STARTS;
      return YIELDS;
    case STAGE_STARTS:
      start_stage();
      *step = STAGE_ROUND;
      break;
    case STAGE_ROUND:
      stage_round();
      return YIELDS;
  }
}
