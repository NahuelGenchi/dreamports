// Ghosts'n Goblins Dreamport: the flier, kind 2, from the original's code at sub_04_9FB0. It sits near the end of
// the first stage until Arthur comes close or a weapon hits it. Then it runs about on the ground for 31 rounds and
// takes off, or takes off at once when a weapon comes near. In the air it goes to a place high at one side of the
// picture, waits a few rounds, dives across at Arthur, pulls up on the other side, comes level with him and lands, and
// starts again. It shoots at him now and then, weapons that hit it throw a spark, and the fourth kills it.
//
// What it does out of the view once it's awake, at $9FC0, was written from the original's instructions and hasn't been
// run by a recording.

#include "game.h"

enum { ARTHUR = 0 };
// its flags
enum { HIT = 0x01, AWAKE = 0x02, TURNED = 0x04, FLYING = 0x08, CHANGING = 0x10, OLD = 0x20 };
// what it's doing, at $066E: on the ground, hit by a weapon and running off; in the air, the parts of its dive
enum { FLINCHES = 0x01, RUNS_OFF = 0x02, WAITS_TO_DIVE = 0x02, DIVES = 0x04, PULLS_UP = 0x08, COMES_LEVEL = 0x10 };
#define MODE(object) RAM[0x066E + (object)]
#define COUNT_HIGH(object) RAM[0x065D + (object)]   // its rounds, with its count, as 16 bits
#define HITS(object) RAM[0x0647 + (object)]
#define ROUNDS RAM[0x83]
#define STAGE_SET RAM[0xCF]
#define SPEED_ADDED RAM[0xD3]
// the two places sub_EF25 finds the way between, each a screen and a pixel down and across
enum { TO_Y = 0x73, TO_Y_SCREEN = 0x77, TO_X = 0x74, TO_X_SCREEN = 0x78, FROM_Y = 0x75, FROM_Y_SCREEN = 0x79, FROM_X = 0x76, FROM_X_SCREEN = 0x7A };
enum { VIEW_X = 0x64, VIEW_X_SCREEN = 0x65, VIEW_Y = 0x67, VIEW_Y_SCREEN = 0x68 };

static uint8_t flag(uint8_t object, uint8_t which) {
  took(OBJECT_FLAG_READ);
  if (object >= 0x10) took(READ_PAST_PAGE);
  return RAM[OBJECT_FLAGS + object] & which;
}

// sub_F687, with its call: whether Arthur is within the box in $26 and $27 around it, while it's shown.
int arthur_near(uint8_t object) {
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) { took(NEAR_NOT_SHOWN); return 0; }
  took(NEAR_LOOKED_AT);
  return arthur_touches(object);
}

// sub_F585, with its call: the tests every enemy has, and a weapon that hits it stays as a spark, with its sound.
uint8_t enemy_spark_tests(uint8_t object, int *arthur_touched) {
  took(CALLS);
  took(CALLS);
  uint8_t weapon = enemy_touch_tests(object, arthur_touched);
  if (!weapon) { took(*arthur_touched ? SPARK_TESTS_TOUCHED : SPARK_TESTS_NOTHING); return 0; }
  RAM[OBJECT_FLAGS + weapon] = 0x41;
  took(SPARK_BEGINS);
  sound_play(0x1C);
  took(SPARK_ENDS);
  return weapon;
}
static void spark_tests(uint8_t object) {
  int arthur_touched;
  enemy_spark_tests(object, &arthur_touched);
}

// It heads right or left, to the side Arthur is on.
static void head_for_his_side(uint8_t object) {
  RAM[OBJECT_HEADING + object] = 0x04;
  took(FLIER_HEADS_RIGHT);
  if (arthur_is_right_of(object)) { took(FLIER_HEADING_KEPT); return; }
  RAM[OBJECT_HEADING + object] = 0x0C;
  took(FLIER_HEADS_LEFT);
}

// $A0C9 and others: a shape, or the one 16 on when its flag $04 is set.
static void shape_by_side(uint8_t object, uint8_t shape) {
  RAM[OBJECT_SHAPE + object] = shape;
  took(FLIER_SHAPE);
  if (!flag(object, TURNED)) { took(FLIER_SHAPE_KEPT); return; }
  RAM[OBJECT_SHAPE + object] = (uint8_t)(shape + 0x10);
  took(FLIER_SHAPE_TURNED);
}

