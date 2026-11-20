// The PlayStation 2's memory cards as a game's EE code reaches them (ps2.h): the RPC server of mcserv, which the
// console's emulator, Play!, answers itself, a game's own memory card modules never taking its place, so the kit
// answers it the same way. Play! keeps a card as a folder of files and gives back what its own code decides: files
// opened, made, read, written and closed, five open at most, folders made, changed to and listed, entries deleted and
// renamed, and a card that is always there, formatted, with 8 MB free. Each answer goes back 100,000 of the IOP's ticks
// after the call. An entry's date is the console's clock at the call that last changed it, as the tools' emulator
// stamps it, and one that was on the card as the game started has the clock's start.
//
// The cards are kept for the player by the page, as the bytes the proof tools compare (kit/ps2/card.js): each entry of
// port 0's card and then port 1's, a folder's entries in the order of their names, and only as many bytes as they take.
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"
#include "page.h"

#define SERVER 0x80000400u
#define DELAY 100000u
#define EE_RAM_SIZE 0x2000000
#define PORTS 2
#define HANDLES 5
#define ENTRIES 512
#define PATH 200
// a card holds 8 MB, and the two of them are kept
#define KEPT (17u << 20)
#define NO_ENTRY ((uint32_t)-4)
#define DENIED ((uint32_t)-5)
#define NOT_EMPTY ((uint32_t)-6)
#define FOLDER_ATTRIBUTES 0x8427
#define FILE_ATTRIBUTES 0x8497

// an entry of a card: its path from the card's top, "/A/B", as the emulator names its file, its bytes, and when it
// last changed by the console's clock
typedef struct {
  uint8_t used, folder, port, unflushed;
  char path[PATH];
  uint8_t *bytes;
  uint32_t size, room, stamp;
} entry;
static entry *entries;
static struct { int entry; uint32_t at; } handles[HANDLES];
static char current[PORTS][PATH];
static int known[PORTS], waiting;
static uint32_t delay, changes;
// what a search found, for the calls that go on reading it
static uint8_t found[ENTRIES][64];
static uint32_t found_count, found_at;

// ----------------------------------------------------------------------------------------------------------------
// Words and paths

static uint32_t word(const uint8_t *from, int n) {
  uint32_t value;
  __builtin_memcpy(&value, from + n * 4, 4);
  return value;
}
static void set(uint8_t *to, uint32_t value) { __builtin_memcpy(to, &value, 4); }
static uint32_t length_of(const char *text) {
  uint32_t n = 0;
  while (text[n]) n++;
  return n;
}
static int same(const char *a, const char *b) {
  while (*a && *a == *b) a++, b++;
  return *a == *b;
}
static void copy(char *to, const char *from, uint32_t room) {
  uint32_t n = 0;
  for (; from[n] && n + 1 < room; n++) to[n] = from[n];
  to[n] = 0;
}
// a name as the emulator keeps it in a file's name: ":" and "\" as %3A and %5C
static void encoded(char *to, const char *name, uint32_t room) {
  static const char hex[] = "0123456789ABCDEF";
  uint32_t n = 0;
  for (; *name && n + 4 < room; name++) {
    if (*name == ':' || *name == '\\') {
      to[n++] = '%';
      to[n++] = hex[(uint8_t)*name >> 4];
      to[n++] = hex[*name & 15];
    } else to[n++] = *name;
  }
  to[n] = 0;
}
static int hex_digit(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'A' && c <= 'F' ? c - 'A' + 10 : c >= 'a' && c <= 'f' ? c - 'a' + 10 : 0; }
static uint32_t decoded(char *to, const char *name, uint32_t room) {
  uint32_t n = 0;
  for (; *name && n + 1 < room; name++) {
    if (*name == '%' && name[1] && name[2]) {
      to[n++] = (char)(hex_digit(name[1]) << 4 | hex_digit(name[2]));
      name += 2;
    } else to[n++] = *name;
  }
  to[n] = 0;
  return n;
}
// a path with its "." and ".." and empty parts worked out: "/A/B", or "" for the card's top
static void absolute(char *to, const char *path) {
  uint32_t n = 0;
  to[0] = 0;
  while (*path) {
    while (*path == '/') path++;
    const char *end = path;
    while (*end && *end != '/') end++;
    uint32_t length = (uint32_t)(end - path);
    if (length == 2 && path[0] == '.' && path[1] == '.') {
      while (n && to[n - 1] != '/') n--;
      if (n) n--;
    } else if (length && !(length == 1 && path[0] == '.') && n + length + 2 < PATH) {
      to[n++] = '/';
      __builtin_memcpy(to + n, path, length);
      n += length;
    }
    to[n] = 0;
    path = end;
  }
}
// where a name is on a card: from its top when it starts with "/", or from the folder the game changed to
static void place(char *to, unsigned port, const char *name) {
  char whole[PATH * 2];
  if (!name[0]) {
    to[0] = 0;
    return;
  }
  if (name[0] == '/') copy(whole, name, sizeof whole);
  else {
    copy(whole, current[port], sizeof whole);
    uint32_t n = length_of(whole);
    whole[n++] = '/';
    copy(whole + n, name, sizeof whole - n);
  }
  absolute(to, whole);
}

