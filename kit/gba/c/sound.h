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
  ApuWait wait[APU_WAITS];
  int waits;
} Apu;

void apu_init(Apu *a);
void apu_write(Apu *a, int reg, int value);
int apu_read(const Apu *a, int reg);
void apu_run(Apu *a, int cycles);
void apu_wave_later(Apu *a, int cycles);
void apu_mix(const Apu *a, int fifoA, int fifoB, int out[2]);

// ---- the sound engine (m4a.c) ----

/** A game's sound mode (m4aSoundMode with DEFAULT_SOUND_MODE): DirectSound channels 1 to 12, master volume 1 to 15,
 *  samples a second (10512 for SOUND_MODE_FREQ_10512) and reverb 0 to 127. */
typedef struct { int channels, volume, rate, reverb; } SoundMode;

/** Where the engine's tables are in the player's copy, as file offsets, and how it's set up (tables.js). */
typedef struct {
  uint32_t playerTable, songTable;
  int players, songs;
  SoundMode mode;
  int voicesEndOnChip, soundMainAt;
} SoundLayout;

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

/** The end of one of the game's frames, which the kit calls after game_step: the cycle counter's frame. */
void gba_sound_frame_done(void);

#endif
