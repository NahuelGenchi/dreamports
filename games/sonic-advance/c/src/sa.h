// Sonic Advance Dreamport in C: what its files share. Each is translated from the JavaScript version's file of the
// same name in games/sonic-advance/src/, a function at a time, and names the original's functions as it does.

#ifndef SA_H
#define SA_H

#include "gba.h"

// the C library functions the kit gives (kit/gba/c/libc.c)
void *memcpy(void *restrict to, const void *restrict from, size_t n);
void *memset(void *to, int value, size_t n);
void *memmove(void *to, const void *from, size_t n);

#define s8(v) ((int8_t)(v))
#define s16(v) ((int16_t)(v))
#define u8(v) ((uint8_t)(v))
#define u16(v) ((uint16_t)(v))

// --- the player's copy (kit/gba/rom/rom.js): offsets in the file, and pointers as the cartridge has them ----------
#define ROM_BASE 0x08000000u
static inline uint32_t rom_u8(uint32_t at) { return at < gba_rom_size ? gba_rom[at] : 0; }
static inline uint32_t rom_u16(uint32_t at) { return rom_u8(at) | rom_u8(at + 1) << 8; }
static inline uint32_t rom_u32(uint32_t at) { return rom_u16(at) | rom_u16(at + 2) << 16; }
static inline int32_t rom_s16(uint32_t at) { return (int16_t)rom_u16(at); }
static inline int32_t rom_s32(uint32_t at) { return (int32_t)rom_u32(at); }
/** The file offset a pointer at `at` points to. */
static inline uint32_t rom_ptr(uint32_t at) { return rom_u32(at) - ROM_BASE; }

// where the tables are in Sonic Advance (USA), the only copy this version takes (rom/versions.js)
enum {
  OFFSET_SPRITE_TABLES = 0x0D868C, OFFSET_TILEMAPS = 0x4A6C40, OFFSET_UI_GRAPHICS = 0x680A38,
  OFFSET_INTRO_GRAPHICS = 0x69EC10, OFFSET_INTRO_TABLES = 0x684178, OFFSET_LANGUAGE_BACKGROUND = 0x6C7BD0,
  OFFSET_COURSE_SELECT_BACKGROUND = 0x69A6D0, OFFSET_OPTIONS_BACKGROUND = 0x6C5650,
};

// --- the original's sine table (engine/trig.js), 1.25 turns of 1024 steps in Q2.14 -------------------------------
extern const int16_t SINE[1280];

// --- the engine (gba/engine.js) ---------------------------------------------------------------------------------
enum {
  FLAGS_UPDATE_BG_PALETTES = 0x1, FLAGS_UPDATE_OBJ_PALETTES = 0x2, FLAGS_HBLANK_COPY = 0x4, FLAGS_KEEP_HBLANK_BUFFER = 0x20,
  FLAGS_PAUSE_GAME = 0x400, FLAGS_PAUSED = 0x800, FLAGS_NO_RESET = 0x8000,
};
enum { TASK_INACTIVE = 0x1, TASK_DESTROY_DISABLED = 0x2, TASK_RUNS_PAUSED = 0x4 };
#define HBLANK_BUFFER (160 * 4)
#define HEAP_END 0xFFFFFFFFu

typedef struct Task Task;
typedef void (*TaskMain)(Task *);
struct Task {
  TaskMain main, dtor;
  uint16_t priority, flags;
  void *data;
  Task *parent, *prev, *next;
};

/** What a copy to VRAM takes (struct Graphics): from `src` in the ROM, or in `ram` when it's set, to VRAM `dest`. */
typedef struct {
  uint32_t src;
  uint32_t dest;
  uint32_t size;
  uint16_t anim;
  const uint8_t *ram;
} Graphics;

/** A background (struct Background, gba/background.js). */
typedef struct {
  Graphics graphics;
  uint32_t layoutVram, layout;
  uint16_t xTiles, yTiles, unk18, unk1A, tilemapId, unk1E, unk20, unk22, unk24, targetTilesX, targetTilesY;
  uint8_t paletteOffset;
  uint16_t flags;
  int16_t scrollX, scrollY, prevScrollX, prevScrollY;
} Background;

typedef struct { int32_t pa, pb, pc, pd, x, y; } Affine;

