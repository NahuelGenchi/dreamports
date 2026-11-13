// Ghosts'n Goblins Dreamport: the objects' task, from the original's code at $F367 and sub_04_9CC8, with the objects
// the opening scene has. Each round every object in use runs the code for its kind, and then its place in the stage
// becomes a place on the screen, for the sprites' task. Arthur, the first object, has a task of his own (arthur.c).
//
// So far it has the kinds the opening scene uses, the princess, Satan, and Arthur's armour on the ground, and the
// zombies and the pot one carries (enemies.c), Arthur's lance and dagger (weapons.c), and the first of a stage's own:
// its gravestones and its hidden things. The other kinds do nothing yet.

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
  took(OBJECT_SHOWN_READ_FLAGS);
  if (object >= 0x10) took(READ_PAST_PAGE);   // the flags of the objects from the 17th on are in the next page
  RAM[OBJECT_FLAGS + object] |= OBJECT_FLAG_SHOWN;
  took(OBJECT_SHOWN_STORED);
}
void hide_object(uint8_t object) {
  took(OBJECT_SHOWN_READ_FLAGS);
  if (object >= 0x10) took(READ_PAST_PAGE);
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
  took(OBJECT_SHOWN_STORED);
}

// sub_F0BC: the object's place, as the second of the two. `timed` counts it a write at a time, with its call, for the
// routines a frame can end in; the others count it in a piece of their own.
static void object_place(uint8_t object, int timed) {
  if (timed) took(PLACE_FIRST_READ);
  B_X = RAM[OBJECT_X + object];
  if (timed) took(PLACE_NEXT_READ);
  B_X_SCREEN = RAM[OBJECT_X_SCREEN + object];
  if (timed) took(PLACE_NEXT_READ);
  B_Y = RAM[OBJECT_Y + object];
  if (timed) took(PLACE_NEXT_READ);
  B_Y_SCREEN = RAM[OBJECT_Y_SCREEN + object];
  if (timed) took(PLACE_LAST_WRITE);
}

// sub_F108: the view's place, as the first, a write at a time.
static void view_place(void) {
  took(VIEW_PLACE_FIRST_READ);
  A_X = RAM[VIEW_X];
  took(VIEW_PLACE_NEXT_READ);
  A_X_SCREEN = RAM[VIEW_X_SCREEN];
  took(VIEW_PLACE_NEXT_READ);
  A_Y = RAM[VIEW_Y];
  took(VIEW_PLACE_NEXT_READ);
  A_Y_SCREEN = RAM[VIEW_Y_SCREEN];
  took(PLACE_LAST_WRITE);
}

// sub_F0E6: how far the second place is from the first, left in the first, a write at a time.
static void second_from_first(void) {
  uint16_t across = (uint16_t)((B_X_SCREEN << 8 | B_X) - (A_X_SCREEN << 8 | A_X)), down = (uint16_t)((B_Y_SCREEN << 8 | B_Y) - (A_Y_SCREEN << 8 | A_Y));
  took(APART_FIRST);
  A_X = (uint8_t)across;
  took(APART_SCREEN);
  A_X_SCREEN = (uint8_t)(across >> 8);
  took(APART_DOWN);
  A_Y = (uint8_t)down;
  took(APART_SCREEN);
  A_Y_SCREEN = (uint8_t)(down >> 8);
  took(PLACE_LAST_WRITE);
}

// sub_F181: where an object is on the screen, from where it is in the stage and where the view is. A screen down is 240
// pixels, so an object on another screen than the view's is 16 pixels nearer than the numbers say.
void place_on_screen(uint8_t object) {
  took(CALLS);
  object_place(object, 1);
  view_place();
  second_from_first();
  if (RAM[OBJECT_Y_SCREEN + object] != RAM[VIEW_Y_SCREEN]) {
    took(OBJECT_PLACED_OTHER_SCREEN);
    A_Y -= 0x10;
    took(OBJECT_PLACED_LINE_TAKEN);
  } else took(OBJECT_PLACED);
  RAM[OBJECT_SCREEN_Y + object] = A_Y;
  took(OBJECT_PLACED_LINE);
  RAM[OBJECT_SCREEN_X + object] = A_X;
  took(OBJECT_PLACED_ACROSS);
}

