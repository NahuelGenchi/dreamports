// The PlayStation's sound chip, the SPU, as a game writes it: a halfword at a time to its registers, from 0x1F801C00,
// and the sound data DMA moves into its 512 KB of memory. It is mixed by dfsound, the SPU PCSX ReARMed mixes a game's
// sound with, so a Dreamport's every sample comes out as the emulator `prove` compares it with makes it, with the
// settings the tools give the emulator (tools/consoles.mjs): the chip's own Gaussian table between a voice's samples,
// and its reverb (kit/ps1/c/README.md).
//
// The chip keeps time by the processor's clock, 768 of its cycles to a sample, 44,100 samples a second. A Dreamport
// has no clock of its own, so the kit counts the chip's from the samples the page has heard: what a game writes lands
// where the sound it's heard so far ends, as an original's writes do when it makes them as its frame starts. The CD's
// own sound, which the drive gives the chip partway through a frame, lands as far on from there as it came into the
// frame (spu_cd_xa).

#include "ps1-kit.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// dfsound takes its memory once, as the chip is started, which the kit gives it from a block of its own rather than
// from a C library a Dreamport's page doesn't have, and takes back whole when the chip is started again
static void *sound_memory(size_t size);
#define malloc(size) sound_memory(size)
#define calloc(count, size) sound_memory((size_t)(count) * (size))
#define free(pointer) ((void)(pointer))

// the chip's registers, its DMA, and its mixing, built as one with the kit's own: the first two as spu.c's own
// files see it from outside, and spu.c last, as the one that keeps its state
EMULATOR_CODE
#include "dfsound/registers.c"
#include "dfsound/dma.c"
#include "dfsound/spu.c"
END_EMULATOR_CODE

// the chip's part of an emulator's save state, its freeze.c, which spu.c's SPUfreeze calls and the kit doesn't carry:
// a Dreamport's state is its C's own, and nothing calls SPUfreeze
long DoFreeze(int mode, struct SPUFreeze *state, unsigned short **ram, void *more, unsigned int cycles) { return 0; }

// what SPUinit and SetupStreams ask for, in turn: the chip's memory with the guard after it, its voices and one more,
// its reverb, the samples mixed, the mix, a second of the CD's XA sound and its CD sound's buffer, seven in all, each
// from 32 bytes on
static unsigned char block[512 * 1024 + 16 + (MAXCHAN + 1) * sizeof(SPUCHAN) + sizeof(REVERBInfo) + 32768
  + NSSIZE * 2 * sizeof(int) + 44100 * sizeof(uint32_t) + CDDA_BUFFER_SIZE + 7 * 32] __attribute__((aligned(32)));
static size_t taken;

static void *sound_memory(size_t size) {
  size_t at = (taken + 31) & ~(size_t)31;
  assert(at + size <= sizeof block);
  taken = at + size;
  return block + at;
}

// The samples the chip has mixed and the page hasn't heard yet, left and right, from `first` on: a frame's worth and
// a little over, at most, but a game's sound data moved in by DMA mixes the chip on as far as the move takes, as on
// the console
#define HELD 32768
static int16_t held[HELD * 2];
static int first, waiting;
// how far the chip's clock has gone: the processor's cycles of the sound the page has heard
static uint32_t now;

static void feed(void *data, int bytes) {
  const int16_t *samples = data;
  for (int i = 0; i < bytes / 4 && waiting < HELD; i++, waiting++) {
    int at = (first + waiting) % HELD;
    held[at * 2] = samples[i * 2];
    held[at * 2 + 1] = samples[i * 2 + 1];
  }
}
static int quiet(void) { return 0; }
static void nothing(void) {}
static struct out_driver page = { "Dreamports", quiet, nothing, quiet, feed };
struct out_driver *out_current;

void SetupSound(void) { out_current = &page; }

// the BIOS clearing a stretch of the chip's memory, by DMA, 16 KB at a time
static void clear(uint32_t address, uint32_t size) {
  static uint16_t zeros[8192];
  SPUwriteRegister(SPU_BASE + 0x1A6, address >> 3, now);
  SPUwriteRegister(SPU_BASE + 0x1AC, 4, now);
  for (uint32_t done = 0; done < size; done += sizeof zeros) SPUwriteDMAMem(zeros, (size - done < sizeof zeros ? size - done : sizeof zeros) / 2, now);
}

void spu_power(void) {
  memset(block, 0, taken);
  taken = 0;
  first = waiting = 0;
  now = 0;
  spu_config = (SPUConfig){ .iVolume = 768, .iUseReverb = 1, .iUseInterpolation = 2 };
  SPUinit();
  SPUopen();
  // the chip as the emulator's BIOS leaves it when it starts a game (its libpcsxcore/psxbios.c,
  // psxBiosSetupBootState): the memory every voice starts from cleared, ending in a block that loops, the reverb's
  // memory cleared, and each voice set to start and loop there
  clear(0x1000, 0x4490 - 0x1000 + 0x10);
  static uint16_t loops = 0x300;
  SPUwriteRegister(SPU_BASE + 0x1A6, 0x4490 >> 3, now);
  SPUwriteDMAMem(&loops, 1, now);
  clear(0xE128 << 3, 0x80000 - (0xE128 << 3));
  for (int voice = 0; voice < 24; voice++) {
    SPUwriteRegister(SPU_BASE + voice * 0x10 + 0x6, 0x1000 >> 3, now);
    SPUwriteRegister(SPU_BASE + voice * 0x10 + 0xE, 0x1A60 >> 3, now);
  }
}

void spu_write(uint32_t address, uint16_t value) { SPUwriteRegister(address, value, now); }

uint16_t spu_read(uint32_t address) { return SPUreadRegister(address, now); }

void spu_dma_write(const uint16_t *halves, int count) {
  // dfsound reads what it's given and leaves it as it was
  SPUwriteDMAMem((unsigned short *)halves, count, now);
}

void spu_dma_read(uint16_t *halves, int count) { SPUreadDMAMem(halves, count, now); }

// The CD's own sound, which the drive gives the chip as each sector comes, partway through a frame: the chip's time for
// it is where the frame's sound starts and as many cycles on as the sector came into the frame, so the chip mixes on to
// there first, as the emulator's does to the sector's cycle (cd.c)
static uint32_t heard_at(uint32_t cycle) { return now + (cycle - clock_frame_start()); }
void spu_cd_xa(struct xa_decode *xa, uint32_t cycle, int is_start) { SPUplayADPCMchannel(xa, heard_at(cycle), is_start); }
int spu_cd_audio(short *samples, int bytes, uint32_t cycle) { return SPUplayCDDAchannel(samples, bytes, heard_at(cycle), 0); }
void spu_cd_volume(uint8_t left_to_left, uint8_t left_to_right, uint8_t right_to_left, uint8_t right_to_right, uint32_t cycle) {
  SPUsetCDvol(left_to_left, left_to_right, right_to_left, right_to_right, heard_at(cycle));
}

void spu_sound(float *left, float *right, int count) {
  now += (uint32_t)count * 768;
  // mixed a sample past what's heard, as the chip mixes two at a time, so there's always enough
  SPUasync(now + 768, 1);
  for (int i = 0; i < count && waiting; i++, waiting--) {
    left[i] = held[first * 2] / 32768.0f;
    right[i] = held[first * 2 + 1] / 32768.0f;
    first = (first + 1) % HELD;
  }
}
