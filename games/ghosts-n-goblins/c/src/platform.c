// Ghosts'n Goblins Dreamport: a moving platform, kind $0E, from the original's code at bank 4's $B84D. It goes from side
// to side between two ends, at a speed, that the copy's lists at $B95D, $B97D and $B99D give by its state, and turns at
// each. When Arthur comes down onto it he's held: his flag $10 is set, which his own turn reads as ground under him,
// he's put 12 pixels above it, and he's moved across as it moves. The first stage has one, over the water.
//
// The other kind that shares the routine, from $B85A, with another shape and width, isn't ported yet.

#include "game.h"

enum { ARTHUR = 0, HELD = 0x10, RISES = 0x04 };
enum { RIGHT_ENDS = 0xB95D, LEFT_ENDS = 0xB97D, SPEEDS = 0xB99D };

static uint8_t list(uint16_t address) { return cart(4, address); }

void platform(uint8_t object) {
  uint8_t state = RAM[OBJECT_STATE + object], *heading = &RAM[OBJECT_HEADING + object];
  uint16_t place = (uint16_t)(RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]);
  RAM[OBJECT_SHAPE + object] = 0x60;
  RAM[OBJECT_COLOURS + object] = 0x0C;
  took(PLATFORM_BEGINS);
  show_object(object);
  if (object_in_view(object)) took(PLATFORM_IN_VIEW);
  else {
    took(PLATFORM_OUT_OF_VIEW);
    hide_object(object);
  }
  int moves = 1, turns;
  if (*heading & 0x08) {
    uint16_t end = (uint16_t)(list((uint16_t)(LEFT_ENDS + state * 2)) << 8 | list((uint16_t)(LEFT_ENDS + state * 2 + 1)));
    took(PLATFORM_LEFT_END);
    turns = end >= place;
    took(turns ? PLATFORM_AT_LEFT_END : PLATFORM_GOES_LEFT);
  } else {
    uint16_t end = (uint16_t)(list((uint16_t)(RIGHT_ENDS + state * 2)) << 8 | list((uint16_t)(RIGHT_ENDS + state * 2 + 1)));
    took(PLATFORM_RIGHT_END);
    turns = end < place;
    took(turns ? PLATFORM_AT_RIGHT_END : PLATFORM_GOES_RIGHT);
  }
  if (turns) {
    *heading ^= 0x08;
    took(PLATFORM_TURNS);
    moves = !(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN);
    took(moves ? PLATFORM_TURNED_HIDDEN : PLATFORM_TURNED_SHOWN);
  }
  if (moves) {
    took(PLATFORM_MOVES);
    took(CALLS);
    move_object(object, list((uint16_t)(SPEEDS + state)));
    if (object_in_view(object)) took(PLATFORM_IN_VIEW);
    else {
      took(PLATFORM_OUT_OF_VIEW);
      hide_object(object);
    }
  }
  place_on_screen(object);
  // $B8BE: whether Arthur is coming down onto it
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) { took(PLATFORM_NOT_SHOWN); return; }
  if (RAM[OBJECT_STATE + ARTHUR] & RISES) { took(PLATFORM_ARTHUR_RISES); return; }
  if (RAM[OBJECT_FLAGS + ARTHUR] & HELD) { took(PLATFORM_ARTHUR_HELD); return; }
  uint8_t own = RAM[OBJECT_SCREEN_Y + object], his = RAM[OBJECT_SCREEN_Y + ARTHUR];
  took(PLATFORM_ARTHUR_LOOKED_AT);
  if (own < his) { took(PLATFORM_ARTHUR_BELOW); return; }
  if ((uint8_t)(own - his) >= 0x0D) { took(PLATFORM_ARTHUR_HIGH); return; }
  took(PLATFORM_ARTHUR_ON_TOP);
  int widest = RAM[OBJECT_KIND + object] == 0x0E;
  RAM[0x26] = widest ? 0x10 : 0x14;
  RAM[0x27] = widest ? 0xF0 : 0xEC;
  took(widest ? PLATFORM_WIDTH : PLATFORM_OTHER_WIDTH);
  uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + object] - RAM[OBJECT_SCREEN_X + ARTHUR]);
  if (across < RAM[0x26]) took(PLATFORM_ARTHUR_ON_RIGHT_HALF);
  else if (across < RAM[0x27]) { took(PLATFORM_ARTHUR_OFF); return; }
  else took(PLATFORM_ARTHUR_ON_LEFT_HALF);
  took(PLATFORM_HOLDS);
  RAM[OBJECT_FLAGS + ARTHUR] |= HELD;
  took(PLATFORM_LIFTS);
  RAM[OBJECT_Y + ARTHUR] = (uint8_t)(RAM[OBJECT_Y + object] - 0x0C);
  if (RAM[OBJECT_Y + ARTHUR] < 0xF0) {
    took(PLATFORM_SAME_SCREEN);
    RAM[OBJECT_Y_SCREEN + ARTHUR] = RAM[OBJECT_Y_SCREEN + object];
  } else {
    // a screen is 240 pixels high: 12 above its top is on the screen above
    took(PLATFORM_SCREEN_ABOVE);
    RAM[OBJECT_Y + ARTHUR] -= 0x10;
    RAM[OBJECT_Y_SCREEN + ARTHUR] = (uint8_t)(RAM[OBJECT_Y_SCREEN + object] - 1);
  }
  took(PLATFORM_CARRIES);
  find_move(object, list((uint16_t)(SPEEDS + state)));
  uint32_t his_place = (uint32_t)(RAM[OBJECT_X_SCREEN + ARTHUR] << 16 | RAM[OBJECT_X + ARTHUR] << 8 | RAM[OBJECT_X_PART + ARTHUR]);
  his_place += (uint32_t)(RAM[0x78] << 16 | RAM[0x74] << 8 | RAM[0x7C]);
  took(PLATFORM_CARRIED);
  RAM[OBJECT_X_PART + ARTHUR] = (uint8_t)his_place;
  RAM[OBJECT_X + ARTHUR] = (uint8_t)(his_place >> 8);
  RAM[OBJECT_X_SCREEN + ARTHUR] = (uint8_t)(his_place >> 16);
  place_on_screen(ARTHUR);
  took(PLATFORM_ENDS);
}