// sub_F0A3: whether an object is in the view's own screen, across and down.
int object_in_view(uint8_t object) {
  took(CALLS);
  object_place(object, 1);
  B_Y_SCREEN++;
  took(PLACE_SCREEN_COUNTED);
  view_place();
  A_Y_SCREEN++;
  took(PLACE_SCREEN_COUNTED);
  second_from_first();
  took(A_Y_SCREEN ? OBJECT_OUT_OF_VIEW_DOWN : A_X_SCREEN ? OBJECT_OUT_OF_VIEW_ACROSS : OBJECT_IN_VIEW);
  return A_Y_SCREEN == 0 && A_X_SCREEN == 0;
}

// sub_E3E3 and sub_EA2F. A place
// whose 11 pixels below are on the next screen down, at $EA44, aren't ported yet.
int on_the_ground(uint8_t object) {
  took(GROUND_LOOKED_AT);
  RAM[0x77] = RAM[OBJECT_Y_SCREEN + object];
  RAM[0x73] = (uint8_t)(RAM[OBJECT_Y + object] + 0x0B);
  RAM[0x78] = RAM[OBJECT_X_SCREEN + object];
  RAM[0x74] = RAM[OBJECT_X + object];
  if (RAM[0x73] >= 0xF0) {
    // $EA44: 11 pixels below is on the next screen down, as a screen is 240 pixels high
    RAM[0x73] = (uint8_t)(RAM[0x73] + 0x10);
    RAM[0x77]++;
    took(BLOCK_BELOW_ARTHUR_NEXT_SCREEN);
  }
  RAM[0x22] = block_at_stage_place();
  // $E3F3: in the first set of stages the blocks $76 and $77 are solid across half their width: the right half of
  // $76, the left of $77
  if (RAM[0x22] == 0x76 || RAM[0x22] == 0x77) {
    uint8_t right_half = (RAM[OBJECT_X + object] & 0x0F) >= 8, first = RAM[0x22] == 0x76;
    if (RAM[0xCF]) { took(first ? GROUND_HALF_BLOCK_OTHER_SET_76 : GROUND_HALF_BLOCK_OTHER_SET_77); return 0; }
    took(first ? GROUND_HALF_BLOCK_76 : right_half ? GROUND_HALF_BLOCK_77_OPEN : GROUND_HALF_BLOCK_77_SOLID);
    return first ? right_half : !right_half;
  }
  return RAM[0x22] >= BLOCK_SOLID;
}

/** sub_04_BC9C, kind $1E: the key a stage's last boss leaves. It falls from the top of the picture, its colours
 *  changing every round, until it's on the ground, flag $02. Arthur within 8 pixels of it takes it: the time stops,
 *  at $C9, and it's worth 1,000 points. What the stage does then, from $C9, isn't ported yet. */
void key(uint8_t object) {
  enum { LANDED = 0x02 };
  RAM[OBJECT_SHAPE + object] = 0x47;
  RAM[OBJECT_COLOURS + object] = (RAM[OBJECT_COLOURS + object] + 1) & 3;
  took(KEY_BEGINS);
  hide_object(object);
  if (object_in_view(object)) {
    took(GOES_ON);
    show_object(object);
  } else took(BRANCH_TAKEN);
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (RAM[OBJECT_FLAGS + object] & LANDED) took(BRANCH_TAKEN);
  else {
    RAM[OBJECT_HEADING + object] = 0x08;
    took(KEY_FALLS);
    took(CALLS);
    move_object(object, 0x08);
    place_on_screen(object);
    if (!on_the_ground(object)) { took(KEY_IN_THE_AIR); return; }
    took(BRANCH_TAKEN);
    RAM[OBJECT_FLAGS + object] |= LANDED;
    took(OBJECT_FLAG_CHANGED);
    if (object >= 0x10) took(READ_PAST_PAGE);
  }
  RAM[0x26] = RAM[0x27] = 8;
  took(KEY_LOOKS);
  if (!arthur_near(object)) { took(KEY_NOT_TAKEN); return; }
  RAM[0xC9] = 0xFF;
  RAM[OBJECT_FLAGS + object] = 0;
  RAM[0x25] = RAM[0x27] = RAM[0x26] = 0;
  RAM[0x24] = 1;
  took(KEY_TAKEN);
  add_score_with_thousands(object, 0);
  took(RETURNS);
}

