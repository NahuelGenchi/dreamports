// Ghosts'n Goblins Dreamport: the game's sound, from the original's code in bank 3 at $8380. Every tune and effect is
// read from the player's copy as it plays. A sound is up to five voices, each a record of 16 bytes from $0680: three for
// a tune's two pulses and its triangle, one for the noise, and one for an effect on the second pulse, which silences the
// tune's own second pulse while it plays. V-blank runs every voice once a frame, and each writes the console's sound
// registers as its notes come up.

#include "game.h"

enum { VOICES = 0x0680, VOICE_BYTES = 16, TUNE_VOICES = 3, NOISE_VOICE = 0x06B0, EFFECT_VOICE = 0x06C0 };
// a voice's record
enum {
  V_FLAGS = 0,        // what kind of sound it's part of, with its rank in the low four bits
  V_TEMPO = 1,        // which of the copy's lists of note lengths it uses
  V_AT = 2,           // where it has got to in the copy, 16 bits
  V_VOLUME = 4,       // what a note writes to the channel's first register,
  V_SWEEP = 5,        // and to its second
  V_PITCHES = 6,      // where its list of pitches is, 16 bits; an effect keeps how its pitch slides here
  V_LEFT = 8,         // frames until its next note or step
  V_PITCH_LOW = 9,    // an effect's pitch as it slides,
  V_PITCH_HIGH = 10,  // which on a tune's voice counts the notes left in a group of three
  V_TRIPLET = 10,
  V_SCRATCH = 11,
  V_REPEATS = 14,
  V_PLAYING = 15,
};
// the copy's tables in bank 3: each sound's voices, each tempo's note lengths, and the lengths of notes in threes
enum { SOUNDS = 0x89AF, TEMPOS = 0x883A, TRIPLETS = 0x888E };
// the last tune voice's "silenced" answer stays in work memory, and the effect voice reads it when it plays as a tune's
#define SILENCED RAM[0xFE]

static uint8_t copy(uint16_t address) { return cart(3, address); }
static uint16_t copy16(uint16_t address) { return (uint16_t)(copy(address) | copy((uint16_t)(address + 1)) << 8); }
static uint16_t at(const uint8_t *voice) { return (uint16_t)(voice[V_AT] | voice[V_AT + 1] << 8); }
static void move_to(uint8_t *voice, uint16_t address) { voice[V_AT] = (uint8_t)address; voice[V_AT + 1] = (uint8_t)(address >> 8); }

// sub_ED97: all the sound registers to 0, from the last down.
void sound_registers_off(void) {
  for (int i = 0x0F; i >= 0; i--) nes_write((uint16_t)(0x4000 + i), 0);
}

// sub_ED72: no voice plays.
void sound_reset(void) {
  for (int i = 0; i < 0x50; i++) RAM[VOICES + i] = 0;
  sound_registers_off();
}

// $87BE: a voice is over, and its channel is silent.
static void voice_ends(uint8_t *voice, uint16_t registers) {
  voice[V_REPEATS] = voice[V_PLAYING] = voice[V_FLAGS] = 0;
  nes_write(registers, 0);
}

