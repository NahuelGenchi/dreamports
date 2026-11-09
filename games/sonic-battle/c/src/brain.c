// The computer player in C: how the other fighter chooses to move, attack, guard and use its special attacks. It is the
// original's brain at 0x03003db0 (24 bytes each), written from the original's instructions: 0x0801d5d4 runs one frame of
// a brain, 0x0801cfc8 plays the keys a brain script holds, and 0x0801f578 reads the condition lists that pick a thought.
// The scripts and condition lists stay in the player's copy, read by address, as the original reads them.
// Training's frame never calls this: only Battle's and Story's frames do. Their choice screen and fight camera are not
// in C yet, so there is no recording of it without changing the original's own program, which the proof does not allow.

#include "game.h"

#define BRAINS 0x03003DB0u
#define BRAIN_SIZE 24
#define LEVEL 0x03003E10u
#define BRAIN_COUNTER 0x03003D88u
#define SETUP_ SETUP
#define FIGHTERS_ FIGHTERS
#define RECORD_ RECORD
#define CHOICES_ 0x030013B0u
#define CHOICE_SIZE_ 156

// a brain's fields, by what the code does with them
#define B_CALLBACK 0
#define B_DATA 4
#define B_KEYS 8
#define B_WAIT 10
#define B_COUNT 12
#define B_FLAG13 13
#define B_FRAME 14
#define B_TARGET 15
#define B_SIDE 16
#define B_ROLL 18
#define B_FIELD20 20

// a fighter's fields the brain reads, by what the code does with them
#define F_FIELD16 16
#define F_STATE 20
#define F_FIELD50 50
#define F_FIELD54 54
#define F_FIELD62 62
#define F_FIELD72 72
#define F_FIELD88 88
#define F_FIELD180 180
#define F_FIELD191 191
#define F_CHARACTER 196

// the condition lists a thought runs: one for the other characters, one for fighter 19
#define CONDITIONS 0x08ED8B3Cu
#define CONDITIONS_19 0x08ED8B64u

// the scripts a thought gives a brain
#define SCRIPT_WALK 0x08ED898Cu
#define SCRIPT_GUARD_1 0x08ED8990u
#define SCRIPT_GUARD_2 0x08ED89A0u
#define SCRIPT_GUARD_3 0x08ED89B0u
#define SCRIPT_GUARD_4 0x08ED89C0u
#define SCRIPT_DODGE_1 0x08ED89D0u
#define SCRIPT_DODGE_2 0x08ED89E4u
#define SCRIPT_DODGE_3 0x08ED89ECu
#define SCRIPT_DODGE_4 0x08ED89F8u
#define SCRIPT_DODGE_5 0x08ED8A0Cu
#define SCRIPT_SPECIAL_DEFAULT 0x08ED8A28u
#define SCRIPT_SPECIAL_1 0x08ED8A3Cu
#define SCRIPT_ATTACK_1 0x08ED8A58u
#define SCRIPT_ATTACK_2 0x08ED8A64u
#define SCRIPT_SPECIAL_2 0x08ED8A78u
#define SCRIPT_CHOOSE 0x08ED8A8Cu
#define SCRIPT_GUARD_HOLD 0x08ED8A9Cu
#define SCRIPT_GUARD_END 0x08ED8AACu
#define SCRIPT_GUARD_AFTER 0x08ED8AC4u

// the way a target lies, one of 16 in each of the cartridge's tables
#define WAY_TO_TARGET 0x08ED8AD4u
#define WAY_TO_MOVE 0x08ED8AE4u
#define WAY_TO_OTHER 0x08ED8AF4u

// the level's tables: how long a brain waits, how likely it acts, and how far it sees
#define LEVEL_WAIT 0x08071250u
#define LEVEL_CHANCE 0x0807125Au
#define LEVEL_SEE 0x0807124Au
#define LEVEL_GUARD 0x08071240u
#define LEVEL_SPECIAL 0x08071245u
#define LEVEL_DODGE 0x08071264u
#define MAX_HEALTH 0x03001B28u

typedef void (*BrainFn)(int);

static BrainFn brain_fn[4];

static uint32_t brainAt(int i) { return BRAINS + (uint32_t)(i & 0xFF) * BRAIN_SIZE; }
static uint32_t fighterAt(int i) { return FIGHTERS_ + (uint32_t)(i & 0xFF) * RECORD_; }
static int brainTarget(int i) { return read8(brainAt(i) + B_TARGET); }
static uint16_t brainKeys(int i) { return read16(brainAt(i) + B_KEYS); }
static void setBrainKeys(int i, uint16_t keys) { write16(brainAt(i) + B_KEYS, keys); }
static void setCallback(int i, BrainFn fn) { brain_fn[i & 3] = fn; }
static int16_t field54(int i, int j) { return reads16(fighterAt(i) + F_FIELD54 + (uint32_t)(j & 0xFF) * 2); }
static int16_t field62(int i, int j) { return reads16(fighterAt(i) + F_FIELD62 + (uint32_t)(j & 0xFF) * 2); }
static int32_t field72(int i, int j) { return reads32(fighterAt(i) + F_FIELD72 + (uint32_t)(j & 0xFF) * 4); }
static int16_t field88(int i, int j) { return reads16(fighterAt(i) + F_FIELD88 + (uint32_t)(j & 0xFF) * 2); }
static uint16_t fighterState(int i) { return read16(fighterAt(i) + F_STATE); }
static uint8_t fighterField50(int i) { return read8(fighterAt(i) + F_FIELD50); }
static uint32_t fighterField180(int i) { return read32(fighterAt(i) + F_FIELD180); }
static uint8_t fighterHealth(int i) { return read8(fighterAt(i) + F_FIELD191); }
static uint8_t fighterCharacter(int i) { return read8(fighterAt(i) + F_CHARACTER); }
static uint8_t fighterSide(int i) { return read8(fighterAt(i) + F_FIELD16); }
static int brainTeam(void) { return read8(SETUP_ + 8) != 0; }
static int brainActive(int i) { return read8(SETUP_ + 20 + i) != 0xFF; }
static int brainGroup(int i) { return read8(SETUP_ + 32 + i); }