// ----------------------------------------------------------------------------------------------------------------
// The cards

static int find(unsigned port, const char *path) {
  for (int i = 0; i < ENTRIES; i++) if (entries[i].used && entries[i].port == port && same(entries[i].path, path)) return i;
  return -1;
}
static int is_folder(unsigned port, const char *path) {
  if (!path[0]) return 1;
  int i = find(port, path);
  return i >= 0 && entries[i].folder;
}
static void parent_of(char *to, const char *path) {
  copy(to, path, PATH);
  uint32_t n = length_of(to);
  while (n && to[n - 1] != '/') n--;
  to[n ? n - 1 : 0] = 0;
}
// an entry's folder changed when the entry was made, deleted or renamed, as a folder's own time does
static void touch_parent(unsigned port, const char *path) {
  char parent[PATH];
  parent_of(parent, path);
  int i = find(port, parent);
  if (i >= 0) entries[i].stamp = ps2_console_seconds();
}
static int make(unsigned port, const char *path, int folder) {
  char parent[PATH];
  parent_of(parent, path);
  if (!is_folder(port, parent)) return -1;
  for (int i = 0; i < ENTRIES; i++) {
    if (entries[i].used) continue;
    __builtin_memset(&entries[i], 0, sizeof entries[i]);
    entries[i].used = 1;
    entries[i].folder = (uint8_t)folder;
    entries[i].port = (uint8_t)port;
    copy(entries[i].path, path, PATH);
    entries[i].stamp = ps2_console_seconds();
    touch_parent(port, path);
    return i;
  }
  return -1;
}
static int children(unsigned port, const char *path) {
  int count = 0;
  char parent[PATH];
  for (int i = 0; i < ENTRIES; i++) {
    if (!entries[i].used || entries[i].port != port) continue;
    parent_of(parent, entries[i].path);
    count += same(parent, path);
  }
  return count;
}
static void room_for(entry *e, uint32_t size) {
  if (size <= e->room) return;
  uint32_t room = e->room ? e->room : 1024;
  while (room < size) room *= 2;
  uint8_t *more = kit_alloc(room);
  if (e->size) __builtin_memcpy(more, e->bytes, e->size);
  e->bytes = more;
  e->room = room;
}
// the entries of a folder in the order of their names' bytes, one after `after`, or -1
static int next_in(unsigned port, const char *folder, int after) {
  int best = -1;
  char parent[PATH];
  for (int i = 0; i < ENTRIES; i++) {
    if (!entries[i].used || entries[i].port != port) continue;
    parent_of(parent, entries[i].path);
    if (!same(parent, folder)) continue;
    const char *a = entries[i].path;
    int past = 1, before = 1;
    if (after >= 0) {
      const char *b = entries[after].path;
      uint32_t k = 0;
      while (a[k] && a[k] == b[k]) k++;
      past = (uint8_t)a[k] > (uint8_t)b[k];
    }
    if (best >= 0) {
      const char *b = entries[best].path;
      uint32_t k = 0;
      while (a[k] && a[k] == b[k]) k++;
      before = (uint8_t)a[k] < (uint8_t)b[k];
    }
    if (past && before) best = i;
  }
  return best;
}

