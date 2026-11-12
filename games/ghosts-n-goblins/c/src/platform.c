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
