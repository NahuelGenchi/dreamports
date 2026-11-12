// Ghosts'n Goblins Dreamport: the enemy of the first stage's forest, kind 4, from the original's code at sub_04_A66A,
// and sub_02_8610, which makes one every so many rounds while the view is on the tenth to twelfth screens.
// It waits eight rounds, appears where it was put, in the air, over twelve more, and then flies up or down towards
// Arthur's height at speed $16, facing him. Every 32 rounds it stops to turn round, eight rounds at speed 4, and when Arthur is
// in front of it and near it readies its shot, kind $29. A readied shot is let go on a round whose count is four past a
// multiple of eight, and put away on a multiple of eight: it flies down when Arthur is close by, and the way the enemy
// is heading when he's still in front of it. A weapon kills it for 100 points.

#include "game.h"

enum { ARTHUR = 0, FOREST_ENEMY = 4 };
// its flags
enum { HIT = 0x01, FACES_LEFT = 0x02, STARTED = 0x04, UP = 0x08, ATTACKS = 0x20 };
// its state
enum { TURNS = 0x02, TURNED = 0x04, LEAVES = 0x08 };
#define HITS(object) RAM[0x0647 + (object)]
#define ROUNDS_TO_NEXT RAM[0xEA]       // the count the stage's makers share,
#define ROUNDS_BETWEEN RAM[0x5B]       // which comes sooner the harder the game is,
#define PLACE RAM[0xC0]                // and the place in their lists the last one took

static uint8_t flag(uint8_t object, uint8_t which) {
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  return RAM[OBJECT_FLAGS + object] & which;
}

/** sub_02_8610. */
void forest_enemies_come(uint8_t *x) {
  if (RAM[0xC2] >= 3) { took(FOREST_OTHER_PART); return; }
  if (RAM[0x65] < 9) { took(FOREST_BEFORE); return; }
  if (RAM[0x65] >= 0x0C) { took(FOREST_PAST); return; }
  took(FOREST_IN_RANGE);
  if (--ROUNDS_TO_NEXT) { took(FOREST_NOT_YET); return; }
  ROUNDS_TO_NEXT = (uint8_t)(0x28 - ROUNDS_BETWEEN);
  took(FOREST_COMES);
  took(CALLS);
  uint8_t object = free_object();
  if (object == NO_OBJECT) { took(FOREST_NONE_FREE); return; }
  RAM[OBJECT_FLAGS + object] = 0x40;
  RAM[OBJECT_KIND + object] = FOREST_ENEMY;
  RAM[OBJECT_HEADING + object] = 0x0C;
  RAM[OBJECT_COUNT + object] = 8;
  HITS(object) = 0;
  RAM[OBJECT_STATE + object] = 0;
  took(FOREST_SET_UP);
  PLACE = (PLACE + 1) & 0x0F;
  took(ZOMBIE_PLACE_CHOSEN);
  RAM[0x25] = PLACE;
  *x = (uint8_t)(PLACE * 3);
  // so far across from Arthur, at a height, by the copy's list at $8718
  uint16_t listed = (uint16_t)(0x8718 + *x);
  uint16_t across = (uint16_t)((RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]) + (cart(2, (uint16_t)(listed + 1)) << 8 | cart(2, listed)));
  RAM[OBJECT_X + object] = (uint8_t)across;
  RAM[OBJECT_X_SCREEN + object] = (uint8_t)(across >> 8);
  RAM[OBJECT_Y + object] = cart(2, (uint16_t)(listed + 2));
  RAM[OBJECT_Y_SCREEN + object] = RAM[OBJECT_Y_SCREEN + ARTHUR];
  took(FOREST_PLACED);
  sixth_carries_a_pot(object, x);
  took(RETURNS);
}

// $A7F4: what touches it, four pixels above its place.
static void tests(uint8_t object) {
  RAM[0x27] = 4;
  RAM[0x26] = 0x0A;
  RAM[OBJECT_SCREEN_Y + object] -= 4;
  took(FOREST_TESTS_BEGIN);
  int arthur_touched;
  enemy_touch_tests(object, &arthur_touched);
  RAM[OBJECT_SCREEN_Y + object] += 4;
  took(FOREST_TESTS_END);
}