static int brainTargetBest(int i);
static int brainTargetRandom(int i);
static int brainTargetFree(int i);
static int brainGuardCheck(int i);
static void brainFirst(int i);
static void brainWait(int i);
static void brainCountdown(int i);
static void brainApproach(int i);
static void brainThink(int i);
static void brainReact(int i);
static void brainAttackScript(int i);
static void brainAttack(int i);
static void brainAfterGuard(int i);
static void brainAfterGuard2(int i);
static void brainSpecial(int i);
static void brainAfterSpecial(int i);
static void brainAim(int i);
static void brainResetState(int i);
static void brainChoose(int i);
static void brainGuard1(int i);
static void brainGuard2(int i);
static void brainGuard3(int i);
static void brainGuard4(int i);
static void brainGuardHold(int i);
static void brainTurn(int i);
static void brainMove(int i);
static void brainScriptDone(int i);
static void brainAfterDodge1(int i);
static void brainAfterDodge2(int i);
static void brainAfterDodge3(int i);
static void brainScriptA(int i);
static void brainScriptADone(int i);
static void brainScriptB(int i);
static void brainScriptBDone(int i);
static void brainScriptC(int i);
static void brainScriptD(int i);
static void brainScriptE(int i);
static void brainScriptF(int i);
static void brainScriptFDone(int i);
static void brainScriptG(int i);
static void brainScriptGDone(int i);
static void brainScriptH(int i);
static void brainScriptHDone(int i);
static void brainGuardEnd(int i);

// ----------------------------------------------------------------------------------------------- The conditions

/** 0x0801f080: one of a fighter's x offsets to another, compared with the word's high half. */
static uint32_t condition0801f080(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  int16_t operand = (int16_t)(word >> 16);
  uint8_t operation = (uint8_t)((word >> 8) & 0xFF);
  int16_t value = field54(i, other);
  uint32_t result = operation == 0 ? value == operand : operation == 1 ? value < operand : operation == 2 ? value > operand : 0;
  *stream += 4;
  return result;
}

/** 0x0801f128: one of a fighter's y offsets to another. */
static uint32_t condition0801f128(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  int16_t operand = (int16_t)(word >> 16);
  uint8_t operation = (uint8_t)((word >> 8) & 0xFF);
  int16_t value = field62(i, other);
  uint32_t result = operation == 0 ? value == operand : operation == 1 ? value < operand : operation == 2 ? value > operand : 0;
  *stream += 4;
  return result;
}

/** 0x0801f1d0: one of a fighter's distances to another. */
static uint32_t condition0801f1d0(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  int16_t operand = (int16_t)(word >> 16);
  uint8_t operation = (uint8_t)((word >> 8) & 0xFF);
  int16_t value = field88(i, other);
  uint32_t result = operation == 0 ? value == operand : operation == 1 ? value < operand : operation == 2 ? value > operand : 0;
  *stream += 4;
  return result;
}

/** 0x0801f274: one of a fighter's squared distances to another, with its operand in the next word. */
static uint32_t condition0801f274(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  int32_t operand = (int32_t)read32(*stream + 4);
  uint8_t operation = (uint8_t)((word >> 8) & 0xFF);
  int32_t value = field72(i, other);
  uint32_t result = operation == 0 ? value == operand : operation == 1 ? value < operand : operation == 2 ? value > operand : 0;
  *stream += 8;
  return result;
}

/** 0x0801f308: a roll of the chance in the word's high half. */
static uint32_t condition0801f308(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  (void)i;
  (void)other;
  *stream += 4;
  return (uint32_t)rollChance((int)(word >> 16));
}

/** 0x0801f31c: whether the fighter has anything in its low flags. */
static uint32_t condition0801f31c(int i, int other, uint32_t *stream) {
  (void)other;
  *stream += 4;
  return (fighterField50(i) & 0xF) != 0;
}

static uint32_t condition0801f350(int i, int other, uint32_t *stream);

/** 0x0801f3a4: always true. */
static uint32_t condition0801f3a4(int i, int other, uint32_t *stream) {
  (void)i;
  (void)other;
  *stream += 4;
  return 1;
}

/** 0x0801f3b0: a flag of the other fighter. */
static uint32_t condition0801f3b0(int i, int other, uint32_t *stream) {
  uint32_t operand = read32(*stream + 4);
  (void)i;
  *stream += 8;
  return (fighterField180(other) & operand) == 1;
}

/** 0x0801f3e4: a flag of this fighter. */
static uint32_t condition0801f3e4(int i, int other, uint32_t *stream) {
  uint32_t operand = read32(*stream + 4);
  (void)other;
  *stream += 8;
  return (fighterField180(i) & operand) == 1;
}

/** 0x0801f418: this fighter's state. */
static uint32_t condition0801f418(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  (void)other;
  *stream += 4;
  return fighterState(i) == (uint16_t)(word >> 16);
}

/** 0x0801f448: whether the brain's wait is over. */
static uint32_t condition0801f448(int i, int other, uint32_t *stream) {
  (void)other;
  *stream += 4;
  return read16(brainAt(i) + B_WAIT) == 0;
}

