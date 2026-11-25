// The Nintendo DS's sound, as the ARM7 sees it (kit/nds/c/README.md): sixteen channels, each playing 8-bit, 16-bit or
// ADPCM samples from the main memory, and channels 8 to 13 a square wave and 14 and 15 noise as well, and the mixer that
// adds them up every 1,024 ticks of the console's clock, 32,728.498 pairs of samples a second, as melonDS, the reference
// emulator, has them (its SPU.cpp, which this follows line for line): each channel's volume, its divider and where it
// sits between left and right, the master volume, the bias and the cut to the 10 bits the console's speakers get. The
// first mix is at tick 1,024 after power-on, and every channel's timer runs at half the clock, 512 of its steps a mix.
// Not yet: the two capture units, the mixer's other ways of taking channels 1 and 3, and samples kept anywhere but in
// the main memory, which a channel reads as silence.

#include "nds.h"
#include "nds-kit.h"

static const int8_t ADPCM_INDEX[8] = { -1, -1, -1, -1, 2, 4, 6, 8 };
static const uint16_t ADPCM_STEP[89] = {
  0x0007, 0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x0010, 0x0011, 0x0013, 0x0015, 0x0017, 0x0019, 0x001C, 0x001F,
  0x0022, 0x0025, 0x0029, 0x002D, 0x0032, 0x0037, 0x003C, 0x0042, 0x0049, 0x0050, 0x0058, 0x0061, 0x006B, 0x0076, 0x0082, 0x008F,
  0x009D, 0x00AD, 0x00BE, 0x00D1, 0x00E6, 0x00FD, 0x0117, 0x0133, 0x0151, 0x0173, 0x0198, 0x01C1, 0x01EE, 0x0220, 0x0256, 0x0292,
  0x02D4, 0x031C, 0x036C, 0x03C3, 0x0424, 0x048E, 0x0502, 0x0583, 0x0610, 0x06AB, 0x0756, 0x0812, 0x08E0, 0x09C3, 0x0ABD, 0x0BD0,
  0x0CFF, 0x0E4C, 0x0FBA, 0x114C, 0x1307, 0x14EE, 0x1706, 0x1954, 0x1BDC, 0x1EA5, 0x21B6, 0x2515, 0x28CA, 0x2CDF, 0x315B, 0x364B,
  0x3BB9, 0x41B2, 0x4844, 0x4F7E, 0x5771, 0x602F, 0x69CE, 0x7462, 0x7FFF,
};
// a square wave's eight steps for each duty, the last always low
static const int16_t SQUARE[8][8] = {
  { -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, 0x7FFF },
  { -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, 0x7FFF, 0x7FFF },
  { -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF },
  { -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF },
  { -0x7FFF, -0x7FFF, -0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF },
  { -0x7FFF, -0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF },
  { -0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF, 0x7FFF },
  { -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF, -0x7FFF },
};

#define MIX_TICKS 1024
#define MIX_STEPS 512

struct channel {
  uint32_t cnt, source, timer, loop, length;
  uint16_t reload;
  uint8_t volume, shift, pan, key_on;
  int32_t pos;
  int16_t sample;
  uint16_t noise;
  int32_t adpcm, adpcm_index, adpcm_loop, adpcm_index_loop;
  uint8_t adpcm_byte;
  // the 32 bytes of samples read ahead from memory, as the console's sound DMA keeps them
  uint32_t fifo[8], read_at, write_at, read_from, level;
};

static struct channel channels[16];
static uint32_t control, bias;
static uint8_t master;
static int muted;
static uint64_t next_mix;          // the tick of the next mix
static int first_mix;              // the first mix runs no time, as melonDS's first does

// the pairs of samples mixed and not taken yet, 16 bits each
#define KEPT 8192
static int16_t kept[KEPT][2];
static int kept_start, kept_count;