// sub_F576: its two wing shapes, four rounds each.
static void wing_shape(uint8_t object) {
  RAM[OBJECT_SHAPE + object] += (RAM[OBJECT_COUNT + object] >> 2) & 1;
  took(FLIER_WING);
}

// sub_04_A464, with its call: a move the way it's heading. The longer it's been awake and the harder the game, the
// faster, up to $20.
static void fly(uint8_t object, uint8_t speed) {
  speed = (uint8_t)(speed + COUNT_HIGH(object));
  speed = (uint8_t)(speed + SPEED_ADDED);
  took(speed >= 0x20 ? FLIER_SPEED_MOST : FLIER_SPEED);
  move_object(object, speed >= 0x20 ? 0x20 : speed);
}

// sub_04_A474: its rounds are counted. After 1,024 it flashes for 32, and from then on has its other colours.
static void counted(uint8_t object) {
  if (++RAM[OBJECT_COUNT + object]) took(FLIER_COUNTED);
  else {
    COUNT_HIGH(object)++;
    took(FLIER_COUNTED_HIGH);
  }
  if (flag(object, OLD)) { took(FLIER_IS_OLD); return; }
  uint16_t rounds = (uint16_t)(COUNT_HIGH(object) << 8 | RAM[OBJECT_COUNT + object]);
  if (rounds < 0x0400) { took(FLIER_IS_YOUNG); return; }
  if (rounds < 0x0420) {
    RAM[OBJECT_COLOURS + object] = (RAM[OBJECT_COUNT + object] >> 2) & 1;
    took(FLIER_GROWS_OLD);
    return;
  }
  RAM[OBJECT_FLAGS + object] |= OLD;
  RAM[OBJECT_COLOURS + object] = 0;
  took(FLIER_GROWN_OLD);
}

// sub_04_A4B0, with its call: every 32 rounds, and twice as often when $5B says so, it shoots at Arthur unless he's
// within 48 pixels: the shot is kind $2C, in object $14 or $15 if one is free, four pixels above its place, with
// sound $1B.
static void shoot(uint8_t object) {
  enum { FIRST_SHOT = 0x14, SHOT = 0x2C };
  RAM[0x26] = RAM[0x27] = 0x30;
  took(FLIER_SHOOT_BEGINS);
  if (arthur_near(object)) { took(FLIER_TOO_NEAR); return; }
  uint8_t when = RAM[OBJECT_COUNT + object] & 0x1F;
  if (when == 0x10) took(FLIER_SHOOTS_NOW);
  else if (!RAM[0x5B]) { took(FLIER_NO_SHOT); return; }
  else if (when != 0x18) { took(FLIER_NO_SECOND_SHOT); return; }
  else took(FLIER_SHOOTS_AGAIN);
  uint8_t shot = FIRST_SHOT;
  if (!RAM[OBJECT_FLAGS + shot]) took(FLIER_SHOT_FREE);
  else if (!RAM[OBJECT_FLAGS + ++shot]) took(FLIER_SECOND_SHOT_FREE);
  else { took(FLIER_NO_SHOT_FREE); return; }
  uint16_t down = (uint16_t)((RAM[OBJECT_Y_SCREEN + object] << 8 | RAM[OBJECT_Y + object]) - 4);
  RAM[OBJECT_KIND + shot] = SHOT;
  RAM[OBJECT_X + shot] = RAM[FROM_X] = RAM[OBJECT_X + object];
  RAM[OBJECT_X_SCREEN + shot] = RAM[FROM_X_SCREEN] = RAM[OBJECT_X_SCREEN + object];
  RAM[OBJECT_Y + shot] = RAM[FROM_Y] = (uint8_t)down;
  RAM[OBJECT_Y_SCREEN + shot] = RAM[FROM_Y_SCREEN] = (uint8_t)(down >> 8);
  RAM[TO_Y] = RAM[OBJECT_Y + ARTHUR];
  RAM[TO_Y_SCREEN] = RAM[OBJECT_Y_SCREEN + ARTHUR];
  RAM[TO_X] = RAM[OBJECT_X + ARTHUR];
  RAM[TO_X_SCREEN] = RAM[OBJECT_X_SCREEN + ARTHUR];
  took(FLIER_SHOT_MADE);
  RAM[OBJECT_HEADING + shot] = way_to_first();
  RAM[OBJECT_FLAGS + shot] = 0x40;
  took(FLIER_SHOT_HEADED);
  sound_play(0x1B);
  RAM[OBJECT_STATE + object] = 0;
  RAM[OBJECT_FLAGS + object] |= CHANGING;
  took(FLIER_SHOT);
  if (object >= 0x10) took(READ_PAST_PAGE);
}

