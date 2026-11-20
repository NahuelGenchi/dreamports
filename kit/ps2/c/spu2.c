// The PlayStation 2's sound chip, the SPU2 (ps2-kit.h): its two cores of 24 voices each, the chip's memory, written
// through each core's data port or by DMA, and its interrupt address. It is mixed as the console is known to mix it,
// 48,000 samples a second: each voice's ADPCM decoded four samples at a time from the chip's memory as it's read, so a
// write is heard from the next samples decoded; stepped between samples by the chip's four-point table; shaped by its
// envelope and its two volumes, each stepped by a counter, with every volume a product shifted fifteen bits; noise and
// pitch modulation; each voice's four mixing switches and each core's twelve; the reverb in whole numbers at half the
// rate, through its two 39-tap filters; the sound a core is sent in blocks, read from the chip's memory; and what the
// chip writes back into its memory as it goes, which its interrupt address can be in.
//
// The tools' emulator, Play!, has this file built into it in place of its own chip (tools/libretro/play.patch), so
// the original and a Dreamport are mixed by the same code, and it is checked against a second emulator's SPU2, PCSX2's,
// on programs of the project's own (kit/ps2/c/README.md). What the IOP sees of the chip stays as Play! has it, since
// that is what a Dreamport is proven against: the registers' places, the data port, DMA and when a core takes it, and
// the interrupt flags.
//
// Every write to the chip's registers, every block of sound data moved by DMA and every block of 48 samples mixed is
// the frame's sound list, hashed in the order it came as the proof tools hash the original's.
//
// The mixing follows PCSX2's SPU2 (https://github.com/PCSX2/pcsx2, pcsx2/SPU2), Copyright (c) 2002-2026 PCSX2 Dev
// Team, under the GNU General Public License, version 3 or later, which is this project's licence too. The four-point
// table is the console's, from PCSX2's interpolate_table.h, whose generator is Near's, with credit to nocash and
// Ryphecha. The registers and DMA follow Play! (https://github.com/jpd002/Play-), under its licence:
//
// Copyright (c) 2006-2026, Jean-Philip Desjardins. All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the
// following conditions are met:
//  * Redistributions of source code must retain the above copyright notice, this list of conditions and the following
//    disclaimer.
//  * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the
//    following disclaimer in the documentation and/or other materials provided with the distribution.
//
// THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING,
// BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN
// NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
// CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
// OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
// LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
// ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#include "ps2-kit.h"

#define RAM_SIZE 0x200000
#define RAM_MASK (RAM_SIZE - 1)
#define WORD_MASK 0xFFFFF
#define VOICES 24
#define BLOCK_SAMPLES 48
#define INPUT_SIZE 0x400

// the core's control bits, its transfer modes, a voice's envelope's phases and an ADPCM block's flags
enum { CONTROL_REVERB = 0x80, CONTROL_IRQ = 0x40, CONTROL_DMA = 0x30, CONTROL_DMA_STOP = 0x00, CONTROL_DMA_READ = 0x30 };
enum { MODE_VOICE = 0, MODE_CORE0_IN = 1, MODE_CORE1_IN = 2 };
enum { STOPPED, ATTACK, DECAY, SUSTAIN, RELEASE };
enum { FLAG_END = 1, FLAG_LOOP = 2, FLAG_START = 4 };
// the reverb's addresses, in the order of their registers from 0x2E4, four bytes apart, and its volumes, in the order
// of theirs from 0x774, two bytes apart
enum {
  APF1_SIZE, APF2_SIZE, SAME_L_DST, SAME_R_DST, COMB1_L_SRC, COMB1_R_SRC, COMB2_L_SRC, COMB2_R_SRC, SAME_L_SRC, SAME_R_SRC,
  DIFF_L_DST, DIFF_R_DST, COMB3_L_SRC, COMB3_R_SRC, COMB4_L_SRC, COMB4_R_SRC, DIFF_L_SRC, DIFF_R_SRC, APF1_L_DST, APF1_R_DST,
  APF2_L_DST, APF2_R_DST, REVERB_ADDRESSES,
};
enum { IIR_VOL, COMB1_VOL, COMB2_VOL, COMB3_VOL, COMB4_VOL, WALL_VOL, APF1_VOL, APF2_VOL, IN_COEF_L, IN_COEF_R, REVERB_VOLUMES };

// a volume that can sweep: its register, the counter its steps wait on, and where it is now
typedef struct {
  uint16_t reg;
  uint32_t counter;
  int32_t value;
} slide;

// A voice: its volumes, pitch and envelope, where its sound starts, loops and is being read, in words of the chip's
// memory, the two samples before the next to decode, how far it is between samples, the samples decoded and not yet
// played, and what it gave last, which bends the next voice's pitch
typedef struct {
  slide left, right;
  uint16_t pitch, adsr1, adsr2;
  uint32_t envelope_counter;
  int32_t envelope;
  uint8_t phase, loop_set, flags;
  uint32_t start, loop, next;
  int32_t before1, before2;
  uint32_t between, played, decoded;
  int16_t fifo[32];
  int32_t out;
} voice;

typedef struct {
  unsigned number;
  uint16_t control, transfer_mode, mmix;
  uint8_t irq_pending;
  uint32_t irq_addr;
  // the data port's address, in bytes, as the emulator's DMA counts it
  uint32_t transfer_addr;
  // keys pressed and let go since the last sample, the voices bent by the one before and those that play noise, each
  // voice's four mixing switches, and the voices that have reached their end
  uint32_t key_on, key_off, bent, noise, dry_left, dry_right, wet_left, wet_right, ended;
  slide master_left, master_right;
  int32_t effect_left, effect_right, external_left, external_right, input_left, input_right;
  uint32_t noise_count, noise_out;
  uint32_t reverb_start, reverb_end, reverb_address[REVERB_ADDRESSES];
  int16_t reverb_volume[REVERB_VOLUMES];
  // what goes into the reverb and what comes out of it, kept twice over for its filters, and where they're written
  int16_t down[2][128], up[2][128];
  uint32_t reverb_at;
  voice voices[VOICES];
  // a block of sound input the IOP has sent and the core hasn't yet taken into the chip's memory, and which half of
  // its buffer the next goes in
  uint8_t waiting[INPUT_SIZE];
  uint32_t input_written, input_half;
  // what each register was last written, for one read back that nothing else answers
  uint16_t written[0x400];
} core;

static struct spu2 {
  uint8_t *ram;
  core cores[2];
  // samples mixed since power-on, and where the cores are in the buffers they write and read in the chip's memory
  uint32_t cycles, at;
  uint32_t spdif_out, spdif_mode, spdif_media;
  // the frame's samples, left and right
  int16_t *heard;
  uint32_t heard_count, heard_room;
} spu;

// ----------------------------------------------------------------------------------------------------------------
// The sound list

static uint32_t list_hash = 0x811C9DC5, list_count;
static uint8_t *list_bytes;
static uint32_t list_size, list_room;
#define LIST_MOST (4u << 20)

static void list_keep(const void *data, uint32_t size) {
  if (list_size == 0xFFFFFFFF) return;
  if (list_size + size > LIST_MOST) {
    list_size = 0xFFFFFFFF;
    return;
  }
  if (list_size + size > list_room) {
    uint32_t room = list_room ? list_room * 2 : 65536;
    while (room < list_size + size) room *= 2;
    uint8_t *more = kit_alloc(room);
    if (list_size) __builtin_memcpy(more, list_bytes, list_size);
    list_bytes = more;
    list_room = room;
  }
  __builtin_memcpy(list_bytes + list_size, data, size);
  list_size += size;
}
// a thing in the list: its kind and its bytes, which are hashed, and kept whole, or as their length and their own hash
static void listed(char kind, const void *data, uint32_t length, int keep) {
#ifdef SPU2_IN_REFERENCE
  // the tools' emulator keeps the original's list itself, with everything else it's asked for (tools/libretro/play.patch)
  (void)kind, (void)data, (void)length, (void)keep;
  return;
#endif
  const uint8_t *bytes = data;
  uint32_t own = 0x811C9DC5;
  list_hash = (list_hash ^ (uint8_t)kind) * 0x01000193;
  for (uint32_t i = 0; i < length; i++) {
    list_hash = (list_hash ^ bytes[i]) * 0x01000193;
    own = (own ^ bytes[i]) * 0x01000193;
  }
  list_count++;
  list_keep(&kind, 1);
  if (keep) list_keep(data, length);
  else {
    uint32_t about[2] = { length, own };
    list_keep(about, 8);
  }
}