uint8_t take_object(void) {
  enum { FIRST = 1, NEXT_SEARCH = 0xCE, AWAKE = 0x065D };
  uint8_t object = RAM[NEXT_SEARCH];
  took(TAKE_OBJECT_BEGINS);
  for (;;) {
    uint8_t flags = RAM[OBJECT_FLAGS + object], stays = 1;
    took(TAKE_OBJECT_READ);
    if (object >= 0x10) took(READ_PAST_PAGE);
    if (flags & OBJECT_FLAG_SHOWN) took(TAKE_OBJECT_SHOWN);
    else if (!flags) { took(TAKE_OBJECT_FREE); break; }
    else {
      // in use and not shown: the bosses, the stage's own things and a kind 6 that's awake stay
      static const struct { uint8_t kind; cost stays; } STAYING[] = {
        { 0x05, TAKE_OBJECT_KIND_5 }, { 0x0F, TAKE_OBJECT_KIND_F }, { 0x10, TAKE_OBJECT_KIND_10 }, { 0x11, TAKE_OBJECT_KIND_11 },
      };
      uint8_t kind = RAM[OBJECT_KIND + object];
      cost takes = TAKE_OBJECT_OTHER_KIND;
      stays = 0;
      for (unsigned k = 0; k < sizeof STAYING / sizeof *STAYING; k++) if (kind == STAYING[k].kind) { takes = STAYING[k].stays; stays = 1; }
      if (kind == 0x06) { stays = RAM[AWAKE + object] != 0; takes = stays ? TAKE_OBJECT_KIND_6_AWAKE : TAKE_OBJECT_KIND_6; }
      took(takes);
      if (!stays) break;
    }
    if (++object >= NO_OBJECT) { object = FIRST; took(TAKE_OBJECT_NEXT_WRAPS); }
    else took(TAKE_OBJECT_NEXT);
    if (object == RAM[NEXT_SEARCH]) { took(TAKE_OBJECT_NONE); return NO_OBJECT; }
    took(BRANCH_TAKEN);
  }
  RAM[NEXT_SEARCH] = (uint8_t)(object + 1);
  if (RAM[NEXT_SEARCH] >= NO_OBJECT) { RAM[NEXT_SEARCH] = FIRST; took(TAKE_OBJECT_TAKEN_WRAPS); }
  else took(TAKE_OBJECT_TAKEN);
  return object;
}

uint8_t free_object(void) {
  uint8_t object = 1;
  took(FREE_OBJECT_BEGINS);
  while (object < NO_OBJECT && RAM[OBJECT_FLAGS + object]) {
    object++;
    took(FREE_OBJECT_USED);
    took(object < NO_OBJECT ? GOES_ROUND : GOES_ON);
  }
  if (object >= 0x10) took(READ_PAST_PAGE);   // the sixteenth's flags, which are read last, are in the next page
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
    uint8_t set = by & 0x80;
    value >>= 1;
    took(SCALE_BIT_SHIFTED);
    by = (uint8_t)(by << 1);
    RAM[0x52] = by;
    took(set ? SCALE_BIT_SET : SCALE_BIT_CLEAR);
    if (set) sum += value;
    took(by ? GOES_ROUND : GOES_ON);
  } while (by);
  took(RETURNS);
  RAM[0x25] = (uint8_t)(value >> 24);
  RAM[0x24] = (uint8_t)(value >> 16);
  RAM[0x23] = (uint8_t)(value >> 8);
  RAM[0x22] = (uint8_t)value;
  RAM[0x26] = (uint8_t)sum;
  RAM[0x27] = (uint8_t)(sum >> 8);
  RAM[0x48] = (uint8_t)(sum >> 16);
}

