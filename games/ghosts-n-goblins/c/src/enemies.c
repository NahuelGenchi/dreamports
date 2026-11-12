// Ghosts'n Goblins Dreamport: the enemies, from the original's code. So far the zombies of the first stage: bank 2's
// $8416 brings three out of the ground near Arthur each time its count of rounds runs out, and $F7BE is a zombie's turn
// each round. It waits under the ground, comes up in 16 rounds, walks the way it was headed for some 64 rounds or until
// the ground ends, and sinks again.
//
// Every sixth zombie carries a pot, an object of its own, kind $12 at bank 4's $BBEE, that stays where its carrier is.
//
// A lance or a dagger that touches a zombie is gone, and the zombie dies in six rounds, for 200 points, and its pot falls
// to the ground and is a thing to pick up.
//
// What a torch or an axe does to one, at $F5B5, what every fourth pot holds, at bank 2's $8938, and the pots of the
// later stages, at $8928, aren't ported yet.

#include "game.h"

enum { ARTHUR = 0 };
#define STAGE RAM[0xC2]
#define ROUNDS RAM[0x83]
#define HARDER RAM[0xD2]               // twice how hard the game is, which every zombie's speed has added
#define ROUNDS_TO_ZOMBIES RAM[0xEA]    // counts down to the next three,
#define ROUNDS_BETWEEN RAM[0x5B]       // sooner the harder the game is
#define ZOMBIES_MADE RAM[0xE5]
#define ZOMBIES_PLACE RAM[0xC0]        // which of the 16 places in the copy's list at $84A7 the next one takes
#define ZOMBIES_COUNTED RAM[0x0707]    // towards the sixth
#define LEFT_TO_MAKE RAM[0x22]
// a zombie's flags, with the one that shows it
enum { HIT = 0x01, WALKS = 0x02, SINKS = 0x04, FAST = 0x10, OUT = 0x20, IN_USE = 0x40 };
enum { ARTHUR_IN_THE_AIR = 0x08, ARTHUR_HIT = 0x01 };
enum { HEADS_LEFT = 0x08 };            // the bit of a heading that the ways to the left have
enum { POT = 0x12 };                   // a kind of object, as a zombie is kind 0
#define CARRIER(pot) RAM[0x0647 + (pot)]   // the object that carries a pot
#define POTS_MADE RAM[0x0708]

// An object in the sixteenth place has its flags in the next page of memory, so each read or change of them by its number
// takes a cycle more. `times` is how many the piece just counted has.
static void flags_past_page(uint8_t object, uint32_t times) {
  if (object >= 0x10) took_times(READ_PAST_PAGE, times);
}

// The sixteenth object's heading is in the next page too, and so is the one before it: a cycle more to read it by its number.
static void heading_past_page(uint8_t object) {
  if (object >= 0x0F) took(READ_PAST_PAGE);
}

// sub_88F6: every sixth of the enemies that come by themselves carries a pot. It holds the usual thing, unless it's the
// fourth pot: then the copy's list at $8963 says what, by the set of stages and how many pots there have been, and a
// weapon Arthur already has is passed over for the next. The fifth set of stages on, at $8928, isn't ported yet.
void sixth_carries_a_pot(uint8_t object, uint8_t *x) {
  took(ZOMBIE_COUNT_BEGINS);
  if (++ZOMBIES_COUNTED < 6) { took(ZOMBIE_NOT_SIXTH); return; }
  ZOMBIES_COUNTED = 0;
  took(ZOMBIE_SIXTH);
  uint8_t pot = free_object();
  if (pot == NO_OBJECT) { took(POT_NONE_FREE); return; }
  POTS_MADE++;
  CARRIER(pot) = object;
  RAM[OBJECT_KIND + pot] = POT;
  RAM[OBJECT_FLAGS + pot] = IN_USE;
  RAM[OBJECT_STATE + pot] = 1;
  took(POT_MADE);
  if (POTS_MADE & 3) return;
  uint8_t which = (uint8_t)((RAM[0xCF] << 4) + ((POTS_MADE >> 2) & 0x0F));
  took(POT_FOURTH);
  for (;;) {
    RAM[0x25] = which;
    *x = RAM[OBJECT_STATE + pot] = cart(2, (uint16_t)(0x8963 + which));
    took(POT_CONTENTS_READ);
    if (cart(2, (uint16_t)(0x89C3 + *x)) != WEAPON_HELD) { took(POT_CONTENTS_CHOSEN); return; }
    which++;
    took(POT_CONTENTS_HELD_ALREADY);
  }
}

