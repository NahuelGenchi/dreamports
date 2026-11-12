// Ghosts'n Goblins Dreamport: Arthur's task, from the original's code at $DA71. Arthur is the first object, and his task
// moves him, a turn a round: in the opening scene, where he sits by the princess, jumps up after Satan, and walks to his
// armour, and in a stage, where he falls to the ground and stands, and where the first thing that hits him knocks him
// back out of his armour and the next kills him. The view follows him as he moves.
//
// In a stage Left and Right walk him, A jumps and B throws his weapon. Up climbs a ladder he stands at, from $DC6B, and
// Down climbs down one whose top he stands on, from $DD65, or has him crouch, at $DD14.

#include "game.h"

enum { ARTHUR = 0, SATAN = 2 };
// Arthur's flags
enum { HIT = 0x01, CROUCHES = 0x02, TURNED = 0x04, IN_THE_AIR = 0x08, HELD = 0x10, WITHOUT_ARMOUR = 0x20, CANNOT_BE_TOUCHED = 0x40 };  // TURNED: he faces the other way, and his shapes are 4 on
#define JUMP_MOVES_ACROSS (0x065D + ARTHUR)   // 0 while a jump goes straight up
// the view's place in the stage (scroll.c), and the speed its task is asked to move it at, each 24 bits
enum { VIEW_X = 0x63, VIEW_Y = 0x66, VIEW_SPEED_X = 0x5C, VIEW_SPEED_Y = 0x5F };
#define STAGE_SET RAM[0xCF]
// his fields
#define FLAGS RAM[OBJECT_FLAGS + ARTHUR]
#define X RAM[OBJECT_X + ARTHUR]
#define X_SCREEN RAM[OBJECT_X_SCREEN + ARTHUR]
#define Y RAM[OBJECT_Y + ARTHUR]
#define Y_SCREEN RAM[OBJECT_Y_SCREEN + ARTHUR]
#define SCREEN_X RAM[OBJECT_SCREEN_X + ARTHUR]
#define SCREEN_Y RAM[OBJECT_SCREEN_Y + ARTHUR]
#define COUNT RAM[OBJECT_COUNT + ARTHUR]
#define STATE RAM[OBJECT_STATE + ARTHUR]
#define HEADING RAM[OBJECT_HEADING + ARTHUR]
#define SHAPE RAM[OBJECT_SHAPE + ARTHUR]
#define COLOURS RAM[OBJECT_COLOURS + ARTHUR]

// sub_DBFB: the view is asked to move across so that Arthur is in the middle of the picture, by at most 7 pixels to
// the right or 8 to the left.
static void view_follows_across(void) {
  uint32_t middle = (uint32_t)(RAM[VIEW_X + 2] << 16 | RAM[VIEW_X + 1] << 8 | RAM[VIEW_X]) + 0x8000;
  uint32_t ahead = (uint32_t)(X_SCREEN << 16 | X << 8 | RAM[OBJECT_X_PART + ARTHUR]) - middle;
  RAM[0x7C] = RAM[VIEW_X];
  RAM[0x74] = (uint8_t)(middle >> 8);
  RAM[0x78] = (uint8_t)(middle >> 16);
  RAM[VIEW_SPEED_X] = (uint8_t)ahead;
  RAM[VIEW_SPEED_X + 1] = (uint8_t)(ahead >> 8);
  RAM[VIEW_SPEED_X + 2] = (uint8_t)(ahead >> 16);
  uint8_t pixels = RAM[VIEW_SPEED_X + 1];
  took(FOLLOW_ACROSS);
  if (pixels & 0x80) {
    took(pixels < 0xF8 ? FOLLOW_LEFT_FAR : FOLLOW_LEFT_NEAR);
    if (pixels < 0xF8) RAM[VIEW_SPEED_X + 1] = 0xF8;
  } else {
    took(pixels >= 7 ? FOLLOW_RIGHT_FAR : FOLLOW_RIGHT_NEAR);
    if (pixels >= 7) RAM[VIEW_SPEED_X + 1] = 7;
  }
}

// sub_DB99: and down, so that he's 144 pixels below its top, by at most 7 pixels down or 8 up. A screen is 240 pixels
// high, so 16 are taken off or put back where the two are on different screens.
static void view_follows_down(void) {
  RAM[0x7B] = RAM[VIEW_Y];
  uint16_t line = (uint16_t)(RAM[VIEW_Y + 1] + 0x90);
  RAM[0x77] = RAM[VIEW_Y + 2];
  took(FOLLOW_DOWN);
  if (line >= 0xF0) {   // $DBB0: past the screen's 240 lines, on the next screen down
    took(line > 0xFF ? FOLLOW_DOWN_NEXT_SCREEN_CARRIED : FOLLOW_DOWN_NEXT_SCREEN);
    line = (uint8_t)line + 0x10;
    RAM[0x77]++;
  }
  RAM[0x73] = (uint8_t)line;
  uint32_t below = (uint32_t)(Y_SCREEN << 16 | Y << 8 | RAM[OBJECT_Y_PART + ARTHUR]) - (uint32_t)(RAM[0x77] << 16 | RAM[0x73] << 8 | RAM[0x7B]);
  RAM[VIEW_SPEED_Y] = (uint8_t)below;
  RAM[VIEW_SPEED_Y + 1] = (uint8_t)(below >> 8);
  RAM[VIEW_SPEED_Y + 2] = (uint8_t)(below >> 16);
  uint8_t pixels = RAM[VIEW_SPEED_Y + 1];
  took(FOLLOW_DOWN_APART);
  if (Y_SCREEN != RAM[0x77]) {
    took(pixels & 0x80 ? FOLLOW_DOWN_SCREEN_ABOVE : FOLLOW_DOWN_SCREEN_BELOW);
    pixels = (uint8_t)(pixels & 0x80 ? pixels + 0x10 : pixels - 0x10);
  }
  if (pixels & 0x80) {
    took(pixels < 0xF8 ? FOLLOW_UP_FAR : FOLLOW_UP_NEAR);
    if (pixels < 0xF8) pixels = 0xF8;
  } else {
    took(pixels >= 7 ? FOLLOW_DOWN_FAR : FOLLOW_DOWN_NEAR);
    if (pixels >= 7) pixels = 7;
  }
  RAM[VIEW_SPEED_Y + 1] = pixels;
}