// sub_04_A41E, with its call: when one of Arthur's weapons comes within a box around it, smaller the harder the game, it
// takes off, or in the air starts its round again. On the ground it stays when it's level with Arthur and close to him.
static void dodge(uint8_t object) {
  RAM[0x26] = RAM[0x27] = cart(4, (uint16_t)(0xA45C + RAM[0xD2]));
  if (object >= 0x10) took(READ_PAST_PAGE);
  if (!(RAM[OBJECT_FLAGS + object] & OBJECT_FLAG_SHOWN)) { took(FLIER_DODGE_NOT_SHOWN); return; }
  took(FLIER_DODGE_BEGINS);
  if (!weapon_that_touches(object)) { took(FLIER_NO_WEAPON_NEAR); return; }
  took(FLIER_WEAPON_NEAR);
  if (flag(object, FLYING)) took(FLIER_DODGES_IN_THE_AIR);
  else {
    uint8_t down = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + ARTHUR]);
    took(FLIER_DODGE_HEIGHT);
    if (down >= 0x20 && down < 0xE0) took(FLIER_DODGE_NOT_LEVEL);
    else {
      uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + object] - RAM[OBJECT_SCREEN_X + ARTHUR]);
      took(down < 0x20 ? FLIER_DODGE_LEVEL_BELOW : FLIER_DODGE_LEVEL_ABOVE);
      if (across >= 0xD0) { took(FLIER_STAYS_LEFT_OF_HIM); return; }
      if (across < 0x30) { took(FLIER_STAYS_RIGHT_OF_HIM); return; }
      took(FLIER_DODGE_FAR_ENOUGH);
    }
  }
  RAM[OBJECT_FLAGS + object] |= FLYING;
  MODE(object) = 0;
  took(FLIER_TAKES_OFF);
}

// $A38C: it faces Arthur, and what it does next is by the side he's on.
static void face_him(uint8_t object) {
  MODE(object) = 0x04;
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~TURNED;
  took(FLIER_FACES);
  if (arthur_is_right_of(object)) { took(FLIER_FACES_RIGHT); return; }
  RAM[OBJECT_FLAGS + object] |= TURNED;
  MODE(object) = 0;
  took(FLIER_FACES_LEFT);
}

// sub_04_A37F: it wakes.
static void wake(uint8_t object) {
  RAM[OBJECT_FLAGS + object] |= AWAKE;
  RAM[OBJECT_COUNT + object] = 1;
  COUNT_HIGH(object) = 0;
  took(FLIER_WAKES);
  face_him(object);
}