// $F05A: what's in $77, $73 and $7B, screens, pixels and 256ths, added to an object's place down. The move is counted
// a write at a time, as enemies move in the middle of their turns and a frame can end inside one.
static void add_down(uint8_t object) {
  uint32_t y = (uint32_t)(RAM[OBJECT_Y_SCREEN + object] << 16 | RAM[OBJECT_Y + object] << 8 | RAM[OBJECT_Y_PART + object]);
  y += (uint32_t)(A_Y_SCREEN << 16 | A_Y << 8 | RAM[0x7B]);
  uint8_t pixel = (uint8_t)(y >> 8), screen = (uint8_t)(y >> 16), was = RAM[OBJECT_Y_SCREEN + object];
  took(MOVE_DOWN_PART);
  RAM[OBJECT_Y_PART + object] = (uint8_t)y;
  took(MOVE_DOWN_PIXEL);
  RAM[OBJECT_Y + object] = pixel;
  took(MOVE_DOWN_SCREEN);
  A_Y_SCREEN = screen;
  took(MOVE_DOWN_ADDED);
  // a screen is 240 pixels high: 16 are taken off on another screen, or put on past the last line of its own
  if (screen != was) {
    took(MOVE_OTHER_SCREEN_TAKES);
    RAM[OBJECT_Y + object] = (uint8_t)(pixel - 0x10);
    took(MOVE_OTHER_SCREEN);
  } else if (pixel >= 0xF0) {
    took(MOVE_NEXT_SCREEN_PUTS);
    RAM[OBJECT_Y + object] = (uint8_t)(pixel + 0x10);
    took(MOVE_NEXT_SCREEN_PUT);
    A_Y_SCREEN = (uint8_t)(screen + 1);
    took(MOVE_NEXT_SCREEN_DOWN);
  } else took(MOVE_SAME_SCREEN);
  took(MOVE_ENDS);
  RAM[OBJECT_Y_SCREEN + object] = A_Y_SCREEN;
  took(MOVE_ENDED);
}

// sub_F03E and sub_EFDA: moves an object by `speed` the way it's heading, one of 16 ways. The copy's table at $F2A3 has,
// for each way, how far down and how far across a speed of 256 goes, in 256ths of a pixel.
// sub_EFDA, with its call: how far `speed` goes the way an object is heading, left in $77, $73 and $7B down and $78,
// $74 and $7C across.
void find_move(uint8_t object, uint8_t speed) {
  took(MOVE_CALLED);
  RAM[0xA0] = speed;
  took(MOVE_TABLE_HIGH);
  RAM[0x9E] = 0xF2;
  took(MOVE_TABLE_LOW);
  RAM[0x9D] = 0xA3;
  took(MOVE_WAY_READ);
  if ((OBJECT_HEADING & 0xFF) + object > 0xFF) took(READ_PAST_PAGE);
  uint16_t way = (uint16_t)(0xF2A3 + RAM[OBJECT_HEADING + object] * 4);
  for (int across = 0; across < 2; across++) {
    RAM[0x48] = 0;
    took(across ? MOVE_THIRD_READ : MOVE_FIRST_READ);
    RAM[0x26] = cart(7, (uint16_t)(way + across * 2));
    took(MOVE_SECOND_READ);
    RAM[0x27] = cart(7, (uint16_t)(way + across * 2 + 1));
    if (RAM[0x27] & 0x80) {
      took(MOVE_WAY_BACK);
      RAM[0x48] = 0xFF;
      took(MOVE_SIGN_SET);
    } else took(MOVE_WAY_FORWARD);
    took(MOVE_SPEED_READ);
    RAM[0x52] = speed;
    took(MOVE_SCALE_CALLED);
    scale();
    took(MOVE_RESULT_READ);
    RAM[0x77 + across] = RAM[0x48];
    took(MOVE_RESULT_STORED);
    RAM[0x73 + across] = RAM[0x27];
    took(MOVE_RESULT_STORED);
    RAM[0x7B + across] = RAM[0x26];
    took(across ? MOVE_FOUND : MOVE_ACROSS_BEGINS);
  }
}

