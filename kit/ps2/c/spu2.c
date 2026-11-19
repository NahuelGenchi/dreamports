// The PlayStation 2's sound chip, the SPU2, as the console's emulator mixes it, sample for sample (ps2-kit.h): its two
// cores of 24 voices each, their ADPCM, envelopes, volume sweeps, pitch, reverb and sound input blocks, the chip's
// memory, written through each core's data port or by DMA, and its interrupt address. A Dreamport's sound is proven
// against what the emulator makes of the same writes (docs/STANDARD.md), so this follows the emulator's own model of
// the chip, Play!'s Iop_SpuBase, Iop_Spu2_Core, Iop_Spu2 and the way PS2VM mixes the two cores, step for step, down to
// what that model does its own way: it mixes at 44,100 samples a second, 45 at a time, and keeps decoded blocks in a
// cache that a write into the middle of a block doesn't empty. Noise, pitch modulation and the master and effect
// volumes, which Play! leaves out, are here as the console does them, checked against PCSX2's SPU2, and the tools'
// patch gives Play! the same (tools/libretro/play.patch), so the two still match. Its reverb works in floats, each sum cut towards zero with tiny floats flushed, as Play!'s
// emulation thread has them (ee.c).
//
// Every write to the chip's registers, every block of sound data moved by DMA and every block of 45 samples mixed is
// the frame's sound list, hashed in the order it came as the proof tools hash the original's (tools/libretro/play.patch).
//
// Followed from Play! (https://github.com/jpd002/Play-), under its licence:
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

#pragma STDC FP_CONTRACT OFF

#define RAM_SIZE 0x200000
#define RAM_MASK (RAM_SIZE - 1)
#define VOICES 24
#define BUFFER_SAMPLES 28
#define PITCH_BASE 0x1000
#define TIME_SCALE 0x1000
#define BLOCK_SAMPLES 45
#define MAX_ADSR_VOLUME 0x7FFFFFFF
#define INIT_SAMPLE_RATE 44100
#define CORE_SAMPLE_RATE 48000
#define OUTPUT_RATE 44100

// the core's control bits, its transfer modes and the voices' states
enum { CONTROL_ENABLE = 0x8000, CONTROL_REVERB = 0x80, CONTROL_IRQ = 0x40, CONTROL_DMA = 0x30, CONTROL_DMA_STOP = 0x00, CONTROL_DMA_READ = 0x30 };
enum { MODE_VOICE = 0, MODE_CORE0_IN = 1, MODE_CORE1_IN = 2 };
enum { STOPPED, KEY_ON, ATTACK, DECAY, SUSTAIN, RELEASE };
// where the cores write their output and read their sound input blocks, in the chip's memory
enum { CORE0_SIN_LEFT = 0x000, CORE1_SIN_LEFT = 0x800, CORE1_SIN_RIGHT = 0xA00, CORE0_OUTPUT_SIZE = 0x200 };
enum { INPUT_CORE0 = 0x2000, INPUT_CORE1 = 0x2400, INPUT_SIZE = 0x400, INPUT_SAMPLES = INPUT_SIZE / 4 };
// the reverb's parameters, in the emulator's order
enum {
  FB_SRC_A, FB_SRC_B, IIR_ALPHA, ACC_COEF_A, ACC_COEF_B, ACC_COEF_C, ACC_COEF_D, IIR_COEF, FB_ALPHA, FB_X, IIR_DEST_A0,
  IIR_DEST_A1, ACC_SRC_A0, ACC_SRC_A1, ACC_SRC_B0, ACC_SRC_B1, IIR_SRC_A0, IIR_SRC_A1, IIR_DEST_B0, IIR_DEST_B1, ACC_SRC_C0,
  ACC_SRC_C1, ACC_SRC_D0, ACC_SRC_D1, IIR_SRC_B0, IIR_SRC_B1, MIX_DEST_A0, MIX_DEST_A1, MIX_DEST_B0, MIX_DEST_B1,
  IN_COEF_L, IN_COEF_R, REVERB_PARAMS,
};
// which parameter each of a core's reverb address registers sets, from 0x2E4 four bytes apart, and each coefficient
// register, from 0x774 two bytes apart
static const uint8_t address_registers[22] = {
  FB_SRC_A, FB_SRC_B, IIR_DEST_A0, IIR_DEST_A1, ACC_SRC_A0, ACC_SRC_A1, ACC_SRC_B0, ACC_SRC_B1, IIR_SRC_A0, IIR_SRC_A1, IIR_DEST_B0,
  IIR_DEST_B1, ACC_SRC_C0, ACC_SRC_C1, ACC_SRC_D0, ACC_SRC_D1, IIR_SRC_B0, IIR_SRC_B1, MIX_DEST_A0, MIX_DEST_A1, MIX_DEST_B0, MIX_DEST_B1,
};
static const uint8_t coefficient_registers[10] = { IIR_ALPHA, ACC_COEF_A, ACC_COEF_B, ACC_COEF_C, ACC_COEF_D, IIR_COEF, FB_ALPHA, FB_X, IN_COEF_L, IN_COEF_R };

