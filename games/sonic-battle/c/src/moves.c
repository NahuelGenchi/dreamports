// moves.js in C: the fight's frame in Training mode and the fighters' state machines. A fighter's frame reads its keys
// (0x08005310), runs the script of its state (0x08007ec8 and 0x0800290c), moves (0x0800597c and 0x080127d0), takes the
// hits that reached it (0x080036dc and 0x080040fa), reaches others with its attacks (0x08006134 and 0x080066d8) and
// takes its next state (0x0800486c, 0x0800444c and 0x08001b0c), with the way the pad faces (0x080034f0) turning an
// aimed attack. Each fighter's record is 252 bytes in work RAM, and what's not reached yet says so when it is: a trap,
// naming the original's function, in place of each path left out.

#include "game.h"

#define SETUP_ SETUP
#define SLOTS_ SLOTS
#define PLAYER_ PLAYER
#define KEYS 0x03001B30u
#define KEYS_PER_FIGHTER 64
#define KEYS_PRESSED 20
#define KEYS_RELEASED 40
#define KEYS_NOW 60
#define SCRIPTS 0x08ED68A8u
#define SCRIPTS_PER_CHARACTER 280
#define CHOICES 0x030013B0u   // each player's skills, stats and outfit
#define CHOICE_SIZE 156
#define DIRECTIONS 0x0806B2D4u
#define CAMERA_TURN 0x0300204Cu
#define RANDOM 0x0300019Cu
#define VIEW_FACING 0x03001370u
#define LIMIT_RIGHT 0x03002B74u
#define LIMIT_LEFT 0x03002BD0u
#define LIMIT_DOWN 0x03002B80u
#define LIMIT_UP 0x03002B70u
#define WALL_COUNT 0x03002B84u
#define WALLS 0x03002B90u
#define FLOOR 0x03001384u

#define EFFECT_COUNT 0x03004470u
#define EFFECTS 0x03004480u
#define SONG_TABLE 0x08BF7244u
#define HALF_VOLUME_SOUND 0x333

static void notPorted(const char *what) {
  (void)what;
  __builtin_trap();
}

static uint32_t record(int i) { return FIGHTERS + (uint32_t)i * RECORD; }
static uint32_t keysNow(int i) { uint32_t at = KEYS + (uint32_t)i * KEYS_PER_FIGHTER; return at + (uint32_t)read8(at + KEYS_NOW) * 2; }
static uint16_t held(int i) { return read16(keysNow(i)); }
static uint16_t pressed(int i) { return read16(keysNow(i) + KEYS_PRESSED); }
static int isActive(int i) { return read8(SLOTS_ + i) != 255; }
static void addFlags(uint32_t rec, uint32_t bits) { write32(rec + FLAGS, read32(rec + FLAGS) | bits); }
static void clearFlags(uint32_t rec, uint32_t bits) { write32(rec + FLAGS, read32(rec + FLAGS) & ~bits); }
static int32_t asrBy(int32_t value, int by) { return by >= 32 ? value >> 31 : value >> by; }

int32_t nextRandom(void) {
  uint32_t value = read32(RANDOM) * 0x14FA05u + 0xC0AFu;
  write32(RANDOM, value);
  return (int32_t)value;
}

int queueEffect(int sound, int place) {
  uint8_t count = read8(EFFECT_COUNT);
  if (count > 31) return 0;
  write16(EFFECTS + (uint32_t)count * 4, (uint16_t)sound);
  write16(EFFECTS + (uint32_t)count * 4 + 2, (uint16_t)place);
  write8(EFFECT_COUNT, count + 1);
  return 1;
}

void playQueuedEffects(void) {
  uint8_t count = read8(EFFECT_COUNT);
  for (int n = 0; n < count; n++) {
    uint16_t sound = read16(EFFECTS + (uint32_t)n * 4);
    int place = (int8_t)read16(EFFECTS + (uint32_t)n * 4 + 2);
    uint16_t player = read16(SONG_TABLE + (uint32_t)sound * 8 + 4);
    gba_sound_play(sound);
    gba_sound_imm_init(player);
    gba_sound_pan(player, 0xFFFF, place);
    if (sound == HALF_VOLUME_SOUND) gba_sound_volume(player, 0xFFFF, 0x80);
  }
  write8(EFFECT_COUNT, 0);
}

int stepFade(void) {
  uint8_t kind = read8(0x03004B04);
  if (kind == 0) return 1;
  if (kind == 1) {
    uint16_t level = read16(0x03004B00);
    if (level & 0x8000) return 1;
    uint16_t next = (uint16_t)(level + read16(0x03004B08));
    write16(0x03004B00, next);
    if (next > 0x8000) {
      write16(0x03004B00, 0x8000);
      queueRegister(84, 16);
    } else queueRegister(84, (uint16_t)((next & 0xF800) >> 11));
  } else if (kind == 2) {
    uint16_t level = read16(0x03004B00), by = read16(0x03004B08);
    if (level == 0) return 1;
    if (level < by) {
      write16(0x03004B00, 0);
      queueRegister(84, 0);
    } else {
      write16(0x03004B00, level - by);
      queueRegister(84, (uint16_t)(((level - by) & 0xF800) >> 11));
    }
  }
  return 0;
}

void endFade(void) {
  queueRegister(80, 0);
  queueRegister(84, 0);
  write8(0x03004B04, 0);
  write16(0x03004B00, 0);
  write16(0x03004B08, 0);
}

void forgetKeys(int i) {
  uint32_t at = KEYS + (uint32_t)i * KEYS_PER_FIGHTER;
  write8(at + KEYS_NOW, 0);
  for (int k = 0; k < 10; k++) {
    write16(at + (uint32_t)k * 2, 0);
    write16(at + KEYS_PRESSED + (uint32_t)k * 2, 0);
    write16(at + KEYS_RELEASED + (uint32_t)k * 2, 0);
  }
  for (int j = 0; j < 4; j++) write16(record(j) + KEYS_FOR_NEXT, 0);
}

static void keepKeys(int i, uint16_t now, uint16_t justPressed, uint16_t justReleased) {
  uint32_t at = KEYS + (uint32_t)i * KEYS_PER_FIGHTER;
  uint8_t next = (uint8_t)(read8(at + KEYS_NOW) + 1);
  write8(at + KEYS_NOW, next);
  if (next > 9) { next = 0; write8(at + KEYS_NOW, 0); }
  write16(at + KEYS_PRESSED + (uint32_t)next * 2, justPressed);
  write16(at + KEYS_RELEASED + (uint32_t)next * 2, justReleased);
  write16(at + (uint32_t)next * 2, now);
}

void readAllKeys(int player) {
  keepKeys(player, g.keys.held, g.keys.pressed, g.keys.released);
  for (int j = 0; j < 4; j++) {
    if (j == player) { write16(record(j) + KEYS_FOR_NEXT, g.keys.held); continue; }
    uint16_t now = read16(record(j) + KEYS_FOR_NEXT), old = held(j), changed = now ^ old;
    keepKeys(j, now, now & changed, old & changed);
  }
}

void readNextKeys(void) {
  for (int j = 0; j < 4; j++) {
    uint16_t now = read16(record(j) + KEYS_FOR_NEXT), old = held(j), changed = now ^ old;
    keepKeys(j, now, now & changed, old & changed);
  }
}

void dummyKeys(void) {
  uint32_t dummy = record(3), keys = dummy + KEYS_FOR_NEXT, clock = SETUP_ + 134;
  write8(dummy + 141, 0);
  write8(dummy + CAMERA, read8(record((int)read32(PLAYER_)) + CAMERA));
  if (!(read32(dummy + FLAGS) & FLAG_GROUNDED)) return;
  write8(clock, read8(clock) + 1);
  int mode = read8(SETUP_ + 38), time = read8(clock);
  #define EVERY(frames, value) do { if (time == (frames)) { write8(clock, 0); write16(keys, (value)); return; } write16(keys, 0); return; } while (0)
  if (mode == 1) EVERY(40, 1);
  else if (mode == 2) {
    uint16_t state = read16(dummy + STATE);
    if (state == 66 || state == 68) write16(keys, 0);
    else if (time <= 29) write16(keys, 64);
    else if (time <= 59) write16(keys, 16);
    else if (time <= 89) write16(keys, 128);
    else if (time <= 119) write16(keys, 32);
    else write8(clock, 0);
  } else if (mode == 3) EVERY(20, 0x200);
  else if (mode == 4) EVERY(30, 2);
  else if (mode == 5) {
    if (time != 40) { write16(keys, 0); return; }
    write8(clock, 0);
    int pick = (int)((uint32_t)nextRandom() % 3);
    if (pick == 0) write16(keys, read8(dummy + 17) == 0 ? 34 : 18);
    else if (pick == 1) write16(keys, 66);
    else write16(keys, 130);
  } else if (mode == 6) {
    if (time == 40) { write8(clock, 0); write16(keys, read8(dummy + 17) == 0 ? 18 : 34); }
    else write16(keys, 0);
  }
  #undef EVERY
}

static int pressedBefore(int i, int back, int count, uint16_t mask) {
  uint32_t at = KEYS + (uint32_t)i * KEYS_PER_FIGHTER;
  int place = read8(at + KEYS_NOW) - (back < 9 ? back : 9);
  if (place < 0) place += 10;
  for (int n = 0; n < count; n++) {
    if (read16(at + KEYS_PRESSED + (uint32_t)place * 2) & mask) return 1;
    place = place > 9 ? 0 : place + 1;
  }
  return 0;
}

int16_t padFacing(int i) {
  uint16_t keys = held(i);
  int at = 0;
  if ((keys & 0x20) && (keys & 0x80)) at = 1;
  else if ((keys & 0x10) && (keys & 0x80)) at = 3;
  else if ((keys & 0x20) && (keys & 0x40)) at = 7;
  else if ((keys & 0x10) && (keys & 0x40)) at = 9;
  else if (keys & 0x80) at = 2;
  else if (keys & 0x20) at = 4;
  else if (keys & 0x10) at = 6;
  else if (keys & 0x40) at = 8;
  return read8(DIRECTIONS + (uint32_t)read8(record(i) + CAMERA) * 10 + (uint32_t)at);
}

static int scriptOf(int state) {
  switch (state) {
    case 0: return 0; case 1: return 1; case 2: return 2; case 3: return 3; case 4: return 4; case 5: return 5;
    case 6: return 7; case 7: return 8; case 8: return 9; case 9: return 10; case 10: return 11; case 11: return 12;
    case 12: return 13; case 13: return 14; case 14: return 15; case 15: return 16; case 16: return 17; case 17: return 18;
    case 18: return 20; case 19: return 21; case 20: return 24; case 21: return 27; case 22: return 30; case 23: return 33;
    case 24: return 36; case 52: return 56; case 53: return 57; case 54: return 60; case 55: return 62; case 56: return 63;
    case 65: return 39; case 66: return 40; case 67: return 43; case 68: return 47; case 69: return 41; case 70: return 48;
    case 71: return 45; case 80: return 49; case 81: return 50; case 82: return 51; case 83: return 52; case 84: return 53;
    case 85: return 54; case 96: return 64; case 252: return 65; case 253: return 66; case 254: return 67; case 255: return 68;
    case 261: return 6; case 273: return 19; case 275: return 22; case 276: return 25; case 277: return 28; case 278: return 31;
    case 279: return 34; case 280: return 37; case 309: return 58; case 311: return 61; case 323: return 44; case 325: return 42;
    case 327: return 46; case 336: return 55; case 531: return 23; case 532: return 26; case 533: return 29; case 534: return 32;
    case 535: return 35; case 536: return 38; case 565: return 59; default: return -1;
  }
}

void fighterThink(int i) {
  uint32_t rec = record(i);
  uint8_t next = read8(rec + PAUSE_NEXT);
  if (next != 0) {
    write8(rec + PAUSE_DONE, 1);
    write8(rec + PAUSE, next);
    write8(rec + PAUSE_NEXT, 0);
  }
  uint8_t done = read8(rec + PAUSE_DONE);
  if (read8(rec + PAUSE) != 0 && done != 1) return;
  if (done == 1) write8(rec + PAUSE_DONE, 0);
  if (read32(rec + FLAGS) & FLAG_NEW_STATE) {
    write16(rec + SCRIPT_AT, 0);
    write16(rec + SCRIPT_FRAME, 0);
    write16(rec + 160, 0);
    write16(rec + 162, 0);
    clearFlags(rec, FLAG_NEW_STATE);
  }
  int character = read8(rec + CHARACTER);
  int slot = scriptOf(read16(rec + STATE));
  if (slot < 0) return;
  // 0x0800964C: Emerl (character 9) runs the script of the character his skill slot holds, in his player's record
  // of choices, and the frame ends there, as the ordinary switch does for every other character
  if (character == 9) character = read8(CHOICES + (uint32_t)i * CHOICE_SIZE + (uint32_t)slot);
  runScript(read32(SCRIPTS + (uint32_t)character * SCRIPTS_PER_CHARACTER + (uint32_t)slot * 4), i);
  write8(rec + ANIMATION, (uint8_t)slot);
}

static void setFrame(uint32_t rec, int value);
static void setVoice(uint32_t rec, int value);
static void playAtFighter(uint32_t rec, int sound);
static int runScriptWord(uint32_t rec, int i, uint32_t word);
static void settleHits(int i);
static void pushApart(int i, int j);
static void leaveThings(int i);

void runScript(uint32_t script, int i) {
  uint32_t rec = record(i);
  #define WORD() read32(script + (uint32_t)reads16(rec + SCRIPT_AT) * 4)
  #define IS_MARK() ((WORD() & 0xFFFF0000u) == 0xFFF00000u)
  while (!IS_MARK()) write16(rec + SCRIPT_AT, read16(rec + SCRIPT_AT) + 1);
  int mark = WORD() & 0xFFFF, frame = reads16(rec + SCRIPT_FRAME);
  if (mark != frame) {
    if ((uint32_t)mark < (uint32_t)frame) {
      setState(i, 0);
      static const int fields[7] = {SPEED_X, SPEED_Y, SPEED_Z, WALK, SLOW, FALL, 104};
      for (int n = 0; n < 7; n++) write16(rec + fields[n], 0);
      write16(rec + TOP_SPEED, 0x300);
      write16(rec + MAX_SPEED, 0x300);
      clearFlags(rec, FLAG_LOCKED | FLAG_CHAIN);
    }
  } else {
    write16(rec + SCRIPT_AT, read16(rec + SCRIPT_AT) + 1);
    int going = 1;
    while (!IS_MARK() && going) {
      going = runScriptWord(rec, i, WORD());
      write16(rec + SCRIPT_AT, read16(rec + SCRIPT_AT) + 1);
    }
  }
  write16(rec + SCRIPT_FRAME, read16(rec + SCRIPT_FRAME) + 1);
  #undef IS_MARK
  #undef WORD
}

