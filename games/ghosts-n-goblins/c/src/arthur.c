// Ghosts'n Goblins Dreamport: Arthur's task, from the original's code at $DA71. Arthur is the first object, and his task
// moves him, a turn a round: in the opening scene, where he sits by the princess, jumps up after Satan, and walks to his
// armour, and in a stage, where he falls to the ground and stands. The view follows him as he moves.
//
// So far the buttons do nothing in a stage: walking, at $DB32 and $DB6E, jumping, at $DB16, throwing, at $E041,
// climbing and everything that can happen to him aren't ported yet.

#include "game.h"

enum { ARTHUR = 0, SATAN = 2 };
// Arthur's flags
enum { TURNED = 0x04, IN_THE_AIR = 0x08, HELD = 0x10, WITHOUT_ARMOUR = 0x20 };  // TURNED: he faces the other way, and his shapes are 4 on
// the view's place in the stage (scroll.c), and the speed its task is asked to move it at, each 24 bits
enum { VIEW_X = 0x63, VIEW_Y = 0x66, VIEW_SPEED_X = 0x5C, VIEW_SPEED_Y = 0x5F };
#define STAGE_SET RAM[0xCF]
// his fields
#define FLAGS RAM[OBJECT_FLAGS + ARTHUR]
#define X RAM[OBJECT_X + ARTHUR]
#define X_SCREEN RAM[OBJECT_X_SCREEN + ARTHUR]
#define Y RAM[OBJECT_Y + ARTHUR]
#define Y_SCREEN RAM[OBJECT_Y_SCREEN + ARTHUR]
#define SCREEN_X RAM[OBJECT_SCREEN_X + ARTHUR]
#define SCREEN_Y RAM[OBJECT_SCREEN_Y + ARTHUR]
#define COUNT RAM[OBJECT_COUNT + ARTHUR]
#define STATE RAM[OBJECT_STATE + ARTHUR]
#define HEADING RAM[OBJECT_HEADING + ARTHUR]
#define SHAPE RAM[OBJECT_SHAPE + ARTHUR]
#define COLOURS RAM[OBJECT_COLOURS + ARTHUR]

// sub_DBFB: the view is asked to move across so that Arthur is in the middle of the picture, by at most 7 pixels to
// the right or 8 to the left.
static void view_follows_across(void) {
  uint32_t middle = (uint32_t)(RAM[VIEW_X + 2] << 16 | RAM[VIEW_X + 1] << 8 | RAM[VIEW_X]) + 0x8000;
  uint32_t ahead = (uint32_t)(X_SCREEN << 16 | X << 8 | RAM[OBJECT_X_PART + ARTHUR]) - middle;
  RAM[0x7C] = RAM[VIEW_X];
  RAM[0x74] = (uint8_t)(middle >> 8);
  RAM[0x78] = (uint8_t)(middle >> 16);
  RAM[VIEW_SPEED_X] = (uint8_t)ahead;
  RAM[VIEW_SPEED_X + 1] = (uint8_t)(ahead >> 8);
  RAM[VIEW_SPEED_X + 2] = (uint8_t)(ahead >> 16);
  uint8_t pixels = RAM[VIEW_SPEED_X + 1];
  if (pixels & 0x80) { if (pixels < 0xF8) RAM[VIEW_SPEED_X + 1] = 0xF8; }
  else if (pixels >= 7) RAM[VIEW_SPEED_X + 1] = 7;
}

// sub_DB99: and down, so that he's 144 pixels below its top, by at most 7 pixels down or 8 up. A screen is 240 pixels
// high, so 16 are taken off or put back where the two are on different screens.
static void view_follows_down(void) {
  RAM[0x7B] = RAM[VIEW_Y];
  uint16_t line = (uint16_t)(RAM[VIEW_Y + 1] + 0x90);
  RAM[0x77] = RAM[VIEW_Y + 2];
  if (line >= 0xF0) {   // $DBB0: past the screen's 240 lines, on the next screen down
    line = (uint8_t)line + 0x10;
    RAM[0x77]++;
  }
  RAM[0x73] = (uint8_t)line;
  uint32_t below = (uint32_t)(Y_SCREEN << 16 | Y << 8 | RAM[OBJECT_Y_PART + ARTHUR]) - (uint32_t)(RAM[0x77] << 16 | RAM[0x73] << 8 | RAM[0x7B]);
  RAM[VIEW_SPEED_Y] = (uint8_t)below;
  RAM[VIEW_SPEED_Y + 1] = (uint8_t)(below >> 8);
  RAM[VIEW_SPEED_Y + 2] = (uint8_t)(below >> 16);
  uint8_t pixels = RAM[VIEW_SPEED_Y + 1];
  if (Y_SCREEN != RAM[0x77]) pixels = (uint8_t)(pixels & 0x80 ? pixels + 0x10 : pixels - 0x10);
  if (pixels & 0x80) { if (pixels < 0xF8) pixels = 0xF8; }
  else if (pixels >= 7) pixels = 7;
  RAM[VIEW_SPEED_Y + 1] = pixels;
}

