// Ghosts'n Goblins Dreamport: the cave's dragon, the third stage's boss, from the original's code in bank 4. Its head,
// kind $15, flies round a loop of 32 places in the view, and eight pieces of its body, kinds $16 to $1D, each follow
// the one ahead. The stage's list places all nine at once ($D740, flow.c), and keeps their numbers at $06FE on.
//
// A hit on any piece burns away the last one, for 200 points. The head takes six hits, not counting the lance's, and
// then burns away for 1,000 points, and the pieces left with it. The head breathes fire, kind $28, at Arthur.
// What the fifth set of stages adds, at $B0E9, $B1B6 and $B35B, isn't ported yet.

#include "game.h"

enum { ARTHUR = 0, BURNING = 0x01, AWAKE = 0x08, MOUTH_OPEN = 0x10, HEAD = 0x15, PARTS = 0x06FE, FIRE = 0x28 };
#define HITS(object) RAM[0x0647 + (object)]

static void flag_read(uint8_t object) {
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
}
static void change_flag(uint8_t object, uint8_t which, int set) {
  if (set) RAM[OBJECT_FLAGS + object] |= which;
  else RAM[OBJECT_FLAGS + object] &= (uint8_t)~which;
  took(OBJECT_FLAG_CHANGED);
  if (object >= 0x10) took(READ_PAST_PAGE);
}

// sub_EF25 from $73, $77, $74, $78 (the first place) to $75, $79, $76, $7A (the second): an object's way to a place.
static void first_place(uint8_t y, uint8_t y_screen, uint8_t x, uint8_t x_screen) {
  RAM[0x73] = y; RAM[0x77] = y_screen; RAM[0x74] = x; RAM[0x78] = x_screen;
}
static void second_place(uint8_t object) {
  RAM[0x75] = RAM[OBJECT_Y + object]; RAM[0x79] = RAM[OBJECT_Y_SCREEN + object];
  RAM[0x76] = RAM[OBJECT_X + object]; RAM[0x7A] = RAM[OBJECT_X_SCREEN + object];
}

// $B184: the head heads for the place in its loop that its state picks, from the copy's lists at $B2E7 (down) and
// $B307 (across) in the view, and on to the next once it's within 16 pixels of it both ways.
static void head_flies(uint8_t object) {
  uint8_t *state = &RAM[OBJECT_STATE + object];
  if (*state >= 0x19) took(READ_PAST_PAGE);   // $B2E7 on, from the 26th place, is in the next page
  uint8_t down = (uint8_t)(cart(4, (uint16_t)(0xB2E7 + *state)) - RAM[OBJECT_SCREEN_Y + object]);
  int near = 1;
  if (down >= 0xF0) took(DRAGON_POINT_LEVEL_ABOVE);
  else if (down >= 0x10) { took(DRAGON_POINT_FAR_DOWN); near = 0; }
  else took(DRAGON_POINT_LEVEL_BELOW);
  if (near) {
    uint8_t across = (uint8_t)(cart(4, (uint16_t)(0xB307 + *state)) - RAM[OBJECT_SCREEN_X + object]);
    if (across >= 0xF0) took(DRAGON_POINT_ACROSS_LEFT);
    else if (across >= 0x10) { took(DRAGON_POINT_FAR_ACROSS); near = 0; }
    else took(DRAGON_POINT_ACROSS_RIGHT);
  }
  if (near) {
    *state = (uint8_t)((*state + 1) & 0x1F);
    took(DRAGON_POINT_NEXT);
  }
  took(DRAGON_POINT_NOT_FIFTH);
  if (*state >= 0x19) took(READ_PAST_PAGE);
  // the place, as a screen and a pixel down and across, from the view's at $67 and $64
  uint16_t y = (uint16_t)(cart(4, (uint16_t)(0xB2E7 + *state)) + RAM[0x67]);
  uint8_t y_low = (uint8_t)y, y_screen = (uint8_t)(RAM[0x68] + (y >> 8));
  if (y_low >= 0xF0) {
    took(DRAGON_PLACE_PAST_SCREEN);
    y = (uint16_t)(y_low + 0x10); y_low = (uint8_t)y; y_screen = (uint8_t)(y_screen + (y >> 8));
  } else if (RAM[0x68] != y_screen) {
    took(DRAGON_PLACE_NEXT_SCREEN);
    y = (uint16_t)(y_low + 0x10); y_low = (uint8_t)y; y_screen = (uint8_t)(y_screen + (y >> 8));
  } else took(DRAGON_PLACE_SAME_SCREEN);
  uint16_t x = (uint16_t)(cart(4, (uint16_t)(0xB307 + *state)) + RAM[0x64]);
  first_place(y_low, y_screen, (uint8_t)x, (uint8_t)(RAM[0x65] + (x >> 8)));
  second_place(object);
  took(DRAGON_PLACES);
  RAM[OBJECT_HEADING + object] = way_to_first();
  took(DRAGON_HEADS);
  move_object(object, (uint8_t)(0x16 + RAM[0xD2]));
}