void spu2_list_start(void) {
  list_hash = 0x811C9DC5;
  list_count = 0;
  list_size = 0;
  spu.heard_count = 0;
}
uint32_t spu2_list_hash(void) { return list_hash; }
uint32_t spu2_list_count(void) { return list_count; }
const uint8_t *spu2_list_bytes(uint32_t *size) {
  *size = list_size;
  return list_bytes;
}
const int16_t *spu2_heard(uint32_t *pairs) {
  *pairs = spu.heard_count / 2;
  return spu.heard;
}


// ----------------------------------------------------------------------------------------------------------------
// The chip's memory, in words, and its interrupt address

static void core_reset(core *c, unsigned number) {
  __builtin_memset(c, 0, sizeof *c);
  c->number = number;
  c->irq_addr = 0x800;
  c->mmix = number ? 0xFFC : 0xFF0;
  c->dry_left = c->dry_right = c->wet_left = c->wet_right = 0xFFFFFF;
  c->ended = 0xFFFFFF;
  c->external_left = c->external_right = c->input_left = c->input_right = 0x7FFF;
  c->reverb_start = number ? 0xFFFF8 : 0xEFFF8;
  c->reverb_end = number ? 0xFFFFF : 0xEFFFF;
  c->input_half = 0x100;
  for (int i = 0; i < VOICES; i++) {
    c->voices[i].pitch = 0x3FFF;
    c->voices[i].start = c->voices[i].loop = 0x2800;
    c->voices[i].next = 0x2801;
  }
}
// the chip as the console starts, with `ram` its memory
static void wake(uint8_t *ram) {
  spu.ram = ram;
  core_reset(&spu.cores[0], 0);
  core_reset(&spu.cores[1], 1);
}
static void woken(void) {
  if (!spu.ram) wake(kit_alloc(RAM_SIZE));
}

// For the tools' emulator, which has this chip in place of its own (tools/libretro/play.patch): the chip as the console
// starts, on the emulator's own memory for it, its state for a save state, and what a DMA transfer's entry in the
// sound list says of a core after it, its transfer mode and its control's DMA bits.
void spu2_power(uint8_t *ram) {
  int16_t *heard = spu.heard;
  uint32_t room = spu.heard_room;
  __builtin_memset(&spu, 0, sizeof spu);
  spu.heard = heard;
  spu.heard_room = room;
  wake(ram);
}
uint32_t spu2_state_size(void) { return sizeof spu; }
void spu2_state_save(uint8_t *to) { __builtin_memcpy(to, &spu, sizeof spu); }
void spu2_state_load(const uint8_t *from) {
  struct spu2 kept = spu;
  __builtin_memcpy(&spu, from, sizeof spu);
  spu.ram = kept.ram;
  spu.heard = kept.heard;
  spu.heard_room = kept.heard_room;
  spu.heard_count = 0;
}
void spu2_transfer(int number, uint32_t *mode, uint32_t *control) {
  woken();
  *mode = spu.cores[number].transfer_mode;
  *control = (uint32_t)(spu.cores[number].control & CONTROL_DMA);
}

static int16_t word_at(uint32_t address) {
  int16_t value;
  __builtin_memcpy(&value, spu.ram + ((address & WORD_MASK) << 1), 2);
  return value;
}
static void set_word_at(uint32_t address, int32_t value) {
  int16_t kept = (int16_t)value;
  __builtin_memcpy(spu.ram + ((address & WORD_MASK) << 1), &kept, 2);
}
// a core whose interrupt address the chip has just read or written is interrupted, whichever core did it
static void touched(uint32_t address) {
  for (int i = 0; i < 2; i++) {
    if ((spu.cores[i].control & CONTROL_IRQ) && spu.cores[i].irq_addr == address) spu.cores[i].irq_pending = 1;
  }
}
// what the chip writes back into its memory as it mixes
static void capture(uint32_t address, int32_t value) {
  touched(address);
  set_word_at(address, value);
}
static int32_t clamped(int32_t value) { return value < -0x8000 ? -0x8000 : value > 0x7FFF ? 0x7FFF : value; }
static int32_t scaled(int32_t sample, int32_t volume) { return (volume * sample) >> 15; }

// ----------------------------------------------------------------------------------------------------------------
// Volumes that sweep, and a voice's envelope

static void slide_set(slide *s, uint16_t value) {
  s->reg = value;
  if (!(value & 0x8000)) s->value = (int16_t)(uint16_t)(value << 1);
}
// one sample of a sweep: its step, 7 less the register's two low bits, taken each time its counter fills, which the
// five bits above set the pace of; bit 12 turns it upside down, bit 13 sends it down, bit 14 makes it exponential
static void slide_step(slide *s) {
  if (!(s->reg & 0x8000)) return;
  int step = s->reg & 3, shift = (s->reg >> 2) & 0x1F, phase = (s->reg >> 12) & 1, down = (s->reg >> 13) & 1, exponential = (s->reg >> 14) & 1;
  int32_t size = 7 - step;
  if (down) size = ~size;
  uint32_t counter = 0x8000u >> (shift > 11 ? shift - 11 : 0);
  int32_t level = size * (1 << (shift < 11 ? 11 - shift : 0));
  if (exponential) {
    if (!down && s->value > 0x6000) counter >>= 2;
    if (down) level = (int16_t)((level * s->value) >> 15);
  }
  if (step != 3 && shift != 0x1F && counter < 1) counter = 1;
  s->counter += counter;
  if (!(exponential && down)) level = phase ? -level : level;
  if (s->counter < 0x8000) return;
  s->counter = 0;
  int32_t low = -0x8000, high = 0x7FFF;
  if (down) {
    low = phase ? -0x8000 : 0;
    high = phase ? 0 : 0x7FFF;
    if (exponential) low = 0, high = 0x7FFF;
  }
  int32_t value = s->value + level;
  s->value = value < low ? low : value > high ? high : value;
}

// One sample of a voice's envelope, and whether the voice goes on. Each phase has a direction, a shape, a pace and a
// step from the voice's two envelope registers, and a level at which the next begins.
static int envelope_step(voice *v) {
  int down, exponential, shift, step;
  int32_t target;
  switch (v->phase) {
  case ATTACK: down = 0, exponential = v->adsr1 >> 15, shift = (v->adsr1 >> 10) & 0x1F, step = 7 - ((v->adsr1 >> 8) & 3), target = 0x7FFF; break;
  case DECAY: down = 1, exponential = 1, shift = (v->adsr1 >> 4) & 0xF, step = -8, target = ((v->adsr1 & 0xF) + 1) << 11; break;
  case SUSTAIN:
    down = (v->adsr2 >> 14) & 1, exponential = v->adsr2 >> 15, shift = (v->adsr2 >> 8) & 0x1F, step = 7 - ((v->adsr2 >> 6) & 3), target = 0;
    if (down) step = ~step;
    break;
  default: down = 1, exponential = (v->adsr2 >> 5) & 1, shift = v->adsr2 & 0x1F, step = -8, target = 0; break;
  }
  uint32_t counter = 0x8000u >> (shift > 11 ? shift - 11 : 0);
  int32_t level = step * (1 << (shift < 11 ? 11 - shift : 0));
  if (exponential) {
    if (!down && v->envelope > 0x6000) counter >>= 2;
    if (down) level = (int16_t)((level * v->envelope) >> 15);
  }
  if (counter < 1) counter = 1;
  v->envelope_counter += counter;
  if (v->envelope_counter >= 0x8000) {
    v->envelope_counter = 0;
    int32_t value = v->envelope + level;
    v->envelope = value < 0 ? 0 : value > 0x7FFF ? 0x7FFF : value;
  }
  if (v->phase == SUSTAIN) return v->envelope != 0;
  if ((!down && v->envelope >= target) || (down && v->envelope <= target)) v->phase++;
  return v->phase <= RELEASE;
}
static void voice_stop(voice *v) {
  v->envelope = 0;
  v->phase = STOPPED;
}