// sub_E166: his place down, on top of the block he's landed on.
static void stand_on_block(void) { Y = (uint8_t)((Y & 0xF0) | 0x08); }

// sub_DF62: whether something is in his way: a solid block 8 pixels ahead of him, 4 below his place, or the edge of the
// picture. $D1 keeps the answer.
static int way_blocked(void) {
  int left = HEADING == 0x0C;
  uint16_t ahead = (uint16_t)((X_SCREEN << 8 | X) + (left ? -8 : 8));
  RAM[0x74] = (uint8_t)ahead;
  RAM[0x78] = (uint8_t)(ahead >> 8);
  RAM[0x77] = Y_SCREEN;
  RAM[0x73] = (uint8_t)(Y + 4);
  took(left ? WAY_AHEAD_LEFT : WAY_AHEAD_RIGHT);
  int solid = block_at_stage_place() >= BLOCK_SOLID, edge = left ? SCREEN_X < 0x10 : SCREEN_X >= 0xF0;
  took(solid ? WAY_SOLID : left ? (edge ? WAY_LEFT_EDGE : WAY_LEFT_FREE) : edge ? WAY_RIGHT_EDGE : WAY_RIGHT_FREE);
  RAM[0xD1] = solid || edge ? 0x80 : 0;
  return solid || edge;
}

// sub_DB82, or sub_E286 for half as far: some 256ths of the way he's heading, with the view after him, unless
// something's in his way.
static void drift_unless(int blocked, uint8_t speed) {
  if (blocked) { took(JUMP_BLOCKED); return; }
  took(JUMP_DRIFTS);
  move_object(ARTHUR, speed);
  took(JUMPS);
  view_follows_across();
}
static void drift(uint8_t speed) { drift_unless(way_blocked(), speed); }

// sub_DDA1: what the direction buttons ask for, from the copy's list at $E307: 0 for nothing, and otherwise a heading,
// whose bit $04 says it's across. It's also where $85, B held since before, is cleared.
static uint8_t direction(void) {
  if (!(PAD_NOW & PAD_B)) RAM[0x85] = 0;
  took(PAD_NOW & PAD_B ? ARTHUR_DIRECTION_B_HELD : ARTHUR_DIRECTION);
  return cart(7, (uint16_t)(0xE307 + (PAD_NOW & 0x0F)));
}

// sub_DF3E: down by some pixels, with the view after him once he's low in the picture. Onto the next screen down, at
// $DF49, isn't ported yet.
static void fall_by(uint8_t pixels) {
  Y += pixels;
  took(SCREEN_Y >= 0x90 ? ARTHUR_FELL_LOW : ARTHUR_FELL_HIGH);
  if (SCREEN_Y >= 0x90) view_follows_down();
}

// sub_DB90 and $E4E5: his place on the screen, for this round's sprites.
static void throw_button(void);
static void placed(int with_buttons) {
  took(CALLS);
  if (with_buttons) throw_button();
  place_on_screen(ARTHUR);
  FLAGS &= (uint8_t)~HELD;
  STATE &= 0xF7;
  took(ARTHUR_TURN_YIELDS);
}

static void flash_after_a_hit(void);

// sub_E9CE and sub_EA2F: the block of the stage at his place, or 11 pixels below it. A place whose 11 pixels below are
// on the next screen down, at $EA44, isn't ported yet.
static uint8_t block_at_him(uint8_t below) {
  RAM[0x22] = below;
  RAM[0x77] = Y_SCREEN;
  RAM[0x73] = (uint8_t)(Y + below);
  RAM[0x78] = X_SCREEN;
  RAM[0x74] = X;
  took(below ? BLOCK_BELOW_ARTHUR : BLOCK_AT_ARTHUR);
  return block_at_stage_place();
}

// sub_DC3E and sub_DC38: whether a ladder is at his place, or under his feet. A ladder's blocks are $BA to $CF.
static int ladder(int under) {
  took(CALLS);
  uint8_t block = block_at_him(under ? 0x0B : 0);
  if (under) took(JUMPS);
  took(block < 0xBA ? LADDER_BLOCK_BELOW_ITS : block < 0xD0 ? LADDER_BLOCK_IS : LADDER_BLOCK_PAST_ITS);
  return block >= 0xBA && block < 0xD0;
}

// sub_DC5B and sub_DC4D: his colours, in a stage and on a ladder, with his armour or without.
static void stage_colours(void) {
  took(ARTHUR_COLOURS);
  if (FLAGS & WITHOUT_ARMOUR) took(ARTHUR_NO_ARMOUR_COLOURS);
  COLOURS = FLAGS & WITHOUT_ARMOUR ? 0x02 : 0x08;
}
static void ladder_colours(void) {
  took(ARTHUR_COLOURS);
  if (FLAGS & WITHOUT_ARMOUR) took(ARTHUR_NO_ARMOUR_COLOURS);
  COLOURS = FLAGS & WITHOUT_ARMOUR ? 0x02 : 0x01;
}

// sub_DDB2: his two shapes on a ladder, two rounds each as he climbs.
static void climb_shape(void) {
  COUNT++;
  SHAPE = (uint8_t)((0x14 + ((COUNT >> 1) & 1)) | (FLAGS & WITHOUT_ARMOUR));
  took(CLIMB_SHAPE);
  flash_after_a_hit();
}

// $DCAC and $DD05: a step up or down the ladder, the way he's heading, with the view after him.
static void climb(void) {
  took(CLIMB_MOVES);
  move_object(ARTHUR, 0x0C);
  took(JUMPS);
  view_follows_across();
  climb_shape();
}

// sub_E079: a throw's two shapes, three rounds, by the way he faces, whether he crouches and whether he has armour.
static void throw_shape(void) {
  SHAPE = (uint8_t)((8 + ((RAM[OBJECT_KIND + ARTHUR] >> 1) & 1) + ((FLAGS >> 1) & 2) + ((FLAGS << 1) & 4)) | (FLAGS & WITHOUT_ARMOUR));
  if (++RAM[OBJECT_KIND + ARTHUR] >= 3) STATE &= 0xFD;
  took(STATE & 0x02 ? ARTHUR_THROW_GOES_ON : ARTHUR_THROW_OVER);
}