// The cards as the bytes the player's browser keeps and the proof tools compare (kit/ps2/card.js)
static uint8_t *kept;
static uint32_t kept_size;
static void put(const void *bytes, uint32_t size) {
  if (kept_size + size <= KEPT) __builtin_memcpy(kept + kept_size, bytes, size);
  kept_size += size;
}
static void write_folder(unsigned port, const char *folder) {
  for (int i = next_in(port, folder, -1); i >= 0; i = next_in(port, folder, i)) {
    char named[PATH + 8] = "mc0";
    named[2] = (char)('0' + port);
    uint32_t n = 3 + decoded(named + 3, entries[i].path, PATH);
    uint8_t head[3] = { entries[i].folder ? 'D' : 'F', (uint8_t)n, (uint8_t)(n >> 8) };
    put(head, 3);
    put(named, n);
    if (entries[i].folder) write_folder(port, entries[i].path);
    else {
      put(&entries[i].size, 4);
      put(entries[i].bytes, entries[i].size);
    }
  }
}
static uint32_t kept_hash;
static void keep(void) {
  kept_size = 0;
  for (unsigned port = 0; port < PORTS; port++) write_folder(port, "");
  if (kept_size > KEPT) kept_size = KEPT;
  kept_hash = 2166136261u;
  for (uint32_t i = 0; i < kept_size; i++) kept_hash = (kept_hash ^ kept[i]) * 16777619u;
}
// a call that changed a card: the tools read the cards again, and the page keeps them for the player
static void changed(void) {
  uint32_t size = kept_size, hash = kept_hash;
  keep();
  if (size == kept_size && hash == kept_hash) return;
  changes++;
  host_save_write(kept, kept_size);
}

void mc_power(void) {
  entries = kit_alloc(sizeof(entry) * ENTRIES);
  for (int i = 0; i < HANDLES; i++) handles[i].entry = -1;
  kept = kit_alloc(KEPT);
  host_save_read(kept, KEPT);
  // what the browser kept of the cards, each entry from the clock's start
  for (uint32_t at = 0; at + 3 <= KEPT && (kept[at] == 'F' || kept[at] == 'D');) {
    uint32_t n = kept[at + 1] | kept[at + 2] << 8;
    if (n < 4 || n >= PATH || at + 3 + n > KEPT) break;
    char path[PATH], raw[PATH];
    __builtin_memcpy(raw, kept + at + 6, n - 3);
    raw[n - 3] = 0;
    encoded(path, raw, PATH);
    unsigned port = kept[at + 5] == '1';
    int folder = kept[at] == 'D', i = make(port, path, folder);
    at += 3 + n;
    if (!folder) {
      uint32_t size = word(kept + at, 0);
      at += 4;
      if (i >= 0 && at + size <= KEPT) {
        room_for(&entries[i], size);
        __builtin_memcpy(entries[i].bytes, kept + at, size);
        entries[i].size = size;
      }
      at += size;
    }
  }
  for (int i = 0; i < ENTRIES; i++) if (entries[i].used) entries[i].stamp = 978307200u;
  keep();
  sif_register_server(SERVER, mc_serve);
}
uint32_t mc_changes(void) { return changes; }
const uint8_t *mc_bytes(uint32_t *size) {
  *size = kept_size;
  return kept;
}

// ----------------------------------------------------------------------------------------------------------------
// A folder searched, as Play! does it: the filter, with ? for a character or none and * for any run, against each
// entry's path from where the search starts, going into a folder only until something in its parent has matched