static int runScriptWord(uint32_t rec, int i, uint32_t word) {
  uint32_t op = word & 0xFFFF0000u;
  int value = word & 0xFFFF, signedValue = s16(word), boost = read8(rec + 155);
  switch (op) {
    case 0x00010000u: {
      int diagonal = (int16_t)(((uint32_t)(signedValue * 11) << 12) >> 16), negative = -s16(diagonal);
      switch (read8(rec + FACING)) {
        case 1: write16(rec + SPEED_X, (uint16_t)negative); write16(rec + SPEED_Y, (uint16_t)diagonal); break;
        case 2: write16(rec + SPEED_Y, (uint16_t)value); break;
        case 3: write16(rec + SPEED_X, (uint16_t)diagonal); write16(rec + SPEED_Y, (uint16_t)diagonal); break;
        case 4: write16(rec + SPEED_X, (uint16_t)-value); break;
        case 6: write16(rec + SPEED_X, (uint16_t)value); break;
        case 7: write16(rec + SPEED_X, (uint16_t)negative); write16(rec + SPEED_Y, (uint16_t)negative); break;
        case 8: write16(rec + SPEED_Y, (uint16_t)-value); break;
        case 9: write16(rec + SPEED_X, (uint16_t)diagonal); write16(rec + SPEED_Y, (uint16_t)negative); break;
        default: break;
      }
      break;
    }
    case 0x00020000u: write16(rec + SPEED_Z, (uint16_t)value); break;
    case 0x00100000u: {
      int walk = u16(signedValue + (signedValue >> 2));
      if (boost == 7) walk = u16(s16(walk) + (s16(walk) >> 2));
      else if (boost == 8) walk = u16(s16(walk) + (s16(walk) >> 1));
      write16(rec + WALK, (uint16_t)walk);
      break;
    }
    case 0x00110000u: write16(rec + SLOW, (uint16_t)(value + (signedValue >> 2))); break;
    case 0x00120000u: {
      int fall = value;
      if (boost == 1) fall = signedValue - (signedValue >> 3);
      else if (boost == 2) fall = signedValue - (signedValue >> 2);
      else if (boost == 3) fall = signedValue + (signedValue >> 3);
      else if (boost == 4) fall = signedValue + (signedValue >> 2);
      write16(rec + FALL, (uint16_t)fall);
      break;
    }
    case 0x001F0000u: {
      int top = value;
      if (boost == 5) top = signedValue + (signedValue >> 2);
      else if (boost == 6) top = signedValue + (signedValue >> 1);
      write16(rec + MAX_SPEED, (uint16_t)top);
      break;
    }
    case 0x00200000u: write16(rec + 96, (uint16_t)value); break;
    case 0x00210000u: write16(rec + 98, (uint16_t)value); break;
    case 0x00220000u: write16(rec + 100, (uint16_t)value); break;
    case 0x00230000u: write8(rec + 102, (uint8_t)value); break;
    case 0x00240000u: write16(rec + 104, (uint16_t)value); break;
    case 0x00250000u: {
      write8(rec + 106, (uint8_t)value);
      write8(rec + 126, 0);
      write8(rec + 125, 255);
      write32(rec + ATTACKS, 0);
      if (read8(SETUP_ + 137 + i) == 0) {
        uint32_t count = SETUP_ + 58 + (uint32_t)i * 2;
        write16(count, read16(count) + 1);
        write8(SETUP_ + 137 + i, 1);
      }
      break;
    }
    case 0x00260000u: write8(rec + 113, (uint8_t)value); break;
    case 0x00270000u: write8(rec + 107, (uint8_t)value); break;
    case 0x00330000u: write8(rec + 186, (uint8_t)value); break;
    case 0x00340000u: write8(rec + 187, (uint8_t)value); break;
    case 0x00F00000u: setState(i, value); return 0;
    case 0x00FF0000u: {
      static const int fields[6] = {SPEED_X, SPEED_Y, SPEED_Z, WALK, SLOW, 104};
      for (int n = 0; n < 6; n++) write16(rec + fields[n], 0);
      write16(rec + TOP_SPEED, 0x7FFF);
      write16(rec + MAX_SPEED, 0x7FFF);
      write16(rec + FALL, 8);
      int state = read16(rec + STATE);
      if (state == 65 || state == 67 || state == 0x143 || state == 69 || state == 54 || state == 71) {
        write16(rec + TOP_SPEED, 0x300);
        write16(rec + MAX_SPEED, 0x300);
      }
      break;
    }
    case 0x01000000u: clearFlags(rec, FLAG_LOCKED); break;
    case 0x01100000u: addFlags(rec, FLAG_LOCKED); break;
    case 0x01200000u: addFlags(rec, FLAG_CHAIN); break;
    case 0x01300000u: clearFlags(rec, FLAG_CHAIN); break;
    case 0x01400000u: addFlags(rec, 0x800000); break;
    case 0x01500000u: if (read8(rec + 149) == 3) write8(rec + 147, 0); break;
    case 0x10000000u: setFrame(rec, value); break;
    case 0x11000000u: write16(rec + 160, (uint16_t)value); break;
    case 0x12000000u: write16(rec + 162, (uint16_t)value); break;
    case 0x20000000u: write16(rec + 166, (uint16_t)value); break;
    case 0x22000000u: write16(rec + 168, (uint16_t)value); break;
    case 0x23000000u: setVoice(rec, value); break;
    case 0x24000000u: write8(rec + 172, 1); break;
    case 0x28000000u: playAtFighter(rec, value); break;
    case 0xFFFE0000u:
      write16(rec + SCRIPT_AT, 0xFFFF);
      write16(rec + SCRIPT_FRAME, 0xFFFF);
      break;
    default: break;
  }
  return 1;
}

static void setFrame(uint32_t rec, int value) {
  write16(rec + 164, (uint16_t)value);
  int character = read8(rec + CHARACTER_NOW);
  if (character > 10) return;
  int state = read16(rec + STATE), facing = read8(rec + FACING);
  uint32_t angle = DIRECTIONS + (uint32_t)read8(0x03001370) * 10;
  int up = facing == read8(angle + 2), down = facing == read8(angle + 8);
  #define ADD(by) write16(rec + 164, read16(rec + 164) + (by))
  #define OFFSET(table, base) read16((table) + (uint32_t)(read16(rec + 164) - (base)) * 2)
  if (character == 0 || character == 9 || character == 10) {
    if (state == 19 || state == 20) { if (up) ADD(8); else if (down) ADD(16); }
    else if (state == 0x115) { if (up) ADD(4); else if (down) ADD(8); }
  } else if (character == 1) {
    if (state == 19) {
      if (up) ADD(21); else if (down) ADD(42);
      write16(rec + 160, OFFSET(0x08055800, 172) - 8);
      write16(rec + 162, OFFSET(0x0805587E, 172));
    } else if (state == 20) {
      if (up) ADD(10); else if (down) ADD(20);
      write16(rec + 160, OFFSET(0x08055994, 236) - 8);
      write16(rec + 162, OFFSET(0x080559D8, 236));
    }
  } else if (character == 2 && state == 21) {
    if (up) ADD(12); else if (down) ADD(24);
    write16(rec + 160, OFFSET(0x080576E8, 184));
  }
  #undef OFFSET
  #undef ADD
}

static void setVoice(uint32_t rec, int value) {
  uint32_t voice = rec + 170;
  write16(voice, (uint16_t)value);
  if (value == 3) {
    uint16_t time = (uint16_t)g.vblanks;
    write16(rec + 166, (uint16_t)(read16(rec + 166) - 200 + ((uint32_t)(time + 5) * (time + 1)) % 400));
    write16(rec + 168, (uint16_t)(read16(rec + 168) - 10 + ((uint32_t)(time + 8) * time) % 20));
  }
  int character = read8(rec + CHARACTER_NOW);
  if ((character == 0 || character == 9 || character == 10) && read16(voice) == 50) {
    uint32_t angle = DIRECTIONS + (uint32_t)read8(0x03001370) * 10, facing = read8(rec + FACING);
    if (facing == read8(angle + 2)) write16(voice, 51);
    else if (facing == read8(angle + 8)) write16(voice, 53);
  }
  if (character == 7 || character == 17 || character == 18) {
    uint8_t charge = read8(rec + 143);
    if (read16(voice) == 180 && charge > 2) write16(voice, charge <= 5 ? 181 : 182);
    if (read16(voice) == 177 && charge > 2) write16(voice, charge <= 3 ? 178 : 179);
    if (read8(rec + FACING) == 0) {
      uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10, side = read8(rec + 16);
      if (side == 0) write8(rec + FACING, read8(camera + 4));
      else if (side == 1) write8(rec + FACING, read8(camera + 6));
    }
  }
  if (read8(rec + 199) <= 6) write8(rec + 199, 7);
}

static void playAtFighter(uint32_t rec, int sound) {
  uint16_t x = read16(rec + 12);
  if ((((uint32_t)(x + 48) << 16) >> 0) > 0x1200000u) return;
  int16_t y = reads16(rec + 14);
  if (y > read8(0x030017C0) || y < read8(0x030016D0) - 64) return;
  int place = s16(x - 96);
  queueEffect(sound, place > 127 ? 127 : place < -127 ? -127 : place);
}

static const uint32_t KIND_REACTION[16] = {0, 0x8, 0x10, 0x20, 0x40, 0, 0x100, 0x200, 0x400, 0x800, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000};

void setState(int i, int state) {
  uint32_t rec = record(i);
  write16(rec + STATE, (uint16_t)state);
  write32(rec + FLAGS, (read32(rec + FLAGS) | FLAG_NEW_STATE) & ~FLAG_CHAIN);
  if (state == 54 && read8(rec + 149) == 3) write8(rec + 147, 0);
  if (read8(rec + 147) <= 71) write8(rec + 149, 0);
  else write8(rec + 149, read8(rec + 149) & 1);
  write8(rec + 126, 0);
  write8(SETUP_ + 137 + i, 0);
  if (read8(rec + CHARACTER) == 9) write8(rec + CHARACTER_NOW, read8(0x030013B0 + (uint32_t)(slotOfAnimation(state) & 0xFF) + (uint32_t)i * 156));
  if (read8(rec + 199) <= 4) write8(rec + 199, 5);
  #define FACE_CAMERA() do { if (read8(rec + 36) == 0) { uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10; write8(rec + 36, read8(camera + (read8(rec + 16) == 0 ? 4 : 6))); } } while (0)
  switch (state) {
    case 0:
      write8(rec + 138, 0);
      write8(rec + 198, 0);
      write8(rec + 192, 0);
      break;
    case 8: case 52: case 71: clearFlags(rec, FLAG_LANDED); break;
    case 9:
      if (read8(rec + CHARACTER_NOW) != 3 && read8(rec + CHARACTER_NOW) != 10) write8(rec + 184, 1);
      break;
    case 53:
      write8(rec + 188, 99);
      write8(rec + 189, 99);
      write8(rec + 190, 0);
      FACE_CAMERA();
      break;
    case 55:
      write8(rec + 188, read8(0x0806B3FC + (uint32_t)read8(rec + CHARACTER_NOW)));
      write8(rec + 189, read8(0x0806B407 + (uint32_t)read8(rec + CHARACTER_NOW)));
      if ((held(i) & 0x200) == 0) setState(i, 56);
      write8(rec + 36, 0);
      break;
    case 54: case 65: case 66: case 67: case 68: case 69: case 80: case 81: case 82: case 83: case 84: case 85: case 0x145:
      write16(rec + 238, (uint16_t)state);
      write8(rec + 184, 1);
      break;
    case 70:
      write8(rec + 30, 1);
      write8(rec + 28, 5);
      break;
    case 0x135:
      write8(rec + 126, 0);
      write8(rec + 125, 255);
      write32(rec + ATTACKS, 0);
      break;
    case 565:
      if (held(i) & 0x200) setState(i, 0x137);
      break;
    default:
      if (state >= 10 && state <= 24 && state != 16) {
        if (state >= 19) {
          write8(rec + 149, read8(rec + 149) | 2);
          write8(rec + 138, 0);
          write8(rec + 184, 0);
        }
        if (read32(rec + FLAGS) & FLAG_NEW_STATE) {
          write8(rec + 126, 0);
          write8(rec + 125, 255);
          clearFlags(rec, FLAG_CHAIN);
        }
        FACE_CAMERA();
      }
  }
  // 0x08001b0c's charge and release for the special attacks: a held R keeps the charge going, and letting go fires
  if (state == 19 || state == 20 || state == 23 || state == 24) {
    write8(rec + 143, 0);
  } else if (state == 0x113) {
    int charge = read8(rec + 143) + 1;
    if (charge > 12) charge = 12;
    write8(rec + 143, (uint8_t)charge);
    if (charge == 5) write16(rec + 164, 215);
    else if (charge == 12) write16(rec + 164, 216);
    if ((held(i) & 0x100) == 0) setState(i, 0x213);
  } else if (state == 0x114) {
    // the air special's charge, up to three: its sound plays as it builds
    int charge = read8(rec + 143) + 1;
    if (charge > 3) charge = 3;
    write8(rec + 143, (uint8_t)charge);
    gba_sound_play(0x323);
    if ((held(i) & 0x100) == 0) setState(i, 0x214);
  } else if (state == 0x117) {
    // the third special's charge, up to five
    int charge = read8(rec + 143) + 1;
    if (charge > 5) charge = 5;
    write8(rec + 143, (uint8_t)charge);
    gba_sound_play(0x338);
    if ((held(i) & 0x100) == 0) setState(i, 0x217);
  } else if (state == 0x115) {
    if ((held(i) & 0x100) == 0) setState(i, 0x215);
  } else if (state == 0x213) {
    int charge = read8(rec + 143);
    write16(rec + 166, (uint16_t)(charge <= 4 ? 0xFE00 : charge <= 11 ? 0xFC00 : 0xF880));
    write16(rec + 168, 24);
  } else if (state == 0x214) {
    write16(rec + 168, 20);
  } else if (state == 0x217) {
    write16(rec + 168, 24);
  } else if (state == 0x218) {
    write16(rec + 168, 20);
  } else if (state == 0x116) {
    write16(rec + Z, read16(rec + GROUND));
    write32(rec + FLAGS, read32(rec + FLAGS) | 1);
  }
  // (0x08002762) what the special attacks' states do with their things
  if (state == 21 || state == 22) {
    // the state's own timer, which counts the special down, set by the frame that starts it
    int timer = 145 + (state - 21);
    if (read8(rec + timer) == 0) { write8(rec + timer, 240); return; }
  }
  if (state == 21) {
    if (read8(rec + 23) != 0) return;
    for (int k = 0; k < 12; k++) {
      uint32_t thing = 0x030017D0 + (uint32_t)k * 68;
      if (read8(thing + 53) == i && read16(thing + 56) == 35) notPorted("08002780");
    }
  } else if (state == 22) {
    if (read8(rec + 23) == 8) write16(rec + SPEED_Z, (uint16_t)(256 - (read16(rec + Z) - read16(rec + 52))));
  } else if (state == 23 || state == 24) {
    leaveThings(i);
    write8(rec + 236, 0);
  }
  #undef FACE_CAMERA
}