// $B24B: facing Arthur, every 64th round, it breathes fire at him from the 21st or 22nd object, unless he's within 48
// pixels to its left, or 48 or more away up or down. Its mouth opens with the fire.
static void head_breathes(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  (*count)++;
  took(DRAGON_COUNTS);
  flag_read(object);
  if (RAM[OBJECT_FLAGS + object] & MOUTH_OPEN) {
    if (*count < 3) {
      RAM[OBJECT_SHAPE + object]++;
      took(DRAGON_MOUTH_OPENS);
      return;
    }
    took(DRAGON_MOUTH_CLOSES);
    change_flag(object, MOUTH_OPEN, 0);   // sub_F33A
  } else took(DRAGON_MOUTH_SHUT);
  if (*count & 0x3F) { took(DRAGON_NOT_TIME); return; }
  took(DRAGON_FIRE_TIME);
  // each test is a subtraction and two comparisons: past $D0, passed, or the other way, by the second
  uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + object] - RAM[OBJECT_SCREEN_X + ARTHUR]);
  if (across >= 0xD0) took(DRAGON_FIRE_TEST_PAST_D0);
  else if (across < 0x30) { took(DRAGON_FIRE_TEST_FAILS); return; }
  else took(DRAGON_FIRE_TEST_PASSES);
  uint8_t down = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + ARTHUR]);
  if (down >= 0xD0) took(DRAGON_FIRE_TEST_PAST_D0);
  else if (down >= 0x30) { took(DRAGON_FIRE_TEST_FAILS); return; }
  else took(DRAGON_FIRE_TEST_PASSES);
  uint8_t fire = 0x14;
  if (!RAM[OBJECT_FLAGS + fire]) took(DRAGON_FIRE_FIRST_SLOT);
  else if (!RAM[OBJECT_FLAGS + ++fire]) took(DRAGON_FIRE_SECOND_SLOT);
  else { took(DRAGON_FIRE_NO_SLOT); return; }
  RAM[OBJECT_X + fire] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + fire] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_Y + fire] = RAM[OBJECT_Y + object];
  RAM[OBJECT_Y_SCREEN + fire] = RAM[OBJECT_Y_SCREEN + object];
  second_place(object);
  first_place(RAM[OBJECT_Y + ARTHUR], RAM[OBJECT_Y_SCREEN + ARTHUR], RAM[OBJECT_X + ARTHUR], RAM[OBJECT_X_SCREEN + ARTHUR]);
  took(DRAGON_FIRE_MADE);
  uint8_t way = way_to_first();
  took(DRAGON_FIRE_HEADED);
  RAM[OBJECT_HEADING + fire] = (uint8_t)((way & 0x0C) | 0x04);
  took(DRAGON_FIRE_STORE);
  RAM[OBJECT_FLAGS + fire] = 0x40;
  took(DRAGON_FIRE_STORE);
  RAM[OBJECT_KIND + fire] = FIRE;
  took(DRAGON_FIRE_MOUTH);
  RAM[OBJECT_SHAPE + object]++;
  change_flag(object, AWAKE, 1);   // sub_F311
  *count = 0;
  took(DRAGON_FIRE_DONE);
}