static int matches(const char *pattern, const char *text) {
  if (!*pattern) return !*text;
  if (*pattern == '*') return matches(pattern + 1, text) || (*text && matches(pattern, text + 1));
  if (*pattern == '?') return matches(pattern + 1, text) || (*text && matches(pattern + 1, text + 1));
  return *pattern == *text && matches(pattern + 1, text + 1);
}
static void found_named(const char *name, uint32_t size, uint32_t attributes, uint32_t stamp, int stamped) {
  if (found_count == ENTRIES) return;
  uint8_t *e = found[found_count++];
  __builtin_memset(e, 0, 64);
  if (stamped) {
    uint32_t parts[6];
    ps2_date_of(stamp, parts);
    for (int t = 0; t < 2; t++) {
      uint8_t *time = e + t * 8;
      time[1] = (uint8_t)parts[5];
      time[2] = (uint8_t)parts[4];
      time[3] = (uint8_t)parts[3];
      time[4] = (uint8_t)parts[2];
      time[5] = (uint8_t)(parts[1] - 1);
      time[6] = (uint8_t)parts[0];
      time[7] = (uint8_t)(parts[0] >> 8);
    }
  }
  set(e + 16, size);
  e[20] = (uint8_t)attributes;
  e[21] = (uint8_t)(attributes >> 8);
  copy((char *)e + 32, name, 0x20);
}
static void search_in(unsigned port, const char *base, const char *folder, const char *filter) {
  int any = 0;
  uint32_t skip = length_of(base);
  for (int i = next_in(port, folder, -1); i >= 0; i = next_in(port, folder, i)) {
    const entry *e = &entries[i];
    if (matches(filter, e->path + skip)) {
      char name[PATH];
      const char *last = e->path + length_of(e->path);
      while (last > e->path && last[-1] != '/') last--;
      decoded(name, last, PATH);
      found_named(name, e->folder ? (uint32_t)children(port, e->path) : e->size, e->folder ? FOLDER_ATTRIBUTES : FILE_ATTRIBUTES, e->stamp, 1);
      any = 1;
    }
    if (e->folder && !any) search_in(port, base, e->path, filter);
  }
}

// ----------------------------------------------------------------------------------------------------------------
// The calls

static int handle_of(uint32_t n) { return n < HANDLES ? handles[n].entry : -1; }
static void flushed(int i) {
  if (!entries[i].unflushed) return;
  entries[i].unflushed = 0;
  entries[i].stamp = ps2_console_seconds();
}

static uint32_t open(unsigned port, uint32_t flags, const char *name) {
  char named[PATH], path[PATH];
  encoded(named, name, PATH);
  place(path, port, named);
  int i = path[0] ? find(port, path) : -1, exists = !path[0] || i >= 0;
  if (flags == 0x40) {
    if (exists) return NO_ENTRY;
    return make(port, path, 1) >= 0 ? 0 : (uint32_t)-1;
  }
  if ((flags & 0x200) && !exists) {
    i = make(port, path, 0);
    if (i < 0) return NO_ENTRY;
  }
  if ((flags & 0x400) && i >= 0 && !entries[i].folder) {
    entries[i].size = 0;
    entries[i].stamp = ps2_console_seconds();
  }
  if (i < 0 || entries[i].folder) return NO_ENTRY;
  for (uint32_t h = 0; h < HANDLES; h++) {
    if (handles[h].entry >= 0) continue;
    handles[h].entry = i;
    handles[h].at = 0;
    return h;
  }
  return NO_ENTRY;
}