typedef struct {
  uint16_t flags, flagsPreVBlank;
  uint32_t frameCount;
  // the RAM copies of the display registers (gDispCnt, gBgCntRegs, gBgScrollRegs, gBgAffineRegs, gWinRegs, gBldRegs)
  uint16_t dispCnt, bgCnt[4], bgScroll[8];
  Affine bgAffine[2];
  uint16_t winRegs[6], bldCnt, bldAlpha, bldY;
  uint16_t bgPalette[256];
  uint16_t *objPalette;   // in IWRAM right after the H-blank buffers
  uint16_t oamBuffer[128 * 4];
  uint8_t *hblank;        // the H-blank DMA's two buffers (gBgOffsetsBuffer)
  uint32_t primary, hblankTarget, hblankSize;
  // the keys (gInput and the rest)
  uint16_t input, prevInput, pressed, released, repeated;
  uint8_t repeatCounters[10], firstRepeat[10], nextRepeat[10];
  uint16_t keys;
  Task *curTask;
  // gBgSprites_Unknown1 and 2: a rectangle of a layer's map to fill in the next V-blank
  struct { uint16_t value; uint8_t rect[4]; } mapFill[4];
  uint16_t oamMalloc[128 * 4];
  uint32_t oamFreeIndex;
  Task *uiTask;
} Engine;

extern Engine e;

void engine_init(void);
Task *create_task(TaskMain main, void *data, uint16_t priority, uint16_t flags, TaskMain dtor);
void destroy_task(Task *t);
void destroy_tasks(uint16_t lo, uint16_t hi);
void engine_stall(int frames, void (*then)(void));
void engine_lag(int frames, int late);
void queue_graphics(Graphics *g);
void clear_queues(void);
void queue_background(Background *bg);
int alloc_oam(uint32_t order);
uint32_t vram_malloc(uint32_t tiles);
void vram_free(uint32_t dest);
void set_hblank_copy(uint32_t target, uint32_t size);
void engine_run(void);
void engine_draw_setup(void);

// the sound the screens start (m4aSongNumStart and the rest): the kit in C has no sound yet (#604)
void play_song(int song);
void play_song_or_continue(int song);
void stop_song(int song);
void stop_all_songs(void);
enum { SONG_INTRO = 1, SONG_TITLE_FANFARE = 2, SONG_CHARACTER_SELECTION = 3, SONG_SEGA_RING = 102, SONG_SELECT = 106,
  SONG_RETURN = 107, SONG_MENU_CURSOR = 108, SONG_BOSS_FIGHT = 29,
  SONG_SHIFT = 103, SONG_RING = 117 };

/** The BIOS's Div: rounded toward 0; a division by 0 gives ±1, as mGBA's BIOS does. */
static inline int32_t bios_div(int32_t a, int32_t b) { return b == 0 ? (a < 0 ? -1 : 1) : a / b; }

// --- sprites (gba/sprite.js) ------------------------------------------------------------------------------------
enum {
  SPRITE_ROT_SCALE = 0x1F, SPRITE_ROT_SCALE_ENABLE = 0x20, SPRITE_DOUBLE_SIZE = 0x40, SPRITE_OBJ_MODE = 0x180,
  SPRITE_X_FLIP = 0x400, SPRITE_Y_FLIP = 0x800, SPRITE_PRIORITY = 0x3000, SPRITE_ANIM_OVER = 0x4000,
  SPRITE_GLOBAL_OFFSET = 0x20000, SPRITE_KEEP_PALETTE = 0x40000, SPRITE_KEEP_TILES = 0x80000,
};
#define OBJ_VRAM 0x10000u
#define NO_FRAME 0xFFFFFFFFu

typedef struct { int32_t index; int8_t left, top, right, bottom; } Hitbox;
typedef struct {
  Graphics graphics;
  uint32_t dimensions;   // the frame's size entry, a ROM offset, or NO_FRAME
  uint32_t frameFlags;
  uint16_t animCursor;
  int16_t x, y;
  uint16_t oamFlags;
  int16_t qAnimDelay;
  uint16_t prevAnim;
  uint8_t variant, prevVariant, animSpeed, oamBaseIndex, numSubFrames, palId;
  Hitbox hitboxes[16];
} Sprite;