/** 0x0801f474: this fighter's health, compared with the word's high half. */
static uint32_t condition0801f474(int i, int other, uint32_t *stream) {
  uint32_t word = read32(*stream);
  int16_t operand = (int16_t)(word >> 16);
  uint8_t operation = (uint8_t)((word >> 8) & 0xFF);
  uint8_t value = fighterHealth(i);
  uint32_t result = operation == 0 ? value == operand : operation == 1 ? value < operand : operation == 2 ? value > operand : 0;
  (void)other;
  *stream += 4;
  return result;
}

/** 0x0801f4f4: whether the other fighter is knocked out. */
static uint32_t condition0801f4f4(int i, int other, uint32_t *stream) {
  (void)i;
  *stream += 4;
  return (uint16_t)(fighterState(other) - 252) <= 3;
}

static uint32_t (*const CONDITIONS_TABLE[])(int, int, uint32_t *) = {
  condition0801f080, condition0801f128, condition0801f274, condition0801f1d0, condition0801f308,
  condition0801f31c, condition0801f350, condition0801f3a4, condition0801f3b0, condition0801f3e4,
  condition0801f418, condition0801f448, condition0801f474, condition0801f4f4,
};

/** 0x0801f350: every condition in a group, until the word of 0xFF or of 7 that ends it. */
static uint32_t condition0801f350(int i, int other, uint32_t *stream) {
  uint32_t result = 0;
  *stream += 4;
  for (;;) {
    uint32_t current = *stream;
    uint8_t operation = read8(current);
    if (operation == 0xFF) return result;
    if (operation == 7) {
      *stream = current + 4;
      return result;
    }
    if (CONDITIONS_TABLE[operation](i, other, stream) != 0) result = 1;
  }
}

/** 0x0801f578: the first condition list that holds, and the word its 0xFF ends with, or 0x10 when none holds. */
static uint32_t brainConditions(int i, int other, uint32_t streams) {
  while (read32(streams) != 0) {
    uint32_t stream = read32(streams);
    uint32_t current = stream;
    uint32_t result;
    if (read8(current) != 0xFF) {
      do {
        if (CONDITIONS_TABLE[read8(current)](i, other, &stream) == 0) {
          result = 0x10;
          goto check_result;
        }
        current = stream;
      } while ((read8(stream) & 0xFF) != 0xFF);
    }
    result = read16(stream + 2);
  check_result:
    if (result != 0x10) return result;
    streams += 4;
  }
  return 0x10;
}

// ----------------------------------------------------------------------------------------------- The targets

/** 0x0801d068: the fighter this one should go after: the nearest by its scores, or a random one, or a person. */
static int brainTargetBest(int i) {
  uint32_t scores = fighterAt(i) + F_FIELD72;
  int32_t best = 0x7FFFFFFF;
  int best_index = 0;
  if (rollChance((int)(int8_t)read8(LEVEL_SEE + read8(LEVEL)))) return brainTargetFree(i);
  if (rollChance(20)) return brainTargetRandom(i);
  int team = brainTeam(), group = team ? brainGroup(i) : 0;
  for (int n = 0; n <= 3; n++) {
    if (n == i || !brainActive(n)) continue;
    if (team && brainGroup(n) == group) continue;
    int32_t score = reads32(scores + (uint32_t)n * 4);
    if (best <= score) continue;
    uint16_t state = fighterState(n);
    if (state >= 0xFC) continue;
    best = score;
    best_index = n;
  }
  return best == 0x7FFFFFFF ? i : best_index;
}

/** 0x0801d188: a random other fighter, up to six tries, or this one when none is left. */
static int brainTargetRandom(int i) {
  for (int attempt = 0; attempt <= 5; attempt++) {
    int candidate = (int)((randomNumber() & 6) >> 1);
    if (candidate == i) continue;
    if (!brainActive(candidate)) continue;
    if (brainTeam() && brainGroup(candidate) == brainGroup(i)) continue;
    uint16_t state = fighterState(candidate);
    if (state >= 0xFC) continue;
    return candidate;
  }
  return i;
}

/** 0x0801d200: a random other fighter that a person plays, or 0x0801d188's choice when there is none. */
static int brainTargetFree(int i) {
  for (int attempt = 0; attempt <= 5; attempt++) {
    int candidate = (int)((randomNumber() & 6) >> 1);
    if (candidate == i) continue;
    if (!brainActive(candidate)) continue;
    if (brainTeam() && brainGroup(candidate) == brainGroup(i)) continue;
    uint16_t state = fighterState(candidate);
    if (state >= 0xFC) continue;
    if (read8(SETUP_ + 28 + candidate) == 0) return candidate;
  }
  return brainTargetRandom(i);
}

/** 0x0801d288: the direction bits toward a brain's target, within the ranges the original uses. */
static uint32_t brainFaceTarget(int i) {
  uint32_t result = brainKeys(i) & 0xFF0F;
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  if (fighterCharacter(i) != 19) {
    if (first > 512) result |= 0x20;
    else if (first < -512) result |= 0x10;
    if (second > 128) result |= 0x40;
    else if (second < -128) result |= 0x80;
  } else {
    if (first > 1152) result |= 0x20;
    else if (first < -1152) result |= 0x10;
    if (second > 1152) result |= 0x40;
    else if (second < -1152) result |= 0x80;
  }
  write16(brainAt(i) + B_KEYS, (uint16_t)result);
  return result;
}

/** 0x0801d370: the direction bits 0x30 and 0xC0 flipped when they're set. */
static uint16_t brainFlip(int i) {
  uint16_t keys = brainKeys(i);
  if (keys & 0x30) keys ^= 0x30;
  if (keys & 0xC0) keys ^= 0xC0;
  write16(brainAt(i) + B_KEYS, keys);
  return keys;
}