// ----------------------------------------------------------------------------------------------------------------
// A voice's samples

static const int32_t predictors[16][2] = { { 0, 0 }, { 60, 0 }, { 115, -52 }, { 98, -55 }, { 122, -60 } };

// the word a voice is reading passed: its address is one the interrupt can be on
static void next_word(voice *v) {
  touched(v->next);
  v->next = (v->next + 1) & WORD_MASK;
}
// The four samples of the word a voice is at, decoded from the chip's memory as it is now, with its block's header
// as it is now, into the voice's fifo
static void decode(voice *v) {
  int32_t header = word_at(v->next & 0xFFFF8);
  int shift = (header & 0xF) + 16, id = (header >> 4) & 0xF;
  int32_t first = predictors[id][0], second = predictors[id][1];
  uint16_t data = (uint16_t)word_at(v->next);
  for (int i = 0; i < 4; i++) {
    int32_t nibble = (int32_t)(((uint32_t)(data >> (i * 4)) << 28) & 0xF0000000u);
    int32_t sample = (nibble >> shift) + ((first * v->before1 + second * v->before2 + 32) >> 6);
    sample = clamped(sample);
    v->fifo[(v->decoded + (uint32_t)i) % 32] = (int16_t)sample;
    v->before2 = v->before1;
    v->before1 = sample;
  }
}
// A sample's worth of reading: the block's flags are read every sample, and four more samples are decoded when the
// fifo has room, whether the voice is playing or not, as a voice that has stopped still moves through the memory
static void read_ahead(core *c, int i) {
  voice *v = &c->voices[i];
  touched(v->next & 0xFFFF8);
  v->flags = (uint8_t)((uint16_t)word_at(v->next & 0xFFFF8) >> 8);
  if ((v->flags & FLAG_START) && !v->loop_set) v->loop = v->next & 0xFFFF8;
  if ((int32_t)(v->decoded - v->played) > 12) return;
  if (v->phase > STOPPED) decode(v);
  v->decoded += 4;
  next_word(v);
  if ((v->next & 7) == 0) {
    if (v->flags & FLAG_END) {
      c->ended |= 1u << i;
      v->next = v->loop;
      if (!(v->flags & FLAG_LOOP)) voice_stop(v);
    }
    next_word(v);
  }
}