// sub_04_A3A2 and sub_04_A3AD, with their calls: towards a place in the picture, 32 pixels in from the side it faces away
// from and at a height: Arthur's, or with `high` 64 down, or 80 when he's low. Within five pixels of it, it stays.
static void fly_to_place(uint8_t object, int high) {
  uint8_t height = RAM[OBJECT_SCREEN_Y + ARTHUR];
  if (high) {
    took(height >= 0xA0 ? FLIER_PLACE_HIGH_FOR_LOW : FLIER_PLACE_HIGH);
    height = height >= 0xA0 ? 0x50 : 0x40;
  } else took(FLIER_PLACE_HIS_HEIGHT);
  uint16_t down = (uint16_t)(height + RAM[VIEW_Y]);
  RAM[0x22] = height;
  RAM[TO_Y_SCREEN] = RAM[VIEW_Y_SCREEN];
  RAM[TO_Y] = (uint8_t)down;
  if (down < 0xF0) took(FLIER_PLACE_ON_SCREEN);
  else {
    // past the screen's 240 lines, on the next screen down
    RAM[TO_Y_SCREEN]++;
    RAM[TO_Y] += 0x10;
    took(down > 0xFF ? FLIER_PLACE_NEXT_SCREEN_CARRIED : FLIER_PLACE_NEXT_SCREEN);
  }
  uint8_t turned = flag(object, TURNED), side = turned ? 0xE0 : 0x20;
  took(turned ? FLIER_PLACE_RIGHT : FLIER_PLACE_LEFT);
  uint16_t across = (uint16_t)((RAM[VIEW_X_SCREEN] << 8 | RAM[VIEW_X]) + side);
  RAM[0x23] = side;
  RAM[TO_X] = (uint8_t)across;
  RAM[TO_X_SCREEN] = (uint8_t)(across >> 8);
  took(FLIER_PLACE_ACROSS);
  uint8_t off = (uint8_t)(height - RAM[OBJECT_SCREEN_Y + object]);
  took(FLIER_PLACE_HEIGHT_OFF);
  if (off < 5 || off >= 0xFB) {
    took(off < 5 ? FLIER_PLACE_HEIGHT_REACHED : FLIER_PLACE_HEIGHT_REACHED_FROM_BELOW);
    off = (uint8_t)(RAM[OBJECT_SCREEN_X + object] - side);
    took(FLIER_PLACE_SIDE_OFF);
    if (off < 5) { took(FLIER_PLACE_REACHED); return; }
    if (off >= 0xFB) { took(FLIER_PLACE_REACHED_FROM_LEFT); return; }
    took(FLIER_PLACE_SIDE_FAR);
  } else took(FLIER_PLACE_HEIGHT_FAR);
  RAM[FROM_Y] = RAM[OBJECT_Y + object];
  RAM[FROM_Y_SCREEN] = RAM[OBJECT_Y_SCREEN + object];
  RAM[FROM_X] = RAM[OBJECT_X + object];
  RAM[FROM_X_SCREEN] = RAM[OBJECT_X_SCREEN + object];
  took(FLIER_PLACE_WAY);
  RAM[OBJECT_HEADING + object] = way_to_first();
  took(FLIER_PLACE_HEADED);
  move_object(object, 0x28);
}

// $A1E3: its shape in the air. After a shot it holds its arms out for three rounds.
static void shape_in_the_air(uint8_t object) {
  shape_by_side(object, 0x5C);
  if (!flag(object, CHANGING)) {
    took(FLIER_AIR_SHAPE);
    wing_shape(object);
    return;
  }
  if (++RAM[OBJECT_STATE + object] < 4) {
    RAM[OBJECT_SHAPE + object] = (uint8_t)((RAM[OBJECT_SHAPE + object] & 0xF0) | 0x0B);
    took(FLIER_AIR_SHAPE_AFTER_SHOT);
    return;
  }
  RAM[OBJECT_FLAGS + object] &= (uint8_t)~CHANGING;
  took(FLIER_AIR_SHAPE_SHOT_OVER);
  took(JUMPS);
  wing_shape(object);
}

// $A1E0: the end of a round in the air.
static void round_in_the_air(uint8_t object) {
  took(CALLS);
  counted(object);
  shape_in_the_air(object);
}

// $A33B: level with Arthur, within eight pixels, it lands on a 32nd round and faces him. Until then it flies to his
// height at its side of the picture.
static void come_level(uint8_t object) {
  uint8_t off = (uint8_t)(RAM[OBJECT_SCREEN_Y + object] - RAM[OBJECT_SCREEN_Y + ARTHUR]);
  took(FLIER_LEVEL_LOOKED_AT);
  if (off < 8 || off >= 0xF8) {
    took(off < 8 ? FLIER_IS_LEVEL : FLIER_IS_LEVEL_FROM_ABOVE);
    head_for_his_side(object);
    took(FLIER_COUNT_READ);
    if (!(RAM[OBJECT_COUNT + object] & 0x1F)) {
      MODE(object) = 0;
      RAM[OBJECT_FLAGS + object] &= (uint8_t)~FLYING;
      took(FLIER_LANDS);
      face_him(object);
      return;
    }
    took(FLIER_NOT_YET);
  } else took(FLIER_NOT_LEVEL);
  fly_to_place(object, 0);
  dodge(object);
  took(JUMPS);
  round_in_the_air(object);
}

