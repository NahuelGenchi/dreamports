// Ghosts'n Goblins Dreamport: Arthur's task, from the original's code at $DA71. Arthur is the first object, and his task
// moves him, a turn a round: in the opening scene, where he sits by the princess, jumps up after Satan, and walks to his
// armour, and in a stage, where he falls to the ground and stands, and where the first thing that hits him knocks him
// back out of his armour. The view follows him as he moves.
//
// So far the buttons do nothing in a stage: walking, at $DB32 and $DB6E, jumping, at $DB16, throwing, at $E041,
// climbing, and a hit without armour, which kills him, aren't ported yet.

#include "game.h"

enum { ARTHUR = 0, SATAN = 2 };
// Arthur's flags
enum { HIT = 0x01, CROUCHES = 0x02, TURNED = 0x04, IN_THE_AIR = 0x08, HELD = 0x10, WITHOUT_ARMOUR = 0x20, CANNOT_BE_TOUCHED = 0x40 };  // TURNED: he faces the other way, and his shapes are 4 on
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
  took(FOLLOW_ACROSS);
  if (pixels & 0x80) {
    took(pixels < 0xF8 ? FOLLOW_LEFT_FAR : FOLLOW_LEFT_NEAR);
    if (pixels < 0xF8) RAM[VIEW_SPEED_X + 1] = 0xF8;
  } else {
    took(pixels >= 7 ? FOLLOW_RIGHT_FAR : FOLLOW_RIGHT_NEAR);
    if (pixels >= 7) RAM[VIEW_SPEED_X + 1] = 7;
  }
}

// sub_DB99: and down, so that he's 144 pixels below its top, by at most 7 pixels down or 8 up. A screen is 240 pixels
// high, so 16 are taken off or put back where the two are on different screens.
static void view_follows_down(void) {
  RAM[0x7B] = RAM[VIEW_Y];
  uint16_t line = (uint16_t)(RAM[VIEW_Y + 1] + 0x90);
  RAM[0x77] = RAM[VIEW_Y + 2];
  took(FOLLOW_DOWN);
  if (line >= 0xF0) {   // $DBB0: past the screen's 240 lines, on the next screen down
    line = (uint8_t)line + 0x10;
    RAM[0x77]++;
    took(FOLLOW_DOWN_NEXT_SCREEN);
  }
  RAM[0x73] = (uint8_t)line;
  uint32_t below = (uint32_t)(Y_SCREEN << 16 | Y << 8 | RAM[OBJECT_Y_PART + ARTHUR]) - (uint32_t)(RAM[0x77] << 16 | RAM[0x73] << 8 | RAM[0x7B]);
  RAM[VIEW_SPEED_Y] = (uint8_t)below;
  RAM[VIEW_SPEED_Y + 1] = (uint8_t)(below >> 8);
  RAM[VIEW_SPEED_Y + 2] = (uint8_t)(below >> 16);
  uint8_t pixels = RAM[VIEW_SPEED_Y + 1];
  took(FOLLOW_DOWN_APART);
  if (Y_SCREEN != RAM[0x77]) {
    took(pixels & 0x80 ? FOLLOW_DOWN_SCREEN_ABOVE : FOLLOW_DOWN_SCREEN_BELOW);
    pixels = (uint8_t)(pixels & 0x80 ? pixels + 0x10 : pixels - 0x10);
  }
  if (pixels & 0x80) {
    took(pixels < 0xF8 ? FOLLOW_UP_FAR : FOLLOW_UP_NEAR);
    if (pixels < 0xF8) pixels = 0xF8;
  } else {
    took(pixels >= 7 ? FOLLOW_DOWN_FAR : FOLLOW_DOWN_NEAR);
    if (pixels >= 7) pixels = 7;
  }
  RAM[VIEW_SPEED_Y + 1] = pixels;
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
  took(left ? WAY_AHEAD_LEFT : WAY_AHEAD_RIGHT);
  int solid = block_at_stage_place() >= BLOCK_SOLID, edge = left ? SCREEN_X < 0x10 : SCREEN_X >= 0xF0;
  took(solid ? WAY_SOLID : left ? (edge ? WAY_LEFT_EDGE : WAY_LEFT_FREE) : edge ? WAY_RIGHT_EDGE : WAY_RIGHT_FREE);
  RAM[0xD1] = solid || edge ? 0x80 : 0;
  return solid || edge;
}

