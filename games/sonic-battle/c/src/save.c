// Sonic Battle's save, as its cartridge keeps it: a block of the work RAM (0x03002110, SAVE_BYTES long) written to one of
// the flash's sixteen sectors, each in turn, so that a write that fails leaves the save before it. A sector is the
// word "SBTL", a CRC of the whole sector, a count that says which save is the newest, and the block, scrambled with a
// table of the cartridge's. At power-on the game takes the sector with the highest count whose CRC is right, or lays
// down a new save and writes it at once. The kit's save memory is the flash, byte for byte (gba_save).

#include "game.h"

#define SAVE_BYTES 0x4E0
#define SECTOR 0x1000
#define SECTORS 16
#define MARK 0x4C544253u          // "SBTL"
#define SCRAMBLE 0x0807B780u      // a byte for each byte, added to the one after it
#define CRC_TABLE 0x0807B880u
#define COUNT 0x03002610u         // the save's count, 64 bits: the V-blanks the game has counted (g.frames), which go on from the save's
#define NEW_SAVE_SKILLS 0x0810B32Cu
#define NEW_SAVE_DECK 0x0810B2F4u
#define SKILLS_OWNED 0x120
#define NAME 0x60
#define LANGUAGE 119
#define MINI_GAMES 120        // 0x03002188: the Mini-games screen's entries opened, a bit each
#define END 0xFFFE

static uint8_t *flash;   // the cartridge's save memory, as the kit keeps it
static int slot;         // the sector the save is in (0x030025F0)

/** 0x080219e4: each byte takes the table's byte for the one before it, as that one came out. */
static void scramble(uint8_t *bytes, uint32_t size) {
  for (uint32_t i = 0; i + 1 < size; i++) bytes[i + 1] = (uint8_t)(bytes[i + 1] + read8(SCRAMBLE + bytes[i]));
}

/** 0x08021a10: the other way, from the last byte back. */
static void unscramble(uint8_t *bytes, uint32_t size) {
  for (uint32_t i = size - 1; i > 0; i--) bytes[i] = (uint8_t)(bytes[i] - read8(SCRAMBLE + bytes[i - 1]));
}

/** 0x08021a40: the CRC-32 of the bytes, from the cartridge's table. */
static uint32_t crc(const uint8_t *bytes, uint32_t size) {
  uint32_t sum = 0xFFFFFFFFu;
  for (uint32_t i = 0; i < size; i++) sum = (sum >> 8) ^ read32(CRC_TABLE + ((bytes[i] ^ sum) & 0xFF) * 4);
  return ~sum;
}

static uint32_t get32(const uint8_t *b) { return b[0] | b[1] << 8 | b[2] << 16 | (uint32_t)b[3] << 24; }
static void set32(uint8_t *b, uint32_t v) { b[0] = (uint8_t)v; b[1] = (uint8_t)(v >> 8); b[2] = (uint8_t)(v >> 16); b[3] = (uint8_t)(v >> 24); }

// what the game keeps of the save outside the block, into it and out of it: which mini-games are open, the player's
// name and the language
static void toBlock(void) {
  write8(SAVE + MINI_GAMES, (uint8_t)g.mini_games_open);
  for (int i = 0; i < 6; i++) write16(SAVE + NAME + (uint32_t)i * 2, g.name[i]);
  write8(SAVE + LANGUAGE, (uint8_t)g.language);
}
static void fromBlock(void) {
  g.mini_games_open = read8(SAVE + MINI_GAMES);
  for (int i = 0; i < 6; i++) g.name[i] = read16(SAVE + NAME + (uint32_t)i * 2);
  g.language = g.saved_language = read8(SAVE + LANGUAGE);
}

/** 0x080215a8: a new save. One mini-game open, English, the skills the cartridge's list gives from the start, the six
 *  decks the same 27 skills, each of them owned, and no name. */
