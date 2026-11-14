// The save, translated from engine/save.js (SAT-R's src/game/sa1/save.c, and CreateEmptySaveGame in src/game/game.c):
// Sonic Advance's one save, struct SaveGame, the 0x430 bytes the cartridge's flash memory keeps, which the kit's save
// memory holds here (gba_save). At power-on the game reads the save (SaveGameExists), or starts an empty one
// (CreateEmptySaveGame) and the language screen; then it changes the save in memory as it goes, and writes it at set
// moments (WriteSaveGame). engine/save.js lists its fields. The save's bytes are the same as the JavaScript version's,
// so the two share it (main.js), and a player keeps their save whichever they play.

#include "sa.h"
#include "levels.h"

#define CHECKSUM 0x42C
#define SECURITY 0x4F524950u
#define MAX_COURSE_TIME (10 * 3600)

Save save;
static uint8_t *flash;   // the cartridge's save memory, as the kit keeps it

static uint32_t get32(const uint8_t *b, uint32_t at) { return b[at] | b[at + 1] << 8 | b[at + 2] << 16 | (uint32_t)b[at + 3] << 24; }
static void set32(uint8_t *b, uint32_t at, uint32_t v) { b[at] = (uint8_t)v; b[at + 1] = (uint8_t)(v >> 8); b[at + 2] = (uint8_t)(v >> 16); b[at + 3] = (uint8_t)(v >> 24); }

// CalculateChecksum
static uint32_t checksum(const uint8_t *bytes) {
  uint32_t sum = 0;
  for (uint32_t i = 0; i < CHECKSUM; i += 4) sum += get32(bytes, i);
  return sum;
}

// CreateEmptySaveGame: normal difficulty, nothing cleared, the menus in English, the time limit on, no records, the
// multiplayer names blank
static void empty_save(uint8_t *bytes) {
  memset(bytes, 0, SAVE_SIZE);
  set32(bytes, 0x420, 50000);
  for (int i = 0; i < 10; i++) {
    uint32_t score = 0x380 + i * 16;
    memset(bytes + score + 4, 0x20, 8);
    bytes[score + 12] = 0xFF;
  }
  for (uint32_t i = 0x20; i < 0x380; i += 4) set32(bytes, i, MAX_COURSE_TIME);
  bytes[0x19] = 1;
}

/** The save at power-on: the one the save memory keeps, if it is one (its security and checksum right), or an empty one. */
void save_open(void) {
  flash = gba_save(SAVE_SIZE);
  save.keep = 1;
  // a start point's save is the game's own, kept nowhere, as the JavaScript version's openSave(null) gives it: it
  // doesn't read the cartridge's, so the language screen comes as it does at a first start
  if (gba_start_point("unlocked") || gba_start_point("special")) {
    empty_save(save.bytes);
    save.exists = 0;
    save.keep = 0;
    // the special stage's start point writes it at once (main.js), so the game has one if it starts again
    if (gba_start_point("special")) save_write();
    return;
  }
  save.exists = get32(flash, 0) == SECURITY && get32(flash, CHECKSUM) == checksum(flash);   // SaveGameExists
  if (save.exists) memcpy(save.bytes, flash, SAVE_SIZE);
  else empty_save(save.bytes);
}

/**
 * WriteSaveGame: nothing when the flash already holds the save; otherwise the save is marked, summed and kept. Returns
 * whether it was written, which takes WRITE_FRAMES.
 */
// the act's rings into the save's ring bank (unk428), as a signed halfword, as CreateStageResults adds them
void save_add_ring_bank(int rings) { set32(save.bytes, 0x428, le32(save.bytes, 0x428) + (uint32_t)(int16_t)rings); }

int save_write(void) {
  if (save.exists) {
    int same = 1;
    for (int i = 0; i < SAVE_SIZE && same; i++) same = flash[i] == save.bytes[i];
    if (same) return 0;
  }
  set32(save.bytes, 0, SECURITY);
  set32(save.bytes, CHECKSUM, checksum(save.bytes));
  memcpy(flash, save.bytes, SAVE_SIZE);
  save.exists = 1;
  if (save.keep) gba_save_write();
  return 1;
}

uint16_t save_unlocked_level(int character) { return (uint16_t)(save.bytes[0x08 + character * 2] | save.bytes[0x09 + character * 2] << 8); }
void save_set_unlocked_level(int character, uint16_t level) { save.bytes[0x08 + character * 2] = (uint8_t)level; save.bytes[0x09 + character * 2] = (uint8_t)(level >> 8); }
void save_moon_opened(void) {
  uint16_t cur = save_unlocked_level(0);
  if (cur < LEVEL_THE_MOON + 1) save_set_unlocked_level(0, (uint16_t)(LEVEL_THE_MOON + 1));
}
#define TIME_RECORDS 0x20
#define RECORD_LEVELS 18
#define RECORDS_PER_COURSE 3
static uint32_t record_at(int character, int level, int rank) {
  return TIME_RECORDS + (uint32_t)((character * RECORD_LEVELS + level) * RECORDS_PER_COURSE + rank) * 4;
}
uint32_t save_time_record(int character, int level, int rank) { return get32(save.bytes, record_at(character, level, rank)); }
int save_register_time_record(int character, int level, uint32_t time) {
  for (int rank = 0; rank < RECORDS_PER_COURSE; rank++) {
    uint32_t record = get32(save.bytes, record_at(character, level, rank));
    if (time >= record) continue;
    set32(save.bytes, record_at(character, level, rank), time);
    for (int next = rank + 1; next < RECORDS_PER_COURSE; next++) {
      uint32_t slower = get32(save.bytes, record_at(character, level, next));
      set32(save.bytes, record_at(character, level, next), record);
      record = slower;
    }
    return rank == 0;
  }
  return 0;
}
uint32_t save_player_id(void) { return get32(save.bytes, 0x04); }
void save_set_player_id(uint32_t id) { set32(save.bytes, 0x04, id); }

// CreateEmptySaveGame, as DELETE GAME DATA's YES does it in the Options menu: the save in memory empty again
void save_empty(void) { empty_save(save.bytes); }

// sub_8012F6C, the flash erased: the next write keeps the save whatever it holds
void save_erase(void) { save.exists = 0; }