/** Bank 2's $8416. In the first stage's first five screens, and in the eighth place, the count goes down a round at a time. */
void zombies_come(uint8_t *x) {
  if (STAGE != 0 && STAGE != 7) { took(ZOMBIES_OTHER_STAGE); return; }
  took(STAGE ? ZOMBIES_EIGHTH_PLACE : ZOMBIES_FIRST_STAGE);
  if (RAM[OBJECT_X_SCREEN + ARTHUR] >= 5) { took(ZOMBIES_PAST_THEIR_SCREENS); return; }
  took(ZOMBIES_COUNTED_DOWN);
  if (--ROUNDS_TO_ZOMBIES) { took(ZOMBIES_NOT_YET); return; }
  ROUNDS_TO_ZOMBIES = (uint8_t)(0x60 - ROUNDS_BETWEEN);
  LEFT_TO_MAKE = 3;
  took(ZOMBIES_COME);
  do {
    took(CALLS);
    uint8_t object = free_object();
    if (object == NO_OBJECT) { took(ZOMBIE_NONE_FREE); return; }
    // every fourth is a fast one
    uint8_t fast = (++ZOMBIES_MADE & 3) == 3;
    took(ZOMBIE_BEGINS);
    took(fast ? ZOMBIE_IS_FAST : ZOMBIE_IS_ORDINARY);
    RAM[OBJECT_FLAGS + object] = fast ? IN_USE | FAST : IN_USE;
    RAM[OBJECT_KIND + object] = 0;
    RAM[0x0647 + object] = 0;
    RAM[OBJECT_COUNT + object] = (uint8_t)(LEFT_TO_MAKE << 3);   // the rounds it waits: each of the three comes up 8 after the last
    took(ZOMBIE_SET_UP);
    // sub_84D7: the next of the 16 places, each so far across from Arthur and a way to head
    ZOMBIES_PLACE = (ZOMBIES_PLACE + 1) & 0x0F;
    took(ZOMBIE_PLACE_CHOSEN);
    RAM[0x25] = ZOMBIES_PLACE;
    *x = (uint8_t)(ZOMBIES_PLACE * 3);
    uint16_t place = (uint16_t)(0x84A7 + *x);
    uint16_t across = (uint16_t)((RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]) + (cart(2, (uint16_t)(place + 1)) << 8 | cart(2, place)));
    RAM[OBJECT_X + object] = (uint8_t)across;
    RAM[OBJECT_X_SCREEN + object] = (uint8_t)(across >> 8);
    RAM[OBJECT_HEADING + object] = cart(2, (uint16_t)(place + 2));
    took(ZOMBIE_PLACED);
    // on the ground Arthur is on or over: the lower, or the upper when he stands high in the picture
    uint8_t lower = RAM[OBJECT_FLAGS + ARTHUR] & ARTHUR_IN_THE_AIR || RAM[OBJECT_SCREEN_Y + ARTHUR] >= 0x94;
    took(RAM[OBJECT_FLAGS + ARTHUR] & ARTHUR_IN_THE_AIR ? ZOMBIE_UNDER_A_JUMP : lower ? ZOMBIE_ON_LOWER_GROUND : ZOMBIE_ON_UPPER_GROUND);
    RAM[OBJECT_Y + object] = lower ? 0xB8 : 0x68;
    RAM[OBJECT_Y_SCREEN + object] = RAM[OBJECT_Y_SCREEN + ARTHUR];
    took(ZOMBIE_HEIGHT_SET);
    sixth_carries_a_pot(object, x);
    took(ZOMBIE_NEXT);
    took(--LEFT_TO_MAKE ? GOES_ROUND : GOES_ON);
  } while (LEFT_TO_MAKE);
  took(RETURNS);
}

// sub_F5A0: what touches an enemy this round, whose half width and half height are in $26 and $27. The first of
// Arthur's three weapons that's flying, hasn't hit anything yet and touches it is gone, and is the answer: the enemy's
// hits, at $0647, count it. With none, Arthur is hit if he touches it.
uint8_t weapon_that_touches(uint8_t enemy) {
  enum { SPENT = 0x01 };
  took(WEAPONS_BEGIN);
  for (uint8_t weapon = FIRST_WEAPON; weapon < FIRST_WEAPON + WEAPONS; weapon++) {
    uint8_t flags = RAM[OBJECT_FLAGS + weapon];
    if (!(flags & OBJECT_FLAG_SHOWN)) took(WEAPON_NOT_FLYING);
    else if (flags & SPENT) took(WEAPON_SPENT);
    else {
      took(WEAPON_TESTED);
      if (weapon_touches(weapon, enemy)) {
        took(WEAPON_HIT);
        return weapon;
      }
      took(WEAPON_MISSED);
    }
    took(weapon + 1 < FIRST_WEAPON + WEAPONS ? GOES_ROUND_FAR : GOES_ON);
  }
  took(WEAPONS_NONE);
  return 0;
}