// sub_DB82, or sub_E286 for half as far: some 256ths of the way he's heading, with the view after him, unless
// something's in his way.
static void drift(uint8_t speed) {
  if (way_blocked()) { took(JUMP_BLOCKED); return; }
  took(JUMP_DRIFTS);
  move_object(ARTHUR, speed);
  took(JUMPS);
  view_follows_across();
}

// sub_DF3E: down by some pixels, with the view after him once he's low in the picture. Onto the next screen down, at
// $DF49, isn't ported yet.
static void fall_by(uint8_t pixels) {
  Y += pixels;
  took(SCREEN_Y >= 0x90 ? ARTHUR_FELL_LOW : ARTHUR_FELL_HIGH);
  if (SCREEN_Y >= 0x90) view_follows_down();
}

// sub_DB90 and $E4E5: his place on the screen, for this round's sprites.
static void placed(void) {
  took(CALLS);
  place_on_screen(ARTHUR);
  FLAGS &= (uint8_t)~HELD;
  STATE &= 0xF7;
  took(ARTHUR_TURN_YIELDS);
}

// sub_E35E and sub_E3B9: his shape. The copy's list at $E3DC gives the six steps of his walk, and his shapes without
// armour are 32 on from those with it, and the ones facing left 4 on. His other states, at $E317, $E36B and $E382, and
// his flashing after he's hit, at $E3BE, aren't ported yet.
static void choose_shape(void) {
  took(ARTHUR_SHAPE);
  if (COUNT >= 6) took(ARTHUR_SHAPE_STARTS_AGAIN);
  if (COUNT >= 6) COUNT = 0;
  SHAPE = (uint8_t)(((FLAGS & TURNED) | (FLAGS & WITHOUT_ARMOUR)) + cart(7, (uint16_t)(0xE3DC + COUNT)));
  // sub_E3B9: while nothing can touch him, after a hit, he's shown every other round, for 30 rounds
  if (!(FLAGS & CANNOT_BE_TOUCHED)) { took(ARTHUR_FLASH_LOOKED_AT); return; }
  took(ARTHUR_FLASH_COUNTED);
  if (++RAM[0x0647 + ARTHUR] >= 30) {
    FLAGS &= (uint8_t)~CANNOT_BE_TOUCHED;
    took(ARTHUR_FLASH_OVER);
    return;
  }
  FLAGS &= (uint8_t)~OBJECT_FLAG_SHOWN;
  if (RAM[0x0647 + ARTHUR] & 1) FLAGS |= OBJECT_FLAG_SHOWN;
  took(ARTHUR_FLASHES);
}

// How far he rises or falls this round of a jump, from the copy's list at $DEFD, whose last entries are in the next page.
static uint8_t jump_height(void) {
  if ((0xDEFD & 0xFF) + COUNT > 0xFF) took(READ_PAST_PAGE);
  return cart(7, (uint16_t)(0xDEFD + COUNT));
}

