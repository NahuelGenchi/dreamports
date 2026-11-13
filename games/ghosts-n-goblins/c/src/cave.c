// Ghosts'n Goblins Dreamport: the third stage, the cave, from the original's code. Kind $0A, sub_04_B45B, is a bat: it
// hangs from the ceiling where the stage's list puts it until Arthur is below it, lets go in one of the rounds its own
// number and the game's count of rounds pick, drops toward his height, and then flies at him in a wave, its two wing
// shapes by its count. One hit kills it, for 100 points, and it falls the way the weapon was going.
//
// Kind $0B, sub_04_B56F, waits in the ground, every 32 rounds looking for Arthur within 24 lines of its height. Seen,
// it picks one of three ways to shoot by its count, blinks for 16 rounds as it comes up, and stands open, sparking off
// the weapons that hit it, for 16 rounds more; then, with both shots' objects free, it shoots kind $2A, from its
// place, 16 lines higher, or both, and closes. Weapons that hit it closed don't count. Four hits kill it, for 300.

#include "game.h"

enum { ARTHUR = 0 };
// its flags: hit, dropping, flying
enum { HIT = 0x01, DROPS = 0x02, FLIES = 0x04 };
#define HITS(object) RAM[0x0647 + (object)]
#define WALK_SPEED_ADDED RAM[0xD2]
#define ROUNDS RAM[0x83]

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

// sub_04_B539: what touches it, 4 by 4. A weapon kills it: it falls the way the weapon was going, for 100 points.
static int killed(uint8_t object) {
  RAM[0x26] = RAM[0x27] = 4;
  took(BAT_TESTS);
  int arthur_touched;
  uint8_t weapon = enemy_touch_tests(object, &arthur_touched);
  if (!HITS(object)) { took(BAT_NOT_HIT); return 0; }
  took(BAT_HIT);
  set_flag(object, HIT);
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~DROPS;   // sub_F32E
  took(OBJECT_FLAG_CHANGED);
  flags_read(object);
  RAM[OBJECT_FLAGS + object] |= (RAM[OBJECT_HEADING + weapon] >> 2) & DROPS;
  took(BAT_FALL_SIDE);
  if (weapon >= 0x0F) took(READ_PAST_PAGE);
  flags_read(object);
  took(BAT_KILLED_SOUND);
  sound_play(0x16);
  RAM[0x27] = 1;   // 100 points
  RAM[0x26] = 0;
  RAM[OBJECT_COUNT + object] = 0;
  took(BAT_KILLED_SCORE);
  add_score(object, weapon);
  took(BAT_KILLED_ENDS);
  return 1;
}

// $B52E: its two wing shapes, by its count, by a jump to sub_F576.
static void wings(uint8_t object) {
  RAM[OBJECT_COUNT + object]++;
  RAM[OBJECT_SHAPE + object] = 0x78;
  took(BAT_SHAPE);
  RAM[OBJECT_SHAPE + object] += (RAM[OBJECT_COUNT + object] >> 2) & 1;
  took(FLIER_WING);
}

// Shown and in the view, or gone: once out of the view a bat that has let go is gone.
static int in_view(uint8_t object) {
  show_object(object);
  if (object_in_view(object)) { took(BAT_IN_VIEW); return 1; }
  RAM[OBJECT_FLAGS + object] = 0;
  took(BAT_GONE);
  return 0;
}

// $B470: hanging.
static void hangs(uint8_t object) {
  show_object(object);
  if (!object_in_view(object)) {
    // by a jump to sub_F346, whose return is the bat's
    took(BAT_HIDES);
    flags_read(object);
    RAM[OBJECT_FLAGS + object] &= (uint8_t)~OBJECT_FLAG_SHOWN;
    took(OBJECT_SHOWN_STORED);
    return;
  }
  took(BAT_IN_VIEW);
  if (killed(object)) { took(BAT_KILLED_RETURNS); return; }
  RAM[OBJECT_SHAPE + object] = 0x88;
  took(BAT_LOOKS);
  if (RAM[OBJECT_SCREEN_Y + object] >= RAM[OBJECT_SCREEN_Y + ARTHUR]) { took(BAT_WAITS); return; }
  if ((uint8_t)((object << 2) + ROUNDS) & 0x1F) { took(BAT_WAITS_ABOVE); return; }
  took(BAT_LETS_GO);
  set_flag(object, DROPS);
  RAM[OBJECT_HEADING + object] = 0x08;
  took(BAT_LETS_GO_DOWN);
}