// $A856: its shot, if one of the two shots' objects, $14 and $15, is free, and Arthur is within a box around it, or
// still in front of it. The shot starts at its place, with sound $1A.
static void shoot(uint8_t object) {
  enum { FIRST_SHOT = 0x14, SHOT = 0x29, DOWN = 0x08 };
  uint8_t shot = FIRST_SHOT, heading = RAM[OBJECT_HEADING + object];
  if (!RAM[OBJECT_FLAGS + shot]) took(FOREST_SHOT_FREE);
  else if (!RAM[OBJECT_FLAGS + ++shot]) took(FOREST_SECOND_SHOT_FREE);
  else { took(FOREST_NO_SHOT_FREE); return; }
  RAM[0x27] = 0x50;
  RAM[0x26] = 0x20;
  took(FOREST_SHOT_LOOKS);
  if (arthur_near(object)) {
    heading = DOWN;
    took(FOREST_SHOT_DOWN);
  } else if (arthur_is_right_of(object)) {
    if (heading != 0x04) { took(FOREST_SHOT_NOT_AHEAD_RIGHT); return; }
    took(FOREST_SHOT_AHEAD_RIGHT);
  } else {
    if (heading != 0x0C) { took(FOREST_SHOT_NOT_AHEAD_LEFT); return; }
    took(FOREST_SHOT_AHEAD_LEFT);
  }
  RAM[OBJECT_HEADING + shot] = heading;
  // sub_FA2E: its place, in the stage and on the screen
  RAM[OBJECT_Y + shot] = RAM[OBJECT_Y + object];
  RAM[OBJECT_Y_SCREEN + shot] = RAM[OBJECT_Y_SCREEN + object];
  RAM[OBJECT_SCREEN_Y + shot] = RAM[OBJECT_SCREEN_Y + object];
  RAM[OBJECT_X + shot] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + shot] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_SCREEN_X + shot] = RAM[OBJECT_SCREEN_X + object];
  RAM[OBJECT_FLAGS + shot] = 0x40;
  took(FOREST_SHOT_PLACED);
  RAM[OBJECT_KIND + shot] = SHOT;
  RAM[OBJECT_FLAGS + object] |= ATTACKS;
  took(FOREST_SHOT_MADE);
  if (object >= 0x10) took(READ_PAST_PAGE);
  took(FOREST_SHOT_SOUND);
  sound_play(0x1A);
  took(RETURNS);
}

// sub_04_A812, with its call: every so many rounds, sooner the harder the game, it looks for Arthur in front of it, or
// within a box around it, and readies its shot.
static void attack(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *rounds = &RAM[0x066E + object], heading = RAM[OBJECT_HEADING + object];
  took(CALLS);
  if (flag(object, ATTACKS)) {
    took(FOREST_ATTACK_COUNT);
    if (RAM[OBJECT_COUNT + object] & 3) { took(FOREST_ATTACK_WAITS); return; }
    took(BRANCH_TAKEN);
    shoot(object);
    return;
  }
  ++*rounds;
  took(FOREST_LOOK_COUNTED);
  if ((uint8_t)(*rounds + RAM[0xD3]) < 0x18) { took(FOREST_LOOK_NOT_YET); return; }
  *rounds = 0;
  RAM[0x27] = 0x60;
  RAM[0x26] = 0x28;
  took(FOREST_LOOKS);
  if (arthur_near(object)) took(BRANCH_TAKEN);
  else {
    took(GOES_ON);
    if (arthur_is_right_of(object)) {
      took(FOREST_AHEAD_RIGHT);
      if (heading != 0x04) { took(FOREST_NOT_AHEAD); return; }
      took(GOES_ON);
    } else {
      took(FOREST_AHEAD_LEFT);
      if (heading != 0x0C) { took(FOREST_NOT_AHEAD_LEFT); return; }
      took(BRANCH_TAKEN);
    }
  }
  *flags |= ATTACKS;
  took(FOREST_READIES);
}

// $A778: it turns round, eight rounds at speed 4 with four shapes, and then faces and heads the other way.
static void turn_round(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object], *state = &RAM[OBJECT_STATE + object];
  took(FOREST_TURN_MOVES);
  move_object(object, 4);
  ++*count;
  took(FOREST_TURN_COUNTED);
  if (*count >= 8) {
    took(*state & TURNED ? FOREST_TURN_ENDS_BACK : FOREST_TURN_ENDS);
    *state = *state & TURNED ? 0x0C : 0x04;
    *flags ^= FACES_LEFT;
    RAM[OBJECT_HEADING + object] = (uint8_t)(((*flags << 2) & 0x08) | 0x04);
    *count = 0;
  } else {
    static const struct { uint8_t shape, other_way; cost takes; } STEPS[] = {
      { 0x72, 0, FOREST_TURN_SHAPE_1 }, { 0x71, 0, FOREST_TURN_SHAPE_2 }, { 0x71, 1, FOREST_TURN_SHAPE_3 }, { 0x72, 1, FOREST_TURN_SHAPE_4 },
    };
    uint8_t step = *count >> 1;
    took(STEPS[step].takes);
    RAM[OBJECT_SHAPE + object] = STEPS[step].shape;
    uint8_t left = flag(object, FACES_LEFT) != 0;
    if (left != STEPS[step].other_way) {
      RAM[OBJECT_SHAPE + object] += 0x10;
      took(STEPS[step].other_way ? FOREST_TURN_SHAPE_BACK_FLIPPED : FOREST_TURN_SHAPE_FLIPPED);
    } else took(BRANCH_TAKEN);
  }
  took(JUMPS);
  tests(object);
}

