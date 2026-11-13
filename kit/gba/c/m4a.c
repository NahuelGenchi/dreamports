// The sound engine of most Game Boy Advance games: Nintendo's MusicPlayer2000 ("m4a", "Sappy"), written from the
// JavaScript kit's sound/m4a.js a function at a time, so the mixed bytes are the same, and so they match the hardware's
// byte for byte, as that one's do. It is set up with the game's own sound mode, reads the songs, voices and samples
// straight from the player's copy and runs once per GBA frame: the music players step their sequences, the PSG
// channels get their register writes, and the DirectSound mixer writes the signed 8-bit samples per side that play
// during the next frame (176 at 10512 Hz). Like m4a.js it counts the console's cycles SoundMain takes, which a game's
// frame can run late by. Another game may have another version of the library, which can differ in small ways, such
// as how a PSG channel pans (cgb_mod_vol): check it against that game's.

#include "sound.h"

#define ROM_BASE 0x08000000u

// channel status bits
enum { START = 0x80, STOP = 0x40, LOOP = 0x10, IEC = 0x04, ENV = 0x03, ON = START | STOP | IEC | ENV };
// track flags
enum { EXIST = 0x80, TRACK_START = 0x40, VOLCHG = 0x03, PITCHG = 0x0C };
#define PAUSE 0x80000000u
// what a PSG channel needs written this frame
enum { MO_VOL = 1, MO_PIT = 2 };
enum { NR10 = 0x60, NR30 = 0x70, NR32 = 0x73, NR34 = 0x75, NR50 = 0x80, NR51 = 0x81, SOUNDCNT_H = 0x82, SOUNDCNT_X = 0x84, SOUNDBIAS_H = 0x89, WAVE_RAM = 0x90 };
#define IDLE_PLAYER 400   // about what a player takes in a frame it starts nothing

static const int16_t SONIC_BATTLE_COSTS[COSTS], SONIC_ADVANCE_COSTS[COSTS];

// the cycles one place in SoundMain takes in the game's version of the library (M4A_COSTS in sound.h)
#ifndef M4A_COST_HOOK
#define M4A_COST_HOOK(m, site)
#endif
static void cost(M4a *m, int site) { M4A_COST_HOOK(m, site); m->cycles += m->costs[site]; }

static int s8(int v) { return (int8_t)(uint8_t)v; }
static int u8(int v) { return v & 0xFF; }
static int min(int a, int b) { return a < b ? a : b; }
static int max(int a, int b) { return a > b ? a : b; }

// note and wait lengths in ticks: 0 to 24, then 28 to 96
static const uint8_t CLOCK[49] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  28, 30, 32, 36, 40, 42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96 };
// 2^31 · 2^(n/12): one octave of DirectSound pitch ratios
static const uint32_t FREQ[12] = { 2147483648u, 2275179671u, 2410468894u, 2553802834u, 2705659852u, 2866546760u,
  3037000500u, 3217589947u, 3408917802u, 3611622603u, 3826380858u, 4053909305u };
// PSG frequency registers for the top octave, as 11-bit values minus 2048
static const int CGB_FREQ[12] = { -2004, -1891, -1785, -1685, -1591, -1501, -1417, -1337, -1262, -1192, -1125, -1062 };
// wave channel output level (NR32) for each envelope volume
static const uint8_t CGB3_VOL[16] = { 0x00, 0x00, 0x60, 0x60, 0x60, 0x60, 0x40, 0x40, 0x40, 0x40, 0x80, 0x80, 0x80, 0x80, 0x20, 0x20 };
// the PSG registers each channel uses (offsets from 0x04000000); channels 2 and 4 have no NRx0 of their own
static const uint8_t CGB_REGS[4][5] = {
  { 0x60, 0x62, 0x63, 0x64, 0x65 },
  { 0x61, 0x68, 0x69, 0x6C, 0x6D },
  { 0x70, 0x72, 0x73, 0x74, 0x75 },
  { 0x71, 0x78, 0x79, 0x7C, 0x7D },
};
// noise: clock shift and divider from high to low, three dividers per shift, then the fastest four
static int noise(int i) { return i < 56 ? ((13 - (i >> 2)) << 4) | (7 - (i & 3)) : 59 - i; }

// the rates a sound mode can pick (SOUND_MODE_FREQ_05734 to _42048), each with the samples mixed per frame
static int samples_at(int rate) {
  static const int RATES[12][2] = { { 5734, 96 }, { 7884, 132 }, { 10512, 176 }, { 13379, 224 }, { 15768, 264 }, { 18157, 304 },
    { 21024, 352 }, { 26758, 448 }, { 31536, 528 }, { 36314, 608 }, { 40137, 672 }, { 42048, 704 } };
  for (int i = 0; i < 12; i++) if (RATES[i][0] == rate) return RATES[i][1];
  return 176;
}

static uint32_t u32(const M4a *m, uint32_t at) {
  if (at + 4 > m->romSize) return 0;
  const uint8_t *b = m->rom + at;
  return b[0] | b[1] << 8 | b[2] << 16 | (uint32_t)b[3] << 24;
}
static int rom8(const M4a *m, uint32_t at) { return at < m->romSize ? m->rom[at] : 0; }
static int r8(const M4a *m, uint32_t addr) { return rom8(m, addr - ROM_BASE); }

// high 32 bits of an unsigned 32 × 32 bit product
static uint32_t umulhi(uint32_t a, uint32_t b) { return (uint32_t)(((uint64_t)a * b) >> 32); }

static M4aVoice voice_at(const M4a *m, uint32_t at) {
  M4aVoice v = { (uint8_t)rom8(m, at), (uint8_t)rom8(m, at + 1), (uint8_t)rom8(m, at + 2), (uint8_t)rom8(m, at + 3), u32(m, at + 4),
    (uint8_t)rom8(m, at + 8), (uint8_t)rom8(m, at + 9), (uint8_t)rom8(m, at + 10), (uint8_t)rom8(m, at + 11) };
  return v;
}

static void new_track(M4aTrack *T, uint32_t addr) {
  __builtin_memset(T, 0, sizeof *T);
  T->addr = addr;
}

// what the first tick after a start clears: everything before the command pointer
static void clear_track(M4aTrack *T) {
  uint32_t cmdPtr = T->cmdPtr, stack[3] = { T->patternStack[0], T->patternStack[1], T->patternStack[2] };
  new_track(T, T->addr);
  T->cmdPtr = cmdPtr;
  for (int i = 0; i < 3; i++) T->patternStack[i] = stack[i];
  T->flags = EXIST; T->bendRange = 2; T->volPublic = 64; T->lfoSpeed = 22; T->voice.type = 1;
}

#define LINE_CYCLES 1232
#define VISIBLE_LINES 160

// how far into SoundMain its count of `cycles` reaches once the DMA that halts the CPU on the way is added: the FIFO
// refills, every 16 samples, and while the game has it on, the H-blank DMA at the end of each visible line
static int with_dma(const M4a *m, int start, int cycles) {
  const SoundLayout *l = &m->layout;
  int refill = l->fifoCost ? 16 * ((CPU_HZ + m->layout.mode.rate / 2) / m->layout.mode.rate) : 0, reach = cycles;
  for (int again = 0; again < 8; again++) {
    int halted = 0, end = start + reach;
    if (refill) for (int at = l->fifoAt; at < end; at += refill) if (at >= start) halted += l->fifoCost;
    if (m->hblank) for (int n = 0; n < VISIBLE_LINES; n++) {
      int at = l->hblankAt + n * LINE_CYCLES;
      if (at >= end) break;
      if (at >= start) halted += m->hblank;
    }
    if (cycles + halted == reach) break;
    reach = cycles + halted;
  }
  return reach;
}

// with `psgAt`, the writes to the sound chip's channels land at that place in its frame: SoundMain's, as late as this
// frame's starts, plus what it has counted so far and the DMA on the way, as the original's land where its work has
// reached. The chip's frame starts on a whole sample, `late` cycles past the console's. The game's own calls write at once
static void io_write(M4a *m, int reg, int v) {
  int start = m->layout.psgAt + m->late;
  m->io->psgAt = !m->layout.psgAt || !m->inFrame ? -1 : start - m->io->late + with_dma(m, start, m->cycles);
  apu_write(m->io, reg, v);
}
static int io_read(M4a *m, int reg) { return apu_read(m->io, reg); }

void m4a_init(M4a *m, const uint8_t *rom, uint32_t romSize, const SoundLayout *layout, Apu *io) {
  __builtin_memset(m, 0, sizeof *m);
  m->rom = rom; m->romSize = romSize; m->layout = *layout; m->io = io;
  m->costs = layout->library == LIBRARY_SONIC_ADVANCE ? SONIC_ADVANCE_COSTS : SONIC_BATTLE_COSTS;
  const SoundMode *mode = &layout->mode;
  m->numChans = min(max(mode->channels, 1), M4A_CHANNELS);
  m->masterVol = mode->volume;
  m->reverb = mode->reverb;
  m->samples = samples_at(mode->rate);
  int pcmFreq = (597275 * m->samples + 5000) / 10000;
  m->framesPerDma = PCM_HALF / m->samples;
  m->divFreq = (16777216 / pcmFreq + 1) >> 1;
  for (int i = 0; i < 4; i++) { m->cgbChans[i].type = i + 1; m->cgbChans[i].panMask = 0x11 << i; }
  m->callAt = FRAME_CYCLES;
  int players = min(layout->players, M4A_PLAYERS);
  m->layout.players = players;
  for (int i = 0; i < players; i++) {
    uint32_t at = layout->playerTable + i * 12, tracks = u32(m, at + 4);
    M4aPlayer *P = &m->players[i];
    P->addr = u32(m, at);
    // the player table's own byte (unk_A, MPlayOpen's unk_B): when set, a song doesn't take the player from a higher one
    P->guarded = rom8(m, at + 10) != 0;
    P->trackCount = min(rom8(m, at + 8), M4A_TRACKS);
    // Sonic Advance's MPlayOpen leaves a player paused until a song starts on it, which its MPlayMain then passes by
    if (layout->library == LIBRARY_SONIC_ADVANCE) P->status = PAUSE;
    for (int t = 0; t < P->trackCount; t++) new_track(&P->tracks[t], tracks + 0x50 * t);
  }

  // the registers MPlayExtender and SoundInit set
  io_write(m, SOUNDCNT_X, 0x8F);
  io_write(m, NR50, 0); io_write(m, NR51, 0);
  static const uint8_t OFF[3][2] = { { 0x63, 0x65 }, { 0x69, 0x6D }, { 0x79, 0x7D } };
  for (int i = 0; i < 3; i++) { io_write(m, OFF[i][0], 0x08); io_write(m, OFF[i][1], 0x80); }
  io_write(m, NR30, 0);
  io_write(m, NR50, 0x77);
  io_write(m, SOUNDCNT_H, 0x0E); io_write(m, SOUNDCNT_H + 1, 0xA9);
  io_write(m, SOUNDBIAS_H, (io_read(m, SOUNDBIAS_H) & 0x3F) | 0x40);
}