// $A30A: after its dive it goes back up to its place, and from above the picture's 88th line, on a 32nd round, comes
// level with Arthur.
static void pull_up(uint8_t object) {
  took(FLIER_COUNT_READ);
  if (RAM[OBJECT_SCREEN_Y + object] < 0x58) {
    took(FLIER_IS_HIGH);
    head_for_his_side(object);
    took(FLIER_COUNT_READ);
    if (!(RAM[OBJECT_COUNT + object] & 0x1F)) {
      MODE(object) |= COMES_LEVEL;
      took(FLIER_COMES_LEVEL);
      come_level(object);
      return;
    }
    took(FLIER_NOT_YET);
  } else took(FLIER_NOT_YET);
  fly_to_place(object, 1);
  dodge(object);
  took(JUMPS);
  round_in_the_air(object);
}

// $A28B: the dive. It flies the way it was headed, and near Arthur slides across as well, by the speed in its state,
// which doubles every eighth round up to 12 pixels. At his height it turns round and pulls up.
static void dive(uint8_t object) {
  uint8_t *state = &RAM[OBJECT_STATE + object];
  took(FLIER_DIVE_HEIGHT);
  if (RAM[OBJECT_SCREEN_Y + object] < RAM[OBJECT_SCREEN_Y + ARTHUR]) took(FLIER_NOT_YET);
  else {
    RAM[OBJECT_FLAGS + object] ^= TURNED;
    MODE(object) |= PULLS_UP;
    took(FLIER_DIVE_ENDS);
    took(CALLS);
    counted(object);
  }
  fly(object, 0x1E);
  uint8_t across = (uint8_t)(RAM[OBJECT_SCREEN_X + ARTHUR] - RAM[OBJECT_SCREEN_X + object]);
  int slides = 1;
  took(FLIER_DIVE_ACROSS);
  if (across < 0x60) took(FLIER_DIVE_NEAR_RIGHT);
  else if (across < 0xA0) { took(FLIER_DIVE_FAR); slides = 0; }
  else took(FLIER_DIVE_NEAR_LEFT);
  if (slides) {
    uint8_t arthur = RAM[OBJECT_SCREEN_Y + ARTHUR], own = RAM[OBJECT_SCREEN_Y + object];
    took(FLIER_DIVE_DOWN);
    if (arthur < own) took(FLIER_DIVE_BELOW_HIM);
    else if ((uint8_t)(arthur - own) >= 0x30) { took(FLIER_DIVE_HIGH_ABOVE_HIM); slides = 0; }
    else took(FLIER_DIVE_ABOVE_HIM);
  }
  if (slides) {
    RAM[0x22] = *state & 0x80 ? 0xFF : 0;
    took(*state & 0x80 ? FLIER_SLIDES_LEFT : FLIER_SLIDES_RIGHT);
    uint16_t place = (uint16_t)((RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]) + (int8_t)*state);
    RAM[OBJECT_X + object] = (uint8_t)place;
    RAM[OBJECT_X_SCREEN + object] = (uint8_t)(place >> 8);
    took(FLIER_SLID);
    if (RAM[OBJECT_COUNT + object] & 7) took(FLIER_SLIDE_KEPT);
    else {
      *state = (uint8_t)(*state << 1);
      took(FLIER_SLIDE_DOUBLED);
      if (*state & 0x80) {
        if (*state >= 0xF0) took(FLIER_SLIDE_LEFT_SLOW);
        else {
          *state = 0xF4;
          took(FLIER_SLIDE_LEFT_FASTEST);
        }
      } else if (*state < 0x10) took(FLIER_SLIDE_RIGHT_SLOW);
      else {
        *state = 0x0C;
        took(FLIER_SLIDE_RIGHT_FASTEST);
      }
    }
  }
  took(JUMPS);
  round_in_the_air(object);
}