// sub_03_8626: a tune's voice, when its note is over: the next thing in its part of the copy. A byte with any of its top
// three bits is a note, whose low five bits are its pitch, or 0 for a rest, and whose top three its length; $30 says
// the next notes come in threes; and a byte below $20 is an order: 0 gives the channel's volume and sweep, 1 its list
// of pitches, and any other repeats from an earlier place a number of times. $FF ends the voice.
static void tune_voice(uint8_t *voice, uint16_t registers) {
  if (--voice[V_LEFT]) return;
  for (;;) {
    if (voice[V_TRIPLET] == 1) {
      voice[V_TRIPLET] = 0;
      move_to(voice, (uint16_t)(at(voice) - 1));
    }
    uint16_t lengths = copy16((uint16_t)(TEMPOS + voice[V_TEMPO] * 2)), here = at(voice);
    uint8_t byte = copy(here);
    if (byte == 0xFF) { voice_ends(voice, registers); return; }
    if (byte == 0x30) {
      voice[V_TRIPLET] = 4;
      move_to(voice, (uint16_t)(here + 1));
      continue;
    }
    if (voice[V_TRIPLET]) voice[V_TRIPLET]--;
    if (!(byte & 0xE0)) {
      if (byte == 0) {
        voice[V_VOLUME] = copy((uint16_t)(here + 1));
        voice[V_SWEEP] = copy((uint16_t)(here + 2));
        move_to(voice, (uint16_t)(here + 3));
      } else if (byte == 1) {
        voice[V_PITCHES] = copy((uint16_t)(here + 1));
        voice[V_PITCHES + 1] = copy((uint16_t)(here + 2));
        move_to(voice, (uint16_t)(here + 3));
      } else if (copy((uint16_t)(here + 1)) == voice[V_REPEATS]) {
        voice[V_REPEATS] = 0;
        move_to(voice, (uint16_t)(here + 4));
      } else {
        voice[V_REPEATS]++;
        move_to(voice, copy16((uint16_t)(here + 2)));
      }
      continue;
    }
    // $86A0: a note. Its pitch is the channel's timer, from the voice's list, and the top of the timer's high byte
    // comes from the tempo's list, with the note's length in frames after it. A pitch of $1F, which ties two notes,
    // and a pitch whose timer is 0 in the list ($86C5, $86F2) aren't ported yet.
    if (!SILENCED) {
      nes_write(registers, voice[V_VOLUME]);
      nes_write((uint16_t)(registers + 1), voice[V_SWEEP]);
    }
    uint8_t pitch = byte & 0x1F, low = 0, high = 0;
    if (pitch) {
      uint16_t pitches = (uint16_t)(voice[V_PITCHES] | voice[V_PITCHES + 1] << 8);
      low = copy((uint16_t)(pitches + pitch * 2));
      high = copy((uint16_t)(pitches + pitch * 2 + 1));
    }
    uint8_t length = (byte >> 4) & 0x0E;
    if (!SILENCED) {
      nes_write((uint16_t)(registers + 2), low);
      nes_write((uint16_t)(registers + 3), high | copy((uint16_t)(lengths + length)));
    }
    if (!voice[V_TRIPLET]) {
      voice[V_LEFT] = copy((uint16_t)(lengths + length + 1));
      move_to(voice, (uint16_t)(here + 1));
    } else {
      // $879F and $8783: a note of a group of three takes its length from the list at $888E, by the tempo
      uint8_t tempo = (uint8_t)((voice[V_TEMPO] << 3) & 0xFC);
      voice[V_SCRATCH] = (uint8_t)(tempo * 3);
      voice[V_LEFT] = copy((uint16_t)(TRIPLETS + (uint8_t)(((length - 4) << 1) + voice[V_SCRATCH] + voice[V_TRIPLET])));
      move_to(voice, (uint16_t)(here + 2));
    }
    return;
  }
}

// $84D0: the effect on the second pulse. Each of its steps is six bytes: how long it lasts, a pitch to start from, or $FF
// to go on from where it is, how much the pitch changes each frame, the volume, and a last byte for the timer's high
// register. $FF as a step's first byte ends it. The step $FE, which repeats ($859E), isn't ported yet.
static void effect_voice(uint8_t *voice, uint16_t registers) {
  if (--voice[V_LEFT]) {
    // $84E6: the pitch slides by the step's change, up, or down when the change's top bit is on
    uint8_t change = voice[V_PITCHES], low = (uint8_t)(voice[V_PITCH_LOW] + change), high = voice[V_PITCH_HIGH];
    int carry = voice[V_PITCH_LOW] + change > 0xFF;
    voice[V_PITCH_LOW] = low;
    if (carry) {
      uint8_t next = (uint8_t)(change & 0x80 ? high - 1 : high + 1);
      if (!(next & 0x80)) voice[V_PITCH_HIGH] = high = next;
    }
    nes_write(registers, (voice[V_SCRATCH] & 0x0F) | 0x30);
    if (high & 0x80) return;
    nes_write((uint16_t)(registers + 2), low);
    nes_write((uint16_t)(registers + 3), high);
    return;
  }
  uint16_t step = (uint16_t)(at(voice) + 6);
  move_to(voice, step);
  uint8_t lasts = copy(step);
  if (lasts == 0xFF) {
    nes_write(registers, 0);
    voice[V_FLAGS] = voice[V_REPEATS] = voice[V_PLAYING] = 0;
    return;
  }
  voice[V_LEFT] = lasts;
  if (copy((uint16_t)(step + 1)) != 0xFF) {
    voice[V_PITCH_LOW] = copy((uint16_t)(step + 1));
    nes_write((uint16_t)(registers + 2), voice[V_PITCH_LOW]);
    voice[V_PITCH_HIGH] = copy((uint16_t)(step + 2));
    nes_write((uint16_t)(registers + 3), voice[V_PITCH_HIGH]);
  }
  voice[V_PITCHES] = copy((uint16_t)(step + 3));
  voice[V_SCRATCH] = copy((uint16_t)(step + 4));
  nes_write((uint16_t)(registers + 3), copy((uint16_t)(step + 5)));
}