// sub_E1EE: a jump, six rounds up and then down until he's on the ground or off the bottom of the picture, by the heights
// the copy's list at $DEFD gives, and then 7 pixels a round, drifting the way he's heading unless something's in the way.
// Called each turn until it's DONE.
static wait jump(uint8_t *step) {
  enum { BEGIN, RISE, RISEN, FALL, FELL, LONG_FALL, LONG_FALL_AGAIN };
  for (;;) switch (*step) {
    case BEGIN:
      FLAGS |= IN_THE_AIR;
      RAM[0x0647 + ARTHUR] = 0;
      COUNT = 6;
      HEADING = FLAGS & TURNED ? 0x04 : 0x0C;
      COLOURS = 0x02;
      SHAPE = (uint8_t)(0x16 + (FLAGS & TURNED ? 1 : 0));   // his shape without armour, at $E21F, isn't ported yet
      took(JUMP_BEGINS);
      took(FLAGS & TURNED ? JUMP_FACES_LEFT : JUMP_FACES_RIGHT);
      took(JUMP_HAS_ARMOUR);
      *step = RISE;
      break;
    case RISE:
      drift(0x0C);
      Y -= jump_height();   // sub_DF04. Past the top of his screen, at $DF15, isn't ported yet.
      took(ARTHUR_RISES);
      placed();
      *step = RISEN;
      return YIELDS;
    case RISEN:
      took(ARTHUR_RISE_COUNTED);
      took(--COUNT ? GOES_ROUND : GOES_ON);
      *step = COUNT ? RISE : FALL;
      break;
    case FALL:
      if (on_the_ground(ARTHUR)) {
        stand_on_block();
        took(JUMP_LANDS);
        *step = BEGIN;
        return DONE;
      }
      took(JUMP_STILL_IN_AIR);
      took(SCREEN_Y >= 0xE0 ? JUMP_OFF_THE_BOTTOM : JUMP_ABOVE_THE_BOTTOM);
      if (SCREEN_Y >= 0xE0) { *step = BEGIN; return DONE; }
      drift(0x0C);
      took(ARTHUR_FALL_BY_LIST);
      fall_by(jump_height());   // sub_DF33
      placed();
      *step = FELL;
      return YIELDS;
    case FELL:
      took(JUMP_FALL_COUNTED);
      took(++COUNT < 7 ? GOES_ROUND : GOES_ON);
      *step = COUNT < 7 ? FALL : LONG_FALL;
      break;
    case LONG_FALL_AGAIN:
      took(JUMPS);
      *step = LONG_FALL;
      break;
    case LONG_FALL:
      // $E265
      if (on_the_ground(ARTHUR)) {
        stand_on_block();
        took(JUMP_LANDS_LATE);
        *step = BEGIN;
        return DONE;
      }
      took(JUMP_STILL_IN_AIR);
      took(SCREEN_Y >= 0xE0 ? JUMP_OFF_THE_BOTTOM : JUMP_ABOVE_THE_BOTTOM);
      if (SCREEN_Y >= 0xE0) { *step = BEGIN; return DONE; }
      drift(0x06);
      took(ARTHUR_FALL_BY_SEVEN);
      fall_by(7);
      placed();
      *step = LONG_FALL_AGAIN;
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
  took(ARTHUR_TURN_ENDS);
  choose_shape();
  took(STATE & 0x12 ? ARTHUR_BUTTONS_BUSY : ARTHUR_BUTTONS);
  if (!(STATE & 0x12)) RAM[0x85] = 0;
  place_on_screen(ARTHUR);
  FLAGS &= (uint8_t)~HELD;
  STATE &= 0xF7;
  took(ARTHUR_TURN_YIELDS);
}

wait arthur_task(void) {
  enum {
    START, SCENE_SITS, SCENE_WATCHES, SCENE_JUMPS, SCENE_LANDED, SCENE_WALKS, SCENE_STEP, SCENE_OVER,
    STAGE_TURN, STAGE_STANDS, STAGE_AGAIN, STAGE_FALLS, STAGE_FELL, STAGE_HIT, STAGE_KNOCKED_BACK,
  };
  static uint8_t inner;
  uint8_t *step = &task_step[TASK_ARTHUR];
  for (;;) switch (*step) {
    case START:
      inner = 0;
      if (FLAGS != 0xFF) {
        took(ARTHUR_STARTS_IN_STAGE);
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
      took(ARTHUR_SCENE_BEGINS);
      *step = SCENE_SITS;
      break;
    case SCENE_SITS:
      place_on_screen(ARTHUR);
      took(CALLS);
      *step = SCENE_WATCHES;
      return YIELDS;
    case SCENE_WATCHES:
      // $E4F9: until Satan has her
      if (!(RAM[OBJECT_FLAGS + SATAN] & 0x01)) {
        took(ARTHUR_WATCHES);
        *step = SCENE_SITS;
        break;
      }
      took(ARTHUR_SEES);
      HEADING = 0x04;
      TILES_FIRST_LIST = 1;   // the tiles of Arthur without his armour
      took(ARTHUR_JUMP_CALLED);
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
      took(ARTHUR_LANDED);
      choose_shape();
      took(ARTHUR_RESTS);
      *step = SCENE_WALKS;
      return sleep_task(60);
    }
    case SCENE_WALKS:
      took(CALLS);
      *step = SCENE_STEP;
      return YIELDS;
    case SCENE_STEP:
      // $E52B: to the right, a step a round, until he has his armour
      HEADING = 0x04;
      took(ARTHUR_STEP_BEGINS);
      move_object(ARTHUR, 0x0C);
      place_on_screen(ARTHUR);
      choose_shape();
      COUNT++;
      took(ARTHUR_STEP_COUNTED);
      took(OBJECT_FLAG_READ);
      if (FLAGS & WITHOUT_ARMOUR) {
        took(GOES_ROUND);
        *step = SCENE_WALKS;
        break;
      }
      COUNT = 0;
      took(ARTHUR_ARMOUR_ON);
      choose_shape();
      COLOURS = 0x08;
      took(ARTHUR_ARMOURED_RESTS);
      *step = SCENE_OVER;
      return sleep_task(60);
    case SCENE_OVER:
      SCENE_PLAYING = 0;
      took(ARTHUR_SCENE_OVER);
      return ENDS;

    case STAGE_TURN:
      // $DAE4: each round in a stage. Without his armour he has other colours.
      took(ARTHUR_TURN_BEGINS);
      if (FLAGS & WITHOUT_ARMOUR) took(ARTHUR_NO_ARMOUR_COLOURS);
      COLOURS = FLAGS & WITHOUT_ARMOUR ? 0x02 : 0x08;
      if (FLAGS & HIT) {
        took(ARTHUR_IS_HIT);
        *step = STAGE_HIT;
        break;
      }
      took(ARTHUR_TURN_CHECKS);
      if (FLAGS & HELD) took(ARTHUR_HELD);
      else if (!on_the_ground(ARTHUR)) {
        took(ARTHUR_IN_AIR);
        *step = STAGE_FALLS;
        break;
      } else took(ARTHUR_ON_GROUND);
      // $DB06: on the ground, with no button that does anything yet
      RAM[0x84] = 0;
      took(ARTHUR_STANDS);
      if (!(PAD_NOW & PAD_B)) {
        RAM[0x85] = 0;
        took(ARTHUR_B_NOT_HELD);
      }
      COUNT = 0;
      *step = STAGE_STANDS;
      break;
    case STAGE_STANDS:
      // $DB65: the view after him, and the end of the turn
      took(ARTHUR_VIEW_FOLLOWS);
      view_follows_across();
      view_follows_down();
      took(ARTHUR_AFTER_VIEW);
      end_stage_turn();
      *step = STAGE_AGAIN;
      return YIELDS;
    case STAGE_AGAIN:
      took(ARTHUR_AGAIN);
      *step = STAGE_TURN;
      break;
    case STAGE_FALLS:
      // $E28E: 6 pixels a round until he's on the ground. Off the bottom of the picture, at $E2AD, isn't ported yet.
      took(ARTHUR_FALL_CHECKS);
      if (FLAGS & HELD) { took(ARTHUR_HELD); *step = STAGE_STANDS; break; }
      if (on_the_ground(ARTHUR)) {
        stand_on_block();
        took(ARTHUR_LANDS);
        *step = STAGE_STANDS;
        break;
      }
      took(ARTHUR_FALLS_ON);
      Y += 6;
      if (SCREEN_Y >= 0x90) {
        took(ARTHUR_FELL_LOW);
        view_follows_down();
      } else took(ARTHUR_FELL_HIGH);
      if (SCREEN_Y >= 0x80) {
        took(ARTHUR_FELL_BELOW_HALF);
        view_follows_down();
      } else took(ARTHUR_FELL_ABOVE_HALF);
      COUNT = 0;
      took(ARTHUR_FALL_ENDS);
      end_stage_turn();
      *step = STAGE_FELL;
      return YIELDS;
    case STAGE_FELL:
      took(ARTHUR_FALL_RESUMES);
      *step = STAGE_FALLS;
      break;
    case STAGE_HIT:
      // $E171: something has hit him. With his armour on he loses it: nothing can touch him for a while, the tiles'
      // task sends the tiles of Arthur without it, and he's thrown back, as a jump the way he isn't facing. Without
      // it, at $E1AC, and with the stage's time over, at $E1C2, he dies, which isn't ported yet.
      STATE &= 0xEF;
      FLAGS |= CANNOT_BE_TOUCHED;
      FLAGS &= (uint8_t)~(CROUCHES | HIT);
      COLOURS = 0x02;
      took(ARTHUR_HIT_BEGINS);
      sound_play(0x1D);
      TILES_FIRST_LIST = 1;
      RAM[0xD6] = RAM[0xD7] = RAM[0xD8] = RAM[0xD9] = 0xFF;
      took(ARTHUR_ARMOUR_OFF);
      *step = STAGE_KNOCKED_BACK;
      break;
    case STAGE_KNOCKED_BACK: {
      wait how = jump(&inner);
      if (how != DONE) return how;
      FLAGS |= WITHOUT_ARMOUR;
      took(ARTHUR_KNOCKED_BACK);
      *step = STAGE_STANDS;
      break;
    }
  }
}