// $B4AA: dropping toward Arthur's height; within 16 lines above it, it turns to fly at him.
static void drops(uint8_t object) {
  if (!in_view(object)) return;
  if (killed(object)) { took(BAT_KILLED_RETURNS); return; }
  if ((uint8_t)(RAM[OBJECT_SCREEN_Y + ARTHUR] - RAM[OBJECT_SCREEN_Y + object]) >= 0x10) took(BAT_DROPS_ON);
  else {
    took(BAT_LEVEL);
    set_flag(object, FLIES);
    RAM[OBJECT_HEADING + object] = 0x04;
    if (RAM[OBJECT_SCREEN_X + object] < RAM[OBJECT_SCREEN_X + ARTHUR]) took(BAT_FACES_RIGHT);
    else {
      RAM[OBJECT_HEADING + object] = 0x0C;
      took(BAT_FACES_LEFT);
    }
  }
  took(BAT_DROP_MOVE);
  move_object(object, 0x18);
  took(JUMPS);
  wings(object);
}

// $B4E6: flying across at him, and up or down for 2 rounds each, faster the harder the game is.
static void flies(uint8_t object) {
  if (!in_view(object)) return;
  if (killed(object)) { took(BAT_KILLED_RETURNS); return; }
  took(BAT_FLIES_ACROSS);
  move_object(object, (uint8_t)(0x10 + WALK_SPEED_ADDED));
  uint8_t heading = RAM[OBJECT_HEADING + object];
  int down = (RAM[OBJECT_COUNT + object] >> 1) & 1;
  RAM[OBJECT_HEADING + object] = down ? 0x08 : 0x00;
  took(down ? BAT_WAVE_DOWN : BAT_WAVE_UP);
  if (object >= 0x0F) took(READ_PAST_PAGE);
  move_object(object, (uint8_t)(0x0C + WALK_SPEED_ADDED));
  RAM[OBJECT_HEADING + object] = heading;
  took(BAT_WAVE_BACK);
  wings(object);
}

void bat(uint8_t object) {
  if (flag(object, HIT)) { took(BAT_DEAD); hit_enemy_falls(object); return; }
  RAM[OBJECT_COLOURS + object] = 0;
  took(BAT_ALIVE);
  if (flag(object, FLIES)) { took(BAT_FLYING); flies(object); return; }
  took(BAT_NOT_FLYING);
  if (flag(object, DROPS)) { took(BAT_DROPPING); drops(object); return; }
  took(BAT_HANGING);
  hangs(object);
}

// ---- kind $0B, sub_04_B56F

enum { SHOOTS = 0x30, RISES = 0x02, OPEN = 0x04 };
#define WAITS(object) RAM[OBJECT_STATE + (object)]

static void clear_flag(uint8_t object, uint8_t which) {
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~which;
  took(OBJECT_FLAG_CHANGED);
  flags_read(object);
}

// What touches it, 8 by 16: Arthur is hit, and a weapon sparks, $41 open or $45 closed.
static void shooter_tests(uint8_t object, uint8_t spark) {
  RAM[0x26] = 0x08;
  RAM[0x27] = 0x10;
  int arthur_touched;
  uint8_t weapon = enemy_touch_tests(object, &arthur_touched);
  if (weapon) {
    RAM[OBJECT_FLAGS + weapon] = spark;
    took(SHOOTER_WEAPON_SPARKS);
  } else took(arthur_touched ? SHOOTER_TOUCHED_ARTHUR : BRANCH_TAKEN);
}

