// The title screen's demos, translated from engine/demo.js (SAT-R's src/game/shared/stage/demo_manager.c and
// src/input_recorder.c, and Task_SwitchToDemoInit in src/game/sa1/menus/title_screen.c). Left on the title screen for
// 900 frames, the game plays one of four acts by itself, in turn, from a list of presses in the cartridge, with DEMO
// PLAY and a blinking PRESS START over it. After 1800 frames of the stage clock it fades to white and goes back to the
// SEGA logo; a real Start, held or pressed, does the same at once and goes back to the title screen with its music.

#include "sa.h"
#include "act.h"

enum { ANIM_DEMO_PLAY = 721, ANIM_PRESS_START_JAPANESE = 778, ANIM_PRESS_START_ENGLISH = 779 };
// gDemoRecordings: where each demo's presses are in the cartridge, LZ77, a halfword of KEYINPUT's buttons a frame
#define DEMO_RECORDINGS 0x7B97E8u
#define ROM_BASE 0x08000000u
#define TAPE_FRAMES 4096
// gUnknown_080BB323 and gUnknown_080BB327: Sonic in Neo Green Hill, Tails in Secret Base, Amy in Casino Paradise and
// Knuckles in Ice Mountain, each in act 1
static const struct { uint8_t level, character; } DEMOS[4] = { { 0, CHARACTER_SONIC }, { 2, CHARACTER_TAILS }, { 4, CHARACTER_AMY }, { 6, CHARACTER_KNUCKLES } };
#define MANAGER_PRIORITY 1       // its task's priority, before all of the act's
#define PLAYBACK_TIME 1800       // DEMO_PLAYBACK_TIME: TIME(0, 30)
#define ORDER (15 << 6)          // SPRITE_OAM_ORDER(15)
#define PRIO 0x1000              // SPRITE_FLAG(PRIORITY, 1)
#define SEMI_TRANSPARENT 0x80    // SPRITE_FLAG(OBJ_MODE, 1)
#define CENTER_X 120
#define CENTER_Y 80
#define FADE_STEP 0x40           // Q(0.25) a frame, up to Q(16)
#define FADE_END 0x1000
#define WHITE_FRAMES 48
#define SOUND_PLAYERS 4          // m4aMPlayFadeOut on the music player and the three of the sound effects
#define FADE_SPEED 4
// ALLOC_TILES: room for each sign's animation
#define PRESS_START_TILES (23 * 2)   // the Japanese one's, the bigger of the two, as the title screen's
#define DEMO_PLAY_TILES 3

static struct {
  int playing;                 // a demo's act runs: the act reads the tape, and only Start of the player's own buttons
  int counter;                 // gDemoPlayCounter: the demo the title screen starts next
  uint32_t seed;               // gPseudoRandom as the last demo left it
  int head, length;
  uint16_t physical;           // gPhysicalInput: what the player holds now
  int character, partner;      // the character select's, which a demo leaves as they were
  Sprite pressStart, demoPlay;
  int blend, white, pressedStart;
  int fadingOut, fade, noFade, hadCard;   // the fade to white, and what leaves nothing of it to see
  uint16_t tape[TAPE_FRAMES];
} demo;

int demo_playing(void) { return demo.playing; }

/** InputRecorderRead: the buttons the act reads on this frame of a demo, from the tape, with `keys` the player's own. */
uint16_t demo_read(uint16_t keys) {
  demo.physical = keys;
  uint16_t word = demo.head >= 0 && demo.head < demo.length ? demo.tape[demo.head] : 0;
  demo.head++;
  return word;
}

// A demo is the same presses each time, so what the console's timing does to it comes on the same frames
// (notes/a-demo-can-be-late-on-the-same-frames.md), measured from the original and true of the fourth demo only,
// Knuckles in Ice Mountain. On these values of the course clock the water's waves start a line late:
static const uint16_t LATE_WAVES[] = { 1199, 1263, 1264, 1265 };
// and on this one the frame's sprites end with entry 124 holding an 8 x 8 sprite at the screen's corner, tile 512
#define STRAY_TILE_TIME 1786
#define ICE_MOUNTAIN_DEMO 6

/** Whether the water's waves start a line late on this frame of a demo, asked once the course clock has counted it. */
int demo_waves_late(void) {
  if (!demo.playing || act.stage.level != ICE_MOUNTAIN_DEMO) return 0;
  for (unsigned i = 0; i < sizeof LATE_WAVES / sizeof *LATE_WAVES; i++) if (act.clockTime == LATE_WAVES[i]) return 1;
  return 0;
}
// the manager's task, whichever part it is at: what this frame of the demo has that no task's code explains
static void odd_frame(void) {
  if (act.stage.level == ICE_MOUNTAIN_DEMO && act.clockTime + 1 == STRAY_TILE_TIME) engine_stray_oam(124, 0, 0x200, 0x200);
}

static void manager_main(Task *t);
static void manager_fading(Task *t);
static void manager_white(Task *t);

static void sign(Sprite *s, int anim, uint32_t tiles) {
  sprite_init(s);
  s->graphics.dest = vram_malloc(tiles); s->graphics.anim = (uint16_t)anim;
  s->oamFlags = ORDER; s->frameFlags = PRIO; s->x = CENTER_X;
  update_sprite(s, 0);
}

// TaskDestructor_DemoManagerMain
static void manager_gone(Task *t) {
  (void)t;
  vram_free(demo.pressStart.graphics.dest);
  vram_free(demo.demoPlay.graphics.dest);
}