// how far a volume sweep moves each sample, by its rate
static const uint32_t increase_deltas[0x80] = {
  0x3A0CC55E, 0x305FF9CE, 0x2976D61E, 0x203FFBDE, 0x1D0662AF, 0x182FFCE7, 0x1359971F, 0x101FFDEF,
  0x0DD2475F, 0x0C17FE73, 0x0A0233AF, 0x080FFEF7, 0x07144A05, 0x060BFF39, 0x050119D7, 0x03F9DC6C,
  0x037F3A27, 0x02FE04E5, 0x026B32E3, 0x01EF5BE9, 0x01B514DD, 0x018712AA, 0x01430F6B, 0x0100385E,
  0x00E129C7, 0x00BE85CF, 0x00A187B5, 0x00801C2F, 0x007094E3, 0x00607F9E, 0x004FE588, 0x003DEB7D,
  0x00392824, 0x00318930, 0x00271B77, 0x00204E57, 0x001B851B, 0x0017F80F, 0x00141506, 0x0010272B,
  0x000E0504, 0x000BFC07, 0x000A0A83, 0x0007FD5A, 0x0006C140, 0x00063126, 0x0004F41E, 0x0003E925,
  0x000389CC, 0x0002F8DF, 0x00027A0F, 0x0002021A, 0x0001C4E6, 0x00017C6F, 0x00014267, 0x0001010D,
  0x0000DFC9, 0x0000C023, 0x00009E83, 0x00007ECF, 0x00006FE4, 0x00005F1B, 0x00004F41, 0x00003F67,
  0x000037F2, 0x00002F8D, 0x000027A0, 0x0000203D, 0x00001BF9, 0x00001814, 0x00001405, 0x00000FD9,
  0x00000D96, 0x00000BE3, 0x00000A02, 0x000007EC, 0x0000070B, 0x000005F1, 0x00000501, 0x000003F6,
  0x00000385, 0x00000304, 0x00000280, 0x00000200, 0x000001BE, 0x0000017F, 0x00000140, 0x00000100,
  0x000000DF, 0x000000BF, 0x000000A0, 0x00000080, 0x0000006F, 0x0000005F, 0x00000050, 0x00000040,
  0x00000037, 0x0000002F, 0x00000028, 0x00000020, 0x0000001B, 0x00000017, 0x00000014, 0x00000010,
  0x0000000D, 0x0000000B, 0x0000000A, 0x00000008, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
};
static const uint32_t decrease_deltas[0x80] = {
  0x488FF6B5, 0x3A0CC55E, 0x305FF9CE, 0x2976D61E, 0x203FFBDE, 0x1D0662AF, 0x182FFCE7, 0x1359971F,
  0x101FFDEF, 0x0DD2475F, 0x0C17FE73, 0x0A0233AF, 0x080FFEF7, 0x07144A05, 0x060BFF39, 0x050119D7,
  0x03F9DC6C, 0x037F3A27, 0x02FE04E5, 0x026B32E3, 0x01EF5BE9, 0x01B514DD, 0x018712AA, 0x01430F6B,
  0x0100385E, 0x00E129C7, 0x00BE85CF, 0x00A187B5, 0x00801C2F, 0x007094E3, 0x00607F9E, 0x004FE588,
  0x003DEB7D, 0x00392824, 0x00318930, 0x00271B77, 0x00204E57, 0x001B851B, 0x0017F80F, 0x00141506,
  0x0010272B, 0x000E0504, 0x000BFC07, 0x000A0A83, 0x0007FD5A, 0x0006C140, 0x00063126, 0x0004F41E,
  0x0003E925, 0x000389CC, 0x0002F8DF, 0x00027A0F, 0x0002021A, 0x0001C4E6, 0x00017C6F, 0x00014267,
  0x0001010D, 0x0000DFC9, 0x0000C023, 0x00009E83, 0x00007ECF, 0x00006FE4, 0x00005F1B, 0x00004F41,
  0x00003F67, 0x000037F2, 0x00002F8D, 0x000027A0, 0x0000203D, 0x00001BF9, 0x00001814, 0x00001405,
  0x00000FD9, 0x00000D96, 0x00000BE3, 0x00000A02, 0x000007EC, 0x0000070B, 0x000005F1, 0x00000501,
  0x000003F6, 0x00000385, 0x00000304, 0x00000280, 0x00000200, 0x000001BE, 0x0000017F, 0x00000140,
  0x00000100, 0x000000DF, 0x000000BF, 0x000000A0, 0x00000080, 0x0000006F, 0x0000005F, 0x00000050,
  0x00000040, 0x00000037, 0x0000002F, 0x00000028, 0x00000020, 0x0000001B, 0x00000017, 0x00000014,
  0x00000010, 0x0000000D, 0x0000000B, 0x0000000A, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000
};
// the predictor of each ADPCM filter, the ones past the fifth being none
static const int32_t predictors[16][2] = { { 0, 0 }, { 60, 0 }, { 115, -52 }, { 98, -55 }, { 122, -60 } };

// A voice reads its ADPCM a block of 28 samples ahead, and steps through them at its pitch over the output's rate
typedef struct {
  uint32_t src_index, step, src_rate, dst_rate, next_addr, repeat_addr;
  int16_t buffer[BUFFER_SAMPLES * 2];
  int32_t s1, s2;
  uint8_t done, next_valid, end_flag, changed_repeat;
} reader;

typedef struct {
  uint16_t volume_left, volume_right;
  int32_t volume_left_abs, volume_right_abs;
  uint16_t pitch;
  uint32_t address;
  uint16_t adsr_level, adsr_rate;
  uint32_t adsr_volume;
  uint32_t repeat;
  uint8_t repeat_set;
  uint32_t status;
  uint32_t current;
} voice;

// the sound input a core is sent in blocks, read at its own rate
typedef struct {
  uint32_t base_rate, dst_rate, src_index, step;
  uint8_t block[INPUT_SIZE];
  uint8_t bypass;
} block_reader;

typedef struct {
  unsigned number;
  uint32_t core_rate, base_rate;
  uint32_t irq_addr;
  uint8_t irq_pending;
  uint16_t transfer_mode;
  uint32_t transfer_addr, output_offset;
  uint32_t reverb_voices;
  uint32_t reverb_start, reverb_end, reverb_now;
  uint16_t control;
  int32_t reverb_ticks;
  uint32_t reverb[REVERB_PARAMS];
  voice voices[VOICES];
  reader readers[VOICES];
  block_reader input;
  uint32_t input_addr, input_written;
  uint32_t input_volume_left, input_volume_right;
  int32_t external_volume_left, external_volume_right;
  // the voices that play noise and those whose pitch the voice before bends, the noise generator, what each voice
  // gave this sample after its envelope, and the master and effect volumes
  uint32_t noise_voices, bent_voices, noise_count, noise_out;
  int32_t voice_out[VOICES];
  uint16_t master_left, master_right;
  int32_t master_left_abs, master_right_abs;
  int32_t effect_left, effect_right;
} core;

// Each block the voices decode, kept by where it is and the two samples before it, as the emulator keeps them: a write
// to the chip's memory forgets the blocks that start where it writes, but not one it writes into the middle of, which
// plays as it was decoded until something forgets it
typedef struct {
  uint32_t address;
  int32_t in_s1, in_s2, out_s1, out_s2;
  int32_t next;
  int16_t samples[BUFFER_SAMPLES];
} cached;
#define CACHE_CHUNK 4096

