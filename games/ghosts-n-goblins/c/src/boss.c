// Ghosts'n Goblins Dreamport: the boss that stands at the end of a stage, kind 5, from the original's code at $FBC4.
// The stage's list places it with $D673 (flow.c), in an object taken for it if none is free. Out of the view it's
// hidden. In the view it stands asleep, with its touch tests, until Arthur comes within a box around it, or has been
// level with it or above for 40 rounds, or has hit it three times: then it wakes, facing him.
//
// Awake, from $FC3F, it goes through 16 steps over and over, by the copy's list at $FEFD: a walk at speed $0A the way
// it's heading, or a stand, on whose second round it shoots, kind $30. A step lasts a count from the game's dice, and
// at its end it turns round, or towards Arthur when he's far, or away from him when he's close. Every eighth step is
// a charge, flag $08: 24 rounds at speed $18 towards him. It asks for sound $0F every 24 rounds.
//
// A weapon coming at it while it walks sets its dodge, flag $10, at $FCEF: a jump of 16 rounds, up and down by the
// copy's list of heights at $FEDD, and across at the step's speed in the list at $FF0D, after which the next step
// begins. Every 64th step is a leap, flag $20, at $FEA4: the same jump at speed $2E, and it turns round as it lands.
//
// Its death after ten hits, at $FC10, and the last stage's boss, which $CF marks, aren't ported yet.

#include "game.h"

enum { ARTHUR = 0 };
// its flags
enum { HIT = 0x01, FACES_LEFT = 0x02, CHARGES = 0x08, DODGES = 0x10, READY = 0x20 };
#define STEP(object) RAM[OBJECT_STATE + (object)]
#define HITS(object) RAM[0x0647 + (object)]
#define AWAKE(object) RAM[0x065D + (object)]

static uint8_t flag(uint8_t object, uint8_t which) {
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  return RAM[OBJECT_FLAGS + object] & which;
}

static void change_flag(uint8_t object, uint8_t which, int set) {
  if (set) RAM[OBJECT_FLAGS + object] |= which;
  else RAM[OBJECT_FLAGS + object] &= (uint8_t)~which;
  took(OBJECT_FLAG_CHANGED);
  if (object >= 0x10) took(READ_PAST_PAGE);
}

// sub_FF1D, with its call: it wakes, with a count from the game's dice, and faces the side Arthur is on.
static void wake(uint8_t object) {
  RAM[OBJECT_COUNT + object] = RAM[0x83] & 0x1F;
  AWAKE(object) = 0xFF;
  took(BOSS_WAKES);
  if (flag(object, READY)) {
    RAM[OBJECT_COUNT + object] = 0;
    took(BOSS_WAKES_READY);
  } else took(BOSS_WAKES_PLAIN);
  RAM[OBJECT_HEADING + object] = 0x04;
  change_flag(object, FACES_LEFT, 0);
  if (arthur_is_right_of(object)) took(BOSS_FACES_RIGHT);
  else {
    RAM[OBJECT_HEADING + object] = 0x0C;
    took(BOSS_FACES_LEFT);
    change_flag(object, FACES_LEFT, 1);
    took(RETURNS);
  }
  took(RETURNS);
}

// the copy's list at $FEFD: each step's speed, or 0 for a stand
static uint8_t step_speed(uint8_t object) {
  uint8_t step = STEP(object) & 0x0F;
  if (0xFEFD + step > 0xFEFF) took(READ_PAST_PAGE);
  return cart(7, (uint16_t)(0xFEFD + step));
}

// Its shape faces the side Arthur is on.
static void face_him(uint8_t object, uint8_t shape) {
  RAM[OBJECT_SHAPE + object] = shape;
  if (arthur_is_right_of(object)) took(BOSS_SHAPE_RIGHT);
  else {
    RAM[OBJECT_SHAPE + object] = (uint8_t)(shape + 0x10);
    took(BOSS_SHAPE_LEFT);
  }
}

// It heads for the side Arthur is on.
static void head_for_him(uint8_t object) {
  RAM[OBJECT_HEADING + object] = 0x04;
  if (arthur_is_right_of(object)) took(BRANCH_TAKEN);
  else {
    RAM[OBJECT_HEADING + object] = 0x0C;
    took(BOSS_HEADS_LEFT);
  }
}

// sub_F0A0's call and what follows it: it moves, and is hidden once it's out of the view.
static void move(uint8_t object, uint8_t speed) {
  took(CALLS);
  move_object(object, speed);
  if (object_in_view(object)) { took(BOSS_STAYS_IN_VIEW); return; }
  took(GOES_ON);
  hide_object(object);
  took(RETURNS);
}