/** The signs' tiles taken from the heap again, where they were, as the act starts over with the heap emptied. */
void demo_signs_keep(void) {
  vram_malloc(PRESS_START_TILES);
  vram_malloc(DEMO_PLAY_TILES);
}

/** CreateDemoManager, as the stage's init makes it for a demo's act: its task stays as the act starts over. */
void demo_manager_create(void) {
  demo.blend = 0; demo.white = 0; demo.pressedStart = 0;
  demo.fadingOut = 0; demo.fade = 0; demo.noFade = 0; demo.hadCard = 0;
  create_task(manager_main, &demo, MANAGER_PRIORITY, 0, manager_gone);
  sign(&demo.pressStart, SAVE_UI_LANGUAGE == 0 ? ANIM_PRESS_START_JAPANESE : ANIM_PRESS_START_ENGLISH, PRESS_START_TILES);
  demo.pressStart.y = CENTER_Y + 33;
  sign(&demo.demoPlay, ANIM_DEMO_PLAY, DEMO_PLAY_TILES);
  demo.demoPlay.y = CENTER_Y;
}

// spotlights, which set the blend each frame after this task and clear it as they go, or the snow, which sets it each
// frame, leave nothing of the fade to see, nor does a title card once it has ended, which clears it. A card holding
// leaves it alone, and while the card fades it sets its own.
static int spoils_fade(void) { return act.stage.row->ownsBlend || spotlights_active(); }

static void fade_out(Task *t) {
  demo.fadingOut = 1; demo.fade = 0;
  demo.noFade = spoils_fade();
  demo.hadCard = !act.cardDone;
  music_call(MUSIC_OFF, 0);
  for (int p = 0; p < SOUND_PLAYERS; p++) fade_out_sound(p, FADE_SPEED);
  t->main = manager_fading;
}

// Task_DemoManagerMain
static void manager_main(Task *t) {
  odd_frame();
  if (demo.physical & KEY_START) {
    act.player.ignoreInput = 1;
    spotlights_destroy();   // gDestroySpotlights
    demo.pressedStart = 1;
    fade_out(t);
  } else if (act.clockTime > PLAYBACK_TIME) fade_out(t);
  // semi-transparent while the screen is faded, which keeps them out of the fade
  Sprite *both[2] = { &demo.pressStart, &demo.demoPlay };
  for (int i = 0; i < 2; i++)
    both[i]->frameFlags = e.bldY > 0 ? both[i]->frameFlags | SEMI_TRANSPARENT : both[i]->frameFlags & ~SPRITE_OBJ_MODE;
  if (act.clockTime & 0x20) display_sprite(&demo.pressStart);
  display_sprite(&demo.demoPlay);
}

// Task_DemoManagerFadeout
static void manager_fading(Task *t) {
  odd_frame();
  demo.blend += FADE_STEP;
  demo.noFade |= spoils_fade() || (demo.hadCard && act.cardDone);
  demo.fade = demo.noFade || (!act.cardDone && titlecard_bld_y()) ? 0 : demo.blend >> 8;
  if (demo.blend >= FADE_END) t->main = manager_white;
}

// Task_DemoManagerEndFadeout: as the white has lasted, every task goes (TasksDestroyAll), and the title screen comes
// with its music where Start ended the demo, or else the SEGA logo. The next screen clears the first two tiles of the
// layers' video memory as it is made, the title screen those of the sprites' too, early enough in its frame that the
// act's last picture shows it where no fade hides it (notes/title-demo.md); the act's music stops on that picture too.
static void manager_white(Task *t) {
  (void)t;
  demo.white++;
  if (demo.white == WHITE_FRAMES - 1) {
    memset(gba_vram, 0, 2 * 32);
    if (demo.pressedStart) memset(gba_vram + OBJ_VRAM, 0, 2 * 32);
    stop_all_songs();
  }
  if (demo.white < WHITE_FRAMES) return;
  demo.seed = act_demo_leave();
  demo.playing = 0;
  ctx.character = demo.character; ctx.partner = demo.partner;
  if (demo.pressedStart) create_title_screen(1);
  else create_sega_logo();
}

/** The demo's fade to white over the act's display, once the frame is drawn and before the card's and the stage's own. */
void demo_display(void) {
  if (!demo.playing || !demo.fadingOut || !demo.fade) return;
  e.bldCnt = 0xBF;   // every layer, the sprites and the backdrop, brighter
  e.bldY = (uint16_t)demo.fade;
}

/** Task_SwitchToDemoInit: the act of the next demo, made by the title screen's task as it goes, so no task runs after
 *  it on that frame. It leaves gCurrentLevel as its level, and the character select's row as it was. */
void front_start_demo(void) {
  int n = demo.counter, level = DEMOS[n].level;
  demo.counter = (n + 1) % 4;
  uint32_t at = rom_u32(DEMO_RECORDINGS + (uint32_t)n * 4) - ROM_BASE;
  demo.length = at < gba_rom_size ? (int)(gba_lz77(gba_rom + at, gba_rom_size - at, (uint8_t *)demo.tape, sizeof demo.tape) / 2) : 0;
  demo.head = 0;
  demo.physical = 0;
  demo.character = ctx.character; demo.partner = ctx.partner;
  ctx.character = DEMOS[n].character;
  if (ctx.character != CHARACTER_SONIC) ctx.partner = 0;
  ctx.currentLevel = level;
  demo.playing = 1;
  act_demo_start(level, demo.seed);
}