// sub_E35E and sub_E3B9: his shape. The copy's list at $E3DC gives the six steps of his walk, and his shapes without
// armour are 32 on from those with it, and the ones facing left 4 on. His other states, at $E317, $E36B and $E382, and
// his flashing after he's hit, at $E3BE, aren't ported yet.
static void choose_shape(void) {
  if (STATE & 0x02) {
    took(ARTHUR_THROW_SHAPE);
    throw_shape();
    flash_after_a_hit();
    return;
  }
  took(ARTHUR_SHAPE);
  if (COUNT >= 6) took(ARTHUR_SHAPE_STARTS_AGAIN);
  if (COUNT >= 6) COUNT = 0;
  SHAPE = (uint8_t)(((FLAGS & TURNED) | (FLAGS & WITHOUT_ARMOUR)) + cart(7, (uint16_t)(0xE3DC + COUNT)));
  flash_after_a_hit();
}

// sub_E3B9: while nothing can touch him, after a hit, he's shown every other round, for 30 rounds.
static void flash_after_a_hit(void) {
  if (!(FLAGS & CANNOT_BE_TOUCHED)) { took(ARTHUR_FLASH_LOOKED_AT); return; }
  took(ARTHUR_FLASH_COUNTED);
  if (++RAM[0x0647 + ARTHUR] >= 30) {
    FLAGS &= (uint8_t)~CANNOT_BE_TOUCHED;
    took(ARTHUR_FLASH_OVER);
    return;
  }
  FLAGS &= (uint8_t)~OBJECT_FLAG_SHOWN;
  if (RAM[0x0647 + ARTHUR] & 1) FLAGS |= OBJECT_FLAG_SHOWN;
  took(ARTHUR_FLASHES);
}

// How far he rises or falls this round of a jump, from the copy's list at $DEFD, whose last entries are in the next page.
static uint8_t jump_height(void) {
  if ((0xDEFD & 0xFF) + COUNT > 0xFF) took(READ_PAST_PAGE);
  return cart(7, (uint16_t)(0xDEFD + COUNT));
}

// sub_E1EE: a jump, six rounds up and then down until he's on the ground or off the bottom of the picture, by the heights
// the copy's list at $DEFD gives, and then 7 pixels a round, drifting the way he's heading unless something's in the way.
// Called each turn until it's DONE.
static wait jump(uint8_t *step) {
  enum { BEGIN, RISE, RISEN, FALL, FELL, LONG_FALL, LONG_FALL_AGAIN };
  for (;;) switch (*step) {
    case BEGIN:
      FLAGS |= IN_THE_AIR;
      RAM[0x0647 + ARTHUR] = 0;
      COUNT = 6;
      HEADING = FLAGS & TURNED ? 0x04 : 0x0C;
      COLOURS = 0x02;
      SHAPE = (uint8_t)(0x16 + (FLAGS & TURNED ? 1 : 0));
      took(JUMP_BEGINS);
      took(FLAGS & TURNED ? JUMP_FACES_LEFT : JUMP_FACES_RIGHT);
      took(FLAGS & WITHOUT_ARMOUR ? JUMP_NO_ARMOUR : JUMP_HAS_ARMOUR);
      if (FLAGS & WITHOUT_ARMOUR) {
        COLOURS = 0x01;
        SHAPE = 0x18;
      }
      *step = RISE;
      break;
    case RISE:
      drift(0x0C);
      Y -= jump_height();   // sub_DF04. Past the top of his screen, at $DF15, isn't ported yet.
      took(ARTHUR_RISES);
      placed(0);
      *step = RISEN;
      return YIELDS;
    case RISEN:
      took(ARTHUR_RISE_COUNTED);
      took(--COUNT ? GOES_ROUND : GOES_ON);
      *step = COUNT ? RISE : FALL;
      break;
    case FALL:
      if (on_the_ground(ARTHUR)) {
        stand_on_block();
        took(JUMP_LANDS);
        *step = BEGIN;
        return DONE;
      }
      took(JUMP_STILL_IN_AIR);
      took(SCREEN_Y >= 0xE0 ? JUMP_OFF_THE_BOTTOM : JUMP_ABOVE_THE_BOTTOM);
      if (SCREEN_Y >= 0xE0) { *step = BEGIN; return DONE; }
      drift(0x0C);
      took(ARTHUR_FALL_BY_LIST);
      fall_by(jump_height());   // sub_DF33
      placed(0);
      *step = FELL;
      return YIELDS;
    case FELL:
      took(JUMP_FALL_COUNTED);
      took(++COUNT < 7 ? GOES_ROUND : GOES_ON);
      *step = COUNT < 7 ? FALL : LONG_FALL;
      break;
    case LONG_FALL_AGAIN:
      took(JUMPS);
      *step = LONG_FALL;
      break;
    case LONG_FALL:
      // $E265
      if (on_the_ground(ARTHUR)) {
        stand_on_block();
        took(JUMP_LANDS_LATE);
        *step = BEGIN;
        return DONE;
      }
      took(JUMP_STILL_IN_AIR);
      took(SCREEN_Y >= 0xE0 ? JUMP_OFF_THE_BOTTOM : JUMP_ABOVE_THE_BOTTOM);
      if (SCREEN_Y >= 0xE0) { *step = BEGIN; return DONE; }
      drift(0x06);
      took(ARTHUR_FALL_BY_SEVEN);
      fall_by(7);
      placed(0);
      *step = LONG_FALL_AGAIN;
      return YIELDS;
  }
}

// sub_DEDD: in the air he faces the way Left or Right says, though he goes on the way he jumped.
static void face_in_the_air(void) {
  if (STATE & 0x10) { took(AIR_HELD); return; }
  took(AIR_LOOKS);
  uint8_t way = direction();
  RAM[0x22] = way;
  if (!(way & 0x04)) { took(AIR_NO_TURN); return; }
  FLAGS &= (uint8_t)~TURNED;
  FLAGS |= (way & 0x08) >> 1;
  took(AIR_TURNS);
}

// sub_DF5D: whether something is in the way of a jump, which a jump straight up always has.
static int jump_way_blocked(void) {
  if (!RAM[JUMP_MOVES_ACROSS]) {
    RAM[0xD1] = 0x80;
    took(JUMP_STRAIGHT_UP);
    return 1;
  }
  took(JUMP_MOVES);
  return way_blocked();
}

