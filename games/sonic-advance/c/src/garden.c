// Tiny Chao Garden: the program Sonic Advance unpacks from its copy into the console's work RAM and soft resets into
// (LoadTinyChaoGarden, SAT-R's src/game/sa1/menus/title_screen.c). SAT-R's chao_garden/ decompiles Sonic Advance 2's
// build of the same program, much of it in assembly only. Sonic Advance's own build is another, with its code in other
// places and some of it changed, so this is written from its instructions, read with the decompilation beside them.
// Each function names the place its original starts in Sonic Advance's build (0x02xxxxxx), and the decompilation's
// name for it where there is one.
//
// What's here: A on Tiny Chao Garden in the main menu, the program unpacked and started, with its save, its own sound
// engine and the garden's tiles, maps and colours; then the garden left alone: its fade in from white, the field, the
// pond and the trees, the panel with the Chao's bars and the ring count from the save, the two icons, the hand and the
// egg as it waits, with the garden's music. The egg hatching (#1311), the hand moving and what it picks (#1312), the
// icons' screens (#1313), the pause and going back to Sonic Advance (#1314) and the link cable aren't in C yet: a press
// or a moment that needs one stops the garden where it is, with the screen as it was.

#include "sa.h"

// the program in the copy, LZ77, and its size unpacked at the start of the work RAM
#define PROGRAM_AT 0x9BE78u
#define PROGRAM_SIZE 0x21E00u
#define RAM 0x02000000u
// where the program unpacks some of its pictures to work on them (InitGarden's WORK_RAM), and how much it needs
#define WORK_RAM 0x0203F800u
#define WORK_SIZE 0x800u

// what the frames since the menu's A hold: the program unpacking, then its start (GameInit), its sound engine starting
// (m4aSoundInit), InitGarden, which takes until its song starts, and the garden's first frame; mGBA's frames 1730,
// 1745, 1752, 1753, 1758 and 1759 of the recording
enum { UNPACKED = 14, SOUND_INIT = 21, INIT_GARDEN = 22, SONG_STARTS = 27, FIRST_FRAME = 28 };

// the garden's sound mode (m4aSoundInit's 0x0093F400) and its music players' table
#define PLAYER_TABLE 0x020129DCu
#define MUS_GARDEN 1

static uint8_t *prog;     // the program as the work RAM holds it
static uint8_t *work;     // WORK_RAM
static const uint8_t *at(uint32_t address) { return prog + (address - RAM); }
static uint32_t p8(uint32_t address) { return *at(address); }
static uint32_t p16(uint32_t address) { return le16(at(address), 0); }
static uint32_t p32(uint32_t address) { return le32(at(address), 0); }

// ---- the video hardware, as the program writes it ----

static void vram16(uint32_t offset, uint16_t v) {
  if (offset + 1 < sizeof gba_vram) { gba_vram[offset] = (uint8_t)v; gba_vram[offset + 1] = (uint8_t)(v >> 8); }
}
static uint32_t vram32(uint32_t offset) { return le32(gba_vram, (int)offset); }
static void set_vram32(uint32_t offset, uint32_t v) { set_le32(gba_vram, (int)offset, v); }
#define VRAM_OF(address) ((address) - 0x06000000u)

// the BIOS's LZ77UnCompVram from the program into VRAM
static void unpack_vram(uint32_t from, uint32_t vramAddress) {
  gba_lz77_vram(at(from), PROGRAM_SIZE - (from - RAM), VRAM_OF(vramAddress));
}

// 0x020011CC (sub_0200163c): a list of display registers and their values, written at once
static void write_registers(uint32_t list, int count) {
  for (int i = 0; i < count; i++) gba_write(p16(list + i * 4), (uint16_t)p16(list + i * 4 + 2));
}

// ---- the garden's state (gUnknown_03003330) and its buttons (gInput) ----

static struct {
  void (*main)(void);   // what each frame runs
  uint32_t frames;      // frames since the garden started
  uint16_t fade;
  uint8_t flags;        // 1 while it fades in, 0x80 while paused, and the rest for the screens over the garden
  uint8_t language;     // 0 Japanese, else English (Sonic Advance's language other than 0)
} g;

static struct { uint16_t held, raw, pressed, repeated; uint8_t timer, first, next; } input;

/** InputInit, 0x02000B2C. */
static void input_init(void) {
  input.held = input.pressed = input.repeated = 0;
  input.raw = 0xFFFF;
  input.timer = input.first = 15;
  input.next = 7;
}

/** GetInput, 0x02000B50: what's held, what's newly pressed, and what repeats, first after 15 frames then every 7. A, B,
 *  Start and Select together, which go back to Sonic Advance, aren't in C yet (#1314). */
static int read_input(uint16_t keys) {
  uint16_t prevHeld = input.held, prevRaw = input.raw;
  input.raw = (uint16_t)((~keys & 0x3FF) | 0xFC00);
  input.held = (uint16_t)~input.raw;
  if (!(g.flags & 0x40) && (input.held & 0xF) == 0xF) return 0;
  input.pressed = input.held & prevRaw;
  if (!input.held) input.repeated = 0;
  else if (input.held > prevHeld) {
    input.repeated = prevHeld ^ input.held;
    input.timer = input.first;
  } else if (--input.timer == 0) {
    input.repeated = input.held;
    input.timer = input.next;
  } else input.repeated = 0;
  return 1;
}

