// Sonic Advance 3 Dreamport in C: what its files share. Each is written from the original, a function at a time, as
// the JavaScript version's file of the same name in games/sonic-advance-3/src/ is, and names the original's functions
// as it does, with the addresses of the USA copy, as `npm run dp -- read` prints it.

#ifndef SA3_CORE_H
#define SA3_CORE_H

#include "gba.h"

// the C library functions the kit gives (kit/c/libc.c)
void *memcpy(void *restrict to, const void *restrict from, size_t n);
void *memset(void *to, int value, size_t n);

// --- the player's copy: offsets in the file, and pointers as the cartridge has them ----------------------------------
#define ROM_BASE 0x08000000u
static inline uint32_t rom_u8(uint32_t at) { return at < gba_rom_size ? gba_rom[at] : 0; }
static inline uint32_t rom_u16(uint32_t at) { return rom_u8(at) | rom_u8(at + 1) << 8; }
static inline uint32_t rom_u32(uint32_t at) { return rom_u16(at) | rom_u16(at + 2) << 16; }
static inline int32_t rom_s16(uint32_t at) { return (int16_t)rom_u16(at); }
static inline int32_t rom_s32(uint32_t at) { return (int32_t)rom_u32(at); }
/** The file offset a pointer at `at` points to. */
static inline uint32_t rom_ptr(uint32_t at) { return rom_u32(at) - ROM_BASE; }

// --- the engine (core.c) ---------------------------------------------------------------------------------------------
enum { FLAGS_UPDATE_BG_PALETTES = 0x1, FLAGS_UPDATE_OBJ_PALETTES = 0x2 };
#define OBJ_VRAM 0x10000u

typedef struct Task Task;
typedef void (*TaskMain)(Task *);
struct Task {
  TaskMain main;
  void *data;
  uint16_t priority;
};

typedef struct {
  uint16_t flags, flagsPreVBlank;
  // the RAM copies of the display registers (gDispCnt, gBgCntRegs, gBgScrollRegs, gWinRegs, gBldRegs)
  uint16_t dispCnt, bgCnt[4], bgScroll[8], winRegs[6], bldCnt, bldAlpha, bldY;
  uint16_t bgPalette[256], objPalette[256];
  uint16_t oamBuffer[128 * 4];
  // the keys (gInput and the rest)
  uint16_t input, prevInput, pressed, released, repeated;
  uint8_t repeatCounters[10], firstRepeat[10], nextRepeat[10];
  // the frames of the console's start-up still to go, and the screen to open on the next frame
  int startUp;
  void (*main)(void);
  // the save a game with nothing saved has (0x08001DDC), kept only until the page closes for now
  uint8_t language;
} Core;

extern Core c;

void core_init(void);
void core_step(uint16_t held);
Task *create_task(TaskMain main, void *data, uint16_t priority);
void destroy_task(Task *t);
void queue_graphics(uint32_t src, uint32_t dest, uint32_t size);
void queue_background(uint32_t layout, uint16_t xTiles, uint32_t layoutVram, uint16_t targetTilesX, uint16_t targetTilesY,
                      uint16_t flags);
int alloc_oam(uint32_t order);
extern uint16_t oam_malloc[128 * 4];
void default_display(void);

// the sound the screens start, on the kit's sound engine: 0x080BA1F4, m4aSongNumStart
static inline void play_song(int song) { gba_sound_play(song); }

// --- sprites (sprite.c) -----------------------------------------------------------------------------------------------
enum {
  SPRITE_ROT_SCALE = 0x1F, SPRITE_ROT_SCALE_ENABLE = 0x20, SPRITE_DOUBLE_SIZE = 0x40, SPRITE_X_FLIP = 0x400,
  SPRITE_Y_FLIP = 0x800, SPRITE_PRIORITY = 0x3000, SPRITE_OBJ_MODE = 0x180,
};

typedef struct { int32_t index; int8_t left, top, right, bottom; } Hitbox;

/** A sprite (struct Sprite), with its tiles `tiles` as a VRAM offset. */
typedef struct {
  uint32_t tiles;
  uint16_t anim, prevAnim;
  uint8_t variant, prevVariant;
  int32_t frameNum;
  uint32_t frameFlags;
  uint16_t animCursor;
  int16_t qAnimDelay;
  uint8_t animSpeed, palId;
  uint16_t oamFlags;
  int16_t x, y;
  int oamBaseIndex;
  Hitbox hitboxes[16];
} Sprite;

void sprite_init(Sprite *s, uint32_t tiles, uint16_t anim, uint8_t variant, uint16_t oamFlags);
int update_sprite(Sprite *s);
void display_sprite(Sprite *s);

// --- backgrounds (background.c) ---------------------------------------------------------------------------------------
void draw_background(int id, uint32_t dest, uint32_t layoutVram, uint16_t targetTilesX, uint16_t targetTilesY, uint16_t flags);

// --- the screens -------------------------------------------------------------------------------------------------------
void language_screen(void);

#endif