// ---- pitch ----

// how many cycles of wait the multiplier adds for an operand, which it reads a byte at a time from the top while the
// rest are zeros (unsigned, as umull reads it), from 1 to 4
static int mul_bytes(uint32_t x) { return !(x >> 8) ? 1 : !(x >> 16) ? 2 : !(x >> 24) ? 3 : 4; }

static uint32_t midi_key_to_freq(M4a *m, uint32_t wav, int key, int fine) {
  uint32_t f = (uint32_t)fine << 24;
  if (key > 178) { cost(m, COST_FREQ_TOP); key = 178; f = 255u << 24; } else cost(m, COST_FREQ);
  uint32_t f1 = FREQ[key % 12] >> (14 - key / 12);
  uint32_t f2 = FREQ[(key + 1) % 12] >> (14 - (key + 1) / 12);
  // umul3232H32 twice, its wait set by the second operand of each
  uint32_t x = f1 + umulhi(f2 - f1, f);
  cost(m, COST_FREQ_MUL1 + mul_bytes(f) - 1);
  cost(m, COST_FREQ2_MUL1 + mul_bytes(x) - 1);
  return umulhi(u32(m, wav + 4 - ROM_BASE), x);
}

static int midi_key_to_cgb_freq(M4a *m, int ch, int key, int fine) {
  if (ch == 4) {
    cost(m, key <= 20 ? COST_NOISE_LOW : key - 21 > 59 ? COST_NOISE_HIGH : COST_NOISE);
    return noise(key <= 20 ? 0 : min(key - 21, 59));
  }
  int k;
  if (key <= 35) { cost(m, COST_TONE_LOW); k = 0; fine = 0; }
  else { k = key - 36; if (k > 130) { cost(m, COST_TONE_HIGH); k = 130; fine = 255; } else cost(m, COST_TONE); }
  int v1 = CGB_FREQ[k % 12] >> (k / 12), v2 = CGB_FREQ[(k + 1) % 12] >> ((k + 1) / 12);
  return v1 + ((fine * (v2 - v1)) >> 8) + 2048;
}

// ---- tracks ----

static void trk_vol_pit_set(M4a *m, M4aTrack *T) {
  if (T->flags & 0x01) {
    cost(m, COST_SET_VOLUME);
    int x = (T->vol * T->volPublic) >> 5;
    if (T->modType == 1) { cost(m, COST_SET_TREMOLO); x = (x * (T->modCalc + 128)) >> 7; }
    int y = 2 * T->pan + T->panPublic;
    if (T->modType == 2) { cost(m, COST_SET_PAN_LFO); y += T->modCalc; }
    cost(m, y < -128 ? COST_SET_PAN_LOW : y > 127 ? COST_SET_PAN_HIGH : COST_SET_PAN);
    y = max(-128, min(127, y));
    T->volRCalc = u8(((y + 128) * x) >> 8);
    T->volLCalc = u8(((127 - y) * x) >> 8);
  } else cost(m, COST_SET_NO_VOLUME);
  if (T->flags & 0x04) {
    cost(m, COST_SET_PITCH);
    int p = (T->tune + T->bend * T->bendRange) * 4 + (T->keyShift << 8) + (T->keyShiftPublic << 8) + T->pitchPublic;
    if (T->modType == 0) { cost(m, COST_SET_VIBRATO); p += 16 * T->modCalc; }
    T->keyShiftCalc = s8(p >> 8);
    T->pitchCalc = u8(p);
  } else cost(m, COST_SET_NO_PITCH);
  T->flags &= ~0x05;
}

static void chn_vol_set(M4a *m, M4aChannel *C, const M4aTrack *T) {
  int rp = C->rhythmPan, vel = C->velocity;
  int r = (T->volRCalc * ((128 + rp) * vel)) >> 14, l = (T->volLCalc * ((127 - rp) * vel)) >> 14;
  cost(m, COST_CHANNEL_VOLUME + (r > 255) + 2 * (l > 255));
  C->rightVol = min(255, r);
  C->leftVol = min(255, l);
}

static void clear_chain(M4a *m, M4aChannel *C) {
  M4aTrack *T = C->track;
  cost(m, !T ? COST_CHAIN_NONE : !C->prev && !C->next ? COST_CHAIN_ALONE : !C->prev ? COST_CHAIN_FIRST : !C->next ? COST_CHAIN_LAST : COST_CHAIN_MIDDLE);
  if (!T) return;
  if (C->prev) C->prev->next = C->next; else T->chan = C->next;
  if (C->next) C->next->prev = C->prev;
  C->track = NULL;
}

// with `soundMainAt`, when the wave voice's next write lands, counted from the start of the chip's frame: in the
// console's next one, at SoundMain's place plus what it has counted so far, or for a call the game makes, where its own
// code has reached
static void wave_at(M4a *m) {
  if (!m->layout.soundMainAt) return;
  m->io->hasAt = 1;
  m->io->at = m->inFrame ? FRAME_CYCLES + m->layout.soundMainAt + m->cycles - m->earlyCost : m->callAt;
}

static void cgb_osc_off(M4a *m, int ch) {
  if (ch == 3) { wave_at(m); io_write(m, NR30, 0); return; }
  io_write(m, CGB_REGS[ch - 1][2], 0x08); io_write(m, CGB_REGS[ch - 1][4], 0x80);
}

static void track_stop(M4a *m, M4aTrack *T) {
  if (!(T->flags & EXIST)) { cost(m, COST_STOP_ABSENT); return; }
  if (!T->chan) cost(m, COST_STOP_NO_CHANNELS);
  for (M4aChannel *C = T->chan; C; C = C->next) {
    cost(m, COST_STOP_CHANNEL);
    if (C->status) {
      cost(m, COST_STOP_CHANNEL_ON);
      if (C->type & 7) { cost(m, COST_CALL); cgb_osc_off(m, C->type & 7); }
      C->status = 0;
    }
    C->track = NULL;
  }
  T->chan = NULL;
}

static void clear_mod_m(M4a *m, M4aTrack *T) {
  cost(m, T->modType == 0 ? COST_LFO_CLEAR_PITCH : COST_LFO_CLEAR_VOLUME);
  T->modCalc = 0; T->lfoSpeedCounter = 0;
  T->flags |= T->modType == 0 ? PITCHG : VOLCHG;
}

// ---- commands 0xB1 to 0xCE ----

static int arg(M4a *m, M4aTrack *T) { return r8(m, T->cmdPtr++); }
// a command's argument as the library reads it, through its check that the address is in the cartridge, or not
static int checked_arg(M4a *m, M4aTrack *T) { cost(m, COST_ARG); return arg(m, T); }
static int unchecked_arg(M4a *m, M4aTrack *T) { cost(m, COST_ARG_UNCHECKED); return arg(m, T); }
static uint32_t ptr_arg(M4a *m, M4aTrack *T) { cost(m, COST_POINTER); return u32(m, T->cmdPtr - ROM_BASE); }

static void fine(M4a *m, M4aTrack *T) {
  if (!T->chan) cost(m, COST_FINE_NO_CHANNELS);
  for (M4aChannel *C = T->chan; C; C = C->next) {
    cost(m, COST_FINE_CHANNEL);
    if (C->status & ON) { cost(m, COST_FINE_CHANNEL_ON); C->status |= STOP; }
    clear_chain(m, C);
  }
  T->flags = 0;
}
static void go_to(M4a *m, M4aTrack *T) { T->cmdPtr = ptr_arg(m, T); }

// reads and writes the players' shared scratch bytes, or jumps on a comparison with them
static void memacc(M4a *m, M4aTrack *T) {
  int op = checked_arg(m, T), at = checked_arg(m, T), data = checked_arg(m, T);
  uint8_t *mem = m->memAcc;
  int v = mem[at];
  switch (op) {
    case 0: mem[at] = (uint8_t)data; return;
    case 1: mem[at] = (uint8_t)(mem[at] + data); return;
    case 2: mem[at] = (uint8_t)(mem[at] - data); return;
    case 3: mem[at] = mem[data]; return;
    case 4: mem[at] = (uint8_t)(mem[at] + mem[data]); return;
    case 5: mem[at] = (uint8_t)(mem[at] - mem[data]); return;
  }
  if (op >= 18) return;
  int b = op < 12 ? data : mem[data], yes = 0;
  switch ((op - 6) % 6) {
    case 0: yes = v == b; break;
    case 1: yes = v != b; break;
    case 2: yes = v > b; break;
    case 3: yes = v >= b; break;
    case 4: yes = v <= b; break;
    case 5: yes = v < b; break;
  }
  if (yes) go_to(m, T); else T->cmdPtr += 4;
}