// ---- random numbers ----

static uint32_t seed;   // gRandomSeed
/** 0x02001114 (sub_02001534): the next random number, 0 to 32767. */
static int random15(void) {
  seed = seed * 0x41C64E6Du + 0x3039;
  return (int)((seed << 1) >> 17);
}
/** 0x02001134 (sub_02001554): a random number from 0 to n - 1. */
static int random_below(int n) { return random15() % n; }

// ---- the save (gSaveGameState) ----

#define SAVE_BYTES 0x858
#define FIRST_SECTOR 10
#define SECTORS 6
#define SECTOR_SIZE 0x1000
#define SAVE_MARK 0x0817   // Sonic Advance 2's build marks its saves 0x1965
static uint8_t tcgSave[SAVE_BYTES];
#define SAVE_RINGS_SEEN 0x08   // Sonic Advance's ring bank as the garden last saw it
#define SAVE_RINGS 0x0C
#define SAVE_TIMER 0x10
#define SAVE_SEED 0x18
#define SAVE_EGG_X 0x1F
#define SAVE_EGG_Y 0x20
#define SAVE_CHAO 0x58        // the Chao's kind, or 0xFF with none
#define SAVE_EGG 0x59         // the egg's kind, or 0xFF with none
#define SAVE_RINGS_SHOWN 0x64 // the ring count, its bytes the other way round
static uint32_t save32(int offset) { return le32(tcgSave, offset); }
static void set_save32(int offset, uint32_t v) { set_le32(tcgSave, offset, v); }

static int saveSector;
static uint32_t saveVersion;
static uint32_t rings;   // gUnknown_03005274: the rings the garden has

/** 0x0200148C (sub_0200185c): the save's CRC-16, from the program's table. */
static uint16_t save_crc(const uint8_t *bytes, int count) {
  uint32_t crc = 0xFFFF;
  while (count-- > 0) crc = p16(0x02018374u + ((crc ^ *bytes++) & 0xFF) * 2) ^ (crc >> 8);
  return (uint16_t)~crc;
}

/** 0x02001CB0 (sub_02008810): one to one and a half minutes, in frames. */
static uint32_t egg_minutes(void) { return (uint32_t)(random_below(30) + 60) * 60; }

/** InitGameState, 0x02000368: no Chao and no egg, nothing bought, and the next egg's wait. */
static void new_game_state(void) {
  memset(tcgSave + 0x08, 0, 0x50);
  memset(tcgSave + 0x58, 0xFF, 0x12);
  set_save32(SAVE_TIMER, egg_minutes());
  tcgSave[0x1C] = 0xFF;
}

// the cartridge's flash sector `n`, or NULL when the save memory doesn't keep it: the kit keeps Sonic Advance's own save
// only, so the garden's sectors read as flash that was never written
static const uint8_t *flash_sector(int n) {
  (void)n;
  return NULL;
}
static void read_sector(int n) {
  const uint8_t *s = flash_sector(n);
  if (s) memcpy(tcgSave, s, SAVE_BYTES);
  else memset(tcgSave, 0xFF, SAVE_BYTES);
}

/** LoadGameState, 0x02000204: the newest of the save's six sectors whose mark and CRC are right, or else a new garden with
 *  an egg in the middle of the field; then the rings Sonic Advance has banked since the garden last saw them added. */
static void load_game_state(uint32_t bankedRings) {
  int found = -1;
  uint32_t newest = 0;
  for (int i = 0; i < SECTORS; i++) {
    read_sector(FIRST_SECTOR + i);
    if (le16(tcgSave, 2) != SAVE_MARK || save_crc(tcgSave + 2, SAVE_BYTES - 2) != le16(tcgSave, 0)) continue;
    if (found < 0 || save32(4) > newest) { found = i; newest = save32(4); }
  }
  if (found < 0) {
    saveSector = SECTORS;
    saveVersion = 0;
    new_game_state();
    tcgSave[SAVE_EGG] = 0;
    tcgSave[SAVE_EGG_X] = 0x58;
    tcgSave[SAVE_EGG_Y] = 0x68;
  } else {
    saveSector = found;
    saveVersion = newest;
    read_sector(FIRST_SECTOR + found);
    seed = save32(SAVE_SEED);
  }
  if (save32(SAVE_RINGS_SEEN) >= bankedRings) rings = save32(SAVE_RINGS);
  else {
    rings = save32(SAVE_RINGS) + (bankedRings - save32(SAVE_RINGS_SEEN));
    if (rings > 99999) rings = 99999;
    set_save32(SAVE_RINGS_SEEN, bankedRings);
  }
  set_save32(SAVE_RINGS_SHOWN, __builtin_bswap32(rings));
  tcgSave[0x68] = 0;
}

// ---- the objects (gUnknown_03004400): a list run in order every frame ----

