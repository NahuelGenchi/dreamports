// The sound, written from the JavaScript kit's sound/synth.js, tables.js and audio.js: the engine (m4a.c) and the sound
// hardware (apu.c) on one clock. A GBA frame (280896 CPU cycles) runs the engine once, the DirectSound samples it mixes
// play during the next frame (176 a frame at 10512 Hz), and the hardware mix is sampled every 256 cycles and averaged
// down to the output's rate. The game's calls (gba.h) wait for the start of the next sound frame, as a call the game
// makes during one frame is sequenced on the next.
//
// It runs in one of two places, as the JavaScript kit's does. For a player, the page (game.js) asks the game to hand its
// calls over (dp_sound_hand_over), and a second copy of the same WebAssembly on the audio thread (worklet.js) plays
// them, keeping its own time, so the music keeps time even when the page's frames stall. For the proof tools it runs
// with the game, which makes each frame's sound right after the frame, as the console mixes it.

#include "sound.h"

#define CALLS 256
#define RENDER_MAX 4096
#define FULL_SCALE 512.0   // the 10-bit DAC swings ±512 around the bias
#define DC_POLE 0.9995     // the output's coupling capacitor, as a one-pole high-pass

static Apu apu;
static M4a engine;
static SoundLayout layout;
static int running;          // the engine has a layout
static int psgAt;            // gba_sound_psg_at's last place, for the next setup
static int fifoAt, fifoCost, hblankAt;   // gba_sound_dma_at's, the same way
static int handOver;         // the calls go to the page, for the audio thread
static SoundCall queue[CALLS], taken[CALLS];
static int queued, takenCount;
static int8_t playingBuf[2 * 704], pendingBuf[2 * 704];
static int8_t *playing = playingBuf, *pending = pendingBuf;
static int cycle, nextFrame;
static int curL, curR;
static double frac = 1, inL, inR, outL, outR;
static double ticksPerSample = 1, gain = 1;
static int dcBlock = 0;
static float rendered[2 * RENDER_MAX];

// with gba_sound_count_cycles, a silent engine of its own that runs a frame as each of the game's ends, as the
// JavaScript kit's countCycles does (sound/audio.js), so its cycles are the same in a player's browser, where the audio
// thread plays the sound, as under the proof tools. How far the chip's length counters have got when it starts, as
// mGBA measures it: a PSG voice's end shows in the count, and they step every 32768 cycles
#define COUNTER_SEQUENCER_START 131019
static Apu counterApu;
static M4a counter;
static int counting;
static SoundCall counterQueue[CALLS];
static int counterQueued;

// ---- the game's calls ----

static void apply(M4a *m, const SoundCall *c) { gba_sound_apply(m, c); }
void gba_sound_apply(M4a *m, const SoundCall *c) {
  switch (c->op) {
    case OP_START: m4a_song_start(m, c->a); break;
    case OP_START_OR_CHANGE: m4a_song_start_or_change(m, c->a); break;
    case OP_START_OR_CONTINUE: m4a_song_start_or_continue(m, c->a); break;
    case OP_STOP: m4a_song_stop(m, c->a); break;
    case OP_PLAYER_START: m4a_player_start(m, c->a, c->b); break;
    case OP_PLAYER_STOP: m4a_player_stop(m, c->a); break;
    case OP_PLAYER_CONTINUE: m4a_player_continue(m, c->a); break;
    case OP_IMM_INIT: m4a_imm_init(m, c->a); break;
    case OP_PITCH: m4a_pitch_control(m, c->a, c->b, c->c); break;
    case OP_VOLUME: m4a_volume_control(m, c->a, c->b, c->c); break;
    case OP_PANPOT: m4a_panpot_control(m, c->a, c->b, c->c); break;
    case OP_FADE_IN: m4a_fade_in(m, c->a, c->b); break;
    case OP_FADE_OUT: m4a_fade_out(m, c->a, c->b); break;
    case OP_TEMPO: m4a_tempo_control(m, c->a, c->b); break;
    case OP_ALL_STOP: m4a_all_stop(m); break;
    case OP_ALL_CONTINUE: m4a_all_continue(m); break;
    case OP_VSYNC_OFF: m4a_vsync_off(m); break;
    case OP_VSYNC_ON: m4a_vsync_on(m); break;
    case OP_WAVE_AT: m4a_wave_at(m, c->a); break;
    case OP_PSG_AT: m->layout.psgAt = c->a; break;
    case OP_CHIP_CLOCK: apu_exact(m->io, c->a); break;
    case OP_DMA_AT: m->layout.fifoAt = c->a; m->layout.fifoCost = c->b; m->layout.hblankAt = c->c; break;
    case OP_HBLANK_DMA: m->hblank = c->a; break;
    case OP_LATE: m->late = c->a; break;
    // frames that played before a start point, each the engine's frame and then the chip's, as the clock runs them,
    // with what they mixed left unheard
    case OP_PLAYED_FOR: for (int i = 0; i < c->a; i++) { m4a_frame(m); apu_run(m->io, FRAME_CYCLES); } break;
  }
}