// sub_03_85DA: the noise. Each of its steps is three bytes: how long it lasts, the volume, with the top bit for the kind of
// noise, and the pitch, and a fourth byte, shared with the next step, for the length register. $FF ends it.
static void noise_voice(uint8_t *voice) {
  if (--voice[V_LEFT]) return;
  uint16_t step = (uint16_t)(at(voice) + 3);
  move_to(voice, step);
  if (copy(step) == 0xFF) { voice_ends(voice, 0x400C); return; }
  voice[V_LEFT] = copy(step);
  uint8_t volume = copy((uint16_t)(step + 1));
  nes_write(0x400C, volume & 0x3F);
  nes_write(0x400E, copy((uint16_t)(step + 2)) & 0x0F);
  nes_write(0x400F, (uint8_t)(((volume & 0x80) | copy((uint16_t)(step + 3)) >> 1) & 0xF8));
}

// sub_ED94, $8380: every voice that's playing, once a frame.
void sound_frame(void) {
  for (int i = 0; i < TUNE_VOICES; i++) {
    uint8_t *voice = &RAM[VOICES + i * VOICE_BYTES];
    uint16_t registers = (uint16_t)(0x4000 + i * 4);
    if (!voice[V_PLAYING]) continue;
    if (voice[V_FLAGS] & 0x40) {      // $844D: a voice that plays as an effect does
      effect_voice(voice, registers);
      continue;
    }
    // a tune's first pulse is silent while the noise's voice plays a sound that isn't noise, and its second while the
    // effect's voice plays
    if (i == 0) SILENCED = RAM[NOISE_VOICE + V_PLAYING] && !(RAM[NOISE_VOICE + V_FLAGS] & 0x20) ? 0xFF : 0;
    else if (i == 1) SILENCED = RAM[EFFECT_VOICE + V_PLAYING] ? 0xFF : 0;
    else SILENCED = 0;
    tune_voice(voice, registers);
  }
  uint8_t *noise = &RAM[NOISE_VOICE], *effect = &RAM[EFFECT_VOICE];
  if (noise[V_PLAYING]) {
    if (noise[V_FLAGS] & 0x20) noise_voice(noise);
    else effect_voice(noise, 0x4000);   // $84B2: an effect on the first pulse, whose own bit says a tune's voice ($84C7)
  }
  if (effect[V_PLAYING]) {
    if (effect[V_FLAGS] & 0x80) tune_voice(effect, 0x4004);
    else effect_voice(effect, 0x4004);
  }
}

// sub_03_838A: a voice starts a sound's part, unless what it's playing ranks higher.
static void start_voice(uint8_t *voice, uint8_t flags, uint8_t tempo, uint16_t part) {
  if ((flags & 0x0F) < voice[V_FLAGS]) return;
  voice[V_FLAGS] = flags;
  voice[V_TEMPO] = tempo;
  move_to(voice, part);
  voice[V_VOLUME] = copy((uint16_t)(part + 1));
  voice[V_SWEEP] = copy((uint16_t)(part + 2));
  voice[V_LEFT] = 1;
  voice[V_PLAYING] = 0x80;
  voice[V_REPEATS] = 0;
  voice[V_TRIPLET] = 0;
}

// sub_ED51, $8383: plays the sound `number`. The copy's list at $89AF has 12 bytes for each: its flags, its tempo, and
// where each of the five voices' parts is, or 0 for a voice it leaves alone.
void sound_play(uint8_t number) {
  RAM[0x23] = number;
  RAM[0xD4] = BANK_NOW;
  uint16_t sound = (uint16_t)(SOUNDS + (uint8_t)(number << 2) * 3);
  uint8_t flags = copy(sound), tempo = copy((uint16_t)(sound + 1));
  RAM[0x48] = flags;
  RAM[0x49] = tempo;
  for (int i = 0; i < 5; i++) {
    uint16_t part = copy16((uint16_t)(sound + 2 + i * 2));
    set_ram16(0x4A, part);
    if (part) start_voice(&RAM[VOICES + i * VOICE_BYTES], flags, tempo, part);
  }
}
