// The game's start before the act, translated from front/front.js: the language screen, the SEGA and Sonic Team logos,
// the intro, the title screen and its menus, run on the engine (engine.c) at the console's own rate. A new game, with
// no save yet, starts with the language screen (language.c), which writes the save; with a save, the game starts with
// the logos (logos.c). What isn't in C yet stops the game where it starts, with the screen as it was.

#include "sa.h"
#include "page.h"
#include "act.h"
#include "special.h"

void dp_sound_skip_frames(int frames);

// the frames after power-on before the game starts: the console is still starting up, the screen white (forced blank),
// and gFrameCount isn't counted yet (VBlankIntr, which counts it, starts with GameInit)
#define STARTUP_FRAMES 6
// the frames from a soft reset's V-blank to the first screen: the BIOS forces the screen blank at once, and the game's
// start (EngineInit, GameInit) runs before the next frames show anything
#define RESET_FRAMES 6

Front ctx;
static int startingUp;
int act_active;
static uint32_t pageFrame;

/** The page's frame since power-on, as a recording counts them. */
uint32_t front_frame(void) { return pageFrame ? pageFrame - 1 : 0; }

// the start point's words (tools/README.md): a recording opens the game at a part with them, and the original gets
// there by its own presses. `unlocked` gives the game a save of its own, kept nowhere, with the character's progress
// at its value and, when they are there, the others' and the Chaos Emeralds', as main.js's proofSave does at Game Start.
static struct {
  int unlocked, unlockedGiven;
  int levels[4];      // sonic, tails, knuckles and amy; -1 when the word isn't there
  int emeralds;       // -1 when the word isn't there
} startPoint;
static const char *const START_CHARACTERS[4] = { "sonic", "tails", "knuckles", "amy" };

/** The page's address's start point, read once the engine has started. */
static void read_start_point(void) {
  const char *unlocked = gba_start_point("unlocked");
  startPoint.unlockedGiven = unlocked != NULL;
  startPoint.unlocked = startPoint.unlockedGiven ? (int)gba_start_number("unlocked", 0) & 0xFFFF : 0;
  for (int c = 0; c < 4; c++) startPoint.levels[c] = (int)gba_start_number(START_CHARACTERS[c], -1);
  startPoint.emeralds = (int)gba_start_number("emeralds", -1);
  ctx.character = (int)gba_start_number("character", 0);
  if (ctx.character < 0) ctx.character = 0;
  if (ctx.character > 3) ctx.character = 3;
  ctx.select = !startPoint.unlockedGiven || gba_start_point("select") != NULL;
  ctx.currentLevel = startPoint.unlockedGiven ? (int)gba_start_number("current", 0) : 0;
  ctx.startLevel = startPoint.unlockedGiven ? (int)gba_start_number("started", 0) : 0;
}

/**
 * The progress a start point gives the save as Game Start is pressed, as the JavaScript version's page does: the
 * characters' levels, then the level being played's own, which wins, and the Chaos Emeralds.
 */
static void apply_start_point(void) {
  if (!startPoint.unlockedGiven) return;
  for (int c = 0; c < 4; c++) if (startPoint.levels[c] >= 0) save_set_unlocked_level(c, (uint16_t)startPoint.levels[c]);
  save_set_unlocked_level(ctx.character, (uint16_t)startPoint.unlocked);
  if (startPoint.emeralds >= 0) SAVE_CHAOS_EMERALDS = (uint8_t)(startPoint.emeralds & ALL_EMERALDS);
}

/** Game Start: the character select, unless a start point leaves it out, and then the course select once the
 *  character has progress, or the act. */
void front_start_game(void) {
  apply_start_point();
  if (ctx.select) { create_character_select(ctx.character); return; }
  // the frames the original's character select ran, which the start point names as `only`: its sound engine ran them
  int only = (int)gba_start_number("only", 0);
  if (only > 0) {
    gba_sound_frames_gone_by(only);
    dp_sound_skip_frames(only);
  }
  if (ctx.gameMode == GAME_MODE_TIME_ATTACK || save_unlocked_level(ctx.character) != 0) create_course_select();
  else front_play(-1);
}

/**
 * GameInit: the language screen when there is no save (a new game), else the logos, or, after a soft reset, which sets
 * FLAGS_SKIP_INTRO, the title screen with its music.
 */