// The chip's four-point table: the weights of the four samples around where a voice is, by how far it is between two
static const int16_t gauss[256][4] = {
  { 0x12C7, 0x59B3, 0x1307, -0x0001 }, { 0x1288, 0x59B2, 0x1347, -0x0001 }, { 0x1249, 0x59B0, 0x1388, -0x0001 }, { 0x120B, 0x59AD, 0x13C9, -0x0001 },
  { 0x11CD, 0x59A9, 0x140B, -0x0001 }, { 0x118F, 0x59A4, 0x144D, -0x0001 }, { 0x1153, 0x599E, 0x1490, -0x0001 }, { 0x1116, 0x5997, 0x14D4, -0x0001 },
  { 0x10DB, 0x598F, 0x1517, -0x0001 }, { 0x109F, 0x5986, 0x155C, -0x0001 }, { 0x1065, 0x597C, 0x15A0, -0x0001 }, { 0x102A, 0x5971, 0x15E6, -0x0001 },
  { 0x0FF1, 0x5965, 0x162C, -0x0001 }, { 0x0FB7, 0x5958, 0x1672, -0x0001 }, { 0x0F7F, 0x5949, 0x16B9, -0x0001 }, { 0x0F46, 0x593A, 0x1700, -0x0001 },
  { 0x0F0F, 0x592A, 0x1747, 0x0000 }, { 0x0ED7, 0x5919, 0x1790, 0x0000 }, { 0x0EA1, 0x5907, 0x17D8, 0x0000 }, { 0x0E6B, 0x58F4, 0x1821, 0x0000 },
  { 0x0E35, 0x58E0, 0x186B, 0x0000 }, { 0x0E00, 0x58CB, 0x18B5, 0x0000 }, { 0x0DCB, 0x58B5, 0x1900, 0x0000 }, { 0x0D97, 0x589E, 0x194B, 0x0001 },
  { 0x0D63, 0x5886, 0x1996, 0x0001 }, { 0x0D30, 0x586D, 0x19E2, 0x0001 }, { 0x0CFD, 0x5853, 0x1A2E, 0x0001 }, { 0x0CCB, 0x5838, 0x1A7B, 0x0002 },
  { 0x0C99, 0x581C, 0x1AC8, 0x0002 }, { 0x0C68, 0x57FF, 0x1B16, 0x0002 }, { 0x0C38, 0x57E2, 0x1B64, 0x0003 }, { 0x0C07, 0x57C3, 0x1BB3, 0x0003 },
  { 0x0BD8, 0x57A3, 0x1C02, 0x0003 }, { 0x0BA9, 0x5782, 0x1C51, 0x0004 }, { 0x0B7A, 0x5761, 0x1CA1, 0x0004 }, { 0x0B4C, 0x573E, 0x1CF1, 0x0005 },
  { 0x0B1E, 0x571B, 0x1D42, 0x0005 }, { 0x0AF1, 0x56F6, 0x1D93, 0x0006 }, { 0x0AC4, 0x56D1, 0x1DE5, 0x0007 }, { 0x0A98, 0x56AB, 0x1E37, 0x0007 },
  { 0x0A6C, 0x5684, 0x1E89, 0x0008 }, { 0x0A40, 0x565B, 0x1EDC, 0x0009 }, { 0x0A16, 0x5632, 0x1F2F, 0x0009 }, { 0x09EB, 0x5609, 0x1F82, 0x000A },
  { 0x09C1, 0x55DE, 0x1FD6, 0x000B }, { 0x0998, 0x55B2, 0x202A, 0x000C }, { 0x096F, 0x5585, 0x207F, 0x000D }, { 0x0946, 0x5558, 0x20D4, 0x000E },
  { 0x091E, 0x5529, 0x2129, 0x000F }, { 0x08F7, 0x54FA, 0x217F, 0x0010 }, { 0x08D0, 0x54CA, 0x21D5, 0x0011 }, { 0x08A9, 0x5499, 0x222C, 0x0012 },
  { 0x0883, 0x5467, 0x2282, 0x0013 }, { 0x085D, 0x5434, 0x22DA, 0x0015 }, { 0x0838, 0x5401, 0x2331, 0x0016 }, { 0x0813, 0x53CC, 0x2389, 0x0018 },
  { 0x07EF, 0x5397, 0x23E1, 0x0019 }, { 0x07CB, 0x5361, 0x2439, 0x001B }, { 0x07A7, 0x532A, 0x2492, 0x001C }, { 0x0784, 0x52F3, 0x24EB, 0x001E },
  { 0x0762, 0x52BA, 0x2545, 0x0020 }, { 0x0740, 0x5281, 0x259E, 0x0021 }, { 0x071E, 0x5247, 0x25F8, 0x0023 }, { 0x06FD, 0x520C, 0x2653, 0x0025 },
  { 0x06DC, 0x51D0, 0x26AD, 0x0027 }, { 0x06BB, 0x5194, 0x2708, 0x0029 }, { 0x069B, 0x5156, 0x2763, 0x002C }, { 0x067C, 0x5118, 0x27BE, 0x002E },
  { 0x065C, 0x50DA, 0x281A, 0x0030 }, { 0x063E, 0x509A, 0x2876, 0x0033 }, { 0x061F, 0x505A, 0x28D2, 0x0035 }, { 0x0601, 0x5019, 0x292E, 0x0038 },
  { 0x05E4, 0x4FD7, 0x298B, 0x003A }, { 0x05C7, 0x4F95, 0x29E7, 0x003D }, { 0x05AA, 0x4F52, 0x2A44, 0x0040 }, { 0x058E, 0x4F0E, 0x2AA1, 0x0043 },
  { 0x0572, 0x4EC9, 0x2AFF, 0x0046 }, { 0x0556, 0x4E84, 0x2B5C, 0x0049 }, { 0x053B, 0x4E3E, 0x2BBA, 0x004D }, { 0x0520, 0x4DF7, 0x2C18, 0x0050 },
  { 0x0506, 0x4DB0, 0x2C76, 0x0054 }, { 0x04EC, 0x4D68, 0x2CD4, 0x0057 }, { 0x04D2, 0x4D20, 0x2D33, 0x005B }, { 0x04B9, 0x4CD7, 0x2D91, 0x005F },
  { 0x04A0, 0x4C8D, 0x2DF0, 0x0063 }, { 0x0488, 0x4C42, 0x2E4F, 0x0067 }, { 0x0470, 0x4BF7, 0x2EAE, 0x006B }, { 0x0458, 0x4BAC, 0x2F0D, 0x006F },
  { 0x0441, 0x4B5F, 0x2F6C, 0x0074 }, { 0x042A, 0x4B13, 0x2FCC, 0x0078 }, { 0x0413, 0x4AC5, 0x302B, 0x007D }, { 0x03FC, 0x4A77, 0x308B, 0x0082 },
  { 0x03E7, 0x4A29, 0x30EA, 0x0087 }, { 0x03D1, 0x49D9, 0x314A, 0x008C }, { 0x03BC, 0x498A, 0x31AA, 0x0091 }, { 0x03A7, 0x493A, 0x3209, 0x0096 },
  { 0x0392, 0x48E9, 0x3269, 0x009C }, { 0x037E, 0x4898, 0x32C9, 0x00A1 }, { 0x036A, 0x4846, 0x3329, 0x00A7 }, { 0x0356, 0x47F4, 0x3389, 0x00AD },
  { 0x0343, 0x47A1, 0x33E9, 0x00B3 }, { 0x0330, 0x474E, 0x3449, 0x00BA }, { 0x031D, 0x46FA, 0x34A9, 0x00C0 }, { 0x030B, 0x46A6, 0x3509, 0x00C7 },
  { 0x02F9, 0x4651, 0x3569, 0x00CD }, { 0x02E7, 0x45FC, 0x35C9, 0x00D4 }, { 0x02D6, 0x45A6, 0x3629, 0x00DB }, { 0x02C4, 0x4550, 0x3689, 0x00E3 },
  { 0x02B4, 0x44FA, 0x36E8, 0x00EA }, { 0x02A3, 0x44A3, 0x3748, 0x00F2 }, { 0x0293, 0x444C, 0x37A8, 0x00FA }, { 0x0283, 0x43F4, 0x3807, 0x0101 },
  { 0x0273, 0x439C, 0x3867, 0x010A }, { 0x0264, 0x4344, 0x38C6, 0x0112 }, { 0x0255, 0x42EB, 0x3926, 0x011B }, { 0x0246, 0x4292, 0x3985, 0x0123 },
  { 0x0237, 0x4239, 0x39E4, 0x012C }, { 0x0229, 0x41DF, 0x3A43, 0x0135 }, { 0x021B, 0x4185, 0x3AA2, 0x013F }, { 0x020D, 0x412A, 0x3B00, 0x0148 },
  { 0x0200, 0x40D0, 0x3B5F, 0x0152 }, { 0x01F2, 0x4074, 0x3BBD, 0x015C }, { 0x01E5, 0x4019, 0x3C1B, 0x0166 }, { 0x01D9, 0x3FBD, 0x3C79, 0x0171 },
  { 0x01CC, 0x3F62, 0x3CD7, 0x017B }, { 0x01C0, 0x3F05, 0x3D35, 0x0186 }, { 0x01B4, 0x3EA9, 0x3D92, 0x0191 }, { 0x01A8, 0x3E4C, 0x3DEF, 0x019C },
  { 0x019C, 0x3DEF, 0x3E4C, 0x01A8 }, { 0x0191, 0x3D92, 0x3EA9, 0x01B4 }, { 0x0186, 0x3D35, 0x3F05, 0x01C0 }, { 0x017B, 0x3CD7, 0x3F62, 0x01CC },
  { 0x0171, 0x3C79, 0x3FBD, 0x01D9 }, { 0x0166, 0x3C1B, 0x4019, 0x01E5 }, { 0x015C, 0x3BBD, 0x4074, 0x01F2 }, { 0x0152, 0x3B5F, 0x40D0, 0x0200 },
  { 0x0148, 0x3B00, 0x412A, 0x020D }, { 0x013F, 0x3AA2, 0x4185, 0x021B }, { 0x0135, 0x3A43, 0x41DF, 0x0229 }, { 0x012C, 0x39E4, 0x4239, 0x0237 },
  { 0x0123, 0x3985, 0x4292, 0x0246 }, { 0x011B, 0x3926, 0x42EB, 0x0255 }, { 0x0112, 0x38C6, 0x4344, 0x0264 }, { 0x010A, 0x3867, 0x439C, 0x0273 },
  { 0x0101, 0x3807, 0x43F4, 0x0283 }, { 0x00FA, 0x37A8, 0x444C, 0x0293 }, { 0x00F2, 0x3748, 0x44A3, 0x02A3 }, { 0x00EA, 0x36E8, 0x44FA, 0x02B4 },
  { 0x00E3, 0x3689, 0x4550, 0x02C4 }, { 0x00DB, 0x3629, 0x45A6, 0x02D6 }, { 0x00D4, 0x35C9, 0x45FC, 0x02E7 }, { 0x00CD, 0x3569, 0x4651, 0x02F9 },
  { 0x00C7, 0x3509, 0x46A6, 0x030B }, { 0x00C0, 0x34A9, 0x46FA, 0x031D }, { 0x00BA, 0x3449, 0x474E, 0x0330 }, { 0x00B3, 0x33E9, 0x47A1, 0x0343 },
  { 0x00AD, 0x3389, 0x47F4, 0x0356 }, { 0x00A7, 0x3329, 0x4846, 0x036A }, { 0x00A1, 0x32C9, 0x4898, 0x037E }, { 0x009C, 0x3269, 0x48E9, 0x0392 },
  { 0x0096, 0x3209, 0x493A, 0x03A7 }, { 0x0091, 0x31AA, 0x498A, 0x03BC }, { 0x008C, 0x314A, 0x49D9, 0x03D1 }, { 0x0087, 0x30EA, 0x4A29, 0x03E7 },
  { 0x0082, 0x308B, 0x4A77, 0x03FC }, { 0x007D, 0x302B, 0x4AC5, 0x0413 }, { 0x0078, 0x2FCC, 0x4B13, 0x042A }, { 0x0074, 0x2F6C, 0x4B5F, 0x0441 },
  { 0x006F, 0x2F0D, 0x4BAC, 0x0458 }, { 0x006B, 0x2EAE, 0x4BF7, 0x0470 }, { 0x0067, 0x2E4F, 0x4C42, 0x0488 }, { 0x0063, 0x2DF0, 0x4C8D, 0x04A0 },
  { 0x005F, 0x2D91, 0x4CD7, 0x04B9 }, { 0x005B, 0x2D33, 0x4D20, 0x04D2 }, { 0x0057, 0x2CD4, 0x4D68, 0x04EC }, { 0x0054, 0x2C76, 0x4DB0, 0x0506 },
  { 0x0050, 0x2C18, 0x4DF7, 0x0520 }, { 0x004D, 0x2BBA, 0x4E3E, 0x053B }, { 0x0049, 0x2B5C, 0x4E84, 0x0556 }, { 0x0046, 0x2AFF, 0x4EC9, 0x0572 },
  { 0x0043, 0x2AA1, 0x4F0E, 0x058E }, { 0x0040, 0x2A44, 0x4F52, 0x05AA }, { 0x003D, 0x29E7, 0x4F95, 0x05C7 }, { 0x003A, 0x298B, 0x4FD7, 0x05E4 },
  { 0x0038, 0x292E, 0x5019, 0x0601 }, { 0x0035, 0x28D2, 0x505A, 0x061F }, { 0x0033, 0x2876, 0x509A, 0x063E }, { 0x0030, 0x281A, 0x50DA, 0x065C },
  { 0x002E, 0x27BE, 0x5118, 0x067C }, { 0x002C, 0x2763, 0x5156, 0x069B }, { 0x0029, 0x2708, 0x5194, 0x06BB }, { 0x0027, 0x26AD, 0x51D0, 0x06DC },
  { 0x0025, 0x2653, 0x520C, 0x06FD }, { 0x0023, 0x25F8, 0x5247, 0x071E }, { 0x0021, 0x259E, 0x5281, 0x0740 }, { 0x0020, 0x2545, 0x52BA, 0x0762 },
  { 0x001E, 0x24EB, 0x52F3, 0x0784 }, { 0x001C, 0x2492, 0x532A, 0x07A7 }, { 0x001B, 0x2439, 0x5361, 0x07CB }, { 0x0019, 0x23E1, 0x5397, 0x07EF },
  { 0x0018, 0x2389, 0x53CC, 0x0813 }, { 0x0016, 0x2331, 0x5401, 0x0838 }, { 0x0015, 0x22DA, 0x5434, 0x085D }, { 0x0013, 0x2282, 0x5467, 0x0883 },
  { 0x0012, 0x222C, 0x5499, 0x08A9 }, { 0x0011, 0x21D5, 0x54CA, 0x08D0 }, { 0x0010, 0x217F, 0x54FA, 0x08F7 }, { 0x000F, 0x2129, 0x5529, 0x091E },
  { 0x000E, 0x20D4, 0x5558, 0x0946 }, { 0x000D, 0x207F, 0x5585, 0x096F }, { 0x000C, 0x202A, 0x55B2, 0x0998 }, { 0x000B, 0x1FD6, 0x55DE, 0x09C1 },
  { 0x000A, 0x1F82, 0x5609, 0x09EB }, { 0x0009, 0x1F2F, 0x5632, 0x0A16 }, { 0x0009, 0x1EDC, 0x565B, 0x0A40 }, { 0x0008, 0x1E89, 0x5684, 0x0A6C },
  { 0x0007, 0x1E37, 0x56AB, 0x0A98 }, { 0x0007, 0x1DE5, 0x56D1, 0x0AC4 }, { 0x0006, 0x1D93, 0x56F6, 0x0AF1 }, { 0x0005, 0x1D42, 0x571B, 0x0B1E },
  { 0x0005, 0x1CF1, 0x573E, 0x0B4C }, { 0x0004, 0x1CA1, 0x5761, 0x0B7A }, { 0x0004, 0x1C51, 0x5782, 0x0BA9 }, { 0x0003, 0x1C02, 0x57A3, 0x0BD8 },
  { 0x0003, 0x1BB3, 0x57C3, 0x0C07 }, { 0x0003, 0x1B64, 0x57E2, 0x0C38 }, { 0x0002, 0x1B16, 0x57FF, 0x0C68 }, { 0x0002, 0x1AC8, 0x581C, 0x0C99 },
  { 0x0002, 0x1A7B, 0x5838, 0x0CCB }, { 0x0001, 0x1A2E, 0x5853, 0x0CFD }, { 0x0001, 0x19E2, 0x586D, 0x0D30 }, { 0x0001, 0x1996, 0x5886, 0x0D63 },
  { 0x0001, 0x194B, 0x589E, 0x0D97 }, { 0x0000, 0x1900, 0x58B5, 0x0DCB }, { 0x0000, 0x18B5, 0x58CB, 0x0E00 }, { 0x0000, 0x186B, 0x58E0, 0x0E35 },
  { 0x0000, 0x1821, 0x58F4, 0x0E6B }, { 0x0000, 0x17D8, 0x5907, 0x0EA1 }, { 0x0000, 0x1790, 0x5919, 0x0ED7 }, { 0x0000, 0x1747, 0x592A, 0x0F0F },
  { -0x0001, 0x1700, 0x593A, 0x0F46 }, { -0x0001, 0x16B9, 0x5949, 0x0F7F }, { -0x0001, 0x1672, 0x5958, 0x0FB7 }, { -0x0001, 0x162C, 0x5965, 0x0FF1 },
  { -0x0001, 0x15E6, 0x5971, 0x102A }, { -0x0001, 0x15A0, 0x597C, 0x1065 }, { -0x0001, 0x155C, 0x5986, 0x109F }, { -0x0001, 0x1517, 0x598F, 0x10DB },
  { -0x0001, 0x14D4, 0x5997, 0x1116 }, { -0x0001, 0x1490, 0x599E, 0x1153 }, { -0x0001, 0x144D, 0x59A4, 0x118F }, { -0x0001, 0x140B, 0x59A9, 0x11CD },
  { -0x0001, 0x13C9, 0x59AD, 0x120B }, { -0x0001, 0x1388, 0x59B0, 0x1249 }, { -0x0001, 0x1347, 0x59B2, 0x1288 }, { -0x0001, 0x1307, 0x59B3, 0x12C7 },
};