/** 0x0801d3ac: which of the 16 ways the target lies, by the table for a fighter's other colours. */
static uint8_t brainTargetWayOther(int i) {
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  uint16_t angle = arcTan2(first, second);
  return read8(WAY_TO_OTHER + (uint32_t)(angle >> 12));
}

// ----------------------------------------------------------------------------------------------- The scripts

/** 0x0801cfc8: the next frame of the keys a brain script holds, and 0 when the script ends. */
static int brainScript(int i) {
  uint32_t entity = brainAt(i);
  uint32_t data = read32(entity + B_DATA);
  uint8_t frame = read8(entity + B_FRAME);
  while (frame >= read16(data)) {
    if (read16(data) == 0) {
      setBrainKeys(i, 0);
      return 0;
    }
    frame = 0;
    data += 4;
  }
  uint16_t flags = read16(data + 2);
  uint16_t keys = flags & 0x3FF;
  if (flags & 0x8000) keys = (uint16_t)((keys & 0xFF0F) | wayToTarget(i));
  else if (read8(entity + B_SIDE) == 0 && (keys & 0x30) != 0) keys ^= 0x30;
  write16(entity + B_KEYS, keys);
  write32(entity + B_DATA, data);
  write8(entity + B_FRAME, (uint8_t)(frame + 1));
  return 1;
}

/** 0x0801ef14: a brain's script and side, from its start. */
static void brainSetScript(int i, uint32_t data) {
  write32(brainAt(i) + B_DATA, data);
  write8(brainAt(i) + B_FRAME, 0);
  write8(brainAt(i) + B_SIDE, fighterSide(i));
}

/** 0x0801d5d4: one frame of a computer player: its thought, the keys it gives the fighter, and its wait. */
void brainTick(int i) {
  if (brain_fn[i & 3] == 0) return;
  brain_fn[i & 3](i & 0xFF);
  write16(fighterAt(i) + 200, brainKeys(i));
  uint16_t wait = read16(brainAt(i) + B_WAIT);
  if (wait != 0) write16(brainAt(i) + B_WAIT, (uint16_t)(wait - 1));
}

/** 0x0801d870: a computer player back to its walk script and its first thought. */
void brainReset(int i) {
  uint32_t entity = brainAt(i);
  write16(entity + B_KEYS, 0);
  write8(entity + B_COUNT, 0);
  write8(entity + B_FLAG13, 0);
  write8(entity + B_ROLL, (uint8_t)(rollChance(read16(LEVEL_CHANCE + (uint32_t)read8(LEVEL) * 2)) != 0));
  write32(entity + B_DATA, SCRIPT_WALK);
  write8(entity + B_FRAME, 0);
  write8(entity + B_SIDE, fighterSide(i));
  setCallback(i, brainFirst);
}

/** 0x0801d8f4: the first thought, which picks what to do after a wait, or reacts to an attack. */
static void brainFirst(int i) {
  uint32_t entity = brainAt(i);
  int target = brainTarget(i);
  if (read8(entity + B_ROLL) != 0) {
    int16_t first = field54(i, target), second = field62(i, target);
    uint16_t type = fighterState(target);
    if ((uint16_t)(type - 10) <= 5) {
      if (first >= -0x4FF && first <= 0x9FE) {
        if (second <= 511 && second > -512) {
          brainScriptB(i);
          return;
        }
      }
    }
  }
  uint16_t type = fighterState(i);
  if (type == 66) {
    if (rollChance((int)(int8_t)read8(LEVEL_SPECIAL + read8(LEVEL)))) brainAttackScript(i);
    else brainReset(i);
  } else {
    write16(entity + B_KEYS, 0);
    if (type == 0) {
      setCallback(i, brainThink);
      write8(entity + B_TARGET, (uint8_t)brainTargetBest(i));
    }
  }
}

/** 0x0801d9e0: a brain's wait before its next thought, at random by its level, then the walk script. */
static void brainWait(int i) {
  uint32_t entity = brainAt(i);
  uint32_t number = (uint32_t)randomNumber();
  uint8_t count;
  setCallback(i, brainCountdown);
  write16(entity + B_KEYS, 0);
  switch (read8(LEVEL)) {
    case 0: count = (uint8_t)((number & 3) + 1); break;
    case 1: count = (uint8_t)((number & 7) + 5); break;
    case 2: count = (uint8_t)((number & 7) + 10); break;
    case 3: count = (uint8_t)((number & 15) + 10); break;
    default: count = (uint8_t)((number & 31) + 30); break;
  }
  write8(entity + B_COUNT, count);
  write8(entity + B_FLAG13, 0);
  write32(entity + B_DATA, SCRIPT_WALK);
  write8(entity + B_FRAME, 0);
  write8(entity + B_SIDE, fighterSide(i));
}

/** 0x0801daec: a brain's wait counting down, then a thought and a target. */
static void brainCountdown(int i) {
  uint32_t entity = brainAt(i);
  uint8_t count = read8(entity + B_COUNT);
  if (count != 0) {
    write8(entity + B_COUNT, (uint8_t)(count - 1));
    return;
  }
  uint16_t base = read16(LEVEL_WAIT + (uint32_t)read8(LEVEL) * 2);
  uint32_t number = (uint32_t)randomNumber();
  write16(entity + B_WAIT, (uint16_t)(base + (((number & 0xFFF) * base) >> 12)));
  setCallback(i, brainThink);
  write8(entity + B_TARGET, (uint8_t)brainTargetBest(i));
}

