// Ghosts'n Goblins Dreamport: the second stage's apartments, the fifth part of its stages, from the original's code
// at sub_02_8574, which makes kind 7 as Arthur nears them, and sub_04_AA4F, kind 7: a small white thing that comes
// out of a window of the town's houses. It waits its count once in the view, rises out of the window in six steps,
// faces Arthur, drops to his height, runs 16 rounds, hops twice with a turn between, and then runs on until it's out
// of the view, where it's gone. One hit kills it, for 100 points.
//
// Kind 8, sub_04_ABC1, is the big man of each of the apartments' floors. It walks its floor, turning where the floor
// ends or a wall is, a stretch at a time by the copy's lists at $AE69 and $AE79. When Arthur is near below it stops and
// throws kind $2F down at him; on Arthur's own floor it faces him and throws along the floor. A weapon that hits it
// sparks, and ten hits kill it, for 500 points.

#include "game.h"

enum { ARTHUR = 0, KIND_7 = 7, IN_USE = 0x40 };
// kind 7's flags: hit, drawn turned round, out of its window, risen, and the mode, $10 running, $20 hopping, both off
enum { HIT = 0x01, TURNED = 0x02, OUT = 0x04, RISEN = 0x08, RUNS = 0x10, HOPS = 0x20, MODE = 0x30 };
#define HITS(object) RAM[0x0647 + (object)]
#define SPEED_ADDED RAM[0xD3]
#define MADE RAM[0xE2]                 // how many kind 7 this stage has made, three at most
#define ROUNDS_TO_NEXT RAM[0xEA]       // the count the stage's makers share,
#define ROUNDS_BETWEEN RAM[0x5B]       // which comes sooner the harder the game is,
#define PLACE RAM[0xC0]                // and the place in their lists the last one took
#define LEFT_TO_MAKE RAM[0x22]

/** sub_02_8574: in the stage's fifth part, while Arthur is from $04E0 to $05C0 across, a count runs down, and at its
 *  end the kind 7 not made yet come, each 32 rounds after the last, at the next of the copy's 16 places at $85F0 on the
 *  sixth screen. */
void apartments_come(uint8_t *x) {
  if (MADE >= 3) { took(KIND_7_ALL_MADE); return; }
  if (RAM[0xC2] != 4) { took(KIND_7_OTHER_PART); return; }
  took(KIND_7_LOOKED_AT);
  uint16_t across = (uint16_t)(RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]);
  if (across < 0x04E0) { took(KIND_7_BEFORE); return; }
  if (across >= 0x05C0) { took(KIND_7_PAST); return; }
  took(KIND_7_IN_RANGE);
  if (--ROUNDS_TO_NEXT) { took(KIND_7_NOT_YET); return; }
  ROUNDS_TO_NEXT = (uint8_t)(0x50 - ROUNDS_BETWEEN);
  LEFT_TO_MAKE = (uint8_t)(3 - MADE);
  took(KIND_7_COME);
  do {
    took(CALLS);
    uint8_t object = free_object();
    if (object == NO_OBJECT) { took(KIND_7_NONE_FREE); return; }
    RAM[OBJECT_FLAGS + object] = IN_USE;
    RAM[OBJECT_KIND + object] = KIND_7;
    RAM[0x0647 + object] = 0;
    RAM[OBJECT_COUNT + object] = (uint8_t)(LEFT_TO_MAKE << 5);
    MADE++;
    took(KIND_7_SET_UP);
    PLACE = (PLACE + 1) & 0x0F;
    took(ZOMBIE_PLACE_CHOSEN);
    *x = (uint8_t)(PLACE * 2);
    RAM[OBJECT_X + object] = cart(2, (uint16_t)(0x85F0 + *x));
    RAM[OBJECT_X_SCREEN + object] = 5;
    RAM[OBJECT_Y + object] = cart(2, (uint16_t)(0x85F1 + *x));
    RAM[OBJECT_Y_SCREEN + object] = 1;
    took(KIND_7_PLACED);
    sixth_carries_a_pot(object, x);
    took(--LEFT_TO_MAKE ? KIND_7_NEXT : KIND_7_LAST);
  } while (LEFT_TO_MAKE);
}