typedef struct { uint32_t anims, dims, oam, palettes, tiles4, tiles8; } SpriteTables;
extern SpriteTables sprites;
typedef struct { uint16_t rotation; int16_t qScaleX, qScaleY, x, y; } Transform;

/** A sprite at its defaults (createSprite). */
void sprite_init(Sprite *s);
int update_sprite(Sprite *s, int background);
void rotate_sprite(Sprite *s, const Transform *tf);
void transform_sprite(Sprite *s, const Transform *tf);
void display_sprite(Sprite *s);
void display_sprite_background(Sprite *s);
void write_sprite_map(Sprite *s);
void queue_sprite_map(Sprite *s);

// --- backgrounds (gba/background.js) --------------------------------------------------------------------------
void background_init(Background *bg);
void draw_background(Background *bg);
void transform_background(Affine *affine, int angle, int scaleX, int scaleY, int x, int y, int cx, int cy);

// --- line-by-line effects (gba/lines.js) ------------------------------------------------------------------------
void put16(uint32_t at, uint32_t v);
void scroll_lines(int bg, int minY, int maxY, int h, int v);
void fill_lines(int bg, int minY, int maxY, int h, int v);
void shear_lines(int bg, int minY, int maxY, int shift, int step, int h, int v);
void window_right(int bg, int x1, int y1, int x2, int y2, int left);
void window_left(int bg, int x1, int y1, int x2, int y2, int right);
void window_between(int bg, const uint8_t p[8]);

// --- the screens' pictures, text and fades (front/ui.js) ---------------------------------------------------------
typedef struct { uint32_t unk0; int32_t unk4; uint8_t unk8, unk9, unkA, unkB; } UiSlot;
typedef struct {
  uint32_t tiles, tilesSize, layout_, layoutSize, palette, paletteSize, vramC;   // ROM offsets, sizes in bytes
  const uint16_t *colours;   // colours a screen keeps in its own memory, in place of `palette`
  uint8_t unk28, unk29, unk2A, uiGfxID;
  int unk2B;                 // the slot, or -1 for none
  const UiSlot *layout;      // the slot's layout, as ui_graphics gives it, or NULL
} UiGfx;
typedef struct { int16_t unk0; uint16_t unk2, unk4; int16_t unk6, unk8; uint16_t unkA; } Fade;
typedef struct { uint16_t unk0, unk2, unk4, unk6, unk8, unkA, unkC, unkE, unk10, unk12, unk16; } UiText;
typedef uint8_t (*Glyphs)(const void *text, int i);

void create_ui_task(void);
void ui_gfx_stack_init(void);
UiSlot *ui_slots(void);
void ui_graphics(int id, uint32_t *tiles, uint32_t *palette, UiSlot *layout);
void load_ui_gfx(const UiGfx *gfx);
Fade create_fade(int16_t unk0, uint16_t unk2, uint16_t unk4, int16_t unk6, int16_t unk8, uint16_t unkA);
int fade_step(Fade *f);
void fade_show(Fade *f);
void set_ui_affine(int angle, int sx, int sy, int index);
void draw_ui_text(const char *text, const UiText *o, int solid);
void draw_ui_glyphs(const char *text, const UiText *o, int behind);

// --- a spotlight's beam (front/spotlight.js) ---------------------------------------------------------------------
typedef struct { int32_t unk0, unk2, unk4, unk6, unk8, bg, unkB; } Beam;
Task *create_spotlight_beam(Beam *beam);

// --- the save (engine/save.js) ---------------------------------------------------------------------------------
#define SAVE_SIZE 0x430
#define WRITE_FRAMES 14
typedef struct { uint8_t bytes[SAVE_SIZE]; int exists; } Save;
extern Save save;
void save_open(void);
int save_write(void);
#define SAVE_UI_LANGUAGE (save.bytes[0x19])
uint16_t save_unlocked_level(int character);

// --- the screens before the act (front/) --------------------------------------------------------------------------
typedef struct {
  int character, partner, gameMode, level;
  int done;   // the front end has handed over to what isn't in C yet
} Front;
extern Front ctx;

void front_start(void);
void front_step(uint16_t keys);
void front_draw(void);

void create_language_screen(int newGame);
void create_sega_logo(void);
void create_intro(void);
void create_title_screen(int playMusic);
void front_play(int level);
void front_start_demo(void);

#endif