/** 0x0801db4c: a brain back to its walk script, then the approach. */
static void brainResetAlt(int i) {
  uint32_t entity = brainAt(i);
  write16(entity + B_KEYS, 0);
  write8(entity + B_COUNT, 0);
  write8(entity + B_FLAG13, 0);
  write8(entity + B_ROLL, (uint8_t)(rollChance(read16(LEVEL_CHANCE + (uint32_t)read8(LEVEL) * 2)) != 0));
  write32(entity + B_DATA, SCRIPT_WALK);
  write8(entity + B_FRAME, 0);
  write8(entity + B_SIDE, fighterSide(i));
  setCallback(i, brainApproach);
}

// ----------------------------------------------------------------------------------------------- The thoughts

/** 0x0801dbd0: the thought that walks at its target and attacks when it's close, or guards or dodges. */
static void brainApproach(int i) {
  uint32_t entity = brainAt(i);
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  int32_t health = fighterHealth(i);
  int32_t half = (read16(MAX_HEALTH) - health) / 2;
  if (health < half) {
    if (first > 0xC00 || first < -0xC00 || second > 0xC00 || second < -0xC00) {
      write16(entity + B_KEYS, (uint16_t)((brainKeys(i) & 0xFF0F) | 0x200));
      write8(entity + B_COUNT, 0);
      setCallback(i, brainGuardHold);
    }
  }
  if (read8(entity + B_ROLL) != 0 && (uint16_t)(fighterState(target) - 10) <= 5) {
    if (first >= -0x4FF && first <= 0x9FE) {
      if (second <= 0x1FF && second > -0x200) {
        setCallback(i, brainScriptBDone);
        brainSetScript(i, SCRIPT_DODGE_2);
        return;
      }
    }
  }
  if (fighterState(i) == 66) {
    if (rollChance((int)(int8_t)read8(LEVEL_SPECIAL + read8(LEVEL)))) brainAttackScript(i);
    else brainReset(i);
    return;
  }
  if ((fighterField50(i) & 0xF) != 0 && read8(entity + B_COUNT) > 5) {
    uint8_t character = fighterCharacter(i);
    uint32_t script = 0;
    if (character <= 19) {
      switch (character) {
        case 0: case 3: case 4: case 6: case 7: case 17: case 18: case 19:
          script = SCRIPT_ATTACK_1;
          break;
        case 1: case 2: case 5: case 8:
          script = SCRIPT_ATTACK_2;
          break;
        default: {
          // Emerl's skill slot picks the script, and its two skills decide whether it's an attack at all
          uint32_t choice = CHOICES_ + (uint32_t)i * CHOICE_SIZE_;
          uint8_t slot = read8(choice + 81);
          uint32_t skill = choice + (uint32_t)slot * 27;
          uint8_t first_skill = read8(skill + 2);
          if (first_skill > 19) first_skill = (uint8_t)(first_skill - 20);
          if (first_skill > 8) first_skill = 9;
          if (first_skill == 0 || (uint16_t)(first_skill - 3) <= 3) script = SCRIPT_ATTACK_1;
          else {
            uint8_t second_skill = read8(skill + 3);
            if (second_skill > 19) second_skill = (uint8_t)(second_skill - 20);
            if (second_skill > 8) second_skill = 9;
            if ((uint16_t)(second_skill - 1) <= 1 || second_skill == 4 || second_skill == 5 || second_skill == 7) {
              script = SCRIPT_ATTACK_2;
            } else {
              brainTurn(i);
              return;
            }
          }
          break;
        }
      }
    }
    if (script != 0) {
      setCallback(i, brainScriptDone);
      brainSetScript(i, script);
      return;
    }
    brainTurn(i);
    return;
  }
  write8(entity + B_COUNT, (uint8_t)(read8(entity + B_COUNT) + 1));
  brainReact(i);
  if ((uint16_t)brainFaceTarget(i) == 0) brainReset(i);
}

/** 0x0801d408: the reaction to what the target is doing, by the condition list's answer. */
static void brainReact(int i) {
  int target = brainTarget(i);
  uint32_t answer = brainConditions(i, target, fighterCharacter(i) == 19 ? CONDITIONS_19 : CONDITIONS);
  switch (answer) {
    case 2: brainGuard1(i); break;
    case 3: brainScriptA(i); break;
    case 4: brainScriptB(i); break;
    case 5:
      if (target == i || (field54(i, target) < 0 && fighterSide(i) != 0)
        || (field54(i, target) >= 0 && fighterSide(i) == 0)) brainScriptC(i);
      else brainScriptF(i);
      break;
    case 6:
      if (target == i || (field54(i, target) < 0 && fighterSide(i) != 0)
        || (field54(i, target) >= 0 && fighterSide(i) == 0)) brainScriptD(i);
      else brainScriptF(i);
      break;
    case 7:
      if (target == i || (field54(i, target) < 0 && fighterSide(i) != 0)
        || (field54(i, target) >= 0 && fighterSide(i) == 0)) brainScriptE(i);
      else brainScriptF(i);
      break;
    case 15: brainAttackScript(i); break;
    default: break;
  }
}