// ---- the second stage's two moving objects with shape $3E, from bank 4's $9DA2 and $9D5F. Out of the view neither is
// shown. What they do in the view was written from the original's instructions and hasn't been run by a recording,
// and where Arthur comes down onto the first, which jumps to $B795, isn't ported yet.

enum { SPEEDS_BY_STATE = 0xB800, FALLS = 0x02, DOWN = 0x08 };

// $9DF6: a move the way it's heading, when it isn't shown or has just turned, and whether it's shown after it.
static int thing_moves(uint8_t object, int moves) {
  if (moves) {
    took(THING_MOVES);
    move_object(object, list((uint16_t)(SPEEDS_BY_STATE + RAM[OBJECT_STATE + object])));
  }
  took(OBJECT_SHOWN_READ);
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) { took(THING_NOT_SHOWN); return 0; }
  took(THING_IS_SHOWN);
  return 1;
}

// Kind $36: it goes up and down. In the view it turns above the 32nd line of a screen below the first, and below the
// 224th of one. Out of the view it turns every round.
void rising_thing(uint8_t object) {
  uint8_t *heading = &RAM[OBJECT_HEADING + object];
  int turns;
  RAM[OBJECT_SHAPE + object] = 0x3E;
  RAM[OBJECT_COLOURS + object] = 0;
  RAM[OBJECT_STATE + object] = 0x0B;
  *heading &= DOWN;
  took(RISING_THING_BEGINS);
  if (object >= 0x0F) took(READ_PAST_PAGE);
  show_object(object);
  if (!object_in_view(object)) {
    took(RISING_THING_OUT_OF_VIEW);
    hide_object(object);
    took(JUMPS);
    turns = 1;
  } else if (*heading & DOWN) {
    if (!RAM[OBJECT_Y_SCREEN + object]) { took(RISING_THING_DOWN_FIRST_SCREEN); turns = 0; }
    else if (RAM[OBJECT_Y + object] >= 0xE0) { took(RISING_THING_AT_BOTTOM); turns = 1; }
    else { took(RISING_THING_GOES_DOWN); turns = 0; }
    if (object >= 0x0F) took(READ_PAST_PAGE);
  } else {
    if (!RAM[OBJECT_Y_SCREEN + object]) { took(RISING_THING_UP_FIRST_SCREEN); turns = 1; }
    else if (RAM[OBJECT_Y + object] >= 0x20) { took(RISING_THING_GOES_UP); turns = 0; }
    else { took(RISING_THING_AT_TOP); turns = 1; }
    if (object >= 0x0F) took(READ_PAST_PAGE);
  }
  int moves = 1;
  if (turns) {
    *heading ^= DOWN;
    took(THING_TURNS);
    if (object >= 0x0F) took(READ_PAST_PAGE);
    took(OBJECT_SHOWN_READ);
    moves = !(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN);
    took(moves ? THING_TURNED_HIDDEN : THING_TURNED_SHOWN);
  }
  if (!thing_moves(object, moves)) return;
  // $9E04: whether Arthur is coming down onto it
  if (RAM[OBJECT_STATE + ARTHUR] & RISES) { took(THING_ARTHUR_RISES); return; }
  if (RAM[OBJECT_FLAGS + ARTHUR] & HELD) { took(THING_ARTHUR_HELD); return; }
  uint8_t own = RAM[OBJECT_SCREEN_Y + object], his = RAM[OBJECT_SCREEN_Y + ARTHUR];
  if (own < his) { took(THING_ARTHUR_BELOW); return; }
  if ((uint8_t)(own - his) >= 0x14) { took(THING_ARTHUR_HIGH); return; }
  uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + object] - RAM[OBJECT_SCREEN_X + ARTHUR]);
  if (across >= 0x24 && across < 0xDC) { took(THING_ARTHUR_OFF); return; }
  // $B795, which holds him on it, isn't ported yet
}