// $FCA4: its shot, if one of the two shots' objects is free: from its place, four pixels up, to the side Arthur is on.
static void shoot(uint8_t object) {
  enum { FIRST_SHOT = 0x14, SHOT = 0x30 };
  uint8_t shot = FIRST_SHOT;
  if (!RAM[OBJECT_FLAGS + shot]) took(BOSS_SHOT_FREE);
  else if (!RAM[OBJECT_FLAGS + ++shot]) took(BOSS_SECOND_SHOT_FREE);
  else { took(BOSS_NO_SHOT_FREE); return; }
  // sub_FA2E: its place, in the stage and on the screen
  RAM[OBJECT_Y + shot] = RAM[OBJECT_Y + object];
  RAM[OBJECT_Y_SCREEN + shot] = RAM[OBJECT_Y_SCREEN + object];
  RAM[OBJECT_SCREEN_Y + shot] = RAM[OBJECT_SCREEN_Y + object];
  RAM[OBJECT_X + shot] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + shot] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_SCREEN_X + shot] = RAM[OBJECT_SCREEN_X + object];
  RAM[OBJECT_FLAGS + shot] = 0x40;
  RAM[OBJECT_Y + shot] -= 4;
  if (RAM[OBJECT_Y + shot] < 0xF0) took(BOSS_SHOT_PLACED);
  else {
    // past the top of its screen: the one above, whose lines end at 240
    RAM[OBJECT_Y + shot] -= 0x10;
    RAM[OBJECT_Y_SCREEN + shot]--;
    took(BOSS_SHOT_PLACED_A_SCREEN_UP);
  }
  RAM[OBJECT_KIND + shot] = SHOT;
  RAM[OBJECT_SHAPE + object] = 0xB3;
  RAM[OBJECT_HEADING + shot] = 0x04;
  took(BOSS_SHOT_SET);
  if (arthur_is_right_of(object)) { took(BOSS_SHOT_RIGHT); return; }
  RAM[OBJECT_SHAPE + object] = 0xC3;
  RAM[OBJECT_HEADING + shot] = 0x0C;
  took(BOSS_SHOT_LEFT);
}

// $FDFF: a round of a walk, with two shapes.
static void walk(uint8_t object) {
  RAM[OBJECT_COUNT + object]--;
  took(BOSS_WALK_BEGINS);
  face_him(object, 0xB1);
  RAM[OBJECT_SHAPE + object] += (RAM[OBJECT_COUNT + object] >> 2) & 1;
  uint8_t speed = (uint8_t)(step_speed(object) + RAM[0xD3]);
  took(BOSS_WALK_MOVES);
  move(object, speed);
}

// $FE34: a round of a stand. It shoots on the second, and the step is over on the sixth.
static void stand(uint8_t object) {
  took(BOSS_STAND_BEGINS);
  face_him(object, 0xB3);
  uint8_t count = ++RAM[OBJECT_COUNT + object];
  if (count == 2) {
    took(BOSS_STAND_SHOOTS);
    shoot(object);
  } else if (count < 6) took(BOSS_STAND_WAITS);
  else {
    STEP(object)++;
    took(BOSS_STAND_OVER);
  }
}

// $FD6F: a step is over. The next lasts a count from the game's dice, and the boss turns round, or towards Arthur when
// he's outside a box of $68 by $10, or away from him when he's within one of $50 by $10. Every 64th step is a leap and
// every eighth a charge; a stand begins at once, and a walk has its first round now.
static void next_step(uint8_t object) {
  RAM[OBJECT_COUNT + object] = (uint8_t)(RAM[0x83] + RAM[0x4D]) & 0x1F;
  STEP(object)++;
  RAM[OBJECT_HEADING + object] = (RAM[OBJECT_HEADING + object] ^ 0x08) | 0x04;
  RAM[0x26] = 0x68;
  RAM[0x27] = 0x10;
  took(BOSS_NEXT_STEP);
  if (!arthur_near(object)) {
    RAM[OBJECT_HEADING + object] = 0x04;
    took(BOSS_FAR);
    if (arthur_is_right_of(object)) took(BOSS_FAR_RIGHT);
    else {
      RAM[OBJECT_HEADING + object] = 0x0C;
      took(BOSS_FAR_LEFT);
    }
  } else {
    RAM[0x26] = 0x50;
    RAM[0x27] = 0x10;
    took(BOSS_NEAR_LOOKS);
    if (!arthur_near(object)) took(BRANCH_TAKEN);
    else {
      RAM[OBJECT_HEADING + object] = 0x04;
      took(BOSS_CLOSE);
      if (!arthur_is_right_of(object)) took(BRANCH_TAKEN);
      else {
        RAM[OBJECT_HEADING + object] = 0x0C;
        took(BOSS_TURNS_AWAY);
      }
    }
  }
  if (!(STEP(object) & 0x3F)) {
    RAM[OBJECT_COUNT + object] = 0;
    took(BOSS_LEAP_BEGINS);
    head_for_him(object);
    RAM[OBJECT_FLAGS + object] |= READY;
    took(BOSS_LEAP_SET);
    return;
  }
  took(BOSS_NOT_A_LEAP);
  if (!(STEP(object) & 0x07)) {
    RAM[OBJECT_COUNT + object] = 0;
    RAM[OBJECT_FLAGS + object] |= CHARGES;
    took(BOSS_CHARGE_SET);
    return;
  }
  took(BOSS_NOT_A_CHARGE);
  uint8_t speed = step_speed(object);
  took(BOSS_NEXT_READ);
  if (!speed) {
    RAM[OBJECT_COUNT + object] = 0;
    took(BOSS_NEXT_STANDS);
    return;
  }
  took(BRANCH_TAKEN);
  walk(object);
}