static void power_on(int skipIntro) {
  if (!save.exists) create_language_screen(1);
  else if (skipIntro) create_title_screen(1);
  else create_sega_logo();
}

// the V-blank found A, B, Start and Select held: the frame ends there, and the game starts again once it is over
static int resetting;
static void soft_reset_seen(void) { resetting = 1; }

/** A new engine, as the JavaScript version's page makes one for each new start (gba/engine.js createEngine): for the
 *  special stage, the act after it, and the game after a soft reset. */
void front_new_engine(void) {
  engine_init();
  e.softReset = soft_reset_seen;
}

/** The front end from power-on: the screen forced blank until the game starts. */
void front_start(void) {
  memset(&ctx, 0, sizeof ctx);
  front_new_engine();
  read_start_point();
  sprites.anims = rom_ptr(OFFSET_SPRITE_TABLES);
  sprites.dims = rom_ptr(OFFSET_SPRITE_TABLES + 4);
  sprites.oam = rom_ptr(OFFSET_SPRITE_TABLES + 8);
  sprites.palettes = rom_ptr(OFFSET_SPRITE_TABLES + 12);
  sprites.tiles4 = rom_ptr(OFFSET_SPRITE_TABLES + 16);
  sprites.tiles8 = rom_ptr(OFFSET_SPRITE_TABLES + 20);
  gba_write(REG_DISPCNT, 0x80);
  startingUp = STARTUP_FRAMES;
}

/**
 * VBlankIntr's SoftReset: the game starts again, from the title screen (GameInit with FLAGS_SKIP_INTRO) once
 * RESET_FRAMES of blank screen have gone by, with the save as it is and the character last chosen. The sound engine
 * starts again from nothing, the sound chip going on as it was; the act or the special stage, if it was running, stops;
 * the engine and the video hardware are as the console's start leaves them, so the frame the reset is in already shows
 * the blank, as the JavaScript version's page draws it (main.js softReset, front.js afterReset).
 */
static void soft_reset(void) {
  resetting = 0;
  gba_sound_reset();
  // the screen that was running stops every music player as the game starts again, on the new engine, as the
  // JavaScript version's page stops it (main.js start)
  stop_all_songs();
  if (act_active) {
    // gCurrentLevel stays the act's
    ctx.currentLevel = act_level();
    act_soft_reset();
  }
  Front was = ctx;
  memset(&ctx, 0, sizeof ctx);
  ctx.character = was.character;
  ctx.select = was.select;
  ctx.currentLevel = was.currentLevel;
  ctx.startLevel = was.startLevel;
  ctx.afterReset = 1;
  spGame.continues = 0;
  front_new_engine();
  engine_clear_video();
  gba_write(REG_DISPCNT, 0x80);
  startingUp = RESET_FRAMES;
}

/**
 * A start point's `special` (main.js `?special`): the game opens at the special stage the act `level` (0 if not given)
 * leads to, as if the character had just left it on its special spring at a new game's start, with a save of its own
 * kept nowhere. gFrameCount is where the original's is at a new game's act (game.js START_FRAME_COUNT).
 */
#define START_FRAME_COUNT 3838
int front_special_start_point(void) {
  if (!gba_start_point("special") || !act_special_start_point((int)gba_start_number("level", 0))) return 0;
  startingUp = 0;
  e.frameCount = START_FRAME_COUNT;
  special_stage_enter();
  return 1;
}

/** A frame, with the buttons in `keys` held. */
void front_step(uint16_t keys) {
  pageFrame++;
  if (act_active) {
    e.keys = keys;
    engine_run();
    link_frame_done();
    // a special spring sent the character out of the act this frame: the special stage, from the next
    if (act_special_pending()) act_to_special_stage();
  } else if (startingUp > 0) {
    if (--startingUp == 0) {
      // after a soft reset the sound engine runs on, as m4aSoundInit leaves it
      if (!ctx.afterReset) sound_vsync_on();
      power_on(ctx.afterReset);
    }
  } else if (!ctx.done) {
    e.keys = keys;
    engine_run();
    link_frame_done();   // a GBA with no cable has a link of its own, with nothing on it
  }
  if (resetting) soft_reset();
  engine_draw_setup();
}