static void xcmd(M4a *m, M4aTrack *T) {
  int sub = checked_arg(m, T);
  switch (sub) {
    case 1: T->voice.wav = ptr_arg(m, T); T->cmdPtr += 4; return;
    case 2: T->voice.type = (uint8_t)checked_arg(m, T); return;
    case 4: T->voice.attack = (uint8_t)checked_arg(m, T); return;
    case 5: T->voice.decay = (uint8_t)checked_arg(m, T); return;
    case 6: T->voice.sustain = (uint8_t)checked_arg(m, T); return;
    case 7: T->voice.release = (uint8_t)checked_arg(m, T); return;
    case 8: T->echoVolume = checked_arg(m, T); return;
    case 9: T->echoLength = checked_arg(m, T); return;
    case 10: T->voice.length = (uint8_t)checked_arg(m, T); return;
    case 11: T->voice.panSweep = (uint8_t)checked_arg(m, T); return;
    default: fine(m, T);
  }
}

static void eot(M4a *m, M4aTrack *T) {
  if (r8(m, T->cmdPtr) < 0x80) { cost(m, COST_EOT_KEY); T->key = arg(m, T); } else cost(m, COST_EOT_NO_KEY);
  if (!T->chan) cost(m, COST_EOT_NO_CHANNELS);
  for (M4aChannel *C = T->chan; C; C = C->next) {
    if (!(C->status & (START | ENV))) { cost(m, COST_EOT_SILENT); continue; }
    if (C->status & STOP) { cost(m, COST_EOT_STOPPING); continue; }
    if (C->midiKey != T->key) { cost(m, COST_EOT_OTHER_KEY); continue; }
    cost(m, COST_EOT_STOPS);
    C->status |= STOP;
    return;
  }
}

static void command(M4a *m, M4aPlayer *P, M4aTrack *T, int cmd) {
  switch (cmd) {
    case 0xB2: go_to(m, T); return;
    case 0xB3:   // PATT
      if (T->patternLevel >= 3) { fine(m, T); return; }
      T->patternStack[T->patternLevel++] = T->cmdPtr + 4;
      go_to(m, T);
      return;
    case 0xB4: cost(m, T->patternLevel ? COST_PATTERN_END : COST_PATTERN_END_NONE); if (T->patternLevel) T->cmdPtr = T->patternStack[--T->patternLevel]; return;   // PEND
    case 0xB5: {   // REPT
      int n = r8(m, T->cmdPtr);
      if (n == 0) { T->cmdPtr++; go_to(m, T); return; }
      T->repN = u8(T->repN + 1);
      if (T->repN < n) { T->cmdPtr++; go_to(m, T); } else { T->repN = 0; T->cmdPtr += 5; }
      return;
    }
    case 0xB9: memacc(m, T); return;
    case 0xBA: T->priority = checked_arg(m, T); return;
    case 0xBB: P->tempoD = checked_arg(m, T) * 2; P->tempoI = (P->tempoD * P->tempoU) >> 8; return;
    case 0xBC: T->keyShift = s8(checked_arg(m, T)); T->flags |= PITCHG; return;
    case 0xBD: { int i = arg(m, T); for (int w = 0; w < 3; w++) cost(m, COST_VOICE_WORD); T->voice = voice_at(m, P->voicegroup - ROM_BASE + i * 12); return; }
    case 0xBE: T->vol = checked_arg(m, T); T->flags |= VOLCHG; return;
    case 0xBF: T->pan = s8(checked_arg(m, T) - 0x40); T->flags |= VOLCHG; return;
    case 0xC0: T->bend = s8(checked_arg(m, T) - 0x40); T->flags |= PITCHG; return;
    case 0xC1: T->bendRange = checked_arg(m, T); T->flags |= PITCHG; return;
    case 0xC2: T->lfoSpeed = unchecked_arg(m, T); cost(m, T->lfoSpeed ? COST_LFO_SPEED : COST_LFO_SPEED_OFF); if (!T->lfoSpeed) clear_mod_m(m, T); return;
    case 0xC3: T->lfoDelay = checked_arg(m, T); return;
    case 0xC4: T->modDepth = unchecked_arg(m, T); cost(m, T->modDepth ? COST_DEPTH : COST_DEPTH_OFF); if (!T->modDepth) clear_mod_m(m, T); return;
    case 0xC5: {
      int t = checked_arg(m, T);
      if (t == T->modType) { cost(m, COST_MOD_TYPE_SAME); return; }
      cost(m, COST_MOD_TYPE_NEW);
      T->modType = t; T->flags |= VOLCHG | PITCHG;
      return;
    }
    case 0xC8: T->tune = s8(checked_arg(m, T) - 0x40); T->flags |= PITCHG; return;
    case 0xCC: { int reg = checked_arg(m, T); io_write(m, 0x60 + reg, checked_arg(m, T)); return; }
    case 0xCD: xcmd(m, T); return;
    case 0xCE: eot(m, T); return;
    default: fine(m, T);   // FINE, and the ones this version of the library doesn't have
  }
}

// ---- notes ----

static uint32_t track_addr(const M4aChannel *C) { return C->track ? C->track->addr : 0; }

// the DirectSound channel a new note takes: a free one at once, else the lowest priority among the releasing ones (or,
// when none is releasing, among the playing ones), ties going to the later track
static M4aChannel *pick_channel(M4a *m, int prio, const M4aTrack *T) {
  M4aChannel *best = NULL;
  int bestPrio = prio, stopping = 0;
  uint32_t bestTrack = T->addr;
  for (int i = 0; i < m->numChans; i++) {
    M4aChannel *C = &m->chans[i];
    if (i) cost(m, COST_PICK_NEXT);
    if (!(C->status & ON)) { cost(m, COST_PICK_FREE); return C; }
    if (C->status & STOP) {
      if (!stopping) { stopping = 1; bestPrio = C->priority; bestTrack = track_addr(C); best = C; cost(m, COST_PICK_FIRST_STOPPING); continue; }
      cost(m, COST_PICK_STOPPING_AGAIN);
    } else if (stopping) { cost(m, COST_PICK_SKIP); continue; }
    else cost(m, COST_PICK_COMPARE);
    uint32_t tr = track_addr(C);
    if (C->priority < bestPrio) { bestPrio = C->priority; bestTrack = tr; best = C; cost(m, COST_PICK_LOWER); }
    else if (C->priority == bestPrio) {
      if (tr > bestTrack) { bestTrack = tr; best = C; cost(m, COST_PICK_LATER); }
      else if (tr == bestTrack) { best = C; cost(m, COST_PICK_SAME); }
      else cost(m, COST_PICK_EARLIER);
    } else cost(m, COST_PICK_HIGHER);
  }
  cost(m, best ? COST_PICK_FOUND : COST_PICK_NONE);
  return best;
}

static void plynote(M4a *m, int idx, M4aPlayer *P, M4aTrack *T) {
  T->gateTime = CLOCK[idx];
  if (r8(m, T->cmdPtr) < 0x80) {
    T->key = arg(m, T);
    cost(m, COST_NOTE_KEY);
    if (r8(m, T->cmdPtr) < 0x80) {
      T->velocity = arg(m, T);
      cost(m, COST_NOTE_VELOCITY);
      if (r8(m, T->cmdPtr) < 0x80) { T->gateTime = u8(T->gateTime + arg(m, T)); cost(m, COST_NOTE_GATE); }
    }
  }
  int rhythmPan = 0, key = T->key;
  M4aVoice V = T->voice;
  if (V.type & 0xC0) {
    // key split: a table picks the sub-voice; drum kit: the key does, and the drum brings its own key and pan
    uint32_t table = V.attack | V.decay << 8 | V.sustain << 16 | (uint32_t)V.release << 24;
    int n = V.type & 0x40 ? r8(m, table + T->key) : T->key;
    M4aVoice S = voice_at(m, V.wav - ROM_BASE + n * 12);
    if (S.type & 0xC0) return;
    if (V.type & 0x80) {
      cost(m, S.panSweep & 0x80 ? COST_DRUM_PAN : COST_DRUM_NO_PAN);
      if (S.panSweep & 0x80) rhythmPan = s8((S.panSweep - 0xC0) * 2);
      key = S.key;
      cost(m, COST_DRUM);
    }
    V = S;
  }
  // the voice is the track's own copy in memory, or a key split's or drum kit's from the cartridge, which reads slower
  int fromRom = (T->voice.type & 0xC0) != 0;
  int prio = min(P->priority + T->priority, 255);
  int cgb = V.type & 7;
  cost(m, cgb ? COST_VOICE_CGB1 + cgb - 1 : COST_VOICE_DS);
  M4aChannel *C;
  if (cgb) {
    C = &m->cgbChans[cgb - 1];
    cost(m, cgb == 4 ? COST_CGB_NOISE : COST_CGB_TONE);
    if (!(C->status & ON)) cost(m, COST_CGB_FREE);
    else if (C->status & STOP) cost(m, COST_CGB_STOPPING);
    else if (C->priority < prio) cost(m, COST_CGB_LOWER);
    else if (C->priority > prio) cost(m, COST_CGB_HIGHER);
    else cost(m, track_addr(C) < T->addr ? COST_CGB_SAME_EARLIER : COST_CGB_SAME_LATER);
    if ((C->status & ON) && !(C->status & STOP)) {
      if (C->priority > prio) return;
      if (C->priority == prio && track_addr(C) < T->addr) return;
    }
  } else {
    C = pick_channel(m, prio, T);
    if (!C) return;
  }
  if (C->track) cost(m, C->next ? COST_TAKEN_HAS_NEXT : COST_TAKEN_LAST);
  cost(m, fromRom ? COST_VOICE_ROM : COST_VOICE_RAM);
  if (T->chan) cost(m, COST_TRACK_HAD_CHANNELS);
  if (T->flags & 0x01) cost(m, COST_NOTE_VOLUME);
  if (T->flags & 0x04) cost(m, COST_NOTE_PITCH);
  cost(m, COST_CHAIN_CALL);
  clear_chain(m, C);
  // the original looks at the track's chain once the channel has left it
  cost(m, T->chan ? COST_NOTE_JOINS : COST_NOTE_FIRST);
  if (T->chan) cost(m, T->chan->type & 7 ? COST_JOINS_CGB : COST_JOINS_DS);
  cost(m, cgb ? COST_NOTE_CGB : COST_NOTE_DS);
  C->prev = NULL; C->next = T->chan;
  if (T->chan) T->chan->prev = C;
  T->chan = C; C->track = T; C->music = P == &m->players[0];
  T->lfoDelayCounter = T->lfoDelay;
  if (T->lfoDelay) { cost(m, COST_NOTE_LFO_DELAY); clear_mod_m(m, T); }
  trk_vol_pit_set(m, T);
  C->gateTime = T->gateTime; C->midiKey = T->key; C->velocity = T->velocity;
  C->priority = prio; C->key = key; C->rhythmPan = rhythmPan;
  C->type = V.type; C->wav = V.wav;
  C->attack = V.attack; C->decay = V.decay; C->sustain = V.sustain; C->release = V.release;
  C->echoVol = T->echoVolume; C->echoLen = T->echoLength;
  chn_vol_set(m, C, T);
  int k = max(0, C->key + T->keyShiftCalc);
  if (cgb) {
    C->length = V.length;
    int ps = V.panSweep;
    cost(m, ps & 0x80 ? COST_SWEEP_OFF : ps & 0x70 ? COST_SWEEP : COST_SWEEP_NONE);
    C->sweep = (ps & 0x80) || !(ps & 0x70) ? 0x08 : ps;
    cost(m, COST_CALL);
    C->freq = (uint32_t)midi_key_to_cgb_freq(m, cgb, k, T->pitchCalc);
  } else {
    C->freq = midi_key_to_freq(m, C->wav, k, T->pitchCalc);
  }
  C->status = START;
  T->flags &= 0xF0;
}

