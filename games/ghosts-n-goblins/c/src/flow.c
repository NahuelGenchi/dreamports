// Ghosts'n Goblins Dreamport: the game's own task, from the original's code at $C8C4, which takes a game from Start on
// the title screen to its first stage: the "PLAYER 1 READY" screen, the stage's tiles and colours from the player's
// copy, the stage's first screen, drawn a column a round with the picture off, and the scene the game opens with.
//
// So far it goes as far as that scene: what comes after it, at $CF70, isn't ported yet, and neither are the
// demonstration, a second player's turn, or the stage the title screen's secret chooses.

#include "game.h"

#define DEMONSTRATION RAM[0x94]
#define PLAYER RAM[0xBA]          // whose turn it is, 0 or 1
#define LIVES 0x0715              // each player's
#define STAGE RAM[0xC2]           // the place in the game, which the stage's tables are read by,
#define STAGE_SET RAM[0xCF]       // and which of the stages' sets of tiles it uses
#define VIEW_HELD RAM[0xBC]       // on while the view is moved to draw the stage's first screen, so the stage's edges don't stop it
#define VIEW_X_SCREEN RAM[0x65]   // which screen across the stage the view is at
#define SCENE_PLAYING RAM[0xE0]   // on while the opening scene plays
enum { ARTHUR = 0, PRINCESS = 1, SATAN = 2, ARMOUR = 3 };  // the scene's objects, and the "READY" screen's head is the second

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

wait game_task(void) {
  enum {
    NEW_GAME, READY_SCREEN, READY_PICTURE_OFF, READY_TILES, READY_SHOWN, AFTER_READY, STAGE_PICTURE_OFF, STAGE_COLOURS, STAGE_ATTRIBUTES,
    STAGE_START, STAGE_TILES, STAGE_OWN_TILES, STAGE_TILES_LOADED, OBJECT_TILES, MORE_TILES, STAGE_PALETTE, VIEW_MOVES, VIEW_MOVED, SCENE,
  };
  static uint8_t inner;
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
      inner = 0;
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
      how = load_tiles(&inner, 0x9000, 0x1000, 8);
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
      *step = STAGE_START;
      return picture_off();
    case STAGE_START:
      // $D0D8. What a stage the player has reached before starts with, at $CD9B and $CE84, isn't ported yet.
      start_task(TASK_OBJECTS);
      *step = STAGE_TILES;
      return picture_off();
    case STAGE_TILES:
      // sub_CF73: the tiles every stage uses, from bank 0, and then this stage's own, from the bank and place the tables
      // at $CC9B and $CCA2 give
      if (inner == 0) {
        STAGE = 0;
        STAGE_SET = 0;
        switch_bank(0);
      }
      how = load_tiles(&inner, 0x8000, 0x0000, 0x0E);
      if (how != DONE) return how;
      *step = STAGE_OWN_TILES;
      break;
    case STAGE_OWN_TILES:
      if (inner == 0) switch_bank(cart(7, (uint16_t)(0xCC9B + STAGE_SET)));
      how = load_tiles(&inner, (uint16_t)(cart(7, (uint16_t)(0xCCA2 + STAGE_SET)) << 8), 0x1000, 0x20);
      if (how != DONE) return how;
      *step = STAGE_TILES_LOADED;
      return YIELDS;
    case STAGE_TILES_LOADED:
      // $CE94: and the tiles from the seventh entry of the tables at $CCA9 and $CCB0
      if (inner == 0) switch_bank(cart(7, 0xCCA9 + 6));
      how = load_tiles(&inner, (uint16_t)(cart(7, 0xCCB0 + 6) << 8), 0x0700, 0x12);
      if (how != DONE) return how;
      *step = OBJECT_TILES;
      break;
    case OBJECT_TILES:
      // the tiles' task sends its second list's fourth set while the stage is drawn
      for (int i = 0; i < 10; i++) RAM[0xD5 + i] = 0xFF;
      RAM[0xDA] = 3;
      *step = MORE_TILES;
      return YIELDS;
    case MORE_TILES:
      // sub_D871: the stage's colours, from where bank 1's list at $801C points
      BANK_HOME = 1;
      switch_bank(1);
      queue_background_palette(peek16((uint16_t)(0x801C + STAGE * 2)));
      *step = STAGE_PALETTE;
      return YIELDS;
    case STAGE_PALETTE:
      queue_rows(0xCB36, 0x3F10, 1, 0x10);     // the objects' colours
      // sub_CFB0: the stage's own bank, its map, and the view's task, with the view where the table at $CCC5 starts it
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
      *step = VIEW_MOVES;
      break;
    case VIEW_MOVES:
      // $D004: the view moves 8 pixels a round, so the view's task draws a column each time, until it's at the screen
      // the table at $CCFD gives
      RAM[0x5D] = 8;
      RAM[0x83] = 0;
      *step = VIEW_MOVED;
      return YIELDS;
    case VIEW_MOVED:
      if (cart(7, (uint16_t)(0xCCFD + STAGE)) != VIEW_X_SCREEN) { *step = VIEW_MOVES; break; }
      VIEW_HELD = 0;
      picture_on();
      start_scene();
      *step = SCENE;
      break;
    case SCENE:
      // $CF69: a turn each round until the scene is over. What follows it isn't ported yet, so the task stays here.
      return YIELDS;
  }
}