void move_object(uint8_t object, uint8_t speed) {
  find_move(object, speed);
  uint32_t x = (uint32_t)(RAM[OBJECT_X_SCREEN + object] << 16 | RAM[OBJECT_X + object] << 8 | RAM[OBJECT_X_PART + object]);
  x += (uint32_t)(A_X_SCREEN << 16 | A_X << 8 | RAM[0x7C]);
  took(MOVE_ACROSS_PART);
  RAM[OBJECT_X_PART + object] = (uint8_t)x;
  took(MOVE_ACROSS_NEXT);
  RAM[OBJECT_X + object] = (uint8_t)(x >> 8);
  took(MOVE_ACROSS_NEXT);
  RAM[OBJECT_X_SCREEN + object] = (uint8_t)(x >> 16);
  took(MOVE_ADDED_ACROSS);
  add_down(object);
}

void move_down(uint8_t object) {
  took(MOVE_DOWN_ONLY);
  RAM[0x7B] = 0;
  took(MOVE_DOWN_ONLY_JUMPS);
  add_down(object);
}

// sub_EF25: the way from the second place to the first, one of 16, from the copy's table of angles at $F1A3. For
// places a screen or more apart both distances are halved, at $EF8E, until neither is.
uint8_t way_to_first(void) {
  int16_t down = (int16_t)((A_Y_SCREEN << 8 | A_Y) - (B_Y_SCREEN << 8 | B_Y)), across = (int16_t)((A_X_SCREEN << 8 | A_X) - (B_X_SCREEN << 8 | B_X));
  // each quarter counts its angle from its own start, and in two of them sub_EFC1 has the two distances change places
  uint16_t first, second;
  if (across >= 0 && down >= 0) {
    RAM[0x22] = 4;
    first = (uint16_t)down, second = (uint16_t)across;
    took(WAY_RIGHT_AND_BELOW);
  } else if (across >= 0) {
    RAM[0x22] = 0;
    set_ram16(0x26, (uint16_t)down);
    first = (uint16_t)across, second = (uint16_t)-down;
    took(WAY_RIGHT_AND_ABOVE);
  } else if (down >= 0) {
    RAM[0x22] = 8;
    set_ram16(0x26, (uint16_t)down);
    first = (uint16_t)-across, second = (uint16_t)down;
    took(WAY_LEFT_AND_BELOW);
  } else {
    RAM[0x22] = 0x0C;
    first = (uint16_t)-down, second = (uint16_t)-across;
    took(WAY_LEFT_AND_ABOVE);
  }
  while ((first | second) >> 8) {
    took(first >> 8 ? WAY_SCREENS_HALVED_FOR_FIRST : WAY_SCREENS_HALVED_FOR_SECOND);
    first >>= 1;
    second >>= 1;
  }
  A_Y_SCREEN = 0;
  A_X_SCREEN = 0;
  uint8_t a = (uint8_t)first, b = (uint8_t)second;
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

uint8_t way_to_arthur(uint8_t from) {
  A_X = RAM[OBJECT_X + ARTHUR];
  A_X_SCREEN = RAM[OBJECT_X_SCREEN + ARTHUR];
  A_Y = RAM[OBJECT_Y + ARTHUR];
  A_Y_SCREEN = RAM[OBJECT_Y_SCREEN + ARTHUR];
  object_place(from, 0);
  return way_to_first();
}

int arthur_is_right_of(uint8_t object) {
  took(ARTHUR_SIDE);
  return (RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]) >= (RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]);
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
  object_place(object, 0);
  took(SATAN_FLIES);
  RAM[OBJECT_HEADING + object] = way_to_first();
  took(SATAN_HEADS);
  move_object(object, 0x18);
}