static struct spu2 {
  uint8_t *ram;
  core cores[2];
  uint32_t adsr_table[160];
  // the interrupt address each core watches for, and whether a voice has read it
  uint32_t watched[2];
  uint8_t watched_hit[2];
  // the cache: the first block kept at each even address, then the next of the same address
  int32_t *cache_first;
  cached *cache;
  int32_t cache_size, cache_used, cache_free;
  uint32_t spdif_out, spdif_mode, spdif_media;
  // the frame's samples, left and right
  int16_t *heard;
  uint32_t heard_count, heard_room;
} spu;
// how many samples core 0 mixed before anything woke the chip, which moved only where it writes its output
static uint32_t ticks_asleep;

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
// Waking the chip

static void update_noise(core *c);

static void core_reset(core *c, unsigned number) {
  __builtin_memset(c, 0, sizeof *c);
  c->number = number;
  c->core_rate = CORE_SAMPLE_RATE;
  c->base_rate = INIT_SAMPLE_RATE;
  c->irq_addr = 0xFFFFFFFF;
  c->reverb_end = 0x80000;
  c->input_volume_left = c->input_volume_right = 0x7FFF;
  c->external_volume_left = c->external_volume_right = 0x7FFF;
  for (int i = 0; i < VOICES; i++) c->readers[i].dst_rate = OUTPUT_RATE;
  c->input.base_rate = INIT_SAMPLE_RATE;
  c->input.dst_rate = OUTPUT_RATE;
  c->input.src_index = INPUT_SAMPLES * TIME_SCALE;
  c->input.step = (c->input.base_rate * TIME_SCALE) / c->input.dst_rate;
  c->input_addr = number == 0 ? INPUT_CORE0 : INPUT_CORE1;
}

// the chip's memory and state, made the first time a game touches it, as one that never does needs none of it
static void woken(void) {
  if (spu.ram) return;
  spu.ram = kit_alloc(RAM_SIZE);
  spu.cache_first = kit_alloc(sizeof(int32_t) * (RAM_SIZE / 2));
  for (uint32_t i = 0; i < RAM_SIZE / 2; i++) spu.cache_first[i] = -1;
  spu.cache_free = -1;
  core_reset(&spu.cores[0], 0);
  core_reset(&spu.cores[1], 1);
  spu.cores[0].output_offset = (ticks_asleep * 2) & (CORE0_OUTPUT_SIZE - 1);
  // and its noise generator went on stepping
  for (uint32_t i = 0; i < ticks_asleep; i++) update_noise(&spu.cores[0]);
  spu.watched[0] = spu.watched[1] = 0xFFFFFFFF;
  // the envelope's steps, which double every four
  uint32_t value = 3, increment = 1, column = 0;
  for (int i = 32; i < 160; i++) {
    if (value < 0x3FFFFFFF) {
      value += increment;
      if (++column == 5) {
        column = 1;
        increment *= 2;
      }
    } else value = 0x3FFFFFFF;
    spu.adsr_table[i] = value;
  }
}

// ----------------------------------------------------------------------------------------------------------------
// The decoded blocks

static cached *cache_find(uint32_t address, int32_t s1, int32_t s2) {
  for (int32_t i = spu.cache_first[address >> 1]; i >= 0; i = spu.cache[i].next) {
    if (spu.cache[i].in_s1 == s1 && spu.cache[i].in_s2 == s2) return &spu.cache[i];
  }
  return 0;
}
static cached *cache_add(uint32_t address, int32_t s1, int32_t s2) {
  int32_t i = spu.cache_free;
  if (i >= 0) spu.cache_free = spu.cache[i].next;
  else {
    if (spu.cache_used == spu.cache_size) {
      // more room, kept in one stretch so an entry is found by its number
      int32_t size = spu.cache_size + CACHE_CHUNK;
      cached *more = kit_alloc(sizeof(cached) * (size_t)size);
      if (spu.cache_used) __builtin_memcpy(more, spu.cache, sizeof(cached) * (size_t)spu.cache_used);
      spu.cache = more;
      spu.cache_size = size;
    }
    i = spu.cache_used++;
  }
  cached *item = &spu.cache[i];
  item->address = address;
  item->in_s1 = s1;
  item->in_s2 = s2;
  item->next = spu.cache_first[address >> 1];
  spu.cache_first[address >> 1] = i;
  return item;
}
// forgets the blocks that start from `address` to `address + size`, both included, as the emulator's does
static void cache_forget(uint32_t address, uint32_t size) {
  uint64_t last = (uint64_t)address + size;
  if (last > RAM_SIZE - 1) last = RAM_SIZE - 1;
  for (uint64_t at = (address + 1) & ~1u; at <= last; at += 2) {
    int32_t i = spu.cache_first[at >> 1];
    if (i < 0) continue;
    while (i >= 0) {
      int32_t next = spu.cache[i].next;
      spu.cache[i].next = spu.cache_free;
      spu.cache_free = i;
      i = next;
    }
    spu.cache_first[at >> 1] = -1;
  }
}

static void watch(uint32_t address) {
  for (int i = 0; i < 2; i++) if (address == spu.watched[i]) spu.watched_hit[i] = 1;
}

// ----------------------------------------------------------------------------------------------------------------
// A voice's samples

