// The C kit's sound inside: the sound hardware (apu.c), Nintendo's sound engine, MusicPlayer2000 or "m4a" (m4a.c),
// and the two on one clock (sound.c), each written from the JavaScript kit's sound/ a function at a time, so they make
// the same samples. A game needs only gba.h's gba_sound_ calls; this is for a game whose own code drives the engine
// itself, such as a music manager.

#ifndef DREAMPORTS_SOUND_H
#define DREAMPORTS_SOUND_H

#include "gba.h"

#define CPU_HZ 16777216
#define APU_TICK 256          // the mix is sampled every 256 cycles, 65536 times a second
#define FRAME_CYCLES 280896
#define PCM_HALF 1584         // each side of the mixed samples' buffer (PCM_DMA_BUF_SIZE)
#define APU_WAITS 64
#define M4A_PLAYERS 8
#define M4A_TRACKS 16
#define M4A_CHANNELS 12

// ---- the sound hardware (apu.c) ----

typedef struct { int vol, up, period, timer; } ApuEnvelope;
typedef struct { int on, len, freq, since, pos; ApuEnvelope env; } ApuSquare;
typedef struct { int in, r, v; } ApuWait;

typedef struct {
  uint8_t regs[0x50];
  uint8_t wave[2][32];
  int rot[2];
  ApuSquare sq[2];
  int sweepTimer, sweepOn, sweepShadow;
  struct { int on, len, freq, timer, sample; } ch3;
  struct { int on, len, timer, lfsr, out; ApuEnvelope env; } ch4;
  int seqTimer, seqStep;
  int muted;              // channels 1 to 4 (bits 0 to 3) left out of the mix
  int hasAt, at;          // with soundMainAt, where in the console's frame the wave voice's next write lands
  int psgAt;              // with psgAt, where in it the next write to a channel lands, or -1 for at once
  ApuWait wait[APU_WAITS];
  int waits;
  int late;               // how far past the console's frame start the chip's frame began, on a whole sample (sound.c)
  // with apu_exact: mGBA's own count of the squares, the step each stood at and the cycle of that step, where the
  // console last caught it up, on the chip's clock, which `clock` counts from apu_init
  int exact, powerOn;
  long long clock, sqLast[2], sqIndex[2];
  int held[4];            // with exact, each channel's last sample, which mGBA goes on mixing once it stops
} Apu;

void apu_init(Apu *a);
/** The squares and the frame sequencer as mGBA counts them from the console's power-on, `powerOnBefore` cycles before
 *  the chip's clock started (apu.c). */
void apu_exact(Apu *a, int powerOnBefore);
void apu_write(Apu *a, int reg, int value);
int apu_read(const Apu *a, int reg);
void apu_run(Apu *a, int cycles);
void apu_wave_later(Apu *a, int cycles);
void apu_mix(const Apu *a, int fifoA, int fifoB, int out[2]);

// ---- the sound engine (m4a.c) ----

/** A game's sound mode (m4aSoundMode with DEFAULT_SOUND_MODE): DirectSound channels 1 to 12, master volume 1 to 15,
 *  samples a second (10512 for SOUND_MODE_FREQ_10512) and reverb 0 to 127. */
typedef struct { int channels, volume, rate, reverb; } SoundMode;

/** Where the engine's tables are in the player's copy, as file offsets, and how it's set up (tables.js). `library` picks
 *  the version of the sound library the game has, as LIBRARY_ names them: what each of the places below costs, and how
 *  the engine starts. */
typedef struct {
  uint32_t playerTable, songTable;
  int players, songs;
  SoundMode mode;
  int voicesEndOnChip, soundMainAt, psgAt, library;
  // with psgAt, the DMA that halts the CPU while SoundMain runs, in the chip's frame: the FIFO refills' first place and
  // what each costs, and where the first visible line's H-blank DMA lands (gba_sound_dma_at)
  int fifoAt, fifoCost, hblankAt;
} SoundLayout;