// $B6A7: while it's closed or coming up, a hit doesn't count.
static void tests_closed(uint8_t object) {
  uint8_t hits = HITS(object);
  took(SHOOTER_TESTS_CLOSED);
  shooter_tests(object, 0x45);
  HITS(object) = hits;
  took(SHOOTER_TESTS_CLOSED_END);
}

// sub_04_B6EA: a shot in the 21st or 22nd object, at its place, heading for Arthur's side.
static void shoot_from(uint8_t object, uint8_t shot) {
  took(BIG_THROW_PLACED);   // sub_FA2E with its call
  RAM[OBJECT_Y + shot] = RAM[OBJECT_Y + object];
  RAM[OBJECT_Y_SCREEN + shot] = RAM[OBJECT_Y_SCREEN + object];
  RAM[OBJECT_SCREEN_Y + shot] = RAM[OBJECT_SCREEN_Y + object];
  RAM[OBJECT_X + shot] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + shot] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_SCREEN_X + shot] = RAM[OBJECT_SCREEN_X + object];
  RAM[OBJECT_FLAGS + shot] = 0x40;
  RAM[OBJECT_KIND + shot] = 0x2A;
  RAM[OBJECT_SHAPE + shot] = 0x8A;
  RAM[OBJECT_HEADING + shot] = 0x04;
  took(SHOOTER_SHOT_SET);
  if (arthur_is_right_of(object)) { took(SHOOTER_SHOT_RIGHT); return; }
  RAM[OBJECT_HEADING + shot] = 0x0C;
  took(SHOOTER_SHOT_LEFT);
}
// sub_04_B6C6: from its place, by a jump.
static void shoot_low(uint8_t object) { took(SHOOTER_SLOT_LOW); shoot_from(object, 0x14); }
// sub_04_B6CB: 16 lines higher, on the screen above past its top.
static void shoot_high(uint8_t object) {
  took(SHOOTER_SLOT_HIGH);
  shoot_from(object, 0x15);
  uint8_t y = RAM[OBJECT_Y + 0x15];
  RAM[OBJECT_Y + 0x15] = (uint8_t)(y - 0x10);
  if (y >= 0x10) { took(SHOOTER_HIGH_SAME_SCREEN); return; }
  RAM[OBJECT_Y + 0x15] = (uint8_t)(y - 0x20);
  RAM[OBJECT_Y_SCREEN + 0x15]--;
  took(SHOOTER_HIGH_SCREEN_ABOVE);
}

// $B5B3: in the ground, looking for Arthur every 32 rounds.
static void shooter_waits(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  RAM[OBJECT_COLOURS + object] = 0;
  RAM[OBJECT_SHAPE + object] = 0x7A;
  ++*count;
  if (*count & 0x1F) { took(SHOOTER_WAITS); tests_closed(object); return; }
  uint8_t apart = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + ARTHUR]);
  if (apart < 0xD8 && apart >= 0x18) { took(SHOOTER_ARTHUR_FAR); tests_closed(object); return; }
  took(apart >= 0xD8 ? SHOOTER_SEES_HIM_BELOW : SHOOTER_SEES_HIM_ABOVE);
  // how it will shoot, by its count: both shots, the low one, or the high one
  uint8_t way = *count & 0x60, shoots;
  if (way < 0x20) { shoots = 0x20; took(SHOOTER_PICKS_BOTH); }
  else if (way < 0x40) { shoots = 0x10; took(SHOOTER_PICKS_LOW); }
  else { shoots = 0; took(SHOOTER_PICKS_HIGH); }
  RAM[OBJECT_FLAGS + object] |= shoots;
  took(SHOOTER_PICKED);
  flags_read(object);
  set_flag(object, RISES);
  WAITS(object) = 0;
  took(SHOOTER_RISE_STATE);
  tests_closed(object);
}