typedef struct { int wallX, wallY, edgeX, edgeY, bits; } Meeting;

static void keepLargest(Meeting *out, int which, int value) {
  int *field = which == 0 ? &out->wallX : &out->wallY;
  if (value < 0 ? -value > (*field < 0 ? -*field : *field) : value > (*field < 0 ? -*field : *field)) *field = s16(value);
}

static int cross(int startOther, int endOther, int start, int edge, int end) {
  if (startOther == endOther) return startOther;
  return startOther - (int)(((int32_t)(start - edge) * (startOther - endOther)) / (start - end));
}

static Meeting meetWalls(int x, int y, int oldX, int oldY) {
  Meeting out = {0, 0, 0, 0, 0};
  int count = read8(WALL_COUNT);
  for (int w = 0; w < count; w += 4) {
    int left = reads16(WALLS + (uint32_t)w * 2), right = reads16(WALLS + (uint32_t)(w + 1) * 2);
    int top = reads16(WALLS + (uint32_t)(w + 2) * 2), bottom = reads16(WALLS + (uint32_t)(w + 3) * 2);
    if (left < oldX && right > oldX && top < oldY && bottom > oldY && left < x && right > x && top < y && bottom > y) {
      out.bits = 15;
      out.wallX = 0;
      out.wallY = 0;
      continue;
    }
    if (top >= oldY && top < y) {
      int at = cross(oldX, x, oldY, top, y);
      if (at >= left && at <= right) { out.bits |= 4; keepLargest(&out, 1, y - top + 16); }
    }
    if (bottom <= oldY && bottom > y) {
      int at = cross(oldX, x, oldY, bottom, y);
      if (at >= left && at <= right) { out.bits |= 8; keepLargest(&out, 1, y - bottom - 16); }
    }
    if (left >= oldX && left < x) {
      int at = cross(oldY, y, oldX, left, x);
      if (at >= top && at <= bottom) { out.bits |= 1; keepLargest(&out, 0, x - left + 16); }
    }
    if (right <= oldX && right > x) {
      int at = cross(oldY, y, oldX, right, x);
      if (at >= top && at <= bottom) { out.bits |= 2; keepLargest(&out, 0, x - right - 16); }
    }
  }
  if (x > reads16(LIMIT_RIGHT)) { out.edgeX = s16(x - read16(LIMIT_RIGHT)); out.bits |= 16; }
  else if (x < reads16(LIMIT_LEFT)) { out.edgeX = s16(x - read16(LIMIT_LEFT)); out.bits |= 32; }
  if (y > reads16(LIMIT_DOWN)) { out.edgeY = s16(y - read16(LIMIT_DOWN)); out.bits |= 64; }
  else if (y < reads16(LIMIT_UP)) { out.edgeY = s16(y - read16(LIMIT_UP)); out.bits |= 128; }
  return out;
}

static uint16_t slowed(int speed, int slow, uint16_t rawSlow, uint16_t rawSpeed) {
  if (speed < -slow) return rawSlow;
  return speed > slow ? (uint16_t)-rawSlow : (uint16_t)-rawSpeed;
}

static const int FORWARD_X[10] = {0, -11, 0, 11, -16, 0, 16, -11, 0, 11};
static const int FORWARD_Y[10] = {0, 11, 16, 11, 0, 0, 0, -11, -16, -11};

void moveFighter(int i) {
  uint32_t rec = record(i);
  if (!(read32(rec + FLAGS) & FLAG_LOCKED) || read16(rec + STATE) == 255) {
    int facing = read8(rec + FACING);
    if (facing != 0) write8(rec + LAST_FACING, (uint8_t)facing);
    write8(rec + FACING, (uint8_t)padFacing(i));
  }
  int health = read8(rec + HEALTH), shownHealth = read16(rec + 194);
  int healthApart = health - shownHealth;
  if (healthApart < 0) write16(rec + 194, shownHealth - (healthApart < -10 ? 2 : 1));
  else if (healthApart > 0) write16(rec + 194, shownHealth + (healthApart > 10 ? 2 : 1));
  int power = read8(rec + 147), shownPower = read8(rec + 148);
  if (power < shownPower) write8(rec + 148, shownPower - 1);
  else if (power > shownPower) write8(rec + 148, shownPower + 1);
  if (read8(rec + 147) > 71) { write8(rec + 147, 72); write8(rec + 149, read8(rec + 149) | 1); }
  int pause = read8(rec + PAUSE);
  if (pause != 0) { write8(rec + PAUSE, pause - 1); return; }
  int facing = read8(rec + FACING), walk = reads16(rec + WALK), slow = reads16(rec + SLOW);
  uint16_t rawSlow = read16(rec + SLOW);
  int16_t forwardX = (int16_t)(((uint32_t)(FORWARD_X[facing] * walk) << 12) >> 16);
  int16_t forwardY = (int16_t)(((uint32_t)(FORWARD_Y[facing] * walk) << 12) >> 16);
  int16_t slowX = (int16_t)slowed(reads16(rec + SPEED_X), slow, rawSlow, read16(rec + SPEED_X));
  int16_t slowY = (int16_t)slowed(reads16(rec + SPEED_Y), slow, rawSlow, read16(rec + SPEED_Y));
  int diagonal = facing == 1 || facing == 3 || facing == 7 || facing == 9;
  if (diagonal) {
    slowX = (int16_t)(((uint32_t)(slowX * 11) << 12) >> 16);
    slowY = (int16_t)(((uint32_t)(slowY * 11) << 12) >> 16);
  }
  write16(rec + SPEED_X, (uint16_t)(s16(slowX) + read16(rec + SPEED_X) + s16(forwardX)));
  write16(rec + SPEED_Y, (uint16_t)(s16(slowY) + read16(rec + SPEED_Y) + s16(forwardY)));
  int top = read16(rec + MAX_SPEED);
  write16(rec + TOP_SPEED, (uint16_t)(((diagonal ? ((uint32_t)top * 11u) >> 4 : (uint32_t)top) + read16(rec + TOP_SPEED)) >> 1));
  int limit = read16(rec + TOP_SPEED);
  int speedX = reads16(rec + SPEED_X), speedY = reads16(rec + SPEED_Y);
  if (speedX > limit) write16(rec + SPEED_X, (uint16_t)limit);
  else if (speedX < -limit) write16(rec + SPEED_X, (uint16_t)-limit);
  if (speedY > limit) write16(rec + SPEED_Y, (uint16_t)limit);
  else if (speedY < -limit) write16(rec + SPEED_Y, (uint16_t)-limit);
  if (reads16(rec + Z) > reads16(rec + GROUND)) {
    int fall = s16(read16(rec + SPEED_Z) - read16(rec + FALL));
    write16(rec + SPEED_Z, (uint16_t)fall);
    if (fall > 256) write16(rec + SPEED_Z, 256);
    else if (fall < -256) write16(rec + SPEED_Z, (uint16_t)-256);
  }
  if (read16(rec + STATE) != 254) {
    int x = read16(rec + X), y = read16(rec + Y), z = read16(rec + Z);
    write16(rec + OLD_X, (uint16_t)x);
    write16(rec + OLD_Y, (uint16_t)y);
    write16(rec + OLD_Z, (uint16_t)z);
    write16(rec + X, (uint16_t)(x + (reads16(rec + SPEED_X) >> 4)));
    write16(rec + Y, (uint16_t)(y + (reads16(rec + SPEED_Y) >> 4)));
    write16(rec + Z, (uint16_t)(z + (reads16(rec + SPEED_Z) >> 4)));
  }
  int height = reads16(rec + Z), ground = reads16(rec + GROUND);
  if (height < ground) write16(rec + Z, (uint16_t)ground);
  else if (height > 196) write16(rec + Z, 196);
  for (int j = 0; j < 4; j++) if (j != i && isActive(j)) pushApart(i, j);
  int character = read8(rec + CHARACTER_NOW), state = read16(rec + STATE);
  if ((character == 2 && state == 278) || (character == 3 && state == 0x115)) write16(rec + Z, read16(rec + GROUND));
  else if (character == 20 && state == 22) notPorted("0800597C");
  Meeting met = meetWalls(reads16(rec + X), reads16(rec + Y), reads16(rec + OLD_X), reads16(rec + OLD_Y));
  write8(rec + BUMPED, (uint8_t)met.bits);
  if (met.bits & 15) {
    if (reads16(rec + Z) >= reads16(FLOOR)) { met.wallX = 0; met.wallY = 0; }
    if (met.wallX == 0 && met.wallY == 0) {
      write8(rec + BUMPED, read8(rec + BUMPED) & 0xF0);
      uint16_t floor = read16(FLOOR);
      write16(rec + GROUND, floor);
      if (reads16(rec + Z) < s16(floor)) write16(rec + Z, floor);
    } else if (read16(rec + STATE) == 255) {
      write8(rec + BUMPED, read8(rec + BUMPED) & 0xF0);
      write16(rec + GROUND, read16(FLOOR));
    } else write16(rec + GROUND, 0);
  } else write16(rec + GROUND, 0);
  if (read16(rec + STATE) == 255) write16(rec + Z, i == (int)read32(PLAYER_) ? read16(rec + GROUND) : 80);
  if ((character == 2 && state == 278) || (character == 3 && state == 0x115)) {
    if (read8(rec + BUMPED) & 15) write16(rec + GROUND, read16(FLOOR));
    write8(rec + BUMPED, read8(rec + BUMPED) & 0xF0);
  }
  int bumped = read8(rec + BUMPED);
  if (bumped & 15) {
    write16(rec + X, read16(rec + X) - (uint16_t)met.wallX);
    write16(rec + Y, read16(rec + Y) - (uint16_t)met.wallY);
  }
  if (bumped & 0xF0) {
    write16(rec + X, read16(rec + X) - (uint16_t)met.edgeX);
    write16(rec + Y, read16(rec + Y) - (uint16_t)met.edgeY);
  }
  if (read8(rec + 236) != 0) leaveThings(i);
}

static void pushApart(int i, int j) {
  uint32_t rec = record(i), other = record(j);
  int x = reads16(rec + X), y = reads16(rec + Y);
  uint32_t near = 169u << 10;
  int16_t dx = s16(read16(rec + X) - read16(other + X)), dy = s16(read16(rec + Y) - read16(other + Y));
  write16(rec + 54 + (uint32_t)j * 2, (uint16_t)dx);
  write16(rec + 62 + (uint32_t)j * 2, (uint16_t)dy);
  write32(rec + 72 + (uint32_t)j * 4, (uint32_t)(dx * dx + dy * dy));
  int16_t dz = s16(read16(other + Z) - read16(rec + Z));
  write16(rec + 88 + (uint32_t)j * 2, (uint16_t)dz);
  if (!(read32(other + FLAGS) & FLAG_GROUNDED)) return;
  if ((dz < 0 ? -dz : dz) >= read8(rec + 186)) return;
  uint16_t otherState = read16(other + STATE);
  if (otherState >= 252 && otherState <= 255) return;
  int character = read8(rec + CHARACTER_NOW), state = read16(rec + STATE);
  if ((character == 2 && state == 278) || (character == 3 && state == 0x115)) return;
  int32_t distance = reads32(rec + 72 + (uint32_t)j * 4);
  if (distance >= (int32_t)near) return;
  int push = ((near - (uint32_t)distance) >> 16) << ((read32(rec + FLAGS) & 1) ? 7 : 5);
  if ((dx < 0 ? -dx : dx) < (dy < 0 ? -dy : dy)) {
    write16(rec + SPEED_X, (uint16_t)(read16(rec + SPEED_X) + (x > reads16(other + X) ? push : -push)));
  } else write16(rec + SPEED_Y, (uint16_t)(read16(rec + SPEED_Y) + (y > reads16(other + Y) ? push : -push)));
}

static const uint32_t REACTION_FLAGS = 0x800u | 0x80u | 0x20u | 0x40u | 0x10u | 0x8u | 0x200u | 0x100u | 0x400u
  | 0x1000u | 0x2000u | 0x4000u | 0x8000u | 0x10000u | 0x20000u;

static int isThrownKind(int kind) {
  return kind == 1 || kind == 2 || kind == 3 || kind == 4 || kind == 6 || kind == 8 || kind == 10 || kind == 11
    || kind == 12 || kind == 13 || kind == 14 || kind == 15;
}

static void guardHit(int i, int j);