typedef struct Obj Obj;
typedef void (*ObjFn)(Obj *);
struct Obj {
  ObjFn main;
  uint8_t id, prev, next, changed;   // its place, the ones before and after it, and what it last drew
  uint16_t timer;
  int16_t x;
  uint16_t unusedC;
  int16_t y;
  uint32_t parts;                    // its sprite: the parts of its frame, an address in the program
  uint16_t tile;                     // added to each part's tile
  uint8_t attr0, attr1, attr2;       // or'd into each part's attributes' top bytes
  uint8_t state, arg, unused1B;
  int8_t matrix;                     // its rotation's matrix, or -1
  uint8_t sortY;
  uint8_t extra[2];
  uint16_t value[2];                 // 0x20, a 32-bit count for some, two halfwords for others
};
#define OBJECTS 72
#define FREE_OBJECTS 70
static Obj objs[OBJECTS];
static uint8_t freeIds[FREE_OBJECTS], liveCount, nextFree, nextReturn;
static uint32_t obj_value(const Obj *o) { return o->value[0] | (uint32_t)o->value[1] << 16; }
static void set_obj_value(Obj *o, uint32_t v) { o->value[0] = (uint16_t)v; o->value[1] = (uint16_t)(v >> 16); }

static void layers_clear(Obj *o);
static void nothing(Obj *o) { (void)o; }

/** 0x02000BEC (sub_02000c90): the list holds its first object, which starts each frame's layers, and its last, which does
 *  nothing; the sprites, the sprite order and the frees start again. */
static void sprites_init(void);
static void objects_init(void) {
  sprites_init();
  objs[0] = (Obj){ .main = layers_clear, .id = 0, .prev = 0, .next = 1 };
  objs[1] = (Obj){ .main = nothing, .id = 1, .prev = 0, .next = 0 };
  for (int i = 0; i < FREE_OBJECTS; i++) freeIds[i] = (uint8_t)(i + 2);
  liveCount = nextFree = nextReturn = 0;
}

/** 0x02000C8C (sub_02000d04): a new object running `fn`, just before `beside` or just after it. */
static Obj *create(ObjFn fn, Obj *beside, int before) {
  if (liveCount > 69) return NULL;
  uint8_t id = freeIds[nextFree++];
  if (nextFree > 69) nextFree = 0;
  Obj *o = &objs[id];
  o->main = fn;
  o->id = id;
  if (before) {
    o->prev = beside->prev;
    o->next = beside->id;
    objs[beside->prev].next = id;
    beside->prev = id;
  } else {
    o->prev = beside->id;
    o->next = beside->next;
    objs[beside->next].prev = id;
    beside->next = id;
  }
  o->state = o->attr2 = o->attr1 = o->attr0 = 0;
  o->unusedC = 0;
  o->timer = 0;
  o->changed = 0;
  o->matrix = -1;
  liveCount++;
  return o;
}

/** 0x02000D38 (sub_02000ed4): an object leaves the list, and its place is free again. */
static void destroy(Obj *o) {
  objs[o->prev].next = o->next;
  objs[o->next].prev = o->prev;
  freeIds[nextReturn++] = o->id;
  if (nextReturn > 69) nextReturn = 0;
  liveCount--;
}

/** 0x02000C60 (sub_02000eac): every object in the list's order, each once. */
static void run_objects(void) {
  uint8_t i = 0;
  do {
    objs[i].main(&objs[i]);
    i = objs[i].next;
  } while (i != 0);
}

// ---- the sprites: four layers of objects, drawn in order, and the third sorted by height ----

#define LINKS 74
static uint8_t layerLast[4], links[LINKS][2], linkCount;   // each link: the next, and its object
static uint16_t oamBuffer[128][4];
static uint8_t matrices[32], matrixCount, matrixNext, matrixReturn;
#define SORT_MAX 0xA2
static uint8_t sortList[SORT_MAX][2], sortCount, sortBuckets[SORT_MAX], sorted[SORT_MAX];
static uint8_t sortedLast;   // gUnknown_03005270

/** 0x02000D94 (sub_020013DC), the first object: each frame's four layers start empty. */
static void layers_clear(Obj *o) {
  (void)o;
  int i;
  for (i = 0; i < 4; i++) { layerLast[i] = (uint8_t)i; links[i][0] = 0; }
  linkCount = (uint8_t)i;
  for (; i < LINKS; i++) links[i][0] = 0;
}

/** 0x02000DD8 (sub_02001254): an object's sprite at the end of a layer. */
static void layer_add(uint8_t id, int layer) {
  links[layerLast[layer]][0] = linkCount;
  links[linkCount][1] = id;
  layerLast[layer] = linkCount++;
}

/** 0x02000E14 (sub_02001290): every sprite hidden, and the 32 rotation matrices free. */
static void sprites_init(void) {
  for (int i = 0; i < 128; i++) oamBuffer[i][0] = 0x200;
  for (int i = 0; i < 32; i++) matrices[i] = (uint8_t)(i * 2);
  matrixCount = matrixNext = matrixReturn = 0;
}

/** 0x02000E64 (sub_02001088): the layers' sprites, each its frame's parts, into the sprites the next frame shows, and
 *  the rest hidden. */
static void build_sprites(void) {
  int entry = 0, left = 0x80;
  for (int layer = 0; layer < 4; layer++) {
    for (uint8_t link = links[layer][0]; link; link = links[link][0]) {
      const Obj *o = &objs[links[link][1]];
      for (uint32_t part = o->parts;; part += 8) {
        uint16_t *s = oamBuffer[entry];
        s[0] = (uint16_t)((p8(part + 2) | o->attr0) << 8 | (((int8_t)p8(part + 6) + o->y) & 0xFF));
        s[1] = (uint16_t)((p8(part + 3) | o->attr1) << 8 | (((int8_t)p8(part + 5) + o->x) & 0x1FF));
        s[2] = (uint16_t)((p8(part + 4) | o->attr2) << 8 | (uint16_t)(o->tile + p16(part)));
        if (--left == 0) return;
        entry++;
        if (!p8(part + 7)) break;
      }
    }
  }
  for (; left > 0; left--) oamBuffer[entry++][0] = 0x200;
}