static void set_cnt(struct channel *c, uint32_t value) {
  static const uint8_t SHIFTS[4] = { 4, 3, 2, 0 };
  uint32_t before = c->cnt;
  c->cnt = value & 0xFF7F837F;
  c->volume = c->cnt & 0x7F;
  if (c->volume == 127) c->volume++;
  c->shift = SHIFTS[(c->cnt >> 8) & 3];
  c->pan = (c->cnt >> 16) & 0x7F;
  if (c->pan == 127) c->pan++;
  if ((value & 0x80000000u) && !(before & 0x80000000u)) c->key_on = 1;
}

static uint32_t memory_word(uint32_t address) {
  if (address >> 24 != 0x02) return 0;
  const uint8_t *at = nds_main + (address & 0x3FFFFC);
  return at[0] | at[1] << 8 | at[2] << 16 | (uint32_t)at[3] << 24;
}

static void buffer(struct channel *c) {
  uint32_t total = c->loop + c->length;
  if (c->read_from >= total) {
    uint32_t repeat = (c->cnt >> 27) & 3;
    if (repeat & 1) c->read_from = c->loop;
    else if (repeat & 2) return;
  }
  uint32_t burst = 16;
  if (c->read_from + 16 > total) burst = total - c->read_from;
  for (uint32_t i = 0; i < burst; i += 4) {
    // the sound's DMA can't read the ARM7's BIOS
    c->fifo[c->write_at] = c->source + c->read_from >= 0x4000 ? memory_word(c->source + c->read_from) : 0;
    c->read_from += 4;
    c->write_at = (c->write_at + 1) & 7;
  }
  c->level += burst;
}

static uint32_t fifo_read(struct channel *c, int bytes) {
  const uint8_t *fifo = (const uint8_t *)c->fifo;
  uint32_t value = 0;
  for (int i = 0; i < bytes; i++) value |= (uint32_t)fifo[(c->read_at + i) & 0x1F] << (8 * i);
  c->read_at = (c->read_at + bytes) & 0x1F;
  c->level -= bytes;
  if (c->level <= 16) buffer(c);
  return value;
}

static void start(struct channel *c) {
  c->timer = c->reload;
  c->pos = ((c->cnt >> 29) & 3) == 3 ? -1 : -3;
  c->noise = 0x7FFF;
  c->sample = 0;
  c->read_at = c->write_at = c->read_from = c->level = 0;
  if (((c->cnt >> 29) & 3) != 3) {
    buffer(c);
    buffer(c);
  }
}

static void stop(struct channel *c) {
  c->sample = 0;
  c->cnt &= ~0x80000000u;
}

static void next_sample(struct channel *c, int kind) {
  uint32_t repeat = (c->cnt >> 27) & 3;
  switch (kind) {
  case 0:
    if (++c->pos < 0) return;
    if ((uint32_t)c->pos >= c->loop + c->length) {
      if (repeat & 1) c->pos = c->loop;
      else if (repeat & 2) { stop(c); return; }
    }
    c->sample = (int16_t)((int8_t)fifo_read(c, 1) * 256);
    return;
  case 1:
    if (++c->pos < 0) return;
    if ((uint32_t)c->pos << 1 >= c->loop + c->length) {
      if (repeat & 1) c->pos = c->loop >> 1;
      else if (repeat & 2) { stop(c); return; }
    }
    c->sample = (int16_t)fifo_read(c, 2);
    return;
  case 2:
    c->pos++;
    if (c->pos < 8) {
      if (c->pos == 0) {
        uint32_t header = fifo_read(c, 4);
        c->adpcm = (int16_t)(header & 0xFFFF);
        c->adpcm_index = (header >> 16) & 0x7F;
        if (c->adpcm_index > 88) c->adpcm_index = 88;
        c->adpcm_loop = c->adpcm;
        c->adpcm_index_loop = c->adpcm_index;
      }
      return;
    }
    if ((uint32_t)c->pos >> 1 >= c->loop + c->length) {
      if (repeat & 1) {
        c->pos = c->loop << 1;
        c->adpcm = c->adpcm_loop;
        c->adpcm_index = c->adpcm_index_loop;
        c->adpcm_byte = fifo_read(c, 1);
      } else if (repeat & 2) {
        stop(c);
        return;
      }
    } else {
      if (!(c->pos & 1)) c->adpcm_byte = fifo_read(c, 1);
      else c->adpcm_byte >>= 4;
      uint16_t step = ADPCM_STEP[c->adpcm_index], diff = step >> 3;
      if (c->adpcm_byte & 1) diff += step >> 2;
      if (c->adpcm_byte & 2) diff += step >> 1;
      if (c->adpcm_byte & 4) diff += step;
      if (c->adpcm_byte & 8) { c->adpcm -= diff; if (c->adpcm < -0x7FFF) c->adpcm = -0x7FFF; }
      else { c->adpcm += diff; if (c->adpcm > 0x7FFF) c->adpcm = 0x7FFF; }
      c->adpcm_index += ADPCM_INDEX[c->adpcm_byte & 7];
      if (c->adpcm_index < 0) c->adpcm_index = 0;
      else if (c->adpcm_index > 88) c->adpcm_index = 88;
      if ((uint32_t)c->pos == c->loop << 1) {
        c->adpcm_loop = c->adpcm;
        c->adpcm_index_loop = c->adpcm_index;
      }
    }
    c->sample = (int16_t)c->adpcm;
    return;
  case 3:
    c->pos++;
    c->sample = SQUARE[(c->cnt >> 24) & 7][c->pos & 7];
    return;
  default:
    if (c->noise & 1) { c->noise = (c->noise >> 1) ^ 0x6000; c->sample = -0x7FFF; }
    else { c->noise >>= 1; c->sample = 0x7FFF; }
  }
}