void takeHits(int i) {
  uint32_t rec = record(i);
  uint16_t state = read16(rec + STATE);
  if ((state >= 252 && state <= 253) || state == 254 || state == 255) return;
  if (read8(rec + PAUSE) != 0 && read8(rec + PAUSE_NEXT) != 0) { settleHits(i); return; }
  uint32_t bit = 0x2000u << i;
  for (int j = 0; j < 4; j++) {
    if (j == i || !isActive(j)) continue;
    uint32_t attacker = record(j), attacks = read32(attacker + ATTACKS);
    if (!(attacks & bit)) continue;
    int kind = (attacks >> 8) & 0x1F, guard = read8(rec + 141) & 0x30;
    uint16_t now = read16(rec + STATE);
    if (now == 53 || now == 0x135 || read8(rec + 151) != 0
      || ((kind == 10 || kind == 11 || kind == 12) && guard == 0x20)
      || ((kind == 13 || kind == 14) && guard == 0x10) || (kind == 15 && guard == 0x30)) {
      guardHit(i, j);
      break;
    }
    clearFlags(rec, 0x40000);
    if (KIND_REACTION[kind] != 0) addFlags(rec, KIND_REACTION[kind]);
    int way = (attacks >> (24 + i * 2)) & 15;
    if (isThrownKind(kind) && way <= 3) {
      int facing = way == 0 ? 8 : way == 1 ? 6 : way == 2 ? 4 : 2;
      write8(rec + 36, (uint8_t)facing);
      write8(rec + 37, (uint8_t)facing);
    }
    write8(rec + 124, (uint8_t)j);
    write8(rec + 127, (uint8_t)(kind > 9 ? 255 : 15));
    int power = attacks & 0xFF;
    if (kind == 9) {
      write16(rec + 240, 0);
      write16(rec + 242, 0);
    } else if (power == 63) {
      write16(rec + 240, read8(rec + HEALTH));
      write8(rec + 192, 1);
    } else {
      int weight = (read8(SETUP_ + 20 + i) >> 1) - read8(SETUP_ + 12 + j);
      int damage = s16(power) - ((s16(power) * weight) >> 4);
      if (damage <= 0) damage = 1;
      write16(rec + 240, (uint16_t)damage);
      int gained = (damage << 16) >> 19;
      if (gained <= 0) gained = 1;
      if (read8(rec + 155) == 9) gained <<= 1;
      write16(rec + 242, (uint16_t)gained);
    }
    write8(rec + PAUSE_NEXT, (uint8_t)((attacks >> 17) & 0x7F));
  }
  // a thing's hit, kept in its owner's record at 174: the damage in its low six bits, the kind above them, the fighter
  // it reached in bits 11 and 12, and the frames it holds for above those
  for (int j = 0; j < 4; j++) {
    if (j == i || !isActive(j)) continue;
    uint32_t attacker = record(j);
    uint16_t raw = read16(attacker + 174);
    if (raw == 0 || ((raw >> 11) & 3) != i) continue;
    int kind = (raw >> 6) & 0x1F, guard = read8(rec + 141) & 0x30;
    uint16_t now = read16(rec + STATE);
    if (now == 53 || now == 0x135 || read8(rec + 151) != 0
      || ((kind == 10 || kind == 11 || kind == 12) && guard == 0x20)
      || ((kind == 13 || kind == 14) && guard == 0x10) || (kind == 15 && guard == 0x30)) {
      guardHit(i, j);
      break;
    }
    clearFlags(rec, 0x40000);
    addFlags(rec, 1u << (kind + 2));
    write8(rec + 124, (uint8_t)j);
    write8(rec + 127, (uint8_t)(kind > 9 ? 255 : 15));
    int power = raw & 0x3F;
    if (power == 63) {
      write16(rec + 240, read8(rec + HEALTH));
      write8(rec + 192, 1);
    } else {
      int weight = (read8(SETUP_ + 20 + i) >> 1) - read8(SETUP_ + 12 + j);
      int damage = s16(power) - ((s16(power) * weight) >> 4);
      if (damage <= 0) damage = 1;
      write16(rec + 240, (uint16_t)damage);
      int gained = (damage << 16) >> 19;
      if (gained <= 0) gained = 1;
      if (read8(rec + 155) == 9) gained <<= 1;
      write16(rec + 242, (uint16_t)gained);
    }
    write8(rec + PAUSE_NEXT, (uint8_t)(raw >> 13));
    break;
  }
  settleHits(i);
}

static void guardHit(int i, int j) {
  uint32_t rec = record(i), attacker = record(j);
  if ((read8(rec + 126) >> j) & 1) return;
  if (read8(rec + 151) == 5) return;
  addFlags(rec, 0x40000);
  write8(rec + 151, 6);
  if (read8(rec + PAUSE) == 0) {
    setState(i, 0x135);
    write8(rec + PAUSE_DONE, 1);
    write8(rec + PAUSE, (uint8_t)((read32(attacker + ATTACKS) & 0xFE0000) >> 17));
  }
  write32(rec + ATTACKS, read32(rec + ATTACKS) | 0x40000);
  if (read8(0x0300138C) != 0 && i != (int)read32(PLAYER_)) {
    if (i != (int)read32(PLAYER_) + 2 || read8(SETUP_ + 28 + i) == 0) return;
  }
  write8(rec + 126, (uint8_t)(read8(rec + 126) | ((read32(rec + ATTACKS) >> 13) & 15)));
  write32(rec + ATTACKS, 0x900u | (0x2000u << j));
  if (read8(rec + 125) == 255) write8(rec + 125, (uint8_t)j);
  write32(rec + 120, read32(rec + ATTACKS));
  write16(rec + 176, 0);
  int power = read8(attacker + ATTACKS);
  if (power == 63) {
    write8(rec + 147, 72);
    write16(rec + 242, 0);
    return;
  }
  int gained = power >> 1;
  if (gained == 0) gained = 1;
  if (read8(rec + 155) == 9) gained <<= 1;
  write16(rec + 242, (uint16_t)gained);
}

static void settleHits(int i) {
  uint32_t rec = record(i);
  if (read8(rec + PAUSE) != 0) return;
  uint32_t flags = read32(rec + FLAGS);
  if (flags & REACTION_FLAGS) {
    write8(rec + 184, 1);
    if (read8(rec + 36) == 0) write8(rec + 36, read8(rec + 37));
    if (flags & 0x80) setState(i, 68);
    else if (flags & 0x800) setState(i, 54);
    else if (flags & 0x200) setState(i, 0x145);
    else if (flags & 0x400) setState(i, 0x147);
    else if (flags & 0x1000) setState(i, 80);
    else if (flags & 0x2000) setState(i, 81);
    else if (flags & 0x4000) setState(i, 82);
    else if (flags & 0x8000) setState(i, 83);
    else if (flags & 0x10000) setState(i, 84);
    else if (flags & 0x20000) setState(i, 85);
    else if (flags & 0x20) setState(i, 67);
    else if (flags & 0x40) setState(i, 0x143);
    else if (flags & 0x10) setState(i, 66);
    else if (flags & (0x8 | 0x100)) setState(i, flags & 4 ? 69 : 65);
    flags = (read32(rec + FLAGS) | 0x100000) & ~(REACTION_FLAGS | 0x200u | 0x400u | 0x800u | 0x1000u | 0x2000u
      | 0x4000u | 0x8000u | 0x10000u | 0x20000u);
    write32(rec + FLAGS, flags);
  }
  int damage = read16(rec + 240), taken = SETUP_ + 98 + (uint32_t)i * 2;
  write16(taken, read16(taken) + damage);
  int health = read8(rec + HEALTH);
  if (damage > health) { write16(rec + 240, (uint16_t)health); write8(rec + HEALTH, 0); }
  else write8(rec + HEALTH, (uint8_t)(health - damage));
  int most = read16(0x03001B28);
  if (read8(rec + HEALTH) > most) write8(rec + HEALTH, (uint8_t)most);
  int power = (read8(rec + 242) + read8(rec + 147)) & 0xFF;
  write8(rec + 147, (uint8_t)(power > 72 ? 72 : power));
  write16(rec + 240, 0);
  write16(rec + 242, 0);
  int shield = read8(rec + 151);
  if (shield != 0) write8(rec + 151, (uint8_t)(shield - 1));
}

void holdHits(void) {
  for (int i = 0; i < 4; i++) {
    uint32_t rec = record(i);
    if ((read32(rec + ATTACKS) & 0x1F00) == 0x900 && !(read32(rec + FLAGS) & 0x1000000)) addFlags(rec, 0x1000000);
    else { write32(rec + ATTACKS, 0); clearFlags(rec, 0x1000000); }
  }
}

void reachOthers(int i) {
  uint32_t rec = record(i), flags = read32(rec + FLAGS);
  if (flags & 0x40000) return;
  uint16_t state = read16(rec + STATE);
  if (state == 0x145 || state == 54) return;
  if ((read32(rec + ATTACKS) & 0x1F00) == 0x900) return;
  write32(rec + ATTACKS, 0);
  int aimed = read8(rec + 106);
  if (aimed & 2) {
    int way = read8(rec + 108);
    if (way == 4) write16(rec + 96, read16(rec + 96) - 16);
    else if (way == 6) write16(rec + 96, read16(rec + 96) + 16);
    else if (way == 2) write16(rec + 98, read16(rec + 98) + 16);
    else if (way == 8) write16(rec + 98, read16(rec + 98) - 16);
  }
  if (read16(rec + 104) == 0) return;
  int view = read8(VIEW_FACING);
  int x = reads16(rec), y = reads16(rec + 2), z = reads16(rec + 4);
  int ox = reads16(rec + 96), oy = reads16(rec + 98);
  int front = read8(rec + 16) == 1;
  int hitX, hitY;
  if (view == 0) { hitX = front ? x + ox : x - ox; hitY = y + oy; }
  else if (view == 1) { hitX = front ? x - ox : x + ox; hitY = y + oy; }
  else if (view == 2) { hitX = x + oy; hitY = front ? y - ox : y + ox; }
  else { hitX = x + oy; hitY = front ? y + ox : y - ox; }
  int hitZ = z + read16(rec + 100);
  int reach = read8(rec + 107);
  if (reach == 63) reach = 62;
  else if (reach > 100) reach = 100;
  for (int j = 0; j < 4; j++) {
    if (j == i) continue;
    uint32_t other = record(j);
    if (read8(other + 187) == 0) continue;
    if ((read8(rec + 126) >> j) & 1) continue;
    if (read8(SETUP_ + 20 + j) == 255) continue;
    if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 9) != 1 && read8(SETUP_ + 32 + j) == read8(SETUP_ + 32 + i)) continue;
    int dx = s16(hitX) - reads16(other), dy = s16(hitY) - reads16(other + 2);
    int radius = read16(rec + 104) + read8(other + 187);
    int high = (read8(rec + 102) + read8(other + 186)) >> 1;
    int apart = s16(hitZ) - reads16(other + 4);
    if ((apart < 0 ? -apart : apart) >= high) continue;
    if (dx * dx + dy * dy >= radius * radius) continue;
    uint32_t attacks = read32(rec + ATTACKS);
    if (attacks == 0) {
      attacks = (uint32_t)read8(rec + 106) << 8;
      int pause;
      if (read8(rec + 149) == 3) { attacks |= 63; pause = 10; }
      else { attacks |= reach; pause = read8(rec + 113); }
      write8(rec + 29, (uint8_t)pause);
      attacks |= (uint32_t)pause << 17;
    }
    write16(SETUP_ + 90 + (uint32_t)i * 2, read16(SETUP_ + 90 + (uint32_t)i * 2) + reach);
    attacks |= 0x2000u << j;
    write8(rec + 126, (uint8_t)(read8(rec + 126) | (1 << j)));
    int direction = -1;
    if (read8(rec + 106) == 2 || (read8(rec + 106) >= 10 && read8(rec + 106) <= 15)) {
      int mode = read8(rec + 36);
      if (mode == 4) direction = 1;
      else if (mode == 6) direction = 2;
      else if (mode == 8) direction = 3;
    }
    if (direction < 0) {
      uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10;
      int side = read8(rec + 16) == 0 ? 4 : 6;
      int way = read8(camera + (uint32_t)side);
      if (way == 4) direction = 1;
      else if (way == 6) direction = 2;
      else if (way == 8) direction = 3;
    }
    if (direction > 0) attacks |= (uint32_t)direction * (0x1000000u << (j * 2));
    write32(rec + 120, attacks);
    write32(rec + ATTACKS, attacks);
    write16(rec + 176, 0);
    uint32_t hits = SETUP_ + 66 + (uint32_t)i * 2;
    write16(hits, read16(hits) + 1);
    if (read8(SETUP_ + 137 + i) == 1) {
      uint32_t count = SETUP_ + 74 + (uint32_t)i * 2;
      write16(count, read16(count) + 1);
      write8(SETUP_ + 137 + i, 2);
    }
  }
}