// The places in SoundMain where m4a.c counts the console's cycles, each with what it costs in Sonic Battle's library.
// Each is a stretch of the original's code that runs as a whole, or one way a branch in it goes, as the library's own
// code splits them; another version of the library costs another amount at the same place (m4a.c's tables). Kept in
// step with the JavaScript kit's COSTS (sound/costs.js), in the same order.
#define M4A_COSTS(X) \
  /* SoundMain's way in and the DMA restart before it */ \
  X(FRAME, 344) X(FRAME_DMA, 110) \
  /* MPlayMain: a player, paused or running, its fade, its ticks and its tracks */ \
  X(PLAYER_PAUSED, 87) X(PLAYER, 144) X(STOPPED_BY_FADE, 0) X(RUNS, 0) \
  X(FADE_NONE, 0) X(FADE_WAIT, 0) X(FADE_IN, 0) X(FADE_IN_DONE, 0) X(FADE_IN_GOES_ON, 0) X(FADE_OUT, 0) X(FADE_OUT_DONE, 0) \
  X(FADE_STOP_TRACK, 0) X(FADE_CLEAR_TRACK, 0) X(FADE_PAUSE_KEEPS, 0) X(FADE_PAUSE, 0) X(FADE_TRACK, 0) X(FADE_TRACK_VOLUME, 0) X(FADE_TRACK_NEXT, 0) \
  X(TEMPO, 3) X(TICK, 13) X(TRACK_TICKED, 5) X(TRACK_ABSENT, 25) X(TRACK_NEXT, 28) X(TRACK_LAST, 20) X(TICK_DONE, 15) X(TICK_ENDS_ALL, 0) X(TICK_GOES_ON, 0) \
  /* a track's tick: its channels' gate times, then its commands up to the next wait */ \
  X(TRACK, 46) X(TRACK_CHANNELS, 1) X(TRACK_STARTS, 255) \
  X(GATE_ENDS, 32) X(GATE, 24) X(NO_GATE, 18) X(CHANNEL_GONE, 112) X(CHANNEL_NEXT, 14) \
  X(BYTE, 36) X(RUNNING_STATUS, 19) X(COMMAND_BYTE, 24) X(STATUS_KEPT, 0) X(STATUS_NOT_KEPT, 0) \
  X(NOTE, 773) X(COMMAND, 120) X(DISPATCH, 0) X(DISPATCH_GOES_ON, 0) X(WAIT, 19) X(NEXT_BYTE, 13) X(WAITS, 6) \
  X(NO_LFO, 6) X(NO_DEPTH, 6) X(LFO, 12) X(LFO_DELAY, 14) X(LFO_STEP, 50) X(LFO_RISING, 0) X(LFO_FALLING, 0) \
  X(LFO_MUL1, 0) X(LFO_MUL2, 0) X(LFO_MUL3, 0) X(LFO_MUL4, 0) X(LFO_PITCH, 0) X(LFO_VOLUME, 0) \
  /* the commands, 0xB1 to 0xCE, beyond COMMAND, and what some of them do */ \
  X(CMD_B1, 8) X(CMD_B2, 12) X(CMD_B3, 28) X(CMD_B4, -48) X(CMD_B5, 0) X(CMD_B6, 0) X(CMD_B7, 0) X(CMD_B8, 0) \
  X(CMD_B9, 0) X(CMD_BA, 0) X(CMD_BB, -5) X(CMD_BC, 81) X(CMD_BD, 81) X(CMD_BE, -245) X(CMD_BF, 229) X(CMD_C0, 0) \
  X(CMD_C1, 0) X(CMD_C2, 0) X(CMD_C3, 0) X(CMD_C4, 0) X(CMD_C5, 0) X(CMD_C6, 0) X(CMD_C7, 0) X(CMD_C8, 0) \
  X(CMD_C9, 0) X(CMD_CA, 0) X(CMD_CB, 0) X(CMD_CC, 0) X(CMD_CD, 0) X(CMD_CE, -114) \
  X(ARG, 0) X(ARG_UNCHECKED, 0) X(POINTER, 0) X(VOICE_WORD, 0) X(PATTERN_END, 0) X(PATTERN_END_NONE, 0) \
  X(LFO_SPEED, 0) X(LFO_SPEED_OFF, 0) X(DEPTH, 0) X(DEPTH_OFF, 0) X(MOD_TYPE_SAME, 0) X(MOD_TYPE_NEW, 0) X(LFO_CLEAR_PITCH, 0) X(LFO_CLEAR_VOLUME, 0) \
  X(FINE_NO_CHANNELS, 0) X(FINE_CHANNEL, 0) X(FINE_CHANNEL_ON, 0) \
  X(EOT_KEY, 0) X(EOT_NO_KEY, 0) X(EOT_NO_CHANNELS, 0) X(EOT_SILENT, 0) X(EOT_STOPPING, 0) X(EOT_OTHER_KEY, 0) X(EOT_STOPS, 0) \
  /* a note: its key, velocity and gate bytes, its voice, and the channel it takes */ \
  X(NOTE_KEY, 18) X(NOTE_VELOCITY, 18) X(NOTE_GATE, 18) X(DRUM, 118) X(DRUM_PAN, 0) X(DRUM_NO_PAN, 0) \
  X(VOICE_RAM, 0) X(VOICE_ROM, 0) X(VOICE_DS, 0) X(VOICE_CGB1, 0) X(VOICE_CGB2, 0) X(VOICE_CGB3, 0) X(VOICE_CGB4, 0) \
  X(CGB_TONE, -2) X(CGB_NOISE, -98) X(CGB_FREE, 0) X(CGB_STOPPING, 0) X(CGB_LOWER, 0) X(CGB_SAME_LATER, 0) \
  X(CGB_SAME_EARLIER, 0) X(CGB_HIGHER, 0) \
  X(PICK_FREE, 13) X(PICK_FIRST_STOPPING, 46) X(PICK_STOPPING_AGAIN, 0) X(PICK_SKIP, 42) X(PICK_COMPARE, 0) \
  X(PICK_LOWER, 56) X(PICK_HIGHER, 56) X(PICK_LATER, 68) X(PICK_SAME, 70) X(PICK_EARLIER, 70) X(PICK_NEXT, 0) \
  X(PICK_FOUND, 0) X(PICK_NONE, 0) \
  X(TAKEN_HAS_NEXT, 12) X(TAKEN_LAST, 24) X(TRACK_HAD_CHANNELS, -4) X(NOTE_VOLUME, 80) X(NOTE_PITCH, 50) \
  X(NOTE_FIRST, 0) X(NOTE_JOINS, 0) X(JOINS_DS, 0) X(JOINS_CGB, 0) X(NOTE_DS, 0) X(NOTE_CGB, 0) X(NOTE_LFO_DELAY, 0) \
  X(SWEEP_OFF, 0) X(SWEEP, 0) X(SWEEP_NONE, 0) X(CALL, 0) \
  /* ClearChain, by where the channel is in its track's chain, and the call through 0x08097B38 */ \
  X(CHAIN_NONE, 0) X(CHAIN_ALONE, 0) X(CHAIN_FIRST, 0) X(CHAIN_LAST, 0) X(CHAIN_MIDDLE, 0) X(CHAIN_CALL, 0) \
  /* TrackStop */ \
  X(STOP_ABSENT, 0) X(STOP_NO_CHANNELS, 0) X(STOP_CHANNEL, 0) X(STOP_CHANNEL_ON, 0) \
  /* the tracks whose volume or pitch changed, and their channels */ \
  X(VP_TRACKS, 25) X(VP_TRACK_NEXT, 0) X(VP_TRACK_LAST, 0) X(VP_ABSENT, 1) X(VP_UNCHANGED, 70) X(VP_CHANGED, 49) \
  X(VP_NO_CHANNELS, 0) X(VP_CHANNELS, 0) X(VP_CHANNEL_HAS_NEXT, 6) X(VP_CHANNEL_LAST, 0) X(VP_CHANNEL_GONE, 62) \
  X(VP_CHANNEL, 36) X(VP_VOLUME, 34) X(VP_VOLUME_CGB, 0) X(VP_NO_VOLUME, 6) X(VP_PITCH, 270) \
  X(SET_VOLUME, 0) X(SET_NO_VOLUME, 0) X(SET_TREMOLO, 0) X(SET_PAN_LFO, 0) X(SET_PAN_LOW, 0) X(SET_PAN_HIGH, 0) \
  X(SET_PAN, 0) X(SET_PITCH, 0) X(SET_NO_PITCH, 0) X(SET_VIBRATO, 0) \
  X(CHANNEL_VOLUME, 0) X(CHANNEL_VOLUME_RIGHT_TOP, 0) X(CHANNEL_VOLUME_LEFT_TOP, 0) X(CHANNEL_VOLUME_BOTH_TOP, 0) \
  /* MidiKeyToFreq, with umul3232H32's multiplier waits, and MidiKeyToCgbFreq */ \
  X(FREQ, 0) X(FREQ_TOP, 0) X(FREQ_MUL1, 0) X(FREQ_MUL2, 0) X(FREQ_MUL3, 0) X(FREQ_MUL4, 0) \
  X(FREQ2_MUL1, 0) X(FREQ2_MUL2, 0) X(FREQ2_MUL3, 0) X(FREQ2_MUL4, 0) \
  X(NOISE_LOW, 0) X(NOISE_HIGH, 0) X(NOISE, 0) X(TONE_LOW, 0) X(TONE_HIGH, 0) X(TONE, 0) \
  /* CgbSound: each channel, its start or its envelope's step, and its writes */ \
  X(CGB, 251) X(CGB_COUNTING, 2) X(CGB_SILENT, 0) X(CGB_ON1, 199) X(CGB_ON2, 199) X(CGB_ON3, 205) X(CGB_ON4, 199) \
  X(CGB_START, 29) X(CGB_START_WAVE, 78) X(CGB_PAN_RIGHT, 0) X(CGB_PAN_LEFT, 0) X(CGB_PAN_BOTH, 0) \
  X(CGB_WAVE_SAME, 0) X(CGB_WAVE_NEW, 0) X(CGB_START1, 0) X(CGB_START2, 0) X(CGB_START4, 0) \
  X(CGB_LENGTH_WAVE, 0) X(CGB_NO_LENGTH_WAVE, 0) X(CGB_LENGTH, 0) X(CGB_NO_LENGTH, 0) X(CGB_ATTACK, 0) X(CGB_NO_ATTACK, 0) \
  X(CGB_START_STOPPED, 0) X(CGB_ECHO, 5) X(CGB_ECHO_ENDS, 0) X(CGB_ECHO_GOES_ON, 0) \
  X(CGB_PLAYING, 0) X(CGB_STOPPED_NO_ENVELOPE, 0) X(CGB_RELEASE, 0) X(CGB_RELEASE_NONE, 0) X(CGB_RELEASE_STEPS, 0) \
  X(CGB_RELEASE_WAVE, 0) \
  X(ENV_WAIT, -62) X(ENV_STEP, 0) X(ENV_STEP_WAVE, 0) X(ENV_RELEASE, 100) X(ENV_SUSTAIN, 98) X(ENV_DECAY, 116) \
  X(ENV_ATTACK, 116) X(ENV_RELEASE_ON, 0) X(ENV_RELEASE_ENDS, 0) X(ENV_SUSTAIN_STEP, 0) X(ENV_DECAY_STEP, 0) \
  X(ENV_DECAY_ON, 0) X(ENV_DECAY_ENDS, 0) X(ENV_ATTACK_STEP, 0) X(ENV_ATTACK_ON, 0) X(ENV_ATTACK_ENDS, 0) \
  X(ENV_DECAY_START, 107) X(ENV_DECAY_NONE, 0) X(ENV_DECAY_STARTS, 0) X(ENV_DECAY_WAVE, 0) \
  X(ENV_SUSTAIN_START, 50) X(ENV_SUSTAIN_NONE, 0) X(ENV_SUSTAIN_STARTS, 0) X(ENV_SUSTAIN_WAVE, 0) \
  X(ENV_SUSTAIN_SET, -16) X(ENV_SUSTAIN_SET_DONE, 0) X(ENV_ECHO, 57) X(ENV_ECHO_OFF, 0) X(ENV_ECHO_ON, 0) \
  X(ENV_ECHO_WAVE, 0) X(ENV_STEP_DONE, 98) X(ENV_COUNTER_SET, 0) X(ENV_COUNTER_KEPT, 0) X(ENV_AGAIN, 0) X(ENV_DONE, 0) \
  X(CGB_OFF, 62) X(CGB_OFF1, 0) X(CGB_OFF2, 0) X(CGB_OFF3, 0) X(CGB_OFF4, 0) \
  X(CGB_PITCH, 123) X(CGB_PITCH_WAVE, 79) X(CGB_PITCH1, 0) X(CGB_PITCH2, 0) X(CGB_PITCH3, 0) X(CGB_PITCH4, 0) \
  X(CGB_FIXED, 0) X(CGB_FIXED_FINE, 0) X(CGB_FIXED_HALF, 0) X(CGB_FIXED_NONE, 0) X(CGB_PITCH_HIGH, 0) X(CGB_PITCH_HIGH4, 0) \
  X(CGB_PITCH_DONE1, 0) X(CGB_PITCH_DONE2, 0) X(CGB_PITCH_DONE3, 0) X(CGB_PITCH_DONE4, 0) X(CGB_NO_PITCH, 0) \
  X(CGB_VOLUME1, 0) X(CGB_VOLUME2, 0) X(CGB_VOLUME3, 0) X(CGB_VOLUME4, 0) X(CGB_VOLUME_WAVE, 69) \
  X(CGB_WAVE_VOLUME, 0) X(CGB_WAVE_RESTART, 0) X(CGB_SWEEP_CHECK, 0) X(CGB_SWEEP_RESTART, 0) X(CGB_NO_VOLUME, 0) \
  X(CGB_DONE1, 0) X(CGB_DONE2, 0) X(CGB_DONE3, 0) X(CGB_DONE4, 0)