// Every read of an object's flags from the sixteenth on, and of its heading from the fifteenth, crosses a page.
static void flags_read(uint8_t object) { if (object >= 0x10) took(READ_PAST_PAGE); }
static uint8_t flag(uint8_t object, uint8_t which) {
  took(OBJECT_FLAG_READ);
  flags_read(object);
  return RAM[OBJECT_FLAGS + object] & which;
}
static void set_flag(uint8_t object, uint8_t which) {
  RAM[OBJECT_FLAGS + object] |= which;
  took(OBJECT_FLAG_CHANGED);
  flags_read(object);
}
static void clear_flag(uint8_t object, uint8_t which) {
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~which;
  took(OBJECT_FLAG_CHANGED);
  flags_read(object);
}

// $AA93: out of the window, two rounds a step, and after the sixth it faces Arthur.
static void rise(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  ++*count;
  took(WINDOW_RISES);
  if (*count < 6) {
    RAM[OBJECT_SHAPE + object] = (uint8_t)((*count >> 1) + 0x90);
    took(WINDOW_RISING);
    return;
  }
  *count = 0;
  RAM[OBJECT_HEADING + object] = 0x04;
  took(WINDOW_RISEN);
  clear_flag(object, TURNED);
  if (!arthur_is_right_of(object)) {
    RAM[OBJECT_HEADING + object] = 0x0C;
    took(WINDOW_FACES_LEFT);
    set_flag(object, TURNED);
  }
  set_flag(object, RISEN);   // by a jump to sub_F311, whose return is its own
}

// $AAD5: a weapon has hit it: it falls the way the weapon was going, and it's worth 100 points.
static void killed(uint8_t object, uint8_t weapon) {
  took(WINDOW_KILLED);
  clear_flag(object, TURNED);
  RAM[OBJECT_FLAGS + object] |= (RAM[OBJECT_HEADING + weapon] >> 2) & TURNED;
  took(WINDOW_FALL_SIDE);
  if (weapon >= 0x0F) took(READ_PAST_PAGE);
  flags_read(object);
  set_flag(object, HIT);
  if (--MADE & 0x80) { MADE = 0; took(WINDOW_NONE_LEFT); }
  else took(WINDOW_ONE_LESS);
  took(WINDOW_KILLED_SOUND);
  sound_play(0x16);
  set_flag(object, HIT);
  RAM[OBJECT_COUNT + object] = 0;
  RAM[0x26] = 0;
  RAM[0x27] = 1;
  took(WINDOW_KILLED_SCORE);
  add_score(object, weapon);
}

// $AB35: down a screen line at a time, 5 a round, until it's as low as Arthur, and across faster the lower it gets.
static void drop(uint8_t object) {
  uint8_t own = RAM[OBJECT_SCREEN_Y + object];
  if (own >= RAM[OBJECT_SCREEN_Y + ARTHUR]) {
    RAM[OBJECT_COUNT + object] = 0;
    took(WINDOW_LANDS);
    set_flag(object, RUNS);
    return;
  }
  RAM[0x73] = 5;
  RAM[0x77] = 0;
  took(WINDOW_DROPS);
  move_down(object);
  own = RAM[OBJECT_SCREEN_Y + object];
  if (own < 0x78) { took(WINDOW_DROPS_HIGH); move_object(object, 0); return; }
  RAM[0x22] = (uint8_t)((uint8_t)(RAM[OBJECT_SCREEN_Y + ARTHUR] - own) >> 2);
  if (RAM[0x22] <= 0x1C) { took(WINDOW_DROPS_LOW); move_object(object, (uint8_t)(0x1C - RAM[0x22])); return; }
  took(WINDOW_DROPS_LOWEST);
  move_object(object, 0);
}