static int mul_wait(uint32_t rs) {
  if (!(rs & 0xFFFFFF00u) || (rs & 0xFFFFFF00u) == 0xFFFFFF00u) return 1;
  if (!(rs & 0xFFFF0000u) || (rs & 0xFFFF0000u) == 0xFFFF0000u) return 2;
  if (!(rs & 0xFF000000u) || (rs & 0xFF000000u) == 0xFF000000u) return 3;
  return 4;
}

// ---- the sequencer ----

static void tick_track(M4a *m, M4aPlayer *P, M4aTrack *T) {
  cost(m, COST_TRACK);
  if (T->chan) cost(m, COST_TRACK_CHANNELS);
  if (T->flags & TRACK_START) cost(m, COST_TRACK_STARTS);
  for (M4aChannel *C = T->chan; C; C = C->next) {
    if (C->status & ON) {
      if (C->gateTime) {
        if (--C->gateTime == 0) { C->status |= STOP; cost(m, COST_GATE_ENDS); } else cost(m, COST_GATE);
      } else cost(m, COST_NO_GATE);
    } else { cost(m, COST_CHAIN_CALL); clear_chain(m, C); cost(m, COST_CHANNEL_GONE); }
    if (C->next) cost(m, COST_CHANNEL_NEXT);
  }
  if (T->flags & TRACK_START) clear_track(T);
  while (T->wait == 0) {
    int b = r8(m, T->cmdPtr), cmd = b;
    cost(m, COST_BYTE);
    if (b < 0x80) { cmd = T->runningStatus; cost(m, COST_RUNNING_STATUS); }
    else { T->cmdPtr++; cost(m, COST_COMMAND_BYTE); if (b >= 0xBD) { cost(m, COST_STATUS_KEPT); T->runningStatus = b; } else cost(m, COST_STATUS_NOT_KEPT); }
    if (cmd >= 0xCF) { cost(m, COST_NOTE); cost(m, COST_CALL); plynote(m, cmd - 0xCF, P, T); }
    else if (cmd >= 0xB1) {
      P->cmd = cmd - 0xB1;
      cost(m, COST_COMMAND); cost(m, COST_CMD_B1 + cmd - 0xB1); cost(m, COST_CALL); cost(m, COST_DISPATCH);
      command(m, P, T, cmd);
      if (T->flags == 0) return;
      cost(m, COST_DISPATCH_GOES_ON);
    } else {
      cost(m, COST_WAIT);
      // a track that starts on a byte below 0x80 has no command to repeat: the JavaScript engine's wait is then NaN,
      // which never counts down to 0, so the track stops where it is, as it does here
      T->wait = cmd >= 0x80 ? CLOCK[cmd - 0x80] : -0x40000000;
    }
    cost(m, COST_NEXT_BYTE);
  }
  T->wait--;
  cost(m, COST_WAITS);
  // the vibrato/tremolo LFO: a triangle, stepped on ticks only
  if (!T->lfoSpeed) cost(m, COST_NO_LFO);
  else if (!T->modDepth) cost(m, COST_NO_DEPTH);
  if (T->lfoSpeed && T->modDepth) {
    cost(m, COST_LFO);
    if (T->lfoDelayCounter) { T->lfoDelayCounter--; cost(m, COST_LFO_DELAY); return; }
    cost(m, COST_LFO_STEP);
    int sum = T->lfoSpeedCounter + T->lfoSpeed;
    T->lfoSpeedCounter = u8(sum);
    // the falling half uses the sum before it wraps, as the original does
    int falling = u8(sum - 64) & 0x80, v = falling ? s8(sum) : 128 - sum;
    cost(m, falling ? COST_LFO_FALLING : COST_LFO_RISING);
    // the multiply's wait, by the triangle's value, signed
    uint32_t x = (uint32_t)v;
    cost(m, COST_LFO_MUL1 + ((x >> 8 == 0 || x >> 8 == 0xFFFFFF) ? 0 : (x >> 16 == 0 || x >> 16 == 0xFFFF) ? 1 : (x >> 24 == 0 || x >> 24 == 0xFF) ? 2 : 3));
    int mod = (T->modDepth * v) >> 6;
    if (u8(mod) != u8(T->modCalc)) {
      cost(m, T->modType == 0 ? COST_LFO_PITCH : COST_LFO_VOLUME);
      T->modCalc = s8(mod);
      T->flags |= T->modType == 0 ? PITCHG : VOLCHG;
    }
  }
}

static void fade_out_body(M4a *m, M4aPlayer *P) {
  if (!P->fadeInterval) { cost(m, COST_FADE_NONE); return; }
  if (--P->fadeCounter != 0) { cost(m, COST_FADE_WAIT); return; }
  P->fadeCounter = P->fadeInterval;
  if (P->fadeOV & 2) {
    cost(m, COST_FADE_IN);
    P->fadeOV += 16;
    if (P->fadeOV >= 256) { cost(m, COST_FADE_IN_DONE); P->fadeOV = 256; P->fadeInterval = 0; } else cost(m, COST_FADE_IN_GOES_ON);
  } else {
    cost(m, COST_FADE_OUT);
    P->fadeOV -= 16;
    if (P->fadeOV <= 0) {
      cost(m, COST_FADE_OUT_DONE);
      for (int i = 0; i < P->trackCount; i++) {
        cost(m, COST_FADE_STOP_TRACK);
        track_stop(m, &P->tracks[i]);
        if (!(P->fadeOV & 1)) { cost(m, COST_FADE_CLEAR_TRACK); P->tracks[i].flags = 0; }
      }
      cost(m, P->fadeOV & 1 ? COST_FADE_PAUSE_KEEPS : COST_FADE_PAUSE);
      P->status = P->fadeOV & 1 ? P->status | PAUSE : PAUSE;
      P->fadeInterval = 0;
      return;
    }
  }
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    cost(m, COST_FADE_TRACK);
    if (i < P->trackCount - 1) cost(m, COST_FADE_TRACK_NEXT);
    if (T->flags & EXIST) { cost(m, COST_FADE_TRACK_VOLUME); T->volPublic = P->fadeOV >> 2; T->flags |= VOLCHG; }
  }
}

static void player_main(M4a *m, M4aPlayer *P) {
  if (P->status & PAUSE) { cost(m, COST_PLAYER_PAUSED); return; }
  cost(m, COST_PLAYER);
  fade_out_body(m, P);
  if (P->status & PAUSE) { cost(m, COST_STOPPED_BY_FADE); return; }
  cost(m, COST_RUNS);
  int t = P->tempoC + P->tempoI;
  for (;;) {
    P->tempoC = t & 0xFFFF;
    cost(m, COST_TEMPO);
    if (t < 150) break;
    cost(m, COST_TICK);
    uint32_t mask = 0;
    for (int i = 0; i < P->trackCount; i++) {
      M4aTrack *T = &P->tracks[i];
      if (T->flags & EXIST) { mask |= 1u << i; tick_track(m, P, T); cost(m, COST_TRACK_TICKED); } else cost(m, COST_TRACK_ABSENT);
      cost(m, i < P->trackCount - 1 ? COST_TRACK_NEXT : COST_TRACK_LAST);
    }
    cost(m, COST_TICK_DONE);
    P->clock++;
    if (!mask) { cost(m, COST_TICK_ENDS_ALL); P->status = PAUSE; return; }
    cost(m, COST_TICK_GOES_ON);
    P->status = mask;
    t = P->tempoC - 150;
  }
  cost(m, COST_VP_TRACKS);
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    cost(m, i < P->trackCount - 1 ? COST_VP_TRACK_NEXT : COST_VP_TRACK_LAST);
    if (!(T->flags & EXIST)) { cost(m, COST_VP_ABSENT); continue; }
    if (!(T->flags & 0x0F)) { cost(m, COST_VP_UNCHANGED); continue; }
    cost(m, COST_VP_CHANGED);
    cost(m, T->chan ? COST_VP_CHANNELS : COST_VP_NO_CHANNELS);
    trk_vol_pit_set(m, T);
    for (M4aChannel *C = T->chan; C; C = C->next) {
      cost(m, C->next ? COST_VP_CHANNEL_HAS_NEXT : COST_VP_CHANNEL_LAST);
      if (!(C->status & ON)) { cost(m, COST_CHAIN_CALL); clear_chain(m, C); cost(m, COST_VP_CHANNEL_GONE); continue; }
      int cgb = C->type & 7;
      cost(m, COST_VP_CHANNEL);
      if (T->flags & VOLCHG) {
        chn_vol_set(m, C, T);
        cost(m, COST_VP_VOLUME);
        if (cgb) { cost(m, COST_VP_VOLUME_CGB); C->cgbStatus |= MO_VOL; }
      } else cost(m, COST_VP_NO_VOLUME);
      if (T->flags & PITCHG) {
        int key = max(0, C->key + T->keyShiftCalc);
        cost(m, COST_VP_PITCH);   // in Sonic Battle with 0x08048f0c's two calls of umul3232H32, in ARM from the cartridge
        if (cgb) { cost(m, COST_CALL); C->freq = (uint32_t)midi_key_to_cgb_freq(m, cgb, key, T->pitchCalc); C->cgbStatus |= MO_PIT; }
        else C->freq = midi_key_to_freq(m, C->wav, key, T->pitchCalc);
      }
    }
    T->flags &= 0xF0;
  }
}