int mc_serve(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size) {
  uint8_t *ram = ee_memory();
  uint32_t port = word(arguments, 0), flags = word(arguments, 2), table = word(arguments, 4) & (EE_RAM_SIZE - 1);
  const char *name = (const char *)arguments + 20;
  // a file's calls: its handle, how much, where from and where to
  uint32_t h = word(arguments, 0), size = word(arguments, 3), offset = word(arguments, 4), origin = word(arguments, 5);
  uint32_t buffer = word(arguments, 6) & (EE_RAM_SIZE - 1), param = word(arguments, 7) & (EE_RAM_SIZE - 1);
  int i = handle_of(h);
  char path[PATH];
  uint32_t result = 0;
  switch (number) {
  case 0x01: case 0x78: {
    // the card's kind, its free room and whether it's formatted, where the game asks, and whether it's the card of
    // the call before
    port = word(arguments, 1);
    uint8_t *info = ram + (word(arguments, 7) & (EE_RAM_SIZE - 1));
    if (port >= PORTS) { result = (uint32_t)-1; break; }
    if (word(arguments, 5)) set(info, 2);
    if (word(arguments, 4)) set(info + 4, 0x2000);
    if (word(arguments, 3)) set(info + 0x90, 1);
    result = known[port] ? 0 : (uint32_t)-1;
    known[port] = 1;
    break;
  }
  case 0x02: case 0x71:
    result = port >= PORTS ? (uint32_t)-1 : open(port, flags, name);
    break;
  case 0x03: case 0x72:
    if (i < 0) result = (uint32_t)-1;
    else {
      flushed(i);
      handles[h].entry = -1;
    }
    break;
  case 0x04:
    if (i < 0) { result = (uint32_t)-1; break; }
    {
      int64_t to = origin == 1 ? (int64_t)handles[h].at + (int32_t)offset : origin == 2 ? (int64_t)entries[i].size + (int32_t)offset : (int64_t)(int32_t)offset;
      if (to >= 0) handles[h].at = (uint32_t)to;
      result = handles[h].at;
    }
    break;
  case 0x05: case 0x73:
    if (word(arguments, 7)) {
      set(ram + param, 0);
      set(ram + param + 4, 0);
    }
    if (i < 0) { result = DENIED; break; }
    if (handles[h].at < entries[i].size) {
      result = entries[i].size - handles[h].at < size ? entries[i].size - handles[h].at : size;
      __builtin_memcpy(ram + buffer, entries[i].bytes + handles[h].at, result);
      handles[h].at += result;
    }
    break;
  case 0x06: case 0x74: case 0x1B: {
    if (i < 0) { result = DENIED; break; }
    // the bytes that came with the call, then the buffer's
    uint32_t first = number == 0x1B ? 0 : origin, total = first + size;
    if (total) {
      entry *e = &entries[i];
      room_for(e, handles[h].at + total);
      if (handles[h].at > e->size) __builtin_memset(e->bytes + e->size, 0, handles[h].at - e->size);
      __builtin_memcpy(e->bytes + handles[h].at, arguments + 32, first);
      __builtin_memcpy(e->bytes + handles[h].at + first, ram + buffer, size);
      handles[h].at += total;
      if (handles[h].at > e->size) e->size = handles[h].at;
      // Play! hands a write to the computer at once and a fast write, 0x1B, only when the file is next flushed or
      // closed, so that's when its time changes
      if (number == 0x1B) e->unflushed = 1;
      else {
        e->unflushed = 0;
        e->stamp = ps2_console_seconds();
      }
    }
    result = total;
    break;
  }
  case 0x0A: case 0x7A:
    if (i < 0) result = (uint32_t)-1;
    else flushed(i);
    break;
  case 0x0C: {
    if (port >= PORTS) { result = (uint32_t)-1; break; }
    if (word(arguments, 4)) {
      // the folder it was in, in 255 bytes with nothing after it
      __builtin_memset(ram + table, 0, 255);
      copy((char *)ram + table, current[port][0] ? current[port] : "/", 255);
    }
    char named[PATH], whole[PATH * 2];
    encoded(named, name, PATH);
    if (named[0] == '/') copy(whole, named[1] ? named : "", sizeof whole);
    else {
      copy(whole, current[port], sizeof whole);
      uint32_t n = length_of(whole);
      whole[n++] = '/';
      copy(whole + n, named, sizeof whole - n);
    }
    absolute(path, whole);
    if (is_folder(port, path)) copy(current[port], path, PATH);
    else result = NO_ENTRY;
    break;
  }
  case 0x0D: case 0x76: {
    if (port >= PORTS) { result = (uint32_t)-1; break; }
    int32_t most = (int32_t)word(arguments, 3);
    if (flags == 0) {
      found_count = found_at = 0;
      const char *base = name[0] != '/' ? current[port] : "";
      if (!is_folder(port, base)) { result = NO_ENTRY; break; }
      // the folder the filter is in has to be there
      char whole[PATH * 2], folder[PATH];
      copy(whole, base, sizeof whole);
      uint32_t n = length_of(whole);
      whole[n++] = '/';
      copy(whole + n, name, sizeof whole - n);
      n = length_of(whole);
      while (n && whole[n - 1] != '/') n--;
      whole[n] = 0;
      absolute(folder, whole);
      if (!is_folder(port, folder)) { result = NO_ENTRY; break; }
      // the filter from the top of the search: "./" as "/", a "/" first, and none last
      char filter[PATH];
      const char *asked = name[0] == '.' && name[1] == '/' ? name + 1 : name;
      n = 0;
      if (asked[0] != '/') filter[n++] = '/';
      copy(filter + n, asked, PATH - n);
      n = length_of(filter);
      if (n > 1 && filter[n - 1] == '/') filter[--n] = 0;
      // the folder itself and the one above it, when the filter takes them
      char own[PATH];
      copy(own, filter, PATH);
      n = length_of(own);
      while (n && own[n - 1] != '/') n--;
      own[n] = '.';
      own[n + 1] = 0;
      if (matches(filter, own)) found_named(".", 0, FOLDER_ATTRIBUTES, 0, 0);
      own[n + 1] = '.';
      own[n + 2] = 0;
      if (matches(filter, own)) found_named("..", 0, FOLDER_ATTRIBUTES, 0, 0);
      search_in(port, base, base, filter);
    }
    uint32_t left = found_count - found_at, count = (uint32_t)most < left ? (uint32_t)most : left;
    if (most > 0) __builtin_memcpy(ram + table, found[found_at], count * 64);
    found_at += count;
    result = count;
    break;
  }
  case 0x0E: case 0x7C:
    if (port >= PORTS) { result = (uint32_t)-1; break; }
    if (flags & 0x10) {
      // a new name for an entry, in the folder it's in; Play! takes both names as they come
      char to[PATH], parent[PATH];
      place(path, port, name);
      parent_of(parent, path);
      copy(to, parent, PATH);
      uint32_t n = length_of(to);
      to[n++] = '/';
      copy(to + n, (const char *)ram + table + 32, PATH - n);
      if (!same(path, to)) {
        int e = find(port, path), over = find(port, to);
        if (e < 0) { result = NO_ENTRY; break; }
        if (over >= 0) {
          // over a file, or a folder with nothing in it, of its own kind
          if (entries[over].folder != entries[e].folder || children(port, to)) { result = (uint32_t)-1; break; }
          entries[over].used = 0;
          for (int k = 0; k < HANDLES; k++) if (handles[k].entry == over) handles[k].entry = -1;
        }
        // what's in a folder goes with it, and all of it is new to the tools' emulator, which stamps it now
        uint32_t old = length_of(path), now = ps2_console_seconds();
        for (int k = 0; k < ENTRIES; k++) {
          if (!entries[k].used || entries[k].port != port || k == e) continue;
          if (__builtin_memcmp(entries[k].path, path, old) == 0 && entries[k].path[old] == '/') {
            char rest[PATH];
            copy(rest, entries[k].path + old, PATH);
            copy(entries[k].path, to, PATH);
            copy(entries[k].path + length_of(to), rest, PATH - length_of(to));
            entries[k].stamp = now;
          }
        }
        copy(entries[e].path, to, PATH);
        entries[e].stamp = now;
        touch_parent(port, to);
      }
    }
    break;
  case 0x0F: case 0x79: {
    if (port >= PORTS) { result = (uint32_t)-1; break; }
    place(path, port, name);
    int e = find(port, path);
    if (e < 0) result = path[0] ? NO_ENTRY : NOT_EMPTY;
    else if (entries[e].folder && children(port, path)) result = NOT_EMPTY;
    else {
      entries[e].used = 0;
      for (int k = 0; k < HANDLES; k++) if (handles[k].entry == e) handles[k].entry = -1;
      touch_parent(port, path);
    }
    break;
  }
  case 0x12: {
    if (port >= PORTS) { result = (uint32_t)-1; break; }
    char whole[PATH * 2] = "/";
    copy(whole + 1, name, sizeof whole - 1);
    absolute(path, whole);
    result = is_folder(port, path) ? 0xFE : NO_ENTRY;
    break;
  }
  case 0x14: break;
  case 0x15: result = 1; break;
  case 0xFE: case 0x70:
    set(returned, 0);
    if (returned_size >= 12) {
      set(returned + 4, 0x20A);
      set(returned + 8, 0x20E);
    }
    break;
  default:
    // a call Play! doesn't know is answered at once, with nothing
    return 1;
  }
  if (number != 0xFE && number != 0x70 && returned_size >= 4) set(returned, result);
  switch (number) {
  case 0x02: case 0x71: case 0x03: case 0x72: case 0x06: case 0x74: case 0x0A: case 0x7A: case 0x0E: case 0x7C: case 0x0F: case 0x79: case 0x1B:
    changed();
    break;
  }
  // every answer waits a while
  waiting = 1;
  delay = DELAY;
  return 0;
}

void mc_ticks(uint32_t ticks) {
  if (!waiting) return;
  delay -= delay < ticks ? delay : ticks;
  if (delay == 0) {
    waiting = 0;
    sif_call_reply(SERVER, 0);
  }
}