/** 0x0801d618: the thought that picks what to do from the condition list. */
static void brainThink(int i) {
  int target = brainTarget(i);
  uint32_t answer = brainConditions(i, target, fighterCharacter(i) == 19 ? CONDITIONS_19 : CONDITIONS);
  switch (answer) {
    case 2: brainGuard1(i); break;
    case 3: brainScriptA(i); break;
    case 4: brainScriptB(i); break;
    case 5:
      if (target == i || (field54(i, target) < 0 && fighterSide(i) != 0)
        || (field54(i, target) >= 0 && fighterSide(i) == 0)) brainScriptC(i);
      else brainScriptF(i);
      break;
    case 6:
      if (target == i || (field54(i, target) < 0 && fighterSide(i) != 0)
        || (field54(i, target) >= 0 && fighterSide(i) == 0)) brainScriptD(i);
      else brainScriptF(i);
      break;
    case 7:
      if (target == i || (field54(i, target) < 0 && fighterSide(i) != 0)
        || (field54(i, target) >= 0 && fighterSide(i) == 0)) brainScriptE(i);
      else brainScriptF(i);
      break;
    case 8: brainSpecial(i); break;
    case 9: brainResetAlt(i); break;
    case 11: {
      int next = brainTargetBest(i);
      write8(brainAt(i) + B_TARGET, (uint8_t)next);
      if (next == i) break;
      if ((field54(i, next) < 0 && fighterSide(i) != 0) || (field54(i, next) >= 0 && fighterSide(i) == 0)) break;
      brainScriptF(i);
      break;
    }
    case 12: brainWait(i); break;
    case 13: brainScriptG(i); break;
    case 14: brainScriptH(i); break;
    case 15: brainAttackScript(i); break;
    default: break;
  }
}

/** 0x0801e3cc: a brain's attack script, from its start, after one frame of it. */
static void brainAttackScript(int i) {
  setCallback(i, brainAttack);
  write16(brainAt(i) + B_KEYS, 0);
  write8(brainAt(i) + B_COUNT, 0);
  write8(brainAt(i) + B_FLAG13, 0);
  brainSetScript(i, SCRIPT_WALK);
  brainScript(i);
}

/** 0x0801e41c: the attack script running, and what the fighter's state says to do next. */
static void brainAttack(int i) {
  uint16_t state = fighterState(i);
  if (state == 0) {
    write16(brainAt(i) + B_KEYS, 0);
    setCallback(i, brainThink);
    return;
  }
  if (state == 66) {
    uint8_t subtype = read8(fighterAt(i) + 37);
    if (subtype == 2) setBrainKeys(i, 0x80);
    else if (subtype == 4) setBrainKeys(i, 0x20);
    else if (subtype == 6) setBrainKeys(i, 0x10);
    else if (subtype == 8) setBrainKeys(i, 0x40);
    return;
  }
  if (state == 16) {
    write16(brainAt(i) + B_KEYS, 0);
    setCallback(i, brainAfterGuard2);
    return;
  }
  write16(brainAt(i) + B_KEYS, 0);
}

/** 0x0801dfdc: after a guard script, back to the thought, or a guard when the fighter is knocked back. */
static void brainAfterGuard(int i) {
  uint16_t state = fighterState(i);
  if (state == 0) {
    setCallback(i, brainThink);
  } else if (state == 13) {
    setCallback(i, brainAfterDodge2);
    brainSetScript(i, SCRIPT_GUARD_AFTER);
  }
}

/** 0x0801e044: after a guard, the thought again, or a counter when the target is close. */
static void brainAfterGuard2(int i) {
  uint16_t state = fighterState(i);
  if (state == 0) setCallback(i, brainThink);
  else if (state == 16) {
    int target = brainTarget(i);
    if (field72(i, target) <= 0x3FFFF) {
      setCallback(i, brainAfterDodge3);
      brainSetScript(i, SCRIPT_DODGE_3);
    }
  }
}

/** 0x0801e0c4: a special attack, by the character's own choice of script. */
static void brainSpecial(int i) {
  uint32_t entity = brainAt(i);
  write8(entity + B_FLAG13, 0);
  setCallback(i, brainAfterSpecial);
  uint8_t character = fighterCharacter(i);
  if (character == 1) brainSetScript(i, SCRIPT_SPECIAL_1);
  else if (character == 2) {
    setCallback(i, brainAim);
    brainSetScript(i, SCRIPT_SPECIAL_2);
  } else brainSetScript(i, SCRIPT_SPECIAL_DEFAULT);
}

/** 0x0801e174: a special running, then a guard, another thought or the walk. */
static void brainAfterSpecial(int i) {
  if (fighterState(i) == 66) {
    if (rollChance((int)(int8_t)read8(LEVEL_SPECIAL + read8(LEVEL)))) brainAttackScript(i);
    else brainReset(i);
    return;
  }
  if (brainScript(i) != 0) return;
  if (brainTarget(i) == i) {
    brainResetState(i);
    return;
  }
  if (rollChance((int)(int8_t)read8(LEVEL_GUARD + read8(LEVEL)))) {
    uint32_t pick = (uint32_t)randomNumber() & 0x30;
    if (pick == 0) brainGuard1(i);
    else if (pick == 0x10) brainGuard2(i);
    else if (pick == 0x20) brainGuard3(i);
    else brainGuard4(i);
    return;
  }
  brainReset(i);
}

/** 0x0801e258: aim a special at the target, one frame of its script at a time. */
static void brainAim(int i) {
  if (brainScript(i) == 0) brainReset(i);
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  uint16_t angle = arcTan2(first, second);
  uint16_t keys = (uint16_t)((brainKeys(i) & 0xFF0F) | read8(WAY_TO_TARGET + (uint32_t)(angle >> 12)));
  write16(brainAt(i) + B_KEYS, keys);
}

/** 0x0801e2c8: a brain back to its first thought. */
static void brainResetState(int i) { brainReset(i); }

/** 0x0801e34c: after a choice, back to the walk or an attack. */
static void brainChoose(int i) {
  uint16_t state = fighterState(i);
  if (state == 66) {
    if (rollChance((int)(int8_t)read8(LEVEL_SPECIAL + read8(LEVEL)))) brainAttackScript(i);
    else brainReset(i);
    return;
  }
  write16(brainAt(i) + B_KEYS, 0);
  if (state == 0) {
    setCallback(i, brainScriptFDone);
    brainSetScript(i, SCRIPT_CHOOSE);
  }
}

