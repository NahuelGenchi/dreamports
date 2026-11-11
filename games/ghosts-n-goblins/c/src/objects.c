// Ghosts'n Goblins Dreamport: the objects' task, from the original's code at $F367 and bank 4's $9CC8, with the objects
// the opening scene has. Each round every object in use runs the code for its kind, and then its place in the stage
// becomes a place on the screen, for the sprites' task. Arthur, the first object, has a task of his own (arthur.c).
//
// So far it has the kinds the opening scene uses, the princess, Satan, and Arthur's armour on the ground, and the
// zombies (enemies.c). The other kinds do nothing yet.

#include "game.h"

enum { ARTHUR = 0, PRINCESS = 1 };
// the view's place in the stage (scroll.c): pixels and screens, across and down
enum { VIEW_X = 0x64, VIEW_X_SCREEN = 0x65, VIEW_Y = 0x67, VIEW_Y_SCREEN = 0x68 };
// two places the routines below work on, each a screen and a pixel down and across: $77, $73, $78, $74 and $79, $75, $7A, $76
#define A_Y_SCREEN RAM[0x77]
#define A_Y RAM[0x73]
#define A_X_SCREEN RAM[0x78]
#define A_X RAM[0x74]
#define B_Y_SCREEN RAM[0x79]
#define B_Y RAM[0x75]
#define B_X_SCREEN RAM[0x7A]
#define B_X RAM[0x76]

// sub_F321 and sub_F346
void show_object(uint8_t object) {
  RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
  took(OBJECT_SHOWN);
}
void hide_object(uint8_t object) {
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
  took(OBJECT_SHOWN);
}

// sub_F0BC: the object's place, as the second of the two.
static void object_place(uint8_t object) {
  B_X = RAM[OBJECT_X + object];
  B_X_SCREEN = RAM[OBJECT_X_SCREEN + object];
  B_Y = RAM[OBJECT_Y + object];
  B_Y_SCREEN = RAM[OBJECT_Y_SCREEN + object];
}

// sub_F108: the view's place, as the first.
static void view_place(void) {
  A_X = RAM[VIEW_X];
  A_X_SCREEN = RAM[VIEW_X_SCREEN];
  A_Y = RAM[VIEW_Y];
  A_Y_SCREEN = RAM[VIEW_Y_SCREEN];
}

// sub_F0E6: how far the second place is from the first, left in the first.
static void second_from_first(void) {
  uint16_t across = (uint16_t)((B_X_SCREEN << 8 | B_X) - (A_X_SCREEN << 8 | A_X)), down = (uint16_t)((B_Y_SCREEN << 8 | B_Y) - (A_Y_SCREEN << 8 | A_Y));
  A_X = (uint8_t)across;
  A_X_SCREEN = (uint8_t)(across >> 8);
  A_Y = (uint8_t)down;
  A_Y_SCREEN = (uint8_t)(down >> 8);
}

// sub_F181: where an object is on the screen, from where it is in the stage and where the view is. A screen down is 240
// pixels, so an object on another screen than the view's is 16 pixels nearer than the numbers say.
void place_on_screen(uint8_t object) {
  object_place(object);
  view_place();
  second_from_first();
  took(OBJECT_PLACED);
  if (RAM[OBJECT_Y_SCREEN + object] != RAM[VIEW_Y_SCREEN]) {
    A_Y -= 0x10;
    took(OBJECT_PLACED_OTHER_SCREEN);
  }
  RAM[OBJECT_SCREEN_Y + object] = A_Y;
  RAM[OBJECT_SCREEN_X + object] = A_X;
}

// sub_F0A3: whether an object is in the view's own screen, across and down.
int object_in_view(uint8_t object) {
  object_place(object);
  B_Y_SCREEN++;
  view_place();
  A_Y_SCREEN++;
  second_from_first();
  took(A_Y_SCREEN ? OBJECT_OUT_OF_VIEW_DOWN : A_X_SCREEN ? OBJECT_OUT_OF_VIEW_ACROSS : OBJECT_IN_VIEW);
  return A_Y_SCREEN == 0 && A_X_SCREEN == 0;
}

// sub_E3E3 and sub_EA2F. The two blocks $76 and $77, which a stage's set of tiles can make solid, at $E3F3, and a place
// whose 11 pixels below are on the next screen down, at $EA44, aren't ported yet.
int on_the_ground(uint8_t object) {
  took(GROUND_LOOKED_AT);
  RAM[0x77] = RAM[OBJECT_Y_SCREEN + object];
  RAM[0x73] = (uint8_t)(RAM[OBJECT_Y + object] + 0x0B);
  RAM[0x78] = RAM[OBJECT_X_SCREEN + object];
  RAM[0x74] = RAM[OBJECT_X + object];
  RAM[0x22] = block_at_stage_place();
  return RAM[0x22] >= BLOCK_SOLID;
}