static void unpack(reader *r, int16_t *to) {
  const uint8_t *block = spu.ram + r->next_addr;
  watch(r->next_addr);
  uint8_t shift = block[0] & 0xF, predict = block[0] >> 4, flags = block[1];
  int32_t key_s1 = predict == 0 ? 0 : r->s1, key_s2 = predict == 0 ? 0 : r->s2;
  cached *item = cache_find(r->next_addr, key_s1, key_s2);
  if (item) {
    __builtin_memcpy(to, item->samples, sizeof item->samples);
    r->s1 = item->out_s1;
    r->s2 = item->out_s2;
  } else {
    int32_t work[BUFFER_SAMPLES];
    for (int i = 2, n = 0; i < 16; i++) {
      int16_t first = (int16_t)((block[i] & 0x0F) << 12), second = (int16_t)((block[i] & 0xF0) << 8);
      first = (int16_t)(first >> shift);
      second = (int16_t)(second >> shift);
      work[n++] = first;
      work[n++] = second;
    }
    for (int i = 0; i < BUFFER_SAMPLES; i++) {
      int32_t value = work[i] * 64;
      value += (r->s1 * predictors[predict][0]) / 64;
      value += (r->s2 * predictors[predict][1]) / 64;
      r->s2 = r->s1;
      r->s1 = value;
      int32_t result = (value + 32) / 64;
      if (result < -32768) result = -32768;
      if (result > 32767) result = 32767;
      to[i] = (int16_t)result;
    }
    item = cache_add(r->next_addr, key_s1, key_s2);
    __builtin_memcpy(item->samples, to, sizeof item->samples);
    item->out_s1 = r->s1;
    item->out_s2 = r->s2;
  }
  if (flags & 0x04) {
    r->repeat_addr = r->next_addr;
    r->changed_repeat = 1;
  }
  r->next_addr = (r->next_addr + 0x10) & RAM_MASK;
  if (flags & 0x01) {
    r->end_flag = 1;
    r->next_addr = r->repeat_addr;
    if (flags != 0x03) r->done = 1;
  }
}
static void advance(reader *r) {
  if (r->next_valid) {
    __builtin_memmove(r->buffer, r->buffer + BUFFER_SAMPLES, sizeof(int16_t) * BUFFER_SAMPLES);
    unpack(r, r->buffer + BUFFER_SAMPLES);
  } else {
    unpack(r, r->buffer);
    unpack(r, r->buffer + BUFFER_SAMPLES);
    r->next_valid = 1;
  }
}
static void reader_set(reader *r, uint32_t address, uint32_t repeat) {
  r->src_index = 0;
  r->next_addr = address & RAM_MASK;
  r->repeat_addr = repeat & RAM_MASK;
  r->s1 = r->s2 = 0;
  r->next_valid = r->done = r->changed_repeat = 0;
}
static int32_t reader_sample(reader *r) {
  uint32_t index = r->src_index / PITCH_BASE;
  int32_t alpha = (int32_t)(r->src_index % PITCH_BASE);
  int32_t now = r->buffer[index], next = r->buffer[index + 1];
  int32_t result = (now * (PITCH_BASE - alpha) / PITCH_BASE) + (next * alpha / PITCH_BASE);
  r->src_index += r->step;
  if (index >= BUFFER_SAMPLES) {
    r->src_index -= BUFFER_SAMPLES * PITCH_BASE;
    advance(r);
  }
  return result;
}
static uint32_t reader_current(const reader *r) {
  uint32_t within = (r->src_index / PITCH_BASE) / 2;
  return r->next_addr + (within < 0x0E ? within : 0x0E);
}

// ----------------------------------------------------------------------------------------------------------------
// Envelopes and volumes

static uint32_t adsr_delta(unsigned index) { return spu.adsr_table[(unsigned)(index + 32)]; }

static void update_adsr(voice *v) {
  static const unsigned log_index[8] = { 0, 4, 6, 8, 9, 10, 11, 12 };
  unsigned attack_rate = v->adsr_level >> 8 & 0x7F, attack_mode = v->adsr_level >> 15, decay_rate = v->adsr_level >> 4 & 0xF, sustain_level = v->adsr_level & 0xF;
  unsigned release_rate = v->adsr_rate & 0x1F, release_mode = v->adsr_rate >> 5 & 1, sustain_rate = v->adsr_rate >> 6 & 0x7F;
  unsigned sustain_direction = v->adsr_rate >> 14 & 1, sustain_mode = v->adsr_rate >> 15;
  int32_t level = (int32_t)v->adsr_volume;
  if (v->status == ATTACK) {
    if (attack_mode == 0 || level < 0x60000000) level = (int32_t)((uint32_t)level + adsr_delta((attack_rate ^ 0x7F) - 0x10));
    else level = (int32_t)((uint32_t)level + adsr_delta((attack_rate ^ 0x7F) - 0x18));
    if (level < 0) {
      level = MAX_ADSR_VOLUME;
      v->status = DECAY;
    }
  } else if (v->status == DECAY) {
    unsigned type = ((uint32_t)level >> 28) & 0x7;
    level = (int32_t)((uint32_t)level - adsr_delta((4 * (decay_rate ^ 0x1F)) - 0x18 + log_index[type]));
    if ((unsigned)((level >> 27) & 0xF) <= sustain_level) v->status = SUSTAIN;
  } else if (v->status == SUSTAIN) {
    if (sustain_direction == 0) {
      if (sustain_mode == 0 || level < 0x60000000) level = (int32_t)((uint32_t)level + adsr_delta((sustain_rate ^ 0x7F) - 0x10));
      else level = (int32_t)((uint32_t)level + adsr_delta((sustain_rate ^ 0x7F) - 0x18));
      if (level < 0) level = MAX_ADSR_VOLUME;
    } else {
      if (sustain_mode == 0) level = (int32_t)((uint32_t)level - adsr_delta((sustain_rate ^ 0x7F) - 0x0F));
      else {
        unsigned type = ((uint32_t)level >> 28) & 0x7;
        level = (int32_t)((uint32_t)level - adsr_delta((sustain_rate ^ 0x7F) - 0x1B + log_index[type]));
      }
      if (level < 0) level = 0;
    }
  } else if (v->status == RELEASE) {
    if (release_mode == 0) level = (int32_t)((uint32_t)level - adsr_delta((4 * (release_rate ^ 0x1F)) - 0x0C));
    else {
      unsigned type = ((uint32_t)level >> 28) & 0x7;
      level = (int32_t)((uint32_t)level - adsr_delta((4 * (release_rate ^ 0x1F)) - 0x18 + log_index[type]));
    }
    if (level < 0) {
      level = 0;
      v->status = STOPPED;
    }
  }
  v->adsr_volume = (uint32_t)level;
}

static int32_t channel_volume(uint16_t volume, int32_t now) {
  int32_t level = 0;
  if (!(volume & 0x8000)) {
    level = volume & 0x4000 ? 0x3FFF - (volume & 0x3FFF) : (volume & 0x3FFF);
    return (int32_t)((uint32_t)level << 17);
  }
  unsigned rate = volume & 0x7F, decrease = volume >> 13 & 1, slope = volume >> 14 & 1;
  if (slope == 0) {
    level = decrease ? (int32_t)((uint32_t)now - decrease_deltas[rate]) : (int32_t)((uint32_t)now + increase_deltas[rate]);
  } else if (decrease) {
    int64_t delta = (int64_t)now * (int64_t)rate / 0x7F;
    int32_t base = now > 1 ? now : 1;
    int64_t clamped = delta < 1 ? 1 : delta > base ? base : delta;
    level = (int32_t)((uint32_t)base - (uint32_t)clamped);
  }
  // an exponential sweep up isn't done by the emulator, which leaves the voice silent
  if (level < 0) level = 0;
  return level;
}

static void mix(int32_t sample, int32_t volume, int16_t *out) {
  sample = (int32_t)((uint32_t)sample * (uint32_t)volume) / 0x7FFF;
  int32_t result = sample + *out;
  if (result < -32768) result = -32768;
  if (result > 32767) result = 32767;
  *out = (int16_t)result;
}

