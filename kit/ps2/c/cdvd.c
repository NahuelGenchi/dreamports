// The PlayStation 2's disc drive as a game's EE code reaches it through the IOP (ps2.h): the RPC servers of cdvdfsv,
// which the console's emulator, Play!, answers itself rather than running Sony's module, so the kit answers them the
// same way: the drive set up, the clock, the kind of disc, a file searched for by its path, sectors read into the EE's
// memory or the IOP's, read in a chain, or streamed, and whether the disc is ready. A read is answered after the time
// Play! gives it, 100 microseconds and 500 for each sector, and the rest after a sixtieth of a second, in the IOP's
// ticks, and the bytes are in memory only then. The sectors come from the player's disc (kit/c/disc.h).
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"
#include "disc.h"

#define SECTOR 2048
#define EE_RAM_SIZE 0x2000000
#define IOP_RAM_SIZE 0x400000
// the IOP's ticks Play! waits: a sixtieth of a second, and a read's 100 microseconds and 500 a sector
#define DEFAULT_DELAY 614375u
#define READ_BASE_DELAY 3686u
#define READ_SECTOR_DELAY 18432u
#define READ_SERVER 0x80000595u

enum { NONE, READ, READ_IOP, STREAM_READ, DISK_READY, READ_CHAIN, PAUSE };
static int pending;
static uint32_t delay, read_count, read_address, stream_at, stream_buffer;
static int streaming;
// what a read brought from the disc, which goes into memory when its time has passed
static uint8_t *staged;
static uint32_t staged_room;

// sectors' 2048 bytes of data, wherever they are in the disc's own sectors
static void sectors(uint32_t lba, uint32_t count, uint8_t *to) { ps2_disc_sectors(lba, count, to); }
void ps2_disc_sectors(uint32_t lba, uint32_t count, uint8_t *to) {
  uint32_t from = 0;
  if (kit_disc_kind() == KIT_DISC_CD) {
    const kit_track *track = kit_disc_track(1);
    from = track && track->type == KIT_TRACK_MODE1 ? 16 : 24;
  }
  uint32_t got = kit_disc_read(lba, count, from, SECTOR, to);
  if (got < count) __builtin_memset(to + got * SECTOR, 0, (count - got) * SECTOR);
}
static void stage(uint32_t lba, uint32_t count) {
  if (count * SECTOR > staged_room) {
    staged_room = count * SECTOR;
    staged = kit_alloc(staged_room);
  }
  if (count) sectors(lba, count, staged);
}

static void finish(void) {
  if (pending == READ || pending == STREAM_READ) {
    __builtin_memcpy(ee_memory() + (read_address & (EE_RAM_SIZE - 1)), staged, read_count * SECTOR);
    if (pending == STREAM_READ) stream_at += read_count;
  } else if (pending == READ_IOP) {
    __builtin_memcpy(iop_memory() + (read_address & (IOP_RAM_SIZE - 1)), staged, read_count * SECTOR);
  }
  pending = NONE;
  sif_call_reply(READ_SERVER, 0);
}
void cdvd_ticks(uint32_t ticks) {
  if (pending == NONE) return;
  delay -= delay < ticks ? delay : ticks;
  if (delay == 0) finish();
}

static uint32_t word(const uint8_t *from, int n) {
  uint32_t value;
  __builtin_memcpy(&value, from + n * 4, 4);
  return value;
}
static void set(uint8_t *to, int n, uint32_t value) { __builtin_memcpy(to + n * 4, &value, 4); }
static uint8_t bcd(uint32_t value) { return (uint8_t)((value / 10) << 4 | value % 10); }

// ----------------------------------------------------------------------------------------------------------------
// A file by its path, found as Play! finds it: its folders in the disc's path table, then its name as the start of an
// entry's, whatever the case, in the folder's entries up to the first empty one