/** 0x02000F58 (sub_020012e0): the sprites built last frame, to OAM. */
static void show_sprites(void) { memcpy(gba_oam, oamBuffer, sizeof oamBuffer); }

/** 0x02000FEC (sub_02001374): the sort by height starts empty each frame. */
static void sort_clear(void) {
  memset(sortBuckets, 0, sizeof sortBuckets);
  sortCount = 0;
}

/** 0x0200100C (sub_02001398): an object to sort, by the line it stands on: below the screen counts as its last line, and
 *  far below as its first. */
static void sort_add(uint8_t id, uint8_t y) {
  if (y > SCREEN_H + 48) y = 0;
  else if (y > SCREEN_H + 1) y = SCREEN_H + 1;
  sortList[sortCount][0] = y;
  sortList[sortCount++][1] = id;
}

/** 0x02001050 (sub_0200117c): those to sort, by height, to the end of the fourth layer, the lowest first. */
static void sort_sprites(void) {
  sortedLast = sortCount;
  if (!sortCount) return;
  for (int i = 0; i < sortCount; i++) sortBuckets[sortList[i][0]]++;
  for (int i = 0; i <= SCREEN_H; i++) sortBuckets[i + 1] = (uint8_t)(sortBuckets[i + 1] + sortBuckets[i]);
  for (int i = sortCount - 1; i >= 0; i--) sorted[--sortBuckets[sortList[i][0]]] = sortList[i][1];
  for (int i = sortCount - 1; i >= 0; i--) layer_add(sorted[i], 3);
}

// ---- what the next frame writes: display registers, and stretches of the background maps ----

static uint16_t regQueue[8][2];
static uint8_t regCount;
/** 0x0200122C (sub_02001698): a display register to write at the next frame's start. */
static int queue_register(uint16_t reg, uint16_t value) {
  if (regCount > 7) return 0;
  regQueue[regCount][0] = reg;
  regQueue[regCount++][1] = value;
  return 1;
}
/** 0x0200120C (sub_0200167c): the queue emptied, then one register. */
static void queue_only_register(uint16_t reg, uint16_t value) {
  regCount = 0;
  queue_register(reg, value);
}
/** 0x0200126C (sub_020016d8): the queue, last first. */
static void write_queued_registers(void) {
  while (regCount) {
    regCount--;
    gba_write(regQueue[regCount][0], regQueue[regCount][1]);
  }
}

// a stretch of a map: `width` × `height` entries from `from`, each with `add` added, or, from nowhere, `add` itself in
// each; a width of 0xFF fills the whole 0x800 bytes from `to`
typedef struct { const uint8_t *from; uint32_t to; uint8_t width, height; uint16_t add; } MapCopy;
static MapCopy mapQueue[24];
static uint8_t mapCount;
/** 0x02001338 (sub_020017a4). */
static void map_queue_clear(void) { mapCount = 0; }
/** 0x02001344 (sub_020017b0): a stretch of a map to write at the next frame's start. */
static int queue_map(const uint8_t *from, uint32_t to, int width, int height, uint16_t add) {
  if (mapCount > 0x17) return 0;
  mapQueue[mapCount++] = (MapCopy){ from, to, (uint8_t)width, (uint8_t)height, add };
  return 1;
}
static const uint8_t *from_program(uint32_t address) { return at(address); }

/** 0x020012AC (sub_02001718): `height` rows of `width` entries from `from`, each plus `add`, the map's rows 64 bytes
 *  apart. */
static void copy_map(const uint8_t *from, uint32_t to, int width, int height, uint16_t add) {
  for (; height > 0; height--, to += 64)
    for (int j = 0; j < width; j++, from += 2) vram16(to + j * 2, (uint16_t)(add + le16(from, 0)));
}
/** 0x020012F4 (sub_02001760): the same, all one entry. */
static void fill_map(uint32_t to, int width, int height, uint16_t entry) {
  for (; height > 0; height--, to += 64)
    for (int j = 0; j < width; j++) vram16(to + j * 2, entry);
}

/** 0x020013C0 (sub_02001420): the queued stretches, last first. */
static void write_queued_maps(void) {
  while (mapCount) {
    MapCopy *m = &mapQueue[--mapCount];
    if (m->from) copy_map(m->from, m->to, m->width, m->height, m->add);
    else if (m->width != 0xFF) fill_map(m->to, m->width, m->height, m->add);
    // CpuFastSet's fill of words, each the entry and a zero
    else for (uint32_t i = 0; i < 0x800; i += 4) set_vram32(m->to + i, m->add);
  }
}

// ---- numbers ----