// a channel's output for one mix of `steps` of its timer, before it's placed between left and right
static int32_t run(struct channel *c, int number, uint32_t steps) {
  int kind = (c->cnt >> 29) & 3;
  if (kind == 3) {
    if (number >= 14) kind = 4;
    else if (number < 8) return 0;
  }
  if (!(c->cnt & 0x80000000u)) return 0;
  if (kind < 3 && c->length + c->loop < 16) return 0;
  if (c->key_on) {
    start(c);
    c->key_on = 0;
  }
  c->timer += steps;
  while (c->timer >> 16) {
    c->timer = c->reload + (c->timer - 0x10000);
    next_sample(c, kind);
    if (!(c->cnt & 0x80000000u)) break;
  }
  return ((int32_t)c->sample << c->shift) * c->volume;
}

static void mix(uint32_t steps) {
  int32_t left = 0, right = 0, out_left = 0, out_right = 0;
  if (control & 0x8000) {
    int32_t each[16];
    for (int i = 0; i < 16; i++) each[i] = run(&channels[i], i, steps);
    for (int i = 0; i < 16; i++) {
      // channels 1 and 3 go to the mixer unless the mixer takes them another way
      if ((i == 1 && (control & 0x1000)) || (i == 3 && (control & 0x2000))) continue;
      left += (int32_t)(((int64_t)each[i] * (128 - channels[i].pan)) >> 10);
      right += (int32_t)(((int64_t)each[i] * channels[i].pan) >> 10);
    }
    if (control & 0x0F00) nds_not_yet();
    out_left = left;
    out_right = right;
  }
  out_left = (int32_t)(((int64_t)out_left * master) >> 7) >> 8;
  out_right = (int32_t)(((int64_t)out_right * master) >> 7) >> 8;
  out_left += (int32_t)(bias << 6) - 0x8000;
  out_right += (int32_t)(bias << 6) - 0x8000;
  int16_t pair[2];
  if (muted) {
    pair[0] = pair[1] = 0;
  } else {
    pair[0] = (int16_t)(out_left < -0x8000 ? -0x8000 : out_left > 0x7FFF ? 0x7FFF : out_left);
    pair[1] = (int16_t)(out_right < -0x8000 ? -0x8000 : out_right > 0x7FFF ? 0x7FFF : out_right);
  }
  // the console's 10 bits
  pair[0] &= (int16_t)0xFFC0;
  pair[1] &= (int16_t)0xFFC0;
  if (kept_count == KEPT) nds_not_yet();
  int at = (kept_start + kept_count) % KEPT;
  kept[at][0] = pair[0];
  kept[at][1] = pair[1];
  kept_count++;
}

