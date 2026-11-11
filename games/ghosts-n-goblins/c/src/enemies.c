// Ghosts'n Goblins Dreamport: the enemies, from the original's code. So far the zombies of the first stage: bank 2's
// $8416 brings three out of the ground near Arthur each time its count of rounds runs out, and $F7BE is a zombie's turn
// each round. It waits under the ground, comes up in 16 rounds, walks the way it was headed for some 64 rounds or until
// the ground ends, and sinks again.
//
// What a weapon does to a zombie, at $F770 and $F8C5, the weapons themselves, and what touching one does to Arthur,
// whose own task sees to it, aren't ported yet. Nor is what comes with every sixth zombie, at bank 2's $8900.

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
enum { FIRST_WEAPON = 0x11, WEAPONS = 3 };

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
    ZOMBIES_COUNTED++;   // sub_88F6
    took(ZOMBIE_COUNTED);
    took(--LEFT_TO_MAKE ? GOES_ROUND : GOES_ON);
  } while (LEFT_TO_MAKE);
  took(RETURNS);
}

// sub_F5A0: what touches an enemy this round, whose half width and half height are in $26 and $27: one of Arthur's three
// weapons, or Arthur, who is hit by it. A weapon that's flying, at $F600, isn't ported yet.
static void touch_tests(uint8_t enemy) {
  if (!(RAM[OBJECT_FLAGS + enemy] & OBJECT_FLAG_SHOWN)) { took(ENEMY_NOT_SHOWN); return; }
  took(ENEMY_TESTS_BEGIN);
  for (int weapon = 0; weapon < WEAPONS; weapon++) {
    took(WEAPON_NOT_FLYING);
    took(weapon + 1 < WEAPONS ? GOES_ROUND_FAR : GOES_ON);
  }
  took(ENEMY_NO_WEAPON_HIT);
  if (!arthur_touches(enemy)) { took(ENEMY_NOT_TOUCHED); return; }
  RAM[OBJECT_FLAGS + ARTHUR] |= ARTHUR_HIT;
  took(ENEMY_TOUCHES_ARTHUR);
}

// sub_F88C: a zombie's shape as it comes up or sinks, one of four by `step`, facing the way it's headed once it's more
// than a head, and its colours by its count: pale, then darker, then its own.
static void part_out_of_the_ground(uint8_t object, uint8_t step) {
  uint8_t shape = (uint8_t)(0x50 + ((step >> 2) & 3)), count = RAM[OBJECT_COUNT + object];
  took(ZOMBIE_SHAPE);
  took(shape == 0x50 ? ZOMBIE_SHAPE_HEAD : ZOMBIE_SHAPE_FACES);
  if (shape != 0x50) shape = (uint8_t)(shape + ((RAM[OBJECT_HEADING + object] & HEADS_LEFT) << 1));
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
  took(ZOMBIE_TURN_BEGINS);
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
    return;
  }
  took(ZOMBIE_IS_OUT);
  show_object(object);
  if (object_in_view(object)) took(ZOMBIE_IN_VIEW);
  else {
    took(ZOMBIE_OUT_OF_VIEW);
    hide_object(object);
  }
  took(OBJECT_FLAG_READ);
  if (*flags & SINKS) {
    took(ZOMBIE_SINKING);
    sink(object);
    return;
  }
  took(ZOMBIE_NOT_SINKING);
  took(OBJECT_FLAG_READ);
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
  } else {
    // $F825
    RAM[0x27] = 0x0C;
    RAM[0x26] = 0x08;
    took(ZOMBIE_WALKING);
    touch_tests(object);
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
    sink(object);
    return;
  }
  took(ZOMBIE_GOES_ON);
  took(OBJECT_FLAG_READ);
  took(*flags & FAST ? ZOMBIE_SPEED_FAST : ZOMBIE_SPEED_ORDINARY);
  move_object(object, (uint8_t)((*flags & FAST ? 0x0E : 0x09) + HARDER));
  // its two walking shapes, four rounds each, facing the way it's headed
  RAM[OBJECT_SHAPE + object] = (uint8_t)(0x54 + ((*count >> 2) & 1) + ((RAM[OBJECT_HEADING + object] & HEADS_LEFT) << 1));
  took(ZOMBIE_STEP_SHAPE);
  --*count;
  took(ZOMBIE_TURN_COUNTED);
}