void readFighterKeys(int i) {
  uint32_t rec = record(i);
  uint16_t stateNow = read16(rec + STATE);
  int asks = read8(rec + 138);
  if (!(asks & 0xF8) && stateNow != 4) {
    uint16_t keys = pressed(i);
    int side = read8(rec + 16);
    if (((keys & 0x20) && side == 1) || ((keys & 0x10) && side == 0)) write8(rec + 109, 4);
    uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10;
    if (keys & 0x20) write8(rec + 108, read8(camera + 4));
    else if (keys & 0x10) write8(rec + 108, read8(camera + 6));
    else if (keys & 0x40) write8(rec + 108, read8(camera + 8));
    else if (keys & 0x80) write8(rec + 108, read8(camera + 2));
    if (keys & 2) {
      if (pressedBefore(i, 4, 6, 0xF0)) {
        if (pressedBefore(i, 4, 6, 0x10) && side == 0) asks |= 0x10;
        else if (pressedBefore(i, 4, 6, 0x20) && side == 1) asks |= 0x10;
        else asks |= 8;
      } else if (asks & 4) asks |= 8;
      else if (asks & 2) asks |= 4;
      else if (asks & 1) asks |= 2;
      else { asks |= 1; write8(rec + 108, 0); }
      write8(rec + 138, (uint8_t)asks);
    } else if (keys & 0x100) {
      int slot = read8(rec + 141) & 3;
      if (slot == 1) write8(rec + 138, (uint8_t)(asks | 0x40));
      else if (slot == 2) write8(rec + 138, (uint8_t)(asks | 0x20));
      else if (slot == 3) write8(rec + 138, (uint8_t)(asks | 0x80));
    }
  }
  uint16_t state = read16(rec + STATE);
  int character = read8(rec + CHARACTER_NOW);
  if (state == 13 || (state == 15 && (character == 2 || character == 5)) || (state == 21 && (character == 2 || character == 4))) {
    uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10, way = read8(rec + 108);
    uint16_t heldKeys = held(i);
    int pointing = (way == read8(camera + 4) && (heldKeys & 0x20)) || (way == read8(camera + 6) && (heldKeys & 0x10))
      || (way == read8(camera + 8) && (heldKeys & 0x40)) || (way == read8(camera + 2) && (heldKeys & 0x80));
    if (pointing) addFlags(rec, 0x40000000);
    else clearFlags(rec, 0x800000 | 0x4000000 | 0x2000000);
  } else clearFlags(rec, 0x800000 | 0x4000000 | 0x2000000);
  if (state == 66) {
    uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10, facing = read8(rec + 37);
    uint16_t heldKeys = held(i);
    int pointing = (facing == read8(camera + 4) && (heldKeys & 0x20)) || (facing == read8(camera + 6) && (heldKeys & 0x10))
      || (facing == read8(camera + 8) && (heldKeys & 0x40)) || (facing == read8(camera + 2) && (heldKeys & 0x80));
    write8(rec + 185, (uint8_t)(pointing ? 1 : 0));
  }
  static const int timers[3] = {109, 110, 112};
  for (int n = 0; n < 3; n++) {
    int left = read8(rec + timers[n]);
    if (left != 0) write8(rec + timers[n], (uint8_t)(left - 1));
  }
  if (state == 55) {
    int clock = (read8(rec + 190) + 1) & 0xFF;
    write8(rec + 190, (uint8_t)clock);
    if (clock % read8(rec + 188) == 0 && read8(rec + HEALTH) < read16(0x03001B28)) write8(rec + HEALTH, read8(rec + HEALTH) + 1);
    if (clock % read8(rec + 189) == 0 && read8(rec + 147) <= 71) write8(rec + 147, read8(rec + 147) + 1);
  }
  static const int timers2[2] = {145, 146};
  for (int n = 0; n < 2; n++) {
    int left = read8(rec + timers2[n]);
    if (left == 0) continue;
    if (left == 1) {
      setState(i, timers2[n] == 145 ? 0x215 : 0x216);
      write8(rec + timers2[n], 0);
      continue;
    }
    // 0x08005888 asks for song 0x338 at this timer's steps, but the original never sounds it: Sonic's
    // specials-power and Cream's air Power show only the special's own sound while the timer runs down.
    write8(rec + timers2[n], (uint8_t)(left - 1));
  }
}

static int keepsItsStateInTheAir(int state) {
  static const int states[] = {
    4, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 52, 54, 66, 67, 68, 69, 70, 71, 80, 81, 82, 83, 84,
    85, 96, 252, 253, 254, 255, 0x111, 0x113, 0x114, 0x115, 0x116, 0x117, 0x118, 0x135, 0x143, 0x145, 0x147, 0x150,
    0x213, 0x214, 0x215, 0x216, 0x217, 0x218,
  };
  for (unsigned n = 0; n < sizeof states / sizeof states[0]; n++) if (states[n] == state) return 1;
  return 0;
}

static int stands(int state) {
  static const int states[] = {0, 1, 2, 3, 5, 10, 11, 12, 13, 14, 52, 0x105, 0x135};
  for (unsigned n = 0; n < sizeof states / sizeof states[0]; n++) if (states[n] == state) return 1;
  return 0;
}

static int noDash(int state) {
  static const int states[] = {4, 19, 20, 21, 22, 23, 24, 0x113, 0x114, 0x115, 0x116, 0x117, 0x118, 0x213, 0x214, 0x215, 0x216, 0x217, 0x218};
  for (unsigned n = 0; n < sizeof states / sizeof states[0]; n++) if (states[n] == state) return 1;
  return 0;
}

static void attackAsked(int i);
static void turnForAttack(uint32_t rec);

void fighterAct(int i) {
  uint32_t rec = record(i);
  for (int j = 0; j < 4; j++) {
    if (j == i) continue;
    uint32_t victim = record(j);
    if ((read8(victim + 127) & 15) != i || !isActive(j)) continue;
    if (read8(SETUP_ + 20 + j) == 255) continue;
    if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 32 + j) == read8(SETUP_ + 32 + i)) continue;
    write8(SETUP_ + 47 + j, (uint8_t)(read8(SETUP_ + 47 + j) + 1 > 3 ? 3 : read8(SETUP_ + 47 + j) + 1));
    if (read8(victim + 127) & 0xF0) write8(SETUP_ + 11 + i, read8(SETUP_ + 11 + i) + 1);
    write8(victim + 127, 15);
  }
  if (read8(rec + 157) != 0 || read8(rec + 156) != 0) notPorted("0800486C");
  landOrFall(i);
  if (read8(rec + PAUSE) != 0) return;
  uint32_t flags = read32(rec + FLAGS);
  if ((flags & 0x800000) && (flags & 0x2000000) && (flags & 0x4000000)) notPorted("0800486C");
  if (read16(rec + STATE) == 16) notPorted("0800486C");
  if ((flags & 0x80000) && reads16(rec + SCRIPT_FRAME) > 6) notPorted("0800486C");
  uint16_t keys = pressed(i);
  if (read16(rec + STATE) == 4 && (keys & 2)) notPorted("0800486C");
  if (flags & FLAG_GROUNDED) {
    if ((keys & 0xF0) && pressedBefore(i, 5, 5, keys) && !(flags & 0x40000) && !noDash(read16(rec + STATE))) setState(i, 4);
    int state = read16(rec + STATE);
    if (!stands(state)) return;
    if (keys & 1) { if (!(flags & 0x40000)) setState(i, 7); }
    else if (keys & 0x200) {
      if (!(flags & FLAG_LOCKED)) setState(i, 53);
      else if (state != 52 || reads16(rec + SCRIPT_FRAME) > 12) setState(i, 53);
    } else if (read8(rec + 17) != read8(rec + 18)) {
      if (state == 2 || state == 3 || state == 5) setState(i, 5);
      else if (state == 0 || state == 0x105 || state == 1) setState(i, 0x105);
    } else if (state == 0 && (held(i) & 0xF0)) setState(i, 1);
    else if (!(held(i) & 0xF0)) {
      state = read16(rec + STATE);
      if (state == 2 || (state == 1 && reads16(rec + SCRIPT_AT) > 11)) setState(i, 3);
      else if (state == 1) setState(i, 0);
    }
    attackAsked(i);
    return;
  }
  if (!(flags & FLAG_IN_AIR)) return;
  int state = read16(rec + STATE);
  if (state == 6 || state == 7 || state == 9) {
    if (flags & FLAG_LOCKED) return;
    if (keys & 1) {
      int character = read8(SETUP_ + 20 + i), now = read16(rec + STATE);
      int copied = character == 9 && read8(0x030013B0 + (uint32_t)i * 156 + 10) == 4;
      if (read8(rec + 184) == 2 || ((character == 4 || copied) && now != 9)) {
        write8(rec + 36, read8(rec + 37));
        setState(i, 9);
        return;
      }
    }
    if (keys & 2) { setState(i, 18); return; }
    if ((keys & 0x100) && read8(rec + 184) != 0) {
      int slot = read8(rec + 141) & 12;
      if (slot == 4) setState(i, 20);
      else if (slot == 8) setState(i, 22);
      else if (slot == 12) setState(i, 24);
    }
    return;
  }
  if (!keepsItsStateInTheAir(state)) setState(i, 6);
}

static void attackAsked(int i) {
  uint32_t rec = record(i), flags = read32(rec + FLAGS);
  if (!(flags & FLAG_CHAIN)) {
    if (flags & FLAG_LOCKED) return;
    int asks = read8(rec + 138);
    if (asks & 0x10) { turnForAttack(rec); setState(i, 14); return; }
    if (asks & 0x8) { setState(i, 13); return; }
    if (asks & 0x20) { setState(i, 21); return; }
    if (asks & 0x40) { setState(i, 19); return; }
    if (asks & 0x80) { setState(i, 23); return; }
    if (asks & 1) { setState(i, 10); return; }
    return;
  }
  int asks = read8(rec + 138);
  int state = read16(rec + STATE);
  if (state == 10) asks &= 0xFE;
  else if (state == 11) asks &= 0xFD;
  else if (state == 12) asks &= 0xFB;
  write8(rec + 138, (uint8_t)asks);
  if (asks & 2) { setState(i, 11); return; }
  if (asks & 4) { setState(i, 12); return; }
  if (asks & 0x10) { turnForAttack(rec); setState(i, 14); return; }
  if (asks & 0x8) {
    uint32_t camera = DIRECTIONS + (uint32_t)read8(rec + CAMERA) * 10, way = read8(rec + 108);
    int front = read8(rec + 16) == 1;
    int forward = (way == read8(camera + 4) && front) || (way == read8(camera + 6) && !front);
    setState(i, forward ? 14 : 13);
    return;
  }
  if (asks & 0x20) { setState(i, 21); return; }
  if (asks & 0x40) { setState(i, 19); return; }
  if (asks & 0x80) { setState(i, 23); return; }
  if (asks & 1) setState(i, 10);
}

static void turnForAttack(uint32_t rec) {
  int mode = read8(rec + 36);
  if (mode == 4) write8(rec + 36, 6);
  else if (mode == 6) write8(rec + 36, 4);
  else if (mode == 8) write8(rec + 36, 2);
  else if (mode == 2) write8(rec + 36, 8);
}

void landOrFall(int i) {
  uint32_t rec = record(i);
  if (read8(rec + PAUSE) != 0) return;
  int state = read16(rec + STATE);
  int bumped = read8(rec + BUMPED);
  if (bumped != 0 && (state == 66 || state == 81)) {
    static const int ways[8][2] = {{1, 4}, {2, 6}, {4, 8}, {8, 2}, {16, 4}, {32, 6}, {64, 8}, {128, 2}};
    int facing = read8(rec + LAST_FACING), intoWall = 0;
    for (int n = 0; n < 8; n++) if ((bumped & ways[n][0]) != 0 && facing == ways[n][1]) intoWall = 1;
    if (intoWall) {
      if (read8(rec + 185) == 1) {
        write8(rec + 125, read8(rec + 124));
        setState(i, 96);
      } else addFlags(rec, 0x80);
    }
  }
  #define IN_AIR() do { write32(rec + FLAGS, (read32(rec + FLAGS) & ~(FLAG_GROUNDED | FLAG_LANDED)) | FLAG_IN_AIR); write8(rec + 244, 0); } while (0)
  if (reads16(rec + Z) == reads16(rec + GROUND)) {
    int flying = state == 7 || state == 66 || state == 67 || state == 0x143 || reads16(rec + SPEED_Z) > 0;
    if (!flying || state == 6) {
      write8(rec + 184, 2);
      uint32_t flags = read32(rec + FLAGS);
      if (flags & FLAG_GROUNDED) write32(rec + FLAGS, flags & ~FLAG_LANDED);
      else {
        write32(rec + FLAGS, flags | FLAG_LANDED | FLAG_GROUNDED);
        write16(rec + SPEED_Z, 0);
      }
      clearFlags(rec, FLAG_IN_AIR);
    } else IN_AIR();
    if (reads16(rec + Z) == reads16(rec + OLD_Z)) {
      int still = (read8(rec + 244) + 1) & 0xFF;
      write8(rec + 244, (uint8_t)still);
      if (still > 8) write16(rec + SPEED_Z, 0);
    } else write8(rec + 244, 0);
  } else IN_AIR();
  #undef IN_AIR
  if (read8(SETUP_ + 125) == 4) for (int j = 0; j < 4; j++) write8(record(j) + HEALTH, 100);
  if (read8(rec + HEALTH) == 0) {
    // 0x0800444c: a fighter out of health. On the ground its opponent gains a point and it takes state 253; in the air
    // it takes state 252 and flies back. Either state's script ends it in 254, lying down.
    int current = read16(rec + STATE);
    if ((uint16_t)(current - 254) <= 1) return;
    if (current != 253 && (read32(rec + FLAGS) & 1)) {
      // the other fighter gains the point: the one whose hit took this fighter's health, or the other one in play
      int scorer = read8(rec + 124);
      if (scorer == i || scorer > 3) {
        scorer = -1;
        for (int j = 0; j < 4; j++) if (j != i && read8(SLOTS_ + j) != 255) { scorer = j; break; }
      }
      if (scorer >= 0) write8(SETUP_ + 51 + (uint32_t)scorer, (uint8_t)(read8(SETUP_ + 51 + scorer) + 1));
      write8(SETUP_ + 47 + i, 0);
      setState(i, 253);
      write8(rec + 28, 0);
      write8(rec + 29, 0);
      return;
    }
    if ((uint16_t)(current - 252) <= 1) return;
    if (!(read32(rec + FLAGS) & 4)) return;
    setState(i, 252);
    write8(rec + 28, 0);
    write8(rec + 29, 0);
    return;
  }
  uint32_t flags = read32(rec + FLAGS);
  int now = read16(rec + STATE);
  if (flags & FLAG_LANDED) {
    if (now == 0x145) { setState(i, 70); return; }
    if (now == 70 || now == 0x147 || now == 84 || now == 68) { setState(i, 71); return; }
    if (now == 6) { setState(i, 8); return; }
    if (now == 71) { setState(i, 52); return; }
    int character = read8(rec + CHARACTER_NOW);
    if ((character == 0 || character == 10 || character == 20 || character == 2) && now == 22) { setState(i, 278); return; }
    if (character == 2 && now == 278) return;
    if (character == 3 && now == 0x115) return;
    if (character == 8 && now == 24) { setState(i, 280); return; }
    if (now == 0x147 || now == 52) return;
    if ((character == 7 || character == 17 || character == 18) && u16(now - 0x215) <= 1) return;
    setState(i, 8);
  } else if (flags & FLAG_GROUNDED) {
    if (now == 0x145) setState(i, 70);
    else if (now == 6) setState(i, 8);
  }
}