uint8_t enemy_touch_tests(uint8_t enemy, int *arthur_touched) {
  *arthur_touched = 0;
  if (!(RAM[OBJECT_FLAGS + enemy] & OBJECT_FLAG_SHOWN)) {
    took(ENEMY_NOT_SHOWN);
    flags_past_page(enemy, 1);
    return 0;
  }
  took(ENEMY_TESTS_BEGIN);
  flags_past_page(enemy, 2);
  uint8_t weapon = weapon_that_touches(enemy);
  if (weapon) {
    RAM[OBJECT_STATE + weapon] = enemy;
    RAM[OBJECT_FLAGS + weapon] = 0;
    RAM[OBJECT_COUNT + weapon] = 0;
    RAM[0x0647 + enemy]++;
    took(WEAPON_STOPS);
    return weapon;
  }
  took(ENEMY_NO_WEAPON_HIT);
  flags_past_page(enemy, 1);
  if (!arthur_touches(enemy)) { took(ENEMY_NOT_TOUCHED); return 0; }
  RAM[OBJECT_FLAGS + ARTHUR] |= ARTHUR_HIT;
  *arthur_touched = 1;
  took(ENEMY_TOUCHES_ARTHUR);
  return 0;
}
static uint8_t touch_tests(uint8_t enemy) {
  int arthur_touched;
  return enemy_touch_tests(enemy, &arthur_touched);
}

// $F770: a zombie that's been hit, six rounds of three shapes, falling the way the weapon went, and it's gone.
static void die(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  show_object(object);
  if (!object_in_view(object)) {
    took(ZOMBIE_DEAD_OUT_OF_VIEW);
    remove_object(object);
    return;
  }
  if (*count >= 6) {
    took(ZOMBIE_DEAD);
    remove_object(object);
    return;
  }
  took(ZOMBIE_DIES_ON);
  took(ZOMBIE_DYING_SHAPE);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  took(RAM[OBJECT_FLAGS + object] & WALKS ? ZOMBIE_DIES_TO_THE_LEFT : ZOMBIE_DIES_TO_THE_RIGHT);
  RAM[OBJECT_SHAPE + object] = (uint8_t)((RAM[OBJECT_FLAGS + object] & WALKS ? 0x3A : 0xF5) + (*count >> 1));
  RAM[OBJECT_COLOURS + object] = 0;
  ++*count;
  took(ZOMBIE_DYING_ENDS);
}

// $F8C5: a weapon has hit it. Its flag that said it walks now says the weapon was heading left, for the way it falls.
static void is_hit(uint8_t object, uint8_t weapon) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object];
  *flags &= (uint8_t)~WALKS;
  *flags |= (RAM[OBJECT_HEADING + weapon] >> 2) & WALKS;
  *flags |= HIT;
  RAM[OBJECT_COUNT + object] = 0;
  RAM[0x26] = 0;
  RAM[0x27] = 2;   // 200 points
  took(ZOMBIE_HIT);
  flags_past_page(object, 3);
  add_score(object, weapon);
  took(ZOMBIE_HIT_SOUND);
  sound_play(0x16);
}

// sub_F88C: a zombie's shape as it comes up or sinks, one of four by `step`, facing the way it's headed once it's more
// than a head, and its colours by its count: pale, then darker, then its own.
static void part_out_of_the_ground(uint8_t object, uint8_t step) {
  uint8_t shape = (uint8_t)(0x50 + ((step >> 2) & 3)), count = RAM[OBJECT_COUNT + object];
  took(ZOMBIE_SHAPE);
  took(shape == 0x50 ? ZOMBIE_SHAPE_HEAD : ZOMBIE_SHAPE_FACES);
  if (shape != 0x50) shape = (uint8_t)(shape + ((RAM[OBJECT_HEADING + object] & HEADS_LEFT) << 1));
  if (shape != 0x50) heading_past_page(object);
  RAM[OBJECT_SHAPE + object] = shape;
  RAM[OBJECT_COLOURS + object] = 0x02;
  took(ZOMBIE_COLOURS_PALE);
  if (count < 4) { took(ZOMBIE_COLOURS_DONE); return; }
  RAM[OBJECT_COLOURS + object] = 0x1F;
  took(ZOMBIE_COLOURS_DARKER);
  if (count < 8) { took(ZOMBIE_COLOURS_DONE); return; }
  RAM[OBJECT_COLOURS + object] = 0x0B;
  took(ZOMBIE_COLOURS_ITS_OWN);
}

// $F87D: back into the ground, 16 rounds, and gone.
static void sink(uint8_t object) {
  if (RAM[OBJECT_COUNT + object] & 0x80) {
    took(ZOMBIE_SUNK);
    remove_object(object);
    return;
  }
  took(ZOMBIE_SINKS);
  part_out_of_the_ground(object, RAM[OBJECT_COUNT + object]);
  RAM[OBJECT_COUNT + object]--;
  took(ZOMBIE_TURN_COUNTED);
}

