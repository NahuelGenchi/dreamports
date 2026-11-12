// Ghosts'n Goblins Dreamport: the small blue devil that flies at Arthur among the second stage's towers, kind 6, from
// the original's code at sub_04_A89E. The stage's list places each with a count of rounds. Once it's in the view it
// waits them out, then comes awake heading away from the side of the picture it's nearest. Awake it flies 16 rounds,
// hovers 16 more, aims at Arthur and dives for 24, and starts again a new way; from its third time round it flies
// without stopping, and once out of the view it's gone. One hit kills it, for 100 points.
//
// It can carry another object under it, at $065D, which it lets go when Arthur is close below. That, at $A90F, was
// written from the original's instructions and hasn't been run by a recording.

#include "game.h"

enum { ARTHUR = 0 };
// its flags: hit, drawn turned round, awake, hovering, diving
enum { HIT = 0x01, TURNED = 0x02, AWAKE = 0x04, HOVERS = 0x08, DIVES = 0x10 };
#define CARRIED(object) RAM[0x065D + (object)]
#define HITS(object) RAM[0x0647 + (object)]
#define ROUNDS RAM[0x83]
#define SPEED_ADDED RAM[0xD3]
#define KILLS_LEFT RAM[0xE1]

static uint8_t flag(uint8_t object, uint8_t which) {
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  return RAM[OBJECT_FLAGS + object] & which;
}

// $AA33: its two wing shapes, four rounds each, one way round or the other.
static void shape(uint8_t object) {
  RAM[OBJECT_COLOURS + object] = 0;
  RAM[OBJECT_SHAPE + object] = (uint8_t)(0x95 + ((RAM[OBJECT_COUNT + object] >> 2) & 1));
  took(DEVIL_SHAPE);
  if (!flag(object, TURNED)) { took(DEVIL_SHAPE_KEPT); return; }
  RAM[OBJECT_SHAPE + object] += 0x10;
  took(DEVIL_SHAPE_TURNED);
}

// $A8AB: not awake yet. In the view its count runs down, and at the end it wakes.
static void wait_to_wake(uint8_t object) {
  if (!object_in_view(object)) { took(DEVIL_WAITS_OUT_OF_VIEW); return; }
  if (--RAM[OBJECT_COUNT + object]) { took(DEVIL_WAITS_ON); return; }
  took(DEVIL_WAKES);
  RAM[OBJECT_FLAGS + object] |= AWAKE;
  took(OBJECT_FLAG_CHANGED);
  if (object >= 0x10) took(READ_PAST_PAGE);
  RAM[OBJECT_STATE + object] = 0;
  took(DEVIL_WOKEN);
  place_on_screen(object);
  uint8_t *heading = &RAM[OBJECT_HEADING + object], across = RAM[OBJECT_SCREEN_X + object];
  *heading = 0x04;
  if (across < 0x30) { took(DEVIL_FROM_THE_LEFT); return; }
  *heading = 0x0C;
  if (across >= 0xD0) { took(DEVIL_FROM_THE_RIGHT); return; }
  *heading = 0x08;
  if (RAM[OBJECT_SCREEN_Y + object] < 0x70) { took(DEVIL_FROM_ABOVE); return; }
  *heading = 0x00;
  took(DEVIL_FROM_BELOW);
}

// $A90F: what it carries stays eight pixels under it, and is let go once Arthur is within 96 pixels across and 16 down.
static void carry(uint8_t object) {
  uint8_t carried = CARRIED(object);
  RAM[OBJECT_X + carried] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + carried] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_Y_SCREEN + carried] = RAM[OBJECT_Y_SCREEN + object];
  uint16_t down = (uint16_t)(RAM[OBJECT_Y + object] + 8);
  RAM[OBJECT_Y + carried] = (uint8_t)down;
  if ((uint8_t)down < 0xF0) took(DEVIL_CARRIES);
  else {
    // past the screen's 240 lines, on the next screen down
    down = (uint16_t)((uint8_t)down + 0x10);
    RAM[OBJECT_Y + carried] = (uint8_t)down;
    RAM[OBJECT_Y_SCREEN + carried] = (uint8_t)(RAM[OBJECT_Y_SCREEN + object] + (down >> 8));
    took(DEVIL_CARRIES_ONTO_NEXT_SCREEN);
  }
  RAM[0x26] = 0x60;
  RAM[0x27] = 0x10;
  if (!arthur_near(object)) { took(DEVIL_HOLDS_ON); return; }
  CARRIED(object) = 0;
  RAM[OBJECT_FLAGS + carried] |= 0x02;
  RAM[OBJECT_HEADING + carried] = 0x04;
  took(DEVIL_LETS_GO);
  if (arthur_is_right_of(object)) { took(DEVIL_LET_GO_RIGHT); return; }
  RAM[OBJECT_HEADING + carried] = 0x0C;
  took(DEVIL_LET_GO_LEFT);
}