// without a music manager of the game's own, each frame runs the calls queued for it, in order, as the JavaScript kit's
// runCalls (sound/synth.js)
__attribute__((weak)) void game_sound_frame(M4a *m, const SoundCall *calls, int count) {
  for (int i = 0; i < count; i++) gba_sound_apply(m, &calls[i]);
}
// and nothing of its own to start again when the engine does
__attribute__((weak)) void game_sound_reset(void) {}

static void clear_buffers(void) {
  __builtin_memset(playingBuf, 0, sizeof playingBuf);
  __builtin_memset(pendingBuf, 0, sizeof pendingBuf);
}

// a call where it plays: SETUP and RESET at once, as the engine starts or starts again, the rest at the next frame
static void setup(int a, int b, int c, int d) {
  layout.playerTable = (uint32_t)a; layout.players = b & 0xFF; layout.mode.channels = (b >> 8) & 0xFF;
  layout.mode.volume = (b >> 16) & 0xFF; layout.mode.reverb = (b >> 24) & 0x7F; layout.mode.rate = c & 0xFFFF;
  layout.voicesEndOnChip = (c >> 16) & 1; layout.library = (c >> 17) & 0xF; layout.soundMainAt = d; layout.psgAt = psgAt;
  layout.fifoAt = fifoAt; layout.fifoCost = fifoCost; layout.hblankAt = hblankAt;
  layout.songTable = layout.playerTable + layout.players * 12;
  // the songs the engine has, as tables.js counts them
  layout.songs = 0;
  for (;;) {
    uint32_t at = layout.songTable + layout.songs * 8;
    if (at + 8 > gba_rom_size) break;
    const uint8_t *s = gba_rom + at;
    uint32_t ptr = s[0] | s[1] << 8 | s[2] << 16 | (uint32_t)s[3] << 24;
    int ms = s[4] | s[5] << 8;
    if (!(ptr >= 0x08000000u && ptr < 0x08000000u + gba_rom_size) || ms >= layout.players || (s[6] | s[7] << 8) != ms) break;
    layout.songs++;
  }
  running = 1;
}

static void take(int op, int a, int b, int c, int d) {
  SoundCall call = { op, a, b, c, d };
  // the counter has every call but these, which the JavaScript kit doesn't send it either: a start point moves it on
  // with gba_sound_frames_gone_by
  if (counting && op != OP_SETUP && op != OP_RESET && op != OP_PLAYED_FOR && counterQueued < CALLS) counterQueue[counterQueued++] = call;
  if (op == OP_SETUP) setup(a, b, c, d);
  if (handOver) {
    if (takenCount < CALLS) taken[takenCount++] = call;
    return;
  }
  if (op == OP_SETUP) {
    apu_init(&apu);
    m4a_init(&engine, gba_rom, gba_rom_size, &layout, &apu);
    queued = 0;
    cycle = nextFrame = 0;
    clear_buffers();
    return;
  }
  if (!running) return;
  if (op == OP_RESET) {
    // the engine starts again from nothing, as m4aSoundInit does after a soft reset: every player, channel and effect
    // clean, and the DirectSound samples playing silent. The sound chip isn't reset, so what its four channels were
    // doing goes on under the new engine's first notes, as it does in the console
    m4a_init(&engine, gba_rom, gba_rom_size, &layout, &apu);
    queued = 0;
    clear_buffers();
    game_sound_reset();
    return;
  }
  if (queued < CALLS) queue[queued++] = call;
}