// $A215: at its place it counts the rounds its state has. Then the dive begins: its state becomes a 16th of how far
// across Arthur is, signed, and it heads for him, a 16th of a turn nearer straight down.
static void wait_to_dive(uint8_t object) {
  uint8_t *state = &RAM[OBJECT_STATE + object], *heading = &RAM[OBJECT_HEADING + object];
  if (--*state) took(FLIER_WAITS_ON);
  else {
    int16_t apart = (int16_t)((RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]) - (RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]));
    took(FLIER_DIVE_APART);
    if (apart >= 0) took(FLIER_HEADING_KEPT);
    else {
      apart = (int16_t)-apart;
      took(FLIER_DIVE_APART_LEFT);
    }
    apart >>= 4;
    RAM[TO_X] = (uint8_t)apart;
    RAM[TO_X_SCREEN] = (uint8_t)(apart >> 8);
    *state = (uint8_t)apart;
    took(FLIER_DIVE_SIXTEENTH);
    if (arthur_is_right_of(object)) took(FLIER_HEADING_KEPT);
    else {
      *state = (uint8_t)-*state;
      took(FLIER_DIVE_SPEED_LEFT);
    }
    MODE(object) |= DIVES;
    // sub_FA58
    RAM[FROM_Y] = RAM[OBJECT_Y + object];
    RAM[FROM_Y_SCREEN] = RAM[OBJECT_Y_SCREEN + object];
    RAM[FROM_X] = RAM[OBJECT_X + object];
    RAM[FROM_X_SCREEN] = RAM[OBJECT_X_SCREEN + object];
    RAM[TO_Y] = RAM[OBJECT_Y + ARTHUR];
    RAM[TO_Y_SCREEN] = RAM[OBJECT_Y_SCREEN + ARTHUR];
    RAM[TO_X] = RAM[OBJECT_X + ARTHUR];
    RAM[TO_X_SCREEN] = RAM[OBJECT_X_SCREEN + ARTHUR];
    took(FLIER_DIVE_AIMED);
    *heading = way_to_first();
    took(FLIER_DIVE_HEADED);
    if (*heading >= 8) {
      --*heading;
      took(FLIER_DIVE_TURNED_BACK);
      if (*heading >= 8) took(FLIER_NOT_YET);
      else {
        *heading = 8;
        took(FLIER_DIVE_STRAIGHT_DOWN_FROM_LEFT);
      }
    } else {
      ++*heading;
      took(FLIER_DIVE_TURNED_ON);
      if (*heading < 8) took(FLIER_NOT_YET);
      else {
        *heading = 8;
        took(FLIER_DIVE_STRAIGHT_DOWN);
      }
    }
  }
  fly(object, 0x10);
  took(JUMPS);
  round_in_the_air(object);
}

// $A172: in the air.
static void in_the_air(uint8_t object) {
  RAM[0x26] = RAM[0x27] = 8;
  took(FLIER_TESTS_BOX);
  spark_tests(object);
  if (MODE(object) & COMES_LEVEL) { took(FLIER_MODE_IS); come_level(object); return; }
  took(FLIER_MODE_IS_NOT);
  if (MODE(object) & PULLS_UP) { took(FLIER_MODE_IS); pull_up(object); return; }
  took(FLIER_MODE_IS_NOT);
  if (MODE(object) & DIVES) { took(FLIER_MODE_IS); dive(object); return; }
  took(FLIER_MODE_IS_NOT);
  if (MODE(object) & WAITS_TO_DIVE) { took(FLIER_MODE_IS); wait_to_dive(object); return; }
  took(FLIER_MODE_IS_NOT);
  // $A1A3: to its place high in the picture, where on an eighth round it starts to wait, one to eight rounds
  shoot(object);
  took(FLIER_COUNT_READ);
  if (RAM[OBJECT_SCREEN_Y + object] < 0x58) {
    took(FLIER_IS_HIGH);
    head_for_his_side(object);
    took(FLIER_COUNT_READ);
    if (RAM[OBJECT_COUNT + object] & 7) took(FLIER_NOT_YET);
    else {
      took(FLIER_IS_HIGH);
      if (flag(object, CHANGING)) took(FLIER_NOT_YET);
      else {
        RAM[OBJECT_STATE + object] = (uint8_t)((ROUNDS & 7) + 1);
        MODE(object) |= WAITS_TO_DIVE;
        took(FLIER_WAIT_BEGINS);
        counted(object);
        return;
      }
    }
  } else took(FLIER_NOT_YET);
  fly_to_place(object, 1);
  round_in_the_air(object);
}