// ----------------------------------------------------------------------------------------------------------------
// The reverb, in floats as the emulator's thread does them: each sum cut towards zero, tiny floats flushed

static float reverb_sample(const core *c, uint32_t offset) {
  uint32_t at = c->reverb_now + offset;
  while (at >= c->reverb_end) {
    at -= c->reverb_end;
    at += c->reverb_start;
  }
  int16_t value;
  __builtin_memcpy(&value, spu.ram + at, 2);
  return (float)value;
}
static void reverb_write(const core *c, uint32_t offset, float value) {
  uint32_t at = c->reverb_now + offset;
  while (at >= c->reverb_end) {
    at -= c->reverb_end;
    at += c->reverb_start;
  }
  if (value < -32768.0f) value = -32768.0f;
  if (value > 32767.0f) value = 32767.0f;
  int16_t whole = (int16_t)value;
  __builtin_memcpy(spu.ram + at, &whole, 2);
}
static float coefficient(const core *c, int param) { return ee_div((float)(int16_t)c->reverb[param], 32768.0f); }
#define R(param) reverb_sample(c, c->reverb[param])

// The noise generator, a step each sample, at the rate the core's control says: the console's own, as PCSX2 has it
// (Dr. Hell's, from pcsxr)
static void update_noise(core *c) {
  static const uint8_t add[64] = {
    1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0,
    0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1,
  };
  static const uint16_t rate_add[5] = { 0, 84, 140, 180, 210 };
  uint32_t clock = c->control >> 8 & 0x3F, level = (0x8000u >> (clock >> 2)) << 16;
  c->noise_count += 0x10000;
  c->noise_count += rate_add[clock & 3];
  if ((c->noise_count & 0xFFFF) >= rate_add[4]) {
    c->noise_count += 0x10000;
    c->noise_count -= rate_add[clock & 3];
  }
  if (c->noise_count >= level) {
    while (c->noise_count >= level) c->noise_count -= level;
    c->noise_out = (c->noise_out << 1) | add[(c->noise_out >> 10) & 63];
  }
}

static void update_reverb(core *c, const int16_t in[2], int16_t *out) {
  if (c->reverb_ticks & 1) {
    float input_l = ee_mul((float)in[0], 0.5f), input_r = ee_mul((float)in[1], 0.5f);
    float iir_coef = coefficient(c, IIR_COEF), in_l = coefficient(c, IN_COEF_L), in_r = coefficient(c, IN_COEF_R);
    float input_a0 = ee_add(ee_mul(R(IIR_SRC_A0), iir_coef), ee_mul(input_l, in_l));
    float input_a1 = ee_add(ee_mul(R(IIR_SRC_A1), iir_coef), ee_mul(input_r, in_r));
    float input_b0 = ee_add(ee_mul(R(IIR_SRC_B1), iir_coef), ee_mul(input_l, in_l));
    float input_b1 = ee_add(ee_mul(R(IIR_SRC_B0), iir_coef), ee_mul(input_r, in_r));
    float alpha = coefficient(c, IIR_ALPHA), rest = ee_sub(1.0f, alpha);
    float a0 = ee_add(ee_mul(input_a0, alpha), ee_mul(R(IIR_DEST_A0), rest));
    float a1 = ee_add(ee_mul(input_a1, alpha), ee_mul(R(IIR_DEST_A1), rest));
    float b0 = ee_add(ee_mul(input_b0, alpha), ee_mul(R(IIR_DEST_B0), rest));
    float b1 = ee_add(ee_mul(input_b1, alpha), ee_mul(R(IIR_DEST_B1), rest));
    reverb_write(c, c->reverb[IIR_DEST_A0] + 2, a0);
    reverb_write(c, c->reverb[IIR_DEST_A1] + 2, a1);
    reverb_write(c, c->reverb[IIR_DEST_B0] + 2, b0);
    reverb_write(c, c->reverb[IIR_DEST_B1] + 2, b1);
    float ca = coefficient(c, ACC_COEF_A), cb = coefficient(c, ACC_COEF_B), cc = coefficient(c, ACC_COEF_C), cd = coefficient(c, ACC_COEF_D);
    float acc0 = ee_add(ee_add(ee_add(ee_mul(R(ACC_SRC_A0), ca), ee_mul(R(ACC_SRC_B0), cb)), ee_mul(R(ACC_SRC_C0), cc)), ee_mul(R(ACC_SRC_D0), cd));
    float acc1 = ee_add(ee_add(ee_add(ee_mul(R(ACC_SRC_A1), ca), ee_mul(R(ACC_SRC_B1), cb)), ee_mul(R(ACC_SRC_C1), cc)), ee_mul(R(ACC_SRC_D1), cd));
    float fb_a0 = reverb_sample(c, c->reverb[MIX_DEST_A0] - c->reverb[FB_SRC_A]);
    float fb_a1 = reverb_sample(c, c->reverb[MIX_DEST_A1] - c->reverb[FB_SRC_A]);
    float fb_b0 = reverb_sample(c, c->reverb[MIX_DEST_B0] - c->reverb[FB_SRC_B]);
    float fb_b1 = reverb_sample(c, c->reverb[MIX_DEST_B1] - c->reverb[FB_SRC_B]);
    float fb_alpha = coefficient(c, FB_ALPHA), fb_x = coefficient(c, FB_X);
    reverb_write(c, c->reverb[MIX_DEST_A0], ee_sub(acc0, ee_mul(fb_a0, fb_alpha)));
    reverb_write(c, c->reverb[MIX_DEST_A1], ee_sub(acc1, ee_mul(fb_a1, fb_alpha)));
    reverb_write(c, c->reverb[MIX_DEST_B0], ee_sub(ee_sub(ee_mul(fb_alpha, acc0), ee_mul(fb_a0, -fb_alpha)), ee_mul(fb_b0, fb_x)));
    reverb_write(c, c->reverb[MIX_DEST_B1], ee_sub(ee_sub(ee_mul(fb_alpha, acc1), ee_mul(fb_a1, -fb_alpha)), ee_mul(fb_b1, fb_x)));
    c->reverb_now += 2;
    if (c->reverb_now >= c->reverb_end) c->reverb_now = c->reverb_start;
  }
  if (c->reverb_start != 0) {
    float left = ee_mul(0.333f, ee_add(R(MIX_DEST_A0), R(MIX_DEST_B0)));
    float right = ee_mul(0.333f, ee_add(R(MIX_DEST_A1), R(MIX_DEST_B1)));
    // at the effect volume
    mix((int32_t)left, c->effect_left, out + 0);
    mix((int32_t)right, c->effect_right, out + 1);
  }
  c->reverb_ticks++;
}
#undef R