void saveNew(void) {
  for (uint32_t i = 0; i < SAVE_BYTES; i++) write8(SAVE + i, 0);
  write32(SAVE, 1);
  write8(SAVE + LANGUAGE, 1);
  write8(SAVE + MINI_GAMES, 1);
  for (uint32_t i = 0; i < 0x200; i++) write8(SAVE + SKILLS_OWNED + i, 0xFF);
  for (uint32_t i = 0; i <= 0x134; i++) {
    if (read8(NEW_SAVE_SKILLS + i * 8 + 7)) write8(SAVE + SKILLS_OWNED + i, read8(NEW_SAVE_SKILLS + i * 8 + 6));
  }
  for (uint32_t n = 0; n < 27; n++) {
    uint16_t skill = read16(NEW_SAVE_DECK + n * 2);
    write8(SAVE + SKILLS_OWNED + skill, 1);
    for (uint32_t deck = 0; deck < 6; deck++) write16(SAVE + 0x322 + deck * 0x38 + n * 2, skill);
  }
  for (uint32_t i = 0; i < 5; i++) write16(SAVE + NAME + i * 2, 0);
  write16(SAVE + NAME + 10, END);
  write8(SAVE + NAME + 18, 3);
  write8(SAVE + NAME + 20, 2);
  write16(SAVE + NAME + 0x430, 1);
  write32(SAVE + NAME + 28, 30);
}

/** 0x08021980: whether the block differs from what its sector holds. */
static int changed(void) {
  uint8_t held[SECTOR - 16];
  __builtin_memcpy(held, flash + slot * SECTOR + 16, sizeof held);
  unscramble(held, sizeof held);
  for (uint32_t i = 0; i < SAVE_BYTES; i++) if (held[i] != read8(SAVE + i)) return 1;
  return 0;
}

/**
 * 0x080217d0: the save written to the next sector round, unless it's as its sector holds it and `always` isn't set.
 * The sector takes the count as it is once the game has read its sector back and compared it, which is `vblanks`
 * V-blanks after the call, as that work is long enough to cross one where it's called late in a frame. Returns whether
 * it was written.
 */
int saveWrite(int always, int vblanks) {
  // a start point's play is kept nowhere, but the proof tools see it written, to compare it with the cartridge's
  int keep = !g.save_apart || gba_start_point("proof");
  toBlock();
  if (!always && !changed()) return 0;
  write32(COUNT, (uint32_t)(g.frames + vblanks));
  uint8_t sector[SECTOR];
  __builtin_memset(sector, 0, SECTOR);
  set32(sector, MARK);
  set32(sector + 8, read32(COUNT));
  set32(sector + 12, read32(COUNT + 4));
  for (uint32_t i = 0; i < SAVE_BYTES; i++) sector[16 + i] = read8(SAVE + i);
  scramble(sector + 16, SECTOR - 16);
  set32(sector + 4, crc(sector, SECTOR));
  slot = (slot + 1) & (SECTORS - 1);
  __builtin_memcpy(flash + slot * SECTOR, sector, SECTOR);
  if (keep) gba_save_write();
  return 1;
}

/** 0x080216e4: the save at power-on: the newest whose CRC is right, or a new one, written at once. */
void saveOpen(void) {
  flash = gba_save(SECTORS * SECTOR);
  uint32_t low = 0, high = 0;
  int found = 0;
  for (int i = 0; i < SECTORS; i++) {
    uint8_t sector[SECTOR];
    __builtin_memcpy(sector, flash + i * SECTOR, SECTOR);
    uint32_t sum = get32(sector + 4);
    set32(sector + 4, 0);
    if (crc(sector, SECTOR) != sum) continue;
    uint32_t itsLow = get32(sector + 8), itsHigh = get32(sector + 12);
    if (high > itsHigh || (high == itsHigh && low > itsLow)) continue;
    low = itsLow; high = itsHigh; found = i;
  }
  if (low | high) {
    write32(COUNT, low);
    write32(COUNT + 4, high);
    slot = found;
    // 0x08021920: the block out of its sector
    uint8_t held[SECTOR - 16];
    __builtin_memcpy(held, flash + slot * SECTOR + 16, sizeof held);
    unscramble(held, sizeof held);
    for (uint32_t i = 0; i < SAVE_BYTES; i++) write8(SAVE + i, held[i]);
    fromBlock();
    g.frames = (int)low;
    return;
  }
  saveNew();
  fromBlock();
  g.frames = 1;
  write32(COUNT + 4, 0);
  slot = SECTORS - 1;
  saveWrite(1, 0);
}

/** 0x08038850's save: the whole flash erased (0x0802188c), and a new save laid down, counted from 1 and written. */
void saveDelete(void) {
  __builtin_memset(flash, 0xFF, SECTORS * SECTOR);
  saveNew();
  fromBlock();
  g.frames = 1;
  write32(COUNT + 4, 0);
  slot = SECTORS - 1;
  saveWrite(0, 1);
}
