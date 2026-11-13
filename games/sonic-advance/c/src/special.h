// Sonic Advance's special stages in C, translated from the JavaScript version's special/ (run.js and the files after
// it), a file each: the fall into the stage (specialintro.c), the stage (specialstage.c, with its tables in
// specialstages.c and its sprites' matrices in specialsprites.c), the character in it (specialplayer.c) and what they
// meet (specialobjects.c), its title card, rings counter and pause menu (specialcard.c, specialhud.c,
// specialpause.c), and the results (specialresults.c). They run on the engine (engine.c) as the screens before the act
// do, and hand over to each other as the original's create functions call each other (specialrun.c).

#ifndef SPECIAL_H
#define SPECIAL_H

#include "sa.h"

// where the special stages' tables are in the copy (rom/versions.js)
enum {
  OFFSET_SPECIAL_STAGE = 0x47FEF4, OFFSET_SPECIAL_LAYOUTS = 0x7B97F8, OFFSET_CHARACTER_ANIMS = 0x4A6F04,
  OFFSET_SPECIAL_INTRO = 0x684480, OFFSET_SPECIAL_CLOUDS = 0x6B4B10,
};

// the special stages' songs and sounds (sound/songs.js)
enum {
  SONG_SPECIAL_STAGE_INTRO = 41, SONG_SPECIAL_STAGE = 42, SONG_SPECIAL_STAGE_TRICK = 43, SONG_SPECIAL_STAGE_CLEAR = 44,
  SONG_CHAOS_EMERALD = 45, SONG_SPECIAL_STAGE_LOSE = 46, SONG_SPECIAL_STAGE_WIN = 47, SONG_RINGS_LOST = 118,
  SONG_RESULT_COUNTER = 140, SONG_RESULT_COUNTER_DONE = 141, SONG_PAUSE = 142, SONG_EXPLOSION = 144,
  SONG_SPECIAL_DASH = 148, SONG_SPECIAL_TRICK = 149, SONG_SPECIAL_BUMPER = 150, SONG_SPECIAL_TOKEN = 151,
  SONG_RESULT_CONTINUE = 154,
};

/** C's division, which truncates, as the JavaScript version's div does: by 0 it gives 0. */
static inline int32_t sp_div(int32_t a, int32_t b) { return b == 0 ? 0 : a / b; }
#define I8(v) ((v) >> 8)

/**
 * What the act hands the special stage and gets back (run.js ctx.game): the level and the character, the save's
 * record of the Chaos Emeralds (a bit per stage), the continues the player has (gUnknown_0300543C), the score, the
 * lives, the game's random numbers (gPseudoRandom, which the special stage goes on with) and the save's button setting.
 */
typedef struct {
  int level, character, emeralds, continues, btnConfig, lives;
  uint32_t score, seed;
} SpecialGame;
extern SpecialGame spGame;

// --- the stages' tables (specialstages.c) ---------------------------------------------------------------------
typedef struct { int left, top, right, bottom; } SpBox;
/** The tables every stage shares (stages.js stageTables). */
typedef struct {
  int16_t areaAnims[10][2], dpadAnims[16][2], steer[16][2];
  SpBox wideHit, boostHit;
  int16_t dashAnims[6][2], dashSpeeds[16][3];
  uint16_t objectAnims[14][2], objectTiles[14];
  int16_t bumperRings[12][2], sparks[8][2], lostRings[10][2];
  uint16_t characterAnims[4];
} SpTables;
extern SpTables spTables;
/** A layout entry: where it is across the tunnel and how far down it, and what it is (0 a ring, 0x7FFF the checkpoint,
 *  0xFFFF the goal, the others an object of that kind). */
typedef struct { int32_t x, y, depth; uint32_t type; } SpEntry;
#define SP_END 0xFFFF
#define SP_CHECKPOINT_ENTRY 0x7FFF
int sp_stage_of_level(int level);
void sp_read_tables(void);
SpEntry sp_entry(int i);

// --- the sprites' matrices (specialsprites.c) ---------------------------------------------------------------------
#define SP_NO_DEPTH 0x7FFF
#define SP_AFFINE 0x2020
#define SP_DOUBLE_SIZE 0x40
/** Where a sprite shows and how big: its place, and its scale across and down in 8.8. */
typedef struct { int x, y, scaleX, scaleY; } SpTransform;
int sp_depth_matrix(int depth);
void sp_set_matrix(int index, int scaleX, int scaleY);
void sp_transform(Sprite *s, const SpTransform *tf);
void sp_share_graphics(Sprite *s);
void sp_clear_shared(void);
SpBox sp_box(const Hitbox *h);
int sp_touches(int ax, int ay, SpBox a, int bx, int by, SpBox b);

