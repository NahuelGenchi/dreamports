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
// egg as it waits, with the garden's music; then the egg hatching, the new Chao with its name and bars on the panel,
// standing, walking, sitting, lying, crying and looking about as it chooses, and the plants that come up in the grass
// from seed. The hand moves with the d-pad, and A rocks the egg, pets the Chao, pulls a plant up, or opens an icon's
// screen: the left one's rock-paper-scissors game (gardenrps.c), the right one's card game (gardencards.c). L slides the
// shop in, where A buys a fruit or takes the egg, which the hand carries, puts down on the grass and picks up again; a
// fruit given to the Chao, it eats, its mood, belly and skills going up. The Chao's other moods, what it does with fruit
// on the grass and the shop's things, a skill's level up, the pause and going back to Sonic Advance (#1314) and the
// link cable aren't in C yet: a press or a moment that needs one stops the garden where it is, with the screen as it
// was.

#include "garden.h"

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
#define UNPACK_FRAMES 15
enum { UNPACKED = UNPACK_FRAMES - 1, SOUND_INIT = 21, INIT_GARDEN = 22, SONG_STARTS = 27, FIRST_FRAME = 28 };

// the garden's sound mode (m4aSoundInit's 0x0093F400) and its music players' table
#define PLAYER_TABLE 0x020129DCu
#define MUS_GARDEN 1
#define SE_CHAO_WALK 0x0F
#define SE_CONFIRM 0x0C
#define SE_PULLED 0x0D
#define SE_PET 0x13
#define SE_TOUCH 0x15
#define SE_GAUGE_EXPANDS 0x16
#define SE_HATCH 0x21
#define SE_PUT 0x16       // the same sound as SE_GAUGE_EXPANDS
#define SE_BUY 0x19
#define SE_CANT 0x1C

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
  void (*after)(void);  // and what runs once the screen has faded out to white
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
#define SAVE_CHAO_X 0x1D
#define SAVE_CHAO_Y 0x1E
#define SAVE_EGG_X 0x1F
#define SAVE_EGG_Y 0x20
#define SAVE_SEEDS 0x37       // 16 seeds, each where it is, x then y, or 0
#define SAVE_FRUIT_PLACES 0x21 // up to 8 fruits on the grass, each x then y
#define SAVE_THINGS 0x31      // the shop's three things, each x then y once in the garden, or 0
#define SAVE_CHAO 0x58        // the Chao's kind, or 0xFF with none
#define SAVE_EGG 0x59         // the egg's kind, or 0xFF with none
#define SAVE_FRUIT 0x5A       // each fruit's kind, or 0xFF
#define SAVE_RINGS_SHOWN 0x64 // the ring count, its bytes the other way round
// the Chao: its name's seven letters, its age, the egg it came from, its mood and belly, three more needs, its five
// skills, and each skill's level
#define SAVE_NAME 0x6A
#define SAVE_AGE 0x71
#define SAVE_FROM_EGG 0x72
#define SAVE_MOOD 0x73
#define SAVE_BELLY 0x74
#define SAVE_SLEEP 0x75
#define SAVE_BORED 0x76
#define SAVE_SKILLS 0x78
#define SAVE_LEVELS 0x88
#define SAVE_LIFE 0xD0
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

/** 0x02001CB0 (sub_02008810): the wait for the garden's next seed, one to one and a half minutes, in frames. */
static uint32_t seed_minutes(void) { return (uint32_t)(random_below(30) + 60) * 60; }

/** InitGameState, 0x02000368: no Chao and no egg, nothing in the garden, and the wait for its first seed. */
static void new_game_state(void) {
  memset(tcgSave + 0x08, 0, 0x50);
  memset(tcgSave + 0x58, 0xFF, 0x12);
  set_save32(SAVE_TIMER, seed_minutes());
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
  uint16_t fracY;
  int16_t y;
  uint32_t parts;                    // its sprite: the parts of its frame, an address in the program
  uint16_t tile;                     // added to each part's tile
  uint8_t attr0, attr1, attr2;       // or'd into each part's attributes' top bytes
  uint8_t state, arg, link;
  int8_t matrix;                     // its rotation's matrix, or -1
  uint8_t sortY;
  uint8_t extra[2];
  uint16_t value[2];                 // 0x20, a 32-bit count for some, two halfwords for others
};
#define OBJECTS 72
#define FREE_OBJECTS 70
static Obj objs[OBJECTS];
static uint8_t freeIds[FREE_OBJECTS], liveCount, nextFree, nextReturn;
// an object's place with its fraction: `x` and `y` are the top halves of 32-bit numbers, over `timer` and `fracY`
static int32_t x_fixed(const Obj *o) { return (int32_t)((uint32_t)(uint16_t)o->x << 16 | o->timer); }
static int32_t y_fixed(const Obj *o) { return (int32_t)((uint32_t)(uint16_t)o->y << 16 | o->fracY); }
static void set_x_fixed(Obj *o, int32_t v) { o->timer = (uint16_t)v; o->x = (int16_t)((uint32_t)v >> 16); }
static void set_y_fixed(Obj *o, int32_t v) { o->fracY = (uint16_t)v; o->y = (int16_t)((uint32_t)v >> 16); }
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
  o->fracY = 0;
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

/** 0x02000F70 (sub_020012f8): a rotation matrix for a sprite, as the top byte of its second attribute, or -1 with none
 *  left. */
static int matrix_take(void) {
  if (matrixCount > 0x1F) return -1;
  int m = (int8_t)matrices[matrixNext++];
  matrixNext &= 0x1F;
  matrixCount++;
  return m;
}
/** 0x02000FB4 (sub_0200133c): the matrix is free again. */
static void matrix_give(uint8_t m) {
  matrices[matrixReturn++] = m;
  matrixReturn &= 0x1F;
  matrixCount--;
}
/** The BIOS's ObjAffineSet with no turn: a matrix that draws its sprite at 256 / `sx` of its width and 256 / `sy` of its
 *  height, among the sprites the next frame shows. */
static void matrix_scale(uint8_t m, int sx, int sy) {
  uint16_t (*s)[4] = &oamBuffer[m * 2];
  s[0][3] = (uint16_t)sx;
  s[1][3] = 0;
  s[2][3] = 0;
  s[3][3] = (uint16_t)sy;
}

/** 0x0200145C and 0x02001470 (sub_0200182c, sub_02001840): the sine and cosine of an angle of 256 to the turn, from the
 *  program's table. */
static int sine(int angle) { return (int16_t)p16(0x02018174u + (uint32_t)(angle & 0xFF) * 2); }
static int cosine(int angle) { return sine(angle + 0xC0); }

/** 0x02000E64 (sub_02001088): the layers' sprites, each its frame's parts, into the sprites the next frame shows, and
 *  the rest hidden. */