// $FE58: a charge: 24 rounds at speed $18, turning towards Arthur every fourth.
static void charge(uint8_t object) {
  took(BOSS_STAND_BEGINS);
  face_him(object, 0xB1);
  if (RAM[OBJECT_COUNT + object] & 3) took(BOSS_CHARGE_NO_TURN);
  else {
    took(BOSS_CHARGE_TURNS);
    head_for_him(object);
  }
  uint8_t count = ++RAM[OBJECT_COUNT + object];
  if (count >= 0x18) {
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~CHARGES;
    took(BOSS_CHARGE_OVER);
    return;
  }
  RAM[OBJECT_SHAPE + object] += (count >> 1) & 1;
  took(BOSS_CHARGE_MOVES);
  move(object, (uint8_t)(0x18 + RAM[0xD3]));
}

// sub_FF36, with its call: the height of a jump's round, from the copy's list at $FEDD.
static void jump_height(uint8_t object) {
  uint16_t listed = (uint16_t)(0xFEDD + RAM[OBJECT_COUNT + object] * 2);
  RAM[0x7B] = 0;
  RAM[0x73] = cart(7, listed);
  RAM[0x77] = cart(7, (uint16_t)(listed + 1));
  took(BOSS_JUMP_HEIGHT);
  move_down(object);
}

// A jump's shape, facing the side Arthur is on, which its flag keeps too.
static void jump_shape(uint8_t object) {
  change_flag(object, FACES_LEFT, 0);
  RAM[OBJECT_SHAPE + object] = 0xB4;
  took(BOSS_STAND_BEGINS);
}

// $FCEF: its dodge.
static void dodge(uint8_t object) {
  jump_shape(object);
  if (arthur_is_right_of(object)) took(BOSS_DODGE_FACES_RIGHT);
  else {
    took(GOES_ON);
    change_flag(object, FACES_LEFT, 1);
    RAM[OBJECT_SHAPE + object] = 0xC4;
    took(BOSS_JUMP_SHAPE_LEFT);
  }
  jump_height(object);
  uint8_t speed = cart(7, (uint16_t)(0xFF0D + (STEP(object) & 0x0F)));
  took(BOSS_DODGE_SPEED);
  took(CALLS);
  move_object(object, speed);
  if (object_in_view(object)) took(BRANCH_TAKEN);
  else {
    took(GOES_ON);
    hide_object(object);
  }
  if (++RAM[OBJECT_COUNT + object] < 0x10) { took(BOSS_DODGE_GOES_ON); return; }
  took(BOSS_DODGE_LANDS);
  change_flag(object, DODGES, 0);
  RAM[OBJECT_COUNT + object] = RAM[0x83] & 0x1F;
  STEP(object)++;
  RAM[OBJECT_SHAPE + object] = 0xB0;
  took(BOSS_DODGE_OVER);
  if (arthur_is_right_of(object)) { took(BOSS_STAYS_IN_VIEW); return; }
  RAM[OBJECT_SHAPE + object] = 0xC0;
  took(BOSS_DODGE_OVER_LEFT);
}