// ---- PSG channels ----

// in this version of the library, a channel that is mostly on one side plays on that side only
static void cgb_mod_vol(M4a *m, M4aChannel *C) {
  int r = C->rightVol, l = C->leftVol, pan, goal;
  if (r >= l && r >> 1 >= l) { cost(m, COST_CGB_PAN_RIGHT); pan = 0x0F; goal = min(15, (r + l) >> 4); }
  else if (l > r && l >> 1 >= r) { cost(m, COST_CGB_PAN_LEFT); pan = 0xF0; goal = min(15, (r + l) >> 4); }
  else { cost(m, COST_CGB_PAN_BOTH); pan = 0xFF; goal = (r + l) >> 4; }
  C->envelopeGoal = goal;
  C->sustainGoal = (goal * C->sustain + 15) >> 4;
  C->pan = pan & C->panMask;
}

enum { AT_STEP, AT_STEP_DONE, AT_DECAY_START, AT_SUSTAIN_START, AT_SUSTAIN, AT_ECHO, AT_DONE, AT_OFF };

// the software envelope follows the hardware one, writing the registers and retriggering at each phase change
static void cgb_sound(M4a *m) {
  cost(m, COST_CGB);
  if (m->c15) cost(m, COST_CGB_COUNTING);
  if (m->musicMuted) {
    int mask = 0;
    for (int i = 0; i < 4; i++) if (m->cgbChans[i].music) mask |= 1 << i;
    m->io->muted = mask;
  }
  m->c15 = m->c15 ? m->c15 - 1 : 14;
  for (int ch = 1; ch <= 4; ch++) {
    M4aChannel *C = &m->cgbChans[ch - 1];
    if (!(C->status & ON)) { cost(m, COST_CGB_SILENT); continue; }
    const uint8_t *R = CGB_REGS[ch - 1];
    int nr0 = R[0], nr1 = R[1], nr2 = R[2], nr3 = R[3], nr4 = R[4];
    int c15 = m->c15, dir = io_read(m, nr2), at, stored = 0;   // stored: the step's counter came in already set
    cost(m, COST_CGB_ON1 + ch - 1);
    if (C->status & START) {
      if (C->status & STOP) { cost(m, COST_CGB_START_STOPPED); at = AT_OFF; }
      else {
        C->status = 3; C->cgbStatus = MO_PIT | MO_VOL;
        cost(m, ch == 3 ? COST_CGB_START_WAVE : COST_CGB_START);
        cgb_mod_vol(m, C);
        if (ch == 3) {
          if (C->wav != C->current) {
            cost(m, COST_CGB_WAVE_NEW);
            wave_at(m);
            io_write(m, NR30, 0x40);
            for (int i = 0; i < 16; i++) io_write(m, WAVE_RAM + i, r8(m, C->wav + i));
            C->current = C->wav;
          } else cost(m, COST_CGB_WAVE_SAME);
          wave_at(m); io_write(m, NR30, 0); io_write(m, nr1, C->length);
          cost(m, C->length ? COST_CGB_LENGTH_WAVE : COST_CGB_NO_LENGTH_WAVE);
          C->nrx4 = C->length ? 0xC0 : 0x80;
        } else {
          cost(m, ch == 1 ? COST_CGB_START1 : ch == 2 ? COST_CGB_START2 : COST_CGB_START4);
          if (ch == 1) io_write(m, nr0, C->sweep);
          if (ch == 4) { io_write(m, nr1, C->length); io_write(m, nr3, u8((int)(C->wav << 3))); }
          else io_write(m, nr1, u8((int)((C->wav << 6) + C->length)));
          dir = C->attack + 8;
          cost(m, C->length ? COST_CGB_LENGTH : COST_CGB_NO_LENGTH);
          C->nrx4 = C->length ? 0x40 : 0x00;
        }
        C->envelopeCtr = C->attack;
        if (s8(C->attack)) { cost(m, COST_CGB_ATTACK); C->envelopeVol = 0; at = AT_STEP_DONE; }
        else { cost(m, COST_CGB_NO_ATTACK); at = AT_DECAY_START; }
      }
    } else if ((C->status & IEC) || (m->layout.voicesEndOnChip && !(io_read(m, SOUNDCNT_X) >> (ch - 1) & 1))) {
      // an echo counting down, or, in a game whose library checks, a voice the chip's length counter has ended
      cost(m, COST_CGB_ECHO);
      C->echoLen = u8(C->echoLen - 1);
      at = s8(C->echoLen) <= 0 ? AT_OFF : AT_DONE;
      cost(m, at == AT_OFF ? COST_CGB_ECHO_ENDS : COST_CGB_ECHO_GOES_ON);
    } else if ((C->status & STOP) && (C->status & ENV)) {
      cost(m, COST_CGB_RELEASE);
      C->status &= ~ENV; C->envelopeCtr = C->release;
      if (s8(C->release)) {
        cost(m, COST_CGB_RELEASE_STEPS);
        C->cgbStatus |= MO_VOL;
        if (ch != 3) dir = C->release; else cost(m, COST_CGB_RELEASE_WAVE);
        at = AT_STEP_DONE;
      } else { cost(m, COST_CGB_RELEASE_NONE); at = AT_ECHO; }
    } else { cost(m, C->status & STOP ? COST_CGB_STOPPED_NO_ENVELOPE : COST_CGB_PLAYING); at = AT_STEP; }

    // the envelope steps; every 15th frame it steps twice to keep up with the hardware's 64 Hz
    while (at != AT_DONE && at != AT_OFF) {
      switch (at) {
        case AT_STEP:
          at = AT_STEP_DONE; stored = 0;
          if (C->envelopeCtr != 0) { cost(m, COST_ENV_WAIT); break; }
          cost(m, COST_ENV_STEP);
          if (ch == 3) { cost(m, COST_ENV_STEP_WAVE); C->cgbStatus |= MO_VOL; }
          cgb_mod_vol(m, C);
          switch (C->status & ENV) {
            case 0:
              cost(m, COST_ENV_RELEASE);
              C->envelopeVol = u8(C->envelopeVol - 1);
              if (s8(C->envelopeVol) <= 0) { cost(m, COST_ENV_RELEASE_ENDS); at = AT_ECHO; }
              else { cost(m, COST_ENV_RELEASE_ON); C->envelopeCtr = C->release; stored = 1; }
              break;
            case 1: cost(m, COST_ENV_SUSTAIN); cost(m, COST_ENV_SUSTAIN_STEP); at = AT_SUSTAIN; break;
            case 2:
              cost(m, COST_ENV_DECAY); cost(m, COST_ENV_DECAY_STEP);
              C->envelopeVol = u8(C->envelopeVol - 1);
              if (s8(C->envelopeVol) <= s8(C->sustainGoal)) { cost(m, COST_ENV_DECAY_ENDS); at = AT_SUSTAIN_START; }
              else { cost(m, COST_ENV_DECAY_ON); C->envelopeCtr = C->decay; stored = 1; }
              break;
            default:
              cost(m, COST_ENV_ATTACK); cost(m, COST_ENV_ATTACK_STEP);
              C->envelopeVol = u8(C->envelopeVol + 1);
              if (C->envelopeVol >= C->envelopeGoal) { cost(m, COST_ENV_ATTACK_ENDS); at = AT_DECAY_START; }
              else { cost(m, COST_ENV_ATTACK_ON); C->envelopeCtr = C->attack; stored = 1; }
          }
          break;
        case AT_DECAY_START:
          cost(m, COST_ENV_DECAY_START);
          C->status--; C->envelopeCtr = C->decay;
          if (C->decay) {
            cost(m, COST_ENV_DECAY_STARTS);
            C->cgbStatus |= MO_VOL; C->envelopeVol = C->envelopeGoal;
            if (ch != 3) dir = C->decay; else cost(m, COST_ENV_DECAY_WAVE);
            at = AT_STEP_DONE; stored = 0;
          } else { cost(m, COST_ENV_DECAY_NONE); at = AT_SUSTAIN_START; }
          break;
        case AT_SUSTAIN_START:
          cost(m, COST_ENV_SUSTAIN_START);
          if (C->sustain == 0) { cost(m, COST_ENV_SUSTAIN_NONE); C->status &= ~ENV; at = AT_ECHO; break; }
          cost(m, COST_ENV_SUSTAIN_STARTS);
          C->status--; C->cgbStatus |= MO_VOL;
          if (ch != 3) dir = 0x08; else cost(m, COST_ENV_SUSTAIN_WAVE);
          at = AT_SUSTAIN;
          break;
        case AT_SUSTAIN:
          cost(m, COST_ENV_SUSTAIN_SET); cost(m, COST_ENV_SUSTAIN_SET_DONE);
          C->envelopeVol = C->sustainGoal; C->envelopeCtr = 7;
          at = AT_STEP_DONE; stored = 1;
          break;
        case AT_ECHO:
          cost(m, COST_ENV_ECHO);
          C->envelopeVol = (C->envelopeGoal * C->echoVol + 0xFF) >> 8;
          if (!C->envelopeVol) { cost(m, COST_ENV_ECHO_OFF); at = AT_OFF; break; }
          cost(m, COST_ENV_ECHO_ON);
          C->status |= IEC; C->cgbStatus |= MO_VOL;
          if (ch != 3) dir = 0x08; else cost(m, COST_ENV_ECHO_WAVE);
          at = AT_DONE;
          break;
        case AT_STEP_DONE:
          cost(m, COST_ENV_STEP_DONE);
          cost(m, stored ? COST_ENV_COUNTER_SET : COST_ENV_COUNTER_KEPT);
          C->envelopeCtr = u8(C->envelopeCtr - 1);
          if (c15 == 0) { cost(m, COST_ENV_AGAIN); c15 = -1; at = AT_STEP; } else { cost(m, COST_ENV_DONE); at = AT_DONE; }
          break;
      }
    }
    if (at == AT_OFF) {
      cost(m, COST_CGB_OFF); cost(m, COST_CGB_OFF1 + ch - 1);
      cgb_osc_off(m, ch); C->status = 0; C->cgbStatus = 0;
      continue;
    }

    if (C->cgbStatus & MO_PIT) {
      cost(m, ch == 3 ? COST_CGB_PITCH_WAVE : COST_CGB_PITCH);
      cost(m, COST_CGB_PITCH1 + ch - 1);
      // "fixed" voices round the frequency to what the PWM rate can play
      if (ch < 4 && (C->type & 0x08)) {
        cost(m, COST_CGB_FIXED);
        int bias = io_read(m, SOUNDBIAS_H);
        if (bias < 0x40) { cost(m, COST_CGB_FIXED_FINE); C->freq = (C->freq + 2) & 0x7FC; }
        else if (bias < 0x80) { cost(m, COST_CGB_FIXED_HALF); C->freq = (C->freq + 1) & 0x7FE; }
        else cost(m, COST_CGB_FIXED_NONE);
      }
      if (ch == 3) wave_at(m);
      io_write(m, nr3, ch == 4 ? (io_read(m, nr3) & 0x08) | (int)C->freq : u8((int)C->freq));
      C->nrx4 = u8((C->nrx4 & 0xC0) + (int)(C->freq >> 8));
      // the high byte goes out an instruction block after the low one
      cost(m, ch == 4 ? COST_CGB_PITCH_HIGH4 : COST_CGB_PITCH_HIGH);
      io_write(m, nr4, C->nrx4);
      cost(m, COST_CGB_PITCH_DONE1 + ch - 1);
    } else cost(m, COST_CGB_NO_PITCH);
    if (C->cgbStatus & MO_VOL) {
      cost(m, COST_CGB_VOLUME1 + ch - 1);
      if (ch == 3) cost(m, COST_CGB_VOLUME_WAVE);
      io_write(m, NR51, (io_read(m, NR51) & ~C->panMask) | C->pan);
      if (ch == 3) {
        wave_at(m);
        // past the table, as a voice on both sides can go, the JavaScript engine's value is undefined, written as 0
        io_write(m, NR32, C->envelopeVol >= 0 && C->envelopeVol < 16 ? CGB3_VOL[C->envelopeVol] : 0);
        cost(m, COST_CGB_WAVE_VOLUME);
        if (C->nrx4 & 0x80) { cost(m, COST_CGB_WAVE_RESTART); io_write(m, NR30, 0x80); io_write(m, NR34, C->nrx4); C->nrx4 &= 0x7F; }
      } else {
        io_write(m, nr2, u8((dir & 0x0F) + (C->envelopeVol << 4)));
        io_write(m, nr4, C->nrx4 | 0x80);
        if (ch == 1) {
          cost(m, COST_CGB_SWEEP_CHECK);
          if (!(io_read(m, NR10) & 0x08)) { cost(m, COST_CGB_SWEEP_RESTART); io_write(m, nr4, C->nrx4 | 0x80); }
        }
      }
    } else cost(m, COST_CGB_NO_VOLUME);
    cost(m, COST_CGB_DONE1 + ch - 1);
    C->cgbStatus = 0;
  }
}