// ----------------------------------------------------------------------------------------------------------------
// A core's samples

// `external` is what comes in from the other core, core 0's output into core 1
static void render(core *c, int16_t *samples, unsigned count, const int16_t *external) {
  int update_reverb_now = (c->control & CONTROL_REVERB) && c->reverb_start < c->reverb_end;
  int irq_enabled = (c->control & CONTROL_IRQ) != 0;
  __builtin_memset(samples, 0, sizeof(int16_t) * count);
  for (unsigned tick = 0; tick < count / 2; tick++, samples += 2) {
    int16_t reverb_in[2] = { 0, 0 };
    for (int i = 0; i < VOICES; i++) {
      voice *v = &c->voices[i];
      reader *r = &c->readers[i];
      if (v->status == KEY_ON) {
        reader_set(r, v->address, v->repeat);
        advance(r);
        r->end_flag = 0;
        v->status = ATTACK;
        v->adsr_volume = 0;
      } else {
        if (r->done) {
          v->status = STOPPED;
          v->adsr_volume = 0;
          r->done = 0;
        }
        if (r->changed_repeat && !v->repeat_set) {
          v->repeat = r->repeat_addr;
          r->changed_repeat = 0;
        }
        r->repeat_addr = v->repeat & RAM_MASK;
      }
      // a voice the one before bends steps by its pitch times what that voice gave this sample
      if (i > 0 && (c->bent_voices & (1u << i))) {
        int32_t bent = (int32_t)(v->pitch * (32768 + c->voice_out[i - 1])) >> 15;
        r->step = (c->base_rate * (uint32_t)(bent < 0 ? 0 : bent > 0x3FFF ? 0x3FFF : bent)) / r->dst_rate;
      } else r->step = r->src_rate / r->dst_rate;
      int32_t read = reader_sample(r);
      if (c->noise_voices & (1u << i)) read = (int16_t)c->noise_out;
      c->voice_out[i] = 0;
      v->current = reader_current(r);
      update_adsr(v);
      v->volume_left_abs = channel_volume(v->volume_left, v->volume_left_abs);
      v->volume_right_abs = channel_volume(v->volume_right, v->volume_right_abs);
      if (read == 0) continue;
      int32_t in = (read * (int32_t)(v->adsr_volume >> 16)) / (int32_t)(MAX_ADSR_VOLUME >> 16);
      if (in == 0) continue;
      c->voice_out[i] = in;
      int32_t left = v->volume_left_abs >> 16, right = v->volume_right_abs >> 16;
      mix(in, left, samples + 0);
      mix(in, right, samples + 1);
      if (update_reverb_now && (c->reverb_voices & (1u << i))) {
        mix(in, left, reverb_in + 0);
        mix(in, right, reverb_in + 1);
      }
    }
    block_reader *b = &c->input;
    if (!(b->src_index / TIME_SCALE < (b->bypass ? INPUT_SAMPLES / 2 : INPUT_SAMPLES)) && c->input_written == INPUT_SIZE) {
      __builtin_memcpy(b->block, spu.ram + c->input_addr, INPUT_SIZE);
      b->src_index = 0;
      c->input_written = 0;
    }
    if (b->src_index / TIME_SCALE < (b->bypass ? INPUT_SAMPLES / 2 : INPUT_SAMPLES)) {
      uint32_t index = b->src_index / TIME_SCALE;
      int16_t in[2];
      if (b->bypass) __builtin_memcpy(in, b->block + index * 4, 4);
      else {
        __builtin_memcpy(&in[0], b->block + index * 2, 2);
        __builtin_memcpy(&in[1], b->block + 0x200 + index * 2, 2);
      }
      b->src_index += b->step;
      if (c->number == 0 && b->bypass) {
        mix(in[0], 0x7FFF, samples + 0);
        mix(in[1], 0x7FFF, samples + 1);
      } else {
        mix(in[0], (int32_t)c->input_volume_left, samples + 0);
        mix(in[1], (int32_t)c->input_volume_right, samples + 1);
      }
    }
    // core 0 writes its output into the chip's memory, where its interrupt address can be
    if (c->number == 0) {
      if (irq_enabled) {
        if (c->irq_addr == CORE0_SIN_LEFT + c->output_offset || c->irq_addr == CORE1_SIN_LEFT + c->output_offset || c->irq_addr == CORE1_SIN_RIGHT + c->output_offset) c->irq_pending = 1;
      }
      c->output_offset = (c->output_offset + 2) & (CORE0_OUTPUT_SIZE - 1);
    }
    update_noise(c);
    if (update_reverb_now) update_reverb(c, reverb_in, samples);
    if (external) {
      mix(external[tick * 2], c->external_volume_left, samples + 0);
      mix(external[tick * 2 + 1], c->external_volume_right, samples + 1);
    }
    // the master volume, which sweeps as a voice's does, over everything the core gives
    c->master_left_abs = channel_volume(c->master_left, c->master_left_abs);
    c->master_right_abs = channel_volume(c->master_right, c->master_right_abs);
    samples[0] = (int16_t)((samples[0] * (c->master_left_abs >> 16)) / 0x7FFF);
    samples[1] = (int16_t)((samples[1] * (c->master_right_abs >> 16)) / 0x7FFF);
  }
  if (irq_enabled && spu.watched_hit[c->number]) c->irq_pending = 1;
  spu.watched_hit[c->number] = 0;
}

void spu2_block(void) {
  listed('B', 0, 0, 1);
  if (spu.heard_count + BLOCK_SAMPLES * 2 > spu.heard_room) {
    uint32_t room = spu.heard_room ? spu.heard_room * 2 : 4096;
    int16_t *more = kit_alloc(sizeof(int16_t) * room);
    if (spu.heard_count) __builtin_memcpy(more, spu.heard, sizeof(int16_t) * spu.heard_count);
    spu.heard = more;
    spu.heard_room = room;
  }
  int16_t *out = spu.heard + spu.heard_count;
  spu.heard_count += BLOCK_SAMPLES * 2;
  // a chip nothing has woken is silent, and only where core 0 writes its output moves
  if (!spu.ram) {
    __builtin_memset(out, 0, sizeof(int16_t) * BLOCK_SAMPLES * 2);
    ticks_asleep += BLOCK_SAMPLES;
    return;
  }
  render(&spu.cores[0], out, BLOCK_SAMPLES * 2, 0);
  core *c1 = &spu.cores[1];
  if (c1->control & CONTROL_ENABLE) {
    // core 0's output goes through core 1's, at its external input's volume and under its master volume
    int16_t second[BLOCK_SAMPLES * 2];
    render(c1, second, BLOCK_SAMPLES * 2, out);
    __builtin_memcpy(out, second, sizeof second);
  }
}

