// The GameCube's audio interface and the sound processor's audio DMA, which hands it the samples a game keeps in
// memory, as Dolphin, the console's reference in the proof tools, has them with the tools' change to it
// (tools/libretro/dolphin.patch): the DMA takes 32 bytes at a time, 8 pairs of samples, each the right side's and then
// the left's, highest byte first, round and round the blocks the game gives it, or 8 pairs of silence while it's off,
// and the interface plays them at one of its two rates, 108,000,000 over a divisor, 48,042.7 or 32,028.5 a second. It
// starts at the slower.
//
// The tools hear those samples at the kit's rate, 48,000 a second, on a straight line between each two of them, as
// their program that runs the reference hears them (tools/libretro/host.c), and so does the page here: each sample
// heard is the one before plus the way to the next one as far as the time has gone, cut toward zero to a whole number.
// Sound a game streams from its disc isn't here yet, nor the sound processor's programs.

#include "gamecube-kit.h"

#define RATE_DIVIDEND 108000000.0
// the DMA's rate bit in the interface's control register, and the divisors of its two rates
#define AIDFR 0x40
#define FAST 2248
#define SLOW 3372

static uint32_t control, volume, sample_counter, interrupt_timing;
// the DMA: where its blocks start, its control (on, and how many blocks of 32 bytes), where it is and how many are left
static uint32_t source;
static uint16_t dma_control;
static uint32_t current, remaining;
// the pairs it took last, and which of them comes next; what's heard: how far between the last two, and the last one
static int16_t block[16];
static int next = 8;
static double between;
static int16_t before[2], now[2];
static int started;

void audio_power(void) {
  // the streaming rate's bit set, at 48 kHz, and the DMA's set, at 32 kHz, as the reference starts them
  control = 0x02 | AIDFR;
  volume = sample_counter = interrupt_timing = 0;
  source = 0;
  dma_control = 0;
  current = remaining = 0;
  next = 8;
  between = 0;
  before[0] = before[1] = now[0] = now[1] = 0;
  started = 0;
}

uint16_t dsp_read(uint32_t reg) {
  switch (reg & 0x1FE) {
    case 0x30: return (uint16_t)(source >> 16);
    case 0x32: return (uint16_t)source;
    case 0x36: return dma_control;
    // the blocks left counts from zero
    case 0x3A: return (uint16_t)(remaining > 0 ? remaining - 1 : 0);
    default: return 0;
  }
}

void dsp_write(uint32_t reg, uint16_t value) {
  switch (reg & 0x1FE) {
    // the start's high bits, of which a GameCube has ten, and its low ones, on 32 bytes
    case 0x30: source = (source & 0xFFFF) | (uint32_t)(value & 0x03FF) << 16; break;
    case 0x32: source = (source & 0xFFFF0000u) | (value & 0xFFE0); break;
    case 0x36: {
      int was_on = dma_control & 0x8000;
      dma_control = value;
      // a DMA already going takes the new start and length when it next comes round
      if (!was_on && (value & 0x8000)) {
        current = source;
        remaining = value & 0x7FFF;
      }
      break;
    }
    default: break;
  }
}

uint32_t ai_read(uint32_t reg) {
  switch (reg & 0x1C) {
    case 0x00: return control;
    case 0x04: return volume;
    // the streamed samples counted, which with nothing streamed from the disc stays where it was set
    case 0x08: return sample_counter;
    case 0x0C: return interrupt_timing;
    default: return 0;
  }
}

void ai_write(uint32_t reg, uint32_t value) {
  switch (reg & 0x1C) {
    case 0x00: {
      // the interrupt's mask and the streaming's settings, the DMA's rate and playing, kept; a 1 in the interrupt's bit
      // clears it, and one in the counter's reset bit sets the counter to 0
      uint32_t kept = value & (0x01 | 0x02 | 0x04 | 0x10 | AIDFR);
      control = (control & 0x08) | kept;
      if (value & 0x08) control &= ~0x08u;
      if (value & 0x20) sample_counter = 0;
      break;
    }
    case 0x04: volume = value; break;
    case 0x08: sample_counter = value; break;
    case 0x0C: interrupt_timing = value; break;
    default: break;
  }
}

// the DMA's next 8 pairs, as it takes them
static void take_block(void) {
  if (dma_control & 0x8000) {
    for (int i = 0; i < 16; i++) {
      uint32_t at = (current & 0x01FFFFFF) + (uint32_t)i * 2;
      block[i] = (int16_t)(at + 1 < GC_RAM_SIZE ? gc_be16(gc_ram + at) : 0);
    }
    if (remaining != 0) {
      remaining--;
      current += 32;
    }
    if (remaining == 0) {
      current = source;
      remaining = dma_control & 0x7FFF;
    }
  } else {
    for (int i = 0; i < 16; i++) block[i] = 0;
  }
  next = 0;
}

void gc_sound(float *left, float *right, int count) {
  for (int done = 0; done < count;) {
    // the next of the interface's samples has come, once the time heard has gone past the last
    if (!started || between >= 1) {
      if (started) between -= 1;
      before[0] = now[0];
      before[1] = now[1];
      if (next >= 8) take_block();
      now[0] = block[next * 2 + 1];
      now[1] = block[next * 2];
      next++;
      started = 1;
      continue;
    }
    // how much of one of the interface's samples a sample heard lasts
    double step = RATE_DIVIDEND / (control & AIDFR ? SLOW : FAST) / CONSOLE_SOUND_RATE;
    // cut toward zero, as a whole number of 16 bits takes it
    int16_t l = (int16_t)(before[0] + (now[0] - before[0]) * between), r = (int16_t)(before[1] + (now[1] - before[1]) * between);
    left[done] = l / 32768.0f;
    right[done] = r / 32768.0f;
    done++;
    between += step;
  }
}