// Kind $37: it stays where it is until Arthur is within 40 pixels across and 16 down. Then it falls, and it's gone once
// it's out of the view.
void falling_thing(uint8_t object) {
  RAM[OBJECT_SHAPE + object] = 0x3E;
  RAM[OBJECT_COLOURS + object] = 0;
  RAM[OBJECT_STATE + object] = 0x0C;
  took(FALLING_THING_BEGINS);
  show_object(object);
  if (!object_in_view(object)) {
    took(FALLING_THING_OUT_OF_VIEW);
    hide_object(object);
    took(OBJECT_FLAG_READ);
    if (!(RAM[OBJECT_FLAGS + object] & FALLS)) { took(FALLING_THING_WAITS_UNSEEN); return; }
    RAM[OBJECT_FLAGS + object] = 0;
    took(FALLING_THING_GONE);
    return;
  }
  took(FALLING_THING_IN_VIEW);
  took(OBJECT_FLAG_READ);
  if (RAM[OBJECT_FLAGS + object] & FALLS) {
    RAM[OBJECT_HEADING + object] = DOWN;
    took(FALLING_THING_FALLS);
    thing_moves(object, 1);
    return;
  }
  RAM[0x26] = 0x28;
  RAM[0x27] = 0x10;
  took(FALLING_THING_LOOKS);
  if (!arthur_near(object)) { took(FALLING_THING_WAITS); return; }
  took(FALLING_THING_SEES_HIM);
  RAM[OBJECT_FLAGS + object] |= FALLS;
  took(OBJECT_FLAG_CHANGED);
  took(RETURNS);
}