// a thing's record, 68 bytes in work RAM, by what the code does with it
enum {
  THING_MODE = 4, THING_SHAKE = 6, THING_SPEED_X = 8, THING_SPEED_Y = 10, THING_SPEED_Z = 12, THING_FALL = 14,
  THING_BITS = 16, THING_FLOOR = 17, THING_SCREEN_X = 18, THING_SCRIPT_AT = 22, THING_FRAME = 24,
  THING_PICTURE = 26, THING_ACROSS = 34, THING_DOWN = 42, THING_FOLLOWS = 51, THING_PICTURE_WAIT = 52,
  THING_OWNER = 53, THING_WAIT = 54, THING_HIT_MASK = 55, THING_KIND = 56, THING_X = 58, THING_Y = 60,
  THING_Z = 62, THING_FACING = 64, THING_FULL = 65, THING_HIT_ONCE = 66,
};

/** The script of each kind of thing, as the cartridge's per-kind cases of 0x0800c728 give it. */
typedef struct { uint16_t kind; uint32_t script; } ThingScript;
static const ThingScript THING_SCRIPTS[] = {
  {3, 0x0806B514}, {4, 0x0806B54C}, {5, 0x0806B594}, {8, 0x0806B630}, {10, 0x0806B6B4}, {11, 0x0806B7B0},
  {12, 0x0806B8CC}, {13, 0x0806B940}, {14, 0x0806B804}, {15, 0x0806B9D4}, {16, 0x0806BB08}, {31, 0x0806BB08},
  {32, 0x0806BBA0}, {34, 0x0806BBF4}, {35, 0x0806BC54}, {40, 0x0806C6EC}, {37, 0x0806C07C}, {38, 0x0806C1AC},
  {39, 0x0806C448}, {43, 0x0806C60C}, {44, 0x0806C67C}, {45, 0x0806C8F4}, {41, 0x0806C790}, {46, 0x0806C944},
  {73, 0x0806CE18}, {75, 0x0806CE98}, {77, 0x0806CFBC}, {79, 0x0806D29C}, {80, 0x0806D2EC}, {81, 0x0806D378},
  {54, 0x0806C984}, {57, 0x0806CA14}, {60, 0x0806CD14}, {61, 0x0806CD68},
  {117, 0x0806DC00}, {118, 0x0806DC60}, {114, 0x0806DB48}, {120, 0x0806DCBC}, {121, 0x0806DD04}, {122, 0x0806DDA4},
  {36, 0x0806C054}, {78, 0x0806D13C}, {158, 0x0806E520}, {160, 0x0806E5F0}, {154, 0x0806E268},
  {157, 0x0806E4DC}, {161, 0x0806E680}, {162, 0x0806E6E0}, {163, 0x0806E70C}, {164, 0x0806E76C},
  {165, 0x0806E82C}, {166, 0x0806E8EC}, {210, 0x0806F724}, {211, 0x0806F7E4}, {212, 0x0806F8A4},
  {213, 0x0806F924}, {214, 0x0806F9C8}, {215, 0x0806FA90}, {216, 0x0806FBA8}, {230, 0x0806FC60},
  {231, 0x0806FD88}, {240, 0x0806FCB0}, {241, 0x0806FCF0}, {245, 0x0806FE2C},
  {174, 0x0806E9AC}, {175, 0x0806EB10}, {177, 0x0806EC74}, {178, 0x0806ED0C}, {179, 0x0806EDA4},
  {180, 0x0806EE3C}, {181, 0x0806EEE8}, {191, 0x0806F318}, {197, 0x0806F4C4}, {200, 0x0806F55C},
};

static uint32_t thingScript(int kind) {
  for (unsigned i = 0; i < sizeof THING_SCRIPTS / sizeof THING_SCRIPTS[0]; i++) {
    if (THING_SCRIPTS[i].kind == (uint16_t)kind) return THING_SCRIPTS[i].script;
  }
  return 0;
}

static int thingField(int op) {
  switch (op) {
    case 0x3500: return 34; case 0x3700: return 36; case 0x3900: return 38; case 0x3B00: return 40;
    case 0x3600: return 42; case 0x3800: return 44; case 0x3A00: return 46; case 0x3C00: return 48;
    default: return -1;
  }
}

static int thingPictureWord(int op) {
  switch (op) { case 0x3100: return 0; case 0x3200: return 1; case 0x3300: return 2; case 0x3400: return 3; default: return -1; }
}

static int thingWithShape(int kind) {
  static const int kinds[] = {35, 37, 38, 39, 43, 44, 158, 160};
  for (unsigned i = 0; i < sizeof kinds / sizeof kinds[0]; i++) if (kinds[i] == kind) return 1;
  return 0;
}

static int inList(const int *list, unsigned count, int value) {
  for (unsigned i = 0; i < count; i++) if (list[i] == value) return 1;
  return 0;
}

/**
 * 0x0800bb88's pictures of a thing with a shape: the way it faces picks which of a picture's sides shows, and two
 * tables in the cartridge say how far each part sits across and down.
 */
static void shapeThingPicture(uint32_t thing, int kind, int part) {
  uint32_t field = thing + THING_PICTURE + (uint32_t)part * 2;
  uint32_t camera = 0x0806FF90u + (uint32_t)read8(VIEW_FACING) * 10;
  int facing = read8(thing + THING_FACING);
  int front = facing == read8(camera + 2), back = facing == read8(camera + 8);
  int picture = read16(field);
  if (kind == 35) {
    // one part's picture moves on a step while it is low enough
    if (reads16(thing + THING_Z) <= read8(thing + THING_FLOOR)) write16(field, (uint16_t)(picture + 16));
    return;
  }
  int away, below;
  uint32_t across, down;
  if (kind == 37) {
    if (front) picture += 0x100;
    else if (back) picture += 0x200;
    away = 0xF00; across = 0x0806C0ECu; down = 0x0806C14Cu; below = 8;
  } else if (kind == 38 || kind == 43) {
    if (front) picture += 0x2A0;
    else if (back) picture += 0x540;
    away = 0x1200; across = 0x0806C250u; down = 0x0806C34Cu; below = 36;
  } else if (kind == 39 || kind == 44) {
    if (front) picture += 0x1E0;
    else if (back) picture += 0x3C0;
    away = 0x1A00; across = 0x0806C4A4u; down = 0x0806C558u; below = 36;
  } else if (kind == 158 || kind == 160) {
    if (front) picture += 0x90;
    else if (back) picture += 0x120;
    write16(field, (uint16_t)picture);
    return;
  } else {
    notPorted("0800BB88");
    return;
  }
  write16(field, (uint16_t)picture);
  int frame = ((picture - away) >> 4) * 2;
  write16(thing + THING_ACROSS + (uint32_t)part * 2, read16(across + (uint32_t)frame));
  write16(thing + THING_DOWN + (uint32_t)part * 2, (uint16_t)(read16(down + (uint32_t)frame) - below));
}

/** 0x0800bb88: a thing's script for a frame, the words that come at the frame it is on. */
static void runThingScript(int k, uint32_t script) {
  uint32_t thing = 0x030017D0 + (uint32_t)k * 68;
  int kind = read16(thing + THING_KIND);
  #define WORD() read32(script + (uint32_t)read16(thing + THING_SCRIPT_AT) * 4)
  #define MARKED() ((WORD() & 0xFFFF0000u) == 0xFFF00000u)
  while (!MARKED()) write16(thing + THING_SCRIPT_AT, read16(thing + THING_SCRIPT_AT) + 1);
  if ((WORD() & 0xFFFF) == read8(thing + THING_FRAME)) {
    write16(thing + THING_SCRIPT_AT, read16(thing + THING_SCRIPT_AT) + 1);
    if (!MARKED()) {
      for (;;) {
        uint32_t w = WORD(), op = w >> 16;
        int field = thingField((int)op);
        int picture = thingPictureWord((int)op);
        if (field >= 0) write16(thing + (uint32_t)field, (uint16_t)w);
        else if (picture >= 0) {
          write16(thing + THING_PICTURE + (uint32_t)picture * 2, (uint16_t)w);
          if (thingWithShape(kind)) shapeThingPicture(thing, kind, picture);
        } else if (op == 0xFFFF) {
          clearEffect(k);
          write16(thing + THING_SCRIPT_AT, 0xFFFF);
          write8(thing + THING_FRAME, 255);
          write16(thing + THING_KIND, 0);
        } else if (op == 0x1300) write8(thing + THING_MODE, (uint8_t)w);
        else if (op == 0x1400) write8(thing + THING_MODE, 255);
        else if (op == 0x1500) write8(thing + THING_MODE, 254);
        else if (op == 0x1600) write8(thing + THING_PICTURE_WAIT, (uint8_t)w);
        else if (op == 0x3F00) write8(thing + THING_SHAKE, 1);
        else if (op == 0x3000) write8(0x030016CC, (uint8_t)w);
        else if (op == 0x0001 || (w >> 24) == 1) {
          int speed = s16(w), diagonal = (int16_t)(((uint32_t)(speed * 11) << 12) >> 16);
          switch (read8(thing + THING_FACING)) {
            case 1: write16(thing + THING_SPEED_X, (uint16_t)-diagonal); write16(thing + THING_SPEED_Y, (uint16_t)diagonal); break;
            case 2: write16(thing + THING_SPEED_Y, (uint16_t)s16(w)); break;
            case 3: write16(thing + THING_SPEED_X, (uint16_t)diagonal); write16(thing + THING_SPEED_Y, (uint16_t)diagonal); break;
            case 4: write16(thing + THING_SPEED_X, (uint16_t)-s16(w)); break;
            case 6: write16(thing + THING_SPEED_X, (uint16_t)s16(w)); break;
            case 7: write16(thing + THING_SPEED_X, (uint16_t)-diagonal); write16(thing + THING_SPEED_Y, (uint16_t)-diagonal); break;
            case 8: write16(thing + THING_SPEED_Y, (uint16_t)-s16(w)); break;
            case 9: write16(thing + THING_SPEED_X, (uint16_t)diagonal); write16(thing + THING_SPEED_Y, (uint16_t)-diagonal); break;
            default: break;
          }
        } else if (op == 0x0002) write16(thing + THING_SPEED_Z, (uint16_t)w);
        else if (op == 0x0012 || (w >> 24) == 0x12) write16(thing + THING_FALL, (uint16_t)w);
        else if (op == 0x2800) {
          int place = ((read16(thing + THING_SCREEN_X) - 88) << 17) >> 16;
          if (place > 127) place = 127;
          if (place < -127) place = -127;
          queueEffect(s16(w), place);
        } else if (op == 0x2300) {
          startEffect(s16(w), read8(thing + THING_FACING), read16(thing + THING_X), read16(thing + THING_Y),
            read16(thing + THING_Z), reads16(thing + THING_SPEED_X), reads16(thing + THING_SPEED_Y),
            reads16(thing + THING_SPEED_Z), read8(thing + THING_FOLLOWS), read8(thing + THING_OWNER),
            read8(thing + THING_FULL));
        } else if (op == 0xFFFE) {
          write16(thing + THING_SCRIPT_AT, 0xFFFF);
          write8(thing + THING_FRAME, 255);
        } else notPorted("0800BB88");
        write16(thing + THING_SCRIPT_AT, read16(thing + THING_SCRIPT_AT) + 1);
        if (MARKED()) break;
      }
    }
  }
  write8(thing + THING_FRAME, read8(thing + THING_FRAME) + 1);
  #undef MARKED
  #undef WORD
}

// 0x0800eaec's kinds of things that hit, each with what it hands 0x0800f0ac: its reach, its height, its damage, the
// frames the hit holds, its kind of hit (bits 6 to 10 of the record), whether it may hit the same fighter again, and
// the first and last frames of its own it hits in
typedef struct { int kind, reach, height, damage, hold, hitKind, again, first, last; } ThingHit;
static const ThingHit THING_HITS[] = {
  {38, 0x160, 6, 20, 2, 0x380, 0, 1, 255}, {41, 0x280, 4, 20, 2, 0x3C0, 0, 0, 22},
  {43, 0x160, 6, 20, 2, 0x380, 0, 0, 255}, {39, 0x160, 6, 20, 2, 0x380, 0, 1, 255},
  {44, 0x160, 6, 20, 2, 0x380, 0, 0, 255}, {79, 0x180, 12, 30, 3, 0x380, 0, 0, 255},
  {54, 0x100, 16, 30, 2, 0x280, 0, 11, 16}, {57, 0x120, 4, 5, 2, 0x340, 1, 0, 255},
  {117, 0x140, 6, 15, 2, 0x380, 0, 0, 255}, {122, 0x240, 20, 15, 2, 0x3C0, 0, 0, 22},
  {78, 0x300, 8, 20, 1, 0x380, 0, 0, 255}, {177, 0x140, 8, 20, 2, 0x380, 0, 0, 255},
  {178, 0x140, 8, 40, 4, 0x380, 0, 0, 255}, {179, 0x140, 8, 60, 6, 0x380, 0, 0, 255},
  {154, 0x120, 24, 30, 3, 0x2C0, 0, 4, 34}, {158, 0x120, 10, 30, 3, 0x380, 0, 0, 255},
  {160, 0x120, 10, 30, 3, 0x380, 0, 0, 255}, {191, 0x200, 20, 35, 3, 0x280, 0, 2, 20},
  {197, 0x140, 10, 30, 3, 0x340, 0, 0, 24},
};
// the kinds 0x0800eaec has hits for that aren't ported yet
static const int THING_HITS_LATER[] = {62, 63, 82, 94, 97, 102, 137, 138, 142, 165, 166, 174, 175, 185, 194, 201, 241,
  245};
// the kinds of things 0x0800cec8 has steps for after they move that aren't ported yet
static const int THING_STEPS_LATER[] = {39, 101, 141};
// the kinds 0x0800cec8 sends to 0x0800d260, its steps of walls and the arena's edges for a thing that moves
static const int THINGS_WITH_FLOOR_STEPS[] = {35, 38, 39, 40, 57, 58, 60, 61, 63, 79, 80, 81, 100, 101, 117, 118, 120,
  121, 137, 138, 140, 141, 157, 158, 159, 160, 161, 162, 163, 164, 180, 181, 182, 190, 197, 200, 201, 230, 231};