// sub_EA2F and sub_E3E3: whether the block 11 pixels below Arthur's place is solid, so he's on the ground. The two
// blocks $76 and $77, which a stage's set of tiles can make solid, at $E3F3, aren't ported yet.
static int on_the_ground(void) {
  RAM[0x77] = Y_SCREEN;
  RAM[0x73] = (uint8_t)(Y + 0x0B);
  RAM[0x78] = X_SCREEN;
  RAM[0x74] = X;
  RAM[0x22] = block_at_stage_place();
  return RAM[0x22] >= BLOCK_SOLID;
}

// sub_E166: his place down, on top of the block he's landed on.
static void stand_on_block(void) { Y = (uint8_t)((Y & 0xF0) | 0x08); }

// sub_DF62: whether something is in his way: a solid block 8 pixels ahead of him, 4 below his place, or the edge of the
// picture. $D1 keeps the answer.
static int way_blocked(void) {
  int left = HEADING == 0x0C;
  uint16_t ahead = (uint16_t)((X_SCREEN << 8 | X) + (left ? -8 : 8));
  RAM[0x74] = (uint8_t)ahead;
  RAM[0x78] = (uint8_t)(ahead >> 8);
  RAM[0x77] = Y_SCREEN;
  RAM[0x73] = (uint8_t)(Y + 4);
  int blocked = block_at_stage_place() >= BLOCK_SOLID || (left ? SCREEN_X < 0x10 : SCREEN_X >= 0xF0);
  RAM[0xD1] = blocked ? 0x80 : 0;
  return blocked;
}

// sub_DB82: 12 256ths of the way he's heading, with the view after him.
static void drift(void) {
  move_object(ARTHUR, 0x0C);
  view_follows_across();
}

// sub_DB90 and $E4E5: his place on the screen, for this round's sprites.
static void placed(void) {
  place_on_screen(ARTHUR);
  FLAGS &= (uint8_t)~HELD;
  STATE &= 0xF7;
}

// sub_E35E and sub_E3B9: his shape. The copy's list at $E3DC gives the six steps of his walk, and his shapes without
// armour are 32 on from those with it, and the ones facing left 4 on. His other states, at $E317, $E36B and $E382, and
// his flashing after he's hit, at $E3BE, aren't ported yet.
static void choose_shape(void) {
  if (COUNT >= 6) COUNT = 0;
  SHAPE = (uint8_t)(((FLAGS & TURNED) | (FLAGS & WITHOUT_ARMOUR)) + cart(7, (uint16_t)(0xE3DC + COUNT)));
}

// sub_E1EE: a jump, six rounds up and then down until he's on the ground or off the bottom of the picture, by the heights
// the copy's list at $DEFD gives, and then 7 pixels a round, drifting the way he's heading unless something's in the way.
// Called each turn until it's DONE.
static wait jump(uint8_t *step) {
  enum { BEGIN, RISE, RISEN, FALL, FELL, LONG_FALL };
  for (;;) switch (*step) {
    case BEGIN:
      FLAGS |= IN_THE_AIR;
      RAM[0x0647 + ARTHUR] = 0;
      COUNT = 6;
      HEADING = FLAGS & TURNED ? 0x04 : 0x0C;
      COLOURS = 0x02;
      SHAPE = (uint8_t)(0x16 + (FLAGS & TURNED ? 1 : 0));   // his shape without armour, at $E21F, isn't ported yet
      *step = RISE;
      break;
    case RISE:
      if (!way_blocked()) drift();
      Y -= cart(7, (uint16_t)(0xDEFD + COUNT));   // sub_DF04. Past the top of his screen, at $DF15, isn't ported yet.
      placed();
      *step = RISEN;
      return YIELDS;
    case RISEN:
      *step = --COUNT ? RISE : FALL;
      break;
    case FALL:
      if (on_the_ground()) {
        stand_on_block();
        *step = BEGIN;
        return DONE;
      }
      if (SCREEN_Y >= 0xE0) { *step = BEGIN; return DONE; }
      if (!way_blocked()) drift();
      Y += cart(7, (uint16_t)(0xDEFD + COUNT));   // sub_DF33
      if (SCREEN_Y >= 0x90) view_follows_down();
      placed();
      *step = FELL;
      return YIELDS;
    case FELL:
      *step = ++COUNT < 7 ? FALL : LONG_FALL;
      break;
    case LONG_FALL:
      // $E265
      if (on_the_ground()) {
        stand_on_block();
        *step = BEGIN;
        return DONE;
      }
      if (SCREEN_Y >= 0xE0) { *step = BEGIN; return DONE; }
      if (!way_blocked()) {
        move_object(ARTHUR, 0x06);
        view_follows_across();
      }
      Y += 7;
      if (SCREEN_Y >= 0x90) view_follows_down();
      placed();
      return YIELDS;
  }
}