/** 0x02001154 (sub_02001588): `n` digits of `value` into `digits`, the first ones 0; returns how many of those there are. */
static int to_digits(uint32_t value, uint8_t *digits, int n) {
  uint8_t *d = digits + n;
  int left = n;
  while (left > 0) {
    if ((int32_t)value <= 9) { *--d = (uint8_t)value; break; }
    *--d = (uint8_t)(value % 10);
    value /= 10;
    left--;
  }
  int zeros = 0;
  for (; left > 1; left--, zeros++) *--d = 0;
  return zeros;
}
/** 0x02001198 (sub_020015cc): the same, with `add` added to every digit after the first zeros. */
static void to_digits_plus(uint32_t value, uint8_t *digits, int n, int add) {
  int zeros = to_digits(value, digits, n);
  for (int i = zeros; i < n; i++) digits[i] = (uint8_t)(digits[i] + add);
}

// ---- the colours a frame changes ----

static struct { uint8_t chao, chaoKind, chaoDone, unused3, egg, eggKind, eggDone, unused7; } paletteAsk;
static uint16_t chaoColours[16];   // a Chao's own colours, for kinds past the program's 14 (#1311)

// ---- the garden's objects ----

static Obj *chaoObj, *handObj;   // gUnknown_03001510, gUnknown_0300150C
static uint8_t chaoCount;        // gUnknown_0300159B
static uint8_t gardenObjects;    // gUnknown_0300159A
static uint8_t chaoKind;         // gUnknown_0300152F
static uint8_t chaoShown;        // gUnknown_0300152E
static uint8_t gardenState;      // gUnknown_0300152D
static uint8_t heldFruit;        // gUnknown_03001530
static uint8_t pauseState;       // gUnknown_03001509
static uint16_t dispCnt;         // gUnknown_0300152A
static uint8_t linkWaiting;      // 0x030009BC
static uint8_t menuEdge;         // 0x030009B8

static int stopped;
/** A moment that isn't in C yet: the garden stops there, its screen as it was. */
static void not_in_c(void) { stopped = 1; }

/** 0x02001CCC (sub_020088b0): the garden fades in from white over `arg` frames, then the rest of it can move. */
static void fade_in(Obj *o) {
  o->arg--;
  queue_register(REG_BLDY, o->arg);
  queue_register(REG_BLDALPHA, (uint16_t)(((16 - o->arg) & 0xFE) << 7 | o->arg));
  if (o->arg == 0) {
    destroy(o);
    g.flags &= 0xFE;
  }
}

/** 0x02001D5C (sub_0200218c): Start pauses the garden, once nothing else is over it; the pause isn't in C yet (#1314). */
static void pause_watch(Obj *o) {
  if (g.flags & 0x7F) return;
  if ((o->state == 0 || --o->state == 0) && (input.pressed & KEY_START)) {
    not_in_c();
    return;
  }
  g.flags &= 0x7F;
}

/** 0x02002F88 (sub_02003424): with fewer than 16 Chao, the wait for a new egg counts down while nothing is over the
 *  garden; the egg it brings isn't in C yet. */
static void egg_clock(Obj *o) {
  (void)o;
  if (g.flags & 0xF3 || chaoCount > 15) return;
  uint32_t left = save32(SAVE_TIMER) - 1;
  set_save32(SAVE_TIMER, left);
  if (left == 0) not_in_c();
}

// the panel's seven bars (0x030009E8): its value, a blink, its level, whether to draw it, and what it last drew
static struct { uint16_t value; uint8_t blink, level, dirty, drawn, unused6, unused7; } bars[7];

/** 0x020028C8: a bar of the panel drawn when its level changed: Mood and Belly in twentieths, the rest in tenths with the
 *  number by them, which blinks. Returns whether it grew. */
static int draw_bar(int i) {
  int grew = 0;
  if (i <= 1) {
    int level = (bars[i].level + 10) / 20;
    if (level != bars[i].drawn) {
      queue_map(from_program(0x02018574u + level * 14), 0x0F142u + i * 128, 7, 1, 0x211A);
      if (level > bars[i].drawn) grew = 1;
      bars[i].drawn = (uint8_t)level;
    }
    return grew;
  }
  if (bars[i].dirty) {
    bars[i].dirty = 0;
    int level = (bars[i].level + 9) / 10;
    if (level != bars[i].drawn) {
      queue_map(from_program(0x02018574u + level * 14), 0x0F142u + i * 128, 7, 1, 0x111A);
      if (level > bars[i].drawn) grew = 1;
      bars[i].drawn = (uint8_t)level;
    }
  }
  if (bars[i].blink) {
    bars[i].blink--;
    if (bars[i].blink & 8) queue_map(NULL, 0x0F10Eu + i * 128, 1, 1, 0xE1);
    else queue_map((const uint8_t *)&bars[i].value, 0x0F10Eu + i * 128, 1, 1, 0x7C);
  }
  return grew;
}

static uint16_t ringDigits[5];   // 0x03000A20

static void panel(Obj *o);
/** 0x02002464 (sub_020089B0): the panel: its ring turns every 6 frames, and its count is drawn on the first. */
static void panel_start(Obj *o) {
  o->changed = 0x80;
  set_obj_value(o, rings + 1);
  o->state = 6;
  o->arg = 1;
  o->main = panel;
}

/** 0x02002488: the ring turning, the count going to the rings the garden has, by the biggest steps that fit, and, when
 *  the Chao changes, its name and bars drawn again. Only the garden with no Chao is in C (#1311). */