enum {
#define X(name, cycles) COST_##name,
  M4A_COSTS(X)
#undef X
  COSTS
};

typedef struct { uint8_t type, key, length, panSweep; uint32_t wav; uint8_t attack, decay, sustain, release; } M4aVoice;

typedef struct M4aChannel M4aChannel;
typedef struct M4aTrack {
  uint32_t addr;
  int flags, wait, patternLevel, repN, gateTime, key, velocity, runningStatus;
  int keyShiftCalc, pitchCalc, keyShift, keyShiftPublic, tune, pitchPublic, bend, bendRange;
  int volRCalc, volLCalc, vol, volPublic, pan, panPublic, modCalc, modDepth, modType;
  int lfoSpeed, lfoSpeedCounter, lfoDelay, lfoDelayCounter, priority, echoVolume, echoLength;
  M4aChannel *chan;
  M4aVoice voice;
  uint32_t cmdPtr, patternStack[3];
} M4aTrack;

struct M4aChannel {
  int status, type, rightVol, leftVol, attack, decay, sustain, release, key;
  int envVol, envR, envL, echoVol, echoLen, gateTime, midiKey, velocity, priority;
  int rhythmPan, count;
  uint32_t fw, freq, wav, current;
  M4aTrack *track;
  M4aChannel *prev, *next;
  int music;
  // PSG channels only
  int envelopeVol, envelopeGoal, envelopeCtr, sustainGoal, nrx4, pan, panMask, cgbStatus, length, sweep;
};

