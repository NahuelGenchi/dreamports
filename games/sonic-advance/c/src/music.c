// The stage's music manager (Task_StageMusicManager), translated from the JavaScript version's sound/music.js (the
// original's music_manager.c). Like the JavaScript one it runs on the sound's side, after each sound frame's calls
// (game_sound_frame, the kit's sound.h), so it reads the music player as the original's task does after the frame's
// calls; the game tells it what it needs with music_call. It does nothing while Sonic is dead.
//
// While the drowning music plays it holds the music player and drops what invincibility and an extra life asked for;
// the drowning countdown starts it. Invincibility's song takes the music player while he is invincible and stops when he
// is not; an extra life replaces the music with the 1-up jingle. On any frame where the music player has stopped, the
// stage music starts over from its beginning, fading in from 1/64 and at double tempo while Sonic has speed shoes
// (MusManager_UpdateBgmParams). It leaves the player alone the frame the stage music starts, and from when the act's
// results switch it off (gMusicManagerState.unk0 = 0xFF) until the next act's music starts, and every music player
// stopping (m4aMPlayAllStop, as the act ends) leaves it with no stage music. A boss sets its state
// (gMusicManagerState.unk1): 0x10 and a boss song's index starts that song, which then takes the stage music's place
// (0x20); 0x30 stops it and brings the stage music back, and after every boss but Egg Wrecker and Egg Drillster the
// manager switches itself off for the rest of the act. The pause menu stops every music player but its sound's own and
// plays its sound (Task_PauseMenuInit), after the manager has run on that frame; the manager's task doesn't run while the
// game is paused, nor on the frame the menu closes and every player goes on (m4aMPlayAllContinue).

#include "sa.h"
#include "sound.h"

enum { BGM = 0, DROWNING = 27, INVINCIBILITY = 28, ONE_UP = 307 };
#define PAUSE 0x80000000u
// sBossSongIndices: the boss fight, its intro, Mecha Knuckles, Egg Snake, Egg Wrecker, Egg Drillster, the final boss
static const int BOSS_SONGS[] = { 29, 30, 31, 32, 49, 50, 25 };

static int stageSong = -1, starting, off, drown, oneUp, star, boss;
static int invincible, speedUp, alive = 1;
static int paused, resuming;

// a soft reset's new sound engine has a manager as new, with no stage music
void game_sound_reset(void) {
  stageSong = -1;
  starting = off = drown = oneUp = star = boss = 0;
  invincible = speedUp = 0;
  alive = 1;
  paused = resuming = 0;
}

void music_call(int op, int a) { gba_sound_manager_call(op, a, 0, 0); }

static void bgm_params(M4a *m) {
  m4a_imm_init(m, BGM); m4a_volume_control(m, BGM, 0xFF, 4); m4a_fade_in(m, BGM, 4);
  if (speedUp) m4a_tempo_control(m, BGM, 0x200);
}

static void own(M4a *m, const SoundCall *c) {
  switch (c->op) {
    case MUSIC_STAGE: case MUSIC_STAGE_IN:
      stageSong = c->a; boss = 0; off = 0; drown = 0;
      m4a_song_start(m, c->a);
      if (c->op == MUSIC_STAGE_IN) { starting = 0; bgm_params(m); } else starting = 1;
      break;
    case MUSIC_OFF: off = 1; break;
    case MUSIC_STATE: boss = c->a; break;
    case MUSIC_ONE_UP: oneUp = 1; break;
    case MUSIC_STAR: star = 1; break;
    case MUSIC_DROWNING: drown = 1; break;
    case MUSIC_PLAYER: invincible = c->a & 1; speedUp = (c->a >> 1) & 1; alive = (c->a >> 2) & 1; break;
  }
}

// the manager's task
static void manage(M4a *m) {
  if (stageSong < 0 || starting || off) { starting = 0; return; }
  if (!alive) return;
  const M4aPlayer *bgm = &m->players[BGM];
  int playing = (bgm->status & 0xFFFF) != 0 && (bgm->status & PAUSE) == 0;
#define IS(n) (bgm->songHeader == m4a_song_header(m, (n)))
  if (IS(DROWNING) && playing) { star = 0; oneUp = 0; }
  else if (drown) { drown = 0; m4a_song_start(m, DROWNING); }
  else if (IS(INVINCIBILITY) && playing && !invincible) m4a_song_stop(m, INVINCIBILITY);
  else if (!IS(ONE_UP) && !IS(INVINCIBILITY) && invincible && !star) { m4a_song_start(m, INVINCIBILITY); bgm_params(m); }
  else if (star) { star = 0; m4a_song_start(m, INVINCIBILITY); }
  else if (oneUp) { oneUp = 0; m4a_song_start(m, ONE_UP); }
  else if ((boss & 0xF0) == 0x10) { boss &= 0xF; m4a_song_start(m, BOSS_SONGS[boss]); boss |= 0x20; }
  else if ((boss & 0xF0) == 0x30) {
    boss &= 0xF; m4a_song_stop(m, BOSS_SONGS[boss]);
    m4a_song_start(m, stageSong); bgm_params(m);
    if (((boss - 4) & 0xFF) > 1) off = 1;
    boss = 0;
  } else if (!playing) {
    if ((boss & 0xF0) == 0x20) m4a_song_start(m, BOSS_SONGS[boss & 0xF]);
    else m4a_song_start(m, stageSong);
    bgm_params(m);
  }
#undef IS
}

// the pause menu's start: MPlayStop on every music player but `song`'s, then m4aSongNumStart(song); the manager rests
// until every player goes on
static void pause(M4a *m, int song) {
  int its = m4a_song_player(m, song);
  for (int p = 0; p < m->layout.players; p++) if (p != its) m4a_player_stop(m, p);
  m4a_song_start(m, song);
  paused = 1;
}

void game_sound_frame(M4a *m, const SoundCall *calls, int count) {
  int ran = 0;
  for (int i = 0; i < count; i++) {
    if (calls[i].op == MUSIC_PAUSE) {
      if (!ran && !paused) manage(m);
      ran = 1;
      pause(m, calls[i].a);
    } else if (calls[i].op >= SOUND_OP_MANAGER) own(m, &calls[i]);
    else {
      if (calls[i].op == OP_ALL_STOP) stageSong = -1;
      if (calls[i].op == OP_ALL_CONTINUE) resuming = 1;
      gba_sound_apply(m, &calls[i]);
    }
  }
  if (!ran && !paused) manage(m);
  if (resuming) { resuming = 0; paused = 0; }
}