// sub_F63A: whether one object is within a box around another: $22 and $24 are how far left and right of it the first
// can be, and $23 and $25 how far above and below. Across, the two have to be less than half a screen apart in the stage first.
static int within(uint8_t first, uint8_t object) {
  int16_t apart = (int16_t)((RAM[OBJECT_X_SCREEN + first] << 8 | RAM[OBJECT_X + first]) - (RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]));
  RAM[0x47] = (uint8_t)apart;
  uint8_t screens = (uint8_t)((uint16_t)apart >> 8), same = screens == 0, next = screens == 0xFF;
  if (apart < -128 || apart > 127) {
    took(same ? WITHIN_SAME_SCREEN_FAR : next ? WITHIN_NEXT_SCREEN_FAR : WITHIN_SCREENS_APART);
    return 0;
  }
  took(same ? WITHIN_SAME_SCREEN : WITHIN_NEXT_SCREEN);
  uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + first] - RAM[OBJECT_SCREEN_X + object]);
  if (across < RAM[0x22] && across >= RAM[0x24]) { took(WITHIN_ACROSS_NOT); return 0; }
  took(across >= RAM[0x22] ? WITHIN_ACROSS_LEFT : WITHIN_ACROSS_RIGHT);
  uint8_t down = (uint8_t)(RAM[OBJECT_SCREEN_Y + first] - RAM[OBJECT_SCREEN_Y + object]);
  took(down >= RAM[0x23] ? WITHIN_DOWN_ABOVE : down < RAM[0x25] ? WITHIN_DOWN_BELOW : WITHIN_DOWN_NOT);
  return down >= RAM[0x23] || down < RAM[0x25];
}

// sub_F68E: whether Arthur touches an object, whose own half width and half height are in $26 and $27. He touches nothing
// while his flags say so, as in the opening scene before his jump. Standing, he's 8 pixels high either way from a
// middle 4 pixels above his place; crouching, 4 from his place.
int arthur_touches(uint8_t object) {
  enum { CAN_TOUCH_NOTHING = 0x41, CROUCHING = 0x02 };
  if (RAM[OBJECT_FLAGS + ARTHUR] & CAN_TOUCH_NOTHING) { took(PICK_UP_CANNOT_BE_TOUCHED); return 0; }
  int standing = !(RAM[OBJECT_FLAGS + ARTHUR] & CROUCHING);
  // a write at a time, as a frame can end inside it
  took(TOUCH_SET_UP);
  RAM[0x25] = 8;
  if (!standing) {
    took(TOUCH_CROUCHING);
    RAM[0x25] = 4;
    took(TOUCH_HEIGHT_CROUCHING);
  } else took(TOUCH_HEIGHT);
  RAM[0x25] = (uint8_t)(RAM[0x25] + RAM[0x27]);
  took(TOUCH_BOX_SIDE);
  RAM[0x23] = (uint8_t)-RAM[0x25];
  took(TOUCH_BOX_SIDE);
  RAM[0x24] = (uint8_t)(RAM[0x26] + 4);
  took(TOUCH_BOX_SIDE);
  RAM[0x22] = (uint8_t)-RAM[0x24];
  if (standing) {
    took(TOUCH_RAISED);
    RAM[OBJECT_SCREEN_Y + ARTHUR] -= 4;
    took(TOUCH_TESTS);
  } else took(TOUCH_TESTS_CROUCHING);
  int touches = within(ARTHUR, object);
  if (standing) {
    took(TOUCH_ENDS);
    RAM[OBJECT_SCREEN_Y + ARTHUR] += 4;
    took(TOUCH_LOWERED);
  } else took(TOUCH_ENDS_CROUCHING);
  return touches;
}

// The copy's lists at $F6EC and $F6F1 give each weapon's own half width and half height.
int weapon_touches(uint8_t weapon, uint8_t enemy) {
  uint8_t which = (uint8_t)(RAM[OBJECT_KIND + weapon] - LANCE);
  RAM[0xA9] = weapon;
  RAM[0x24] = (uint8_t)(cart(7, (uint16_t)(0xF6EC + which)) + RAM[0x26]);
  RAM[0x22] = (uint8_t)-RAM[0x24];
  RAM[0x25] = (uint8_t)(cart(7, (uint16_t)(0xF6F1 + which)) + RAM[0x27]);
  RAM[0x23] = (uint8_t)-RAM[0x25];
  took(WEAPON_BOX);
  return within(weapon, enemy);
}