// ----------------------------------------------------------------------------------------------------------------
// The registers

static uint16_t address_low(uint32_t address) { return (uint16_t)((address >> 1) & 0xFFFF); }
static uint16_t address_high(uint32_t address) { return (uint16_t)((address >> 17) & 0xFFFF); }
static uint32_t set_low(uint32_t address, uint16_t value) { return (address & 0xFFFE0000) | (uint32_t)value << 1; }
static uint32_t set_high(uint32_t address, uint16_t value) { return (address & 0x0001FFFE) | (uint32_t)value << 17; }

static void set_irq(core *c, uint32_t address) {
  c->irq_addr = address & RAM_MASK;
  spu.watched[c->number] = c->irq_addr;
}
static void set_control(core *c, uint16_t value) {
  c->control = value;
  if (!(value & CONTROL_IRQ)) {
    c->irq_pending = 0;
    spu.watched_hit[c->number] = 0;
  }
}
static void set_pitch(core *c, int i) {
  reader *r = &c->readers[i];
  r->src_rate = c->base_rate * c->voices[i].pitch;
  r->step = r->src_rate / r->dst_rate;
}
static void key_on(core *c, uint32_t voices) {
  for (int i = 0; i < VOICES; i++) {
    if (!(voices & (1u << i))) continue;
    voice *v = &c->voices[i];
    v->status = KEY_ON;
    v->repeat_set = 0;
    v->current = v->address;
    // the emulator's envelope a step on, for a game that reads it before the voice has played
    v->adsr_volume = adsr_delta(((v->adsr_level >> 8 & 0x7F) ^ 0x7F) - 0x10);
  }
}
static void key_off(core *c, uint32_t voices) {
  for (int i = 0; i < VOICES; i++) {
    if (!(voices & (1u << i))) continue;
    voice *v = &c->voices[i];
    if (v->status == STOPPED) continue;
    if (v->status == KEY_ON) {
      v->status = STOPPED;
      reader *r = &c->readers[i];
      reader_set(r, v->address, v->repeat);
      __builtin_memset(r->buffer, 0, sizeof r->buffer);
      r->end_flag = 0;
      v->current = reader_current(r);
    } else v->status = RELEASE;
  }
}
static void write_word(core *c, uint16_t value) {
  // the emulator doesn't wrap the address round as it goes on, and writes past the chip's memory at its end: here it
  // stays in it
  __builtin_memcpy(spu.ram + (c->transfer_addr & (RAM_MASK & ~1u)), &value, 2);
  cache_forget(c->transfer_addr, 2);
  c->transfer_addr += 2;
}

// a register of a voice, `address` with the voice's own part taken out
static void voice_write(core *c, int i, uint32_t address, uint32_t value) {
  voice *v = &c->voices[i];
  switch (address & 0x7FF) {
  case 0x000: v->volume_left = (uint16_t)value; if (!(value & 0x8000)) v->volume_left_abs = (int32_t)((value & 0x3FFF) << 17); break;
  case 0x002: v->volume_right = (uint16_t)value; if (!(value & 0x8000)) v->volume_right_abs = (int32_t)((value & 0x3FFF) << 17); break;
  case 0x004: v->pitch = (uint16_t)value; set_pitch(c, i); break;
  case 0x006: v->adsr_level = (uint16_t)value; break;
  case 0x008: v->adsr_rate = (uint16_t)value; break;
  case 0x00A: v->adsr_volume = (uint16_t)value; break;
  case 0x1C0: v->address = set_high(v->address, (uint16_t)value); break;
  case 0x1C2: v->address = set_low(v->address, (uint16_t)value); break;
  case 0x1C4: v->repeat = set_high(v->repeat, (uint16_t)value); v->repeat_set = 1; break;
  case 0x1C6: v->repeat = set_low(v->repeat, (uint16_t)value); v->repeat_set = 1; break;
  case 0x1C8: v->current = set_high(v->current, (uint16_t)value); break;
  case 0x1CA: v->current = set_low(v->current, (uint16_t)value); break;
  }
}
static uint32_t voice_read(core *c, int i, uint32_t address) {
  voice *v = &c->voices[i];
  switch (address & 0x7FF) {
  case 0x000: return v->volume_left;
  case 0x002: return v->volume_right;
  case 0x004: return v->pitch;
  case 0x006: return v->adsr_level;
  case 0x008: return v->adsr_rate;
  case 0x00A: return v->adsr_volume >> 16;
  case 0x00C: return (uint32_t)v->volume_left_abs >> 16;
  case 0x00E: return (uint32_t)v->volume_right_abs >> 16;
  case 0x1C0: return address_high(v->address);
  case 0x1C2: return address_low(v->address);
  case 0x1C4: return address_high(v->repeat);
  case 0x1C6: return address_low(v->repeat);
  case 0x1C8: return address_high(v->current);
  case 0x1CA: return address_low(v->current);
  }
  return 0;
}