// sub_DF93: his shape in a jump, by the way he faces, or a throw's.
static void jump_shape(void) {
  if (STATE & 0x02) {
    took(JUMP_THROW_SHAPE);
    throw_shape();
  } else {
    SHAPE = (uint8_t)((FLAGS & WITHOUT_ARMOUR) | (FLAGS & TURNED ? 0x13 : 0x12));
    took(JUMP_SHAPE);
    took(FLAGS & TURNED ? JUMP_SHAPE_LEFT : JUMP_SHAPE_RIGHT);
  }
  flash_after_a_hit();
}

// $DDF7: a jump in a stage, when A is pressed: straight up, or across the way Left or Right says, with the same six
// rounds up and the same fall as sub_E1EE's. In the air B throws and Left and Right turn him, and a hit ends the jump:
// `hit` says so. His look in the last stages, at $DFA0, a state that holds him, at $DFD9, and a fall off the bottom
// of the picture, at $E1BA, aren't ported yet. Called each turn until it's DONE.
static wait stage_jump(uint8_t *step, int *hit) {
  enum { BEGIN, RISE, RISEN, FALL, FELL, LONG_FALL, LONG_FALL_AGAIN };
  *hit = 0;
  for (;;) switch (*step) {
    case BEGIN: {
      FLAGS |= IN_THE_AIR;
      COUNT = 6;
      RAM[JUMP_MOVES_ACROSS] = 0x0C;
      took(STAGE_JUMP_BEGINS);
      uint8_t way = direction();
      if (!(PAD_NOW & (PAD_LEFT | PAD_RIGHT))) {
        RAM[JUMP_MOVES_ACROSS] = 0;
        took(STAGE_JUMP_STRAIGHT);
      } else {
        HEADING = way & 0x0C;
        FLAGS &= (uint8_t)~TURNED;
        FLAGS |= (HEADING >> 1) & TURNED;
        took(STAGE_JUMP_SIDEWAYS);
      }
      *step = RISE;
      break;
    }
    case RISE:
      STATE |= 0x04;
      took(STAGE_JUMP_RISES);
      face_in_the_air();
      if (FLAGS & HIT) {
        took(STAGE_JUMP_HIT);
        *step = BEGIN;
        *hit = 1;
        return DONE;
      }
      took(STAGE_JUMP_NOT_HIT);
      drift_unless(jump_way_blocked(), 0x0C);
      Y -= jump_height();
      took(ARTHUR_RISES);
      jump_shape();
      placed(1);
      *step = RISEN;
      return YIELDS;
    case RISEN:
      took(ARTHUR_RISE_COUNTED);
      took(--COUNT ? GOES_ROUND : GOES_ON);
      if (COUNT) { *step = RISE; break; }
      STATE &= 0xFB;
      took(STAGE_JUMP_TOP);
      *step = FALL;
      break;
    case FELL:
      took(JUMP_FALL_COUNTED);
      took(++COUNT < 7 ? GOES_ROUND : GOES_ON);
      *step = COUNT < 7 ? FALL : LONG_FALL;
      break;
    case LONG_FALL_AGAIN:
      took(JUMPS);
      *step = LONG_FALL;
      break;
    case FALL:
    case LONG_FALL: {
      int long_fall = *step == LONG_FALL;
      face_in_the_air();
      took(OBJECT_FLAG_READ);
      int down = 0;
      if (FLAGS & HELD) {
        took(STAGE_JUMP_HELD);
        down = 1;
      } else {
        took(STAGE_JUMP_NOT_HELD);
        if (on_the_ground(ARTHUR)) {
          stand_on_block();
          took(STAGE_JUMP_LANDS);
          down = 1;
        }
      }
      if (down) {
        FLAGS &= (uint8_t)~IN_THE_AIR;
        *step = BEGIN;
        return DONE;
      }
      took(JUMP_STILL_IN_AIR);
      took(JUMP_ABOVE_THE_BOTTOM);
      if (FLAGS & HIT) {
        took(STAGE_JUMP_HIT);
        *step = BEGIN;
        *hit = 1;
        return DONE;
      }
      took(STAGE_JUMP_NOT_HIT);
      drift_unless(jump_way_blocked(), long_fall ? 0x06 : 0x0C);
      took(long_fall ? ARTHUR_FALL_BY_SEVEN : ARTHUR_FALL_BY_LIST);
      fall_by(long_fall ? 7 : jump_height());
      jump_shape();
      placed(1);
      *step = long_fall ? LONG_FALL_AGAIN : FELL;
      return YIELDS;
    }
  }
}

// $DAA0: where a stage starts him: in the air above the middle of the view's first screen, facing right.
static void start_in_stage(void) {
  Y = 0x98;
  Y_SCREEN = RAM[VIEW_Y + 2];
  FLAGS = OBJECT_FLAG_SHOWN;
  HEADING = 0x04;
  X = 0x60;
  X_SCREEN = RAM[VIEW_X + 2];
}

// sub_E0BE: the weapon he has, as an object at his place, ten pixels up or four when he crouches, heading the way he
// faces, with its sound. Its kind is by its shape at the top of the picture, and the shapes that have one for the left
// are one on. A throw from the top ten pixels of a screen, at $E13A, isn't ported yet.
static void make_weapon(uint8_t weapon) {
  static const struct { uint8_t shape, kind; cost takes; } KINDS[] = {
    { 0x40, LANCE, WEAPON_IS_LANCE }, { 0x42, DAGGER, WEAPON_IS_DAGGER }, { 0x44, TORCH, WEAPON_IS_TORCH }, { 0x36, AXE, WEAPON_IS_AXE },
  };
  RAM[OBJECT_Y_SCREEN + weapon] = Y_SCREEN;
  RAM[OBJECT_Y + weapon] = Y;
  RAM[OBJECT_X_SCREEN + weapon] = X_SCREEN;
  RAM[OBJECT_X + weapon] = X;
  RAM[OBJECT_COUNT + weapon] = RAM[0x0647 + weapon] = RAM[OBJECT_STATE + weapon] = 0;
  RAM[OBJECT_SHAPE + weapon] = WEAPON_HELD;
  took(WEAPON_MADE);
  uint8_t kind = CROSS;
  cost kind_took = WEAPON_IS_CROSS;
  for (unsigned i = 0; i < sizeof KINDS / sizeof *KINDS; i++) if (KINDS[i].shape == WEAPON_HELD) { kind = KINDS[i].kind; kind_took = KINDS[i].takes; }
  took(kind_took);
  RAM[OBJECT_KIND + weapon] = kind;
  RAM[OBJECT_FLAGS + weapon] = (FLAGS & TURNED) | 0x40;
  RAM[OBJECT_HEADING + weapon] = FLAGS & TURNED ? 0x0C : 0x04;
  took(WEAPON_FACES);
  took(OBJECT_FLAG_READ);
  took(FLAGS & CROUCHES ? THROW_CROUCHING : THROW_STANDING);
  RAM[0x22] = FLAGS & CROUCHES ? 4 : 10;
  RAM[OBJECT_Y + weapon] -= RAM[0x22];
  took(WEAPON_HEIGHT);
  took(WEAPON_HEADING_LOOKED_AT);
  if (!(FLAGS & TURNED)) took(WEAPON_HEADS_RIGHT);
  else if (RAM[OBJECT_SHAPE + weapon] >= 0x45) took(WEAPON_LEFT_SHAPE_KEPT);
  else if (RAM[OBJECT_SHAPE + weapon] == 0x36) took(WEAPON_LEFT_AXE);
  else {
    RAM[OBJECT_SHAPE + weapon]++;
    took(WEAPON_LEFT_SHAPE_TURNED);
  }
  took(THROW_SOUND);
  sound_play(0x11);
}