// sub_04_BF0B, kind $20: a gravestone, an object that's never shown and that counts the weapons that touch it. What
// its fifteenth hit brings, at $BF42, and its two other states, at $F6F6 and $BF5F, aren't ported yet.
static void gravestone(uint8_t object) {
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
  RAM[OBJECT_COLOURS + object] = 0;
  took(GRAVESTONE_BEGINS);
  if (!object_in_view(object)) { took(GRAVESTONE_OUT_OF_VIEW); return; }
  RAM[0x26] = 8;
  RAM[0x27] = 4;
  took(GRAVESTONE_IN_VIEW);
  if (!weapon_that_touches(object)) { took(GRAVESTONE_NOT_HIT); return; }
  RAM[0x0647 + object]++;
  took(GRAVESTONE_HIT_COUNTED);
}

// sub_04_BB8C, kind $11: a thing that's hidden where the stage's list puts it until Arthur touches the place.
static void hidden_thing(uint8_t object) {
  RAM[OBJECT_SHAPE + object] = 0x49;
  took(HIDDEN_BEGINS);
  hide_object(object);
  if (!object_in_view(object)) {
    took(HIDDEN_OUT_OF_VIEW);
    hide_object(object);
  } else {
    RAM[0x26] = RAM[0x27] = 6;
    took(HIDDEN_IN_VIEW);
    if (!arthur_touches(object)) took(HIDDEN_NOT_TOUCHED);
    else {
      // $BBAD: touched, it comes down as a pot, 100 pixels further on and 16 higher, with what its state says inside.
      // One whose flag $01 is set needs him crouching, and the armour isn't given to an Arthur who has his.
      enum { POT = 0x12, FALLS = 0x04, ARMOUR = 5, CROUCHES = 0x02, WITHOUT_ARMOUR = 0x20 };
      took(HIDDEN_TOUCHED);
      took(OBJECT_FLAG_READ);
      if (object >= 0x10) took(READ_PAST_PAGE);
      int stays = 0;
      if (RAM[OBJECT_FLAGS + object] & 0x01) {
        stays = !(RAM[OBJECT_FLAGS + ARTHUR] & CROUCHES);
        took(stays ? HIDDEN_NEEDS_A_CROUCH : HIDDEN_CROUCHED_AT);
      } else took(HIDDEN_ANY_TOUCH);
      if (!stays) {
        if (RAM[OBJECT_STATE + object] != ARMOUR) took(HIDDEN_OPENS);
        else if (RAM[OBJECT_FLAGS + ARTHUR] & WITHOUT_ARMOUR) took(HIDDEN_ARMOUR_OPENS);
        else {
          took(HIDDEN_ARMOUR_NOT_NEEDED);
          remove_object(object);
          return;
        }
        uint16_t across = (uint16_t)((RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]) + 0x64);
        RAM[OBJECT_KIND + object] = POT;
        RAM[OBJECT_X + object] = (uint8_t)across;
        RAM[OBJECT_X_SCREEN + object] = (uint8_t)(across >> 8);
        A_Y = 0xF0;
        A_Y_SCREEN = 0xFF;
        took(HIDDEN_BECOMES_POT);
        move_down(object);
        RAM[OBJECT_FLAGS + object] |= FALLS;
        RAM[OBJECT_HEADING + object] = 0x08;
        took(HIDDEN_POT_FALLS);
        if (object >= 0x10) took(READ_PAST_PAGE);
        return;
      }
    }
  }
  took(HIDDEN_STAYS);
}

// $FF62, kind $22: the marker on the map, which blinks between two sets of colours every four rounds.
static void map_marker(uint8_t object) {
  show_object(object);
  if (!object_in_view(object)) {
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
    took(MARKER_OUT_OF_VIEW);
    return;
  }
  took(MARKER_IN_VIEW);
  RAM[OBJECT_COUNT + object]++;
  RAM[OBJECT_COLOURS + object] = (uint8_t)(1 + ((RAM[OBJECT_COUNT + object] >> 2) & 1));
  took(MARKER_BLINKS);
}