// the music player table: `players` entries of {player state, track array (both EWRAM pointers), track count, 0, u16},
// with the song table right after it, whose first two entries are songs (tables.js findMusicPlayers)
static uint32_t word(uint32_t at) { const uint8_t *b = gba_rom + at; return b[0] | b[1] << 8 | b[2] << 16 | (uint32_t)b[3] << 24; }
static int in_ewram(uint32_t v) { return v >= 0x02000000u && v < 0x02040000u; }
static int is_song(uint32_t at, int players) {
  int ms = gba_rom[at + 4] | gba_rom[at + 5] << 8;
  uint32_t ptr = word(at);
  return ptr >= 0x08000000u && ptr < 0x08000000u + gba_rom_size && ms < players && (gba_rom[at + 6] | gba_rom[at + 7] << 8) == ms;
}
static int find_music_players(int players, uint32_t *found) {
  for (uint32_t at = 0; at + players * 12 + 16 <= gba_rom_size; at += 4) {
    int ok = 1;
    for (int i = 0; i < players && ok; i++) {
      uint32_t e = at + i * 12;
      int tracks = gba_rom[e + 8];
      ok = in_ewram(word(e)) && in_ewram(word(e + 4)) && tracks >= 1 && tracks <= 16 && gba_rom[e + 9] == 0;
    }
    if (ok && is_song(at + players * 12, players) && is_song(at + players * 12 + 8, players)) { *found = at; return 1; }
  }
  return 0;
}

int gba_sound_start_layout(uint32_t playerTable, int players, int channels, int volume, int rate, int reverb,
                           int voicesEndOnChip, int soundMainAt) {
  if (!gba_rom || players < 1 || players > M4A_PLAYERS) return 0;
  if (playerTable + (uint32_t)players * 12 + 16 > gba_rom_size) return 0;
  take(OP_SETUP, (int)playerTable, players | channels << 8 | volume << 16 | (reverb & 0x7F) << 24,
    rate | (voicesEndOnChip ? 1 << 16 : 0), soundMainAt);
  return 1;
}

int gba_sound_start(int players, int channels, int volume, int rate, int reverb) {
  return gba_sound_start_library(LIBRARY_SONIC_BATTLE, players, channels, volume, rate, reverb);
}

int gba_sound_start_library(int library, int players, int channels, int volume, int rate, int reverb) {
  uint32_t at;
  if (!gba_rom || players < 1 || players > M4A_PLAYERS || library < 0 || library >= LIBRARIES || !find_music_players(players, &at)) return 0;
  take(OP_SETUP, (int)at, players | channels << 8 | volume << 16 | (reverb & 0x7F) << 24, rate | library << 17, 0);
  return 1;
}

int gba_sound_count_cycles(void) {
  if (!running) return 0;
  apu_init(&counterApu);
  m4a_init(&counter, gba_rom, gba_rom_size, &layout, &counterApu);
  apu_run(&counterApu, COUNTER_SEQUENCER_START);
  // two frames of the original's sound have gone by when this count starts, which sets when its envelopes step
  m4a_frame(&counter);
  m4a_frame(&counter);
  counterQueued = 0;
  counting = 1;
  return 1;
}

int gba_sound_frame_cycles(void) { return counting ? counter.frameCycles : -1; }

void gba_sound_frames_gone_by(int frames) {
  if (!counting) return;
  for (int i = 0; i < frames; i++) { apu_run(&counterApu, FRAME_CYCLES); m4a_frame(&counter); }
}