// $DAA0: where a stage starts him: in the air above the middle of the view's first screen, facing right.
static void start_in_stage(void) {
  Y = 0x98;
  Y_SCREEN = RAM[VIEW_Y + 2];
  FLAGS = OBJECT_FLAG_SHOWN;
  HEADING = 0x04;
  X = 0x60;
  X_SCREEN = RAM[VIEW_X + 2];
}

// sub_DB8A, with sub_E01E: the end of a turn in a stage. The B button, which throws his weapon, at $E041, isn't ported yet.
static void end_stage_turn(void) {
  choose_shape();
  if (!(STATE & 0x12)) RAM[0x85] = 0;
  placed();
}

wait arthur_task(void) {
  enum {
    START, SCENE_SITS, SCENE_WATCHES, SCENE_JUMPS, SCENE_LANDED, SCENE_WALKS, SCENE_STEP, SCENE_OVER,
    STAGE_TURN, STAGE_STANDS, STAGE_FALLS, STAGE_FELL,
  };
  static uint8_t inner;
  uint8_t *step = &task_step[TASK_ARTHUR];
  for (;;) switch (*step) {
    case START:
      inner = 0;
      if (FLAGS != 0xFF) {
        start_in_stage();
        *step = STAGE_TURN;
        break;
      }
      // $DA7A: the opening scene, where he sits by the princess without his armour
      SHAPE = 0x1C;
      FLAGS = OBJECT_FLAG_SHOWN | 0x01;
      Y = 0xBA;
      Y_SCREEN = 0;
      X = 0x70;
      X_SCREEN = 0;
      COLOURS = 0x02;
      *step = SCENE_SITS;
      break;
    case SCENE_SITS:
      place_on_screen(ARTHUR);
      *step = SCENE_WATCHES;
      return YIELDS;
    case SCENE_WATCHES:
      // $E4F9: until Satan has her
      if (!(RAM[OBJECT_FLAGS + SATAN] & 0x01)) { *step = SCENE_SITS; break; }
      HEADING = 0x04;
      TILES_FIRST_LIST = 1;   // the tiles of Arthur without his armour
      *step = SCENE_JUMPS;
      break;
    case SCENE_JUMPS: {
      wait how = jump(&inner);
      if (how != DONE) return how;
      // $E50C: he stands a second where he landed
      FLAGS |= WITHOUT_ARMOUR;
      FLAGS &= 0xFE;
      COUNT = 0;
      STATE = 0;
      choose_shape();
      *step = SCENE_WALKS;
      return sleep_task(60);
    }
    case SCENE_WALKS:
      *step = SCENE_STEP;
      return YIELDS;
    case SCENE_STEP:
      // $E52B: to the right, a step a round, until he has his armour
      HEADING = 0x04;
      move_object(ARTHUR, 0x0C);
      place_on_screen(ARTHUR);
      choose_shape();
      COUNT++;
      if (FLAGS & WITHOUT_ARMOUR) { *step = SCENE_WALKS; break; }
      COUNT = 0;
      choose_shape();
      COLOURS = 0x08;
      *step = SCENE_OVER;
      return sleep_task(60);
    case SCENE_OVER:
      SCENE_PLAYING = 0;
      return ENDS;

    case STAGE_TURN:
      // $DAE4: each round in a stage. Without his armour he has other colours.
      COLOURS = FLAGS & WITHOUT_ARMOUR ? 0x02 : 0x08;
      FLAGS &= 0xFE;
      if (!(FLAGS & HELD) && !on_the_ground()) { *step = STAGE_FALLS; break; }
      // $DB06: on the ground, with no button that does anything yet
      RAM[0x84] = 0;
      if (!(PAD_NOW & PAD_B)) RAM[0x85] = 0;
      COUNT = 0;
      *step = STAGE_STANDS;
      break;
    case STAGE_STANDS:
      // $DB65: the view after him, and the end of the turn
      view_follows_across();
      view_follows_down();
      end_stage_turn();
      *step = STAGE_TURN;
      return YIELDS;
    case STAGE_FALLS:
      // $E28E: 6 pixels a round until he's on the ground. Off the bottom of the picture, at $E2AD, isn't ported yet.
      if (FLAGS & HELD) { *step = STAGE_STANDS; break; }
      if (on_the_ground()) {
        stand_on_block();
        *step = STAGE_STANDS;
        break;
      }
      Y += 6;
      if (SCREEN_Y >= 0x90) view_follows_down();
      if (SCREEN_Y >= 0x80) view_follows_down();
      COUNT = 0;
      end_stage_turn();
      *step = STAGE_FELL;
      return YIELDS;
    case STAGE_FELL:
      *step = STAGE_FALLS;
      break;
  }
}