/** 0x0801de5c, 0x0801debc, 0x0801df1c and 0x0801df7c: the four guards. */
static void brainGuard1(int i) {
  if (brainTarget(i) == i) { brainReset(i); return; }
  if (brainGuardCheck(i) == 0) {
    setCallback(i, brainAfterDodge1);
    brainSetScript(i, SCRIPT_GUARD_1);
  }
}

static void brainGuard2(int i) {
  if (brainTarget(i) == i) { brainReset(i); return; }
  if (brainGuardCheck(i) == 0) {
    setCallback(i, brainAfterDodge1);
    brainSetScript(i, SCRIPT_GUARD_2);
  }
}

static void brainGuard3(int i) {
  if (brainTarget(i) == i) { brainReset(i); return; }
  if (brainGuardCheck(i) == 0) {
    setCallback(i, brainAfterDodge1);
    brainSetScript(i, SCRIPT_GUARD_3);
  }
}

static void brainGuard4(int i) {
  if (brainTarget(i) == i) { brainReset(i); return; }
  if (brainGuardCheck(i) == 0) {
    setCallback(i, brainAfterDodge1);
    brainSetScript(i, SCRIPT_GUARD_4);
  }
}

/** 0x0801e4f4: holding a guard while the fighter is hurt, then the thought again when it's safe. */
static void brainGuardHold(int i) {
  uint32_t entity = brainAt(i);
  uint16_t state = fighterState(i);
  if (state == 55) write8(entity + B_COUNT, 60);
  else {
    uint8_t count = (uint8_t)(read8(entity + B_COUNT) + 1);
    if (count > 60) count = 0;
    write8(entity + B_COUNT, count);
  }
  uint8_t count = read8(entity + B_COUNT);
  uint16_t keys = brainKeys(i);
  if (count > 1) keys = (uint16_t)((keys & 0xFF0F) | 0x200);
  else keys &= 0xFF0F;
  write16(entity + B_KEYS, keys);
  int32_t health = fighterHealth(i);
  int32_t limit = (int32_t)read16(MAX_HEALTH) - (health >> 2);
  if (health > limit) setCallback(i, brainThink);
  if ((state & 0xF0) == 0x40 || (state & 0xF0) == 0x50) setCallback(i, brainThink);
  int target = brainTargetBest(i);
  if (target != i) {
    int16_t first = field54(i, target), second = field62(i, target);
    if (first >= -0x4FF && first <= 0x4FF && second >= -0x4FF && second <= 0x4FF) setCallback(i, brainThink);
  }
}

/** 0x0801e62c: turn toward the target and move. */
static void brainTurn(int i) {
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  uint16_t angle = arcTan2(first, second);
  write16(brainAt(i) + B_KEYS, read8(WAY_TO_MOVE + (uint32_t)(angle >> 12)));
  write8(brainAt(i) + B_COUNT, 0);
  setCallback(i, brainMove);
  write8(brainAt(i) + B_FIELD20, fighterField50(i));
}

/** 0x0801e6a0: the thought that keeps its target ahead and picks an attack or a guard. */
static void brainMove(int i) {
  uint32_t entity = brainAt(i);
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  uint16_t angle = arcTan2(first, second);
  if ((read8(WAY_TO_MOVE + (uint32_t)(angle >> 12)) & brainKeys(i)) == 0) {
    setCallback(i, brainThink);
    write8(entity + B_TARGET, (uint8_t)brainTargetBest(i));
    return;
  }
  int32_t health = fighterHealth(i);
  int32_t half = (read16(MAX_HEALTH) - health) / 2;
  if (health < half) {
    if (first > 0x1000 || first < -0x1000 || second > 0x1000 || second < -0x1000) {
      write16(entity + B_KEYS, (uint16_t)((brainKeys(i) & 0xFF0F) | 0x200));
      write8(entity + B_COUNT, 0);
      setCallback(i, brainGuardHold);
    }
  }
  if (read8(entity + B_ROLL) != 0 && (uint16_t)(fighterState(target) - 10) <= 5) {
    if (first >= -0x4FF && first <= 0x9FE) {
      if (second <= 0x1FF && second > -0x200) {
        setCallback(i, brainScriptBDone);
        brainSetScript(i, SCRIPT_DODGE_2);
        return;
      }
    }
  }
  if (fighterState(i) == 66) {
    if (rollChance((int)(int8_t)read8(LEVEL_SPECIAL + read8(LEVEL)))) brainAttackScript(i);
    else brainReset(i);
    return;
  }
  uint8_t field50 = fighterField50(i), field20 = read8(entity + B_FIELD20);
  if ((field50 & field20) == 0) { brainReset(i); return; }
  uint16_t keys = brainKeys(i);
  if ((keys & 0x20) && (field20 & 0x22) == 0 && (field50 & 0x22) != 0) keys ^= 0x30;
  if ((keys & 0x10) && (field20 & 0x11) == 0 && (field50 & 0x11) != 0) keys ^= 0x30;
  if ((keys & 0x40) && (field20 & 0x88) == 0 && (field50 & 0x88) != 0) keys ^= 0xC0;
  if ((keys & 0x80) && (field20 & 0x44) == 0 && (field50 & 0x44) != 0) keys ^= 0xC0;
  write16(entity + B_KEYS, keys);
}

/** 0x0801ea6c: a script that ends with the fighter standing, then the reaction and the direction. */
static void brainScriptDone(int i) {
  if (brainScript(i) == 0 && (fighterField180(i) & 1) != 0) setCallback(i, brainResetAlt);
  brainReact(i);
  if ((uint16_t)brainFaceTarget(i) == 0) brainReset(i);
}

