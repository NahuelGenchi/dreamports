// Ghosts'n Goblins Dreamport: the third stage, the cave, from the original's code. Kind $0A, sub_04_B45B, is a bat: it
// hangs from the ceiling where the stage's list puts it until Arthur is below it, lets go in one of the rounds its own
// number and the game's count of rounds pick, drops toward his height, and then flies at him in a wave, its two wing
// shapes by its count. One hit kills it, for 100 points, and it falls the way the weapon was going.

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