void zombie(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object];
  flags_past_page(object, 1);
  if (*flags & HIT) {
    took(ZOMBIE_DYING);
    die(object);
    return;
  }
  took(ZOMBIE_TURN_BEGINS);
  flags_past_page(object, 1);
  if (!(*flags & OUT)) {
    // $F7CB: under the ground, which has to be there
    took(ZOMBIE_UNDER_THE_GROUND);
    if (!on_the_ground(object)) {
      took(ZOMBIE_NO_GROUND);
      remove_object(object);
      return;
    }
    if (--*count) { took(ZOMBIE_WAITS_ON); return; }
    *flags |= OUT;
    took(ZOMBIE_COMES_OUT);
    flags_past_page(object, 1);
    return;
  }
  took(ZOMBIE_IS_OUT);
  show_object(object);
  if (object_in_view(object)) took(ENEMY_IN_VIEW);
  else {
    took(ENEMY_OUT_OF_VIEW);
    hide_object(object);
  }
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (*flags & SINKS) {
    took(ZOMBIE_SINKING);
    sink(object);
    return;
  }
  took(ZOMBIE_NOT_SINKING);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (!(*flags & WALKS)) {
    // $F7F4: coming up, with its sound as it starts
    took(ZOMBIE_NOT_WALKING);
    uint8_t step = *count;
    if (step < 0x10) {
      took(step ? ZOMBIE_COMES_UP : ZOMBIE_COMES_UP_FIRST);
      if (!step) {
        sound_play(0x17);
        step = RAM[0xD4];   // what the call leaves in the processor's A register, the bank it went back to, chooses the first shape
      }
      took(CALLS);
      part_out_of_the_ground(object, step);
      ++*count;
      took(ZOMBIE_TURN_COUNTED);
      return;
    }
    // up: it walks for 64 rounds and as many more, up to 31, as its number and the round's make
    *flags |= WALKS;
    RAM[OBJECT_COLOURS + object] = 0;
    RAM[0x0647 + object] = 0;
    *count = (uint8_t)(0x40 + ((object + ROUNDS) & 0x1F));
    took(ZOMBIE_IS_UP);
    flags_past_page(object, 1);
  } else {
    // $F825
    RAM[0x27] = 0x0C;
    RAM[0x26] = 0x08;
    took(ZOMBIE_WALKING);
    uint8_t weapon = touch_tests(object);
    if (RAM[0x0647 + object]) {
      took(ZOMBIE_WAS_HIT);
      is_hit(object, weapon);
      return;
    }
    took(ZOMBIE_NOT_HIT);
  }
  // $F838: a step, unless the ground ends or its rounds are over
  RAM[OBJECT_COLOURS + object] = 0x0B;
  took(ZOMBIE_STEP_BEGINS);
  int ground = on_the_ground(object);
  if (!ground || *count & 0x80) {
    took(ground ? ZOMBIE_ROUNDS_OVER : ZOMBIE_GROUND_ENDS);
    *flags |= SINKS;
    *count = 0x0F;
    took(ZOMBIE_STARTS_SINKING);
    flags_past_page(object, 1);
    sink(object);
    return;
  }
  took(ZOMBIE_GOES_ON);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  took(*flags & FAST ? ZOMBIE_SPEED_FAST : ZOMBIE_SPEED_ORDINARY);
  move_object(object, (uint8_t)((*flags & FAST ? 0x0E : 0x09) + HARDER));
  // its two walking shapes, four rounds each, facing the way it's headed
  RAM[OBJECT_SHAPE + object] = (uint8_t)(0x54 + ((*count >> 2) & 1) + ((RAM[OBJECT_HEADING + object] & HEADS_LEFT) << 1));
  took(ZOMBIE_STEP_SHAPE);
  heading_past_page(object);
  --*count;
  took(ZOMBIE_TURN_COUNTED);
}