static void panel(Obj *o) {
  if (--o->arg == 0) {
    o->arg = 6;
    if (++o->state > 5) o->state = 0;
    queue_map(from_program(0x0201860Eu + o->state * 8), 0x0F482u, 2, 2, 0x712A);
  }
  int32_t diff = (int32_t)(rings - obj_value(o));
  if (diff != 0) {
    set_save32(SAVE_RINGS_SHOWN, __builtin_bswap32(rings));
    int up = diff > 0;
    if (!up) diff = -diff;
    for (int k = 0; k < 5; k++) {
      uint32_t step = p16(0x02018D20u + k * 4 + 2);
      if (diff >= (int32_t)p16(0x02018D20u + k * 4)) {
        diff -= (int32_t)step;
        set_obj_value(o, up ? obj_value(o) + step : obj_value(o) - step);
      }
    }
    uint8_t digits[5];
    to_digits_plus(obj_value(o), digits, 5, 1);
    for (int k = 0; k < 5; k++) ringDigits[k] = digits[k] ? (uint16_t)(0x2141 + digits[k]) : 0xE1;
    if (ringDigits[0] == 0xE1) ringDigits[0] += 0x20;
    queue_map((const uint8_t *)ringDigits, 0x0F4C6u, 5, 1, 0);
  }
  if (chaoKind == o->changed) {
    if (chaoKind == 0xFF) return;
    not_in_c();
    return;
  }
  o->changed = chaoKind;
  if (chaoKind != 0xFF) {
    not_in_c();
    return;
  }
  // no Chao: no name, and every bar empty
  queue_map(NULL, 0x0F042u, 7, 2, 0xE1);
  for (int i = 0; i < 7; i++) {
    bars[i].level = 0;
    bars[i].value = 0;
    bars[i].dirty = 1;
    bars[i].blink = 1;
    bars[i].drawn = 0xFF;
    draw_bar(i);
  }
}

static void link_icon(Obj *o);
/** 0x020029EC (sub_020089D4): the cable's sign, above the screen until another console joins (not in C). */
static void link_icon_start(Obj *o) {
  o->x = 0x58;
  o->y = -48;
  o->parts = 0x02018C7Cu;
  o->tile = 0x14B;
  o->attr2 = 0x0C;
  o->extra[1] = o->extra[0] = 0;
  o->main = link_icon;
}
/** 0x02002A1C: the cable's state, which has no other console on it, so the sign stays out of sight. */
static void link_icon(Obj *o) {
  (void)o;
  linkWaiting = 0;
}

static void hand(Obj *o);
/** 0x0200329C (sub_02008A04): the hand, over the field. */
static void hand_start(Obj *o) {
  o->x = 0x5F;
  o->y = 0x3A;
  o->parts = 0x02018BACu;
  o->tile = 0xAC;
  o->value[1] = 0x180;
  o->value[0] = 0x10F;
  o->main = hand;
}
/** 0x020032C4: the hand drawn in the second layer; its moves, and A, aren't in C yet (#1312). */
static void hand(Obj *o) {
  if (g.flags & 0x50) { not_in_c(); return; }
  if (g.flags & 0x20) { not_in_c(); return; }
  if (pauseState) { not_in_c(); return; }
  o->attr2 = 0x14;
  layer_add(o->id, 1);
  if (g.flags & 0x83) return;
  if (input.held & 0xF0) { not_in_c(); return; }
  o->value[1] = 0x180;
  o->value[0] = 0x10F;
  if (o->changed) { not_in_c(); return; }
  if (input.pressed & KEY_A) not_in_c();
}

static void egg(Obj *o);
/** 0x02003980 (sub_02003e04): the egg, where the save left it, moved up out of the pond a row at a time, with its kind's
 *  colours; it hatches 1,800 frames after the garden can move. */
static void egg_start(Obj *o) {
  o->x = tcgSave[SAVE_EGG_X];
  if (tcgSave[SAVE_EGG_Y] > 0x9F) tcgSave[SAVE_EGG_Y] = 0x9F;
  o->sortY = tcgSave[SAVE_EGG_Y];
  o->y = o->sortY;
  o->parts = 0x02018B9Cu;
  o->tile = o->arg ? 0xDC : 0xD8;
  o->attr2 = 0xEC;
  o->matrix = 1;
  uint16_t cell = (uint16_t)((o->y >> 3) * 22 + (o->x >> 3));
  while (p8(0x02019D50u + cell)) {
    cell = (uint16_t)(cell - 22);
    o->y -= 8;
  }
  o->sortY = (uint8_t)o->y;
  tcgSave[SAVE_EGG_Y] = (uint8_t)o->y;
  o->state = 0;
  o->timer = 1800;
  paletteAsk.eggKind = o->arg;
  paletteAsk.egg = 1;
  o->main = egg;
  egg(o);
}
/** 0x02003A30: the egg waits, counting while nothing is over the garden, and drawn by its height. With no egg in the
 *  save it goes (not in C), and its hatching isn't in C yet (#1311). */
static void egg(Obj *o) {
  if (g.flags & 0x10) return;
  if (tcgSave[SAVE_EGG] == 0xFF) { not_in_c(); return; }
  if (o->state > 2 && o->timer > 60) o->timer = 60;
  if (!(g.flags & 0xE3)) {
    if (!chaoKind || !tcgSave[SAVE_CHAO]) {
      o->state = 0;
      o->timer = 1800;
    } else if (--o->timer == 0) {
      not_in_c();
      return;
    }
  }
  sort_add(o->id, o->sortY);
}