// ---- DirectSound mixer ----

// The mixer's cycles are counted as Sonic Battle's, in every version: only a game that reads them, as it does, needs them.

// one channel's envelope for this frame; 0 when the channel stops before it is mixed
static int envelope(M4a *m, M4aChannel *C) {
  int st = C->status, env;
  uint32_t wav = C->wav - ROM_BASE;
  if (st & START) {
    if (st & STOP) { C->status = 0; m->cycles += 20; return 0; }
    st = 3; C->current = C->wav + 16; C->count = (int)u32(m, wav + 12); env = 0; C->fw = 0;
    m->cycles += 47;
    if (rom8(m, wav + 3) & 0xC0) { st |= LOOP; m->cycles += 5; }
    C->status = st;
    env += C->attack;
    if (env >= 255) { env = 255; C->status = --st; m->cycles += 2; }
  } else {
    env = C->envVol;
    int echo = 0;
    if (st & IEC) {
      int old = C->echoLen;
      C->echoLen = u8(old - 1);
      if (old <= 1) { C->status = 0; m->cycles += 24; return 0; }
      m->cycles += 20;
    } else if (st & STOP) {
      env = (env * C->release) >> 8;
      m->cycles += 29;
      if (env <= C->echoVol) echo = 1;
    } else if ((st & ENV) == 2) {
      env = (env * C->decay) >> 8;
      m->cycles += 35;
      if (env <= C->sustain) {
        env = C->sustain;
        m->cycles += 6;
        if (env == 0) { echo = 1; m->cycles -= 2; } else C->status = --st;
      }
    } else if ((st & ENV) == 3) {
      env += C->attack;
      m->cycles += 34;
      if (env >= 255) { env = 255; C->status = --st; m->cycles += 2; }
    } else m->cycles += 28;
    if (echo) {
      env = C->echoVol;
      // the path from 0x0804851E's test down to 0x080484D2 or to the echo's flag
      if (env == 0) { C->status = 0; m->cycles += 11; return 0; }
      C->status = st | IEC;
      m->cycles += 10;
    }
  }
  C->envVol = env;
  int v = (env * (m->masterVol + 1)) >> 4;
  C->envR = (C->rightVol * v) >> 8;
  C->envL = (C->leftVol * v) >> 8;
  return 1;
}

static int sample(const M4a *m, uint32_t at) { return s8(rom8(m, at)); }
static void add(int8_t *to, int v) { *to = (int8_t)(uint8_t)(*to + v); }

static void mix_channel(M4a *m, M4aChannel *C, int base) {
  int8_t *pcm = m->pcm;
  int SAMPLES = m->samples;
  uint32_t wav = C->wav - ROM_BASE, data = wav + 16;
  int size = (int)u32(m, wav + 12), loopStart = (int)u32(m, wav + 8);
  int loopLen = C->status & LOOP ? size - loopStart : 0;
  // 0x048528 to the sample loop, with the volumes worked out
  m->cycles += 65 + (loopLen ? 22 : 0);
  // with the music muted, its notes still play out, unheard
  int quiet = m->musicMuted && C->music, vr = quiet ? 0 : C->envR, vl = quiet ? 0 : C->envL;
  int cur = (int)(C->current - C->wav - 16), count = C->count;
  if (C->type & 0x08) {
    // fixed rate: one sample in per sample out
    m->cycles += 18 + 18 * SAMPLES + 12 * (SAMPLES >> 2);
    for (int i = 0; i < SAMPLES; i++) {
      int s = sample(m, data + cur++);
      add(&pcm[base + i], (s * vr) >> 8);
      add(&pcm[PCM_HALF + base + i], (s * vl) >> 8);
      if (--count == 0) {
        if (!loopLen) { C->status = 0; return; }
        cur = loopStart; count = loopLen;
      }
    }
    C->count = count; C->current = C->wav + 16 + cur;
    return;
  }
  // resampled with linear interpolation; the step is a 23-bit fraction, and the sample after the last one is read from
  // the byte that follows the data
  uint32_t step = (uint32_t)m->divFreq * C->freq;
  m->cycles += 39 + mul_wait(C->freq) + 20 * SAMPLES + 12 * (SAMPLES >> 2);
  uint32_t fw = C->fw;
  int s0 = sample(m, data + cur), d = sample(m, data + cur + 1) - s0;
  for (int i = 0; i < SAMPLES; i++) {
    int s = s0 + ((int32_t)(fw * (uint32_t)d) >> 23);
    add(&pcm[base + i], (s * vr) >> 8);
    add(&pcm[PCM_HALF + base + i], (s * vl) >> 8);
    fw += step;
    int n = (int)(fw >> 23);
    if (n == 0) continue;
    m->cycles += n == 1 ? 11 : 16;   // with a read or two of the sample from the cartridge
    fw &= ~0x3F800000u;
    count -= n;
    if (count <= 0) {
      if (!loopLen) {
        // the samples not reached aren't mixed: 0x08048640 ends the channel from here
        m->cycles -= 20 * (SAMPLES - 1 - i) + 12 * ((SAMPLES >> 2) - (i >> 2)) + (n == 1 ? 11 : 16) - 57;
        C->status = 0;
        return;
      }
      int over = -count;
      count += loopLen;
      m->cycles += n == 1 ? 18 : 13;
      while (count <= 0) { over -= loopLen; count += loopLen; m->cycles += 6; }
      cur = loopStart + over;
    } else cur += n;
    s0 = sample(m, data + cur); d = sample(m, data + cur + 1) - s0;
  }
  C->fw = fw; C->count = count; C->current = C->wav + 16 + cur;
}

static int mix(M4a *m) {
  int dc = m->dmaCounter, SAMPLES = m->samples;
  int8_t *pcm = m->pcm;
  int seg = dc <= 1 ? 0 : m->framesPerDma - (dc - 1), base = seg * SAMPLES;
  if (m->reverb) {
    // mono feedback from what played 9 and 8 frames ago
    int nxt = dc == 2 ? 0 : base + SAMPLES;
    for (int i = 0; i < SAMPLES; i++) {
      int a = pcm[base + i] + pcm[PCM_HALF + base + i] + pcm[nxt + i] + pcm[PCM_HALF + nxt + i];
      int v = (a * m->reverb) >> 9;
      if (v & 0x80) v++;
      pcm[base + i] = pcm[PCM_HALF + base + i] = (int8_t)(uint8_t)v;
    }
  } else {
    __builtin_memset(pcm + base, 0, SAMPLES);
    __builtin_memset(pcm + PCM_HALF + base, 0, SAMPLES);
  }
  for (int i = 0; i < m->numChans; i++) {
    M4aChannel *C = &m->chans[i];
    m->cycles += C->status & ON ? 29 : 30;
    if ((C->status & ON) && envelope(m, C)) mix_channel(m, C, base);
  }
  m->frameCycles = m->cycles;
  return base;
}