// $B327: the head's sixth hit. Every piece left burns away with it, the stage's music stops, and it's worth 1,000.
static void head_dies(uint8_t object) {
  RAM[OBJECT_COUNT + object] = 0;
  RAM[0x070A] = 0x0D;   // sub_F7A5: the sound of its death, and the one that follows
  RAM[0x070B] = 0x20;
  took(DRAGON_DIES);
  sound_play(0x13);
  RAM[0xE8] = RAM[0x0719] = 0xFF;
  took(DRAGON_DIES_QUIET);
  uint8_t y = 0;
  for (uint8_t part = 1; part < 9; part++) {
    y = RAM[PARTS + part];
    if (part >= 2) took(READ_PAST_PAGE);   // $06FE on, from the third, is in the next page
    if (RAM[OBJECT_KIND + y] < HEAD) took(DRAGON_DIES_PART_GONE);
    else {
      HITS(y) = 1;
      took(DRAGON_DIES_PART_HIT);
    }
    took(part < 8 ? DRAGON_DIES_NEXT : DRAGON_DIES_LAST);
  }
  object = RAM[PARTS];
  RAM[0x24] = 1;
  took(DRAGON_DIES_BURNS);
  change_flag(object, BURNING, 1);   // sub_F305
  RAM[0x27] = RAM[0x26] = RAM[0x25] = 0;
  took(DRAGON_DIES_SCORE);
  add_score_with_thousands(object, y);
  took(JUMPS);
  enemy_burns_away(object);
}

// sub_04_B0E3, kind $15: the head. Asleep, it wakes when Arthur comes within 32 pixels, or after 64 rounds in the view.
void dragon_head(uint8_t object) {
  took(DRAGON_NOT_FIFTH_SET);
  flag_read(object);
  if (RAM[OBJECT_FLAGS + object] & BURNING) { took(DRAGON_BURNING); enemy_burns_away(object); return; }
  took(DRAGON_ALIVE);
  if (!object_in_view(object)) {
    took(DRAGON_HEAD_OUT_OF_VIEW);
    hide_object(object);
    flag_read(object);
    if (!(RAM[OBJECT_FLAGS + object] & AWAKE)) { took(DRAGON_HEAD_ASLEEP_AWAY); return; }
    took(DRAGON_HEAD_AWAKE_AWAY);
  } else {
    took(DRAGON_HEAD_IN_VIEW);
    show_object(object);
    RAM[0x27] = 6;
    RAM[0x26] = 8;
    took(DRAGON_HEAD_BOX);
    int arthur_touched;
    uint8_t weapon = enemy_spark_tests(object, &arthur_touched);
    if (!weapon && !arthur_touched) took(DRAGON_NOT_TOUCHED);
    else {
      if (arthur_touched) took(DRAGON_TOUCHED_ARTHUR);
      else if (RAM[OBJECT_KIND + weapon] != LANCE) took(DRAGON_HIT);
      else {
        // the lance's hit doesn't count, and it's gone at once
        took(DRAGON_HIT_BY_LANCE);
        HITS(object)--;
        took(DRAGON_LANCE_SPARKS);
        RAM[OBJECT_FLAGS + weapon] = 0x45;
        took(DRAGON_LANCE_SPARKED);
      }
      change_flag(object, AWAKE, 1);   // sub_F311
    }
    if (!HITS(object)) took(DRAGON_UNHIT);
    else if (HITS(object) >= 6) {
      took(DRAGON_HEAD_KILLED);
      head_dies(object);
      return;
    } else {
      took(DRAGON_HITS_COUNTED);
      change_flag(object, AWAKE, 1);   // sub_F311
    }
  }
  // $B153
  RAM[0xE8] = 0x19;
  RAM[0xE9] = 0x30;
  took(DRAGON_MUSIC);
  flag_read(object);
  if (RAM[OBJECT_FLAGS + object] & AWAKE) took(DRAGON_AWAKE);
  else {
    RAM[0x26] = RAM[0x27] = 0x20;
    took(DRAGON_ASLEEP);
    if (arthur_near(object)) took(DRAGON_WAKES);
    else {
      uint8_t *count = &RAM[OBJECT_COUNT + object];
      took(DRAGON_WAITS);
      if (++*count < 0x40) { took(DRAGON_STILL_WAITS); return; }
      took(DRAGON_WAITED);
    }
    change_flag(object, AWAKE, 1);   // sub_F311
    RAM[OBJECT_COUNT + object] = RAM[OBJECT_STATE + object] = 0;
    took(DRAGON_WOKEN);
  }
  head_flies(object);
  // $B222: its shape by its heading, facing right or left, and the rest only while it faces Arthur
  uint8_t heading = RAM[OBJECT_HEADING + object];
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (!(heading & 0x0C)) took(DRAGON_SHAPE_KEPT);
  else {
    took(DRAGON_SHAPE_SET);
    RAM[OBJECT_SHAPE + object] = (uint8_t)(0x97 + ((heading & 0x08) << 1));
    took(DRAGON_SHAPE_STORED);
  }
  int left = RAM[OBJECT_SHAPE + object] >= 0xA7;
  if (arthur_is_right_of(object)) {
    if (left) { took(DRAGON_FACES_AWAY_RIGHT); return; }
    took(DRAGON_FACES_HIM_RIGHT);
  } else {
    if (!left) { took(DRAGON_FACES_AWAY_LEFT); return; }
    took(DRAGON_FACES_HIM_LEFT);
  }
  head_breathes(object);
}