void gba_sound_frame_done(void) {
  if (!counting) return;
  for (int i = 0; i < counterQueued; i++) apply(&counter, &counterQueue[i]);
  counterQueued = 0;
  apu_run(&counterApu, FRAME_CYCLES);
  m4a_frame(&counter);
}
void gba_sound_reset(void) { take(OP_RESET, 0, 0, 0, 0); }
void gba_sound_played_for(int frames) { if (frames > 0) take(OP_PLAYED_FOR, frames, 0, 0, 0); }
void gba_sound_play(int song) { take(OP_START, song, 0, 0, 0); }
int gba_sound_song_player(int song) {
  return running && song >= 0 && song < layout.songs ? gba_rom[layout.songTable + song * 8 + 4] : -1;
}
int gba_sound_song_frames(int player, int song) {
  enum { LIMIT = 60 * 60 };
  static Apu a;
  static M4a m;
  if (!running || player < 0 || player >= layout.players) return LIMIT;
  SoundLayout plain = layout;
  plain.psgAt = 0;   // the chip's writes land at once: only the player's status is counted
  apu_init(&a);
  m4a_init(&m, gba_rom, gba_rom_size, &plain, &a);
  m4a_player_start(&m, player, song);
  for (int n = 1; n < LIMIT; n++) {
    m4a_frame(&m);
    apu_run(&a, FRAME_CYCLES);
    uint32_t status = m.players[player].status;
    if ((status & 0x80000000u) || (status & 0xFFFF) == 0) return n;
  }
  return LIMIT;
}
void gba_sound_play_or_change(int song) { take(OP_START_OR_CHANGE, song, 0, 0, 0); }
void gba_sound_start_or_continue(int song) { take(OP_START_OR_CONTINUE, song, 0, 0, 0); }
void gba_sound_stop(int song) { take(OP_STOP, song, 0, 0, 0); }
void gba_sound_start_on(int player, int song) { take(OP_PLAYER_START, player, song, 0, 0); }
void gba_sound_stop_player(int player) { take(OP_PLAYER_STOP, player, 0, 0, 0); }
void gba_sound_continue_player(int player) { take(OP_PLAYER_CONTINUE, player, 0, 0, 0); }
/** m4aSongNumStart, then m4aMPlayImmInit and m4aMPlayPitchControl on its player (pitch in 1/256 semitones) */
void gba_sound_play_pitched(int song, int pitch) {
  if (!running || song < 0 || song >= layout.songs) return;
  int p = gba_rom[layout.songTable + song * 8 + 4];
  take(OP_START, song, 0, 0, 0); take(OP_IMM_INIT, p, 0, 0, 0); take(OP_PITCH, p, 0xFFFF, pitch, 0);
}
void gba_sound_pitch(int player, int bits, int pitch) { take(OP_PITCH, player, bits, pitch, 0); }
void gba_sound_volume(int player, int bits, int volume) { take(OP_VOLUME, player, bits, volume, 0); }
void gba_sound_pan(int player, int bits, int pan) { take(OP_PANPOT, player, bits, pan, 0); }
void gba_sound_imm_init(int player) { take(OP_IMM_INIT, player, 0, 0, 0); }
void gba_sound_wave_at(int at) { take(OP_WAVE_AT, at, 0, 0, 0); }
void gba_sound_psg_at(int cycles) { psgAt = cycles; take(OP_PSG_AT, cycles, 0, 0, 0); }
void gba_sound_chip_clock(int powerOnBefore) { take(OP_CHIP_CLOCK, powerOnBefore, 0, 0, 0); }
void gba_sound_dma_at(int at, int cost, int hblank) {
  fifoAt = at; fifoCost = cost; hblankAt = hblank;
  take(OP_DMA_AT, at, cost, hblank, 0);
}
void gba_sound_hblank_dma(int cycles) { take(OP_HBLANK_DMA, cycles, 0, 0, 0); }
void gba_sound_late(int cycles) { take(OP_LATE, cycles, 0, 0, 0); }
void gba_sound_fade_in(int player, int speed) { take(OP_FADE_IN, player, speed, 0, 0); }
void gba_sound_fade_out(int player, int speed) { take(OP_FADE_OUT, player, speed, 0, 0); }
void gba_sound_tempo(int tempo) { take(OP_TEMPO, 0, tempo, 0, 0); }
void gba_sound_stop_all(void) { take(OP_ALL_STOP, 0, 0, 0, 0); }
void gba_sound_continue_all(void) { take(OP_ALL_CONTINUE, 0, 0, 0, 0); }
void gba_sound_vsync_off(void) { take(OP_VSYNC_OFF, 0, 0, 0, 0); }
void gba_sound_vsync_on(void) { take(OP_VSYNC_ON, 0, 0, 0, 0); }
void gba_sound_manager_call(int op, int a, int b, int c) { if (op >= SOUND_OP_MANAGER) take(op, a, b, c, 0); }

// ---- the clock ----