// sub_E01E: B throws his weapon, once for each press, while one of its objects is free: two, or three for the dagger.
// $85 says B was held the round before. The demonstration's own throws, at $E029, aren't ported yet.
static void throw_button(void) {
  enum { THROWS = 0x02, BUSY = 0x12 };
  if (STATE & BUSY) { took(ARTHUR_BUTTONS_BUSY); return; }
  if (!(PAD_NOW & PAD_B)) {
    RAM[0x85] = 0;
    took(ARTHUR_BUTTONS);
    return;
  }
  if (RAM[0x85]) { took(ARTHUR_B_STILL_HELD); return; }
  took(ARTHUR_THROW_LOOKS);
  uint8_t weapon = FIRST_WEAPON;
  for (;;) {
    if (!RAM[OBJECT_FLAGS + weapon]) { took(WEAPON_SLOT_FREE); break; }
    took(WEAPON_SLOT_USED);
    if (++weapon < FIRST_WEAPON + 2) { took(GOES_ROUND); continue; }
    took(WEAPON_THIRD_LOOKED_AT);
    if (weapon >= FIRST_WEAPON + WEAPONS) { took(WEAPON_NO_SLOT); weapon = 0; break; }
    took(WEAPON_THIRD_ASKED);
    if (WEAPON_HELD != 0x42) { took(WEAPON_ONLY_TWO); weapon = 0; break; }
    took(WEAPON_THIRD_ALLOWED);
  }
  if (!weapon) {
    RAM[0x85] = 0;
    took(THROW_NOT_MADE);
    return;
  }
  STATE |= THROWS;
  RAM[OBJECT_KIND + ARTHUR] = 0;   // which counts the throw's three rounds
  took(THROW_BEGINS);
  make_weapon(weapon);
  RAM[0x85] = 0xFF;
  took(THROW_ENDS);
}

// sub_DDCF: his shape as he crouches, by the way he faces, or a throw's.
static void crouch_shape(void) {
  if (STATE & 0x02) {
    took(CROUCH_THROW_SHAPE);
    throw_shape();
    took(JUMPS);
  } else {
    SHAPE = (uint8_t)((0x10 + ((FLAGS >> 2) & 1)) | (FLAGS & WITHOUT_ARMOUR));
    took(CROUCH_SHAPE);
  }
  took(JUMPS);
  flash_after_a_hit();
}

// sub_DB8A, with sub_E01E: the end of a turn in a stage.
static void end_stage_turn(void) {
  took(ARTHUR_TURN_ENDS);
  choose_shape();
  throw_button();
  place_on_screen(ARTHUR);
  FLAGS &= (uint8_t)~HELD;
  STATE &= 0xF7;
  took(ARTHUR_TURN_YIELDS);
}

// $E429 and $E476: the gate at the stage's end opens, in two steps half a second apart: 8 rows of 6 tiles each time,
// from where bank 3's $8018 and $801A point, to the place on the screen the copy's list at $E417 gives for the
// stage's set.
static void gate_tiles(int second) {
  switch_bank(3);
  if (!second) {
    COLOURS = 0x0A;
    SHAPE = 0x1E;
  }
  uint16_t to = (uint16_t)(cart(7, (uint16_t)(0xE417 + RAM[0xCF] * 2)) | cart(7, (uint16_t)(0xE417 + RAM[0xCF] * 2 + 1)) << 8);
  took(second ? GATE_SECOND_TILES : GATE_FIRST_TILES);
  queue_rows(peek16(second ? 0x801A : 0x8018), to, 8, 6);
  switch_bank(BANK_HOME);
}

