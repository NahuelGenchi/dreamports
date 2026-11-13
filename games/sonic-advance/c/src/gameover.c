// The game over, once the last life is lost, translated from SAT-R's src/game/sa1/ui/game_over.c (CreateGameOverScreen
// and the tasks after it) and the JavaScript version's engine/gameover.js. The act runs on behind it without the player,
// whose task has ended. With no continue left (HandleLifeLost hands over OVER_CAUSE_TIME_UP then) GAME OVER waits a
// second just off the right edge, slides in to the middle in half a second, holds, and from its 217th frame closes up
// through the rotation hardware; the screen fades to black from its 120th frame. Once the game over's song has ended,
// the save is written and the game goes back to the SEGA logo. The continue's countdown isn't in C yet.

#include "objects.h"
#include "bosses.h"

enum {
  ANIM_GAME_OVER = 715, WORD_TILES = 64 / 8 * (64 / 8),   // ALLOC_TILES(SA1_ANIM_GAME_OVER): 64 by 64 pixels
  MUS_GAME_OVER = 37,
  UI_TIMER_DIGITS = 32, UI_OK = 33, UI_BLACK_BOX = 45,      // the countdown's pictures, loaded whether it runs or not
  FONT_PALETTE = 6,
  OBJ_MODE_BLEND = 0x80,                                  // SPRITE_FLAG(OBJ_MODE, 1): see-through
  // the game over's song, in frames: the original waits for its music player's status to end, which the sound engine
  // reaches 466 frames after m4aSongNumStart (as the JavaScript's extract.js measures it, playing the song through)
  SONG_FRAMES = 466,
};

static struct {
  int active, frames, step, fadeFrames, fadeDone, fadeShown, songAge;
  Sprite left, right;
  uint32_t box, ok, digits;
  Fade fade, shown;   // the fade, and as this frame shows it, before its step
} over;

int gameover_active(void) { return over.active; }

// sub_8055C50: the countdown's digits, its OK and its black band into their heap blocks, with their colours over the
// HUD font's
static void load(int id, int slot, uint32_t vram, uint32_t tilesSize) {
  UiSlot layout;
  UiGfx g = { 0 };
  ui_graphics(id, &g.tiles, &g.palette, &layout);
  g.tilesSize = tilesSize; g.paletteSize = 32; g.unk28 = FONT_PALETTE;
  g.vramC = vram; g.unk2A = 13; g.unk2B = slot; g.layout = &layout;
  load_ui_gfx(&g);
}

static void word(Sprite *s, int variant, int x, int y) {
  sprite_init(s);
  s->graphics.dest = vram_malloc(WORD_TILES);
  s->graphics.anim = ANIM_GAME_OVER; s->variant = (uint8_t)variant;
  s->frameFlags = OBJ_MODE_BLEND;
  s->x = (int16_t)x; s->y = (int16_t)y;
  s->oamFlags = 3;
  s->palId = 0;
}

/** CreateGameOverScreen(OVER_CAUSE_TIME_UP): the words, the fade to black, and the countdown's graphics. */
void gameover_start(void) {
  memset(&over, 0, sizeof over);
  over.active = 1;
  e.bldCnt = 0; e.bldY = 0;
  e.winRegs[0] = e.winRegs[1] = e.winRegs[2] = e.winRegs[3] = 0;
  word(&over.left, 0, SCREEN_W + 16, 0);
  play_song(MUS_GAME_OVER);
  word(&over.right, 1, 20, 120);
  // Task_8056E24's fade: to black, 96 a frame once its 120 frames have gone
  over.fade = create_fade(0, 1, 1, 0, 96, 1);
  over.box = vram_malloc(16);
  over.ok = vram_malloc(16);
  over.digits = vram_malloc(40);
  ui_gfx_stack_init();
  load(UI_TIMER_DIGITS, 4, over.digits, 40 * 32);
  load(UI_OK, 5, over.ok, 16 * 32);
  load(UI_BLACK_BOX, 14, over.box, 16 * 32);
}

static void show(Sprite *s) { update_sprite(s, 0); display_sprite(s); }

static void turned(Sprite *s, int x) {
  int r0 = (int16_t)(32 - (uint16_t)(over.frames - 248));
  Transform tf = { 0, (int16_t)(SINE[r0 * 16 + 256] >> 6), 0x100, (int16_t)x, 60 };
  if (tf.qScaleX < 10) tf.qScaleX = 10;
  transform_sprite(s, &tf);
}

// the screen's task: Task_GameOverScreenInit, Task_8056100, Task_805618C and Task_8056218
static void screen_step(void) {
  Sprite *l = &over.left, *r = &over.right;
  switch (over.step) {
    case 0:   // just off the right edge for a second
      l->x = r->x = SCREEN_W + 64; l->y = r->y = 60;
      if (++over.frames >= 60) { l->frameFlags = r->frameFlags = 0; over.step = 1; }
      show(l); show(r);
      return;
    case 1: {   // in to the middle in half a second
      int x = SCREEN_W - (184 * (int16_t)(over.frames - 60)) / 30;
      l->x = r->x = (int16_t)(x + 64); l->y = r->y = 60;
      if (++over.frames >= 90) over.step = 2;
      show(l); show(r);
      return;
    }
    case 2:   // held
      l->x = r->x = 128; l->y = r->y = 60;
      if (++over.frames >= 120) { l->frameFlags = r->frameFlags = OBJ_MODE_BLEND; over.step = 3; }
      show(l); show(r);
      return;
    case 3:   // closing up from its 217th frame, gone from its 233rd
      if (++over.frames >= 217) {
        r->frameFlags = OBJ_MODE_BLEND | SPRITE_ROT_SCALE_ENABLE | (uint32_t)boss_matrix();
        l->frameFlags = OBJ_MODE_BLEND | SPRITE_ROT_SCALE_ENABLE | (uint32_t)boss_matrix();
        turned(l, 127);
        turned(r, 127);
      }
      if (over.frames >= 233) { if (over.frames >= 248) over.step = 4; }
      else { show(l); show(r); }
      return;
  }
}

// the fade's task: Task_8056E24, then Task_8056E64 to black
static void fade_task(void) {
  if (over.fadeDone) return;
  if (over.fadeFrames < 120) {
    if (++over.fadeFrames >= 120) e.dispCnt &= ~0xE000;
    return;
  }
  int r5 = (uint16_t)(over.fadeFrames - 120) * 32 / 96;
  over.shown = over.fade;
  over.fadeShown = 1;
  fade_step(&over.fade);
  e.dispCnt |= 0x2000;
  over.fadeFrames++;
  if (r5 >= 96) over.fadeDone = 1;
}

/** A frame of the game over's tasks, at the objects' priority: the screen's, then the fade's. True on the frame the
 *  game over's song has ended, when the save is written and the game goes back to the SEGA logo (Task_8056AC8). */
int gameover_step(void) {
  if (!over.active) return 0;
  over.songAge++;
  over.fadeShown = 0;
  if (over.step == 4 && over.songAge >= SONG_FRAMES) return 1;
  screen_step();
  fade_task();
  return 0;
}

/** What the game over sets on the display after the act's own: the fade, and black once the words have gone. */
void gameover_display(void) {
  if (!over.active) return;
  if (over.fadeShown) { fade_show(&over.shown); e.dispCnt |= 0x2000; }
  if (over.step == 4) { e.bldCnt = 0xFF; e.bldY = 0x10; }
}