static void frame(void) {
  int8_t *was = playing;
  playing = pending; pending = was;
  game_sound_frame(&engine, queue, queued);
  queued = 0;
  int n = engine.samples;
  if (engine.locked) { __builtin_memset(playing, 0, 2 * n); __builtin_memset(pending, 0, 2 * n); return; }
  int base = m4a_frame(&engine);
  __builtin_memcpy(pending, engine.pcm + base, n);
  __builtin_memcpy(pending + n, engine.pcm + PCM_HALF + base, n);
}

// the cycle counts start again from 0 with each frame, so they stay small
static void tick(void) {
  if (cycle >= nextFrame) { cycle -= nextFrame; nextFrame = FRAME_CYCLES; apu.late = cycle; frame(); }
  int n = engine.samples, i = cycle / (FRAME_CYCLES / n);
  apu_run(&apu, APU_TICK);
  int out[2];
  apu_mix(&apu, playing[i], playing[n + i], out);
  curL = out[0]; curR = out[1];
  cycle += APU_TICK;
}

/** Makes the next `count` samples at the output's rate, into rendered: the left side, then the right RENDER_MAX later. */
static void render(int count) {
  double f = frac, iL = inL, iR = inR, oL = outL, oR = outR;
  for (int j = 0; j < count; j++) {
    double need = ticksPerSample, l = 0, r = 0;
    while (need > 1e-9) {
      if (f >= 1) { tick(); f -= 1; }
      double part = 1 - f < need ? 1 - f : need;
      l += curL * part; r += curR * part;
      f += part; need -= part;
    }
    l /= ticksPerSample * FULL_SCALE; r /= ticksPerSample * FULL_SCALE;
    if (dcBlock) {
      oL = l - iL + DC_POLE * oL; iL = l;
      oR = r - iR + DC_POLE * oR; iR = r;
      l = oL; r = oR;
    }
    rendered[j] = (float)(l * gain); rendered[RENDER_MAX + j] = (float)(r * gain);
  }
  frac = f; inL = iL; inR = iR; outL = oL; outR = oR;
}

// ---- what the page calls ----

#ifdef __wasm__
#define EXPORT(name) __attribute__((export_name(name)))
#else
#define EXPORT(name)
#endif

/** `frames` frames of the sound engine with nothing rendered, for a start point that plays frames of its own (a
 *  recording's opening): the engine runs them as it would with the game, and their samples are let go, as the
 *  JavaScript kit's createSound().skipFrames. */
EXPORT("dp_sound_skip_frames") void dp_sound_skip_frames(int frames) {
  if (!running) return;
  for (int i = 0; i < frames; i++) frame();
}

/** Whether the game has sound: it found the engine's tables and started it. */
EXPORT("dp_sound_running") int dp_sound_running(void) { return running; }
/** From now on the game's calls wait for the page to take them (dp_sound_taken), for the audio thread's copy. */
EXPORT("dp_sound_hand_over") void dp_sound_hand_over(int on) { handOver = on; }
/** The calls the game made since the page last took them, as five words each, and how many: dp_sound_taken_count. */
EXPORT("dp_sound_taken") int32_t *dp_sound_taken(void) { return (int32_t *)taken; }
EXPORT("dp_sound_taken_count") int dp_sound_taken_count(void) { int n = takenCount; takenCount = 0; return n; }
/** A call the page hands on from the game's copy, on the audio thread's. */
EXPORT("dp_sound_call") void dp_sound_call(int op, int a, int b, int c, int d) { take(op, a, b, c, d); }
/** The output's rate, and whether it's the console's own mix (`raw`, for the proof tools: full scale, with no
 *  coupling capacitor), or what the speakers get. */
EXPORT("dp_sound_output") void dp_sound_output(int rate, int raw) {
  ticksPerSample = (double)CPU_HZ / APU_TICK / rate;
  dcBlock = !raw;
  if (raw) gain = 1;
}
/** How loud: 0 is silent, 1 the console's full scale. */
EXPORT("dp_sound_gain") void dp_sound_gain(double value) { gain = value; }
/** Makes the next `count` samples, at most RENDER_MAX, and gives where they are: the left side, then the right
 *  RENDER_MAX floats later. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > RENDER_MAX) count = RENDER_MAX;
  if (running) render(count);
  else for (int j = 0; j < count; j++) rendered[j] = rendered[RENDER_MAX + j] = 0;
  return rendered;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return RENDER_MAX; }