typedef struct {
  uint32_t addr, songHeader, status, voicegroup, clock;
  int guarded, priority, cmd, tempoD, tempoU, tempoI, tempoC;
  int fadeInterval, fadeCounter, fadeOV;
  int trackCount;
  M4aTrack tracks[M4A_TRACKS];
} M4aPlayer;

typedef struct {
  const uint8_t *rom;
  uint32_t romSize;
  SoundLayout layout;
  Apu *io;
  int numChans, masterVol, samples, framesPerDma, divFreq;
  int reverb, dmaCounter, c15;
  int8_t pcm[2 * PCM_HALF];
  uint8_t memAcc[256];
  M4aChannel chans[M4A_CHANNELS], cgbChans[4];
  M4aPlayer players[M4A_PLAYERS];
  int musicMuted;
  int locked;
  int cycles, frameCycles, inFrame, callAt, earlyCost;
  M4aPlayer *earlyPlayer;
  const int16_t *costs;   // what each place costs in the game's version of the library (M4A_COSTS)
  int hblank, late;       // this frame's H-blank DMA, in cycles a line, and how late its SoundMain starts
} M4a;

void m4a_init(M4a *m, const uint8_t *rom, uint32_t romSize, const SoundLayout *layout, Apu *io);
/** One GBA frame: the V-blank's DMA bookkeeping, then SoundMain. Returns the offset of the samples just mixed into
 *  m->pcm (right side; the left side is PCM_HALF bytes later). */