// $A063: awake on the ground, facing Arthur. On its 31st round it takes off. Until then it steps away from him when
// he's within 88 pixels and towards him otherwise, choosing every fourth round, and every 32nd runs off the way he
// is for 16 rounds. A weapon that hits it stops it for the rest of four rounds.
static void awake_on_the_ground(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object], *count = &RAM[OBJECT_COUNT + object];
  *flags &= (uint8_t)~TURNED;
  took(OBJECT_FLAG_CHANGED);
  if (arthur_is_right_of(object)) took(FLIER_HEADING_KEPT);
  else {
    *flags |= TURNED;
    took(FLIER_GROUND_TURNED);
  }
  took(FLIER_COUNT_READ);
  if (*count == 0x1F) {
    *flags |= FLYING;
    MODE(object) = 0;
    took(FLIER_GROUND_TAKES_OFF);
    return;
  }
  uint8_t hits = HITS(object);
  RAM[0x26] = RAM[0x27] = 0x0A;
  took(FLIER_GROUND_TESTS);
  spark_tests(object);
  took(FLIER_GROUND_HITS_READ);
  if (hits == HITS(object)) took(FLIER_NOT_YET);
  else if (hits >= 3) { took(FLIER_GROUND_LAST_HIT); return; }
  else {
    MODE(object) |= FLINCHES;
    took(FLIER_GROUND_HIT);
  }
  took(FLIER_COUNT_READ);
  int stopped = 0;
  if (!(MODE(object) & FLINCHES)) took(FLIER_NOT_YET);
  else {
    took(FLIER_COUNT_READ_ON);
    if (*count & 3) {
      took(FLIER_NOT_YET);
      shape_by_side(object, 0x5E);
      took(JUMPS);
      stopped = 1;
    } else {
      MODE(object) &= 0x0E;
      took(FLIER_GROUND_FLINCH_OVER);
    }
  }
  if (!stopped) {
    // $A0C9
    shape_by_side(object, 0x59);
    if (!flag(object, CHANGING)) took(FLIER_NOT_YET);
    else {
      RAM[OBJECT_STATE + object]++;
      *flags &= (uint8_t)~CHANGING;
      took(FLIER_GROUND_SHOT_OVER);
    }
    took(CALLS);
    wing_shape(object);
    took(FLIER_COUNT_READ);
    if (MODE(object) & RUNS_OFF) {
      // $A154
      took(FLIER_GROUND_RUNS);
      took(FLIER_COUNT_READ);
      if (MODE(object) & FLINCHES) took(FLIER_NOT_YET);
      else {
        took(FLIER_COUNT_READ_ON);
        if (*count & 0x0F) took(FLIER_NOT_YET);
        else {
          MODE(object) &= (uint8_t)~RUNS_OFF;
          took(FLIER_GROUND_RUN_OVER);
        }
        fly(object, 0x0E);
      }
      took(JUMPS);
      counted(object);
      return;
    }
    took(FLIER_COUNT_READ_ON);
    if (*count & 3) took(FLIER_NOT_YET);
    else {
      took(FLIER_IS_HIGH);
      head_for_his_side(object);
      RAM[0x26] = RAM[0x27] = 0x58;
      took(FLIER_TESTS_BOX);
      if (!arthur_near(object)) took(FLIER_NOT_YET);
      else {
        RAM[OBJECT_HEADING + object] ^= 0x08;
        took(FLIER_GROUND_STEPS_AWAY);
      }
    }
    fly(object, 0x10);
    took(FLIER_COUNT_READ);
    if (*count & 0x1F) took(FLIER_NOT_YET);
    else {
      MODE(object) |= RUNS_OFF;
      took(FLIER_GROUND_RUN_BEGINS);
      head_for_his_side(object);
    }
  }
  // $A14B
  shoot(object);
  dodge(object);
  took(JUMPS);
  counted(object);
}