// the shop's 22 goods (0x03000A60), each the five parts of its price's sprite, made from the program's template
#define GOODS_AT 0x03000A60u
static uint8_t goods[22][40];
// a sprite's parts: in the program, or a price's in the shop's table
static uint32_t part8(uint32_t address) {
  if (address - GOODS_AT < sizeof goods) return ((const uint8_t *)goods)[address - GOODS_AT];
  return p8(address);
}
static void build_sprites(void) {
  int entry = 0, left = 0x80;
  for (int layer = 0; layer < 4; layer++) {
    for (uint8_t link = links[layer][0]; link; link = links[link][0]) {
      const Obj *o = &objs[links[link][1]];
      for (uint32_t part = o->parts;; part += 8) {
        uint16_t *s = oamBuffer[entry];
        s[0] = (uint16_t)((part8(part + 2) | o->attr0) << 8 | (((int8_t)part8(part + 6) + o->y) & 0xFF));
        s[1] = (uint16_t)((part8(part + 3) | o->attr1) << 8 | (((int8_t)part8(part + 5) + o->x) & 0x1FF));
        s[2] = (uint16_t)((part8(part + 4) | o->attr2) << 8 | (uint16_t)(o->tile + (part8(part) | part8(part + 1) << 8)));
        if (--left == 0) return;
        entry++;
        if (!part8(part + 7)) break;
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
static uint8_t fruitCount;       // gUnknown_0300159B: the seeds and fruit lying in the garden
static uint8_t gardenObjects;    // gUnknown_0300159A
static uint8_t chaoKind;         // gUnknown_0300152F
static uint8_t chaoShown;        // gUnknown_0300152E
static uint8_t chaoState;        // gUnknown_0300152D: what a Chao starts by doing
static uint8_t eggOnSale;        // gUnknown_03001530: the egg the shop has, chosen as it first opens, 0xFF before
static uint8_t pauseState;       // gUnknown_03001509
static uint16_t dispCnt;         // gUnknown_0300152A
static uint8_t handBusy;         // 0x030009BC: the hand or the Chao is in the middle of something
static uint8_t menuEdge;         // 0x030009B8

static int stopped;
static int lagging;   // frames the loop still misses
static int songAfterLag;   // a song that starts in the last of them
#define PICTURE_FRAMES 5
static void open_icon(const Obj *icon);
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

/** 0x02003240: the leaves a pulled plant leaves behind, which wither away once it's out, a step every 10 frames. */
static void plant_leaves(Obj *o) {
  if (g.flags & 0x10) return;
  if (!(g.flags & 0x80) && o->changed && ++o->state > 9) {
    o->state = 0;
    o->tile += 2;
    if (o->tile > 0x193) { destroy(o); return; }
  }
  sort_add(o->id, o->sortY);
}

/** 0x02003168: a plant in the grass, drawn by its height. The hand pulling it moves it on: its leaves stay where it
 *  stood, and once it's out it goes, from the garden and the save. */
static void seedling(Obj *o) {
  if (g.flags & 0x10) return;
  if (!(g.flags & 0x80)) {
    if (o->state == 1) {
      Obj *leaves = create(plant_leaves, o, 0);
      leaves->x = o->x;
      leaves->sortY = (uint8_t)o->y;
      leaves->y = leaves->sortY;
      leaves->parts = 0x02018BB4u;
      leaves->tile = 0x18E;
      leaves->attr2 = 0x8C;
      o->link = leaves->id;
      o->state++;
    } else if (o->state == 3 || o->state == 4) {
      if (o->state == 3) {
        objs[o->link].changed = 1;
        o->state++;
      }
      if (o->changed) {
        tcgSave[SAVE_SEEDS + o->arg * 2] = 0;
        fruitCount--;
        destroy(o);
        return;
      }
    }
  }
  sort_add(o->id, o->sortY);
}
/** 0x02003088: a new seed comes up over 64 frames, from nothing to its size, settling down onto its place. */
static void seed_grows(Obj *o) {
  if (g.flags & 0x10) return;
  if (!(g.flags & 0x80)) {
    o->extra[1]++;
    if ((int8_t)o->extra[1] > 0x3F) {
      matrix_give(o->attr1);
      o->y = o->sortY;
      o->attr1 = 0;
      o->attr0 = 0;
      o->matrix = 3;
      o->main = seedling;
    } else {
      o->y = (int16_t)(((0x40 - (int8_t)o->extra[1]) >> 3) + o->sortY);
      int scale = 0x4000 / (int8_t)o->extra[1];
      matrix_scale(o->attr1, scale, scale);
    }
  }
  sort_add(o->id, o->sortY);
}

/** 0x02002F88 (sub_02003424): with fewer than 16 seeds, the wait for a new one counts down while nothing is over the
 *  garden; then one comes up somewhere on the grass, and the wait starts again. */
static void seed_clock(Obj *o) {
  if (g.flags & 0xF3 || fruitCount > 15) return;
  uint32_t left = save32(SAVE_TIMER) - 1;
  set_save32(SAVE_TIMER, left);
  if (left != 0) return;
  set_save32(SAVE_TIMER, seed_minutes());
  uint16_t x, y;
  for (;;) {
    x = (uint16_t)(random_below(0xA0) + 8);
    y = (uint16_t)(random_below(0x88) + 0x18);
    uint32_t tile = p16(0x020199E0u + (uint32_t)((y >> 3) * 22 + (x >> 3)) * 2);
    if (tile == 9 || tile == 13) break;
    random15();
  }
  int slot = 0;
  while (slot < 16 && tcgSave[SAVE_SEEDS + slot * 2]) slot++;
  Obj *n = create(seed_grows, o, 0);
  tcgSave[SAVE_SEEDS + slot * 2] = (uint8_t)x;
  n->x = (uint8_t)x;
  tcgSave[SAVE_SEEDS + slot * 2 + 1] = (uint8_t)y;
  n->sortY = (uint8_t)y;
  n->parts = 0x02018B9Cu;
  n->tile = 0x109;
  n->attr0 = 1;
  n->attr1 = (uint8_t)matrix_take();
  n->attr2 = 0x1C;
  n->arg = (uint8_t)slot;
  n->extra[1] = 0;
  fruitCount++;
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
static uint16_t nameTiles[7], stageTiles[7];   // 0x030009C8, 0x030009D8

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
    // the hand over the panel draws the name again, lit while it's on it, where A changes it (#1313)
    if (!(g.flags & 0x95) && handObj->x > 0xB5) {
      int lit = handObj->x > 0xBA && handObj->y <= 7 && !(g.flags & 0x20) && !pauseState;
      queue_map((const uint8_t *)nameTiles, 0x0F042u, 7, 1, lit ? 0xA000 : 0);
      if (lit && (input.pressed & KEY_A) && !(input.held & 0xF0) && !(g.flags & 2)) { not_in_c(); return; }
    }
    if (g.flags & 0xD3) return;
    // Mood and Belly go to the Chao's a step a frame
    for (int i = 0; i < 2; i++) {
      uint8_t now = tcgSave[SAVE_MOOD + i];
      if (now == bars[i].level) continue;
      bars[i].level = (uint8_t)(now > bars[i].level ? bars[i].level + 1 : bars[i].level - 1);
      if (draw_bar(i)) gba_sound_play(SE_GAUGE_EXPANDS);
    }
    // the skills too, every other frame; a level up counts up its number (not in C)
    for (int i = 2; i < 7; i++) {
      if (g.frames & 1) {
        if (tcgSave[SAVE_LEVELS + i - 2] > bars[i].value) { not_in_c(); return; }
        uint8_t now = tcgSave[SAVE_SKILLS + i - 2];
        if (now != bars[i].level) {
          bars[i].level = (uint8_t)(now > bars[i].level ? bars[i].level + 1 : bars[i].level - 1);
          bars[i].dirty = 1;
        }
      }
      if (draw_bar(i)) gba_sound_play(SE_GAUGE_EXPANDS);
    }
    return;
  }
  o->changed = chaoKind;
  if (chaoKind == 0xFF) {
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
    return;
  }
  // a Chao: its name, its stage of life in the game's language, the last letter left for which of the stage's three it
  // is, and its bars
  for (int i = 0; i < 7; i++) nameTiles[i] = (uint16_t)(0x2AF + tcgSave[SAVE_NAME + i]);
  queue_map((const uint8_t *)nameTiles, 0x0F042u, 7, 1, 0);
  int age = tcgSave[SAVE_AGE];
  if (age > 0x12) age = 0x13;
  if (age != 0) age += 2;
  for (int i = 0; i < 7; i++) {
    stageTiles[i] = (uint16_t)p8(0x02018942u + (uint32_t)(g.language * 0x38 + age / 3 * 7 + i));
    if (!stageTiles[i]) stageTiles[i] = (uint16_t)(age % 3 + 0x1E68);
  }
  queue_map((const uint8_t *)stageTiles, 0x0F082u, 7, 1, 0x2AF);
  for (int i = 0; i < 7; i++) {
    if (i <= 1) bars[i].level = tcgSave[SAVE_MOOD + i];
    else {
      bars[i].value = tcgSave[SAVE_LEVELS + i - 2];
      bars[i].level = tcgSave[SAVE_SKILLS + i - 2];
    }
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
  handBusy = 0;
}

// what the Chao is doing; the others aren't in C yet
enum { CHAO_STANDS = 0, CHAO_WAITS = 2, CHAO_HATCHED = 9, CHAO_GREETS = 10, CHAO_GIVEN = 13, CHAO_BITES = 14,
       CHAO_EATS = 15, CHAO_PETTED = 16, CHAO_ENJOYS = 17, CHAO_PLEASED = 18, CHAO_CHEERS = 19, CHAO_WALKS = 22, CHAO_SLEEPS = 23, CHAO_SITS = 25,
       CHAO_SITS_DOWN = 26, CHAO_LIES = 27, CHAO_LOOKS = 28, CHAO_LOOKS_ABOUT = 29, CHAO_DYING = 32, CHAO_CRIES = 45 };

// the Chao's object keeps these in the places a drawn object keeps its sprite's
#define behaviour attr1
#define heading attr0      // 0 to 11, a twelfth of a turn each
#define drawY attr2
#define countdown tile

static void hand(Obj *o);
// a fruit or an egg goes into the hand (the shop's)
static void held_fruit_start(Obj *o);
static void held_egg_start(Obj *o);
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
/** 0x020037A0: the hand pulls a plant up: it takes hold, tugs it up a pixel and lets it back, tugs again, and with
 *  a pop the plant comes out in an arc and is gone. */
static void hand_pulls(Obj *o) {
  handBusy = 1;
  if (!(g.flags & 0x80)) {
    Obj *plant = &objs[o->link];
    switch (o->state) {
      case 0: case 3:
        if (++o->arg <= 7) break;
        o->arg = 0;
        if (o->state == 0) plant->state++;
        o->state++;
        break;
      case 1: case 4:
        o->y--;
        plant->y--;
        o->arg = 0;
        o->state++;
        break;
      case 2: case 5:
        if (++o->arg <= 15) break;
        o->arg = 0;
        if (o->state == 2) {
          o->y++;
          plant->y++;
        } else {
          gba_sound_play(SE_PULLED);
          plant->state++;
        }
        o->state++;
        break;
      case 6:
        plant->y = (int16_t)(plant->sortY - (cosine(o->arg) >> 4));
        o->y = (int16_t)(plant->y - 0x10);
        o->arg += 5;
        if (o->arg <= 0x3F) break;
        o->arg = 0;
        o->tile = 0xB4;
        o->state++;
        break;
      case 7:
        if (++o->arg <= 11) break;
        o->main = hand;
        plant->changed = 1;
        break;
    }
  }
  o->attr2 = 0x1C;
  sort_add(o->id, o->sortY);
}

/** 0x020038D4: the hand pets what it's on, the egg or the Chao: for 64 frames it strokes from side to side, twice up
 *  and down, with its sound three times. */
static void hand_pets(Obj *o) {
  handBusy = 1;
  if (!(g.flags & 0x80)) {
    if (o->arg == 0 || o->arg == 0x42 || o->arg == 0x81) gba_sound_play(SE_PET);
    const Obj *petted = &objs[o->link];
    o->x = (int16_t)(petted->x - cosine(o->arg << 1) / 0x41 + (int8_t)o->extra[0]);
    o->y = (int16_t)(petted->y - sine(o->arg << 2) / 0xC0 - (int8_t)o->extra[1]);
    o->arg += 3;
    if (o->arg > 0xBF) o->main = hand;
  }
  o->attr2 = 0x1C;
  sort_add(o->id, o->sortY);
}

// the hand starts to pet `petted`, from `up` pixels above its place
static void pet(Obj *o, const Obj *petted, int up) {
  o->extra[0] = 0;
  o->extra[1] = (uint8_t)up;
  o->sortY = (uint8_t)(petted->sortY + 1);
  o->tile = 0xB8;
  o->arg = 0;
  o->state = 0;
  o->link = petted->id;
  o->main = hand_pets;
  o->x = petted->x;
  o->y = (int16_t)(petted->y - up);
  handBusy = 1;
}

// 0x02018CB4: what the hand can touch of each kind of thing, from its place: left, width, top, height
static int touches(const Obj *thing, int kind, int x, int y) {
  uint32_t box = 0x02018CB4u + (uint32_t)kind * 4;
  int16_t left = (int16_t)(thing->x + (int8_t)p8(box)), right = (int16_t)(left + (int8_t)p8(box + 1));
  int16_t top = (int16_t)(thing->y + (int8_t)p8(box + 2)), bottom = (int16_t)(top + (int8_t)p8(box + 3));
  return x >= left && x <= right && y >= top && y <= bottom;
}

/** 0x020032C4: the hand, drawn in the second layer. The d-pad moves it, faster the longer it's held, to 3.5 pixels a
 *  frame, or about 2.5 each way on a diagonal, inside the screen. A acts on what its finger is on, the nearest thing
 *  first: it rocks the egg, which hatches a second after the third time, pets the Chao when it can be, which leaves what
 *  it was doing, pulls a plant up, opens an icon's screen, or picks up a fruit, or an egg with a Chao about, to carry.
 *  The shop's things it picks up aren't in C yet. */
static void hand(Obj *o) {
  if (g.flags & 0x50) { not_in_c(); return; }
  if (g.flags & 0x20) { not_in_c(); return; }
  if (pauseState) { not_in_c(); return; }
  o->attr2 = 0x14;
  layer_add(o->id, 1);
  if (g.flags & 0x83) return;
  int holding = o->changed;   // what the hand carries, from the shop or picked up
  if (input.held & 0xF0) {
    if (holding) {
      o->tile = 0xB0;
      handBusy = 1;
    } else o->tile = 0xAC;
    o->value[1] = (uint16_t)(o->value[1] * 261 >> 8);
    if (o->value[1] > 0x380) o->value[1] = 0x380;
    o->value[0] = (uint16_t)(o->value[0] * 261 >> 8);
    if (o->value[0] > 0x279) o->value[0] = 0x279;
    int straight = o->value[1], slant = o->value[0], dx = 0, dy = 0;
    switch (input.held & 0xF0) {
      case KEY_UP: dy = -straight; break;
      case KEY_DOWN: dy = straight; break;
      case KEY_LEFT: dx = -straight; break;
      case KEY_RIGHT: dx = straight; break;
      case KEY_UP | KEY_LEFT: dx = dy = -slant; break;
      case KEY_UP | KEY_RIGHT: dx = slant; dy = -slant; break;
      case KEY_DOWN | KEY_LEFT: dx = -slant; dy = slant; break;
      case KEY_DOWN | KEY_RIGHT: dx = dy = slant; break;
    }
    set_x_fixed(o, x_fixed(o) + dx * 256);
    set_y_fixed(o, y_fixed(o) + dy * 256);
    // carrying, it keeps off the panel and the bottom edge
    if (o->x <= 0x0F) o->x = 0x10;
    else if (o->x > 0xDF) o->x = 0xDF;
    if (holding && o->x > 0xA0) o->x = 0xA0;
    if (o->y <= 3) o->y = 4;
    else if (o->y > 0x8F) o->y = 0x8F;
    if (holding && o->y > 0x8C) o->y = 0x8C;
    return;
  }
  o->value[1] = 0x180;
  o->value[0] = 0x10F;
  if (holding) {
    o->tile = 0xB0;
    handBusy = 1;
    return;
  }
  if (!(input.pressed & KEY_A)) return;
  if (o->x <= (int8_t)menuEdge || !sortedLast) return;
  int16_t x = (int16_t)(o->x - 8), y = (int16_t)(o->y + 8);
  for (int i = sortedLast - 1; i >= 0; i--) {
    Obj *thing = &objs[sorted[i]];
    int kind = (uint8_t)thing->matrix;
    if (kind == 0xFF || !touches(thing, kind, x, y)) continue;
    if (kind == 3) {
      gba_sound_play(SE_TOUCH);
      o->x = thing->x;
      o->y = (int16_t)(thing->y - 0x10);
      o->sortY = (uint8_t)(thing->sortY + 1);
      o->tile = 0xB0;
      o->arg = 0;
      o->state = 0;
      o->link = thing->id;
      o->main = hand_pulls;
      handBusy = 1;
      return;
    }
    // the shop's things are picked up too (not in C)
    if ((unsigned)(kind - 5) <= 2) { not_in_c(); return; }
    if (kind == 2 || (kind == 1 && (!chaoKind || !tcgSave[SAVE_CHAO]))) {
      // a fruit, or an egg with a Chao about, goes into the hand
      gba_sound_play(SE_TOUCH);
      o->changed = 1;
      o->x = thing->x;
      o->y = (int16_t)(thing->y - 0x13);
      thing->main = kind == 2 ? held_fruit_start : held_egg_start;
      handBusy = 1;
      input.pressed &= (uint16_t)~KEY_A;
      return;
    }
    if (kind == 1) {
      pet(o, thing, 0x11);
      thing->state++;
      return;
    }
    if (kind == 0) {
      if (!(chaoObj->extra[0] & 2)) continue;
      if (chaoObj->behaviour == 0x22 || chaoObj->behaviour == CHAO_SLEEPS) { not_in_c(); return; }
      pet(o, thing, 0x17);
      chaoObj->changed = 0;
      chaoObj->behaviour = CHAO_PETTED;
      return;
    }
    if (kind == 4 && !(g.flags & 4)) {
      open_icon(thing);
      return;
    }
  }
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
/** 0x02001AFC (sub_02001e74): a new Chao: one of ten names in the game's language, its mood and belly full, and what it
 *  gains from each of its five skills, shared out one of three ways. */
static void new_chao(void) {
  memset(tcgSave + SAVE_NAME, 0, 0x7EE);
  tcgSave[SAVE_FROM_EGG] = tcgSave[SAVE_EGG];
  tcgSave[0x69] = 0;
  tcgSave[0x62] = 0;
  chaoKind = 0;
  tcgSave[SAVE_CHAO] = 0;
  chaoState = CHAO_HATCHED;
  int name = random_below(10);
  for (int i = 0; i < 7; i++) tcgSave[SAVE_NAME + i] = (uint8_t)p8(0x020188B6u + (uint32_t)(g.language * 0x46 + name * 7 + i));
  tcgSave[SAVE_BELLY] = 100;
  tcgSave[SAVE_MOOD] = 100;
  uint8_t *gains = tcgSave + 0x80;
  switch (random_below(3)) {
    case 0: {
      // 0 to 4, each once
      uint8_t left[5] = { 0, 1, 2, 3, 4 };
      for (int i = 0; i < 4; i++) {
        int pick = random_below(5 - i);
        gains[i] = left[pick];
        for (; pick <= 3; pick++) left[pick] = left[pick + 1];
      }
      gains[4] = left[0];
      break;
    }
    case 1:
      for (int i = 0; i < 5; i++) gains[i] = (uint8_t)(random_below(3) + 1);
      break;
    case 2: {
      // 12 between them, none over 5
      memset(gains, 0, 5);
      for (int left = 12; left;) {
        for (int i = 0; i < 5 && left; i++) {
          if (gains[i] > 4) continue;
          int more = random_below(left > 4 ? 6 : left + 1);
          if (gains[i] + more > 5) continue;
          gains[i] = (uint8_t)(gains[i] + more);
          left -= more;
        }
      }
      break;
    }
  }
  memset(tcgSave + 0x85, 0xFF, 3);
  memset(tcgSave + SAVE_LEVELS, 1, 8);
}

/** 0x02003CAC: half of the egg's shell: the top half flies up and falls back, and both blink away, faster and faster and
 *  then slower, and the egg is gone from the save. */
static void shell(Obj *o) {
  if (g.flags & 0x10) return;
  if (!(g.flags & 0x80)) {
    if (o->changed) {
      set_y_fixed(o, y_fixed(o) - (int16_t)o->value[1] * 256);
      o->value[1] = (uint16_t)(o->value[1] - o->value[0]);
    }
    o->extra[0]--;
    if (o->state == 0) {
      if (o->extra[0] == 0) {
        o->extra[0] = o->extra[1];
        o->extra[1] -= 2;
        if (o->extra[1] == 0) o->state = o->extra[1] = o->extra[0] = 1;
        return;
      }
    } else {
      if (o->extra[0] != 0) return;
      o->extra[0] = o->extra[1];
      o->extra[1] += 2;
      if ((int8_t)o->extra[1] > 9) {
        if (o->changed) {
          matrix_give(o->attr1);
          tcgSave[SAVE_EGG] = 0xFF;
        }
        destroy(o);
        return;
      }
    }
  }
  sort_add(o->id, o->sortY);
}

/** 0x02003AE4: the egg hatching: every other frame it widens, then stretches up, twice over, and then it breaks: its two
 *  halves, and the new Chao where it stood. Hatching under a screen over the garden isn't in C. */
static void egg_hatches(Obj *o) {
  if (g.flags & 0x60) { not_in_c(); return; }
  if (!(g.flags & 0x83) && (g.frames & 1)) {
    if (!(o->state & 1)) {
      o->extra[0]++;
      if (o->extra[0] == 8 || o->extra[0] == 0x10) o->state++;
    } else {
      o->extra[1]++;
      if (o->extra[1] == 8) o->state++;
      else if (o->extra[1] == 0x11) {
        if (tcgSave[SAVE_EGG]) { not_in_c(); return; }
        Obj *top = create(shell, o, 0), *bottom = create(shell, o, 0);
        top->changed = 1;
        top->x = bottom->x = o->x;
        bottom->y = (int16_t)(o->sortY - 6);
        top->y = (int16_t)(o->sortY - 8);
        top->sortY = bottom->sortY = o->sortY;
        top->parts = bottom->parts = o->parts;
        top->attr1 = bottom->attr1 = o->attr1;
        top->attr2 = bottom->attr2 = o->attr2;
        top->extra[0] = bottom->extra[0] = 0x14;
        top->extra[1] = bottom->extra[1] = 6;
        top->value[1] = 0x1C0;
        top->value[0] = 0x10;
        bottom->tile = 0x198;
        top->tile = 0x194;
        tcgSave[SAVE_CHAO_X] = (uint8_t)o->x;
        tcgSave[SAVE_CHAO_Y] = (uint8_t)(o->sortY - 1);
        new_chao();
        destroy(o);
        return;
      }
    }
  }
  matrix_scale(o->attr1, 0x1000 / ((int8_t)o->extra[0] + 0x10), 0x1000 / ((int8_t)o->extra[1] + 0x10));
  o->y = (int16_t)(o->sortY - ((int8_t)o->extra[1] >> 1));
  sort_add(o->id, o->sortY);
}

/** 0x02003A30: the egg waits, counting while nothing is over the garden and there is no Chao, and drawn by its height;
 *  then it starts to hatch, with its sound. With no egg in the save it goes (not in C). */
static void egg(Obj *o) {
  if (g.flags & 0x10) return;
  if (tcgSave[SAVE_EGG] == 0xFF) { not_in_c(); return; }
  if (o->state > 2 && o->timer > 60) o->timer = 60;
  if (!(g.flags & 0xE3)) {
    if (!chaoKind || !tcgSave[SAVE_CHAO]) {
      o->state = 0;
      o->timer = 1800;
    } else if (--o->timer == 0) {
      o->parts = 0x02018BA4u;
      o->attr1 = (uint8_t)matrix_take();
      o->extra[1] = o->extra[0] = 0;
      o->state = 0;
      o->matrix = -1;
      o->main = egg_hatches;
      egg_hatches(o);
      gba_sound_play(SE_HATCH);
      return;
    }
  }
  sort_add(o->id, o->sortY);
}

/** 0x02007544: a fruit the Chao eats, smaller every 64 frames as it bites, gone after the third. */
static void fruit_eaten(Obj *o) {
  if (g.flags & 0x10) return;
  if (!(g.flags & 0x80) && --o->arg == 0) {
    o->arg = 0x40;
    if (++o->state > 3) {
      matrix_give(o->attr1);
      destroy(o);
      return;
    }
    if (objs[o->link].changed & 0x80) o->x--;
    else o->x++;
    o->y++;
    int size = 0x400 / (4 - o->state);
    matrix_scale(o->attr1, size, size);
  }
  sort_add(o->id, o->sortY);
}
/** 0x020074A0: the fruit given, in the Chao's hands on the side it faces. */
static void fruit_eaten_start(Obj *o) {
  const Obj *c = &objs[o->link];
  o->x = (int16_t)(c->changed & 0x80 ? c->x + 0xC : c->x - 0xC);
  o->sortY = (uint8_t)(c->y - 1);
  o->y = o->sortY;
  o->parts = 0x02018B9Cu;
  o->tile = (uint16_t)(o->arg * 4 + 0xBC);
  o->attr0 = 1;
  o->attr1 = (uint8_t)matrix_take();
  o->attr2 = (uint8_t)(p8(0x02018D34u + o->arg) << 4 | 0xC);
  o->arg = 0x20;
  matrix_scale(o->attr1, 0x100, 0x100);
  o->main = fruit_eaten;
  fruit_eaten(o);
}

// ---- the Chao: what it does, and the four sprites that follow it ----

static uint16_t chaoTimers[6];   // 0x030009A8: its needs' clocks
static uint16_t chaoRests;       // 0x030009B6
static uint8_t nearby[8];        // 0x03000DD0: what it has seen in the garden
static uint32_t nearest;         // 0x030009A4

/** 0x0200583C: a new way to walk, up to two twelfths of a turn from the old one, at 3/16 of a pixel a frame. */
static void chao_turns(Obj *o) {
  int way = (int8_t)(random_below(5) + o->heading - 2);
  if (way > 11) way -= 12;
  else if (way < 0) way += 12;
  o->heading = (uint8_t)way;
  int angle = (int)p8(0x02018D3Eu + (uint32_t)way);
  o->value[1] = (uint16_t)(sine(angle) * 48);
  o->value[0] = (uint16_t)(cosine(angle) * 48);
  o->fracY = 0;
  o->timer = 0;
}

/** 0x020058A4: which way a heading faces: 0 for the two ways the sprite's own picture faces, then 1 to 3. */
static int facing(int way) {
  if (way <= 1) return 0;
  if (way <= 4) return 1;
  if (way <= 7) return 2;
  if (way <= 10) return 3;
  return 0;
}

/** 0x02005180: a step the way it's heading, turning back from the field's edges. */
static void chao_steps(Obj *o) {
  set_x_fixed(o, x_fixed(o) + (int16_t)o->value[1]);
  set_y_fixed(o, y_fixed(o) + (int16_t)o->value[0]);
  if ((uint16_t)(o->x - 0x14) > 0x88) {
    o->x = (int16_t)(o->x <= 0x13 ? o->x + 1 : o->x - 1);
    o->value[1] = (uint16_t)-o->value[1];
    int way = (int8_t)(6 - o->heading);
    if (way < 0) way += 12;
    else if (way > 11) way -= 12;
    o->heading = (uint8_t)way;
  }
  if ((uint16_t)(o->y - 0x20) > 0x78) {
    o->y = (int16_t)(o->y <= 0x1F ? o->y + 1 : o->y - 1);
    o->value[0] = (uint16_t)-o->value[0];
    int way = (int8_t)(12 - o->heading);
    if (way < 0) way += 12;
    else if (way > 11) way -= 12;
    o->heading = (uint8_t)way;
  }
}

// a random number less `chance`, as 16 bits: negative one time in 32768 / chance
static int16_t less(int16_t roll, int chance) { return (int16_t)(roll - chance); }

/** 0x02005220: what the Chao does next, for 3 to 5 seconds: after anything but a walk, a walk; after a walk, another, or
 *  by chance and by its needs it sits, lies down or cries. Its other choices aren't in C yet. */
static void chao_chooses(Obj *o) {
  o->changed = 0;
  if (!save32(SAVE_LIFE)) { o->behaviour = CHAO_DYING; return; }
  o->countdown = (uint16_t)((random_below(3) + 3) * 60);
  if (o->behaviour == CHAO_SLEEPS) { o->behaviour = CHAO_SITS; return; }
  if (o->behaviour != CHAO_WALKS) goto walks;
  if (less((int16_t)random15(), 0x2666) < 0) { chao_turns(o); return; }
  if (tcgSave[SAVE_SLEEP] > 199) { o->state = 0; o->behaviour = CHAO_SLEEPS; return; }
  // hungry, it looks for what there is to eat
  if (tcgSave[SAVE_BELLY] <= 0x42) for (int i = 0; i < 8; i++) if (nearby[i]) { not_in_c(); return; }
  if (tcgSave[0x35]) { not_in_c(); return; }
  int16_t roll = less((int16_t)random15(), 0x0CCC);
  if (roll < 0) { not_in_c(); return; }
  if ((roll = less(roll, 0x666)) < 0) { o->behaviour = CHAO_LIES; return; }
  if ((roll = less(roll, 0x666)) < 0) { o->behaviour = CHAO_SITS_DOWN; return; }
  if ((roll = less(roll, 0x666)) < 0) { o->behaviour = CHAO_SITS; return; }
  if (less(roll, 0x666) < 0) { o->behaviour = CHAO_LOOKS; return; }
  roll = less((int16_t)random15(), 0x1FFF);
  if (roll < 0) {
    if (!tcgSave[SAVE_BELLY]) { not_in_c(); return; }
    if (tcgSave[SAVE_BELLY] > 0x42) goto walks;
    o->behaviour = CHAO_CRIES;
    o->arg = 0x14;
    o->state = 0;
    return;
  }
  if ((roll = less(roll, 0x1FFF)) < 0) {
    if (tcgSave[SAVE_SLEEP] > 0x95) { not_in_c(); return; }
    goto walks;
  }
  if ((roll = less(roll, 0x1FFF)) < 0) {
    if (tcgSave[SAVE_MOOD] > 0x32 && tcgSave[SAVE_MOOD] <= 0xA5) goto walks;
    not_in_c();
    return;
  }
  if (less(roll, 0x1999) < 0) {
    if (tcgSave[SAVE_BORED] > 0x63) { not_in_c(); return; }
    goto walks;
  }
  roll = less((int16_t)random15(), 0x1333);
  if (roll < 0) { not_in_c(); return; }
  if ((roll = less(roll, 0x0CCC)) < 0) { not_in_c(); return; }
  if ((roll = less(roll, 0x1333)) < 0) { not_in_c(); return; }
  if (less(roll, 0x3FFF) >= 0 || tcgSave[SAVE_BELLY] <= 0x42) { not_in_c(); return; }
walks:
  chao_turns(o);
  o->behaviour = CHAO_WALKS;
}

/** 0x02003F20: the Chao's frame: its needs change with time (bored and sleepy more, belly and mood less), and then what it's
 *  doing: it stands a second and a half when it hatches and greets the garden, walks, turning back from the edges and
 *  the pond, or sits, lies or cries until it chooses again. */
static void chao_lives(Obj *o) {
  // still while a screen comes or goes
  if (g.flags & 0x92) return;
  if (g.flags & 0x20) { not_in_c(); return; }
  uint16_t *t = chaoTimers;
  if (--t[0] == 0) { t[0] = 180; if (tcgSave[SAVE_BORED] <= 199) tcgSave[SAVE_BORED]++; }
  if (--t[1] == 0) { t[1] = 60; if (tcgSave[SAVE_SLEEP] <= 199) tcgSave[SAVE_SLEEP]++; }
  if (--t[2] == 0) { t[2] = 180; if (tcgSave[SAVE_BELLY]) tcgSave[SAVE_BELLY]--; }
  if (tcgSave[SAVE_BELLY] > 0xBD && --t[3] == 0) { t[3] = 360; if (tcgSave[SAVE_MOOD] <= 199) tcgSave[SAVE_MOOD]++; }
  // its mood goes down with time, slower the fuller it is, and faster with the garden full of fruit; a full Chao with
  // little about keeps its mood
  int kept = 0;
  if (tcgSave[SAVE_BELLY] > 0x6D) {
    if (fruitCount <= 3) {
      t[4] = (uint16_t)((tcgSave[SAVE_BELLY] / 20 + 4) * 60);
      t[5] = (uint16_t)((12 - fruitCount / 2) * 60);
      kept = 1;
    }
  } else if (--t[4] == 0) {
    t[4] = (uint16_t)((tcgSave[SAVE_BELLY] / 20 + 4) * 60);
    if (tcgSave[SAVE_MOOD]) tcgSave[SAVE_MOOD]--;
  }
  if (!kept && fruitCount > 3 && --t[5] == 0) {
    t[5] = (uint16_t)((12 - fruitCount / 2) * 60);
    if (tcgSave[SAVE_MOOD]) tcgSave[SAVE_MOOD]--;
  }
  if (chaoRests) chaoRests--;
  if (tcgSave[SAVE_MOOD]) set_save32(SAVE_LIFE, 0x34BC0);
  else if (save32(SAVE_LIFE)) set_save32(SAVE_LIFE, save32(SAVE_LIFE) - 1);
  o->extra[0] = 3;
  switch (o->behaviour) {
    case CHAO_HATCHED:
      o->changed = 0;
      o->countdown = 90;
      o->behaviour = CHAO_GREETS;
      // fallthrough
    case CHAO_GREETS:
      handBusy = 1;
      o->extra[0] = 0;
      if (--o->countdown == 0) o->behaviour = CHAO_STANDS;
      break;
    case CHAO_WALKS:
      chao_steps(o);
      // out of the pond the way it came
      if (p8(0x02019D50u + (uint32_t)((o->y >> 3) * 22 + (o->x >> 3)))) {
        set_x_fixed(o, x_fixed(o) - (int16_t)o->value[1]);
        set_y_fixed(o, y_fixed(o) - (int16_t)o->value[0]);
        o->value[1] = (uint16_t)-o->value[1];
        o->value[0] = (uint16_t)-o->value[0];
        o->heading = (uint8_t)(o->heading + 6);
        if (o->heading > 11) o->heading -= 12;
      }
      if (--o->countdown == 0) chao_chooses(o);
      break;
    case CHAO_SITS: case CHAO_SITS_DOWN: case CHAO_LIES:
      if (--o->countdown == 0) chao_chooses(o);
      break;
    case CHAO_PETTED:
      o->countdown = 63;
      o->behaviour = CHAO_ENJOYS;
      // fallthrough
    case CHAO_ENJOYS:
      // a second of being petted, and it's bored no more; its mood goes up 20, unless it was petted in the last half
      // minute
      o->extra[0] = 0;
      if (--o->countdown) break;
      tcgSave[SAVE_BORED] = 0;
      if (chaoRests) chao_chooses(o);
      else {
        tcgSave[SAVE_MOOD] = (uint8_t)(tcgSave[SAVE_MOOD] + 20);
        if (tcgSave[SAVE_MOOD] > 200) tcgSave[SAVE_MOOD] = 200;
        o->behaviour = CHAO_PLEASED;
      }
      chaoRests = 1800;
      break;
    case CHAO_PLEASED:
      o->state = 0;
      o->arg = 0x14;
      o->behaviour = CHAO_CHEERS;
      // fallthrough
    case CHAO_CHEERS:
      if (--o->arg == 0) {
        o->arg = 0x14;
        if (++o->state > 5) chao_chooses(o);
      }
      break;
    case CHAO_GIVEN: {
      // given a fruit: its mood and belly go up 20 a point of the fruit's, and its skills 10 a point
      const uint8_t *row = at(0x0200E8D4u + o->link * 7u);
      for (int k = 0; k < 2; k++) {
        int v = (int8_t)row[k] * 20 + tcgSave[SAVE_MOOD + k];
        tcgSave[SAVE_MOOD + k] = (uint8_t)(v < 0 ? 0 : v > 200 ? 200 : v);
      }
      for (int k = 0; k < 5; k++) {
        int v = (int8_t)row[2 + k] * 10 + tcgSave[SAVE_SKILLS + k];
        // past 99 a skill levels up (not in C)
        if (v > 99) { not_in_c(); return; }
        tcgSave[SAVE_SKILLS + k] = (uint8_t)(v < 0 ? 0 : v);
      }
      Obj *fruit = create(fruit_eaten_start, o, 0);
      fruit->arg = o->link;
      fruit->link = o->id;
      o->countdown = 0x10;
      o->behaviour = CHAO_BITES;
    }
      // fallthrough
    case CHAO_BITES:
      handBusy = 1;
      o->extra[0] = 0;
      if (--o->countdown == 0) {
        o->countdown = 240;
        o->behaviour = CHAO_EATS;
      }
      break;
    case CHAO_EATS:
      handBusy = 1;
      o->extra[0] = 0;
      if (--o->countdown == 0) chao_chooses(o);
      break;
    case CHAO_LOOKS:
      o->state = 0;
      o->arg = 60;
      o->behaviour = CHAO_LOOKS_ABOUT;
      // fallthrough
    case CHAO_LOOKS_ABOUT:
      // it looks about, and after a second it's ready to see what there is
      if (g.flags & 0x20) { o->behaviour = CHAO_STANDS; break; }
      if (o->arg && --o->arg == 0) {
        o->state = 1;
        o->changed |= 0x20;
      }
      if (--o->countdown == 0) chao_chooses(o);
      break;
    case CHAO_CRIES:
      if (--o->arg == 0) {
        o->arg = 0x14;
        if (++o->state > 5) chao_chooses(o);
      }
      break;
    case 1: case CHAO_WAITS:
      if (--o->countdown == 0) chao_chooses(o);
      break;
    case CHAO_STANDS:
      o->changed = 0;
      o->countdown = 90;
      o->behaviour = CHAO_WAITS;
      if (--o->countdown == 0) chao_chooses(o);
      break;
    default:
      not_in_c();
      return;
  }
  // 0x0200513C: where its sprites go, where the save keeps it, and nothing seen yet
  o->drawY = (uint8_t)(o->y - o->extra[1]);
  o->sortY = (uint8_t)o->y;
  tcgSave[SAVE_CHAO_X] = (uint8_t)o->x;
  tcgSave[SAVE_CHAO_Y] = (uint8_t)o->y;
  memset(nearby, 0, sizeof nearby);
  nearest = 0;
}

/** 0x02005F94: the Chao's shadow, under everything. */
static void chao_shadow(Obj *o) {
  if (g.flags & 0x10) return;
  if (!chaoShown) { destroy(o); return; }
  const Obj *c = &objs[o->link];
  o->x = c->x;
  o->y = c->sortY;
  if (!(c->changed & 1)) sort_add(o->id, 0);
}

// 0x02018A4C: for each of the Chao's frames, where its ball floats, where its eyes are, and which eyes
static int frame_place(int frame, int which) { return (int8_t)p8(0x02018A4Cu + (uint32_t)(frame * 5 + which)); }

/** 0x02005D5C: the ball over the Chao's head, its shape by the Chao's mood: it follows the head, an eighth of the way
 *  across and a quarter of the way up each frame, and bobs. */
static void chao_ball(Obj *o) {
  if (g.flags & 0x10) return;
  if (!chaoShown) { destroy(o); return; }
  const Obj *body = &objs[o->link];
  if (!(g.flags & 0x80)) {
    int shape = 0;
    switch (body->changed & 0x78) {
      case 0x10: shape = g.frames & 0x10 ? 3 : 4; break;
      case 0x08: shape = g.frames & 0x08 ? 5 : 6; break;
      case 0x20: shape = 2; break;
      case 0x40: shape = 1; break;
    }
    o->parts = 0x020189FCu + (uint32_t)shape * 8;
    int dx = frame_place(body->state, 0), dy = frame_place(body->state, 1);
    if (!(int8_t)body->extra[0]) dx = (int8_t)(-dx - 6);
    set_x_fixed(o, x_fixed(o) + (int32_t)((uint32_t)(dx + body->x - o->x) << 16) / 8);
    set_obj_value(o, obj_value(o) + (uint32_t)((int32_t)((uint32_t)(dy + body->y - (int16_t)o->value[1]) << 16) >> 2));
    o->y = (int16_t)(o->value[1] + cosine(o->state) / 128);
    o->state += 4;
  }
  if (!(body->changed & 1)) sort_add(o->id, body->sortY);
}

/** 0x02005E7C: the Chao's eyes, shut for 5 frames every 3 seconds, and now and then twice in a row, or as the Chao
 *  shuts them itself; drawn only while shut. */
static void chao_eyes(Obj *o) {
  if (g.flags & 0x10) return;
  if (!chaoShown) { destroy(o); return; }
  const Obj *body = &objs[o->link];
  if (!(g.flags & 0x80)) {
    if (body->changed & 4) o->changed = 1;
    else if (!o->changed) {
      if (++o->arg < (o->state & 1 ? 11 : 180)) return;
      o->arg = 0;
      o->changed = 1;
      return;
    } else if (++o->arg > 4) {
      o->arg = 0;
      o->changed = 0;
      o->state++;
    }
  }
  int frame = body->state, dx = frame_place(frame, 2), kind = frame_place(frame, 4) & 0xFF;
  if (!dx) return;
  if (!(int8_t)body->extra[0]) {
    dx = (int8_t)-dx;
    if (kind) kind = 1;
  }
  o->x = (int16_t)(dx + body->x);
  o->y = (int16_t)(frame_place(frame, 3) + body->y);
  o->parts = 0x02018A34u + (uint32_t)kind * 8;
  if (o->changed && !(body->changed & 1)) sort_add(o->id, body->sortY);
}

/** 0x020058C8: the Chao's body, where the Chao is, its frame by what it's doing and the way it faces, the picture's
 *  own way or mirrored: its steps, four frames 18 frames apart with a footstep's sound each time round. */
static void chao_body(Obj *o) {
  if (g.flags & 0x10) return;
  if (!chaoShown) { destroy(o); return; }
  if (!(g.flags & 0x80)) {
    const Obj *c = &objs[o->link];
    o->changed = c->changed;
    o->x = c->x;
    o->y = c->drawY;
    o->sortY = c->sortY;
    int frame, own = 1, way;
    uint8_t *step = (uint8_t *)&o->value[1];
    switch (c->behaviour) {
      case CHAO_STANDS: case 1: case CHAO_WAITS: case CHAO_HATCHED: case CHAO_GIVEN: case CHAO_PETTED: case CHAO_PLEASED:
      case CHAO_LOOKS:
        frame = 0x1B;
        break;
      case CHAO_ENJOYS: frame = (int)p8(0x02018D4Au + ((handObj->arg + 0x10) >> 5 & 3u)) + 0x31; break;
      case CHAO_CHEERS: frame = (c->state & 1) + 0x27; break;
      case CHAO_GREETS: frame = 0x28; break;
      case CHAO_WALKS:
        if (++step[0] > 0x11) {
          step[0] = 0;
          if (!(++step[1] & 3) && !(g.flags & 3)) gba_sound_play(SE_CHAO_WALK);
        }
        way = facing(c->heading);
        if (!way) { own = 0; way = 2; }
        frame = (way - 1) * 3 + (int)p8(0x02018D4Au + (step[1] & 3u));
        break;
      case CHAO_SITS:
        way = facing(c->heading);
        if (!way) { own = 0; way = 2; }
        else if (way == 3) way = 1;
        frame = way + 0x1A;
        break;
      case CHAO_SITS_DOWN:
        way = facing(c->heading);
        if (!way) { own = 0; way = 2; }
        frame = (way - 1) * 3;
        break;
      case CHAO_LIES: frame = 0x30; break;
      case CHAO_BITES:
        own = !(c->changed & 0x80);
        frame = 0x24;
        step[0] = 0x30;
        break;
      case CHAO_EATS:
        own = !(c->changed & 0x80);
        frame = ++step[0] & 0x30 ? 0x25 : 0x26;
        break;
      case CHAO_LOOKS_ABOUT: frame = c->state ? 0x42 : 0x30; break;
      case CHAO_CRIES: frame = c->state ? (c->state & 1) + 0x2B : 0; break;
      default: not_in_c(); return;
    }
    o->parts = own ? 0x020189B4u : 0x020189D4u;
    o->tile = (uint16_t)(frame * 9 + 0x1A4);
    o->state = (uint8_t)frame;
    o->extra[0] = (uint8_t)own;
  }
  if (!(o->changed & 1)) sort_add(o->id, o->sortY);
}

/** 0x02003D5C (sub_020041E0): with no Chao, nothing is shown for it; when there is one, its shadow, its ball, its eyes and
 *  its body, each following the one before, its colours, its place from the save, and its needs' clocks. */
static void chao(Obj *o) {
  if (tcgSave[SAVE_CHAO] == 0xFF) {
    chaoShown = 0;
    return;
  }
  chaoShown = 1;
  Obj *shadow = create(chao_shadow, o, 0);
  shadow->parts = 0x020189F4u;
  shadow->tile = 0x16C;
  shadow->attr0 = 4;
  shadow->attr2 = 0x1C;
  shadow->link = o->id;
  Obj *ball = create(chao_ball, o, 0);
  ball->tile = 0x16C;
  ball->attr2 = 0x0C;
  ball->state = 1;
  Obj *eyes = create(chao_eyes, o, 0);
  eyes->tile = 0x16C;
  eyes->attr2 = 0x0C;
  Obj *body = create(chao_body, o, 0);
  body->attr2 = 0x0C;
  body->link = o->id;
  body->matrix = 0;
  ball->link = body->id;
  eyes->link = body->id;
  // its colours: its egg's, or, grown, its stage's
  int colours = tcgSave[SAVE_FROM_EGG];
  if (colours > 11) {
    for (int i = 0; i < 16; i++) chaoColours[i] = (uint16_t)(tcgSave[0xA0 + i * 2] << 8 | tcgSave[0xA1 + i * 2]);
    colours = 14;
  } else if (!colours) {
    colours = tcgSave[SAVE_AGE];
    if (colours > 0x12) colours = 1;
    if (colours) colours += 2;
    colours %= 3;
    if (colours) colours += 11;
  }
  paletteAsk.chaoKind = (uint8_t)colours;
  paletteAsk.chao = 1;
  if (!tcgSave[SAVE_CHAO_X]) {
    tcgSave[SAVE_CHAO_X] = 0x58;
    tcgSave[SAVE_CHAO_Y] = 0x68;
  }
  o->x = tcgSave[SAVE_CHAO_X];
  o->sortY = tcgSave[SAVE_CHAO_Y];
  o->y = o->sortY;
  o->heading = (uint8_t)random_below(12);
  o->behaviour = chaoState;
  o->extra[1] = 0;
  ball->x = (int16_t)(o->x + 1);
  ball->value[1] = (uint16_t)(o->y - 0x17);
  chaoTimers[0] = 180;
  chaoTimers[1] = 60;
  chaoTimers[2] = 180;
  chaoTimers[3] = 360;
  chaoTimers[4] = (uint16_t)((tcgSave[SAVE_BELLY] / 20 + 4) * 60);
  chaoTimers[5] = (uint16_t)((12 - fruitCount / 2) * 60);
  chaoRests = 0;
  o->main = chao_lives;
  chao_lives(o);
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
static void fruit_lies_start(Obj *o);

// the shop's things, at the bottom, are drawn but not bought here: none costs less than 1,000 rings
static void price_tag(Obj *o, int good);

/** 0x020069F0: a good's price, beside it as the shop slides. */
static void price(Obj *o) {
  if (g.flags & 0x10) return;
  int shopX = objs[o->link].x;
  if (shopX <= -0x30) { destroy(o); return; }
  o->x = (int16_t)shopX;
  sort_add(o->id, 0xA1);
}
/** 0x020069AC: good number `good`'s price, from the shop's table of them (0x03000A60), 10 pixels over it. */
static void price_tag(Obj *o, int good) {
  Obj *t = create(price, o, 0);
  t->y = (int16_t)(o->y - 10);
  t->parts = GOODS_AT + (uint32_t)good * 40;
  t->tile = 0x141;
  t->attr2 = 0x1C;
  t->link = o->link;
}

// a good is under the hand, open and empty, while the shop is all the way out
static int under_hand(const Obj *o, int shopX) {
  const Obj *h = handObj;
  if (shopX < 0 || h->x > 0x33 || h->changed || pauseState || (g.flags & 0x80)) return 0;
  int y = h->y + 8;
  return y <= o->y && o->y - 0x10 < y;
}
// A on a good under the hand, with nothing on the d-pad
static int buys(void) { return (input.pressed & KEY_A) && !(input.held & 0xF0); }

/** 0x020064F4: a fruit for sale, blinking under the hand; A buys it into the hand, if the rings cover it and the garden
 *  has room for it. */
static void fruit_on_sale(Obj *o) {
  if (g.flags & 0x10) return;
  int shopX = objs[o->link].x;
  if (shopX <= -0x30) { destroy(o); return; }
  if (under_hand(o, shopX)) {
    uint32_t cost = p32(0x0200E90Cu + o->arg * 4u);
    if (rings < cost || gardenObjects > 7) {
      if (buys()) gba_sound_play(SE_CANT);
    } else if (buys()) {
      gba_sound_play(SE_BUY);
      int slot = 0;
      while (slot < 8 && tcgSave[SAVE_FRUIT + slot] != 0xFF) slot++;
      tcgSave[SAVE_FRUIT + slot] = o->arg;
      o->state = (uint8_t)slot;
      gardenObjects++;
      rings -= cost;
      handObj->changed = 1;
      handBusy = 1;
      held_fruit_start(o);
      return;
    } else if (!(g.frames & 0x18)) return;
  }
  o->x = (int16_t)(shopX + 8);
  sort_add(o->id, 0xA1);
}
/** 0x020064B4: fruit `arg`, its colours by its kind. */
static void fruit_on_sale_start(Obj *o) {
  o->parts = 0x02018B9Cu;
  o->tile = (uint16_t)(o->arg * 4 + 0xBC);
  o->attr2 = (uint8_t)(p8(0x02018D34u + o->arg) << 4 | 0xC);
  price_tag(o, o->arg);
  o->main = fruit_on_sale;
}

/** 0x020066C4: the egg for sale; A takes it into the hand, if the rings cover it. */
static void egg_on_sale(Obj *o) {
  if (g.flags & 0x10) return;
  int shopX = objs[o->link].x;
  if (shopX <= -0x30) { destroy(o); return; }
  if (under_hand(o, shopX)) {
    uint32_t cost = p32(0x0200E928u + o->arg * 4u);
    if (rings < cost) {
      if (buys()) gba_sound_play(SE_CANT);
    } else if (buys()) {
      gba_sound_play(SE_BUY);
      tcgSave[SAVE_EGG] = o->arg;
      rings -= cost;
      handObj->changed = 1;
      handBusy = 1;
      held_egg_start(o);
      return;
    } else if (!(g.frames & 0x18)) return;
  }
  o->x = (int16_t)(shopX + 8);
  sort_add(o->id, 0xA1);
}
/** 0x0200667C: egg `arg`, the first of the program's 14 kinds a plain one, with its colours. */
static void egg_on_sale_start(Obj *o) {
  o->y = 0x8A;
  o->parts = 0x02018B9Cu;
  o->tile = o->arg ? 0xDC : 0xD8;
  o->attr2 = 0xEC;
  price_tag(o, o->arg + 7);
  paletteAsk.eggKind = o->arg;
  paletteAsk.egg = 1;
  o->main = egg_on_sale;
}

/** 0x02006858: a thing for sale, at the bottom. */
static void thing_on_sale(Obj *o) {
  if (g.flags & 0x10) return;
  int shopX = objs[o->link].x;
  if (shopX <= -0x30) { destroy(o); return; }
  if (under_hand(o, shopX)) { not_in_c(); return; }
  o->x = (int16_t)(shopX + 8);
  sort_add(o->id, 0xA1);
}
/** 0x02006810: thing `arg`, with its colours. */
static void thing_on_sale_start(Obj *o) {
  o->y = 0x9A;
  o->parts = 0x02018B9Cu;
  o->tile = (uint16_t)(o->arg * 4 + 0xE0);
  o->attr2 = (uint8_t)(p8(0x02018D3Bu + o->arg) << 4 | 0xC);
  price_tag(o, o->arg + 0x13);
  o->main = thing_on_sale;
}

/** L opens the shop: its seven fruits, then an egg while the garden has none, a plain one until a Chao has hatched and
 *  then one of seven kinds by chance, kept until the garden is left, and the first thing not yet in the garden. */
static void shop_opens(Obj *o) {
  o->extra[0] = 1;
  o->x += 4;
  if (tcgSave[0x1C] == 0xFF) tcgSave[0x1C] = (uint8_t)(g.frames % 5);
  for (int i = 0; i < 7; i++) {
    Obj *fruit = create(fruit_on_sale_start, o, 0);
    fruit->y = (int16_t)(0x1A + 0x10 * i);
    fruit->arg = p8(0x0200E905u + (uint32_t)i);
    fruit->link = o->id;
  }
  if (tcgSave[SAVE_EGG] == 0xFF) {
    int kind;
    if (tcgSave[SAVE_CHAO] == 0xFF) kind = 0;
    else if (eggOnSale != 0xFF) kind = eggOnSale;
    else {
      // one time in four, while 0x68 of the save is clear, it's one of the kinds the Chao could have been (not in C)
      if (!tcgSave[0x68] && random15() <= 0x1FFF) { not_in_c(); return; }
      int r = random15();
      kind = r <= 0x1999 ? 0 : r <= 0x3332 ? 2 : r <= 0x4665 ? 1 : r <= 0x5998 ? 3 : r <= 0x6665 ? 4 : r <= 0x7332 ? 6 : 5;
      eggOnSale = (uint8_t)kind;
    }
    Obj *egg = create(egg_on_sale_start, o, 0);
    egg->arg = (uint8_t)kind;
    egg->link = o->id;
  }
  for (int i = 0; i < 3; i++) {
    if (tcgSave[SAVE_THINGS + i * 2]) continue;
    if (i == 2 && save32(0x14)) break;
    Obj *thing = create(thing_on_sale_start, o, 0);
    thing->arg = (uint8_t)i;
    thing->link = o->id;
    break;
  }
  tcgSave[0xCE] = 1;
}

/** 0x020061D4: L slides the shop in from the left, 4 pixels a frame, and L again slides it away, as does anything the
 *  hand takes. */
static void shop(Obj *o) {
  if (g.flags & 0x10) return;
  if (save32(0x14)) set_save32(0x14, save32(0x14) - 1);
  if (!(g.flags & 0x80)) {
    if (o->extra[0]) {
      if (o->x < 0) o->x += 4;
      else if ((input.pressed & KEY_L) || (g.flags & 0x24) || handObj->changed) o->extra[0] = 0;
    } else if (o->x > -0x30) o->x -= 4;
    else if ((input.pressed & KEY_L) && !(g.flags & 0x24) && !handObj->changed) shop_opens(o);
  }
  menuEdge = (uint8_t)(o->x + 0x3B);
  if (o->x > -0x30) sort_add(o->id, 0xA0);
}

// what lies on a place of the field (0x02019D50, 22 by 20 of 8 pixels): 0 is the grass
static int field_at(int x, int y) { return p8(0x02019D50u + (uint16_t)((y >> 3) * 22 + (x >> 3))); }

/** 0x02006A74: a fruit in the hand, which keeps its place in the save. A puts it down on the grass, and to a Chao that
 *  holds its hands out it gives it, which it eats. */
static void held_fruit(Obj *o) {
  if (pauseState) return;
  if (!(g.flags & 0x80)) {
    Obj *h = handObj;
    o->x = h->x;
    tcgSave[SAVE_FRUIT_PLACES + o->state * 2] = (uint8_t)h->x;
    o->y = (int16_t)(h->y + 0x13);
    tcgSave[SAVE_FRUIT_PLACES + o->state * 2 + 1] = (uint8_t)o->y;
    if ((input.pressed & KEY_A) && h->x > (int8_t)menuEdge && !(input.held & 0xF0)) {
      Obj *c = chaoObj;
      if (!tcgSave[SAVE_CHAO] && !chaoKind && (c->extra[0] & 1) && c->x - 0xB < o->x && o->x < c->x + 0xB
          && c->y - 0x12 < o->y && o->y < c->y + 0xA) {
        gba_sound_play(SE_PUT);
        h->changed = 0;
        h->tile = 0xB4;
        // too full for it, the Chao pushes it away (not in C)
        if ((int8_t)p8(0x0200E8D5u + o->arg * 7u) * 10 > 200 - tcgSave[SAVE_BELLY]) { not_in_c(); return; }
        c->behaviour = 0x0D;
        c->changed = 0x10;
        c->link = o->arg;
        if (c->x < o->x) c->changed |= 0x80;
        tcgSave[SAVE_BORED] = 0;
        tcgSave[SAVE_FRUIT + o->state] = 0xFF;
        gardenObjects--;
        destroy(o);
        return;
      }
      if (o->y > 0x9F) { not_in_c(); return; }
      if (!field_at(o->x, o->y)) {
        gba_sound_play(SE_PUT);
        h->changed = 0;
        h->tile = 0xB4;
        fruit_lies_start(o);
        return;
      }
      gba_sound_play(SE_CANT);
    }
  }
  layer_add(o->id, 1);
}
/** 0x02006A3C: the fruit goes into the hand, drawn over the field. */
static void held_fruit_start(Obj *o) {
  o->parts = 0x02018B9Cu;
  o->tile = (uint16_t)(o->arg * 4 + 0xBC);
  o->attr2 = (uint8_t)(p8(0x02018D34u + o->arg) << 4 | 4);
  o->main = held_fruit;
  held_fruit(o);
}

/** 0x02007120: a fruit on the grass, which the Chao can see. */
static void fruit_lies(Obj *o) {
  if (g.flags & 0x10) return;
  if (tcgSave[SAVE_FRUIT + o->state] == 0xFF) { not_in_c(); return; }
  nearby[o->state] = o->id;
  sort_add(o->id, o->sortY);
}
/** 0x02007060: a fruit put down where the save keeps it, moved up out of the pond a row at a time, for the hand to pick
 *  up again. */
static void fruit_lies_start(Obj *o) {
  int place = SAVE_FRUIT_PLACES + o->state * 2;
  o->x = tcgSave[place];
  if (tcgSave[place + 1] > 0x9F) tcgSave[place + 1] = 0x9F;
  o->sortY = tcgSave[place + 1];
  o->y = o->sortY;
  o->parts = 0x02018B9Cu;
  o->tile = (uint16_t)(o->arg * 4 + 0xBC);
  o->attr2 = (uint8_t)(p8(0x02018D34u + o->arg) << 4 | 0xC);
  o->matrix = 2;
  uint16_t cell = (uint16_t)((tcgSave[place + 1] >> 3) * 22 + (o->x >> 3));
  while (p8(0x02019D50u + cell)) {
    cell = (uint16_t)(cell - 22);
    o->y -= 8;
  }
  o->sortY = (uint8_t)o->y;
  tcgSave[place + 1] = (uint8_t)o->y;
  o->main = fruit_lies;
  fruit_lies(o);
}

/** 0x02006D14: an egg in the hand, which keeps its place in the save; A puts it down on the grass. */
static void held_egg(Obj *o) {
  if (pauseState) return;
  if (!(g.flags & 0x80)) {
    Obj *h = handObj;
    o->x = h->x;
    tcgSave[SAVE_EGG_X] = (uint8_t)h->x;
    o->y = (int16_t)(h->y + 0x13);
    tcgSave[SAVE_EGG_Y] = (uint8_t)o->y;
    if ((input.pressed & KEY_A) && h->x > (int8_t)menuEdge && !(input.held & 0xF0)) {
      if (o->y > 0x9F) { not_in_c(); return; }
      if (!field_at(o->x, o->y)) {
        gba_sound_play(SE_PUT);
        h->changed = 0;
        h->tile = 0xB4;
        egg_start(o);
        return;
      }
      gba_sound_play(SE_CANT);
    }
  }
  layer_add(o->id, 1);
}
/** 0x02006CE4: the egg goes into the hand, drawn over the field. */
static void held_egg_start(Obj *o) {
  o->parts = 0x02018B9Cu;
  o->tile = o->arg ? 0xDC : 0xD8;
  o->attr2 = 0xE4;
  o->main = held_egg;
  held_egg(o);
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
  create(seed_clock, &objs[1], 1);
  fruitCount = 0;
  for (int i = 0; i < 16; i++) if (tcgSave[SAVE_SEEDS + i * 2]) { not_in_c(); return; }
  chaoKind = tcgSave[SAVE_CHAO];
  create(icon_start, &objs[0], 0)->arg = 1;
  create(icon_start, &objs[0], 0)->arg = 0;
  chaoState = 0;
  chaoObj = create(chao, &objs[0], 0);
  create(panel_start, &objs[0], 0);
  for (int i = 0; i < 3; i++) if (tcgSave[0x31 + i * 2]) { not_in_c(); return; }
  gardenObjects = 0;
  for (int i = 0; i < 8; i++) if (tcgSave[0x5A + i] != 0xFF) { not_in_c(); return; }
  eggOnSale = 0xFF;
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

// ---- the screens the icons open ----

/** 0x02001A20: the garden fades out to white over 16 frames, and then the icon's screen runs. */
static void fade_away(void) {
  gba_write(REG_BLDCNT, 0x8BF);
  g.fade++;
  gba_write(REG_BLDY, g.fade);
  gba_write(REG_BLDALPHA, (uint16_t)(((16 - g.fade) & 0xFE) << 7 | g.fade));
  if (g.fade > 15) g.main = g.after;
}
/** 0x02001A04. */
static void fade_away_start(void) {
  g.fade = 0;
  g.main = fade_away;
  fade_away();
}

/** A on an icon: the garden's music fades out, and its screen with it: the left one's game or the right one's. */
static void open_icon(const Obj *icon) {
  gba_sound_fade_out(0, 1);
  gba_sound_play(SE_CONFIRM);
  g.after = icon->arg ? garden_rps : garden_cards;
  g.main = fade_away_start;
  g.flags |= 3;
}

void garden_back(void) {
  garden_pictures();
  paletteAsk.chao = paletteAsk.chaoDone;
  paletteAsk.egg = paletteAsk.eggDone;
  eggOnSale = 0xFF;
  create(fade_in, &objs[0], 0)->arg = 16;
  dispCnt = 0x1F40;
  queue_only_register(REG_DISPCNT, dispCnt);
  // unpacking the garden's pictures takes the console 5 more frames, and its music starts in the last
  lagging = PICTURE_FRAMES;
  gba_sound_missed(PICTURE_FRAMES);
  songAfterLag = MUS_GARDEN;
  g.flags = 1;
  g.main = garden_frame;
}

const uint8_t *garden_at(uint32_t address) { return at(address); }
int garden_random(void) { return random15(); }
uint16_t garden_pressed(void) { return input.pressed; }
uint16_t garden_held(void) { return input.held; }
int garden_language(void) { return g.language; }
void garden_run(void (*frame)(void)) { g.main = frame; }
void garden_not_in_c(void) { not_in_c(); }
void garden_lag(int frames) { lagging = frames; }
void garden_add_rings(int won) {
  rings += (uint32_t)won;
  if (rings > 99999) rings = 99999;
}
void garden_unpack_vram(uint32_t from, uint32_t vramAddress) { unpack_vram(from, vramAddress); }
void garden_unpack_halfwords(uint32_t from, uint16_t *to, int count) {
  // unpacked aside first: nothing here copies from a byte still waiting for its halfword
  static uint8_t bytes[0x400];
  uint32_t n = gba_lz77(at(from), PROGRAM_SIZE - (from - RAM), bytes, sizeof bytes);
  for (uint32_t i = 0; i + 1 < n && (int)(i / 2) < count; i += 2) to[i / 2] = (uint16_t)le16(bytes, (int)i);
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
  // the frame count goes on through the V-blanks of the frames the unpacking takes
  config[2] = e.frameCount + UNPACK_FRAMES + le32(save.bytes, 0x42C);
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
void garden_step(void) {
  int frame = running++;
  // the garden reads the buttons as its frame starts, just after the V-blank, where the console's frame has them
  uint16_t keys = gba_vblank_keys();
  gba_on_hblank(NULL);
  if (stopped) return;
  if (frame == UNPACKED) game_init();
  else if (frame == SOUND_INIT)
    gba_sound_start_program(PROGRAM_AT, PROGRAM_SIZE, PLAYER_TABLE, LIBRARY_SONIC_ADVANCE, 4, 4, 15, 10512, 0);
  else if (frame == INIT_GARDEN) {
    if (read_input(keys)) init_garden();
    else not_in_c();
    g.frames++;
  } else if (frame == SONG_STARTS) gba_sound_play(MUS_GARDEN);
  else if (frame >= FIRST_FRAME) {
    // work that ran past a V-blank: the loop misses those frames whole, buttons and all
    if (lagging) {
      if (--lagging == 0 && songAfterLag) {
        gba_sound_play(songAfterLag);
        songAfterLag = 0;
      }
      return;
    }
    if (!read_input(keys)) { not_in_c(); return; }
    g.main();
    g.frames++;
  }
}