// $AB88: eight rounds of a hop, up 4 lines a round as it goes, turning round on the fourth, and then it runs off.
static void hop(uint8_t object) {
  uint8_t count = RAM[OBJECT_COUNT + object];
  if (count >= 8) {
    RAM[OBJECT_COUNT + object] = 0;
    RAM[OBJECT_FLAGS + object] |= MODE;
    took(WINDOW_HOPS_OVER);
    flags_read(object);
    return;
  }
  if (count == 4) {
    RAM[OBJECT_HEADING + object] ^= 0x08;
    RAM[OBJECT_FLAGS + object] ^= TURNED;
    took(WINDOW_HOP_TURNS);
    if (object >= 0x0F) took(READ_PAST_PAGE);
    flags_read(object);
  } else took(WINDOW_HOPS);
  RAM[0x73] = 0xFC;
  RAM[0x77] = 0xFF;
  move_down(object);
  took(WINDOW_HOP_MOVES);
  move_object(object, 0x0F);
}

void window_thing(uint8_t object) {
  if (flag(object, HIT)) { took(WINDOW_IS_HIT); hit_enemy_falls(object); return; }
  took(WINDOW_IS_NOT_HIT);
  RAM[OBJECT_COLOURS + object] = 0;
  took(WINDOW_COLOURS);
  if (!flag(object, OUT)) {
    // $AA61: in its window, its count runs down while it's in the view
    took(WINDOW_WAITS);
    if (!object_in_view(object)) { took(WINDOW_WAITS_UNSEEN); return; }
    if (--RAM[OBJECT_COUNT + object]) { took(WINDOW_WAITS_ON); return; }
    took(WINDOW_COMES_OUT);
    set_flag(object, OUT);
    took(WINDOW_COMES_OUT_SOUND);
    sound_play(0x15);
    return;
  }
  took(WINDOW_IS_OUT);
  show_object(object);
  if (object_in_view(object)) took(WINDOW_IN_VIEW);
  else {
    took(WINDOW_OUT_OF_VIEW);
    flags_read(object);
    if ((RAM[OBJECT_FLAGS + object] & MODE) == MODE) {
      // running off, out of the view, it's gone
      if (--MADE & 0x80) { MADE = 0; took(WINDOW_GONE_NONE_LEFT); }
      else took(WINDOW_GONE);
      remove_object(object);
      return;
    }
    took(WINDOW_HIDDEN);
    hide_object(object);
  }
  if (!flag(object, RISEN)) { took(WINDOW_NOT_RISEN); rise(object); return; }
  took(WINDOW_HAS_RISEN);
  RAM[0x26] = RAM[0x27] = 6;
  took(WINDOW_TESTS);
  int arthur_touched;
  uint8_t weapon = enemy_touch_tests(object, &arthur_touched);
  if (HITS(object)) { killed(object, weapon); return; }
  took(WINDOW_NOT_KILLED);
  // $AB04: its two shapes, by its count, one way round or the other
  RAM[OBJECT_COUNT + object]++;
  RAM[OBJECT_SHAPE + object] = 0x93;
  took(WINDOW_MOVES);
  RAM[OBJECT_SHAPE + object] += (RAM[OBJECT_COUNT + object] >> 2) & 1;   // sub_F576
  took(WINDOW_SHAPE_PICKED);
  if (flag(object, TURNED)) { RAM[OBJECT_SHAPE + object] += 0x10; took(WINDOW_SHAPE_TURNED); }
  else took(WINDOW_SHAPE_KEPT);
  flags_read(object);
  switch (RAM[OBJECT_FLAGS + object] & MODE) {
    case 0: took(WINDOW_MODE_DROPS); drop(object); return;
    case RUNS:
      took(WINDOW_MODE_RUNS);
      if (RAM[OBJECT_COUNT + object] >= 0x10) {
        RAM[OBJECT_COUNT + object] = 0;
        took(WINDOW_STOPS_RUNNING);
        clear_flag(object, RUNS);
        set_flag(object, HOPS);   // by a jump to sub_F319
        return;
      }
      took(WINDOW_RUNS);
      move_object(object, (uint8_t)(0x10 + SPEED_ADDED));
      return;
    case HOPS: took(WINDOW_MODE_HOPS); hop(object); return;
    default:
      took(WINDOW_RUNS_OFF);
      move_object(object, (uint8_t)(0x10 + SPEED_ADDED));
      return;
  }
}

