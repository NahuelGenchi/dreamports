// The game's start before the act, translated from front/front.js: the language screen, the SEGA and Sonic Team logos,
// the intro, the title screen and its menus, run on the engine (engine.c) at the console's own rate. A new game, with
// no save yet, starts with the language screen (language.c), which writes the save; with a save, the game starts with
// the logos (logos.c). What isn't in C yet stops the game where it starts, with the screen as it was.

#include "sa.h"

// the frames after power-on before the game starts: the console is still starting up, the screen white (forced blank),
// and gFrameCount isn't counted yet (VBlankIntr, which counts it, starts with GameInit)
#define STARTUP_FRAMES 6

Front ctx;
static int startingUp;

/**
 * GameInit: the language screen when there is no save (a new game), else the logos, or, after a soft reset, which sets
 * FLAGS_SKIP_INTRO, the title screen with its music.
 */
static void power_on(int skipIntro) {
  if (!save.exists) create_language_screen(1);
  else if (skipIntro) create_title_screen(1);
  else create_sega_logo();
}

/** The front end from power-on: the screen forced blank until the game starts. */
void front_start(void) {
  memset(&ctx, 0, sizeof ctx);
  engine_init();
  sprites.anims = rom_ptr(OFFSET_SPRITE_TABLES);
  sprites.dims = rom_ptr(OFFSET_SPRITE_TABLES + 4);
  sprites.oam = rom_ptr(OFFSET_SPRITE_TABLES + 8);
  sprites.palettes = rom_ptr(OFFSET_SPRITE_TABLES + 12);
  sprites.tiles4 = rom_ptr(OFFSET_SPRITE_TABLES + 16);
  sprites.tiles8 = rom_ptr(OFFSET_SPRITE_TABLES + 20);
  gba_write(REG_DISPCNT, 0x80);
  startingUp = STARTUP_FRAMES;
}

/** A frame, with the buttons in `keys` held. */
void front_step(uint16_t keys) {
  if (startingUp > 0) {
    if (--startingUp == 0) power_on(0);
  } else if (!ctx.done) {
    e.keys = keys;
    engine_run();
  }
  engine_draw_setup();
}

// what comes after the screens that are in C so far: the game stops there, the screen as it was. No act is in C yet, and
// the C version takes no start point, so it has no opening that holds the character and names no neverInPlay: the
// JavaScript version's acts, in games/sonic-advance/src/, show where it goes once they come over.
void front_play(int level) { (void)level; ctx.done = 1; }
void front_start_demo(void) { ctx.done = 1; }

// the sound the screens start: the kit in C has no sound yet (#604), so each is left out, where it would play
void play_song(int song) { (void)song; }
void play_song_or_continue(int song) { (void)song; }
void stop_song(int song) { (void)song; }
void stop_all_songs(void) {}
