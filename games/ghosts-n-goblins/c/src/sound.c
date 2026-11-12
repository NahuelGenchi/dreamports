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
  took(SOUND_REGISTERS_BEGIN);
  for (int i = 0x0F; i >= 0; i--) {
    took(SOUND_REGISTER_OFF);
    hardware_write((uint16_t)(0x4000 + i), 0);
    took(SOUND_REGISTER_NEXT);
    took(i ? GOES_ROUND : GOES_ON);
  }
  took(RETURNS);
}

// sub_ED72: no voice plays.
void sound_reset(void) {
  for (int i = 0; i < 0x50; i++) RAM[VOICES + i] = 0;
  took(SOUND_MEMORY_CLEARED);
  sound_registers_off();
}

// $87BE: a voice is over, and its channel is silent.
static void voice_ends(uint8_t *voice, uint16_t registers) {
  voice[V_REPEATS] = voice[V_PLAYING] = voice[V_FLAGS] = 0;
  hardware_write(registers, 0);
}

// A byte of the copy read through a pointer and a count on from it, as the original's instructions read it: a cycle
// more when the two cross into the next page.
static uint8_t read(uint16_t from, uint8_t on) {
  if ((from & 0xFF) + on > 0xFF) took(READ_PAST_PAGE);
  return copy((uint16_t)(from + on));
}