static int lower(int c) { return c >= 'A' && c <= 'Z' ? c + 32 : c; }
static int same_start(const char *name, const char *start, uint32_t length) {
  for (uint32_t i = 0; i < length; i++) if (lower(name[i]) != lower(start[i])) return 0;
  return 1;
}
static uint32_t length_of(const char *text) {
  uint32_t n = 0;
  while (text[n]) n++;
  return n;
}
// the path table's record `index` (from 1): its folder's sector, its parent and its name, or 0 past the last
static int table_record(const uint8_t *table, uint32_t size, uint32_t index, uint32_t *sector, uint32_t *parent, const uint8_t **name, uint32_t *name_length) {
  uint32_t at = 0;
  for (uint32_t n = 1; at + 8 <= size && table[at]; n++) {
    uint32_t length = table[at];
    if (n == index) {
      __builtin_memcpy(sector, table + at + 2, 4);
      *parent = table[at + 6] | table[at + 7] << 8;
      *name = table + at + 8;
      *name_length = length;
      return 1;
    }
    at += 8 + length + (length & 1);
  }
  return 0;
}
static int search(const char *asked, uint32_t *sector, uint32_t *size) {
  static uint8_t volume[SECTOR], table[SECTOR * 4], folder[SECTOR];
  char path[256];
  uint32_t length = 0, semicolons = 0;
  for (; asked[length] && length < 255; length++) path[length] = asked[length] == '\\' ? '/' : asked[length];
  path[length] = 0;
  // every version after the first is taken off
  for (uint32_t i = 0; i < length; i++) semicolons += path[i] == ';';
  for (; semicolons > 1; semicolons--) {
    while (path[length - 1] != ';') length--;
    path[--length] = 0;
  }
  const char *name = path;
  if (*name == '/') name++;
  sectors(16, 1, volume);
  uint32_t table_size = word(volume, 33), table_at = word(volume, 35);
  if (table_size > sizeof table) table_size = sizeof table;
  sectors(table_at, (table_size + SECTOR - 1) / SECTOR, table);
  // the root, the first record whose name is one byte long
  uint32_t folder_index = 0, at, parent, record_length;
  const uint8_t *record_name;
  for (uint32_t n = 1; table_record(table, table_size, n, &at, &parent, &record_name, &record_length); n++) {
    if (record_length == 1) { folder_index = n; break; }
  }
  for (;;) {
    const char *next = name;
    while (*next && *next != '/') next++;
    if (!*next) break;
    uint32_t wanted = (uint32_t)(next - name), found = 0;
    for (uint32_t n = 1; table_record(table, table_size, n, &at, &parent, &record_name, &record_length); n++) {
      if (parent == folder_index && record_length == wanted && same_start((const char *)record_name, name, wanted)) { found = n; break; }
    }
    if (!found) return 0;
    folder_index = found;
    name = next + 1;
  }
  if (!table_record(table, table_size, folder_index, &at, &parent, &record_name, &record_length)) return 0;
  uint32_t wanted = length_of(name);
  // the folder's entries one after another, a sector at a time, to the first with no length
  for (uint32_t s = 0;; s++) {
    sectors(at + s, 1, folder);
    for (uint32_t i = 0; i < SECTOR;) {
      uint32_t entry = folder[i];
      if (entry == 0) return 0;
      if (i + entry > SECTOR) break;
      if (folder[i + 32] >= wanted && same_start((const char *)folder + i + 33, name, wanted)) {
        __builtin_memcpy(sector, folder + i + 2, 4);
        __builtin_memcpy(size, folder + i + 10, 4);
        return 1;
      }
      i += entry;
    }
  }
}

// ----------------------------------------------------------------------------------------------------------------
// The servers