// the kinds 0x0800cec8 sends to 0x0800d33a, which sits a thing on the floor inside the arena's edges
static const int THINGS_ON_THE_FLOOR[] = {54, 97, 154, 191};

/**
 * 0x080125dc: where a point meets a wall or an edge of the arena. Each wall it is inside pushes it out the shortest
 * way, and the edges of the arena push it back in; the bits say which sides it met.
 */
static Meeting meetThingWalls(int x, int y) {
  Meeting out = {0, 0, 0, 0, 0};
  int count = read8(WALL_COUNT);
  for (int w = 0; w < count; w += 4) {
    int left = reads16(WALLS + (uint32_t)w * 2), right = reads16(WALLS + (uint32_t)(w + 1) * 2);
    int top = reads16(WALLS + (uint32_t)(w + 2) * 2), bottom = reads16(WALLS + (uint32_t)(w + 3) * 2);
    if (!(left < x && x < right && top < y && y < bottom)) continue;
    int dx[2] = {x - left, x - right}, dy[2] = {y - top, y - bottom};
    int across = (dx[0] < 0 ? -dx[0] : dx[0]) < (dx[1] < 0 ? -dx[1] : dx[1]) ? 0 : 1;
    int down = (dy[0] < 0 ? -dy[0] : dy[0]) < (dy[1] < 0 ? -dy[1] : dy[1]) ? 0 : 1;
    out.bits |= 1 << across;
    out.bits |= 1 << (down + 2);
    if ((dx[across] < 0 ? -dx[across] : dx[across]) < (dy[down] < 0 ? -dy[down] : dy[down])) out.wallX = dx[across];
    else out.wallY = dy[down];
  }
  if (x > reads16(LIMIT_RIGHT)) { out.edgeX = s16(x - read16(LIMIT_RIGHT)); out.bits |= 16; }
  else if (x < reads16(LIMIT_LEFT)) { out.edgeX = s16(x - read16(LIMIT_LEFT)); out.bits |= 32; }
  if (y > reads16(LIMIT_DOWN)) { out.edgeY = s16(y - read16(LIMIT_DOWN)); out.bits |= 64; }
  else if (y < reads16(LIMIT_UP)) { out.edgeY = s16(y - read16(LIMIT_UP)); out.bits |= 128; }
  return out;
}

/** 0x0800d260: a thing that moves is pushed out of the walls it is inside, or stands on one, and falls to its floor. */
static void thingMeetsWalls(uint32_t thing) {
  Meeting met = meetThingWalls(reads16(thing + THING_X), reads16(thing + THING_Y));
  write8(thing + THING_BITS, (uint8_t)met.bits);
  if (met.bits & 15) {
    int top = reads16(FLOOR);
    if (reads16(thing + THING_Z) >= top + reads16(thing + THING_SPEED_Z)) {
      write8(thing + THING_BITS, (uint8_t)(met.bits & 0xF0));
      write8(thing + THING_FLOOR, (uint8_t)top);
      if (reads16(thing + THING_Z) < top) write16(thing + THING_Z, (uint16_t)top);
    } else {
      write16(thing + THING_X, (uint16_t)(read16(thing + THING_X) - (uint16_t)met.wallX));
      write16(thing + THING_Y, (uint16_t)(read16(thing + THING_Y) - (uint16_t)met.wallY));
      write8(thing + THING_FLOOR, 0);
    }
  } else write8(thing + THING_FLOOR, 0);
  if (read8(thing + THING_BITS) & 0xF0) {
    write16(thing + THING_X, (uint16_t)(read16(thing + THING_X) - (uint16_t)met.edgeX));
    write16(thing + THING_Y, (uint16_t)(read16(thing + THING_Y) - (uint16_t)met.edgeY));
  }
  int height = reads16(thing + THING_Z), floor = read8(thing + THING_FLOOR);
  if (height <= floor) {
    write16(thing + THING_SPEED_Z, 0);
    write16(thing + THING_Z, (uint16_t)floor);
  } else write16(thing + THING_SPEED_Z, (uint16_t)(read16(thing + THING_SPEED_Z) - read16(thing + THING_FALL)));
}

/**
 * 0x0800d818: a kind 40 mine feels the first fighter that comes near it, other than its owner, and tells its owner,
 * at the owner's +236.
 */
static void mineFeelsFighters(uint32_t thing) {
  int owner = read8(thing + THING_OWNER);
  for (int i = 0; i < 4; i++) {
    if (i == owner) continue;
    uint32_t rec = record(i);
    if (read8(rec + 187) == 0 || read8(SETUP_ + 20 + i) == 255) continue;
    if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 9) != 1
      && read8(SETUP_ + 32 + owner) == read8(SETUP_ + 32 + i)) continue;
    int dx = reads16(thing + THING_X) - reads16(rec), dy = reads16(thing + THING_Y) - reads16(rec + 2);
    int dz = reads16(thing + THING_Z) - reads16(rec + 4);
    if ((dx < 0 ? -dx : dx) > 0x23F || (dy < 0 ? -dy : dy) > 0x23F || (dz < 0 ? -dz : dz) > 9) continue;
    if (read8(0x0300138C) != 0) {
      int player = (int)read32(PLAYER_);
      if (owner != player && (owner != player + 2 || read8(SETUP_ + 28 + owner) == 0)) continue;
    }
    write8(record(owner) + 236, 1);
    break;
  }
}

// the ways a thing faces that fly at each side: right, left, down and up the arena
static const int FACES_RIGHT[] = {3, 6, 9}, FACES_LEFT[] = {1, 4, 7}, FACES_DOWN[] = {1, 2, 3}, FACES_UP[] = {7, 8, 9};

/**
 * 0x0800d3be: whether a kind 38 shot bursts, as it meets an edge of the arena it is flying at, or the side of a wall
 * it is flying at below the wall's top.
 */
static int shotMeetsWall(uint32_t thing) {
  int bits = read8(thing + THING_BITS), facing = read8(thing + THING_FACING);
  int low = reads16(thing + THING_Z) < reads16(FLOOR);
  if ((bits & 16) && inList(FACES_RIGHT, 3, facing)) return 1;
  if ((bits & 32) && inList(FACES_LEFT, 3, facing)) return 1;
  if ((bits & 64) && inList(FACES_DOWN, 3, facing)) return 1;
  if ((bits & 128) && inList(FACES_UP, 3, facing)) return 1;
  if ((bits & 1) && inList(FACES_RIGHT, 3, facing) && low) return 1;
  if ((bits & 2) && inList(FACES_LEFT, 3, facing) && low) return 1;
  if ((bits & 4) && inList(FACES_DOWN, 3, facing) && low) return 1;
  return (bits & 8) != 0 && inList(FACES_UP, 3, facing) && low;
}

/**
 * 0x0800f0ac: a thing reaches the first fighter inside its reach that isn't its owner, and the hit is kept on its
 * owner's record (+174) for 0x080036dc to settle. A full Ichikoro gauge turns the hit into a knockout.
 */
static void thingHitsFighters(int k, int reach, int height, int damage, int hold, int hitKind, int again, int first,
  int last) {
  uint32_t thing = 0x030017D0 + (uint32_t)k * 68;
  int owner = read8(thing + THING_OWNER);
  uint32_t ownerRecord = record(owner);
  if (read8(0x0300138C) != 0) {
    int player = (int)read32(PLAYER_);
    if (owner != player && (owner != player + 2 || read8(SETUP_ + 28 + owner) == 0)) return;
  }
  int lift = read16(thing + THING_KIND) == 194 ? -64 : 0;
  int frame = read8(thing + THING_FRAME);
  if (frame < first || frame > last) return;
  if (damage > 62) damage = 62;
  int x = reads16(thing + THING_X), y = reads16(thing + THING_Y), z = reads16(thing + THING_Z);
  for (int i = 0; i < 4; i++) {
    if (i == owner) continue;
    uint32_t rec = record(i);
    if (read8(rec + 187) == 0 || read8(rec + 28) != 0) continue;
    if (read8(SETUP_ + 20 + i) == 255) continue;
    if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 9) != 1
      && read8(SETUP_ + 32 + owner) == read8(SETUP_ + 32 + i)) continue;
    int dx = x - reads16(rec), dy = y - reads16(rec + 2), far = s16(reach) + read8(rec + 187);
    int high = z + lift - reads16(rec + 4);
    if ((high < 0 ? -high : high) >= s16(height) + read8(rec + 186)) continue;
    if (dx * dx + dy * dy >= far * far) continue;
    if ((read8(thing + THING_HIT_MASK) >> i) & 1) continue;
    if (read16(ownerRecord + 174) == 0) {
      if ((read8(thing + THING_FULL) & 1) && hitKind > 0x27F) write16(ownerRecord + 174,
        (uint16_t)(((i & 3) << 11) | 0xE000 | hitKind | 63));
      else write16(ownerRecord + 174, (uint16_t)(((hold & 15) << 13) | ((i & 3) << 11) | hitKind | damage));
    }
    uint32_t total = SETUP_ + 90 + (uint32_t)owner * 2;
    write16(total, read16(total) + (uint16_t)damage);
    uint16_t kept = read16(ownerRecord + 174);
    if (kept != 0) {
      write16(ownerRecord + 176, kept);
      write32(ownerRecord + 120, 0);
    }
    if (again == 0) write8(thing + THING_HIT_MASK, read8(thing + THING_HIT_MASK) | (1u << i));
    write8(thing + THING_WAIT, (uint8_t)hold);
    int kindNow = read16(thing + THING_KIND);
    if (kindNow == 94 || kindNow == 174 || kindNow == 191 || kindNow == 194) write8(ownerRecord + 28, (uint8_t)hold);
    write16(SETUP_ + 66 + (uint32_t)owner * 2, read16(SETUP_ + 66 + (uint32_t)owner * 2) + 1);
    if (read8(thing + THING_HIT_ONCE) == 0) {
      write8(thing + THING_HIT_ONCE, 1);
      write16(SETUP_ + 74 + (uint32_t)owner * 2, read16(SETUP_ + 74 + (uint32_t)owner * 2) + 1);
    }
    break;
  }
}

/** 0x0800eaec: a thing's hit, for the kinds that have one. */
static void thingHit(int k, int kind) {
  for (unsigned i = 0; i < sizeof THING_HITS / sizeof THING_HITS[0]; i++) {
    if (THING_HITS[i].kind == kind) {
      const ThingHit *hit = &THING_HITS[i];
      thingHitsFighters(k, hit->reach, hit->height, hit->damage, hit->hold, hit->hitKind, hit->again, hit->first, hit->last);
      return;
    }
  }
  if (inList(THING_HITS_LATER, sizeof THING_HITS_LATER / sizeof THING_HITS_LATER[0], kind)) notPorted("0800EAEC");
}

/**
 * 0x0800cec8's steps for a kind 121 thing, Amy's Set: it turns toward the nearest fighter and moves that way, and a
 * fighter close enough sets its owner's +236, which starts the Set. Its own hit call has nothing for the kind, so the
 * reach is only through its owner's move.
 */
static void stepAmySet(uint32_t thing, int k) {
  int owner = read8(thing + THING_OWNER);
  int nearest = 255, nearestDistance = 0xFFFF;
  for (int i = 0; i < 4; i++) {
    if (i == owner) continue;
    uint32_t rec = record(i);
    if (read8(rec + 187) == 0 || read8(SETUP_ + 20 + i) == 255) continue;
    if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 9) != 1
      && read8(SETUP_ + 32 + owner) == read8(SETUP_ + 32 + i)) continue;
    int dx = s16(read16(thing + THING_X) - read16(rec));
    int dy = s16(read16(thing + THING_Y) - read16(rec + 2));
    int dz = s16(read16(thing + THING_Z) - read16(rec + 4));
    int state = read16(rec + STATE), distance = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
    if (nearestDistance > distance && !(state >= 252 && state <= 255)) {
      nearestDistance = distance;
      nearest = i;
    }
    if ((dx < 0 ? -dx : dx) > 0x21F || (dy < 0 ? -dy : dy) > 0x21F || (dz < 0 ? -dz : dz) > 19) continue;
    if (read8(0x0300138C) != 0) {
      int player = (int)read32(PLAYER_);
      if (owner != player && (owner != player + 2 || read8(SETUP_ + 28 + owner) == 0)) continue;
    }
    int apart = s16(read16(thing + THING_Z) - read16(rec + 4));
    if ((apart < 0 ? -apart : apart) > 23) continue;
    write8(record(owner) + 236, 1);
    nearestDistance = 0;
    break;
  }
  // the two calls the case makes to 0x0800eaec's hit: nothing for kind 121, so they leave the fighters alone
  if (nearestDistance == 0 || nearest != 255) thingHit(k, 121);
  if (nearest == 255) return;
  uint32_t rec = record(nearest);
  int vx = read16(thing + THING_SPEED_X), vy = read16(thing + THING_SPEED_Y);
  if (s16(read16(thing + THING_X)) < s16(read16(rec))) vx = u16(vx + 4); else vx = u16(vx - 4);
  if (s16(read16(thing + THING_Y)) < s16(read16(rec + 2))) vy = u16(vy + 4); else vy = u16(vy - 4);
  if (s16(vx) > 64) vx = 64; else if (s16(vx) < -64) vx = u16(-64);
  if (s16(vy) > 64) vy = 64; else if (s16(vy) < -64) vy = u16(-64);
  write16(thing + THING_SPEED_X, (uint16_t)vx);
  write16(thing + THING_SPEED_Y, (uint16_t)vy);
  int z = s16(read16(thing + THING_Z)), target = s16(read16(rec + 4)) + 52;
  if (z < target) write16(thing + THING_Z, u16(z + 1));
  else if (z > target) write16(thing + THING_Z, u16(z - 1));
  write16(thing + THING_SPEED_Z, 0);
  write8(thing + THING_FACING, s16(read16(thing + THING_SPEED_X)) < 0 ? 4 : 6);
}