/** 0x02003D5C (sub_020041E0): the Chao; with none, nothing is shown for it. */
static void chao(Obj *o) {
  (void)o;
  if (tcgSave[SAVE_CHAO] != 0xFF) { not_in_c(); return; }
  chaoShown = 0;
}

static void icon(Obj *o);
/** 0x02005FEC (sub_020074c0): one of the two icons at the top, the second (arg 1) left of the first. */
static void icon_start(Obj *o) {
  o->sortY = 0x13;
  o->y = 0x13;
  o->parts = 0x02018BECu;
  o->tile = 0x10D;
  if (o->arg) { o->x = 0x7C; o->attr2 = 0xCC; }
  else { o->x = 0x9C; o->attr2 = 0xBC; }
  o->matrix = 4;
  o->main = icon;
}
/** 0x0200602C: drawn by its height, unless a screen is over the garden. */
static void icon(Obj *o) {
  if (!(g.flags & 0x10)) sort_add(o->id, o->sortY);
}

// the shop's 22 goods (0x03000A60), each the five parts of its price's sprite, made from the program's template
static uint8_t goods[22][40];

static void shop(Obj *o);
/** 0x0200604C (sub_02007500): the shop's prices, as sprites of their digits, and its sign, out of sight left of the
 *  screen until L. */
static void shop_start(Obj *o) {
  static const struct { int first, last; uint32_t prices; } KINDS[] = {
    { 0, 6, 0x0200E90Cu }, { 7, 18, 0x0200E928u }, { 19, 21, 0x0200E958u },
  };
  for (int i = 0; i < 22; i++) memcpy(goods[i], at(0x02018C54u), 40);
  for (int k = 0; k < 3; k++) {
    for (int i = KINDS[k].first; i <= KINDS[k].last; i++) {
      uint8_t digits[5];
      to_digits_plus(p32(KINDS[k].prices + (uint32_t)(i - KINDS[k].first) * 4), digits, 5, 1);
      for (int d = 4; d >= 0; d--) {
        uint8_t *part = goods[i] + (4 - d) * 8;
        if (digits[d]) set_le16(part, 0, digits[d] - 1u);
        else goods[i][(3 - d) * 8 + 7] = 0;
      }
    }
  }
  o->x = -48;
  o->y = 0x50;
  o->parts = 0x02018BF4u;
  o->tile = 0x115;
  o->attr2 = 0xFC;
  o->extra[0] = 0;
  o->main = shop;
}
/** 0x020061D4: L opens the shop, which isn't in C yet (#1313). */
static void shop(Obj *o) {
  if (g.flags & 0x10) { not_in_c(); return; }
  if (save32(0x14)) { not_in_c(); return; }
  if (g.flags & 0x80) { not_in_c(); return; }
  if (o->extra[0]) { not_in_c(); return; }
  if (o->x > -48) { not_in_c(); return; }
  if (input.pressed & KEY_L) { not_in_c(); return; }
  menuEdge = (uint8_t)(o->x + 0x3B);
}

/** 0x020014F8, InitGarden: the garden's tiles, maps and colours, the panel's words in the game's language, and its
 *  objects; its music, and the fade in from white. */
static void garden_frame(void);
static void garden_pictures(void);
static void init_garden(void) {
  garden_pictures();
  map_queue_clear();
  for (uint32_t i = 0; i < 0x2000; i += 4) set_vram32(0xE000 + i, 0);
  gba_lz77(at(0x0201C434u), PROGRAM_SIZE - (0x0201C434u - RAM), work, WORK_SIZE);
  copy_map(work + (g.language ? 0x168 : 0), 0xF000, 9, 20, 0xE0);
  copy_map(from_program(0x020199E0u), 0xF800, 22, 20, 0x200);
  paletteAsk.eggDone = paletteAsk.chaoDone = paletteAsk.egg = paletteAsk.chao = 0;
  objects_init();
  create(egg_clock, &objs[1], 1);
  chaoCount = 0;
  for (int i = 0; i < 16; i++) if (tcgSave[0x37 + i * 2]) { not_in_c(); return; }
  chaoKind = tcgSave[SAVE_CHAO];
  create(icon_start, &objs[0], 0)->arg = 1;
  create(icon_start, &objs[0], 0)->arg = 0;
  gardenState = 0;
  chaoObj = create(chao, &objs[0], 0);
  create(panel_start, &objs[0], 0);
  for (int i = 0; i < 3; i++) if (tcgSave[0x31 + i * 2]) { not_in_c(); return; }
  gardenObjects = 0;
  for (int i = 0; i < 8; i++) if (tcgSave[0x5A + i] != 0xFF) { not_in_c(); return; }
  heldFruit = 0xFF;
  if (tcgSave[SAVE_EGG] != 0xFF) create(egg_start, &objs[0], 0)->arg = tcgSave[SAVE_EGG];
  create(shop_start, &objs[0], 0);
  handObj = create(hand_start, &objs[0], 0);
  create(pause_watch, &objs[0], 0);
  create(link_icon_start, &objs[0], 0);
  create(fade_in, &objs[0], 0)->arg = 16;
  pauseState = 0;
  dispCnt = 0x1F40;
  queue_only_register(REG_DISPCNT, dispCnt);
  g.flags = 1;
  g.main = garden_frame;
}