// sub_03_8626: a tune's voice, when its note is over: the next thing in its part of the copy. A byte with any of its top
// three bits is a note, whose low five bits are its pitch, or 0 for a rest, and whose top three its length; $30 says
// the next notes come in threes; and a byte below $20 is an order: 0 gives the channel's volume and sweep, 1 its list
// of pitches, and any other repeats from an earlier place a number of times. $FF ends the voice.
static void tune_voice(uint8_t *voice, uint16_t registers) {
  if (--voice[V_LEFT]) { took(TUNE_WAITS); return; }
  took(TUNE_NOTE_OVER);
  for (;;) {
    if (voice[V_TRIPLET] != 1) took(TUNE_NEXT);
    else {
      took(TUNE_NEXT_AFTER_THREE);
      if (!voice[V_AT]) took(TUNE_BACK_A_PAGE);
      voice[V_TRIPLET] = 0;
      move_to(voice, (uint16_t)(at(voice) - 1));
    }
    uint16_t lengths = copy16((uint16_t)(TEMPOS + voice[V_TEMPO] * 2)), here = at(voice);
    took(TUNE_READ);
    uint8_t byte = read(here, 0);
    if (byte == 0xFF) {
      took(TUNE_IS_OVER);
      voice_ends(voice, registers);
      return;
    }
    took(TUNE_IS_NOT_OVER);
    if (byte == 0x30) {
      took(TUNE_THREES_BEGIN);
      voice[V_TRIPLET] = 4;
      move_to(voice, (uint16_t)(here + 1));
      continue;
    }
    took(TUNE_NOT_THREES);
    took(voice[V_TRIPLET] ? TUNE_COUNTS_THREES : TUNE_COUNTS_NONE);
    if (voice[V_TRIPLET]) voice[V_TRIPLET]--;
    read(here, 0);
    if (!(byte & 0xE0)) {
      took(TUNE_IS_ORDER);
      read(here, 0);
      if (byte == 0) {
        took(TUNE_ORDER_VOLUME);
        voice[V_VOLUME] = read(here, 1);
        voice[V_SWEEP] = read(here, 2);
        move_to(voice, (uint16_t)(here + 3));
      } else if (byte == 1) {
        took(TUNE_ORDER_PITCHES);
        voice[V_PITCHES] = read(here, 1);
        voice[V_PITCHES + 1] = read(here, 2);
        move_to(voice, (uint16_t)(here + 3));
      } else if (read(here, 1) == voice[V_REPEATS]) {
        // the repeats are done: on past the order, and nothing more this frame
        took(TUNE_ORDER_REPEATED);
        voice[V_REPEATS] = 0;
        move_to(voice, (uint16_t)(here + 4));
        return;
      } else {
        took(TUNE_ORDER_REPEAT);
        voice[V_REPEATS]++;
        move_to(voice, (uint16_t)(read(here, 2) | read(here, 3) << 8));
      }
      continue;
    }
    // $86A0: a note. Its pitch is the channel's timer, from the voice's list, and the top of the timer's high byte
    // comes from the tempo's list, with the note's length in frames after it. A byte whose pitch is $1F comes before a
    // note to make it half as long again: the length one shorter in the tempo's list is added to its own. A pitch whose
    // timer is 0 in the list leaves the channel's timer as it is.
    took(TUNE_IS_NOTE);
    took(SILENCED ? TUNE_NOTE_SILENCED : TUNE_NOTE_VOLUME);
    if (!SILENCED) {
      hardware_write(registers, voice[V_VOLUME]);
      hardware_write((uint16_t)(registers + 1), voice[V_SWEEP]);
    }
    took(TUNE_NOTE_BEGINS);
    uint8_t longer = 0;
    while ((read(here, longer) & 0x1F) == 0x1F) {
      took(TUNE_NOTE_LONGER);
      longer++;
    }
    uint8_t note = copy((uint16_t)(here + longer)), pitch = note & 0x1F, length = (note >> 4) & 0x0E, low = 0, high = 0;
    if (!pitch) took(TUNE_NOTE_IS_REST);
    else {
      uint16_t pitches = (uint16_t)(voice[V_PITCHES] | voice[V_PITCHES + 1] << 8);
      took(TUNE_NOTE_PITCH);
      low = read(pitches, (uint8_t)(pitch * 2));
      high = read(pitches, (uint8_t)(pitch * 2 + 1));
    }
    if (low || !pitch) {
      if (pitch) took(TUNE_NOTE_HAS_TIMER);
      took(SILENCED ? TUNE_TIMER_SILENCED : TUNE_TIMER_LOW);
      if (!SILENCED) hardware_write((uint16_t)(registers + 2), low);
      took(TUNE_NOTE_LENGTH);
      read(here, longer);
      uint8_t top = read(lengths, length);
      took(SILENCED ? TUNE_TIMER_HIGH_SILENCED : TUNE_TIMER_HIGH);
      if (!SILENCED) hardware_write((uint16_t)(registers + 3), high | top);
    } else {
      took(TUNE_NOTE_NO_TIMER);
      read(here, longer);
    }
    if (!voice[V_TRIPLET]) {
      took(TUNE_LENGTH_PLAIN);
      voice[V_LEFT] = read(lengths, (uint8_t)(length + 1));
    } else {
      // $879F and $8783: a note of a group of three takes its length from the list at $888E, by the tempo
      took(TUNE_LENGTH_OF_THREE);
      read(here, longer);
      uint8_t tempo = (uint8_t)((voice[V_TEMPO] << 3) & 0xFC);
      voice[V_SCRATCH] = (uint8_t)(tempo * 3);
      uint8_t which = (uint8_t)(((length - 4) << 1) + voice[V_SCRATCH] + voice[V_TRIPLET]);
      voice[V_LEFT] = read(TRIPLETS, which);
    }
    if (longer) {
      took(TUNE_LENGTH_LONGER);
      voice[V_LEFT] += read(lengths, (uint8_t)(length - 1));
    } else took(voice[V_TRIPLET] ? TUNE_ON_BY_TWO : TUNE_ON_BY_ONE);
    move_to(voice, (uint16_t)(here + (longer || voice[V_TRIPLET] ? 2 : 1)));
    return;
  }
}