int m4a_frame(M4a *m) {
  if (m->locked) return 0;
  int dc = u8(m->dmaCounter - 1);
  m->dmaCounter = s8(dc) > 0 ? dc : m->framesPerDma;
  // SoundMain's way in, to the first player, and its way from the PSG to the channels and out, and 0x08049744's
  // restarting the DMA in the V-blank before it, on the frames it takes
  m->cycles = 0;
  cost(m, COST_FRAME);
  if (s8(dc) <= 0) cost(m, COST_FRAME_DMA);
  m->inFrame = 1;
  for (int i = 0; i < m->layout.players; i++) {
    M4aPlayer *P = &m->players[i];
    int before = m->cycles;
    player_main(m, P);
    if (P == m->earlyPlayer) { m->earlyCost = m->cycles - before - IDLE_PLAYER; apu_wave_later(m->io, m->earlyCost); m->earlyPlayer = NULL; }
  }
  cgb_sound(m);
  m->inFrame = 0;
  m->hblank = m->late = 0;
  m->callAt = FRAME_CYCLES; m->earlyCost = 0;
  return mix(m);
}

// ---- song control (m4a.c) ----

static int song_ok(const M4a *m, int n) { return n >= 0 && n < m->layout.songs; }
static M4aPlayer *song_player(M4a *m, int n) {
  int p = rom8(m, m->layout.songTable + n * 8 + 4);
  return p < m->layout.players ? &m->players[p] : NULL;
}
uint32_t m4a_song_header(const M4a *m, int n) { return song_ok(m, n) ? u32(m, m->layout.songTable + n * 8) : 0; }
int m4a_song_player(const M4a *m, int n) { return song_ok(m, n) ? rom8(m, m->layout.songTable + n * 8 + 4) : -1; }

static void mplay_start(M4a *m, M4aPlayer *P, uint32_t header) {
  uint32_t h = header - ROM_BASE;
  int trackCount = rom8(m, h);
  // MPlayStart: on a guarded player, a song still playing, or about to start, keeps it from one of lower priority
  if (P->guarded && P->priority > rom8(m, h + 2)) {
    int starting = P->songHeader != 0 && P->trackCount && (P->tracks[0].flags & TRACK_START);
    if (starting || ((P->status & 0xFFFF) != 0 && !(P->status & PAUSE))) return;
  }
  P->status = 0; P->songHeader = header; P->voicegroup = u32(m, h + 4); P->priority = rom8(m, h + 2); P->clock = 0;
  P->tempoD = 150; P->tempoI = 150; P->tempoU = 0x100; P->tempoC = 0; P->fadeInterval = 0;
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    track_stop(m, T);
    if (i < trackCount) { T->flags = EXIST | TRACK_START; T->chan = NULL; T->cmdPtr = u32(m, h + 8 + i * 4); }
    else T->flags = 0;
  }
  int reverb = rom8(m, h + 3);
  if (reverb & 0x80) m->reverb = reverb & 0x7F;
}

static void mplay_stop(M4a *m, M4aPlayer *P) {
  P->status |= PAUSE;
  for (int i = 0; i < P->trackCount; i++) track_stop(m, &P->tracks[i]);
}

/** m4aSoundVSyncOff: what is mixed is cleared and nothing is mixed until m4a_vsync_on. */
void m4a_vsync_off(M4a *m) { if (!m->locked) { m->locked = 1; __builtin_memset(m->pcm, 0, sizeof m->pcm); } }
/** m4aSoundVSyncOn: mixing starts again from the first part of the buffer. */
void m4a_vsync_on(M4a *m) { m->locked = 0; }

void m4a_song_start(M4a *m, int n) {
  M4aPlayer *P = song_ok(m, n) ? song_player(m, n) : NULL;
  if (P) mplay_start(m, P, m4a_song_header(m, n));
}
/** MPlayStart with song n's header on player p instead of the song's own */
void m4a_player_start(M4a *m, int p, int n) {
  if (p >= 0 && p < m->layout.players && song_ok(m, n)) mplay_start(m, &m->players[p], m4a_song_header(m, n));
}
void m4a_song_stop(M4a *m, int n) {
  M4aPlayer *P = song_ok(m, n) ? song_player(m, n) : NULL;
  if (P && P->songHeader == m4a_song_header(m, n)) mplay_stop(m, P);
}
/** MPlayStop on player p, whatever it plays */
void m4a_player_stop(M4a *m, int p) { if (p >= 0 && p < m->layout.players) mplay_stop(m, &m->players[p]); }
/** m4aSongNumStartOrContinue: restarts a different song or an ended one, and lets a stopped one go on */
void m4a_song_start_or_continue(M4a *m, int n) {
  M4aPlayer *P = song_ok(m, n) ? song_player(m, n) : NULL;
  if (!P) return;
  uint32_t header = m4a_song_header(m, n);
  if (P->songHeader != header || (P->status & 0xFFFF) == 0) mplay_start(m, P, header);
  else if (P->status & PAUSE) P->status &= ~PAUSE;
}
/** m4aSongNumStartOrChange: restarts only a different song, or the same one once it has ended */
void m4a_song_start_or_change(M4a *m, int n) {
  M4aPlayer *P = song_ok(m, n) ? song_player(m, n) : NULL;
  if (!P) return;
  uint32_t header = m4a_song_header(m, n);
  if (P->songHeader != header || (P->status & 0xFFFF) == 0 || (P->status & PAUSE)) mplay_start(m, P, header);
}
/** With `soundMainAt`, the cycle the game's next calls come at, counted from the start of the chip's frame */
void m4a_wave_at(M4a *m, int at) { m->callAt = at; }
/** Song n, started next, comes before SoundMain in the original's frame, which is too late here: this frame's SoundMain
 *  takes what the song's first frame costs off its wave writes, and the last frame's, which it belongs to, adds it. */
void m4a_before_sound_main(M4a *m, int n) { m->earlyPlayer = song_ok(m, n) ? song_player(m, n) : NULL; }
void m4a_all_stop(M4a *m) { for (int i = 0; i < m->layout.players; i++) mplay_stop(m, &m->players[i]); }
/** m4aMPlayAllContinue: every player that MPlayStop stopped goes on from where it was */
void m4a_all_continue(M4a *m) { for (int i = 0; i < m->layout.players; i++) m->players[i].status &= ~PAUSE; }
/** m4aMPlayContinue: player p goes on from where MPlayStop stopped it */
void m4a_player_continue(M4a *m, int p) { if (p >= 0 && p < m->layout.players) m->players[p].status &= ~PAUSE; }

static M4aPlayer *player(M4a *m, int p) { return p >= 0 && p < m->layout.players ? &m->players[p] : NULL; }

void m4a_imm_init(M4a *m, int p) {
  M4aPlayer *P = player(m, p);
  if (!P) return;
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    if ((T->flags & EXIST) && (T->flags & TRACK_START)) clear_track(T);
  }
}
void m4a_pitch_control(M4a *m, int p, int bits, int pitch) {
  M4aPlayer *P = player(m, p);
  if (!P) return;
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    if ((bits & (1 << i)) && (T->flags & EXIST)) { T->keyShiftPublic = s8(pitch >> 8); T->pitchPublic = u8(pitch); T->flags |= PITCHG; }
  }
}
void m4a_volume_control(M4a *m, int p, int bits, int volume) {
  M4aPlayer *P = player(m, p);
  if (!P) return;
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    if ((bits & (1 << i)) && (T->flags & EXIST)) { T->volPublic = u8(volume >> 2); T->flags |= VOLCHG; }
  }
}
void m4a_panpot_control(M4a *m, int p, int bits, int pan) {
  M4aPlayer *P = player(m, p);
  if (!P) return;
  for (int i = 0; i < P->trackCount; i++) {
    M4aTrack *T = &P->tracks[i];
    if ((bits & (1 << i)) && (T->flags & EXIST)) { T->panPublic = s8(pan); T->flags |= VOLCHG; }
  }
}
void m4a_fade_in(M4a *m, int p, int speed) {
  M4aPlayer *P = player(m, p);
  if (!P) return;
  P->fadeCounter = P->fadeInterval = speed; P->fadeOV = 2;
  P->status &= ~PAUSE;
}
void m4a_fade_out(M4a *m, int p, int speed) {
  M4aPlayer *P = player(m, p);
  if (P) { P->fadeCounter = P->fadeInterval = speed; P->fadeOV = 256; }
}
void m4a_tempo_control(M4a *m, int p, int tempo) {
  M4aPlayer *P = player(m, p);
  if (P) { P->tempoU = tempo; P->tempoI = (P->tempoD * tempo) >> 8; }
}

// ---- what each place costs, by version of the library ----

static const int16_t SONIC_BATTLE_COSTS[COSTS] = {
#define X(name, cycles) cycles,
  M4A_COSTS(X)
#undef X
};