uint8_t free_object(void) {
  uint8_t object = 1;
  took(FREE_OBJECT_BEGINS);
  while (object < NO_OBJECT && RAM[OBJECT_FLAGS + object]) {
    object++;
    took(FREE_OBJECT_USED);
    took(object < NO_OBJECT ? GOES_ROUND : GOES_ON);
  }
  took(object < NO_OBJECT ? FREE_OBJECT_FOUND : FREE_OBJECT_NONE);
  return object;
}

// For the kinds it doesn't count: the ones it does, at $F70F and $F722, aren't ported yet.
void remove_object(uint8_t object) {
  RAM[0x0647 + object] = 0;
  RAM[OBJECT_FLAGS + object] = 0;
  took(OBJECT_REMOVED);
}

// sub_F137: $48, $27 and $26, a number of 24 bits, times $52 over 256, as the original shifts and adds it: half the
// number for the top bit of $52, a quarter for the next, and so on, each with the bits below a 256th dropped only once
// they're added.
static void scale(void) {
  uint32_t value = (uint32_t)RAM[0x48] << 24 | (uint32_t)(RAM[0x27] << 16 | RAM[0x26] << 8), sum = 0;
  uint8_t by = RAM[0x52];
  took(SCALE_BEGINS);
  do {
    value >>= 1;
    took(by & 0x80 ? SCALE_BIT_SET : SCALE_BIT_CLEAR);
    if (by & 0x80) sum += value;
    by = (uint8_t)(by << 1);
    took(by ? GOES_ROUND : GOES_ON);
  } while (by);
  took(RETURNS);
  RAM[0x52] = 0;
  RAM[0x25] = (uint8_t)(value >> 24);
  RAM[0x24] = (uint8_t)(value >> 16);
  RAM[0x23] = (uint8_t)(value >> 8);
  RAM[0x22] = (uint8_t)value;
  RAM[0x26] = (uint8_t)sum;
  RAM[0x27] = (uint8_t)(sum >> 8);
  RAM[0x48] = (uint8_t)(sum >> 16);
}

// sub_F03E and sub_EFDA: moves an object by `speed` the way it's heading, one of 16 ways. The copy's table at $F2A3 has,
// for each way, how far down and how far across a speed of 256 goes, in 256ths of a pixel. Leaving its screen down, at
// $F077 and $F08A, isn't ported yet.
void move_object(uint8_t object, uint8_t speed) {
  took(MOVE_BEGINS);
  uint16_t way = (uint16_t)(0xF2A3 + RAM[OBJECT_HEADING + object] * 4);
  RAM[0xA0] = speed;
  set_ram16(0x9D, 0xF2A3);
  for (int across = 0; across < 2; across++) {
    RAM[0x26] = cart(7, (uint16_t)(way + across * 2));
    RAM[0x27] = cart(7, (uint16_t)(way + across * 2 + 1));
    RAM[0x48] = RAM[0x27] & 0x80 ? 0xFF : 0;
    RAM[0x52] = speed;
    took(RAM[0x27] & 0x80 ? MOVE_WAY_BACK : MOVE_WAY_FORWARD);
    took(MOVE_SCALE_CALLED);
    scale();
    RAM[0x77 + across] = RAM[0x48];
    RAM[0x73 + across] = RAM[0x27];
    RAM[0x7B + across] = RAM[0x26];
    took(across ? MOVE_FOUND : MOVE_ACROSS_BEGINS);
  }
  took(MOVE_ADDED);
  took(MOVE_SAME_SCREEN);
  took(MOVE_ENDS);
  uint32_t x = (uint32_t)(RAM[OBJECT_X_SCREEN + object] << 16 | RAM[OBJECT_X + object] << 8 | RAM[OBJECT_X_PART + object]);
  x += (uint32_t)(A_X_SCREEN << 16 | A_X << 8 | RAM[0x7C]);
  RAM[OBJECT_X_PART + object] = (uint8_t)x;
  RAM[OBJECT_X + object] = (uint8_t)(x >> 8);
  RAM[OBJECT_X_SCREEN + object] = (uint8_t)(x >> 16);
  uint32_t y = (uint32_t)(RAM[OBJECT_Y_SCREEN + object] << 16 | RAM[OBJECT_Y + object] << 8 | RAM[OBJECT_Y_PART + object]);
  y += (uint32_t)(A_Y_SCREEN << 16 | A_Y << 8 | RAM[0x7B]);
  RAM[OBJECT_Y_PART + object] = (uint8_t)y;
  RAM[OBJECT_Y + object] = (uint8_t)(y >> 8);
  A_Y_SCREEN = (uint8_t)(y >> 16);
  RAM[OBJECT_Y_SCREEN + object] = A_Y_SCREEN;
}