/** 0x0801eacc, 0x0801eaf8 and 0x0801eb24: after a dodge script, the next thought. */
static void brainAfterDodge1(int i) { if (brainScript(i) == 0) setCallback(i, brainAfterGuard); }
static void brainAfterDodge2(int i) { if (brainScript(i) == 0) setCallback(i, brainAfterGuard2); }
static void brainAfterDodge3(int i) { if (brainScript(i) == 0) setCallback(i, brainThink); }

/** 0x0801eb50, 0x0801ebb0, 0x0801eb94 and 0x0801ebf4: the two dodge scripts. */
static void brainScriptA(int i) {
  setCallback(i, brainScriptADone);
  brainSetScript(i, SCRIPT_DODGE_1);
}

static void brainScriptADone(int i) { if (brainScript(i) == 0) brainReset(i); }

static void brainScriptB(int i) {
  setCallback(i, brainScriptBDone);
  brainSetScript(i, SCRIPT_DODGE_2);
}

static void brainScriptBDone(int i) { if (brainScript(i) == 0) brainReset(i); }

/** 0x0801ec10, 0x0801ec64, 0x0801ecb8 and 0x0801ed0c: the reaction scripts. */
static void brainScriptC(int i) {
  if (brainGuardCheck(i) == 0) {
    write8(brainAt(i) + B_FLAG13, 0);
    setCallback(i, brainAfterSpecial);
    brainSetScript(i, SCRIPT_DODGE_3);
  }
}

static void brainScriptD(int i) {
  if (brainGuardCheck(i) == 0) {
    write8(brainAt(i) + B_FLAG13, 0);
    setCallback(i, brainAfterSpecial);
    brainSetScript(i, SCRIPT_DODGE_4);
  }
}

static void brainScriptE(int i) {
  if (brainGuardCheck(i) == 0) {
    write8(brainAt(i) + B_FLAG13, 0);
    setCallback(i, brainAfterSpecial);
    brainSetScript(i, SCRIPT_DODGE_5);
  }
}

static void brainScriptF(int i) {
  setCallback(i, brainScriptFDone);
  brainSetScript(i, SCRIPT_CHOOSE);
}

static void brainScriptFDone(int i) { if (brainScript(i) == 0) brainReset(i); }

/** 0x0801ed6c and 0x0801eddc: the two guard-end scripts. */
static void brainScriptG(int i) {
  if (brainTarget(i) == i) { brainReset(i); return; }
  setCallback(i, brainScriptGDone);
  brainSetScript(i, SCRIPT_GUARD_HOLD);
}

static void brainScriptGDone(int i) { if (brainScript(i) == 0) brainReset(i); }

static void brainScriptH(int i) {
  if (brainTarget(i) == i) { brainReset(i); return; }
  setCallback(i, brainScriptHDone);
  brainSetScript(i, SCRIPT_GUARD_END);
}

static void brainScriptHDone(int i) { if (brainScript(i) == 0) brainReset(i); }

/** 0x0801ee4c: whether a guard starts now, which needs the target to be in the guard state. */
static int brainGuardCheck(int i) {
  if (rollChance((int)(int8_t)read8(LEVEL_DODGE + read8(LEVEL))) != 0) {
    int target = brainTarget(i);
    if (fighterState(target) == 53) {
      setCallback(i, brainGuardEnd);
      return 1;
    }
  }
  return 0;
}

/** 0x0801eea8: a guard ends when the target is no longer guarding. */
static void brainGuardEnd(int i) {
  int target = brainTarget(i);
  if (fighterState(target) != 53) setCallback(i, brainThink);
}

/** 0x0801ef7c: whether the target is the side the fighter faces. */
static int brainTargetFacing(int i) {
  if (brainTarget(i) == i) return 1;
  int16_t first = field54(i, brainTarget(i));
  if (first < 0) return fighterSide(i) != 0;
  return fighterSide(i) == 0;
}

/** 0x0801efd4: which way the target lies, by the moving table. */
static uint8_t brainTargetWayMove(int i) {
  int target = brainTarget(i);
  int16_t first = field54(i, target), second = field62(i, target);
  uint16_t angle = arcTan2(first, second);
  return read8(WAY_TO_MOVE + (uint32_t)(angle >> 12));
}

/** 0x0801f030 and 0x0801f058: the next thought with a fresh target. */
static void brainRetarget(int i) {
  setCallback(i, brainThink);
  write8(brainAt(i) + B_TARGET, (uint8_t)brainTargetBest(i));
}

static void brainRandomTarget(int i) {
  setCallback(i, brainThink);
  write8(brainAt(i) + B_TARGET, (uint8_t)brainTargetRandom(i));
}

/** 0x0801ef4c: a wait at random up to twice the level's. */
static uint16_t brainWaitTime(void) {
  uint32_t number = (uint32_t)randomNumber();
  uint16_t base = read16(LEVEL_WAIT + (uint32_t)read8(LEVEL) * 2);
  return (uint16_t)(base + (((number & 0xFFF) * base) >> 12));
}

// the helpers no thought reaches yet are kept so the port map can see every function this file rewrites
void brainKeepHelpers(void) {
  (void)brainFlip; (void)brainTargetWayOther; (void)brainTargetFacing; (void)brainTargetWayMove;
  (void)brainRetarget; (void)brainRandomTarget; (void)brainWaitTime; (void)brainChoose; (void)brainTargetFree;
  (void)brainAfterDodge3; (void)brainAfterGuard; (void)brainAfterGuard2; (void)brainGuard2; (void)brainGuard3;
  (void)brainGuard4; (void)brainScriptA; (void)brainScriptB; (void)brainScriptC; (void)brainScriptD;
  (void)brainScriptE; (void)brainScriptG; (void)brainScriptH;
}