int m4a_frame(M4a *m);
void m4a_vsync_off(M4a *m);
void m4a_vsync_on(M4a *m);
void m4a_song_start(M4a *m, int n);
void m4a_player_start(M4a *m, int p, int n);
void m4a_song_stop(M4a *m, int n);
void m4a_player_stop(M4a *m, int p);
void m4a_song_start_or_continue(M4a *m, int n);
void m4a_song_start_or_change(M4a *m, int n);
uint32_t m4a_song_header(const M4a *m, int n);
int m4a_song_player(const M4a *m, int n);
void m4a_all_stop(M4a *m);
void m4a_all_continue(M4a *m);
void m4a_player_continue(M4a *m, int p);
void m4a_imm_init(M4a *m, int p);
void m4a_pitch_control(M4a *m, int p, int bits, int pitch);
void m4a_volume_control(M4a *m, int p, int bits, int volume);
void m4a_panpot_control(M4a *m, int p, int bits, int pan);
void m4a_fade_in(M4a *m, int p, int speed);
void m4a_fade_out(M4a *m, int p, int speed);
void m4a_tempo_control(M4a *m, int p, int tempo);
void m4a_wave_at(M4a *m, int at);
void m4a_before_sound_main(M4a *m, int n);

// ---- the calls, and a music manager of the game's own (sound.c) ----