// sub_EF25: the way from the second place to the first, one of 16, from the copy's table of angles at $F1A3. So far only
// for a place to the left and not above; the other quarters, at $EF43 and $EF60, aren't ported yet.
static uint8_t way_to_first(void) {
  uint16_t down = (uint16_t)((A_Y_SCREEN << 8 | A_Y) - (B_Y_SCREEN << 8 | B_Y)), across = (uint16_t)((A_X_SCREEN << 8 | A_X) - (B_X_SCREEN << 8 | B_X));
  // sub_EFC1: for this quarter the two change places, and the angle is counted from 8
  set_ram16(0x26, down);
  RAM[0x22] = 8;
  uint16_t first = (uint16_t)-across, second = down;
  A_Y_SCREEN = (uint8_t)(first >> 8);
  A_X_SCREEN = (uint8_t)(second >> 8);
  uint8_t a = (uint8_t)first, b = (uint8_t)second;
  took(WAY_LEFT_AND_BELOW);
  while ((a & 0xF0) || (b & 0xF0)) {   // both down to 4 bits, for the table
    took(a & 0xF0 ? WAY_HALVED_FOR_FIRST : WAY_HALVED_FOR_SECOND);
    a >>= 1;
    b >>= 1;
  }
  took(WAY_SMALL_ENOUGH);
  A_Y = a;
  A_X = b;
  took(WAY_FOUND);
  if ((0xF1A3 & 0xFF) + (uint8_t)((a << 4) + b) > 0xFF) took(READ_PAST_PAGE);
  return (uint8_t)((cart(7, (uint16_t)(0xF1A3 + (uint8_t)((a << 4) + b))) + RAM[0x22]) & 0x0F);
}

// $F3E9, kind $33: the princess, who sits where she is.
static void princess(uint8_t object) {
  RAM[OBJECT_COLOURS + object] = 0x0E;
  RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
  took(PRINCESS_TURN);
}

// sub_EEA8: shown every other pair of rounds, by the object's count.
static void flash(uint8_t object) {
  hide_object(object);
  if (RAM[OBJECT_COUNT + object] & 0x02) RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
  took(FLASH_AFTER_HIDING);
}