// $B606: coming up, blinking, for 16 rounds.
static void shooter_rises(uint8_t object) {
  uint8_t *count = &RAM[OBJECT_COUNT + object];
  ++*count;
  RAM[OBJECT_COLOURS + object] = (*count >> 1) & 1;
  ++WAITS(object);
  if (WAITS(object) < 0x10) { took(SHOOTER_RISES_ON); tests_closed(object); return; }
  RAM[OBJECT_COLOURS + object] = 1;
  took(SHOOTER_RISEN);
  clear_flag(object, RISES);
  set_flag(object, OPEN);
  WAITS(object) = 0;
  took(SHOOTER_RISEN_STATE);
  tests_closed(object);
}

// $B62F: open, for 16 rounds, and then it shoots if both shots' objects are free.
static void shooter_open(uint8_t object) {
  took(SHOOTER_TESTS_OPEN);
  shooter_tests(object, 0x41);
  if (++WAITS(object) >= 0x10) {
    if (RAM[OBJECT_FLAGS + 0x14]) took(SHOOTER_FIRST_SLOT_TAKEN);
    else if (RAM[OBJECT_FLAGS + 0x15]) took(SHOOTER_SECOND_SLOT_TAKEN);
    else {
      took(SHOOTER_SHOOTS);
      sound_play(0x1A);
      uint8_t shoots = RAM[OBJECT_FLAGS + object] & SHOOTS;
      took(SHOOTER_SHOT_WAY);
      flags_read(object);
      if (!shoots) { took(SHOOTER_SHOOTS_HIGH); shoot_high(object); took(JUMPS); }
      else if (shoots == 0x10) { took(SHOOTER_SHOOTS_LOW); shoot_low(object); took(JUMPS); }
      else { took(SHOOTER_SHOOTS_BOTH); shoot_low(object); took(CALLS); shoot_high(object); }
      RAM[OBJECT_FLAGS + object] = 0xC0;
      took(SHOOTER_CLOSES);
      return;
    }
  } else took(SHOOTER_OPEN_ON);
  // $B65E: its open shapes by its way of shooting, turned round with Arthur on its left
  RAM[OBJECT_SHAPE + object] = (uint8_t)(0x7B + ((RAM[OBJECT_FLAGS + object] >> 4) & 3));
  took(SHOOTER_OPEN_SHAPE);
  flags_read(object);
  if (RAM[OBJECT_SCREEN_X + object] < RAM[OBJECT_SCREEN_X + ARTHUR]) { took(SHOOTER_FACES_RIGHT); return; }
  RAM[OBJECT_SHAPE + object] += 0x10;
  took(SHOOTER_FACES_LEFT);
}

void cave_shooter(uint8_t object) {
  if (flag(object, HIT)) { took(BAT_DEAD); enemy_burns_away(object); return; }
  took(BAT_HANGING);
  show_object(object);
  if (!object_in_view(object)) {
    RAM[OBJECT_FLAGS + object] = 0x40;   // out of the view it's back in the ground, its way of shooting forgotten
    took(SHOOTER_HIDDEN);
    return;
  }
  if (HITS(object) >= 4) {
    took(SHOOTER_KILLED);
    sound_play(0x1F);
    set_flag(object, HIT);
    RAM[OBJECT_COUNT + object] = 0;
    RAM[0x26] = 0;
    RAM[0x27] = 3;   // 300 points
    took(BAT_KILLED_SCORE);
    add_score(object, 0x16);   // Y, from the objects' task's look-up of its kind
    took(JUMPS);
    enemy_burns_away(object);
    return;
  }
  took(SHOOTER_ALIVE);
  if (flag(object, OPEN)) { took(BAT_FLYING); shooter_open(object); return; }
  took(BAT_NOT_FLYING);
  if (flag(object, RISES)) { took(BAT_DROPPING); shooter_rises(object); return; }
  took(BAT_HANGING);
  shooter_waits(object);
}