/** Bank 4's $BBEE, kind $12: the pot a zombie carries, which is where its carrier is and shows when it does. */
void pot(uint8_t object) {
  uint8_t carrier = CARRIER(object);
  RAM[OBJECT_COLOURS + object] = 0x02;
  RAM[OBJECT_SHAPE + object] = 0x49;
  took(POT_BEGINS);
  show_object(object);
  if (object_in_view(object)) took(ENEMY_IN_VIEW);
  else {
    took(ENEMY_OUT_OF_VIEW);
    hide_object(object);
  }
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (RAM[OBJECT_FLAGS + object] & SINKS) {
    // $BC8A: it falls, the way it was headed, and once it's on the ground it's a thing to pick up, what its state says
    took(POT_IS_FALLING);
    if (on_the_ground(object)) {
      RAM[OBJECT_KIND + object] = 0x10;
      RAM[OBJECT_Y + object] = (uint8_t)((RAM[OBJECT_Y + object] & 0xF0) | 0x08);   // sub_E166: on top of the block
      took(POT_LANDS);
    } else {
      took(POT_FALLS_ON);
      move_object(object, 0x14);
    }
    return;
  }
  took(POT_IS_CARRIED);
  RAM[OBJECT_Y_SCREEN + object] = RAM[OBJECT_Y_SCREEN + carrier];
  RAM[OBJECT_Y + object] = RAM[OBJECT_Y + carrier];
  RAM[OBJECT_X_SCREEN + object] = RAM[OBJECT_X_SCREEN + carrier];
  RAM[OBJECT_X + object] = RAM[OBJECT_X + carrier];
  took(POT_FOLLOWS);
  // only a zombie and the kinds 6, 7 and 4 carry one: another's is gone
  uint8_t carriers = RAM[OBJECT_KIND + carrier];
  if (carriers) took(carriers == 6 ? POT_ON_KIND_6 : carriers == 7 ? POT_ON_KIND_7 : carriers == 4 ? POT_ON_KIND_4 : POT_ON_NO_CARRIER);
  if (carriers && carriers != 6 && carriers != 7 && carriers != 4) {
    remove_object(object);
    return;
  }
  if (!RAM[OBJECT_FLAGS + carrier]) {
    took(POT_CARRIER_GONE);
    remove_object(object);
    return;
  }
  took(POT_CARRIER_THERE);
  took(POT_ON_A_ZOMBIE);
  hide_object(object);
  if (!object_in_view(object)) took(POT_STAYS_HIDDEN);
  else {
    RAM[OBJECT_FLAGS + object] |= RAM[OBJECT_FLAGS + carrier] & OBJECT_FLAG_SHOWN;
    took(POT_SHOWN_AS_CARRIER);
  }
  took(POT_CARRIER_LOOKED_AT);
  if (!(RAM[OBJECT_FLAGS + carrier] & HIT)) { took(POT_IS_KEPT); return; }
  RAM[OBJECT_FLAGS + object] |= SINKS;   // for a pot, the flag that says it falls
  RAM[OBJECT_HEADING + object] = 0x08;
  took(POT_FALLS);
}

// ---- the flying knights of the first stage's last screens

#define KNIGHTS_FLYING RAM[0xD0]

/** Bank 2's $84E0: in the first set of stages, from 64 pixels into the eighth screen to 144 into the ninth, three flying
 *  knights come every so many rounds, sooner the harder the game is, each eight rounds after the last, at one of three
 *  heights and places in their wave that the copy's list at $8554 gives. */
void knights_come(uint8_t *x) {
  enum { KNIGHT = 3 };
  if (RAM[0xCF]) { took(KNIGHTS_OTHER_SET); return; }
  uint8_t screen = RAM[OBJECT_X_SCREEN + ARTHUR], across = RAM[OBJECT_X + ARTHUR];
  took(KNIGHTS_LOOKED_AT);
  if (screen == 7) {
    took(KNIGHTS_EIGHTH_SCREEN);
    if (across < 0x40) { took(KNIGHTS_TOO_EARLY); return; }
    took(KNIGHTS_THERE);
  } else if (screen == 8) {
    took(KNIGHTS_NINTH_SCREEN);
    if (across >= 0x90) { took(KNIGHTS_PAST); return; }
    took(GOES_ON);
  } else { took(KNIGHTS_ELSEWHERE); return; }
  if (--ROUNDS_TO_ZOMBIES) { took(KNIGHTS_NOT_YET); return; }
  ROUNDS_TO_ZOMBIES = (uint8_t)(0x80 - ROUNDS_BETWEEN);
  LEFT_TO_MAKE = 3;
  took(KNIGHTS_COME);
  do {
    took(CALLS);
    uint8_t object = free_object();
    if (object == NO_OBJECT) { took(KNIGHT_NONE_FREE); return; }
    KNIGHTS_FLYING++;
    RAM[OBJECT_FLAGS + object] = IN_USE;
    RAM[OBJECT_KIND + object] = KNIGHT;
    RAM[OBJECT_HEADING + object] = 0x0C;
    RAM[0x0647 + object] = 0;
    RAM[OBJECT_COUNT + object] = (uint8_t)(LEFT_TO_MAKE << 3);
    took(KNIGHT_SET_UP);
    ZOMBIES_PLACE = (ZOMBIES_PLACE + 1) & 0x0F;
    took(ZOMBIE_PLACE_CHOSEN);
    *x = (uint8_t)(ZOMBIES_PLACE * 2);
    RAM[OBJECT_STATE + object] = cart(2, (uint16_t)(0x8554 + *x));
    RAM[OBJECT_Y + object] = cart(2, (uint16_t)(0x8555 + *x));
    RAM[OBJECT_Y_SCREEN + object] = 0;
    took(KNIGHT_PLACED);
    sixth_carries_a_pot(object, x);
    took(KNIGHT_NEXT);
    took(--LEFT_TO_MAKE ? GOES_ROUND : GOES_ON);
  } while (LEFT_TO_MAKE);
  took(RETURNS);
}

/** Bank 4's $A530, kind 3: a flying knight. After its wait it comes in at the right of the view and flies left in a
 *  wave, 32 heights from the copy's list at $A5EA, with a sound the game's task plays while any is flying. Its shield
 *  stops a weapon thrown at its front: only one heading left, from behind it, kills it, for 100 points. */