// ---- kind 8, the big man, sub_04_ABC1, and kind $2F, what it throws, $F504

enum { BIG_HIT = 0x01, THROWS = 0x02, FACES_LEFT = 0x04, THREW = 0x08, ON_HIS_FLOOR = 0x10, SPARKED = 0x20 };
enum { THROWN = 0x2F };
#define WALK_SPEED_ADDED RAM[0xD2]

// sub_04_AE24: whether its way ahead is shut: no floor under the place 2 pixels ahead, or a wall 8 pixels ahead.
static void block_place(uint8_t object, int16_t ahead, uint8_t down, cost same, cost next) {
  uint16_t x = (uint16_t)((RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]) + ahead);
  RAM[0x74] = (uint8_t)x;
  RAM[0x78] = (uint8_t)(x >> 8);
  RAM[0x77] = RAM[OBJECT_Y_SCREEN + object];
  uint8_t y = (uint8_t)(RAM[OBJECT_Y + object] + down);
  RAM[0x73] = y;
  if (y < 0xF0) { took(same); return; }
  RAM[0x73] = (uint8_t)(y + 0x10);   // past a screen's 240 lines, on the next screen down
  RAM[0x77]++;
  took(next);
}
static int way_shut(uint8_t object) {
  int right = RAM[OBJECT_HEADING + object] == 0x04;
  took(right ? BIG_FLOOR_AHEAD_RIGHT : BIG_FLOOR_AHEAD_LEFT);
  if (object >= 0x0F) took(READ_PAST_PAGE);
  block_place(object, right ? 2 : -2, 0x10, BIG_FLOOR_SAME_SCREEN, BIG_FLOOR_NEXT_SCREEN);   // sub_FFAC or sub_FFBE
  if (block_at_stage_place() < BLOCK_SOLID) { took(BIG_NO_FLOOR); return 1; }
  took(right ? BIG_WALL_AHEAD_RIGHT : BIG_WALL_AHEAD_LEFT);
  block_place(object, right ? 8 : -8, 4, BIG_WALL_SAME_SCREEN, BIG_WALL_NEXT_SCREEN);         // sub_E9F1 or sub_EA01
  if (block_at_stage_place() >= BLOCK_SOLID) { took(BIG_WALL); return 1; }
  took(right ? BIG_NO_WALL_RIGHT : BIG_NO_WALL_LEFT);
  return 0;
}

// sub_04_AE4D: a throw, in the 21st or 22nd object when one is free, from its place.
static uint8_t throw_one(uint8_t object) {
  uint8_t shot;
  took(BIG_THROW_LOOKS);
  if (!RAM[OBJECT_FLAGS + 0x14]) { shot = 0x14; took(BIG_THROW_FIRST_FREE); }
  else if (!RAM[OBJECT_FLAGS + 0x15]) { shot = 0x15; took(BIG_THROW_SECOND_FREE); }
  else { took(BIG_THROW_NONE_FREE); return 0; }
  // sub_FA2E: its place, in the stage and on the screen
  RAM[OBJECT_Y + shot] = RAM[OBJECT_Y + object];
  RAM[OBJECT_Y_SCREEN + shot] = RAM[OBJECT_Y_SCREEN + object];
  RAM[OBJECT_SCREEN_Y + shot] = RAM[OBJECT_SCREEN_Y + object];
  RAM[OBJECT_X + shot] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + shot] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_SCREEN_X + shot] = RAM[OBJECT_SCREEN_X + object];
  RAM[OBJECT_FLAGS + shot] = IN_USE;
  took(BIG_THROW_PLACED);
  RAM[OBJECT_KIND + shot] = THROWN;
  took(BIG_THROW_KIND);
  set_flag(object, THREW);
  took(BIG_THROW_MADE);
  return shot;
}

