// The stage's music manager (SAT-R decompilation, src/game/shared/stage/music_manager.c), reduced to what
// the game uses so far. It runs after the game's other calls each frame, and does nothing while Sonic is
// dead. While the drowning music plays it holds the music player and drops what invincibility and an extra life
// asked for; the drowning countdown starts it. Invincibility's song takes the music player while he is
// invincible and stops when he is not; an extra life replaces the music with the 1-up jingle. On any frame where the music player has stopped, the
// stage music starts over from its beginning, fading in from 1/64 and at double tempo while Sonic has speed
// shoes (MusManager_UpdateBgmParams). It leaves the player alone the frame the stage music starts, and from
// when the act's results switch it off (gMusicManagerState.unk0 = 0xFF) until the next act's music starts.
// A boss sets its state (gMusicManagerState.unk1): 0x10 and a boss song's index starts that song, which then
// takes the stage music's place (0x20); 0x30 stops it and brings the stage music back, and after every boss
// but Egg Wrecker and Egg Drillster the manager switches itself off for the rest of the act.
// The pause menu stops every music player but its sound's own and plays its sound (Task_PauseMenuInit), after
// the manager has run on that frame; the manager's task doesn't run while the game is paused, nor on the frame
// the menu closes and every player goes on (m4aMPlayAllContinue).
// The kit's sound engine runs each frame's calls through it on the audio thread (worklet.js), and the page
// reaches it through the game's sound (audio.js).

const BGM = 0, DROWNING = 27, INVINCIBILITY = 28, ONE_UP = 307;
// sBossSongIndices: the boss fight, its intro, Mecha Knuckles, Egg Snake, Egg Wrecker, Egg Drillster, the final boss
const BOSS_SONGS = [29, 30, 31, 32, 49, 50, 25];
const PAUSE = 0x80000000;

export function createMusicManager(engine) {
  let stageSong = null, oneUp = false, star = false, drown = false, starting = false, boss = 0, off = false;
  let invincible = false, speedUp = false, alive = true, paused = false, resuming = false;
  const own = {
    stageMusic(song) { stageSong = song; starting = true; boss = 0; off = false; drown = false; engine.songStart(song); },
    off() { off = true; },
    /** a boss's music state (gMusicManagerState.unk1) */
    musicState(value) { boss = value; },
    oneUp() { oneUp = true; },
    /** an item box's invincibility (gMusicManagerState.unk2) */
    invincibility() { star = true; },
    /** the drowning countdown's music (gMusicManagerState.unk4) */
    drowning() { drown = true; },
    /** what the manager reads of Sonic each frame */
    playerState(isInvincible, hasSpeedUp, isAlive) { invincible = isInvincible; speedUp = hasSpeedUp; alive = isAlive; },
    allStop() { stageSong = null; engine.allStop(); },
    allContinue() { engine.allContinue(); resuming = true; },
  };
  function bgmParams() {
    engine.immInit(BGM); engine.volumeControl(BGM, 0xFF, 4); engine.fadeIn(BGM, 4);
    if (speedUp) engine.tempoControl(BGM, 0x200);
  }
  function pause(song) {
    const its = engine.songPlayer(song);
    for (let p = 0; p < engine.players.length; p++) if (p !== its) engine.playerStop(p);
    engine.songStart(song);
    paused = true;
  }
  // the manager's task (Task_StageMusicManager)
  function manage() {
    if (stageSong === null || starting || off) { starting = false; return; }
    if (!alive) return;
    const { status, songHeader } = engine.players[BGM];
    const playing = (status & 0xFFFF) !== 0 && (status & PAUSE) === 0;
    const is = n => songHeader === engine.songHeader(n);
    if (is(DROWNING) && playing) { star = false; oneUp = false; }
    else if (drown) { drown = false; engine.songStart(DROWNING); }
    else if (is(INVINCIBILITY) && playing && !invincible) engine.songStop(INVINCIBILITY);
    else if (!is(ONE_UP) && !is(INVINCIBILITY) && invincible && !star) { engine.songStart(INVINCIBILITY); bgmParams(); }
    else if (star) { star = false; engine.songStart(INVINCIBILITY); }
    else if (oneUp) { oneUp = false; engine.songStart(ONE_UP); }
    else if ((boss & 0xF0) === 0x10) { boss &= 0xF; engine.songStart(BOSS_SONGS[boss]); boss |= 0x20; }
    else if ((boss & 0xF0) === 0x30) {
      boss &= 0xF; engine.songStop(BOSS_SONGS[boss]);
      engine.songStart(stageSong); bgmParams();
      if (((boss - 4) & 0xFF) > 1) off = true;
      boss = 0;
    } else if (!playing) {
      if ((boss & 0xF0) === 0x20) engine.songStart(BOSS_SONGS[boss & 0xF]);
      else engine.songStart(stageSong);
      bgmParams();
    }
  }
  return {
    /** Runs one frame's queued calls ([name, args] pairs), then the manager itself unless the game is paused. */
    frame(calls) {
      let ran = false;
      for (const [name, args] of calls) {
        if (name !== 'pause') { (own[name] ?? engine[name])(...args); continue; }
        if (!ran && !paused) manage();
        ran = true;
        pause(...args);
      }
      if (!ran && !paused) manage();
      if (resuming) { resuming = false; paused = false; }
    },
  };
}