// $B3A8 and $B3E3: from part `from` back to the head, the first that's still there: of the dragon's kinds, in use and
// not burning. The original leaves the last it looked at in Y, which is what's answered when none is.
static uint8_t part_left(uint8_t from, int *found, int backwards_to_head) {
  uint8_t y = 0;
  for (int part = from; backwards_to_head ? part >= 0 : part > 0; part--) {
    RAM[0x22] = (uint8_t)part;
    y = RAM[PARTS + part];
    if (part >= 2) took(READ_PAST_PAGE);
    uint8_t flags = RAM[OBJECT_FLAGS + y];
    if (RAM[OBJECT_KIND + y] < HEAD) took(DRAGON_PART_OTHER_KIND);
    else {
      if (y >= 0x10) took(READ_PAST_PAGE);
      if (!flags) took(DRAGON_PART_FREE);
      else if (flags & BURNING) took(DRAGON_PART_BURNING);
      else {
        took(backwards_to_head ? DRAGON_PART_AHEAD_FOUND : DRAGON_PART_LAST_FOUND);
        *found = 1;
        return y;
      }
    }
    took(part > (backwards_to_head ? 0 : 1) ? DRAGON_PART_LOOKS_ON : DRAGON_PART_LOOKED);
  }
  RAM[0x22] = backwards_to_head ? 0xFF : 0;
  *found = 0;
  return y;
}

