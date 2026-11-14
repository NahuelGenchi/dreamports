// The pause menu, as the act's stage clock (Task_GameStage) and the special stage (sub_802D680) open it, translated from
// engine/pause.js and special/pause.js (SAT-R's src/game/shared/stage/pause_menu.c: CreatePauseMenu and its tasks). Its
// task makes the sign, PAUSE over its background in the middle of the screen, in front of everything (priority 0, OAM
// order 1); their animations load their colours into row 6 of the sprite palette as they start, and nothing loads that
// row's own colours back after. On its first frame it stops every music player but the pause sound's, plays the sound
// and pauses the game, so from the next frame its task is the only one that runs (engine.c). Each frame after it shows
// the sign, semi-transparent while the screen is faded (the blend's bldY above 0), until Start goes on with the game:
// every music player goes on from where it stopped, and the sign goes.
//
// In Time Attack the sign is the Time Attack one: its own background, and PAUSE taking turns each second with its Time
// Attack variant in the save's language; and A ends the run: every task goes, and the Time Attack lobby comes.

#include "special.h"

enum { ANIM_PAUSE = 718, ANIM_PAUSE_BACKGROUND = 720, ANIM_PAUSE_BACKGROUND_TA = 809, ANIM_PAUSE_TA = 810 };
#define SIGN_X 120
// ALLOC_TILES: room for the animation's whole size (SA1_ANIM_PAUSE_WIDTH x _HEIGHT, ...), in tiles
#define PAUSE_TILES ((80 / 8) * (16 / 8))
#define BACKGROUND_TILES ((96 / 8) * (32 / 8))
#define PAUSE_TA_TILES ((128 / 8) * (32 / 8))
#define BACKGROUND_TA_TILES ((128 / 8) * (48 / 8))
#define PRIORITY 0xFFFE   // -2: after every task but the list's end
#define ORDER (1 << 6)    // SPRITE_OAM_ORDER(1)
#define SEMI_TRANSPARENT 0x80   // SPRITE_FLAG(OBJ_MODE, 1)
#define SIGN_SWAP 60      // GBA_FRAMES_PER_SECOND

static struct { Sprite s, s2; int frames; void (*toLobby)(void); uint32_t madeOn; int later; } pm;

static void pause_menu_init(Task *t);
static void pause_menu_gone(Task *t);

static void sign(Sprite *s, int anim, uint32_t tiles) {
  sprite_init(s);
  s->graphics.dest = vram_malloc(tiles); s->graphics.anim = (uint16_t)anim;
  s->oamFlags = ORDER; s->x = SIGN_X; s->y = SP_SIGN_Y;
  update_sprite(s, 0);
}

/**
 * CreatePauseMenu; in Time Attack, A calls `toLobby` once every task has gone. With `later`, its task comes after the
 * one that made it with none of its priority before it, so it first runs on the next frame.
 */
void pause_menu_create(void (*toLobby)(void), int later) {
  pm.frames = 0;
  pm.toLobby = toLobby;
  pm.madeOn = e.frameCount;
  pm.later = later;
  create_task(pause_menu_init, &pm, PRIORITY, TASK_RUNS_PAUSED, pause_menu_gone);
  if (time_attack()) {
    sign(&pm.s, ANIM_PAUSE_BACKGROUND_TA, BACKGROUND_TA_TILES);
    sign(&pm.s2, ANIM_PAUSE, PAUSE_TA_TILES);
  } else {
    sign(&pm.s, ANIM_PAUSE_BACKGROUND, BACKGROUND_TILES);
    sign(&pm.s2, ANIM_PAUSE, PAUSE_TILES);
  }
}

void sp_pause_menu_create(void) { pause_menu_create(NULL, 0); }

static void pause_menu_update(Task *t);
// Task_PauseMenuInit
static void pause_menu_init(Task *t) {
  if (pm.later && e.frameCount == pm.madeOn) return;
  music_call(MUSIC_PAUSE, SONG_PAUSE);
  e.flags |= FLAGS_PAUSE_GAME;
  t->main = pause_menu_update;
}

// Task_PauseMenuUpdate
static void pause_menu_update(Task *t) {
  if (e.pressed & KEY_START) {
    e.flags &= ~FLAGS_PAUSE_GAME;
    gba_sound_continue_all();
    destroy_task(t);
    return;
  }
  if (time_attack() && (e.pressed & KEY_A)) {
    e.flags &= ~FLAGS_PAUSE_GAME;
    play_song(SONG_SELECT);
    pm.toLobby();
    return;
  }
  Sprite *both[2] = { &pm.s2, &pm.s };
  for (int i = 0; i < 2; i++)
    both[i]->frameFlags = e.bldY > 0 ? both[i]->frameFlags | SEMI_TRANSPARENT : both[i]->frameFlags & ~SPRITE_OBJ_MODE;
  if (time_attack() && ++pm.frames >= SIGN_SWAP) {
    pm.frames = 0;
    if (pm.s2.graphics.anim == ANIM_PAUSE) {
      pm.s2.graphics.anim = ANIM_PAUSE_TA;
      pm.s2.variant = SAVE_UI_LANGUAGE;
    } else {
      pm.s2.graphics.anim = ANIM_PAUSE;
      pm.s2.variant = 0;
    }
    update_sprite(&pm.s2, 0);
  }
  display_sprite(&pm.s2);
  display_sprite(&pm.s);
}

// TaskDestructor_PauseMenu
static void pause_menu_gone(Task *t) {
  (void)t;
  vram_free(pm.s2.graphics.dest);
  vram_free(pm.s.graphics.dest);
}