/** A call the game made, as the engine gets it at the start of the next sound frame: `op` names the sound library's
 *  function, and those from SOUND_OP_MANAGER on are the game's own music manager's (gba_sound_manager_call). */
enum {
  OP_SETUP = 1, OP_RESET, OP_START, OP_START_OR_CHANGE, OP_START_OR_CONTINUE, OP_STOP, OP_PLAYER_START, OP_PLAYER_STOP,
  OP_PLAYER_CONTINUE, OP_IMM_INIT, OP_PITCH, OP_VOLUME, OP_PANPOT, OP_FADE_IN, OP_FADE_OUT, OP_TEMPO, OP_ALL_STOP,
  OP_ALL_CONTINUE, OP_VSYNC_OFF, OP_VSYNC_ON, OP_WAVE_AT, OP_PLAYED_FOR, OP_PSG_AT, OP_CHIP_CLOCK, OP_DMA_AT,
  OP_HBLANK_DMA, OP_LATE,
};

typedef struct { int32_t op, a, b, c, d; } SoundCall;
/** Runs one of the engine's calls on it now. */
void gba_sound_apply(M4a *m, const SoundCall *c);
/** What runs each sound frame's calls on the engine, as the JavaScript kit's `manager` in sound/synth.js: by default each
 *  call as it is. A game whose music manager decides what plays defines its own, which runs the calls, its own among
 *  them, and then decides; it runs where the sound does, on the audio thread for a player. The cycle counter
 *  (gba_sound_count_cycles) gets the engine's calls alone. */
void game_sound_frame(M4a *m, const SoundCall *calls, int count);
/** A soft reset's gba_sound_reset, where the sound runs: a game's music manager starts again from nothing with the
 *  engine, as the JavaScript kit makes its manager anew (sound/synth.js restart). */
void game_sound_reset(void);

/** The end of one of the game's frames, which the kit calls after game_step: the cycle counter's frame. */
void gba_sound_frame_done(void);

#endif
