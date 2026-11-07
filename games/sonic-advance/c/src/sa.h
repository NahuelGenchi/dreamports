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
  OFFSET_NAME_INPUT_MAPS = 0x67DC38, OFFSET_NAME_INPUT_CHARS = 0x681340,
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

// the sound the screens start (m4aSongNumStart and the rest), on the kit's sound engine (front.c)
void play_song(int song);
void play_song_or_continue(int song);
void stop_song(int song);
void stop_all_songs(void);
enum { SONG_INTRO = 1, SONG_TITLE_FANFARE = 2, SONG_CHARACTER_SELECTION = 3, SONG_NEO_GREEN_HILL_1 = 12,
  SONG_SEGA_RING = 102, SONG_SELECT = 106,
  SONG_RETURN = 107, SONG_MENU_CURSOR = 108, SONG_BOSS_FIGHT = 29,
  SONG_SHIFT = 103, SONG_RING = 117,
  SONG_COURSE_SELECTION = 4, SONG_VS_PLEASE_WAIT = 5, SONG_VS_LOBBY = 6, SONG_PLAYER_DATA = 48,
  SONG_VS_LOBBY_HELLO = 156, SONG_VS_LOBBY_CLOSED = 160,
  SONG_CONNECTION_SUCCESS = 301, SONG_CONNECTION_ERROR = 302, SONG_CONNECTION_CLOSED = 303 };
void play_song_or_change(int song);
void sound_vsync_off(void);
void sound_vsync_on(void);

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
void draw_ui_text_rotated(const char *text, const UiText *o);

// --- a spotlight's beam (front/spotlight.js) ---------------------------------------------------------------------
typedef struct { int32_t unk0, unk2, unk4, unk6, unk8, bg, unkB; } Beam;
Task *create_spotlight_beam(Beam *beam);

// --- the save (engine/save.js) ---------------------------------------------------------------------------------
#define SAVE_SIZE 0x430
#define WRITE_FRAMES 14
// ALL_ZONE_CHAOS_EMERALDS and MOON_BEATEN, and the Moon Zone's own level and X Zone's (engine/unlock.js)
#define ALL_EMERALDS 0x7F
#define MOON_BEATEN 15
typedef struct { uint8_t bytes[SAVE_SIZE]; int exists, keep; } Save;
extern Save save;
void save_open(void);
int save_write(void);
void save_set_unlocked_level(int character, uint16_t level);
#define SAVE_UI_LANGUAGE (save.bytes[0x19])
#define SAVE_CHAOS_EMERALDS (save.bytes[0x1C])
#define SAVE_PLAYER_NAME (save.bytes + 0x10)            // six characters of the UI font, and two unused
#define SAVE_MULTIPLAYER_SCORES (save.bytes + 0x380)    // ten of a player id, a name, wins, losses and draws
#define NAME_LENGTH 6
uint32_t save_player_id(void);                          // unk4: the frame count when the name was last changed
void save_set_player_id(uint32_t id);
uint16_t save_unlocked_level(int character);

// --- the link cable between GBAs on one page (link.c) -------------------------------------------------------------
#define PACKET_SIZE 20
#define PLAYERS_MAX 4
int link_id(void);
int link_count(void);
uint8_t *link_send(void);
void link_enable(int on);
const uint8_t *link_slot(int n);
int link_flags(void);
int link_data(int n);
int packet_kind(const uint8_t *packet);
void link_frame_done(void);
// a packet's or the save's little-endian halfwords and words
static inline uint32_t le16(const uint8_t *b, int at) { return b[at] | b[at + 1] << 8; }
static inline uint32_t le32(const uint8_t *b, int at) { return le16(b, at) | le16(b, at + 2) << 16; }
static inline void set_le16(uint8_t *b, int at, uint32_t v) { b[at] = (uint8_t)v; b[at + 1] = (uint8_t)(v >> 8); }
static inline void set_le32(uint8_t *b, int at, uint32_t v) { set_le16(b, at, v); set_le16(b, at + 2, v >> 16); }
static inline void set_kind(uint8_t *packet, int kind) { set_le16(packet, 0, (uint32_t)kind); }

// --- the screens before the act (front/) --------------------------------------------------------------------------
/** What the VS menus share once the GBAs are linked (ctx.vsLink): the round's seed, who is playing, where each other
 *  player is in the save's records, the characters they picked, and how far the furthest of them has got. */
typedef struct {
  int set;
  uint32_t seed;
  uint16_t connections;
  uint8_t records[PLAYERS_MAX], characters[PLAYERS_MAX], furthest;
} VsLink;

typedef struct {
  int character, partner, gameMode, level;
  int select;   // the main menu's Game Start opens the character select, unless a start point leaves it out
  int currentLevel, startLevel;   // gCurrentLevel and gMultiplayerCurrentLevel, for the Moon Zone's rule
  int done;   // the front end has handed over to what isn't in C yet
  VsLink vsLink;
  int missing[PLAYERS_MAX];   // gMultiplayerMissingHeartbeats: the frames each GBA of the link hasn't been heard from
  uint32_t seed;              // the game's random numbers (PSEUDO_RANDOM_32)
  // the round the VS menus chose, once they have: its level, its seed and the Chao's place
  int roundLevel, roundChao;
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
uint32_t front_random(void);
void front_start_game(void);   // the main menu's Game Start: the course select once the character has progress
void create_main_menu(int back);
void create_character_select(int character);
void create_course_select(void);

// --- the VS menus (vs.c and the screens after it) ------------------------------------------------------------------
enum { GAME_MODE_SINGLE_PLAYER = 0, GAME_MODE_TIME_ATTACK = 1, GAME_MODE_RACE = 2, GAME_MODE_CHAO_HUNT = 4 };
void vs_sprite(Sprite *s, uint16_t anim, uint32_t dest, int x, int y, uint16_t oamFlags, int variant, uint32_t frameFlags);
void vs_background(Background *bg, uint16_t tilemapId, uint32_t layoutVram, uint16_t w, uint16_t h);
void vs_clear_map(int bg, uint8_t lastRow);
int vs_connections(void);
int vs_link_lost(void);
void vs_leave_link(void);
const uint8_t *vs_record(int i);
const uint8_t *vs_name(int i);
void vs_reset_missing(void);
void create_mode_select(void);
void create_name_input(void);
void create_multipack_outcome(int outcome);
void create_link_error(void);
void create_lobby(int mode);
void create_game_select(void);
void create_character_select(int selected);
void create_vs_character_select(void);
void create_vs_overview(void);
void create_vs_teams(void);
void create_vs_chao_select(void);
void front_vs_round(int level, int chao);

#endif