// Sonic Advance's, measured on its code in mGBA: every stretch of its SoundMain up to each write to a square's pitch
// counted instruction by instruction, with the DMA that lands in it taken out (#1240)
static const int16_t SONIC_ADVANCE_COSTS[COSTS] = {
  [COST_FRAME] = 14, [COST_PLAYER_PAUSED] = 10, [COST_PLAYER] = 81, [COST_FADE_NONE] = 8, [COST_FADE_WAIT] = 35,
  [COST_FADE_IN] = 115, [COST_FADE_IN_DONE] = 18, [COST_FADE_IN_GOES_ON] = 8, [COST_FADE_TRACK] = 14,
  [COST_FADE_TRACK_VOLUME] = 14, [COST_FADE_TRACK_NEXT] = 8, [COST_TEMPO] = 4, [COST_TICK] = 42,
  [COST_TRACK_TICKED] = 32, [COST_TRACK_ABSENT] = 10, [COST_TRACK_NEXT] = 24, [COST_TICK_ENDS_ALL] = 16,
  [COST_TICK_GOES_ON] = 14, [COST_TRACK_CHANNELS] = 14, [COST_TRACK_STARTS] = 185, [COST_GATE_ENDS] = 20,
  [COST_GATE] = 12, [COST_NO_GATE] = 6, [COST_CHANNEL_GONE] = 30, [COST_CHANNEL_NEXT] = 26, [COST_BYTE] = 23,
  [COST_RUNNING_STATUS] = 12, [COST_COMMAND_BYTE] = 14, [COST_STATUS_KEPT] = 4, [COST_STATUS_NOT_KEPT] = 8,
  [COST_NOTE] = 168, [COST_COMMAND] = 45, [COST_DISPATCH_GOES_ON] = 10, [COST_WAIT] = 44, [COST_NEXT_BYTE] = 4,
  [COST_WAITS] = 16, [COST_NO_DEPTH] = 24, [COST_LFO] = 6, [COST_LFO_DELAY] = 30, [COST_LFO_STEP] = 32,
  [COST_LFO_RISING] = 36, [COST_LFO_FALLING] = 38, [COST_LFO_PITCH] = 18, [COST_LFO_VOLUME] = 16, [COST_CMD_B1] = 44,
  [COST_CMD_B3] = 31, [COST_CMD_B4] = 12, [COST_CMD_BA] = 22, [COST_CMD_BB] = 32, [COST_CMD_BC] = 30,
  [COST_CMD_BD] = 104, [COST_CMD_BE] = 30, [COST_CMD_BF] = 32, [COST_CMD_C0] = 32, [COST_CMD_C1] = 30,
  [COST_CMD_C2] = 32, [COST_CMD_C3] = 22, [COST_CMD_C4] = 24, [COST_CMD_C5] = 24, [COST_CMD_CE] = 29, [COST_ARG] = 45,
  [COST_ARG_UNCHECKED] = 23, [COST_POINTER] = 96, [COST_VOICE_WORD] = 22, [COST_PATTERN_END] = 15,
  [COST_PATTERN_END_NONE] = 8, [COST_DEPTH] = 8, [COST_DEPTH_OFF] = 12, [COST_MOD_TYPE_SAME] = 8,
  [COST_MOD_TYPE_NEW] = 20, [COST_LFO_CLEAR_PITCH] = 36, [COST_FINE_NO_CHANNELS] = 12, [COST_FINE_CHANNEL] = 60,
  [COST_FINE_CHANNEL_ON] = 8, [COST_EOT_KEY] = 16, [COST_EOT_NO_KEY] = 10, [COST_EOT_NO_CHANNELS] = 8,
  [COST_EOT_STOPS] = 36, [COST_NOTE_KEY] = 19, [COST_NOTE_VELOCITY] = 17, [COST_DRUM] = 98, [COST_DRUM_PAN] = -6,
  [COST_DRUM_NO_PAN] = -6, [COST_VOICE_RAM] = 138, [COST_VOICE_ROM] = 151, [COST_VOICE_DS] = 28,
  [COST_VOICE_CGB4] = 28, [COST_CGB_TONE] = 28, [COST_CGB_FREE] = 38, [COST_CGB_STOPPING] = 44, [COST_CGB_LOWER] = 52,
  [COST_CGB_SAME_LATER] = 66, [COST_CGB_HIGHER] = 48, [COST_PICK_FREE] = 51, [COST_PICK_FIRST_STOPPING] = 22,
  [COST_PICK_STOPPING_AGAIN] = 16, [COST_PICK_SKIP] = 18, [COST_PICK_COMPARE] = 16, [COST_PICK_LOWER] = 16,
  [COST_PICK_HIGHER] = 16, [COST_PICK_LATER] = 28, [COST_PICK_SAME] = 26, [COST_PICK_EARLIER] = 30,
  [COST_PICK_NEXT] = 24, [COST_PICK_FOUND] = 61, [COST_PICK_NONE] = 46, [COST_TAKEN_HAS_NEXT] = 18,
  [COST_TAKEN_LAST] = 18, [COST_NOTE_FIRST] = 12, [COST_NOTE_JOINS] = 15, [COST_NOTE_DS] = 24, [COST_NOTE_CGB] = 42,
  [COST_NOTE_LFO_DELAY] = 6, [COST_SWEEP_OFF] = 26, [COST_SWEEP_NONE] = 12, [COST_CALL] = 8, [COST_CHAIN_NONE] = 8,
  [COST_CHAIN_ALONE] = 18, [COST_CHAIN_FIRST] = 14, [COST_CHAIN_LAST] = 21, [COST_CHAIN_MIDDLE] = 17,
  [COST_CHAIN_CALL] = 55, [COST_VP_TRACKS] = 28, [COST_VP_TRACK_NEXT] = 22, [COST_VP_ABSENT] = 8,
  [COST_VP_UNCHANGED] = 14, [COST_VP_CHANGED] = 38, [COST_VP_NO_CHANNELS] = 8, [COST_VP_CHANNELS] = 4,
  [COST_VP_CHANNEL_HAS_NEXT] = 8, [COST_VP_CHANNEL] = 34, [COST_VP_VOLUME] = 32, [COST_VP_VOLUME_CGB] = 2,
  [COST_VP_NO_VOLUME] = 18, [COST_VP_PITCH] = 52, [COST_SET_VOLUME] = 114, [COST_SET_NO_VOLUME] = 48,
  [COST_SET_TREMOLO] = 4, [COST_SET_PAN] = 16, [COST_SET_PITCH] = 48, [COST_SET_NO_PITCH] = 8, [COST_SET_VIBRATO] = 10,
  [COST_CHANNEL_VOLUME] = 62, [COST_FREQ] = 235, [COST_FREQ_MUL1] = -13, [COST_FREQ_MUL4] = -13,
  [COST_NOISE_HIGH] = 86, [COST_NOISE] = 90, [COST_TONE] = 182, [COST_CGB] = 547, [COST_CGB_COUNTING] = 2,
  [COST_CGB_SILENT] = 44, [COST_CGB_ON1] = 67, [COST_CGB_ON2] = 59, [COST_CGB_ON3] = 67, [COST_CGB_ON4] = 131,
  [COST_CGB_START] = 72, [COST_CGB_START_WAVE] = 162, [COST_CGB_PAN_RIGHT] = 92, [COST_CGB_PAN_BOTH] = 88,
  [COST_CGB_WAVE_SAME] = 8, [COST_CGB_WAVE_NEW] = 79, [COST_CGB_START1] = 44, [COST_CGB_START2] = 30,
  [COST_CGB_START4] = 40, [COST_CGB_NO_LENGTH] = 42, [COST_CGB_ATTACK] = 68, [COST_CGB_NO_ATTACK] = 26,
  [COST_CGB_PLAYING] = 72, [COST_CGB_STOPPED_NO_ENVELOPE] = 80, [COST_CGB_RELEASE] = 92, [COST_CGB_RELEASE_NONE] = 8,
  [COST_CGB_RELEASE_STEPS] = 76, [COST_ENV_WAIT] = 62, [COST_ENV_STEP] = 28, [COST_ENV_STEP_WAVE] = 2,
  [COST_ENV_RELEASE] = 16, [COST_ENV_SUSTAIN] = 12, [COST_ENV_DECAY] = 40, [COST_ENV_ATTACK] = 58,
  [COST_ENV_RELEASE_ON] = 92, [COST_ENV_RELEASE_ENDS] = 10, [COST_ENV_SUSTAIN_STEP] = 58, [COST_ENV_DECAY_ON] = 92,
  [COST_ENV_DECAY_ENDS] = 74, [COST_ENV_ATTACK_ON] = 68, [COST_ENV_ATTACK_ENDS] = 10, [COST_ENV_DECAY_START] = 2,
  [COST_ENV_DECAY_NONE] = 72, [COST_ENV_DECAY_STARTS] = 80, [COST_ENV_DECAY_WAVE] = -6, [COST_ENV_SUSTAIN_START] = 4,
  [COST_ENV_SUSTAIN_NONE] = -46, [COST_ENV_SUSTAIN_STARTS] = 24, [COST_ENV_SUSTAIN_WAVE] = -6,
  [COST_ENV_SUSTAIN_SET] = 14, [COST_ENV_SUSTAIN_SET_DONE] = 16, [COST_ENV_ECHO] = 50, [COST_ENV_STEP_DONE] = 10,
  [COST_ENV_COUNTER_SET] = 2, [COST_ENV_COUNTER_KEPT] = 16, [COST_ENV_AGAIN] = -52, [COST_ENV_DONE] = 16,
  [COST_CGB_OFF1] = 109, [COST_CGB_OFF2] = 101, [COST_CGB_OFF3] = 115, [COST_CGB_OFF4] = 45, [COST_CGB_PITCH] = -10,
  [COST_CGB_PITCH_WAVE] = 6, [COST_CGB_PITCH1] = 16, [COST_CGB_PITCH2] = 16, [COST_CGB_PITCH3] = 6,
  [COST_CGB_PITCH4] = -20, [COST_CGB_FIXED] = 64, [COST_CGB_PITCH_HIGH] = 32, [COST_CGB_PITCH_HIGH4] = 24,
  [COST_CGB_PITCH_DONE1] = 10, [COST_CGB_PITCH_DONE2] = 10, [COST_CGB_PITCH_DONE3] = 4, [COST_CGB_PITCH_DONE4] = 74,
  [COST_CGB_NO_PITCH] = 16, [COST_CGB_VOLUME1] = 61, [COST_CGB_VOLUME2] = 61, [COST_CGB_VOLUME3] = 67,
  [COST_CGB_VOLUME4] = -3, [COST_CGB_WAVE_VOLUME] = -4, [COST_CGB_WAVE_RESTART] = 20, [COST_CGB_SWEEP_CHECK] = 12,
  [COST_CGB_NO_VOLUME] = -4, [COST_CGB_DONE1] = -10, [COST_CGB_DONE2] = -10, [COST_CGB_DONE3] = -4
};