// $AD45: the throwing shape, which sub_F30D's call there leaves turned: its arm up for four rounds after a throw.
static void throwing_shape(uint8_t object) {
  RAM[OBJECT_SHAPE + object] = 0xD3;
  took(BIG_THROWING_SHAPE);
  set_flag(object, FACES_LEFT);
  RAM[OBJECT_SHAPE + object] = 0xE3;
  took(BIG_THROWING_SHAPE_TURNED);
  if (!flag(object, THREW)) { took(BIG_ARM_DOWN); return; }
  uint8_t count = RAM[OBJECT_COUNT + object];
  if ((count & 3) == 3) { took(BIG_ARM_COMES_DOWN); clear_flag(object, THREW); return; }   // by a jump
  RAM[OBJECT_SHAPE + object]++;
  took(BIG_ARM_UP);
}

// $AD17: it has stopped over Arthur, and throws down at him every 32 rounds while he's below it and near.
static void throws_down(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) { took(OBJECT_SHOWN_READ); flags_read(object); took(BIG_NOT_SHOWN); throwing_shape(object); return; }
  took(OBJECT_SHOWN_READ);
  flags_read(object);
  if (*count & 0x1F) { took(BIG_NOT_TIME_TO_THROW); throwing_shape(object); return; }
  if (RAM[OBJECT_SCREEN_Y + object] >= RAM[OBJECT_SCREEN_Y + ARTHUR]) { took(BIG_ARTHUR_NOT_BELOW); throwing_shape(object); return; }
  RAM[0x27] = 0x80;
  RAM[0x26] = 0x10;
  took(BIG_LOOKS_BELOW);
  if (!arthur_near(object)) { took(BRANCH_TAKEN); throwing_shape(object); return; }
  ++*count;
  took(BIG_THROWS_DOWN);
  uint8_t shot = throw_one(object);
  if (!shot) { took(BRANCH_TAKEN); throwing_shape(object); return; }
  RAM[OBJECT_HEADING + shot] = 0x08;
  took(BIG_THROWN_DOWN);
  throwing_shape(object);
}

// $ACAE: it walks its floor, a stretch at a time, turning where the way is shut, and stops over Arthur when he's near below.
static void walks(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object], *heading = &RAM[OBJECT_HEADING + object];
  if (flag(object, THROWS)) { took(BIG_WALK_THROWS); throws_down(object); return; }
  took(BIG_WALKS);
  if (way_shut(object)) {
    RAM[OBJECT_FLAGS + object] ^= FACES_LEFT;
    took(BIG_TURNS);
    flags_read(object);
  } else took(BRANCH_TAKEN);
  *heading = 0x04;
  took(BIG_HEADS);
  if (flag(object, FACES_LEFT)) { *heading = 0x0C; took(BIG_HEADS_LEFT); }
  else took(BRANCH_TAKEN);
  if (*count & 7) took(BIG_NOT_LOOKING);
  else {
    RAM[0x26] = 0x10;
    RAM[0x27] = 0x60;
    took(BIG_LOOKS);
    if (!arthur_near(object)) took(BRANCH_TAKEN);
    else {
      *count = RAM[0x83] & 0x0F;
      took(BIG_STOPS_OVER_HIM);
      set_flag(object, THROWS);
    }
  }
  took(BIG_STEPS);
  move_object(object, (uint8_t)(6 + WALK_SPEED_ADDED));
  RAM[OBJECT_SHAPE + object] = 0xD0;
  took(BIG_WALK_SHAPE);
  if (flag(object, FACES_LEFT)) { RAM[OBJECT_SHAPE + object] = 0xE0; took(BIG_WALK_SHAPE_LEFT); }
  else took(BRANCH_TAKEN);
  RAM[OBJECT_SHAPE + object] += (*count >> 3) & 1;
  took(BIG_WALK_STEP_SHAPE);
}