// the noise generator, which every voice of a core set to noise plays, stepped once a sample at the pace the control's
// bits 8 to 13 set
static void noise_step(core *c) {
  static const uint8_t add[64] = {
    1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1,
  };
  static const uint16_t pace[5] = { 0, 84, 140, 180, 210 };
  uint32_t clock = (c->control >> 8) & 0x3F, level = (0x8000u >> (clock >> 2)) << 16;
  c->noise_count += 0x10000;
  c->noise_count += pace[clock & 3];
  if ((c->noise_count & 0xFFFF) >= pace[4]) {
    c->noise_count += 0x10000;
    c->noise_count -= pace[clock & 3];
  }
  if (c->noise_count >= level) {
    while (c->noise_count >= level) c->noise_count -= level;
    c->noise_out = (c->noise_out << 1) | add[(c->noise_out >> 10) & 63];
  }
}

// One sample of a voice, left and right
static void voice_sample(core *c, int i, int32_t out[2]) {
  voice *v = &c->voices[i];
  slide_step(&v->left);
  slide_step(&v->right);
  read_ahead(c, i);
  int32_t value = 0;
  out[0] = out[1] = 0;
  if (v->phase > STOPPED) {
    if (c->noise & (1u << i)) value = (int16_t)c->noise_out;
    else {
      // between the four samples around where the voice is, weighed by the chip's table
      const int16_t *weights = gauss[(v->between & 0x0FF0) >> 4];
      for (uint32_t k = 0; k < 4; k++) value += (weights[k] * v->fifo[(v->played + k) % 32]) >> 15;
    }
    if (!envelope_step(v)) voice_stop(v);
    value = scaled(value, v->envelope);
    v->out = value;
    out[0] = scaled(value, v->left.value);
    out[1] = scaled(value, v->right.value);
  }
  // on by its pitch, which the voice before bends when the core says so
  int32_t pitch = v->pitch;
  if (i > 0 && (c->bent & (1u << i))) {
    pitch = (pitch * (32768 + c->voices[i - 1].out)) >> 15;
    pitch = pitch < 0 ? 0 : pitch;
  }
  if (pitch > 0x3FFF) pitch = 0x3FFF;
  v->between += (uint32_t)pitch;
  v->played += v->between >> 12;
  v->between &= 0xFFF;
  // voices 1 and 3 are written into the chip's memory as they play
  if (i == 1) capture((c->number ? 0xC00 : 0x400) + spu.at, value);
  else if (i == 3) capture((c->number ? 0xE00 : 0x600) + spu.at, value);
}

// ----------------------------------------------------------------------------------------------------------------
// The reverb, which works on one side each sample, left then right, in the stretch of the chip's memory a core is given