// $84D0: the effect on the second pulse. Each of its steps is six bytes: how long it lasts, a pitch to start from, or $FF
// to go on from where it is, how much the pitch changes each frame, the volume, and a last byte for the timer's high
// register. $FF as a step's first byte ends it. The step $FE, which repeats ($859E), isn't ported yet.
static void effect_voice(uint8_t *voice, uint16_t registers) {
  took(EFFECT_BEGINS);
  if (--voice[V_LEFT]) {
    // $84E6: the pitch slides by the step's change, up, or down when the change's top bit is on
    uint8_t change = voice[V_PITCHES], low = (uint8_t)(voice[V_PITCH_LOW] + change), high = voice[V_PITCH_HIGH];
    int carry = voice[V_PITCH_LOW] + change > 0xFF, down = change & 0x80;
    voice[V_PITCH_LOW] = low;
    took(down ? EFFECT_SLIDES_DOWN : EFFECT_SLIDES_UP);
    if (!carry) took(down ? EFFECT_DOWN_PLAIN : EFFECT_UP_PLAIN);
    else {
      uint8_t next = (uint8_t)(down ? high - 1 : high + 1);
      if (next & 0x80) took(down ? EFFECT_DOWN_KEPT : EFFECT_UP_KEPT);
      else {
        took(down ? EFFECT_DOWN_CARRIED : EFFECT_UP_CARRIED);
        voice[V_PITCH_HIGH] = high = next;
      }
    }
    hardware_write(registers, (voice[V_SCRATCH] & 0x0F) | 0x30);
    if (high & 0x80) { took(EFFECT_SLID_SILENT); return; }
    took(EFFECT_SLID);
    hardware_write((uint16_t)(registers + 2), low);
    hardware_write((uint16_t)(registers + 3), high);
    return;
  }
  uint16_t step = (uint16_t)(at(voice) + 6);
  took(EFFECT_NEXT_STEP);
  if (!(step & 0xFF) || (step & 0xFF) < 6) took(EFFECT_STEP_NEXT_PAGE);
  move_to(voice, step);
  uint8_t lasts = read(step, 0);
  if (lasts == 0xFF) {
    took(EFFECT_IS_OVER);
    hardware_write(registers, 0);
    voice[V_FLAGS] = voice[V_REPEATS] = voice[V_PLAYING] = 0;
    return;
  }
  took(EFFECT_STEP);
  voice[V_LEFT] = lasts;
  if (read(step, 1) == 0xFF) took(EFFECT_STEP_KEEPS_PITCH);
  else {
    took(EFFECT_STEP_PITCH);
    voice[V_PITCH_LOW] = copy((uint16_t)(step + 1));
    hardware_write((uint16_t)(registers + 2), voice[V_PITCH_LOW]);
    voice[V_PITCH_HIGH] = read(step, 2);
    hardware_write((uint16_t)(registers + 3), voice[V_PITCH_HIGH]);
  }
  took(EFFECT_STEP_ENDS);
  voice[V_PITCHES] = read(step, 3);
  voice[V_SCRATCH] = read(step, 4);
  hardware_write((uint16_t)(registers + 3), read(step, 5));
}

// sub_03_85DA: the noise. Each of its steps is three bytes: how long it lasts, the volume, with the top bit for the kind of
// noise, and the pitch, and a fourth byte, shared with the next step, for the length register. $FF ends it.
static void noise_voice(uint8_t *voice) {
  if (--voice[V_LEFT]) { took(NOISE_WAITS); return; }
  uint16_t step = (uint16_t)(at(voice) + 3);
  took(NOISE_NEXT_STEP);
  move_to(voice, step);
  if (read(step, 0) == 0xFF) {
    took(NOISE_IS_OVER);
    voice_ends(voice, 0x400C);
    return;
  }
  took(NOISE_STEP);
  voice[V_LEFT] = copy(step);
  uint8_t volume = read(step, 1);
  hardware_write(0x400C, volume & 0x3F);
  hardware_write(0x400E, read(step, 2) & 0x0F);
  hardware_write(0x400F, (uint8_t)(((volume & 0x80) | read(step, 3) >> 1) & 0xF8));
}

// $84C7: a voice that plays an effect, or a tune's part if its top bit says so.
static void effect_or_tune(uint8_t *voice, uint16_t registers) {
  if (voice[V_FLAGS] & 0x80) {
    took(SOUND_PLAYS_TUNE);
    tune_voice(voice, registers);
  } else {
    took(SOUND_PLAYS_EFFECT);
    effect_voice(voice, registers);
  }
}