// $BA09 in bank 4, kind $10: something to pick up, here Arthur's armour. Its shape and colours come from the copy's
// lists at $BB2D, by which thing it is, and it flashes another colour every fourth round. When Arthur touches the
// armour he has it: his flags say so, the tiles' task sends the armoured Arthur's tiles, and the object is gone. The
// other things, at $BA99 and $BAAC, and the kinds $F708 keeps
// after they're picked up aren't ported yet.
static void pick_up(uint8_t object) {
  enum { ARMOUR = 5, WITHOUT_ARMOUR = 0x20 };
  RAM[OBJECT_COUNT + object]++;
  took(PICK_UP_BEGINS);
  show_object(object);
  if (!object_in_view(object)) {
    // $BA14: hidden while it's out of the view. What the third set of stages does with it then, at $BB72, isn't ported yet.
    took(PICK_UP_HIDES);
    if (object >= 0x10) took(READ_PAST_PAGE);   // its flags, hidden and read, are in the next page
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
    took(PICK_UP_OUT_OF_VIEW);
    if (object >= 0x10) took(READ_PAST_PAGE);
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
  if (!touched && object >= 0x10) took(READ_PAST_PAGE);
  if (touched && thing < 4) {
    // $BAAC: the four things that only give points, from the copy's list at $BB57, with their sound
    uint16_t points = (uint16_t)(0xBB57 + thing * 4);
    RAM[0x25] = peek(points);
    RAM[0x24] = peek((uint16_t)(points + 1));
    RAM[0x27] = peek((uint16_t)(points + 2));
    RAM[0x26] = peek((uint16_t)(points + 3));
    took(PICK_UP_BONUS);
    add_score_with_thousands(object, (uint8_t)(thing * 4));
    took(PICK_UP_BONUS_SOUND);
    sound_play(0x21);
    took(JUMPS);
    remove_object(object);
    return;
  }
  if (!touched || thing != ARMOUR) return;
  if (!SCENE_PLAYING) {
    // $BA83: outside the opening scene it has a sound
    took(PICK_UP_ARMOUR_SOUND);
    sound_play(0x14);
  }
  took(PICK_UP_ARMOUR_TAKEN);
  RAM[OBJECT_FLAGS + ARTHUR] &= (uint8_t)~WITHOUT_ARMOUR;
  TILES_FIRST_LIST = 0;
  RAM[0xD6] = RAM[0xD7] = RAM[0xD8] = RAM[0xD9] = 0xFF;
  RAM[0x0647 + object] = 0;
  RAM[OBJECT_FLAGS + object] = 0;
}

// $F367, the objects' task: sub_04_9CC8 runs every object but the first, by its kind.
wait objects_task(void) {
  enum { FIRST_TURN, LATER };
  if (task_step[TASK_OBJECTS] == LATER) took(OBJECTS_AGAIN);
  task_step[TASK_OBJECTS] = LATER;
  took(OBJECTS_BEGINS);
  switch_bank(4);
  took(OBJECTS_BANK_SET);
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
        case 0x01: plant(object); break;
        case 0x02: flier(object); break;
        case 0x03: knight(object); break;
        case 0x04: forest_enemy(object); break;
        case 0x05: boss(object); break;
        case 0x06: devil(object); break;
        case 0x07: window_thing(object); break;
        case 0x08: big_man(object); break;
        case 0x2F: thrown(object); break;
        case 0x0C: lift(object); break;
        case 0x0E: platform(object); break;
        case 0x13: water_crow(object); break;
        case 0x10: pick_up(object); break;
        case 0x11: hidden_thing(object); break;
        case 0x12: pot(object); break;
        case 0x14: crow(object); break;
        case 0x1E: key(object); break;
        case 0x20: gravestone(object); break;
        case 0x2B: plant_shot(object); break;
        case 0x29: forest_shot(object); break;
        case 0x2C: flier_shot(object); break;
        case 0x30: boss_shot(object); break;
        case 0x22: map_marker(object); break;
        case 0x36: rising_thing(object); break;
        case 0x37: falling_thing(object); break;
        case LANCE: case DAGGER: weapon(object); break;
        case 0x33: princess(object); break;
        case 0x34: satan(object); break;
      }
      place_on_screen(object);
    }
    took(OBJECT_NEXT);
    took(object < 0x15 ? GOES_ROUND : GOES_ON);
  }
  took(OBJECTS_END);
  switch_bank(BANK_HOME);
  took(OBJECTS_BANK_BACK);
  return YIELDS;
}