void knight(uint8_t object) {
  enum { FLIES = 0x04 };
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object];
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (!(*flags & FLIES)) {
    if (--*count) { took(KNIGHT_WAITS); return; }
    *flags |= FLIES;
    RAM[OBJECT_X + object] = RAM[0x64];
    RAM[OBJECT_X_SCREEN + object] = (uint8_t)(RAM[0x65] + 1);
    took(KNIGHT_APPEARS);
    flags_past_page(object, 1);
    return;
  }
  took(BRANCH_TAKEN);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (*flags & HIT) {
    took(KNIGHT_DEAD);
    enemy_burns_away(object);
    return;
  }
  RAM[0x26] = RAM[0x27] = 8;
  took(KNIGHT_TESTS);
  uint8_t weapon = touch_tests(object);
  if (!RAM[0x0647 + object]) took(KNIGHT_NOT_HIT);
  else if (RAM[OBJECT_HEADING + weapon] != 0x0C) {
    RAM[OBJECT_FLAGS + weapon] = 0x45;   // spent, against its shield
    took(KNIGHT_SHIELD);
    if (weapon >= 0x0F) took(READ_PAST_PAGE);
  } else {
    RAM[OBJECT_FLAGS + weapon] = 0x41;
    took(KNIGHT_KILLED);
    if (weapon >= 0x0F) took(READ_PAST_PAGE);
    sound_play(0x16);
    *flags |= HIT;
    *count = 0;
    RAM[0x26] = 0;
    RAM[0x27] = 1;   // 100 points
    took(KNIGHT_KILLED_SCORE);
    flags_past_page(object, 1);
    add_score(object, weapon);
    KNIGHTS_FLYING--;
    took(KNIGHT_KILLED_ENDS);
    enemy_burns_away(object);
    return;
  }
  // $A58B: the sound of its wings, which the game's task plays 32 rounds from now unless another asks again
  RAM[0xE8] = 0x23;
  RAM[0xE9] = 0x20;
  RAM[0x0647 + object] = 0;
  took(KNIGHT_SOUND_SET);
  show_object(object);
  took(KNIGHT_VIEW_LOOKED_AT);
  if ((RAM[0x65] << 8 | RAM[0x64]) >= (RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object])) {
    // past the view's left edge, it's gone
    KNIGHTS_FLYING--;
    took(KNIGHT_PASSED);
    remove_object(object);
    return;
  }
  uint8_t at = (uint8_t)(*count * 2 + RAM[OBJECT_STATE + object]);
  RAM[OBJECT_COLOURS + object] = 0x01;
  RAM[OBJECT_SHAPE + object] = (uint8_t)(0x89 + ((*count >> 2) & 1));
  RAM[0x7B] = 0;
  RAM[0x73] = cart(4, (uint16_t)(0xA5EA + at));
  RAM[0x77] = cart(4, (uint16_t)(0xA5EB + at));
  took(KNIGHT_WAVE);
  if (0xEA + at > 0xFF) took(READ_PAST_PAGE);
  if (0xEB + at > 0xFF) took(READ_PAST_PAGE);
  move_down(object);
  took(KNIGHT_MOVES);
  move_object(object, 0x0C);
  *count = (uint8_t)((*count + 1) & 0x1F);
  took(KNIGHT_ROUND_COUNTED);
}

// ---- the crows, the plants and their shots, which the first stage's list places from its third screen on

// $F9CC: a crow in flight goes the way it faced at its speed, more the harder the game is, up and down by the 16 heights
// in the copy's list at $FA0E, with two shapes for its wings, until it's out of the view.
static void crow_flies(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  took(OBJECT_SHOWN_READ);
  flags_past_page(object, 1);
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) {
    took(CROW_GONE);
    remove_object(object);
    return;
  }
  took(CROW_IN_FLIGHT);
  took(CROW_SPEED);
  move_object(object, (uint8_t)(0x10 + RAM[0xD3]));
  uint16_t height = (uint16_t)(0xFA0E + (*count & 0x0F) * 2);
  RAM[0x73] = cart(7, height);
  RAM[0x77] = cart(7, (uint16_t)(height + 1));
  took(CROW_WAVE);
  took(CALLS);
  move_down(object);
  ++*count;
  RAM[OBJECT_SHAPE + object] = (uint8_t)(0xBB + ((*count >> 1) & 1));
  took(CROW_WINGS);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (!(RAM[OBJECT_FLAGS + object] & SINKS)) { took(CROW_FLIES_RIGHT); return; }
  RAM[OBJECT_SHAPE + object] += 0x10;   // for a crow, the flag that says it faces left
  took(CROW_FLIES_LEFT);
}

/** $F93D, kind $14: a crow. It sits, flag $02, facing Arthur, for 24 rounds while it's shown, cawing in four of them,
 *  and then flies. A weapon kills it for 100 points, as it does a zombie. */