/** PSEUDO_RANDOM_32: the game's random numbers. None are drawn before the VS menus. */
uint32_t front_random(void) {
  ctx.seed = ctx.seed * 0x196225u + 0x3C6EF35Fu;
  return ctx.seed;
}

void front_random_seed(uint32_t seed) { ctx.seed = seed; }

/**
 * The VS menus have chosen the round: Chao Hunt's `level`, with the Chao at place `chao`. The round isn't in C yet, so
 * the game stops here, and the page shows the black the original's screens are while its stage loads (main.js).
 */
void front_vs_round(int level, int chao) {
  ctx.roundLevel = level;
  ctx.roundChao = chao;
  ctx.done = 1;
}
/** The round the VS menus chose, for the page: its level, or 0 while they are still choosing. */
EXPORT("dp_vs_round") int dp_vs_round(void) { return ctx.roundLevel; }

// The acts in C (levels.c), which the course select's rows start with their title cards. A start point's `level` opens
// a level, past its card when it asks; from the menus, an act that isn't in C yet, and Options, stops safely where the
// screen is.
void front_play(int level) {
  int startLevel = (int)gba_start_number("level", -1);
  int fromStart = startLevel >= 0;
  if (!fromStart) startLevel = level;
  // Game Start after the character select hands the act the level the game was started on (0 for a new game)
  if (level < 0 && startLevel < 0) startLevel = ctx.startLevel >= 0 ? ctx.startLevel : 0;
  if (!level_in_c(startLevel) && !fromStart) { ctx.done = 1; return; }
  act_active = 1;
  // a new game's act comes from the character select, whose HUD's zero-ring flash starts at 1; a course select
  // or a start point starts it from the stage's own value (levels.js hudFlash)
  actHudFlash = level < 0 ? 1 : -1;
  int card = (int)gba_start_number("card", -1), pre = (int)gba_start_number("pre", 0);
  if (fromStart) {
    destroy_tasks(0x2000, 0x3000);
    act_start(startLevel, card, pre);
    act_frame_now();
    return;
  }
  if (level < 0) {
    // Game Start after the character select: the screen stays black for this frame, as the original's menu fades
    // to black before its stage's first picture
    if (level_row(startLevel)->blackAtGameStart) { act_start(startLevel, -1, 0); act_hold_black(); }
    else { destroy_tasks(0x2000, 0x3000); act_start(startLevel, -1, 0); act_frame_now(); }
    return;
  }
  destroy_tasks(0x2000, 0x3000); act_start(startLevel, -1, 0);
  act.byCourseSelect = 1;
  sound_late(LOAD_ACT_COURSE_SELECT, startLevel);
  // an act whose objects first run on its first frame steps the rings once more on its hand-over frame than the
  // original's stage init does
  if (level_row(startLevel)->runsFromFirstFrame) rings_skip_first_update();
  act_frame_now();
}
void front_start_demo(void) { ctx.done = 1; }

/** The act a Time Attack card hands over to, made inside the card's task (TimeAttack card's Task_806BBC0). */
void front_time_attack_play(int level) {
  act_active = 1;
  actHudFlash = 1;
  destroy_tasks(0x2000, 0x3000);
  act_start(level, -1, 0);
  act.byCourseSelect = 1;
  sound_late(LOAD_ACT_TIME_ATTACK, level);
  act_frame_now();
  act_made_at_card_priority();
  // its loading takes two V-blanks, the second not counted in the frame counter
  act.stallLoad = 2;
}

// the sound the screens start, on the kit's sound engine (gba/engine.js's playSong and the rest)
void play_song(int song) { gba_sound_play(song); }                            // m4aSongNumStart
void play_song_or_continue(int song) { gba_sound_start_or_continue(song); }  // m4aSongNumStartOrContinue
void play_song_or_change(int song) { gba_sound_play_or_change(song); }       // m4aSongNumStartOrChange
void stop_song(int song) { gba_sound_stop(song); }                            // m4aSongNumStop
void fade_out_sound(int player, int speed) { gba_sound_fade_out(player, speed); }  // m4aMPlayFadeOut
void stop_all_songs(void) { gba_sound_stop_all(); }                           // m4aMPlayAllStop
void sound_vsync_off(void) { gba_sound_vsync_off(); }                         // m4aSoundVSyncOff
void sound_vsync_on(void) { gba_sound_vsync_on(); }                           // m4aSoundVSyncOn