void nds_sound_power(void) {
  for (int i = 0; i < 16; i++) channels[i] = (struct channel){ 0 };
  control = bias = 0;
  master = 0;
  muted = 1;
  next_mix = MIX_TICKS;
  first_mix = 1;
  kept_start = kept_count = 0;
}

void nds_sound_run(uint64_t until) {
  while (next_mix < until) {
    mix(first_mix ? 0 : MIX_STEPS);
    first_mix = 0;
    next_mix += MIX_TICKS;
  }
}

void nds_sound_powered(int on) { muted = !on; }

void nds_sound_write(uint64_t now, uint32_t address, uint32_t value, int bytes) {
  nds_sound_run(now + 1);
  if (bytes == 4) {
    nds_sound_write(now, address, value & 0xFFFF, 2);
    nds_sound_write(now, address + 2, value >> 16, 2);
    return;
  }
  if (bytes == 1) {
    // a byte of a channel's control, or of the mixer's
    if (address < 0x04000500) {
      struct channel *c = &channels[(address >> 4) & 15];
      int shift = 8 * (address & 3);
      if ((address & 0xF) < 4) set_cnt(c, (c->cnt & ~(0xFFu << shift)) | (value & 0xFF) << shift);
      else nds_not_yet();
      return;
    }
    if (address == 0x04000500) { control = (control & 0xBF00) | (value & 0x7F); master = control & 0x7F; if (master == 127) master++; return; }
    if (address == 0x04000501) { control = (control & 0x007F) | ((value & 0xBF) << 8); return; }
    nds_not_yet();
    return;
  }
  if (address < 0x04000500) {
    struct channel *c = &channels[(address >> 4) & 15];
    switch (address & 0xF) {
    case 0x0: set_cnt(c, (c->cnt & 0xFFFF0000u) | value); return;
    case 0x2: set_cnt(c, (c->cnt & 0x0000FFFFu) | value << 16); return;
    case 0x4: c->source = (c->source & 0xFFFF0000u) | value; c->source &= 0x07FFFFFC; return;
    case 0x6: c->source = (c->source & 0x0000FFFFu) | value << 16; c->source &= 0x07FFFFFC; return;
    case 0x8: c->reload = (uint16_t)value; return;
    case 0xA: c->loop = (value & 0xFFFF) << 2; return;
    case 0xC: c->length = ((((c->length >> 2) & 0xFFFF0000u) | value) & 0x001FFFFF) << 2; return;
    default: c->length = ((((c->length >> 2) & 0x0000FFFFu) | value << 16) & 0x001FFFFF) << 2; return;
    }
  }
  switch (address) {
  case 0x04000500: control = value & 0xBF7F; master = control & 0x7F; if (master == 127) master++; return;
  case 0x04000504: bias = value & 0x3FF; return;
  default: nds_not_yet();
  }
}

uint32_t nds_sound_read(uint32_t address, int bytes) {
  if (address < 0x04000500) {
    uint32_t cnt = channels[(address >> 4) & 15].cnt;
    if ((address & 0xF) < 4) return (cnt >> (8 * (address & 3))) & (bytes == 4 ? 0xFFFFFFFFu : bytes == 2 ? 0xFFFF : 0xFF);
    return 0;
  }
  if (address == 0x04000500) return control & (bytes == 1 ? 0xFF : 0xFFFF);
  if (address == 0x04000501) return control >> 8;
  if (address == 0x04000504) return bias;
  return 0;
}

void nds_sound_take(float *left, float *right, int count) {
  for (int i = 0; i < count; i++) {
    if (!kept_count) {
      // the page asks for the samples a frame's time holds, by its own count, which a mix can come after
      mix(first_mix ? 0 : MIX_STEPS);
      first_mix = 0;
      next_mix += MIX_TICKS;
    }
    left[i] = kept[kept_start][0] / 32768.0f;
    right[i] = kept[kept_start][1] / 32768.0f;
    kept_start = (kept_start + 1) % KEPT;
    kept_count--;
  }
}

void nds_sound_drop(void) { kept_start = kept_count = 0; }