// $FEA4: its leap.
static void leap(uint8_t object) {
  jump_shape(object);
  if (arthur_is_right_of(object)) took(BRANCH_TAKEN);
  else {
    took(GOES_ON);
    change_flag(object, FACES_LEFT, 1);
    RAM[OBJECT_SHAPE + object] = 0xC4;
    took(BOSS_JUMP_SHAPE_LEFT);
  }
  jump_height(object);
  took(BOSS_LEAP_SPEED);
  took(CALLS);
  move_object(object, 0x2E);
  if (object_in_view(object)) took(BRANCH_TAKEN);
  else {
    took(GOES_ON);
    hide_object(object);
  }
  if (++RAM[OBJECT_COUNT + object] < 0x10) { took(BOSS_LEAP_GOES_ON); return; }
  took(BOSS_LEAP_LANDS);
  change_flag(object, READY, 0);
  RAM[OBJECT_HEADING + object] ^= 0x08;
  took(BOSS_LEAP_OVER);
}

// $FC3F: awake.
static void awake(uint8_t object) {
  RAM[0xE8] = 0x0F;
  RAM[0xE9] = 0x18;
  if (flag(object, CHARGES)) { took(BOSS_TURN_ELSEWHERE); charge(object); return; }
  took(BRANCH_TAKEN);
  if (flag(object, READY)) { took(BOSS_TURN_ELSEWHERE); leap(object); return; }
  took(BRANCH_TAKEN);
  if (flag(object, DODGES)) { took(BOSS_TURN_ELSEWHERE); dodge(object); return; }
  took(BOSS_TURN_STEPS);
  // $FD3F: a step
  uint8_t speed = step_speed(object);
  took(BOSS_STEP_READ);
  if (!speed) { took(BOSS_STEP_STANDS); stand(object); return; }
  took(BRANCH_TAKEN);
  if (RAM[OBJECT_COUNT + object] & 3) took(BOSS_NO_LOOK);
  else {
    // every fourth round of a walk it looks for a weapon coming, in a box of $20 by $20, and dodges it
    RAM[0x26] = RAM[0x27] = 0x20;
    took(BOSS_LOOKS_FOR_WEAPONS);
    if (object >= 0x10) took(READ_PAST_PAGE);
    if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) took(BOSS_WEAPONS_NOT_SHOWN);
    else {
      took(BOSS_WEAPONS_SHOWN);
      if (weapon_that_touches(object)) {
        RAM[OBJECT_COUNT + object] = 0;
        RAM[OBJECT_FLAGS + object] |= DODGES;
        took(BOSS_DODGE_SET);
        return;
      }
    }
    took(BRANCH_TAKEN);
  }
  if (RAM[OBJECT_COUNT + object]) { took(BOSS_STEP_GOES_ON); walk(object); return; }
  took(BOSS_STEP_OVER);
  next_step(object);
}

/** $FBC4, kind 5. */
void boss(uint8_t object) {
  enum { CROSS = 0x27 };
  if (flag(object, HIT)) {
    took(BOSS_DEAD);
    enemy_burns_away(object);
    return;
  }
  took(BOSS_BEGINS);
  hide_object(object);
  if (!object_in_view(object)) took(BOSS_OUT_OF_VIEW);
  else {
    show_object(object);
    RAM[0x26] = RAM[0x27] = 0x10;
    took(BOSS_IN_VIEW);
    int arthur_touched;
    uint8_t weapon = enemy_spark_tests(object, &arthur_touched);
    if (!weapon) took(arthur_touched ? BOSS_TOUCHED : BOSS_NOT_HIT);
    else if (RAM[OBJECT_KIND + weapon] != CROSS) took(BOSS_HIT);
    else {
      // that weapon's hit doesn't count, and it's gone at once
      HITS(object)--;
      RAM[OBJECT_FLAGS + weapon] = 0x45;
      took(BOSS_HIT_BY_CROSS);
    }
  }
  RAM[OBJECT_COLOURS + object] = 0x01;
  if (HITS(object) >= 0x0A) return;   // $FC10: its death, not ported yet
  if (AWAKE(object)) { took(BOSS_AWAKE); awake(object); return; }
  took(BOSS_ASLEEP);
  // $FC62: asleep
  took(OBJECT_SHOWN_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) { took(BOSS_NOT_SHOWN); return; }
  RAM[OBJECT_SHAPE + object] = 0xC0;
  RAM[0x26] = 0x50;
  RAM[0x27] = 0x10;
  took(BOSS_LOOKS);
  if (arthur_near(object)) took(BOSS_NEAR);
  else {
    RAM[OBJECT_COUNT + object]++;
    if ((uint8_t)(RAM[OBJECT_SCREEN_Y + object] + 0x10) < RAM[OBJECT_SCREEN_Y + ARTHUR]) { took(BOSS_ARTHUR_BELOW); return; }
    if (RAM[OBJECT_COUNT + object] >= 0x28) took(BOSS_WAITED);
    else if (HITS(object) < 3) { took(BOSS_WAITS); return; }
    else took(BOSS_HIT_AWAKE);
  }
  wake(object);
}
