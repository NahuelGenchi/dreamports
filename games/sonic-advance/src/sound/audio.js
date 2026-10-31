// The game's sound (the kit's sound/audio.js), with its own audio thread (worklet.js): the stage's music manager
// (music.js), the optional Sonic Rush boost's sound archive when it is given one, and the optional Boost Mode's
// Sonic Advance 2 ROM when it is given that.

import { createSound as createGbaSound } from '../../../../kit/gba/sound/audio.js';

// the calls the game makes on its GBA's sound besides the engine's own
const calls = (call, send) => ({
  /** Plays a Sonic Rush sound effect, [sequence archive, sound], as the DS does (nitro.js) */
  playRush(se) { send({ type: 'rushSe', se }); },
  /** m4aSongNumStart on Sonic Advance 2's own engine */
  playSa2(song) { send({ type: 'sa2Call', name: 'songStart', args: [song] }); },
  /** Starts the stage's music and the music manager that brings it back after the 1-up jingle */
  playStageMusic(song) { call('stageMusic', song); },
  /** The music manager's extra life: the 1-up jingle in place of the music */
  oneUp() { call('oneUp'); },
  /** The music manager's invincibility: its song in place of the music */
  invincibility() { call('invincibility'); },
  /** The music manager's drowning countdown (gMusicManagerState.unk4): its music in place of the stage's */
  drowning() { call('drowning'); },
  /** What the music manager reads of Sonic each frame */
  playerState(invincible, speedUp, alive) { call('playerState', invincible, speedUp, alive); },
  /** A boss's music state for the music manager (gMusicManagerState.unk1) */
  musicState(value) { call('musicState', value); },
  /** The pause menu's start (Task_PauseMenuInit): MPlayStop on every music player but `song`'s, then
   *  m4aSongNumStart(song); the music manager rests until continueAll() */
  pause(song) { call('pause', song); },
  /** Switches the music manager off until the next stage's music starts, as the act's results do */
  musicOff() { call('off'); },
});

export function createSound() {
  const sound = createGbaSound({ worklet: new URL('./worklet.js', import.meta.url), calls });
  return Object.assign(sound, {
    /** Gives the engine Sonic Rush's sound archive and tables (rush.js) for the boost's sound effect */
    loadRush(rush) { sound.keep({ type: 'rush', sound: rush }); },
    /** Gives the engine the Sonic Advance 2 ROM and its sound layout (sa2.js), for the extras' sound effects */
    loadSa2(sa2) { sound.keep({ type: 'sa2', ...sa2 }); },
  });
}