// $EDA2, kind $34: Satan in the opening scene. He waits 80 rounds, comes out of the dark in flashes, with the stage
// going dark each time he shows, beats his wings, and then flies to the princess. Once he's within 8 pixels of her
// height he has her, and flies up and away with her below him, until he's high enough to go as he came, in flashes.
static void satan(uint8_t object) {
  enum { HAS_HER = 0x01, LEAVING = 0x02 };
  RAM[OBJECT_COLOURS + object] = 0x01;
  if (RAM[OBJECT_FLAGS + object] & LEAVING) {
    // $EE90: 16 rounds of flashes, and he's gone
    RAM[OBJECT_SHAPE + object] = 0xE6;
    RAM[OBJECT_COUNT + object]++;
    took(SATAN_LEAVES);
    flash(object);
    took(RAM[OBJECT_COUNT + object] >= 0x10 ? SATAN_GONE : SATAN_NOT_GONE_YET);
    if (RAM[OBJECT_COUNT + object] >= 0x10) RAM[OBJECT_FLAGS + object] = 0;
    return;
  }
  if (RAM[OBJECT_FLAGS + object] & HAS_HER) {
    // $EE51: up and to the right, his wings beating, with the princess 8 pixels left of him and 16 below
    RAM[OBJECT_COUNT + object]++;
    RAM[OBJECT_SHAPE + object] = (uint8_t)(0xE8 + ((RAM[OBJECT_COUNT + object] >> 2) & 1));   // sub_F576
    if (RAM[OBJECT_SCREEN_Y + object] < 0x50) {
      RAM[OBJECT_FLAGS + PRINCESS] = 0;
      RAM[OBJECT_COUNT + object] = 0;
      took(SATAN_HIGH_ENOUGH);
      sound_play(1);
      RAM[OBJECT_FLAGS + object] |= LEAVING;
      took(SATAN_LEAVING_SET);
      return;
    }
    RAM[OBJECT_HEADING + object] = 1;
    took(SATAN_CARRIES);
    move_object(object, 0x18);
    RAM[OBJECT_X + PRINCESS] = (uint8_t)(RAM[OBJECT_X + object] - 8);
    RAM[OBJECT_Y + PRINCESS] = (uint8_t)(RAM[OBJECT_Y + object] + 0x10);
    took(SATAN_CARRIED);
    return;
  }
  uint8_t count = ++RAM[OBJECT_COUNT + object];
  if (count < 0x50) {
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
    took(SATAN_WAITS);
    return;
  }
  took(SATAN_COMES);
  took(count == 0x50 ? SATAN_SOUND_CALLED : SATAN_NO_SOUND);
  if (count == 0x50) sound_play(0x27);
  if (count < 0x70) {
    RAM[OBJECT_SHAPE + object] = 0xE6;
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
    if (count & 0x02) RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
    took(SATAN_FLASHES);
    PPU_MASK = RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN ? 0x16 : 0x1E;
    took(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN ? SATAN_FLASH_SHOWN : SATAN_FLASH_HIDDEN);
    return;
  }
  if (count < 0x90) {
    RAM[OBJECT_SHAPE + object] = (uint8_t)(0xE8 + ((count >> 2) & 1));
    RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
    took(SATAN_BEATS_WINGS);
    return;
  }
  RAM[OBJECT_SHAPE + object] = 0xE7;
  RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
  uint8_t above = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + PRINCESS]);
  if (above < 8 || above >= 0xF8) {
    RAM[OBJECT_SHAPE + PRINCESS] = 0xF2;
    RAM[OBJECT_FLAGS + object] |= HAS_HER;
    took(above < 8 ? SATAN_REACHES_HER : SATAN_REACHES_HER_FROM_BELOW);
    return;
  }
  A_X = RAM[OBJECT_X + PRINCESS];
  A_X_SCREEN = RAM[OBJECT_X_SCREEN + PRINCESS];
  A_Y = RAM[OBJECT_Y + PRINCESS];
  A_Y_SCREEN = RAM[OBJECT_Y_SCREEN + PRINCESS];
  object_place(object);
  took(SATAN_FLIES);
  RAM[OBJECT_HEADING + object] = way_to_first();
  took(SATAN_HEADS);
  move_object(object, 0x18);
}

// sub_F63A: whether Arthur is within a box around an object: $22 and $24 are how far left and right of it he can be,
// and $23 and $25 how far above and below. Across, the two have to be less than half a screen apart in the stage first.
static int arthur_within(uint8_t object) {
  int16_t apart = (int16_t)((RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]) - (RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]));
  RAM[0x47] = (uint8_t)apart;
  uint8_t screens = (uint8_t)((uint16_t)apart >> 8), same = screens == 0, next = screens == 0xFF;
  if (apart < -128 || apart > 127) {
    took(same ? WITHIN_SAME_SCREEN_FAR : next ? WITHIN_NEXT_SCREEN_FAR : WITHIN_SCREENS_APART);
    return 0;
  }
  took(same ? WITHIN_SAME_SCREEN : WITHIN_NEXT_SCREEN);
  uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + ARTHUR] - RAM[OBJECT_SCREEN_X + object]);
  if (across < RAM[0x22] && across >= RAM[0x24]) { took(WITHIN_ACROSS_NOT); return 0; }
  took(across >= RAM[0x22] ? WITHIN_ACROSS_LEFT : WITHIN_ACROSS_RIGHT);
  uint8_t down = (uint8_t)(RAM[OBJECT_SCREEN_Y + ARTHUR] - RAM[OBJECT_SCREEN_Y + object]);
  took(down >= RAM[0x23] ? WITHIN_DOWN_ABOVE : down < RAM[0x25] ? WITHIN_DOWN_BELOW : WITHIN_DOWN_NOT);
  return down >= RAM[0x23] || down < RAM[0x25];
}