static void core_write(core *c, uint32_t address, uint32_t value) {
  uint32_t a = address & 0x7FF;
  if (a >= 0x2E4 && a < 0x33C) {
    unsigned param = address_registers[(a - 0x2E4) / 4];
    c->reverb[param] = a & 2 ? set_low(c->reverb[param], (uint16_t)value) : set_high(c->reverb[param], (uint16_t)value);
    return;
  }
  if (a >= 0x774 && a < 0x788) {
    c->reverb[coefficient_registers[(a - 0x774) / 2]] = value;
    return;
  }
  switch (a) {
  case 0x19A: c->base_rate = c->core_rate; c->input.base_rate = c->core_rate; c->input.step = (c->input.base_rate * TIME_SCALE) / c->input.dst_rate; set_control(c, (uint16_t)value); break;
  case 0x1AC: write_word(c, (uint16_t)value); break;
  case 0x1B0: c->transfer_mode = (uint16_t)value; break;
  case 0x180: c->bent_voices = (c->bent_voices & 0xFFFF0000) | (uint16_t)value; break;
  case 0x182: c->bent_voices = (c->bent_voices & 0x0000FFFF) | (uint32_t)(uint16_t)value << 16; break;
  case 0x184: c->noise_voices = (c->noise_voices & 0xFFFF0000) | (uint16_t)value; break;
  case 0x186: c->noise_voices = (c->noise_voices & 0x0000FFFF) | (uint32_t)(uint16_t)value << 16; break;
  case 0x760: c->master_left = (uint16_t)value; if (!(value & 0x8000)) c->master_left_abs = (int32_t)((value & 0x3FFF) << 17); break;
  case 0x762: c->master_right = (uint16_t)value; if (!(value & 0x8000)) c->master_right_abs = (int32_t)((value & 0x3FFF) << 17); break;
  case 0x764: c->effect_left = (int16_t)value; break;
  case 0x766: c->effect_right = (int16_t)value; break;
  case 0x194: c->reverb_voices = (c->reverb_voices & 0xFFFF0000) | (uint16_t)value; break;
  case 0x196: c->reverb_voices = (c->reverb_voices & 0x0000FFFF) | (uint32_t)(uint16_t)value << 16; break;
  case 0x1A0: key_on(c, value); break;
  case 0x1A2: key_on(c, value << 16); break;
  case 0x1A4: key_off(c, value); break;
  case 0x1A6: key_off(c, value << 16); break;
  case 0x340: case 0x342: if (value) for (int i = 0; i < VOICES; i++) c->readers[i].end_flag = 0; break;
  case 0x19C: set_irq(c, set_high(c->irq_addr, (uint16_t)value)); break;
  case 0x19E: set_irq(c, set_low(c->irq_addr, (uint16_t)value)); break;
  case 0x1A8: c->transfer_addr = set_high(c->transfer_addr, (uint16_t)value) & RAM_MASK; break;
  case 0x1AA: c->transfer_addr = set_low(c->transfer_addr, (uint16_t)value) & RAM_MASK; break;
  case 0x2E0: c->reverb_start = c->reverb_now = set_high(c->reverb_start, (uint16_t)value); break;
  case 0x2E2: c->reverb_start = c->reverb_now = set_low(c->reverb_start, (uint16_t)value); break;
  case 0x33C: c->reverb_end = (((value & 0x0F) << 17) | 0x1FFFF) + 1; break;
  case 0x768: c->external_volume_left = (int32_t)value; break;
  case 0x76A: c->external_volume_right = (int32_t)value; break;
  case 0x76C: c->input_volume_left = value; break;
  case 0x76E: c->input_volume_right = value; break;
  }
}
static uint32_t core_read(core *c, uint32_t address) {
  switch (address & 0x7FF) {
  case 0x344: return (c->control & CONTROL_DMA) ? 0x80 : 0;
  case 0x340: case 0x342: {
    uint32_t flags = 0;
    for (int i = 0; i < VOICES; i++) if (c->readers[i].end_flag) flags |= 1u << i;
    return (address & 0x7FF) == 0x340 ? (flags & 0xFFFF) : flags >> 16;
  }
  case 0x19A: return c->control;
  case 0x1B0: return c->transfer_mode;
  case 0x1A8: return address_high(c->transfer_addr);
  case 0x2E0: return address_high(c->reverb_start);
  case 0x2E2: return address_low(c->reverb_start);
  case 0x33C: return address_high(c->reverb_end - 1);
  case 0x760: return (uint32_t)c->master_left_abs >> 16;
  case 0x762: return (uint32_t)c->master_right_abs >> 16;
  case 0x764: return (uint32_t)c->effect_left & 0xFFFF;
  case 0x766: return (uint32_t)c->effect_right & 0xFFFF;
  case 0x768: return (uint32_t)c->external_volume_left;
  case 0x76A: return (uint32_t)c->external_volume_right;
  case 0x76C: return c->input_volume_left;
  case 0x76E: return c->input_volume_right;
  }
  return 0;
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
      if (at == 0x7C0) {
        spu.spdif_out = value;
        spu.cores[0].input.bypass = (value & 0x0100) != 0;
      } else if (at == 0x7C6) spu.spdif_mode = value;
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
  if (at < 0x180) {
    int i = (at >> 4) & 0x3F;
    if (i >= VOICES) return 0;
    return write ? (voice_write(c, i, at & ~(0x3Fu << 4), value), 0) : voice_read(c, i, at & ~(0x3Fu << 4));
  }
  if (at >= 0x1C0 && at < 0x2E0) {
    int i = (at - 0x1C0) / 12;
    if (i >= VOICES) return 0;
    return write ? (voice_write(c, i, at - i * 12, value), 0) : voice_read(c, i, at - i * 12);
  }
  return write ? (core_write(c, at, value), 0) : core_read(c, at);
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
    cache_forget(c->transfer_addr, block_size * blocks);
    for (uint32_t i = 0; i < blocks; i++) {
      uint32_t size = RAM_SIZE - c->transfer_addr < block_size ? RAM_SIZE - c->transfer_addr : block_size;
      __builtin_memcpy(spu.ram + c->transfer_addr, buffer, size);
      c->transfer_addr = (c->transfer_addr + block_size) & RAM_MASK;
      buffer += block_size;
    }
    return blocks;
  }
  if (c->transfer_mode == MODE_CORE0_IN || c->transfer_mode == MODE_CORE1_IN) {
    uint32_t room = (INPUT_SIZE - c->input_written) / block_size;
    if (blocks > room) blocks = room;
    __builtin_memcpy(spu.ram + c->input_addr + c->input_written, buffer, blocks * block_size);
    c->input_written += blocks * block_size;
    return blocks;
  }
  return 1;
}

uint32_t spu2_dma(int number, uint8_t *buffer, uint32_t block_size, uint32_t blocks, uint32_t direction) {
  woken();
  core *c = &spu.cores[number];
  uint32_t taken = dma_taken(c, buffer, block_size, blocks);
  uint32_t about[4] = { (uint32_t)number, c->transfer_mode, (uint32_t)(c->control & CONTROL_DMA), block_size * taken };
  listed('D', about, sizeof about, 1);
  if (taken) listed('d', buffer, block_size * taken, 0);
  return taken;
}

int spu2_irq(void) { return spu.ram && (spu.cores[0].irq_pending || spu.cores[1].irq_pending); }