/** 0x02001864 (sub_02001c60): the display registers, the colours and the tiles: the field's, the panel's and its
 *  digits, each laid over a copy of the bar's tile, and the sprites'. */
static void garden_pictures(void) {
  write_registers(0x02018CD4u, 13);
  write_registers(0x02018D08u, 3);
  for (uint32_t i = 0; i < 64; i += 4) set_vram32(i, 0);
  for (int i = 0; i < 256; i++) gba_pal[i] = (uint16_t)p16(0x0201B218u + i * 2);
  unpack_vram(0x0201B418u, 0x06001C00u);
  unpack_vram(0x0201AA60u, 0x060041E0u);
  unpack_vram(0x02019F08u, 0x060055E0u);
  unpack_vram(0x02018FE4u, 0x06008000u);
  uint32_t to = 0xF80;
  for (int i = 0; i < 10; i++) {
    memmove(gba_vram + 0xF80 + i * 0x140, gba_vram + 0x2980, 0x140);
    for (int t = 0; t < 10; t++)
      for (int w = 0; w < 8; w++, to += 4) set_vram32(to, vram32(to) | vram32(0x2AC0 + i * 32 + w * 4));
  }
  for (int i = 0; i < 256; i++) gba_pal[256 + i] = (uint16_t)p16(0x0201C500u + i * 2);
  unpack_vram(0x0201CA40u, 0x06012D80u);
  unpack_vram(0x0201E6D0u, 0x06011580u);
}

/** 0x0200196C (sub_02001D68): a frame of the garden: what the last one queued is written and its sprites shown, the
 *  colours asked for loaded, then every object, and the sprites for the next. */
static void garden_frame(void) {
  write_queued_registers();
  show_sprites();
  write_queued_maps();
  if (paletteAsk.chao) {
    paletteAsk.chao = 0;
    paletteAsk.chaoDone = 1;
    if (paletteAsk.chaoKind > 13) memcpy(gba_pal + 256, chaoColours, sizeof chaoColours);
    else for (int i = 0; i < 16; i++) gba_pal[256 + i] = (uint16_t)p16(0x0201C700u + paletteAsk.chaoKind * 32 + i * 2);
  }
  if (paletteAsk.egg) {
    paletteAsk.egg = 0;
    paletteAsk.eggDone = 1;
    for (int i = 0; i < 16; i++) gba_pal[256 + 0xE0 + i] = (uint16_t)p16(0x0201C8C0u + paletteAsk.eggKind * 32 + i * 2);
  }
  // 0x020005C0: the cable's watch, which finds nothing on it
  sort_clear();
  run_objects();
  sort_sprites();
  build_sprites();
}

// ---- the program's start ----

static int running;   // frames since the menu's A, from 1, or 0 before it
static uint32_t config[3];   // what Sonic Advance leaves at 0x02000008: its ring bank, its language and a seed

/**
 * LoadTinyChaoGarden: the menu's music stops and the sound engine with it, and the program unpacks into the work RAM,
 * which takes the console until frame UNPACKED; then Sonic Advance leaves the garden its ring bank, its language and a
 * seed from its frame count and its save's checksum, and starts it (SoftResetExram).
 */
void garden_load(void) {
  stop_song(SONG_CHARACTER_SELECTION);
  sound_vsync_off();
  if (!prog) {
    prog = gba_alloc(PROGRAM_SIZE);
    work = gba_alloc(WORK_SIZE);
  }
  gba_lz77(gba_rom + PROGRAM_AT, gba_rom_size - PROGRAM_AT, prog, PROGRAM_SIZE);
  config[0] = le32(save.bytes, 0x428);
  config[1] = SAVE_UI_LANGUAGE;
  config[2] = e.frameCount + le32(save.bytes, 0x42C);
  memset(&g, 0, sizeof g);
  stopped = 0;
  running = 1;
}

int garden_running(void) { return running > 0; }

/** GameInit, 0x02000138: the language, the random numbers from the seed, the save, the buttons. */
static void game_init(void) {
  g.language = config[1] != 0;
  seed = config[2];
  load_game_state(config[0]);
  input_init();
  g.flags = 0;
  g.fade = 0;
  g.frames = 0;
}

/** A frame from the menu's A: the program's start, then AgbMain's loop, a frame each: the buttons, then what the garden
 *  runs. Its SoundMain is the kit's. */
void garden_step(uint16_t keys) {
  int frame = running++;
  gba_on_hblank(NULL);
  if (stopped) return;
  if (frame == UNPACKED) game_init();
  else if (frame == SOUND_INIT)
    gba_sound_start_program(PROGRAM_AT, PROGRAM_SIZE, PLAYER_TABLE, LIBRARY_SONIC_ADVANCE, 4, 4, 15, 10512, 0);
  else if (frame == INIT_GARDEN) {
    if (read_input(keys)) init_garden();
    else not_in_c();
  } else if (frame == SONG_STARTS) gba_sound_play(MUS_GARDEN);
  else if (frame >= FIRST_FRAME) {
    if (!read_input(keys)) { not_in_c(); return; }
    g.main();
    g.frames++;
  }
}