/**
 * 0x0800cec8's steps for a kind 200 thing, Chaos's Set (0x0800e572): a fighter close enough to it, across, along and
 * in height, sets its owner's +236, which starts the Set. It doesn't move toward anyone.
 */
static void chaosSetFeelsFighters(uint32_t thing) {
  int owner = read8(thing + THING_OWNER);
  for (int i = 0; i < 4; i++) {
    if (i == owner) continue;
    uint32_t rec = record(i);
    if (read8(rec + 187) == 0 || read8(SETUP_ + 20 + i) == 255) continue;
    if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 9) != 1
      && read8(SETUP_ + 32 + owner) == read8(SETUP_ + 32 + i)) continue;
    int dx = reads16(thing + THING_X) - reads16(rec);
    int dy = reads16(thing + THING_Y) - reads16(rec + 2);
    int dz = reads16(thing + THING_Z) - reads16(rec + 4);
    if ((dx < 0 ? -dx : dx) > 0x13F || (dy < 0 ? -dy : dy) > 0x13F || (dz < 0 ? -dz : dz) > 3) continue;
    if (read8(0x0300138C) != 0) {
      int player = (int)read32(PLAYER_);
      if (owner != player && (owner != player + 2 || read8(SETUP_ + 28 + owner) == 0)) continue;
    }
    if ((dz < 0 ? -dz : dz) > 23) continue;
    write8(record(owner) + 236, 1);
    break;
  }
}

/**
 * 0x0800c728: the things of a fight for a frame, and the screen's shake. A thing waiting to appear counts down; one that
 * has appeared runs its script (0x0800bb88) and moves (0x0800cec8).
 */
void updateThings(void) {
  for (int i = 0; i < 4; i++) write16(record(i) + 174, 0);
  for (int k = 0; k < 12; k++) {
    uint32_t thing = 0x030017D0 + (uint32_t)k * 68;
    int kind = read16(thing + THING_KIND);
    if (kind == 0) continue;
    int wait = read8(thing + THING_WAIT);
    if (wait != 0) { write8(thing + THING_WAIT, (uint8_t)(wait - 1)); continue; }
    uint32_t script = thingScript(kind);
    // the switch at 0x0800c7dc sends a kind with no script to 0x0800cec8, which runs only its own steps
    if (read32(0x0800C7DCu + (uint32_t)(uint16_t)(kind - 3) * 4) != 0x0800CEC8u) {
      if (!script) notPorted("0800C728");
      runThingScript(k, script);
    }
    // 0x0800cec8: it follows its owner, or moves on its own
    if (read8(thing + THING_FOLLOWS) == 1) {
      uint32_t owner = record(read8(thing + THING_OWNER));
      write16(thing + THING_X, read16(owner));
      write16(thing + THING_Y, read16(owner + 2));
      write16(thing + THING_Z, read16(owner + 4));
    } else {
      write16(thing + THING_X, read16(thing + THING_X) + read16(thing + THING_SPEED_X));
      write16(thing + THING_Y, read16(thing + THING_Y) + read16(thing + THING_SPEED_Y));
      write16(thing + THING_Z, read16(thing + THING_Z) + read16(thing + THING_SPEED_Z));
    }
    // 0x0800cec8's per-kind steps: walls and the arena's edges push a thing back, and it falls until its floor
    if (inList(THINGS_ON_THE_FLOOR, sizeof THINGS_ON_THE_FLOOR / sizeof THINGS_ON_THE_FLOOR[0], kind)) {
      // 0x0800d33a: the arena's edges push it back and it sits on the floor, or at nothing when it meets no edge
      Meeting met = meetThingWalls(reads16(thing + THING_X), reads16(thing + THING_Y));
      write8(thing + THING_BITS, (uint8_t)met.bits);
      if (met.bits & 0xF0) {
        write16(thing + THING_X, (uint16_t)(read16(thing + THING_X) - (uint16_t)met.edgeX));
        write16(thing + THING_Y, (uint16_t)(read16(thing + THING_Y) - (uint16_t)met.edgeY));
        met = meetThingWalls(reads16(thing + THING_X), reads16(thing + THING_Y));
        write8(thing + THING_BITS, (uint8_t)met.bits);
      }
      write16(thing + THING_Z, read8(thing + THING_BITS) != 0 ? reads16(FLOOR) : 0);
    } else if (inList(THINGS_WITH_FLOOR_STEPS, sizeof THINGS_WITH_FLOOR_STEPS / sizeof THINGS_WITH_FLOOR_STEPS[0], kind)) {
      thingMeetsWalls(thing);
    }
    if (kind == 38 && shotMeetsWall(thing)) {
      // (0x0800d516) a shot that meets a wall or an edge it's flying at bursts: kind 43 at its place
      int facing = read8(thing + THING_FACING), x = read16(thing + THING_X), y = read16(thing + THING_Y),
        z = read16(thing + THING_Z);
      int follows = read8(thing + THING_FOLLOWS), owner = read8(thing + THING_OWNER), full = read8(thing + THING_FULL);
      clearEffect(k);
      startEffect(43, facing, x, y, z, 0, 0, 0, follows, owner, full);
    }
    // (0x0800d954) the ring goes once its owner is knocked out or has none of its health left
    if (kind == 35) {
      uint32_t owner = record(read8(thing + THING_OWNER));
      if (read16(owner + STATE) == 0x115 || read8(owner + HEALTH) == 0) clearEffect(k);
    }
    if (kind == 40) mineFeelsFighters(thing);
    if (kind == 61) {
      // 0x0800d9a4: it feels for the nearest fighter, tells its owner when one is close, and turns toward it
      int owner = read8(thing + THING_OWNER);
      int nearest = 255, shortest = 0xFFFF;
      for (int f = 0; f <= 3; f++) {
        if (f == owner) continue;
        uint32_t rec = record(f);
        if (read8(rec + 187) == 0) continue;
        if (read8(SETUP_ + 20 + f) == 255) continue;
        if (read8(SETUP_ + 8) != 0 && read8(SETUP_ + 9) != 1
          && read8(SETUP_ + 32 + owner) == read8(SETUP_ + 32 + f)) continue;
        int dx = reads16(thing + THING_X) - reads16(rec);
        int dy = reads16(thing + THING_Y) - reads16(rec + 2);
        int dz = reads16(thing + THING_Z) - reads16(rec + 4);
        int apart = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
        if (apart < shortest && u16(read16(rec + 20) - 252) > 3) { shortest = apart; nearest = f; }
        if ((dx < 0 ? -dx : dx) > 255 || (dy < 0 ? -dy : dy) > 255 || (dz < 0 ? -dz : dz) > 7) continue;
        if (read8(0x0300138C) != 0) {
          int player = (int)read32(PLAYER_);
          if (owner != player && (owner != player + 2 || read8(SETUP_ + 28 + owner) == 0)) continue;
        }
        if ((dz < 0 ? -dz : dz) > 23) continue;
        write8(record(owner) + 236, 1);
        shortest = 0;
        break;
      }
      if (nearest != 255) {
        uint32_t rec = record(nearest);
        write16(thing + THING_SPEED_X, reads16(thing + THING_X) < reads16(rec)
          ? read16(thing + THING_SPEED_X) + 4 : read16(thing + THING_SPEED_X) - 4);
        write16(thing + THING_SPEED_Y, reads16(thing + THING_Y) < reads16(rec + 2)
          ? read16(thing + THING_SPEED_Y) + 4 : read16(thing + THING_SPEED_Y) - 4);
        int sx = reads16(thing + THING_SPEED_X), sy = reads16(thing + THING_SPEED_Y);
        write16(thing + THING_SPEED_X, (uint16_t)(sx > 64 ? 64 : (sx < -64 ? -64 : sx)));
        write16(thing + THING_SPEED_Y, (uint16_t)(sy > 64 ? 64 : (sy < -64 ? -64 : sy)));
      }
    }
    if (kind == 121) stepAmySet(thing, k);
    if (kind == 200) chaosSetFeelsFighters(thing);
    if (inList(THING_STEPS_LATER, sizeof THING_STEPS_LATER / sizeof THING_STEPS_LATER[0], kind)) notPorted("0800CEC8");
    thingHit(k, read16(thing + THING_KIND));
  }
  int shake = read8(0x030016CC);
  if (shake == 0) {
    write16(0x030016BC, 0);
    write8(0x03001C30, 0);
    write8(0x030016CC, 0);
    return;
  }
  int up = read8(0x03001C30) == 0;
  write16(0x030016BC, (uint16_t)(((up ? shake : -shake) * 3) << 7));
  write8(0x03001C30, (uint8_t)(up ? 1 : 0));
  write8(0x030016CC, (uint8_t)(shake - 1));
}

// 0x0800f5bc: a fighter's things that wait for it go off, each turned into its blast at its place
static const int THING_BLASTS[][2] = {{40, 41}, {45, 41}, {60, 62}, {61, 62}, {80, 82}, {81, 82}, {100, 102}, {101, 102},
  {120, 122}, {121, 122}, {140, 142}, {141, 142}, {161, 165}, {162, 165}, {163, 166}, {164, 166}, {200, 201}};

static int blastOf(int kind) {
  for (unsigned i = 0; i < sizeof THING_BLASTS / sizeof THING_BLASTS[0]; i++) {
    if (THING_BLASTS[i][0] == kind) return THING_BLASTS[i][1];
  }
  return -1;
}

static void leaveThings(int i) {
  for (int k = 0; k < 12; k++) {
    uint32_t thing = 0x030017D0 + (uint32_t)k * 68;
    if (read8(thing + THING_OWNER) != i) continue;
    int blast = blastOf(read16(thing + THING_KIND));
    if (blast < 0) continue;
    int facing = read8(thing + THING_FACING), x = read16(thing + THING_X), y = read16(thing + THING_Y),
      z = read16(thing + THING_Z), full = read8(thing + THING_FULL);
    clearEffect(k);
    // the Sets' blasts sit one lower than the thing they came from, as 0x0800f5bc leaves them
    startEffect(blast, facing, x, y, blast == 122 ? s16(z - 1) : z, 0, 0, 0, 0, i, full);
  }
}

void followFighter(int i) {
  followFighterTarget(i & 0xFF);
  if (i <= 3) {
    uint32_t view = 0x03002040, camera = read8(record(i) + CAMERA);
    uint16_t screenX = read16(0x08071222 + (uint32_t)camera * 2) + read16(0x03001374);
    write16(view + 8, screenX);
    uint16_t screenY = read16(0x0807122A + (uint32_t)camera * 2) + read16(0x03001B24);
    write16(view + 10, screenY);
    int free = !(read16(0x03001398 + (uint32_t)i * 2) & 0x200);
    int back = read16(0x03002100) << 4, shift = read8(0x03001B00), turn = read16(view + 12);
    #define ANGLE(n) read16(0x0807121A + (uint32_t)(n))
    if (camera == 0) {
      if (free) moveCamera(reads16(view + 8), s16(screenY - back));
      turnCamera(s16(ANGLE(0) + asrBy(-reads16(view + 8), shift) + turn));
    } else if (camera == 1) {
      if (free) moveCamera(reads16(view + 8), s16(screenY + back));
      turnCamera(s16(ANGLE(2) + asrBy(reads16(view + 8), shift) + turn));
    } else if (camera == 2) {
      if (free) moveCamera(s16(screenX - back), reads16(view + 10));
      turnCamera(s16(ANGLE(4) + asrBy(reads16(view + 10), shift) + turn));
    } else if (camera == 3) {
      if (free) moveCamera(s16(screenX + back), reads16(view + 10));
      turnCamera(s16(ANGLE(6) + asrBy(-reads16(view + 10), shift) + turn));
    }
    #undef ANGLE
  }
  tiltCamera(s16(0x200 + read16(0x03002100)));
  zoomCamera(0x200);
}

static int fight_end_vblank = -1;

/** A start point may turn a Training fight into a Battle one at a chosen frame, so the fight's end can be proven. */
void setFightEndAt(int vblank) { fight_end_vblank = vblank; }

void trainingFrame(void) {
  if (fight_end_vblank >= 0 && g.vblanks == fight_end_vblank) {
    // 0x0801c28c hands over to 0x0801b394 at the frame the start point names: Battle's rule, a full Ichikoro gauge,
    // the rival out of health, and the point that ends the fight at the part's first frame.
    fight_end_vblank = -1;
    write8(SETUP_ + 125, 1);
    write8(SETUP_ + 4, 2);
    write8(SETUP_ + 6, 1);
    write8(SETUP_ + 51, 1);
    write8(FIGHTERS + 147, 72);
    write8(FIGHTERS + 149, 1);
    write8(FIGHTERS + RECORD + HEALTH, 0);
    write16(FIGHTERS + RECORD + STATE, 253);
    g.callback = battleFrame;
    return;
  }
  dummyKeys();
  int player = (int)read32(PLAYER_);
  readAllKeys(player);
  int state = read16(record(player) + STATE);
  if (state == 55) {
    uint16_t keys = held(player);
    if (keys & 32) write16(CAMERA_TURN, read16(CAMERA_TURN) - 128);
    else if (keys & 16) write16(CAMERA_TURN, read16(CAMERA_TURN) + 128);
    else write16(CAMERA_TURN, 0);
  } else if (state == 53) {
    if (pressed(player) & 0x200) notPorted("0801C28C");
  } else write16(CAMERA_TURN, 0);
  startFighterEffects();
  updateThings();
  for (int i = 0; i < 4; i++) {
    if (!isActive(i)) continue;
    fighterThink(i);
    moveFighter(i);
    takeHits(i);
  }
  holdHits();
  for (int i = 0; i < 4; i++) {
    if (!isActive(i)) continue;
    reachOthers(i);
    readFighterKeys(i);
    fighterAct(i);
  }
  g.after_wait = trainingAfterWait;
}

void trainingAfterWait(void) {
  int player = (int)read32(PLAYER_);
  if ((pressed(player) & 8) && read8(record(player) + HEALTH) != 0) notPorted("0801BD90");
  if (stepFade()) endFade();
  followFighter(player);
  setHeightShift();
  layersFromCamera();
  clearQueue();
  drawHud(0);
  keepQueued();
  drawFighters(4);
  drawArenaThings();
  drawArena();
  sortQueue();
  drawSpritesNow();
  copyAtVblank();
}