static const int16_t filter[39] = {
  -1, 0, 2, 0, -10, 0, 35, 0, -103, 0, 266, 0, -616, 0, 1332, 0, -2960, 0, 10246, 16384,
  10246, 0, -2960, 0, 1332, 0, -616, 0, 266, 0, -103, 0, 35, 0, -10, 0, 2, 0, -1,
};
static uint32_t reverb_place(const core *c, uint32_t offset) {
  uint32_t start = c->reverb_start & 0x3FFFFF, end = (c->reverb_end & 0x3FFFFF) | 0xFFFF;
  return ((((spu.cycles >> 1) + offset) % ((end - start) + 1)) + start) & WORD_MASK;
}
#define TIMES(x, y) (((x) * (y)) >> 15)
static void reverb(core *c, const int32_t in[2], int32_t out[2]) {
  out[0] = out[1] = 0;
  if (c->reverb_start >= c->reverb_end) return;
  c->down[0][c->reverb_at] = c->down[0][c->reverb_at | 64] = (int16_t)clamped(in[0]);
  c->down[1][c->reverb_at] = c->down[1][c->reverb_at | 64] = (int16_t)clamped(in[1]);
  int right = spu.cycles & 1;
  const uint32_t *a = c->reverb_address;
  const int16_t *vol = c->reverb_volume;
  uint32_t same_src = reverb_place(c, a[SAME_L_SRC + right]), same_dst = reverb_place(c, a[SAME_L_DST + right]), same_prv = reverb_place(c, a[SAME_L_DST + right] - 1);
  // each side's cross feed comes from the other side
  uint32_t diff_src = reverb_place(c, a[DIFF_L_SRC + !right]), diff_dst = reverb_place(c, a[DIFF_L_DST + right]), diff_prv = reverb_place(c, a[DIFF_L_DST + right] - 1);
  uint32_t comb1 = reverb_place(c, a[COMB1_L_SRC + right]), comb2 = reverb_place(c, a[COMB2_L_SRC + right]);
  uint32_t comb3 = reverb_place(c, a[COMB3_L_SRC + right]), comb4 = reverb_place(c, a[COMB4_L_SRC + right]);
  uint32_t apf1_src = reverb_place(c, a[APF1_L_DST + right] - a[APF1_SIZE]), apf1_dst = reverb_place(c, a[APF1_L_DST + right]);
  uint32_t apf2_src = reverb_place(c, a[APF2_L_DST + right] - a[APF2_SIZE]), apf2_dst = reverb_place(c, a[APF2_L_DST + right]);
  int on = (c->control & CONTROL_REVERB) != 0;
  if (on) {
    const uint32_t used[14] = { same_src, diff_src, same_dst, diff_dst, same_prv, diff_prv, comb1, comb2, comb3, comb4, apf1_dst, apf1_src, apf2_dst, apf2_src };
    for (int i = 0; i < 2; i++) {
      core *other = &spu.cores[i];
      if (!(other->control & CONTROL_IRQ) || other->irq_addr < c->reverb_start || other->irq_addr > c->reverb_end) continue;
      for (int k = 0; k < 14; k++) if (other->irq_addr == used[k]) other->irq_pending = 1;
    }
  }
  // what went in, down to half the rate
  int32_t sum = 0;
  uint32_t from = (c->reverb_at - 39) & 63;
  for (int i = 0; i < 39; i++) sum += c->down[right][from + (uint32_t)i] * filter[i];
  int32_t input = TIMES(vol[IN_COEF_L + right], clamped(sum >> 15));
  int32_t same = TIMES(vol[IIR_VOL], input + TIMES(vol[WALL_VOL], word_at(same_src)) - word_at(same_prv)) + word_at(same_prv);
  int32_t diff = TIMES(vol[IIR_VOL], input + TIMES(vol[WALL_VOL], word_at(diff_src)) - word_at(diff_prv)) + word_at(diff_prv);
  int32_t made = TIMES(vol[COMB1_VOL], word_at(comb1)) + TIMES(vol[COMB2_VOL], word_at(comb2)) + TIMES(vol[COMB3_VOL], word_at(comb3)) + TIMES(vol[COMB4_VOL], word_at(comb4));
  int32_t apf1 = made - TIMES(vol[APF1_VOL], word_at(apf1_src));
  made = word_at(apf1_src) + TIMES(vol[APF1_VOL], apf1);
  int32_t apf2 = made - TIMES(vol[APF2_VOL], word_at(apf2_src));
  made = word_at(apf2_src) + TIMES(vol[APF2_VOL], apf2);
  if (on) {
    set_word_at(same_dst, clamped(same));
    set_word_at(diff_dst, clamped(diff));
    set_word_at(apf1_dst, clamped(apf1));
    set_word_at(apf2_dst, clamped(apf2));
  }
  made = clamped(made);
  c->up[right][c->reverb_at] = c->up[right][c->reverb_at | 64] = (int16_t)made;
  c->up[!right][c->reverb_at] = c->up[!right][c->reverb_at | 64] = 0;
  c->reverb_at = (c->reverb_at + 1) & 63;
  // and what comes out, back up to the chip's rate, at twice the filter's weights
  from = (c->reverb_at - 39) & 63;
  int32_t left_sum = 0, right_sum = 0;
  for (int i = 0; i < 39; i++) {
    int32_t weight = filter[i] * 2;
    if (weight > 0x7FFF) weight = 0x7FFF;
    left_sum += c->up[0][from + (uint32_t)i] * weight;
    right_sum += c->up[1][from + (uint32_t)i] * weight;
  }
  out[0] = clamped(left_sum >> 15);
  out[1] = clamped(right_sum >> 15);
}

// ----------------------------------------------------------------------------------------------------------------
// A core's sample

// The sound a core is sent in blocks: read from its buffer in the chip's memory, a half of which the block that's
// waiting is put in as the core starts reading the other half. A block is 256 samples of the left side, then 256 of
// the right. With the chip set to pass core 0's input straight out, it isn't mixed, and its buffer is read twice as fast.
static void input_sample(core *c, int32_t out[2]) {
  uint32_t at = spu.at, buffer = 0x2000 + (c->number << 10);
  for (int i = 0; i < 2; i++) {
    if ((spu.cores[i].control & CONTROL_IRQ) && buffer + at == (spu.cores[i].irq_addr & 0xFFFFFDFF)) spu.cores[i].irq_pending = 1;
  }
  int bypass = c->number == 0 && (spu.spdif_out & 0x0100);
  out[0] = bypass ? 0 : word_at(buffer + at);
  out[1] = bypass ? 0 : word_at(buffer + 0x200 + at);
  if (bypass) at = (at * 2) & 0x1FF;
  if (at != 0 && at != 0x100) return;
  c->input_half = at == 0 ? 0x100 : 0;
  if (c->input_written != INPUT_SIZE) return;
  __builtin_memcpy(spu.ram + ((buffer + c->input_half) << 1), c->waiting, INPUT_SIZE / 2);
  __builtin_memcpy(spu.ram + ((buffer + 0x200 + c->input_half) << 1), c->waiting + INPUT_SIZE / 2, INPUT_SIZE / 2);
  c->input_written = 0;
}

// a core's voices, added up dry and for the reverb, each side by its own switch
static void voices_sample(core *c, int32_t dry[2], int32_t wet[2]) {
  dry[0] = dry[1] = wet[0] = wet[1] = 0;
  for (int i = 0; i < VOICES; i++) {
    int32_t out[2];
    voice_sample(c, i, out);
    uint32_t bit = 1u << i;
    if (c->dry_left & bit) dry[0] += out[0];
    if (c->dry_right & bit) dry[1] += out[1];
    if (c->wet_left & bit) wet[0] += out[0];
    if (c->wet_right & bit) wet[1] += out[1];
  }
}
// A core's sample from its voices, its sound input and, for core 1, core 0's output: each goes dry and to the reverb
// by the core's twelve switches (MMIX), and the reverb comes back at the effect volume
static void core_sample(core *c, const int32_t voices_dry[2], const int32_t voices_wet[2], const int32_t input[2], const int32_t external[2], int32_t out[2]) {
  slide_step(&c->master_left);
  slide_step(&c->master_right);
  noise_step(c);
  int32_t dry[2] = { clamped(voices_dry[0]), clamped(voices_dry[1]) }, wet[2] = { clamped(voices_wet[0]), clamped(voices_wet[1]) };
  uint32_t buffers = c->number ? 0x1800 : 0x1000;
  capture(buffers + spu.at, dry[0]);
  capture(buffers + 0x200 + spu.at, dry[1]);
  capture(buffers + 0x400 + spu.at, wet[0]);
  capture(buffers + 0x600 + spu.at, wet[1]);
  unsigned m = c->mmix & (c->number ? 0xFFF : 0xFF0);
  int32_t to_dry[2], to_wet[2], back[2];
  to_dry[0] = (m & 0x080 ? input[0] : 0) + (m & 0x800 ? dry[0] : 0) + (m & 0x008 ? external[0] : 0);
  to_dry[1] = (m & 0x040 ? input[1] : 0) + (m & 0x400 ? dry[1] : 0) + (m & 0x004 ? external[1] : 0);
  to_wet[0] = (m & 0x020 ? input[0] : 0) + (m & 0x200 ? wet[0] : 0) + (m & 0x002 ? external[0] : 0);
  to_wet[1] = (m & 0x010 ? input[1] : 0) + (m & 0x100 ? wet[1] : 0) + (m & 0x001 ? external[1] : 0);
  reverb(c, to_wet, back);
  out[0] = to_dry[0] + scaled(back[0], c->effect_left);
  out[1] = to_dry[1] + scaled(back[1], c->effect_right);
}