// --- the character (specialplayer.c) ------------------------------------------------------------------------------
enum { SP_FLAG_STILL = 0x1, SP_FLAG_FAST = 0x2, SP_FLAG_ON_PAD = 0x4, SP_FLAG_HIT = 0x8, SP_FLAG_TRICK = 0x10,
       SP_FLAG_BUMPER_TRICK = 0x20 };
enum { SP_STATE_FLYING, SP_STATE_THROWN, SP_STATE_HIT, SP_STATE_TRICK, SP_STATE_BUMPER_TRICK };
enum { SP_END_CHECKPOINT = 0x40, SP_END_GOAL = 0x80 };
/** The character's state, the original's struct (gUnknown_03005690) with its fields named as player.js names them. */
typedef struct {
  int character;
  int32_t x, y, depth;
  int16_t screenX, screenY, lift;
  int phase;
  int16_t vx, vy, speed, unk1A, ax, ay, accel;
  int state, flags, end, unk2B, unk2E, unk30, unk31;
  int16_t timer, blink, trickTime;
  int turn;
  int8_t window, cooldown;
  int unk3F, unk40;
  uint16_t held, pressed, anim;
  int variant;
  int pad, lastPad, padKind;
  Sprite s;
  SpTransform tf;
} SpPlayer;
void sp_player_create(void);

// --- the stage (specialstage.c) --------------------------------------------------------------------------------
enum { SP_GOAL = 1, SP_CHECKPOINT = 2 };
/** The stage's globals (stage.js ctx.special). */
typedef struct {
  int index, targets[2], paletteAnim;
  uint32_t layout;          // the layout's first entry, a file offset
  int collected;            // gSpecialStageCollectedRings
  int target;               // gSpecialStageTargetRings: the checkpoint's target, then the goal's
  int extra;                // gUnknown_0300507C, what the stage's type 10 objects count
  int muted;                // gUnknown_03005730: the sound effects are off while the trick jingle plays
  int jump, attack;         // gPlayerControls: the jump and attack buttons
  struct { int kind, timer, blend; } checkpoint;   // gUnknown_030055E0
  struct { int16_t x, y; int frame, unk13; } bg;   // gUnknown_03005780: how far the tunnel moves, its frame
  int stageFlags;           // gStageFlags
  SpPlayer *player;
  int16_t *depths;          // the depths the 16 matrices are for this frame
  int8_t *matrices;         // which matrices are set this frame
  uint16_t *loaded;         // the animations being loaded (sprites.js shareGraphics)
  uint16_t chunks[16];      // where each 4096 lines of the layout start, for the rings
  int hudBlink;             // what the rings counter's blink starts from (specialhud.c)
  int se3;                  // the song the third sound effects' player last started
} Special;
extern Special sp;
void sp_stage_create(void);
void sp_se(int song);
void sp_play(int song);
void sp_trick_jingle(void);

// --- what the character meets (specialobjects.c) ------------------------------------------------------------------
enum { SP_MESSAGE_COOL, SP_MESSAGE_AAARGH, SP_MESSAGE_NOT_ENOUGH_RINGS };
void sp_spawner_create(void);
void sp_rings_create(void);
void sp_message_create(int msg);
void sp_lost_rings_create(void);
void sp_fall_effect_create(void);
void sp_objects_reset(void);

// --- the screens around it (specialintro.c, specialcard.c, specialhud.c, specialpause.c, specialresults.c) -----------
extern UiSlot spUiSlots[];   // the special stages' UI task's slots, kept from one stage to the next
extern int spStreaksLeft;    // the line the fall's last streak was on, where the rings counter's blink starts
int32_t sp_random(void);
void sp_intro_create(void);
void sp_emerald_scene_create(void);
void sp_title_card_create(int arg);
void sp_hud_create(void);
int sp_hud_runs(void);
void sp_pause_menu_create(void);
#define SP_SIGN_Y 80
void sp_results_create(int arg);

// --- the hand-over (specialrun.c) ---------------------------------------------------------------------------------
extern int spStageIndex;
void special_stage_enter(void);
void special_stage_back(void);

#endif