// sub_F68E: whether Arthur touches an object, whose own half width and half height are in $26 and $27. He touches nothing
// while his flags say so, as in the opening scene before his jump. His middle is 4 pixels above his place, and a
// crouching Arthur, at $F6A2, isn't ported yet.
int arthur_touches(uint8_t object) {
  enum { CAN_TOUCH_NOTHING = 0x41, CROUCHING = 0x02 };
  if (RAM[OBJECT_FLAGS + ARTHUR] & CAN_TOUCH_NOTHING) { took(PICK_UP_CANNOT_BE_TOUCHED); return 0; }
  took(TOUCH_SET_UP);
  RAM[0x25] = (uint8_t)(8 + RAM[0x27]);
  RAM[0x23] = (uint8_t)-RAM[0x25];
  RAM[0x24] = (uint8_t)(RAM[0x26] + 4);
  RAM[0x22] = (uint8_t)-RAM[0x24];
  int standing = !(RAM[OBJECT_FLAGS + ARTHUR] & CROUCHING);
  if (standing) RAM[OBJECT_SCREEN_Y + ARTHUR] -= 4;
  int touches = arthur_within(object);
  if (standing) RAM[OBJECT_SCREEN_Y + ARTHUR] += 4;
  took(TOUCH_ENDS);
  return touches;
}

// $BA09 in bank 4, kind $10: something to pick up, here Arthur's armour. Its shape and colours come from the copy's
// lists at $BB2D, by which thing it is, and it flashes another colour every fourth round. When Arthur touches the
// armour he has it: his flags say so, the tiles' task sends the armoured Arthur's tiles, and the object is gone. The
// other things, at $BA99 and $BAAC, the sound the armour makes outside the scene, at $BA83, and the kinds $F708 keeps
// after they're picked up aren't ported yet.
static void pick_up(uint8_t object) {
  enum { ARMOUR = 5, WITHOUT_ARMOUR = 0x20 };
  RAM[OBJECT_COUNT + object]++;
  took(PICK_UP_BEGINS);
  show_object(object);
  if (!object_in_view(object)) {
    // $BA14: hidden while it's out of the view. What the third set of stages does with it then, at $BB72, isn't ported yet.
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
    took(PICK_UP_OUT_OF_VIEW);
    return;
  }
  uint8_t thing = RAM[OBJECT_STATE + object];
  RAM[OBJECT_SHAPE + object] = peek((uint16_t)(0xBB2D + thing));
  RAM[OBJECT_COLOURS + object] = peek((uint16_t)(0xBB3B + thing));
  took(PICK_UP_IN_VIEW);
  if (!(RAM[OBJECT_COUNT + object] & 3)) {
    RAM[OBJECT_COLOURS + object] = peek((uint16_t)(0xBB49 + thing));
    took(PICK_UP_FLASHES);
  }
  RAM[0x26] = RAM[0x27] = 6;
  int touched = arthur_touches(object);
  if (!touched) took(PICK_UP_LEFT);
  if (!touched || thing != ARMOUR) return;
  took(PICK_UP_ARMOUR_TAKEN);
  RAM[OBJECT_FLAGS + ARTHUR] &= (uint8_t)~WITHOUT_ARMOUR;
  TILES_FIRST_LIST = 0;
  RAM[0xD6] = RAM[0xD7] = RAM[0xD8] = RAM[0xD9] = 0xFF;
  RAM[0x0647 + object] = 0;
  RAM[OBJECT_FLAGS + object] = 0;
}

// $F367, the objects' task: bank 4's $9CC8 runs every object but the first, by its kind.
wait objects_task(void) {
  enum { FIRST_TURN, LATER };
  if (task_step[TASK_OBJECTS] == LATER) took(OBJECTS_AGAIN);
  task_step[TASK_OBJECTS] = LATER;
  switch_bank(4);
  took(OBJECTS_BEGIN);
  for (uint8_t object = 1; object < 0x16; object++) {
    took(OBJECT_LOOKED_AT);
    if (object >= 0x10) took(OBJECT_PAST_PAGE);
    if (!RAM[OBJECT_FLAGS + object]) took(OBJECT_UNUSED);
    else {
      uint8_t kind = RAM[OBJECT_KIND + object];
      took(OBJECT_USED);
      if (kind * 2 >= 0x13) took(OBJECT_KIND_PAST_PAGE);
      if (kind * 2 >= 0x12) took(OBJECT_KIND_PAST_PAGE);
      set_ram16(0x26, peek16((uint16_t)(0x9CED + kind * 2)));
      switch (kind) {
        case 0x00: zombie(object); break;
        case 0x10: pick_up(object); break;
        case 0x33: princess(object); break;
        case 0x34: satan(object); break;
      }
      place_on_screen(object);
    }
    took(OBJECT_NEXT);
    took(object < 0x15 ? GOES_ROUND : GOES_ON);
  }
  switch_bank(BANK_HOME);
  took(OBJECTS_END);
  return YIELDS;
}