// $AC58: a new stretch: its length and its side from the lists, by its own number and a count of stretches. On the
// second stage it keeps right before the seventh screen, and left from the middle of the ninth.
static void new_stretch(uint8_t object) {
  uint8_t *state = &RAM[OBJECT_STATE + object];
  *state = (*state + 1) & 0x0F;
  uint8_t i = (uint8_t)((object + *state) & 0x0F);
  RAM[OBJECT_COUNT + object] = cart(4, (uint16_t)(0xAE79 + i));
  RAM[OBJECT_HEADING + object] = 0x04;
  RAM[OBJECT_FLAGS + object] = (uint8_t)((RAM[OBJECT_FLAGS + object] & 0xF9) | cart(4, (uint16_t)(0xAE69 + i)));
  took(BIG_NEW_STRETCH);
  flags_read(object);
  if (RAM[0xCF] != 1) took(BIG_STRETCH_OTHER_SET);
  else {
    uint8_t screen = RAM[OBJECT_X_SCREEN + object];
    if (screen < 6) { took(BIG_STRETCH_EARLY); clear_flag(object, FACES_LEFT); }
    else if (screen != 8) took(BIG_STRETCH_MIDDLE);
    else if (RAM[OBJECT_X + object] < 0x80) took(BIG_STRETCH_NINTH_LEFT);
    else { took(BIG_STRETCH_NINTH_RIGHT); set_flag(object, FACES_LEFT); took(JUMPS); }
  }
  flags_read(object);
  if (RAM[OBJECT_FLAGS + object] & FACES_LEFT) { RAM[OBJECT_HEADING + object] = 0x0C; took(BIG_STRETCH_LEFT); }
  else took(BIG_STRETCH_RIGHT);
}

// $AD69: on Arthur's floor it faces him, throws along the floor every 16 rounds, and walks at him while the way is open.
static void on_his_floor(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object], *heading = &RAM[OBJECT_HEADING + object], *shape = &RAM[OBJECT_SHAPE + object];
  took(OBJECT_SHOWN_READ);
  flags_read(object);
  uint8_t shown = RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN;
  uint8_t apart = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + ARTHUR]);
  if (!shown || (apart < 0xE8 && apart >= 0x20)) {
    *count = 0;
    took(shown ? BIG_LEAVES_HIS_FLOOR : BIG_LEAVES_UNSEEN);
    clear_flag(object, ON_HIS_FLOOR);   // by a jump
    return;
  }
  took(apart >= 0xE8 ? BIG_ON_HIS_FLOOR_ABOVE : BIG_ON_HIS_FLOOR_BELOW);
  ++*count;
  if (*count & 0x0F) took(BIG_NOT_TIME_TO_THROW_ALONG);
  else {
    took(BIG_THROWS_ALONG);
    uint8_t shot = throw_one(object);
    if (!shot) took(BRANCH_TAKEN);
    else {
      RAM[OBJECT_HEADING + shot] = *heading;
      took(BIG_THROWN_ALONG);
      if (object >= 0x0F) took(READ_PAST_PAGE);
    }
  }
  if (*count & 3) {
    *shape = 0xD0;
    took(BIG_KEEPS_FACING);
    if (object >= 0x0F) took(READ_PAST_PAGE);
    if (*heading == 0x04) took(BRANCH_TAKEN);
    else { *shape = 0xE0; took(BIG_KEEPS_FACING_LEFT); }
  } else {
    *heading = 0x04;
    *shape = 0xD0;
    took(BIG_FACES_HIM);
    if (arthur_is_right_of(object)) took(BRANCH_TAKEN);
    else { *heading = 0x0C; *shape = 0xE0; took(BIG_FACES_HIM_LEFT); }
  }
  *shape += (*count >> 2) & 1;
  took(BIG_FLOOR_SHAPE);
  if (flag(object, SPARKED)) {
    if ((*count & 7) == 4) { took(BIG_SPARK_OVER); clear_flag(object, SPARKED); return; }   // by a jump
    *shape = (uint8_t)((*shape & 0xFE) + 5);
    took(BIG_SPARK_SHAPE);
    return;
  }
  took(BIG_NOT_SPARKED);
  if (flag(object, THREW)) {
    if ((*count & 3) == 3) { took(BIG_FLOOR_ARM_COMES_DOWN); clear_flag(object, THREW); }
    else took(BIG_FLOOR_ARM_UP);
    *shape = (uint8_t)((*shape & 0xFE) + 2);
    took(BIG_FLOOR_THROW_SHAPE);
    return;
  }
  took(BIG_FLOOR_NOT_THROWING);
  if (way_shut(object)) { took(BIG_FLOOR_WAY_SHUT); return; }
  took(BIG_FLOOR_STEPS);
  move_object(object, (uint8_t)(0x0C + WALK_SPEED_ADDED));
}