// $A976: a weapon has hit it. What it carried is gone, it falls the way that object was heading, or Arthur with nothing
// carried, and it's worth 100 points.
static void killed(uint8_t object) {
  uint8_t carried = CARRIED(object), *flags = &RAM[OBJECT_FLAGS + object];
  if (carried) {
    RAM[OBJECT_FLAGS + carried] = 0;
    took(DEVIL_KILLED_CARRYING);
  } else took(DEVIL_KILLED);
  *flags &= (uint8_t)~TURNED;
  took(OBJECT_FLAG_CHANGED);
  if (object >= 0x10) took(READ_PAST_PAGE);
  *flags |= (RAM[OBJECT_HEADING + carried] >> 2) & TURNED;
  took(DEVIL_FALL_SIDE);
  if (carried >= 0x0F) took(READ_PAST_PAGE);
  if (object >= 0x10) took(READ_PAST_PAGE);
  *flags |= HIT;
  took(OBJECT_FLAG_CHANGED);
  if (object >= 0x10) took(READ_PAST_PAGE);
  took(DEVIL_KILLED_SOUND);
  sound_play(0x16);
  if (--KILLS_LEFT & 0x80) {
    KILLS_LEFT = 0;
    took(DEVIL_NO_KILLS_LEFT);
  } else took(DEVIL_KILL_COUNTED);
  RAM[OBJECT_COUNT + object] = 0;
  RAM[0x26] = 0;
  RAM[0x27] = 1;
  took(DEVIL_KILLED_SCORE);
  add_score(object, carried);
}

void devil(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object], *state = &RAM[OBJECT_STATE + object];
  if (flag(object, HIT)) {
    took(DEVIL_IS_HIT);
    hit_enemy_falls(object);
    return;
  }
  took(DEVIL_IS_NOT_HIT);
  if (!flag(object, AWAKE)) {
    took(DEVIL_IS_NOT_AWAKE);
    wait_to_wake(object);
    return;
  }
  took(DEVIL_IS_AWAKE);
  show_object(object);
  if (object_in_view(object)) took(DEVIL_IN_VIEW);
  else {
    took(DEVIL_OUT_OF_VIEW);
    hide_object(object);
    if (*state >= 2) {
      // out of the view after its second dive, it's gone, with what it carries
      *flags = 0;
      if (CARRIED(object)) {
        RAM[OBJECT_FLAGS + CARRIED(object)] = 0;
        took(DEVIL_GONE_WITH_CARRIED);
      } else took(DEVIL_GONE);
      return;
    }
    took(DEVIL_STAYS);
  }
  if (CARRIED(object)) carry(object);
  else took(DEVIL_CARRIES_NOTHING);
  RAM[0x26] = RAM[0x27] = 4;
  took(DEVIL_TESTS);
  int arthur_touched;
  enemy_touch_tests(object, &arthur_touched);
  if (HITS(object)) {
    killed(object);
    return;
  }
  took(DEVIL_NOT_KILLED);
  if (flag(object, DIVES)) {
    // $AA0C: 24 rounds at Arthur, and then a new way, by the game's count of rounds, and one more time round
    took(DEVIL_FLAG_IS);
    ++*count;
    if (*count < 0x18) {
      took(DEVIL_DIVES);
      move_object(object, 0x14);
      shape(object);
      return;
    }
    took(DEVIL_DIVE_OVER);
    if (object >= 0x10) took(READ_PAST_PAGE);
    *flags &= (uint8_t)~(HOVERS | DIVES);
    ++*state;
    RAM[OBJECT_HEADING + object] = ROUNDS & 0x0C;
    *count = 0;
    return;
  }
  took(DEVIL_FLAG_IS_NOT);
  if (flag(object, HOVERS)) {
    // $A9EF: 16 slow rounds the way it was going, and then it aims at Arthur
    took(DEVIL_FLAG_IS);
    ++*count;
    if (*count < 0x10) {
      took(DEVIL_HOVERS);
      move_object(object, 0x08);
      took(JUMPS);
      shape(object);
      return;
    }
    *count = 0;
    took(DEVIL_AIMS);
    RAM[OBJECT_HEADING + object] = way_to_arthur(object);
    *flags |= DIVES;
    took(DEVIL_AIMED);
    if (object >= 0x10) took(READ_PAST_PAGE);
    return;
  }
  took(DEVIL_FLAG_IS_NOT);
  // $A9BC: it flies the way it's heading, faster the harder the game and faster still its third time round. Its first
  // two times it stops after 16 rounds, to hover.
  ++*count;
  if (*state < 2 && *count >= 0x10) {
    *count = 0;
    RAM[OBJECT_HEADING + object] = 0;
    *flags |= HOVERS;
    took(DEVIL_STOPS);
    if (object >= 0x10) took(READ_PAST_PAGE);
    return;
  }
  took(*state < 2 ? DEVIL_FLIES : *state == 2 ? DEVIL_FLIES_THIRD_TIME : DEVIL_FLIES_LATER);
  move_object(object, (uint8_t)((*state == 2 ? 0x18 : 0x10) + SPEED_ADDED));
  took(JUMPS);
  shape(object);
}
