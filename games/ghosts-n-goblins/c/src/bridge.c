// Ghosts'n Goblins Dreamport: the fourth stage's fire bridge. Kind $0F, from the original's code at sub_04_B9AD, is one
// of the bridge's flames. It's hidden until Arthur comes within its box, $30 across and $40 up and down, in the view:
// then it burns, its count picking one of four shapes from the list at $B9F5 every two rounds, and touches him in a box
// that's as tall as the flame.

#include "game.h"

enum { ARTHUR = 0, ARTHUR_HIT = 0x01 };
enum { COUNT = 0x0607, SHAPES = 0xB9F5, HEIGHTS = 0xBA05, FIRST_SHAPE = 0xFA, IN_USE = 0x40 };

static uint8_t list(uint16_t address) { return cart(4, address); }

// $B9C2: its count back to 0, and it's hidden
static void flame_goes_out(uint8_t object) {
  RAM[COUNT + object] = 0;
  took(FLAME_COUNT_CLEARED);
  RAM[OBJECT_FLAGS + object] = IN_USE;
  took(FLAME_OUT);
}

void bridge_flame(uint8_t object) {
  show_object(object);
  if (!object_in_view(object)) {
    took(FLAME_OUT_OF_VIEW);
    flame_goes_out(object);
    return;
  }
  took(FLAME_IN_VIEW);
  RAM[0x26] = 0x30;
  took(FLAME_BOX_ACROSS);
  RAM[0x27] = 0x40;
  took(FLAME_BOX_UP_AND_DOWN);
  if (!arthur_near(object)) {
    took(FLAME_ARTHUR_AWAY);
    flame_goes_out(object);
    return;
  }
  took(FLAME_ARTHUR_NEAR);
  show_object(object);
  RAM[COUNT + object]++;
  took(FLAME_COUNTED);
  uint8_t which = (RAM[COUNT + object] >> 1) & 0x0F;
  if (which >= 0x0B) took(READ_PAST_PAGE);   // $B9F5,Y crosses into $BA00
  uint8_t shape = list((uint16_t)(SHAPES + which));
  RAM[OBJECT_SHAPE + object] = shape;
  took(FLAME_SHAPED);
  RAM[0x27] = list((uint16_t)(HEIGHTS + shape - FIRST_SHAPE));
  took(FLAME_HEIGHT);
  RAM[OBJECT_COLOURS + object] = 0;
  took(FLAME_COLOURS);
  RAM[0x26] = 4;
  took(FLAME_TOUCH_BOX);
  // $F5E3: the end of the enemies' tests, Arthur's touch only
  if (!arthur_near(object)) { took(ENEMY_NOT_TOUCHED); return; }
  RAM[OBJECT_FLAGS + ARTHUR] |= ARTHUR_HIT;
  took(ENEMY_TOUCHES_ARTHUR);
}