void big_man(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object];
  uint8_t set = RAM[0xCF];
  if (set == 4 || set == 5) {
    // on the fourth and fifth sets of stages it's gone once $DF is 3
    took(set == 4 ? BIG_FOURTH_SET : BIG_FIFTH_SET);
    if (RAM[0xDF] == 3) { took(BIG_GONE_THERE); remove_object(object); return; }
    took(BIG_STAYS_THERE);
  } else took(BIG_THIS_SET);
  RAM[OBJECT_COLOURS + object] = 0x02;
  took(BIG_COLOURS);
  show_object(object);
  if (object_in_view(object)) took(BIG_IN_VIEW);
  else {
    took(BIG_OUT_OF_VIEW);
    hide_object(object);
    if (flag(object, BIG_HIT)) { *flags = 0; took(BIG_GONE_BURNT); return; }
    took(BIG_HIDDEN);
  }
  if (flag(object, BIG_HIT)) { took(BIG_IS_HIT); enemy_burns_away(object); return; }
  RAM[0x27] = 0x08;
  RAM[0x26] = 0x08;
  took(BIG_TESTS);
  int arthur_touched;
  uint8_t weapon = enemy_spark_tests(object, &arthur_touched);
  if (weapon) {
    *count = 0;
    took(BIG_SPARKS);
    set_flag(object, SPARKED);
    clear_flag(object, THREW);
  } else took(arthur_touched ? BIG_TOUCHED_ARTHUR : BIG_NOTHING_TOUCHED);
  if (RAM[0x0647 + object] >= 0x0A) {
    took(BIG_KILLED);
    sound_play(0x1F);
    RAM[0x27] = 5;   // 500 points
    RAM[0x26] = 0;
    *count = 0;
    took(BIG_KILLED_SCORE);
    add_score(object, weapon);
    set_flag(object, BIG_HIT);
    took(JUMPS);
    enemy_burns_away(object);
    return;
  }
  took(BIG_STILL_STANDS);
  if (flag(object, ON_HIS_FLOOR)) { took(BIG_IS_ON_HIS_FLOOR); on_his_floor(object); return; }
  took(BIG_IS_NOT_ON_HIS_FLOOR);
  if ((int8_t)--*count >= 0) { took(BIG_STRETCH_GOES_ON); walks(object); return; }
  took(BIG_STRETCH_OVER);
  took(OBJECT_SHOWN_READ);
  flags_read(object);
  if (*flags & OBJECT_FLAG_SHOWN) {
    uint8_t apart = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + ARTHUR]);
    if (apart < 0x20 || apart >= 0xE8) {
      *count = 0;
      took(apart < 0x20 ? BIG_REACHES_HIS_FLOOR : BIG_REACHES_HIS_FLOOR_ABOVE);
      set_flag(object, ON_HIS_FLOOR);   // by a jump
      return;
    }
    took(BIG_NOT_ON_HIS_FLOOR);
  } else took(BRANCH_TAKEN);
  new_stretch(object);
  walks(object);
}