static void keys(core *c) {
  // let go, then pressed
  for (int i = 0; i < VOICES; i++) {
    voice *v = &c->voices[i];
    if ((c->key_off & (1u << i)) && v->phase != STOPPED) {
      v->phase = RELEASE;
      v->envelope_counter = 0;
    }
  }
  c->ended &= ~c->key_on;
  for (int i = 0; i < VOICES; i++) {
    voice *v = &c->voices[i];
    if (!(c->key_on & (1u << i))) continue;
    v->phase = ATTACK;
    v->envelope_counter = 0;
    v->envelope = 0;
    v->loop_set = 0;
    v->between = 0;
    v->flags = 0;
    v->next = v->start | 1;
    v->before1 = v->before2 = 0;
    v->played = v->decoded = 0;
  }
  c->key_on = c->key_off = 0;
}

// One sample of the chip: core 0's goes through core 1's, at its external volume, and core 1's is what's heard
static void sample(int16_t out[2]) {
  core *c0 = &spu.cores[0], *c1 = &spu.cores[1];
  spu.cycles++;
  keys(c0);
  keys(c1);
  int32_t input[2][2], dry[2][2], wet[2][2], none[2] = { 0, 0 }, external[2], mixed[2];
  input_sample(c0, input[0]);
  input_sample(c1, input[1]);
  input[0][0] = scaled(input[0][0], c0->input_left);
  input[0][1] = scaled(input[0][1], c0->input_right);
  input[1][0] = scaled(input[1][0], c1->input_left);
  input[1][1] = scaled(input[1][1], c1->input_right);
  voices_sample(c0, dry[0], wet[0]);
  voices_sample(c1, dry[1], wet[1]);
  core_sample(c0, dry[0], wet[0], input[0], none, external);
  external[0] = scaled(clamped(external[0]), c0->master_left.value);
  external[1] = scaled(clamped(external[1]), c0->master_right.value);
  capture(0x800 + spu.at, external[0]);
  capture(0xA00 + spu.at, external[1]);
  external[0] = scaled(external[0], c1->external_left);
  external[1] = scaled(external[1], c1->external_right);
  core_sample(c1, dry[1], wet[1], input[1], external, mixed);
  out[0] = (int16_t)scaled(clamped(mixed[0]), c1->master_left.value);
  out[1] = (int16_t)scaled(clamped(mixed[1]), c1->master_right.value);
  spu.at = (spu.at + 1) & 0x1FF;
}

void spu2_block(void) {
  listed('B', 0, 0, 1);
  woken();
  if (spu.heard_count + BLOCK_SAMPLES * 2 > spu.heard_room) {
    uint32_t room = spu.heard_room ? spu.heard_room * 2 : 4096;
    int16_t *more = kit_alloc(sizeof(int16_t) * room);
    if (spu.heard_count) __builtin_memcpy(more, spu.heard, sizeof(int16_t) * spu.heard_count);
    spu.heard = more;
    spu.heard_room = room;
  }
  for (int i = 0; i < BLOCK_SAMPLES; i++, spu.heard_count += 2) sample(spu.heard + spu.heard_count);
}

// ----------------------------------------------------------------------------------------------------------------
// The registers

static uint32_t with_low(uint32_t whole, uint32_t value) { return (whole & 0xFFFF0000) | (value & 0xFFFF); }
static uint32_t with_high(uint32_t whole, uint32_t value) { return (whole & 0x0000FFFF) | (value & 0xFFFF) << 16; }
// the data port's address, which the emulator keeps in bytes
static uint16_t bytes_low(uint32_t address) { return (uint16_t)((address >> 1) & 0xFFFF); }
static uint16_t bytes_high(uint32_t address) { return (uint16_t)((address >> 17) & 0xFFFF); }
static uint32_t set_bytes_low(uint32_t address, uint16_t value) { return (address & 0xFFFE0000) | (uint32_t)value << 1; }
static uint32_t set_bytes_high(uint32_t address, uint16_t value) { return (address & 0x0001FFFE) | (uint32_t)value << 17; }

static void set_control(core *c, uint16_t value) {
  c->control = value;
  if (!(value & CONTROL_IRQ)) c->irq_pending = 0;
}
static void write_word(core *c, uint16_t value) {
  // the emulator doesn't wrap the address round as it goes on, and writes past the chip's memory at its end: here it
  // stays in it
  __builtin_memcpy(spu.ram + (c->transfer_addr & (RAM_MASK & ~1u)), &value, 2);
  c->transfer_addr += 2;
}

// a register of a voice, `address` with the voice's own part taken out
static void voice_write(core *c, int i, uint32_t address, uint32_t value) {
  voice *v = &c->voices[i];
  switch (address & 0x7FF) {
  case 0x000: slide_set(&v->left, (uint16_t)value); break;
  case 0x002: slide_set(&v->right, (uint16_t)value); break;
  case 0x004: v->pitch = (uint16_t)value; break;
  case 0x006: v->adsr1 = (uint16_t)value; break;
  case 0x008: v->adsr2 = (uint16_t)value; break;
  case 0x00A: v->envelope = (int32_t)(value & 0xFFFF); break;
  case 0x1C0: v->start = ((value & 0x0F) << 16) | (v->start & 0xFFF8); break;
  case 0x1C2: v->start = (v->start & 0x0F0000) | (value & 0xFFF8); break;
  // a loop address a game writes stays, whatever the blocks' own flags say, until the voice is keyed on again
  case 0x1C4: v->loop_set = 1; v->loop = ((value & 0x0F) << 16) | (v->loop & 0xFFF8); break;
  case 0x1C6: v->loop_set = 1; v->loop = (v->loop & 0x0F0000) | (value & 0xFFF8); break;
  case 0x1C8: v->next = ((value & 0x0F) << 16) | (v->next & 0xFFF8) | 1; break;
  case 0x1CA: v->next = (v->next & 0x0F0000) | (value & 0xFFF8) | 1; break;
  }
}
static uint32_t voice_read(core *c, int i, uint32_t address, uint32_t written) {
  voice *v = &c->voices[i];
  switch (address & 0x7FF) {
  case 0x00A: return (uint32_t)v->envelope & 0xFFFF;
  case 0x00C: return (uint32_t)v->left.value & 0xFFFF;
  case 0x00E: return (uint32_t)v->right.value & 0xFFFF;
  case 0x1C0: return v->start >> 16;
  case 0x1C2: return v->start & 0xFFFF;
  case 0x1C4: return v->loop >> 16;
  case 0x1C6: return v->loop & 0xFFFF;
  case 0x1C8: return v->next >> 16;
  case 0x1CA: return v->next & 0xFFFF;
  }
  return written;
}

