// Ghosts'n Goblins Dreamport: Arthur's weapons once they're thrown, from the original's code. Each is an object, one of
// the three from $11, that his task makes when B is pressed (arthur.c) and that has its own turn each round. So far the
// lance and the dagger, which fly straight the way he faced until they leave the view or hit an enemy (enemies.c).
//
// A gravestone's blocks stop one: it shows against the stone for three rounds, and is gone. The torch, the axe and the
// cross, at $EBC4 on, aren't ported yet. One that hits the flier (flier.c) stays as a spark for three rounds.

#include "game.h"

enum { SPENT = 0x01, STOPPED = 0x04 };

// $EBC1: a weapon that's hit something stays where it is, shown, for three rounds.
static void spent_weapon(uint8_t object) {
  show_object(object);
  RAM[OBJECT_COLOURS + object] = 0;
  RAM[OBJECT_COUNT + object]++;
  took(WEAPON_SPENT_COUNTED);
  if (RAM[OBJECT_COUNT + object] >= 4) {
    RAM[OBJECT_STATE + object] = 0;
    RAM[OBJECT_FLAGS + object] = 0;
    took(WEAPON_SPENT_OVER);
    return;
  }
  took(WEAPON_SPENT_STAYS);
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (!(RAM[OBJECT_FLAGS + object] & STOPPED)) {
    // $EC01: the spark of a weapon an enemy's hide has stopped, two shapes
    RAM[OBJECT_SHAPE + object] = (uint8_t)(0x56 + ((RAM[OBJECT_COUNT + object] << 3) & 0x10));
    took(WEAPON_SPARK_SHAPE);
    return;
  }
  int right = RAM[OBJECT_HEADING + object] == 0x04;
  RAM[OBJECT_SHAPE + object] = right ? 0xF8 : 0xF9;
  took(right ? WEAPON_STOPPED_SHAPE_RIGHT : WEAPON_STOPPED_SHAPE_LEFT);
  if (object >= 0x0F) took(READ_PAST_PAGE);
}

void weapon(uint8_t object) {
  uint8_t dagger = RAM[OBJECT_KIND + object] == DAGGER;
  RAM[OBJECT_COLOURS + object] = 0;
  took(WEAPON_TURN_BEGINS);
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (RAM[OBJECT_FLAGS + object] & SPENT) {
    took(WEAPON_IS_SPENT);
    spent_weapon(object);
    return;
  }
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
  if (RAM[OBJECT_FLAGS + object] & SPENT) {
    took(WEAPON_IS_SPENT);
    spent_weapon(object);
    return;
  }
  took(WEAPON_NOT_SPENT);
  // sub_E9CA: the block four pixels above its place. A place whose four pixels above are on the screen above, at
  // $E9E5, isn't ported yet. Counted a write at a time.
  took(WEAPON_BLOCK_ABOVE);
  RAM[0x22] = 4;
  took(WEAPON_BLOCK_ROW);
  RAM[0x77] = RAM[OBJECT_Y_SCREEN + object];
  took(WEAPON_BLOCK_LINE);
  RAM[0x73] = (uint8_t)(RAM[OBJECT_Y + object] - 4);
  took(WEAPON_BLOCK_SCREEN_ACROSS);
  RAM[0x78] = RAM[OBJECT_X_SCREEN + object];
  took(WEAPON_BLOCK_ROW);
  RAM[0x74] = RAM[OBJECT_X + object];
  took(WEAPON_BLOCK_PLACED);
  uint8_t block = block_at_stage_place();
  if (block != 0xD0 && block != 0xDF) { took(WEAPON_FLIES_ON); return; }
  // $EBB0: one of a gravestone's two blocks stops it, with a sound
  took(block == 0xD0 ? WEAPON_STOPPED_BY_D0 : WEAPON_STOPPED_BY_DF);
  sound_play(0x1E);
  RAM[OBJECT_COUNT + object] = 0;
  RAM[OBJECT_FLAGS + object] |= STOPPED | SPENT;
  took(WEAPON_STOPPED);
  if (object >= 0x10) took_times(READ_PAST_PAGE, 2);
}