/** sub_04_A66A, kind 4. */
void forest_enemy(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object], *state = &RAM[OBJECT_STATE + object];
  if (flag(object, HIT)) {
    took(FOREST_DEAD);
    enemy_burns_away(object);
    return;
  }
  took(FOREST_HITS_READ);
  if (HITS(object)) {
    took(FOREST_KILLED);
    sound_play(0x1F);
    *flags |= HIT;
    *count = 0;
    RAM[0x26] = 0;
    RAM[0x27] = 1;   // 100 points
    took(FOREST_KILLED_SCORE);
    if (object >= 0x10) took(READ_PAST_PAGE);
    add_score(object, 0);
    took(JUMPS);
    enemy_burns_away(object);
    return;
  }
  RAM[OBJECT_COLOURS + object] = 0x02;
  took(FOREST_ALIVE);
  if (*state & TURNS) {
    took(FOREST_TURNS);
    turn_round(object);
    return;
  }
  took(BRANCH_TAKEN);
  if (!flag(object, STARTED)) {
    // $A6A2: its eight rounds of waiting, and then it starts, facing Arthur
    took(FOREST_WAIT_COUNTED);
    if (--*count) { took(FOREST_WAITS); return; }
    *state = 0;
    *flags |= STARTED;
    RAM[OBJECT_HEADING + object] = 0x04;
    *flags &= (uint8_t)~FACES_LEFT;
    took(FOREST_STARTS);
    if (arthur_is_right_of(object)) { took(FOREST_STARTS_RIGHT); return; }
    RAM[OBJECT_HEADING + object] = 0x0C;
    *flags |= FACES_LEFT;
    took(FOREST_STARTS_LEFT);
    return;
  }
  // $A6C5: the sound of it, which the game's task plays every 48 rounds while one is about
  RAM[0xE8] = 0x18;
  RAM[0xE9] = 0x30;
  took(FOREST_SOUND_SET);
  show_object(object);
  if (object_in_view(object)) took(BRANCH_TAKEN);
  else {
    took(FOREST_OUT_OF_VIEW);
    if (*state & LEAVES) {
      took(FOREST_GONE);
      remove_object(object);
      return;
    }
    took(BRANCH_TAKEN);
    hide_object(object);
  }
  if (!flag(object, UP)) {
    // $A6E7: appearing, twelve rounds
    ++*count;
    took(FOREST_RISE_COUNTED);
    if (*count >= 0x0C) {
      *flags |= UP;
      took(FOREST_IS_UP);
      return;
    }
    RAM[OBJECT_SHAPE + object] = (uint8_t)(0x70 + cart(4, (uint16_t)(0xA7F1 + (*count >> 2))));
    took(FOREST_RISE_SHAPE);
    if (RAM[OBJECT_SHAPE + object] == 0x70) { took(FOREST_RISE_FIRST_SHAPE); return; }
    took(GOES_ON);
    if (!flag(object, FACES_LEFT)) { took(FOREST_RISE_FIRST_SHAPE); return; }
    RAM[OBJECT_SHAPE + object] += 0x10;
    took(FOREST_RISE_SHAPE_LEFT);
    return;
  }
  // $A713: up, with its two shapes
  ++*count;
  RAM[OBJECT_SHAPE + object] = 0x72;
  took(FOREST_UP_BEGINS);
  RAM[OBJECT_SHAPE + object] += (*count >> 2) & 1;
  took(FOREST_UP_SHAPE);
  if (flag(object, FACES_LEFT)) {
    RAM[OBJECT_SHAPE + object] += 0x10;
    took(FOREST_UP_SHAPE_LEFT);
  } else took(BRANCH_TAKEN);
  took(FOREST_STATE_READ);
  if (*state & LEAVES) took(BRANCH_TAKEN);
  else {
    took(FOREST_COUNT_READ);
    if (*count < 0x20) took(BRANCH_TAKEN);
    else {
      // after 32 rounds it turns round, heading up or down to Arthur's height
      *state |= TURNS;
      *count = 0xFF;
      RAM[OBJECT_HEADING + object] = 0;
      took(FOREST_TURN_BEGINS);
      if (RAM[OBJECT_SCREEN_Y + object] >= RAM[OBJECT_SCREEN_Y + ARTHUR]) took(BRANCH_TAKEN);
      else {
        RAM[OBJECT_HEADING + object] = 0x08;
        took(FOREST_TURN_HEADS_DOWN);
      }
    }
  }
  int moves = 1;
  if (!flag(object, ATTACKS)) took(BRANCH_TAKEN);
  else {
    took(FOREST_COUNT_READ);
    if (*count & 7) { took(BRANCH_TAKEN); moves = 0; }
    else {
      *state = 0;
      *flags &= (uint8_t)~ATTACKS;
      took(FOREST_ATTACK_OVER);
    }
  }
  if (moves) {
    took(FOREST_MOVES);
    move_object(object, 0x16);
  }
  attack(object);
  took(JUMPS);
  tests(object);
}
