// Ghosts'n Goblins Dreamport: Arthur's weapons once they're thrown, from the original's code. Each is an object, one of
// the three from $11, that his task makes when B is pressed (arthur.c) and that has its own turn each round. So far the
// lance and the dagger, which fly straight the way he faced until they leave the view or hit an enemy (enemies.c).
//
// The torch, the axe and the cross, at $EBC4 on, a weapon that's hit something, at $EBC1, and the gravestones that stop
// one, at $EBB0, aren't ported yet.

#include "game.h"


void weapon(uint8_t object) {
  uint8_t dagger = RAM[OBJECT_KIND + object] == DAGGER;
  RAM[OBJECT_COLOURS + object] = 0;
  took(WEAPON_TURN_BEGINS);
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  took(dagger ? DAGGER_SPEED : LANCE_SPEED);
  took(CALLS);
  move_object(object, dagger ? 0x38 : 0x2C);
  if (!object_in_view(object)) {
    RAM[OBJECT_STATE + object] = 0;
    RAM[OBJECT_FLAGS + object] = 0;
    took(WEAPON_GONE);
    return;
  }
  took(WEAPON_IN_VIEW);
  show_object(object);
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  took(WEAPON_NOT_SPENT);
  // sub_E9CA: the block four pixels above its place. A place whose four pixels above are on the screen above, at
  // $E9E5, isn't ported yet.
  RAM[0x22] = 4;
  RAM[0x77] = RAM[OBJECT_Y_SCREEN + object];
  RAM[0x73] = (uint8_t)(RAM[OBJECT_Y + object] - 4);
  RAM[0x78] = RAM[OBJECT_X_SCREEN + object];
  RAM[0x74] = RAM[OBJECT_X + object];
  took(WEAPON_BLOCK_ABOVE);
  block_at_stage_place();   // the blocks $D0 and $DF, a gravestone's, stop it
  took(WEAPON_FLIES_ON);
}