wait arthur_task(void) {
  enum {
    START, SCENE_SITS, SCENE_WATCHES, SCENE_JUMPS, SCENE_LANDED, SCENE_WALKS, SCENE_STEP, SCENE_OVER,
    STAGE_TURN, STAGE_STANDS, STAGE_AGAIN, STAGE_FALLS, STAGE_FELL, STAGE_HIT, STAGE_KNOCKED_BACK,
    DEATH_BEGINS, DEATH_FALL, DEATH_OVER, STAGE_JUMP,
    LADDER_UP, CLIMB_UP, CLIMB_UP_ON, CLIMB_UP_AGAIN, LADDER_DOWN, OVER_THE_TOP, OVER_THE_TOP_AGAIN,
    CLIMB_DOWN, CLIMB_DOWN_ON, CLIMB_DOWN_AGAIN, CROUCH, CROUCH_AGAIN,
    GATE_OPENS, GATE_OPENS_MORE, GATE_OPEN, GATE_WALK, GATE_WALK_AGAIN,
  };
  static uint8_t inner;
  uint8_t *step = &task_step[TASK_ARTHUR];
  for (;;) switch (*step) {
    case START:
      inner = 0;
      if (FLAGS != 0xFF) {
        took(ARTHUR_STARTS_IN_STAGE);
        start_in_stage();
        *step = STAGE_TURN;
        break;
      }
      // $DA7A: the opening scene, where he sits by the princess without his armour
      SHAPE = 0x1C;
      FLAGS = OBJECT_FLAG_SHOWN | 0x01;
      Y = 0xBA;
      Y_SCREEN = 0;
      X = 0x70;
      X_SCREEN = 0;
      COLOURS = 0x02;
      took(ARTHUR_SCENE_BEGINS);
      *step = SCENE_SITS;
      break;
    case SCENE_SITS:
      place_on_screen(ARTHUR);
      took(CALLS);
      *step = SCENE_WATCHES;
      return YIELDS;
    case SCENE_WATCHES:
      // $E4F9: until Satan has her
      if (!(RAM[OBJECT_FLAGS + SATAN] & 0x01)) {
        took(ARTHUR_WATCHES);
        *step = SCENE_SITS;
        break;
      }
      took(ARTHUR_SEES);
      HEADING = 0x04;
      TILES_FIRST_LIST = 1;   // the tiles of Arthur without his armour
      took(ARTHUR_JUMP_CALLED);
      *step = SCENE_JUMPS;
      break;
    case SCENE_JUMPS: {
      wait how = jump(&inner);
      if (how != DONE) return how;
      // $E50C: he stands a second where he landed
      FLAGS |= WITHOUT_ARMOUR;
      FLAGS &= 0xFE;
      COUNT = 0;
      STATE = 0;
      took(ARTHUR_LANDED);
      choose_shape();
      took(ARTHUR_RESTS);
      *step = SCENE_WALKS;
      return sleep_task(60);
    }
    case SCENE_WALKS:
      took(CALLS);
      *step = SCENE_STEP;
      return YIELDS;
    case SCENE_STEP:
      // $E52B: to the right, a step a round, until he has his armour
      HEADING = 0x04;
      took(ARTHUR_STEP_BEGINS);
      move_object(ARTHUR, 0x0C);
      place_on_screen(ARTHUR);
      choose_shape();
      COUNT++;
      took(ARTHUR_STEP_COUNTED);
      took(OBJECT_FLAG_READ);
      if (FLAGS & WITHOUT_ARMOUR) {
        took(GOES_ROUND);
        *step = SCENE_WALKS;
        break;
      }
      COUNT = 0;
      took(ARTHUR_ARMOUR_ON);
      choose_shape();
      COLOURS = 0x08;
      took(ARTHUR_ARMOURED_RESTS);
      *step = SCENE_OVER;
      return sleep_task(60);
    case SCENE_OVER:
      SCENE_PLAYING = 0;
      took(ARTHUR_SCENE_OVER);
      return ENDS;

    case STAGE_TURN:
      // $DAE4: each round in a stage. Without his armour he has other colours.
      stage_colours();
      if (RAM[0xC9]) {
        // $E423: he has the key, and the stage is his
        took(ARTHUR_HAS_THE_KEY);
        took(CALLS);
        *step = GATE_OPENS;
        return YIELDS;
      }
      if (FLAGS & HIT) {
        took(ARTHUR_IS_HIT);
        *step = STAGE_HIT;
        break;
      }
      took(ARTHUR_TURN_CHECKS);
      if (FLAGS & HELD) took(ARTHUR_HELD);
      else if (!on_the_ground(ARTHUR)) {
        took(ARTHUR_IN_AIR);
        *step = STAGE_FALLS;
        break;
      } else took(ARTHUR_ON_GROUND);
      // $DB06: on the ground. A throw holds him where he is.
      if (STATE & 0x02) {
        took(ARTHUR_THROWING);
        *step = STAGE_STANDS;
        break;
      }
      took(ARTHUR_NOT_THROWING);
      // A jumps, once for each press: $84 says it was held the round before
      if (!(PAD_NOW & PAD_A)) {
        RAM[0x84] = 0;
        took(ARTHUR_A_NOT_HELD);
      } else if (RAM[0x84]) took(ARTHUR_A_STILL_HELD);
      else {
        RAM[0x84] = 0xFF;
        took(ARTHUR_JUMPS);
        *step = STAGE_JUMP;
        break;
      }
      {
        uint8_t way = direction();
        *step = STAGE_STANDS;
        if (!way) {
          COUNT = 0;
          took(ARTHUR_NO_DIRECTION);
          break;
        }
        HEADING = way & 0x0C;
        took(ARTHUR_DIRECTION_SET);
        if (!(way & 0x04)) {
          // Up or Down, unless his state holds him still
          took(ARTHUR_UP_OR_DOWN);
          if (STATE & 0x10) { took(ARTHUR_HELD_STILL); break; }
          took(HEADING ? ARTHUR_GOES_DOWN : ARTHUR_GOES_UP);
          *step = HEADING ? LADDER_DOWN : LADDER_UP;
          break;
        }
        // $DB4D: a step of his walk, facing the way he goes, unless something's in the way
        took(ARTHUR_WALKS);
        COUNT++;
        if (HEADING == 0x0C) FLAGS |= TURNED;
        else FLAGS &= (uint8_t)~TURNED;
        took(HEADING == 0x0C ? ARTHUR_STEP_LEFT : ARTHUR_STEP_RIGHT);
        drift(0x0C);
      }
      break;
    case STAGE_JUMP: {
      int hit;
      wait how = stage_jump(&inner, &hit);
      if (how != DONE) return how;
      *step = hit ? STAGE_HIT : STAGE_STANDS;
      break;
    }
    case LADDER_UP:
      // $DC6B: Up, which does nothing where no ladder is
      if (ladder(0)) {
        took(LADDER_THERE);
        *step = CLIMB_UP;
      } else {
        took(LADDER_NOT_THERE);
        *step = STAGE_STANDS;
      }
      break;
    case CLIMB_UP:
      // $DC73: each round on the way up. Where the ladder ends he's at its top, and gets over it as he would get on
      // it to go down.
      ladder_colours();
      if (!ladder(0)) {
        took(LADDER_NOT_THERE);
        *step = LADDER_DOWN;
        break;
      }
      took(LADDER_THERE);
      *step = CLIMB_UP_ON;
      break;
    case CLIMB_UP_ON:
    case CLIMB_DOWN_ON: {
      // $DC7E and $DCD7: something that hits him takes him off the ladder; Up and Down move him, the other of the two
      // turning him round; and with neither he stays where he is
      int up = *step == CLIMB_UP_ON;
      uint8_t same = up ? 0x08 : 0x04;
      if (FLAGS & HIT) {
        took(LADDER_HIT);
        *step = STAGE_HIT;
        break;
      }
      took(LADDER_NOT_HIT);
      if (!(PAD_NOW & 0x0C)) took(up ? CLIMB_UP_NO_BUTTON : CLIMB_DOWN_NO_BUTTON);
      else if (!(PAD_NOW & same)) {
        HEADING = up ? 0x08 : 0x00;
        took(CLIMB_TURNS_ROUND);
        *step = up ? CLIMB_DOWN_ON : CLIMB_UP_ON;
        break;
      } else {
        took(CLIMB_BUTTON_HELD);
        X = (uint8_t)((X & 0xF8) | 0x08);   // the ladder's middle
        took(CLIMB_ON_THE_MIDDLE);
        if (STATE & 0x10) {
          took(CLIMB_FALLS_OFF);
          *step = STAGE_FALLS;
          break;
        }
        took(CLIMB_GOES_ON);
        climb();
      }
      took(CALLS);
      view_follows_down();
      placed(0);
      *step = up ? CLIMB_UP_AGAIN : CLIMB_DOWN_AGAIN;
      return YIELDS;
    }
    case CLIMB_UP_AGAIN:
      took(JUMPS);
      *step = CLIMB_UP;
      break;
    case CLIMB_DOWN:
      // $DCC6: each round on the way down. At the ladder's foot he's on the ground again, crouching while Down is held.
      ladder_colours();
      if (ladder(1)) {
        took(LADDER_THERE);
        *step = CLIMB_DOWN_ON;
        break;
      }
      stand_on_block();
      took(LADDER_FOOT);
      stage_colours();
      took(JUMPS);
      *step = CROUCH;
      break;
    case CLIMB_DOWN_AGAIN:
      took(JUMPS);
      *step = CLIMB_DOWN;
      break;
    case LADDER_DOWN: {
      // $DD65: Down, or the top of a ladder reached from below. With a ladder's top under his feet he gets on it;
      // on any other ground he crouches.
      took(OBJECT_FLAG_READ);
      if (FLAGS & HELD) {
        took(LADDER_DOWN_HELD);
        *step = CROUCH;
        break;
      }
      took(LADDER_DOWN_LOOKS);
      uint8_t block = block_at_him(0x0B);
      if (block >= 0xD0) {
        took(LADDER_DOWN_NO_LADDER);
        *step = CROUCH;
        break;
      }
      took(LADDER_DOWN_ONTO_IT);
      ladder_colours();
      SHAPE = FLAGS & WITHOUT_ARMOUR ? 0x3F : 0x1F;
      took(FLAGS & WITHOUT_ARMOUR ? LADDER_TOP_SHAPE_NO_ARMOUR : LADDER_TOP_SHAPE);
      *step = OVER_THE_TOP;
      break;
    }
    case OVER_THE_TOP:
      // $DD83: half over the ladder's top, he waits for Up or Down
      FLAGS &= (uint8_t)~HELD;
      STATE &= 0xF7;
      took(LADDER_TOP_YIELDS);
      *step = OVER_THE_TOP_AGAIN;
      return YIELDS;
    case OVER_THE_TOP_AGAIN:
      if (!(PAD_NOW & 0x0C)) {
        took(LADDER_TOP_WAITS);
        *step = OVER_THE_TOP;
      } else if (PAD_NOW & 0x04) {
        HEADING = 0x08;
        took(LADDER_TOP_GOES_DOWN);
        *step = CLIMB_DOWN_ON;
      } else {
        took(LADDER_TOP_GOES_UP);
        stand_on_block();
        took(LADDER_TOP_STOOD_UP);
        stage_colours();
        took(JUMPS);
        *step = STAGE_STANDS;
      }
      break;
    case CROUCH:
      // $DD14: each round he crouches. A jumps, a hit throws him back, and he stands up when Down is let go or Up is
      // held; Left and Right turn him. A jump from here doesn't note that A is held, as a jump from standing does.
      if (PAD_NOW & PAD_A) {
        FLAGS &= (uint8_t)~CROUCHES;
        took(CROUCH_JUMPS);
        *step = STAGE_JUMP;
        break;
      }
      took(CROUCH_NO_JUMP);
      if (FLAGS & HIT) {
        // the original calls $E171 here, which never comes back: two bytes of his task's stack are left behind
        FLAGS &= (uint8_t)~CROUCHES;
        took(CROUCH_HIT);
        *step = STAGE_HIT;
        break;
      }
      took(LADDER_NOT_HIT);
      if (STATE & 0x10) took(CROUCH_HELD_STILL);
      else {
        FLAGS |= CROUCHES;
        took(CROUCH_GOES_ON);
        if (!(PAD_NOW & 0x0F)) took(CROUCH_NO_BUTTON);
        else if (PAD_NOW & 0x08) took(CROUCH_UP_HELD);
        else {
          took(CROUCH_STAYS);
          if (!(PAD_NOW & (PAD_LEFT | PAD_RIGHT))) took(CROUCH_FACES_ON);
          else if (PAD_NOW & PAD_RIGHT) {
            FLAGS &= (uint8_t)~TURNED;
            took(CROUCH_FACES_RIGHT);
          } else {
            FLAGS |= TURNED;
            took(CROUCH_FACES_LEFT);
          }
          crouch_shape();
          placed(1);
          *step = CROUCH_AGAIN;
          return YIELDS;
        }
      }
      FLAGS &= (uint8_t)~CROUCHES;
      took(CROUCH_ENDS);
      *step = STAGE_STANDS;
      break;
    case CROUCH_AGAIN:
      // $DD5F: the view after him
      took(ARTHUR_VIEW_FOLLOWS);
      view_follows_across();
      view_follows_down();
      took(JUMPS);
      *step = CROUCH;
      break;
    case STAGE_STANDS:
      // $DB65: the view after him, and the end of the turn
      took(ARTHUR_VIEW_FOLLOWS);
      view_follows_across();
      view_follows_down();
      if (PAD_NOW & (PAD_LEFT | PAD_RIGHT)) {
        // he faces the way the button says, whatever he's doing
        FLAGS &= (uint8_t)~TURNED;
        FLAGS |= (PAD_NOW << 1) & TURNED;
        took(ARTHUR_FACES_THE_BUTTON);
      } else took(ARTHUR_AFTER_VIEW);
      end_stage_turn();
      *step = STAGE_AGAIN;
      return YIELDS;
    case STAGE_AGAIN:
      took(ARTHUR_AGAIN);
      *step = STAGE_TURN;
      break;
    case STAGE_FALLS:
      // $E28E: 6 pixels a round until he's on the ground. Off the bottom of the picture, at $E2AD, isn't ported yet.
      took(ARTHUR_FALL_CHECKS);
      if (FLAGS & HELD) { took(ARTHUR_FALL_HELD); *step = STAGE_STANDS; break; }
      if (on_the_ground(ARTHUR)) {
        stand_on_block();
        took(ARTHUR_LANDS);
        *step = STAGE_STANDS;
        break;
      }
      took(ARTHUR_FALLS_ON);
      Y += 6;
      if (SCREEN_Y >= 0x90) {
        took(ARTHUR_FELL_LOW);
        view_follows_down();
      } else took(ARTHUR_FELL_HIGH);
      if (SCREEN_Y >= 0x80) {
        took(ARTHUR_FELL_BELOW_HALF);
        view_follows_down();
      } else took(ARTHUR_FELL_ABOVE_HALF);
      // $E2BF: Left and Right turn him as he falls, and keep his walk's count going
      took(CALLS);
      flash_after_a_hit();
      if (PAD_NOW & (PAD_LEFT | PAD_RIGHT)) {
        FLAGS &= (uint8_t)~TURNED;
        FLAGS |= (PAD_NOW << 1) & TURNED;
        COUNT++;
        took(ARTHUR_FALL_TURNS);
      } else {
        COUNT = 0;
        took(ARTHUR_FALL_STRAIGHT);
      }
      end_stage_turn();
      *step = STAGE_FELL;
      return YIELDS;
    case STAGE_FELL:
      // $E2E4: his flashing after a hit is seen to once more each round of a fall
      took(CALLS);
      flash_after_a_hit();
      took(JUMPS);
      *step = STAGE_FALLS;
      break;
    case STAGE_HIT:
      // $E171: something has hit him. With his armour on he loses it: nothing can touch him for a while, the tiles'
      // task sends the tiles of Arthur without it, and he's thrown back, as a jump the way he isn't facing. Without
      // it he dies. With the stage's time over, at $E1C2, he dies another way, which isn't ported yet.
      STATE &= 0xEF;
      if (FLAGS & WITHOUT_ARMOUR) {
        took(ARTHUR_DIES);
        *step = DEATH_BEGINS;
        return YIELDS;
      }
      FLAGS |= CANNOT_BE_TOUCHED;
      FLAGS &= (uint8_t)~(CROUCHES | HIT);
      COLOURS = 0x02;
      took(ARTHUR_HIT_BEGINS);
      sound_play(0x1D);
      TILES_FIRST_LIST = 1;
      RAM[0xD6] = RAM[0xD7] = RAM[0xD8] = RAM[0xD9] = 0xFF;
      took(ARTHUR_ARMOUR_OFF);
      *step = STAGE_KNOCKED_BACK;
      break;
    case DEATH_BEGINS:
      // $E1AF: his death is the same throw back, with its own sound, and then his bones lie for a second
      took(ARTHUR_DEATH_SOUND);
      sound_play(0x0A);
      took(CALLS);
      *step = DEATH_FALL;
      break;
    case DEATH_FALL: {
      wait how = jump(&inner);
      if (how != DONE) return how;
      SHAPE = 0x1A;
      took(ARTHUR_FALLEN);
      *step = DEATH_OVER;
      return sleep_task(60);
    }
    case DEATH_OVER:
      RAM[0x81] = 0xFF;   // which tells the game's task the life is over
      took(ARTHUR_GONE);
      return ENDS;
    case STAGE_KNOCKED_BACK: {
      wait how = jump(&inner);
      if (how != DONE) return how;
      FLAGS |= WITHOUT_ARMOUR;
      took(ARTHUR_KNOCKED_BACK);
      *step = STAGE_STANDS;
      break;
    }
    case GATE_OPENS:
      FLAGS &= (uint8_t)~WITHOUT_ARMOUR;
      took(OBJECT_FLAG_CHANGED);
      gate_tiles(0);
      took(GATE_SOUND);
      sound_play(0x0E);
      took(GATE_RESTS);
      *step = GATE_OPENS_MORE;
      return sleep_task(30);
    case GATE_OPENS_MORE:
      gate_tiles(1);
      took(GATE_RESTS_AGAIN);
      *step = GATE_OPEN;
      return sleep_task(30);
    case GATE_OPEN:
      // $E4B4: he walks to the right, into the gate
      HEADING = 0x04;
      FLAGS &= (uint8_t)~TURNED;
      COLOURS = 0x08;
      took(GATE_WALK_BEGINS);
      took(OBJECT_FLAG_CHANGED);
      *step = GATE_WALK;
      break;
    case GATE_WALK: {
      // sub_EA01: the block 8 pixels to his left and 4 down. The gate's own, $60 to $6F, end the stage, at $BF.
      uint16_t across = (uint16_t)((X_SCREEN << 8 | X) - 8);
      RAM[0x74] = (uint8_t)across;
      RAM[0x78] = (uint8_t)(across >> 8);
      RAM[0x77] = Y_SCREEN;
      RAM[0x73] = (uint8_t)(Y + 4);
      took(BLOCK_BEHIND_ARTHUR);
      uint8_t block = block_at_stage_place();
      if (block >= 0x60 && block < 0x70) {
        RAM[0xBF] = 0xFF;
        took(GATE_REACHED);
        return ENDS;
      }
      took(block < 0x60 ? GATE_NOT_YET : GATE_NOT_YET_PAST);
      move_object(ARTHUR, 0x0C);
      took(JUMPS);
      view_follows_across();
      COUNT++;
      took(ARTHUR_STEP_COUNTED);
      choose_shape();
      place_on_screen(ARTHUR);
      took(CALLS);
      *step = GATE_WALK_AGAIN;
      return YIELDS;
    }
    case GATE_WALK_AGAIN:
      took(JUMPS);
      *step = GATE_WALK;
      break;
  }
}