void crow(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object];
  place_on_screen(object);
  RAM[OBJECT_COLOURS + object] = 0;
  took(CROW_BEGINS);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (*flags & HIT) {
    took(CROW_DEAD);
    die(object);
    return;
  }
  took(CROW_ALIVE);
  show_object(object);
  if (object_in_view(object)) took(ENEMY_IN_VIEW);
  else {
    took(ENEMY_OUT_OF_VIEW);
    hide_object(object);
  }
  RAM[0x26] = RAM[0x27] = 4;
  took(CROW_TESTS);
  uint8_t weapon = touch_tests(object);
  if (RAM[0x0647 + object]) {
    // $F960: hit. Its flag that said it sits now says the weapon was heading left, for the way it falls.
    *flags &= (uint8_t)~WALKS;
    *flags |= (RAM[OBJECT_HEADING + weapon] >> 2) & WALKS;
    *flags |= HIT;
    took(CROW_HIT);
    sound_play(0x16);
    *count = 0;
    RAM[0x26] = 0;
    RAM[0x27] = 1;   // 100 points
    took(CROW_HIT_SCORE);
    add_score(object, weapon);
    return;
  }
  took(CROW_NOT_HIT);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (!(*flags & WALKS)) {
    took(CROW_FLIES);
    crow_flies(object);
    return;
  }
  took(CROW_SITS);
  took(OBJECT_SHOWN_READ);
  flags_past_page(object, 1);
  if (!(*flags & OBJECT_FLAG_SHOWN)) { took(CROW_HIDDEN); return; }
  ++*count;
  took(CROW_COUNTS);
  if (*count < 0x18) took(CROW_STILL_SITTING);
  else {
    *flags &= (uint8_t)~WALKS;
    took(CROW_TAKES_OFF);
  }
  *flags &= (uint8_t)~SINKS;
  RAM[OBJECT_HEADING + object] = 0x04;
  RAM[OBJECT_SHAPE + object] = 0xB9;
  took(CROW_FACES);
  if (arthur_is_right_of(object)) took(CROW_FACES_RIGHT);
  else {
    *flags |= SINKS;
    RAM[OBJECT_HEADING + object] = 0x0C;
    RAM[OBJECT_SHAPE + object] = 0xC9;
    took(CROW_FACES_LEFT);
  }
  took(CROW_COUNT_READ);
  if (*count < 0x10) took(CROW_QUIET);
  else if (*count >= 0x14) took(CROW_CAWS_OVER);
  else {
    RAM[OBJECT_SHAPE + object]++;
    took(CROW_CAWS);
  }
}

// sub_9FA5: a plant's half width and half height, for what touches it.
static void plant_box(void) {
  RAM[0x26] = 4;
  RAM[0x27] = 0x10;
}

// $9F25: a plant with its mouth open. After 16 rounds it shoots, if one of the two shots' objects, $14 and $15, is free:
// the shot starts at the plant's place, eight pixels up, headed for Arthur, with sound $1A. A plant in the top eight
// pixels of a screen, at $9F5C, isn't ported yet.
static void plant_shoots(uint8_t object) {
  enum { FIRST_SHOT = 0x14, SHOTS = 2, SHOT = 0x2B };
  plant_box();
  took(PLANT_TESTS_CALLED);
  touch_tests(object);
  ++RAM[OBJECT_STATE + object];
  took(PLANT_AIMS);
  uint8_t shot = 0;
  if (RAM[OBJECT_STATE + object] < 0x10) took(PLANT_AIMS_ON);
  else {
    took(PLANT_SHOT_LOOKED_FOR);
    for (uint8_t slot = FIRST_SHOT; slot < FIRST_SHOT + SHOTS && !shot; slot++) {
      if (!RAM[OBJECT_FLAGS + slot]) {
        took(SHOT_SLOT_FREE);
        shot = slot;
      } else {
        took(SHOT_SLOT_USED);
        took(slot + 1 < FIRST_SHOT + SHOTS ? GOES_ROUND : GOES_ON);
      }
    }
  }
  if (!shot) {
    RAM[OBJECT_SHAPE + object] = 0xBF;
    took(PLANT_MOUTH_OPEN);
    if (arthur_is_right_of(object)) took(PLANT_MOUTH_RIGHT);
    else {
      RAM[OBJECT_SHAPE + object] = 0xCF;
      took(PLANT_MOUTH_LEFT);
    }
    return;
  }
  // sub_FA2E: the plant's place, in the stage and on the screen
  RAM[OBJECT_Y + shot] = (uint8_t)(RAM[OBJECT_Y + object] - 8);
  RAM[OBJECT_Y_SCREEN + shot] = RAM[OBJECT_Y_SCREEN + object];
  RAM[OBJECT_SCREEN_Y + shot] = RAM[OBJECT_SCREEN_Y + object];
  RAM[OBJECT_X + shot] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + shot] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_SCREEN_X + shot] = RAM[OBJECT_SCREEN_X + object];
  RAM[OBJECT_FLAGS + shot] = IN_USE;
  took(SHOT_MADE);
  took(SHOT_SAME_SCREEN);
  took(SHOT_AIMED);
  RAM[OBJECT_HEADING + shot] = way_to_arthur(shot);
  RAM[OBJECT_KIND + shot] = SHOT;
  took(SHOT_HEADED);
  sound_play(0x1A);
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~SINKS;
  took(PLANT_SHOT);
}