static void core_write(core *c, uint32_t address, uint32_t value) {
  uint32_t a = address & 0x7FF;
  if (a >= 0x2E4 && a < 0x33C) {
    uint32_t *place = &c->reverb_address[(a - 0x2E4) / 4];
    *place = a & 2 ? with_low(*place, value) : with_high(*place, value);
    return;
  }
  if (a >= 0x774 && a < 0x788) {
    c->reverb_volume[(a - 0x774) / 2] = (int16_t)value;
    return;
  }
  switch (a) {
  case 0x180: c->bent = with_low(c->bent, value); break;
  case 0x182: c->bent = with_high(c->bent, value & 0xFF); break;
  case 0x184: c->noise = with_low(c->noise, value); break;
  case 0x186: c->noise = with_high(c->noise, value & 0xFF); break;
  case 0x188: c->dry_left = with_low(c->dry_left, value); break;
  case 0x18A: c->dry_left = with_high(c->dry_left, value & 0xFF); break;
  case 0x18C: c->wet_left = with_low(c->wet_left, value); break;
  case 0x18E: c->wet_left = with_high(c->wet_left, value & 0xFF); break;
  case 0x190: c->dry_right = with_low(c->dry_right, value); break;
  case 0x192: c->dry_right = with_high(c->dry_right, value & 0xFF); break;
  case 0x194: c->wet_right = with_low(c->wet_right, value); break;
  case 0x196: c->wet_right = with_high(c->wet_right, value & 0xFF); break;
  case 0x198: c->mmix = (uint16_t)value; break;
  case 0x19A: set_control(c, (uint16_t)value); break;
  case 0x19C: c->irq_addr = with_high(c->irq_addr, value); break;
  case 0x19E: c->irq_addr = with_low(c->irq_addr, value); break;
  // keys wait for the next sample, where those let go are seen to before those pressed
  case 0x1A0: c->key_on = with_low(c->key_on, value); break;
  case 0x1A2: c->key_on = with_high(c->key_on, value & 0xFF); break;
  case 0x1A4: c->key_off = with_low(c->key_off, value); break;
  case 0x1A6: c->key_off = with_high(c->key_off, value & 0xFF); break;
  case 0x1A8: c->transfer_addr = set_bytes_high(c->transfer_addr, (uint16_t)value) & RAM_MASK; break;
  case 0x1AA: c->transfer_addr = set_bytes_low(c->transfer_addr, (uint16_t)value) & RAM_MASK; break;
  case 0x1AC: write_word(c, (uint16_t)value); break;
  case 0x1B0: c->transfer_mode = (uint16_t)value; break;
  case 0x2E0: c->reverb_start = with_high(c->reverb_start, value); break;
  case 0x2E2: c->reverb_start = with_low(c->reverb_start, value); break;
  case 0x33C: c->reverb_end = ((value & 0x0F) << 16) | 0xFFFF; break;
  // a write to either half of the voices that have ended clears that half
  case 0x340: c->ended &= 0xFF0000; break;
  case 0x342: c->ended &= 0x00FFFF; break;
  case 0x760: slide_set(&c->master_left, (uint16_t)value); break;
  case 0x762: slide_set(&c->master_right, (uint16_t)value); break;
  case 0x764: c->effect_left = (int16_t)value; break;
  case 0x766: c->effect_right = (int16_t)value; break;
  case 0x768: c->external_left = (int16_t)value; break;
  case 0x76A: c->external_right = (int16_t)value; break;
  case 0x76C: c->input_left = (int16_t)value; break;
  case 0x76E: c->input_right = (int16_t)value; break;
  }
}
static uint32_t core_read(core *c, uint32_t address, uint32_t written) {
  switch (address & 0x7FF) {
  case 0x344: return (c->control & CONTROL_DMA) ? 0x80 : 0;
  case 0x340: return c->ended & 0xFFFF;
  case 0x342: return c->ended >> 16;
  case 0x19A: return c->control;
  case 0x1B0: return c->transfer_mode;
  case 0x1A8: return bytes_high(c->transfer_addr);
  case 0x1AA: return bytes_low(c->transfer_addr);
  case 0x770: return (uint32_t)c->master_left.value & 0xFFFF;
  case 0x772: return (uint32_t)c->master_right.value & 0xFFFF;
  }
  return written;
}

// which core, and which of its voices or its own registers, an address of the chip is, as the emulator sorts them
static uint32_t access(uint32_t address, uint32_t value, int write) {
  uint32_t at = address - 0x1F900000;
  core *c;
  if (at < 0x760) {
    c = &spu.cores[at & 0x400 ? 1 : 0];
    at &= ~0x400u;
  } else if (at < 0x7B0) {
    unsigned which = (at - 0x760) / 40;
    c = &spu.cores[which];
    at -= which * 40;
  } else {
    // the chip's own registers
    if (write) {
      if (at == 0x7C0) spu.spdif_out = value;
      else if (at == 0x7C6) spu.spdif_mode = value;
      else if (at == 0x7C8) spu.spdif_media = value;
      return 0;
    }
    if (at == 0x7C2) {
      uint32_t result = 0;
      for (int i = 0; i < 2; i++) {
        if (spu.cores[i].irq_pending) {
          result |= 1u << (i + 2);
          spu.cores[i].irq_pending = 0;
        }
      }
      return result;
    }
    return at == 0x7C0 ? spu.spdif_out : at == 0x7C6 ? spu.spdif_mode : at == 0x7C8 ? spu.spdif_media : 0;
  }
  uint32_t written = c->written[(at & 0x7FF) >> 1];
  if (write) c->written[(at & 0x7FF) >> 1] = (uint16_t)value;
  if (at < 0x180) {
    int i = (at >> 4) & 0x3F;
    if (i >= VOICES) return 0;
    return write ? (voice_write(c, i, at & ~(0x3Fu << 4), value), 0) : voice_read(c, i, at & ~(0x3Fu << 4), written);
  }
  if (at >= 0x1C0 && at < 0x2E0) {
    int i = (at - 0x1C0) / 12;
    if (i >= VOICES) return 0;
    return write ? (voice_write(c, i, at - i * 12, value), 0) : voice_read(c, i, at - i * 12, written);
  }
  return write ? (core_write(c, at, value), 0) : core_read(c, at, written);
}

void spu2_write(uint32_t address, uint32_t value) {
  uint32_t written[2] = { address, value };
  listed('W', written, sizeof written, 1);
  // the PlayStation's own sound chip's registers, which the emulator also lets a game reach, aren't done yet: they're in
  // the sound list, so a game that writes them differs from its original rather than passing unseen
  if (address < 0x1F900000) return;
  woken();
  access(address, value, 1);
}
uint32_t spu2_read(uint32_t address) {
  if (address < 0x1F900000) return 0;
  woken();
  return access(address, 0, 0);
}

// ----------------------------------------------------------------------------------------------------------------
// DMA, as the IOP's channels 4 and 7 move it to and from core 0 and core 1

static uint32_t dma_taken(core *c, uint8_t *buffer, uint32_t block_size, uint32_t blocks) {
  if (c->transfer_mode == MODE_VOICE) {
    if ((c->control & CONTROL_DMA) == CONTROL_DMA_STOP) return 0;
    if ((c->control & CONTROL_DMA) == CONTROL_DMA_READ) {
      if (blocks > 0x10) blocks = 0x10;
      for (uint32_t i = 0; i < blocks; i++) {
        __builtin_memcpy(buffer, spu.ram + c->transfer_addr, block_size);
        c->transfer_addr = (c->transfer_addr + block_size) & RAM_MASK;
        buffer += block_size;
      }
      return blocks;
    }
    if (blocks > 0x100) blocks = 0x100;
    for (uint32_t i = 0; i < blocks; i++) {
      uint32_t size = RAM_SIZE - c->transfer_addr < block_size ? RAM_SIZE - c->transfer_addr : block_size;
      __builtin_memcpy(spu.ram + c->transfer_addr, buffer, size);
      c->transfer_addr = (c->transfer_addr + block_size) & RAM_MASK;
      buffer += block_size;
    }
    return blocks;
  }
  if (c->transfer_mode == MODE_CORE0_IN || c->transfer_mode == MODE_CORE1_IN) {
    // a block of sound input waits until the core has read the half of its buffer the block goes in
    uint32_t room = (INPUT_SIZE - c->input_written) / block_size;
    if (blocks > room) blocks = room;
    __builtin_memcpy(c->waiting + c->input_written, buffer, blocks * block_size);
    c->input_written += blocks * block_size;
    return blocks;
  }
  return 1;
}

uint32_t spu2_dma(int number, uint8_t *buffer, uint32_t block_size, uint32_t blocks, uint32_t direction) {
  (void)direction;
  woken();
  core *c = &spu.cores[number];
  uint32_t taken = dma_taken(c, buffer, block_size, blocks);
  uint32_t about[4] = { (uint32_t)number, c->transfer_mode, (uint32_t)(c->control & CONTROL_DMA), block_size * taken };
  listed('D', about, sizeof about, 1);
  if (taken) listed('d', buffer, block_size * taken, 0);
  return taken;
}

int spu2_irq(void) { return spu.ram && (spu.cores[0].irq_pending || spu.cores[1].irq_pending); }