// sub_04_B355, kinds $16 to $1D: a piece of the dragon's body, shown only in the view, which follows the piece ahead
// of it once it's 12 pixels away. It waits while the head sleeps, and is gone, for 200 points, once all ahead are.
void dragon_piece(uint8_t object) {
  took(DRAGON_NOT_FIFTH_SET);
  flag_read(object);
  if (RAM[OBJECT_FLAGS + object] & BURNING) { took(DRAGON_BURNING); enemy_burns_away(object); return; }
  took(DRAGON_PIECE_ALIVE);
  RAM[OBJECT_SHAPE + object] = 0x99;
  took(DRAGON_PIECE_SHAPED);
  hide_object(object);
  if (object_in_view(object)) {
    took(DRAGON_PIECE_IN_VIEW);
    show_object(object);
  } else took(DRAGON_PIECE_AWAY);
  uint8_t head = RAM[PARTS];
  if (head >= 0x10) took(READ_PAST_PAGE);
  if (!RAM[OBJECT_FLAGS + head]) {
    took(DRAGON_HEAD_GONE);
    RAM[OBJECT_FLAGS + object] = 0;
    took(DRAGON_HEAD_GONE_STORED);
  } else if (RAM[OBJECT_FLAGS + head] & AWAKE) took(DRAGON_HEAD_AWAKE);
  else { took(DRAGON_HEAD_ASLEEP_PIECE); return; }
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN) {
    RAM[0x26] = RAM[0x27] = 8;
    took(DRAGON_PIECE_TESTS);
    int arthur_touched;
    enemy_touch_tests(object, &arthur_touched);
  } else took(DRAGON_PIECE_HIDDEN);
  int found;
  if (HITS(object)) {
    // $B3A1: hit, the last piece left burns away
    took(DRAGON_PIECE_HIT);
    sound_play(0x16);
    took(DRAGON_TAIL_SEARCH);
    uint8_t last = part_left(8, &found, 0);
    if (last >= 0x10) took(READ_PAST_PAGE);
    took(DRAGON_TAIL_BURNS);
    RAM[OBJECT_FLAGS + last] |= BURNING;
    took(DRAGON_TAIL_HITS);
    HITS(object) = 0;
    took(DRAGON_TAIL_COUNT);
    RAM[OBJECT_COUNT + last] = 0;
    RAM[0x26] = 0;
    RAM[0x27] = 2;
    took(DRAGON_TAIL_SCORE);
    add_score(object, last);
    return;
  }
  took(DRAGON_PIECE_UNHIT);
  took(DRAGON_FOLLOW_BEGINS);
  uint8_t ahead = part_left((uint8_t)(RAM[OBJECT_KIND + object] - 0x16), &found, 1);
  if (!found) {
    RAM[0x27] = 2;
    RAM[OBJECT_FLAGS + object] = 0;
    RAM[0x26] = 0;
    took(DRAGON_PIECE_LEFT_ALONE);
    add_score(object, ahead);
    return;
  }
  // $B40B: towards the piece ahead, once it's 12 pixels away or more, down or across
  first_place(RAM[OBJECT_Y + ahead], RAM[OBJECT_Y_SCREEN + ahead], RAM[OBJECT_X + ahead], RAM[OBJECT_X_SCREEN + ahead]);
  second_place(object);
  took(DRAGON_FOLLOW_PLACES);
  uint8_t down = (uint8_t)(RAM[0x73] - RAM[0x75]), across = (uint8_t)(RAM[0x74] - RAM[0x76]);
  int far;
  if (down >= 0xF4) { took(DRAGON_FOLLOW_LEVEL_ABOVE); far = 0; }
  else if (down >= 0x0C) { took(DRAGON_FOLLOW_FAR_DOWN); far = 1; }
  else { took(DRAGON_FOLLOW_LEVEL_BELOW); far = 0; }
  if (!far) {
    if (across >= 0xF4) took(DRAGON_FOLLOW_LEVEL_LEFT);
    else if (across < 0x0C) took(DRAGON_FOLLOW_LEVEL_RIGHT);
    else { took(DRAGON_FOLLOW_FAR_ACROSS); far = 1; }
  }
  if (far) {
    took(CALLS);
    RAM[OBJECT_HEADING + object] = way_to_first();
    took(DRAGON_FOLLOW_HEADED);
  }
  took(DRAGON_FOLLOW_MOVES);
  move_object(object, (uint8_t)(0x16 + RAM[0xD2]));
}