// $F6F6: an enemy that a weapon has killed burns away where it is, eight shapes from the copy's list at $F760, two
// rounds each, and is gone. The kinds 5, 9 and $15, which burn with the shapes at $F768, aren't ported yet.
void enemy_burns_away(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  show_object(object);
  if (object_in_view(object)) took(BURNING_IN_VIEW);
  else {
    took(BURNING_OUT_OF_VIEW);
    hide_object(object);
  }
  if (*count >= 0x10) {
    took(BURNT_AWAY);
    remove_object(object);
    return;
  }
  RAM[OBJECT_SHAPE + object] = cart(7, (uint16_t)(0xF760 + (*count >> 1)));
  RAM[OBJECT_COLOURS + object] = 0x02;
  ++*count;
  took(BURNS_ON);
}

/** Bank 4's $9EC0, kind 1: a plant. In the view it faces Arthur, and every 16 rounds opens its mouth, flag $04, to shoot.
 *  Out of the view it starts again. A weapon is worth 100 points, with sound $1F, and then it burns away. */
void plant(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object];
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (*flags & HIT) {
    took(PLANT_DEAD);
    enemy_burns_away(object);
    return;
  }
  took(PLANT_ALIVE);
  show_object(object);
  if (!object_in_view(object)) {
    RAM[OBJECT_COUNT + object] = 0;
    *flags = IN_USE;
    took(PLANT_OUT_OF_VIEW);
    return;
  }
  took(PLANT_IN_VIEW);
  if (RAM[0x0647 + object]) {
    took(PLANT_HIT);
    sound_play(0x1F);
    *flags |= HIT;
    RAM[OBJECT_COUNT + object] = 0;
    RAM[0x26] = 0;
    RAM[0x27] = 1;   // 100 points
    took(PLANT_HIT_SCORE);
    add_score(object, 0);
    took(JUMPS);
    enemy_burns_away(object);
    return;
  }
  took(PLANT_NOT_HIT);
  took(OBJECT_FLAG_READ);
  flags_past_page(object, 1);
  if (*flags & SINKS) {   // for a plant, the flag that says its mouth is open
    took(PLANT_SHOOTS);
    plant_shoots(object);
    return;
  }
  took(PLANT_WAITS);
  RAM[OBJECT_COLOURS + object] = 0x03;
  RAM[OBJECT_SHAPE + object] = 0xBD;
  took(PLANT_LOOKS);
  if (arthur_is_right_of(object)) took(PLANT_LOOKS_RIGHT);
  else {
    RAM[OBJECT_SHAPE + object] = 0xCD;
    took(PLANT_LOOKS_LEFT);
  }
  ++RAM[OBJECT_COUNT + object];
  took(PLANT_COUNTS);
  if (RAM[OBJECT_COUNT + object] & 0x0F) took(PLANT_NOT_YET);
  else {
    *flags |= SINKS;
    RAM[OBJECT_STATE + object] = 0;
    took(PLANT_OPENS);
  }
  plant_box();
  took(PLANT_TESTS);
  touch_tests(object);
}

// $F4A3: a shot flies the way it was headed until it's out of the view, and hits Arthur if it touches him. With the
// cross a weapon can stop it, at $F557, which isn't ported yet.
static void shot_flies(uint8_t object, uint8_t speed) {
  took(CALLS);
  move_object(object, (uint8_t)(speed + RAM[0xD3]));
  if (!object_in_view(object)) {
    RAM[OBJECT_FLAGS + object] = 0;
    took(SHOT_GONE);
    return;
  }
  show_object(object);
  RAM[OBJECT_SHAPE + object] = 0xAB;
  RAM[0x26] = RAM[0x27] = 2;
  took(SHOT_FLIES);
  place_on_screen(object);
  took(SHOT_TESTS);
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (!arthur_touches(object)) { took(ENEMY_NOT_TOUCHED); return; }
  RAM[OBJECT_FLAGS + ARTHUR] |= ARTHUR_HIT;
  took(ENEMY_TOUCHES_ARTHUR);
}

/** $F49C, kind $2B: a plant's shot. */
void plant_shot(uint8_t object) {
  RAM[OBJECT_COLOURS + object] = 0;
  took(SHOT_BEGINS);
  shot_flies(object, 0x10);
}

/** $F4BC, kind $2C: the flier's shot, in its own colours and faster. */
void flier_shot(uint8_t object) {
  RAM[OBJECT_COLOURS + object] = 0x03;
  took(FLIER_SHOT_BEGINS);
  shot_flies(object, 0x1A);
}