static int serve_init(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  if (number == 0 && returned_size != 0) set(returned, 3, 0xFF);
  return 1;
}
static int serve_drive(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  switch (number) {
  case 0x01: {
    // the console's clock, in BCD
    uint32_t parts[6];
    ps2_console_date(parts);
    uint8_t *clock = returned + 4;
    clock[0] = 0;
    clock[1] = bcd(parts[5]);
    clock[2] = bcd(parts[4]);
    clock[3] = bcd(parts[3]);
    clock[4] = 0;
    clock[5] = bcd(parts[2]);
    clock[6] = bcd(parts[1]);
    clock[7] = bcd(parts[0] % 100);
    set(returned, 0, 1);
    break;
  }
  case 0x03: set(returned, 0, cdvd_disc_type()); break;
  case 0x04: set(returned, 0, 0); break;
  case 0x05: set(returned, 0, 1); set(returned, 1, 0); break;
  case 0x0C: set(returned, 0, streaming ? 18 : 10); break;
  case 0x16: set(returned, 0, 1); break;
  case 0x22: set(returned, 0, 1); break;
  case 0x27:
    set(returned, 0, 1);
    set(returned, 1, kit_disc_layer_break() ? 1 : 0);
    // sixteen sectors before the layer's own start, as Play! has the console say it, even with one layer
    if (returned_size >= 12) set(returned, 2, kit_disc_layer_break() - 0x10);
    break;
  }
  return 1;
}
static int serve_read(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  switch (number) {
  case 0x01:
  case 0x0D:
    if (returned_size >= 4) set(returned, 0, 0);
    read_count = word(arguments, 1);
    read_address = word(arguments, 2) & 0x1FFFFFFF;
    stage(word(arguments, 0), read_count);
    pending = number == 0x01 ? READ : READ_IOP;
    delay = number == 0x01 ? READ_BASE_DELAY + read_count * READ_SECTOR_DELAY : DEFAULT_DELAY;
    return 0;
  case 0x04: set(returned, 0, 1); return 1;
  case 0x08:
    pending = PAUSE;
    delay = DEFAULT_DELAY;
    return 0;
  case 0x09:
    switch (word(arguments, 3)) {
    case 1: stream_at = word(arguments, 0); set(returned, 0, 1); streaming = 1; break;
    case 2:
      read_count = word(arguments, 1);
      read_address = word(arguments, 2) & (EE_RAM_SIZE - 1);
      stage(stream_at, read_count);
      pending = STREAM_READ;
      delay = DEFAULT_DELAY;
      set(returned, 0, read_count);
      return 0;
    case 3: set(returned, 0, 1); streaming = 0; break;
    case 5: set(returned, 0, 1); stream_buffer = word(arguments, 0); break;
    case 6: set(returned, 0, stream_buffer); break;
    case 4:
    case 9: stream_at = word(arguments, 0); set(returned, 0, 1); break;
    }
    return 1;
  case 0x0E:
    if (pending != NONE) {
      set(returned, 0, 6);
      return 1;
    }
    pending = DISK_READY;
    delay = DEFAULT_DELAY;
    set(returned, 0, 2);
    return 0;
  case 0x0F:
    // up to 64 reads, each a sector, a count and a place in the EE's memory, read at once and answered later
    for (int i = 0; i < 64; i++) {
      uint32_t at = word(arguments, i * 3), count = word(arguments, i * 3 + 1), to = word(arguments, i * 3 + 2);
      if (at == 0xFFFFFFFF || count == 0xFFFFFFFF || to == 0xFFFFFFFF) break;
      sectors(at, count, ee_memory() + (to & (EE_RAM_SIZE - 1)));
    }
    pending = READ_CHAIN;
    delay = DEFAULT_DELAY;
    return 0;
  }
  return 1;
}
// a call Play! never answers after the first, as some games' libraries make it without waiting
static int serve_power_off(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) { return number != 0x01; }
static int serve_search(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  if (number != 0) return 1;
  uint32_t sector, size;
  int found = search((const char *)arguments + (arguments_size == 0x124 ? 0x20 : 0x24), &sector, &size);
  if (found) {
    set(arguments, 0, sector);
    set(arguments, 1, size);
  }
  set(returned, 0, (uint32_t)found);
  return 1;
}
static int serve_ready(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  if (number != 0) return 1;
  // whatever was waiting is over first
  if (pending != NONE) finish();
  set(returned, 0, 2);
  return 1;
}

uint32_t cdvd_disc_type(void) { return kit_disc_kind() == KIT_DISC_CD ? 0x12 : 0x14; }

void cdvd_power(void) {
  sif_register_server(0x80000592, serve_init);
  sif_register_server(0x80000593, serve_drive);
  sif_register_server(READ_SERVER, serve_read);
  sif_register_server(0x80000596, serve_power_off);
  sif_register_server(0x80000597, serve_search);
  sif_register_server(0x8000059A, serve_ready);
  sif_register_server(0x8000059C, serve_ready);
}