// sub_ED94, $8380: every voice that's playing, once a frame.
void sound_frame(void) {
  took(SOUND_BEGINS);
  for (int i = 0; i < TUNE_VOICES; i++) {
    uint8_t *voice = &RAM[VOICES + i * VOICE_BYTES];
    uint16_t registers = (uint16_t)(0x4000 + i * 4);
    if (!voice[V_PLAYING]) took(SOUND_VOICE_IDLE);
    else {
      took(SOUND_VOICE_PLAYS);
      if (voice[V_FLAGS] & 0x40) {      // $844D: a voice that plays as an effect does
        took(SOUND_VOICE_AS_EFFECT);
        effect_voice(voice, registers);
      } else {
        // a tune's first pulse is silent while the noise's voice plays a sound that isn't noise, and its second while
        // the effect's voice plays
        if (i == 0) {
          uint8_t noise_plays = RAM[NOISE_VOICE + V_PLAYING], is_noise = RAM[NOISE_VOICE + V_FLAGS] & 0x20;
          SILENCED = noise_plays && !is_noise ? 0xFF : 0;
          took(!noise_plays ? SOUND_FIRST_FREE : is_noise ? SOUND_FIRST_WITH_NOISE : SOUND_FIRST_SILENCED);
        } else if (i == 1) {
          SILENCED = RAM[EFFECT_VOICE + V_PLAYING] ? 0xFF : 0;
          took(SILENCED ? SOUND_SECOND_SILENCED : SOUND_SECOND_FREE);
        } else {
          SILENCED = 0;
          took(SOUND_THIRD);
        }
        took(SOUND_VOICE_CALLED);
        tune_voice(voice, registers);
      }
    }
    took(SOUND_NEXT_VOICE);
    took(i + 1 < TUNE_VOICES ? GOES_ROUND : GOES_ON);
  }
  uint8_t *noise = &RAM[NOISE_VOICE], *effect = &RAM[EFFECT_VOICE];
  if (!noise[V_PLAYING]) took(SOUND_NOISE_IDLE);
  else if (noise[V_FLAGS] & 0x20) {
    took(SOUND_NOISE_PLAYS);
    noise_voice(noise);
  } else {
    took(SOUND_NOISE_AS_EFFECT);
    effect_or_tune(noise, 0x4000);   // $84B2: on the first pulse
  }
  if (!effect[V_PLAYING]) took(SOUND_EFFECT_IDLE);
  else {
    took(SOUND_EFFECT_PLAYS);
    effect_or_tune(effect, 0x4004);
  }
}

// sub_03_838A: a voice starts a sound's part, unless what it's playing ranks higher.
static void start_voice(uint8_t *voice, uint8_t flags, uint8_t tempo, uint16_t part) {
  if ((flags & 0x0F) < voice[V_FLAGS]) { took(VOICE_KEPT); return; }
  took(VOICE_STARTED);
  voice[V_FLAGS] = flags;
  voice[V_TEMPO] = tempo;
  move_to(voice, part);
  voice[V_VOLUME] = read(part, 1);
  voice[V_SWEEP] = read(part, 2);
  voice[V_LEFT] = 1;
  voice[V_PLAYING] = 0x80;
  voice[V_REPEATS] = 0;
  voice[V_TRIPLET] = 0;
}

// sub_ED51, $8383: plays the sound `number`. The copy's list at $89AF has 12 bytes for each: its flags, its tempo, and
// where each of the five voices' parts is, or 0 for a voice it leaves alone.
void sound_play(uint8_t number) {
  took(SOUND_PLAY_BEGINS);
  RAM[0x23] = number;
  RAM[0xD4] = BANK_NOW;
  uint16_t sound = (uint16_t)(SOUNDS + (uint8_t)(number << 2) * 3);
  took(SOUND_PLAY_FOUND);
  if ((uint8_t)(number << 2) & 0x80) took(SOUND_PLAY_FAR);
  uint8_t flags = read(sound, 0), tempo = read(sound, 1);
  RAM[0x48] = flags;
  RAM[0x49] = tempo;
  for (uint8_t i = 0; i < 5; i++) {
    took(SOUND_VOICE_READ);
    uint16_t part = (uint16_t)(read(sound, (uint8_t)(2 + i * 2)) | read(sound, (uint8_t)(3 + i * 2)) << 8);
    set_ram16(0x4A, part);
    took(part ? SOUND_VOICE_PART : SOUND_VOICE_NO_PART);
    if (part) start_voice(&RAM[VOICES + i * VOICE_BYTES], flags, tempo, part);
    took(SOUND_VOICE_NEXT);
    took(i < 4 ? GOES_ROUND : GOES_ON);
  }
  took(SOUND_PLAY_ENDS);
}