void flier(uint8_t object) {
  uint8_t *flags = &RAM[OBJECT_FLAGS + object];
  show_object(object);
  if (!object_in_view(object)) {
    took(FLIER_OUT_OF_VIEW);
    hide_object(object);
    if (!flag(object, AWAKE)) { took(FLIER_WAITS); return; }
    // $9FC0: awake, it's gone once Arthur is a screen or more away, across or down
    took(FLIER_AWAY_LOOKED_AT);
    int right = arthur_is_right_of(object);
    uint16_t across = (uint16_t)((RAM[OBJECT_X_SCREEN + ARTHUR] << 8 | RAM[OBJECT_X + ARTHUR]) - (RAM[OBJECT_X_SCREEN + object] << 8 | RAM[OBJECT_X + object]));
    uint16_t down = (uint16_t)((RAM[OBJECT_Y_SCREEN + object] << 8 | RAM[OBJECT_Y + object]) - (RAM[OBJECT_Y_SCREEN + ARTHUR] << 8 | RAM[OBJECT_Y + ARTHUR]));
    uint8_t screens = (uint8_t)(across >> 8);
    (void)right;
    if (screens != 0 && screens != 0xFF) {
      took(FLIER_AWAY_ACROSS);
      remove_object(object);
      return;
    }
    took(screens ? FLIER_NEAR_ACROSS_LEFT : FLIER_NEAR_ACROSS_RIGHT);
    screens = (uint8_t)(down >> 8);
    took(FLIER_AWAY_DOWN_LOOKED_AT);
    if (screens == 0xFF) { took(FLIER_NEAR_ABOVE); return; }
    if (screens == 0) { took(FLIER_NEAR_BELOW); return; }
    took(FLIER_AWAY_DOWN);
    remove_object(object);
    return;
  }
  RAM[OBJECT_COLOURS + object] = 0;
  took(FLIER_IN_VIEW);
  if (flag(object, OLD)) took(FLIER_NOT_YET);
  else {
    RAM[OBJECT_COLOURS + object]++;
    took(FLIER_COLOURS_YOUNG);
  }
  if (flag(object, HIT)) {
    took(FLIER_STATE_IS);
    enemy_burns_away(object);
    return;
  }
  took(FLIER_HITS_READ);
  if (HITS(object) >= 4) {
    // $A000: the fourth hit kills it, for 1,000 points, with sound $1F
    took(FLIER_KILLED);
    sound_play(0x1F);
    *flags |= HIT;
    RAM[OBJECT_COUNT + object] = 0;
    RAM[0x26] = RAM[0x27] = RAM[0x25] = 0;
    RAM[0x24] = 1;
    took(FLIER_KILLED_SCORE);
    if (object >= 0x10) took(READ_PAST_PAGE);
    add_score_with_thousands(object, 0);
    took(JUMPS);
    enemy_burns_away(object);
    return;
  }
  took(FLIER_NOT_YET);
  if (flag(object, FLYING)) {
    took(FLIER_STATE_IS);
    in_the_air(object);
    return;
  }
  took(FLIER_NOT_YET);
  if (flag(object, AWAKE)) {
    took(FLIER_STATE_IS);
    awake_on_the_ground(object);
    return;
  }
  took(FLIER_NOT_YET);
  // $A02B: asleep, it wakes when Arthur is within 48 pixels, or when a weapon has hit it
  RAM[OBJECT_SHAPE + object] = 0x57;
  RAM[OBJECT_COLOURS + object] = 0x01;
  RAM[0x26] = RAM[0x27] = 0x30;
  if (STAGE_SET == 5) {
    RAM[0x26] = 0x50;
    RAM[0x27] = 0x20;
  }
  took(STAGE_SET == 5 ? FLIER_SITS_IN_SIXTH_SET : FLIER_SITS);
  if (!arthur_near(object)) took(FLIER_NOT_YET);
  else {
    took(FLIER_SEES_HIM);
    wake(object);
  }
  RAM[0x26] = RAM[0x27] = 8;
  took(FLIER_TESTS_BOX);
  spark_tests(object);
  if (!HITS(object)) { took(FLIER_SLEEPS_ON); return; }
  took(FLIER_WOKEN_BY_HIT);
  wake(object);
  took(RETURNS);
}
