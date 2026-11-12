// Ghosts'n Goblins Dreamport: the boss that stands at the end of a stage, kind 5, from the original's code at $FBC4.
// The stage's list places it with $D673 (flow.c), in an object taken for it if none is free. Out of the view it's
// hidden. In the view it stands asleep, with its touch tests, until Arthur comes within a box around it, or has been
// level with it or above for 40 rounds, or has hit it three times: then it wakes, facing him.
//
// What it does awake, from $FC3F, its death after ten hits, at $FC10, and the last stage's, which $CF marks, aren't
// ported yet.

#include "game.h"

enum { ARTHUR = 0 };
// its flags
enum { HIT = 0x01, FACES_LEFT = 0x02, READY = 0x20 };
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
  took(BOSS_ASLEEP);
  if (HITS(object) >= 0x0A || AWAKE(object)) return;   // $FC10 and $FC3F: not ported yet
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
