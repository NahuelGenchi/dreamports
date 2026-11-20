// The PlayStation 2's second processor, the IOP, as a Dreamport's twins of a game's own IOP modules reach it (ps2.h):
// its memory, and its hardware as the modules write it, the sound chip's registers (spu2.c) and the two DMA channels that
// move sound to and from it, 4 for core 0 and 7 for core 1, and the SIO2, which the pads are on (pad.c), with its two, 11
// and 12, as the console's emulator, Play!, has them.
//
// And the console's time as the emulator keeps it, which says when the sound chip mixes each block of its samples. The
// emulator runs the console in slices of 4,800 of the EE's clock ticks, the IOP 600 of its own in each, and at the top
// of each slice mixes 45 samples when their time has come, then starts the V-blank when its time has come. A frame of
// the tools runs from one V-blank's start to the next, so it mixes 16 or 17 blocks, and what the IOP writes to the chip
// as the frame starts comes before the frame's first block. The IOP's DMA to the sound chip goes on every 10,000 of its
// ticks once a transfer has started, and the SIF's packets reach the EE as the EE's ticks pass (sif.c). A game's IOP
// code runs as its frame starts, unless it says that time passes first (ps2_time_pass).

#include "ps2-kit.h"

#define IOP_RAM_SIZE 0x400000
#define EE_HZ 294912000u
#define SLICE 4800
#define IOP_SLICE 600
#define DMA_EVERY 10000
#define IRQ_EVERY 1000

static uint8_t *ram;

uint8_t *iop_memory(void) {
  if (!ram) ram = kit_alloc(IOP_RAM_SIZE);
  return ram;
}

// ----------------------------------------------------------------------------------------------------------------
// DMA to the sound chip

typedef struct { uint32_t madr, bcr, chcr; } channel;
// the sound chip's two, then the SIO2's, 11 in and 12 out
static channel channels[4];
static uint32_t dma_ended;

// a channel's transfer goes on as far as its core takes it, as the emulator's does each time it's started or picked up
static void resume(int n) {
  channel *c = &channels[n];
  if (!(c->chcr & 0x01000000)) return;
  uint32_t size = (c->bcr & 0xFFFF) * 4, blocks = c->bcr >> 16;
  uint8_t *data = iop_memory() + (c->madr & 0x1FFFFFFF & (IOP_RAM_SIZE - 1));
  uint32_t taken = n < 2 ? spu2_dma(n, data, size, blocks, c->chcr & 1) : n == 2 ? sio2_dma_in(data, size, blocks) : sio2_dma_out(data, size, blocks);
  blocks = (blocks - taken) & 0xFFFF;
  c->bcr = (c->bcr & 0xFFFF) | blocks << 16;
  c->madr += size * taken;
  if (blocks == 0) {
    c->chcr &= ~0x01000000u;
    dma_ended |= 1u << n;
  }
}
static void channel_write(int n, uint32_t offset, uint32_t value) {
  channel *c = &channels[n];
  switch (offset) {
  case 0x0: c->madr = value; break;
  case 0x4: c->bcr = value; break;
  case 0x6: c->bcr = (c->bcr & 0xFFFF) | (value & 0xFFFF) << 16; break;
  case 0x8:
    c->chcr = value;
    if (c->chcr & 0x01000000) resume(n);
    break;
  }
}
static uint32_t channel_read(int n, uint32_t offset) {
  channel *c = &channels[n];
  return offset == 0x0 ? c->madr : offset == 0x4 ? c->bcr : offset == 0x8 ? c->chcr : 0;
}

// ----------------------------------------------------------------------------------------------------------------
// The IOP's addresses

static int is_pads(uint32_t at) { return at >= 0x1F808200 && at <= 0x1F8082FF; }
static int is_sound(uint32_t at) { return (at >= 0x1F801C00 && at <= 0x1F801DFF) || (at >= 0x1F900000 && at <= 0x1F90FFFF); }
static int channel_of(uint32_t at) {
  return at >= 0x1F8010C0 && at < 0x1F8010D0 ? 0 : at >= 0x1F801500 && at < 0x1F801510 ? 1 : at >= 0x1F801540 && at < 0x1F801550 ? 2 : at >= 0x1F801550 && at < 0x1F801560 ? 3 : -1;
}

static void hardware_write(uint32_t address, uint32_t value, int bytes) {
  uint32_t at = address & 0x1FFFFFFF;
  if (at < IOP_RAM_SIZE * 4) {
    __builtin_memcpy(iop_memory() + (at & (IOP_RAM_SIZE - 1)), &value, bytes);
    return;
  }
  if (is_sound(at)) {
    spu2_write(at, value);
    return;
  }
  if (is_pads(at)) {
    sio2_write(at, value);
    return;
  }
  int n = channel_of(at);
  if (n >= 0) channel_write(n, at & 0xF, value);
}
static uint32_t hardware_read(uint32_t address, int bytes) {
  uint32_t at = address & 0x1FFFFFFF, value = 0;
  if (at < IOP_RAM_SIZE * 4) {
    __builtin_memcpy(&value, iop_memory() + (at & (IOP_RAM_SIZE - 1)), bytes);
    return value;
  }
  if (is_sound(at)) return spu2_read(at);
  if (is_pads(at)) return sio2_read(at);
  int n = channel_of(at);
  return n >= 0 ? channel_read(n, at & 0xF) : 0;
}

void iop_write8(uint32_t address, uint8_t value) { hardware_write(address, value, 1); }
void iop_write16(uint32_t address, uint16_t value) { hardware_write(address, value, 2); }
void iop_write32(uint32_t address, uint32_t value) { hardware_write(address, value, 4); }
uint8_t iop_read8(uint32_t address) { return (uint8_t)hardware_read(address, 1); }
uint16_t iop_read16(uint32_t address) { return (uint16_t)hardware_read(address, 2); }
uint32_t iop_read32(uint32_t address) { return hardware_read(address, 4); }

// ----------------------------------------------------------------------------------------------------------------
// The console's time

static int64_t spu_ticks, spu_total;
static int32_t vblank_ticks, on_screen, in_blank;
static int in_vblank, at_vblank;
static uint32_t into_slice, dma_ticks, irq_ticks, irq_line;
static uint64_t ee_now, vblanks;

void ps2_clock_power(void) {
  uint32_t frame = EE_HZ / (CONSOLE_CLOCK / CONSOLE_FRAME_TICKS);
  on_screen = (int32_t)(frame * 9 / 10);
  in_blank = (int32_t)(frame / 10);
  // the EE's ticks between two blocks of 45 samples at 44,100 a second, with 32 bits after the point, worked out as
  // the emulator does
  spu_total = (int64_t)((((uint64_t)EE_HZ) << 32) / 44100) * 45;
  spu_ticks = spu_total;
  vblank_ticks = on_screen;
  in_vblank = at_vblank = 0;
  into_slice = dma_ticks = irq_ticks = 0;
  ee_now = vblanks = 0;
}
uint64_t ps2_ee_time(void) { return ee_now; }

// The console's clock as the tools' emulator keeps it, the same in every run: from the first second of 2001, on by its
// V-blanks, 59.94 a second. The date as its year, month, day, hour, minute and second.
#define CLOCK_START 978307200u
void ps2_console_date(uint32_t parts[6]) {
  uint64_t now = CLOCK_START + vblanks * 1000 / 59940;
  uint32_t days = (uint32_t)(now / 86400), left = (uint32_t)(now % 86400);
  // the days since 1970 as a date (Howard Hinnant's civil_from_days)
  uint32_t z = days + 719468, era = z / 146097, doe = z - era * 146097;
  uint32_t yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365, doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  uint32_t mp = (5 * doy + 2) / 153, month = mp < 10 ? mp + 3 : mp - 9;
  parts[0] = yoe + era * 400 + (month <= 2);
  parts[1] = month;
  parts[2] = doy - (153 * mp + 2) / 5 + 1;
  parts[3] = left / 3600;
  parts[4] = left / 60 % 60;
  parts[5] = left % 60;
}

// the IOP's own ticks in a slice: its DMA goes on, and the sound chip's interrupt line follows the chip
static void iop_ticks(uint32_t ticks) {
  cdvd_ticks(ticks);
  dma_ticks += ticks;
  if (dma_ticks >= DMA_EVERY) {
    resume(0);
    resume(1);
    dma_ticks -= DMA_EVERY;
  }
  irq_ticks += ticks;
  if (irq_ticks >= IRQ_EVERY) {
    irq_line = spu2_irq();
    irq_ticks -= IRQ_EVERY;
  }
}
// the EE's ticks passing within a slice, which the SIF follows
static void ee_ticks(uint32_t ticks) {
  ee_now += ticks;
  into_slice += ticks;
  sif_ticks(ticks);
}
// the end of a slice's work: the EE's ticks counted down, then the IOP's slice
static void slice_end(void) {
  spu_ticks -= (int64_t)SLICE << 32;
  vblank_ticks -= SLICE;
  iop_threads();
  iop_ticks(IOP_SLICE);
  into_slice = 0;
}
// the top of a slice: a block of samples when one is due, then the V-blank, and 1 when the V-blank starts
static int slice_top(void) {
  if (spu_ticks <= 0) {
    spu2_block();
    spu_ticks += spu_total;
  }
  if (vblank_ticks <= 0) {
    in_vblank = !in_vblank;
    if (in_vblank) {
      vblank_ticks += in_blank;
      return 1;
    }
    vblank_ticks += on_screen;
  }
  return 0;
}

void ps2_time_pass(uint32_t ee_ticks_passing) {
  while (ee_ticks_passing && !at_vblank) {
    uint32_t take = SLICE - into_slice;
    if (take > ee_ticks_passing) take = ee_ticks_passing;
    ee_ticks(take);
    ee_ticks_passing -= take;
    if (into_slice == SLICE) {
      slice_end();
      at_vblank = slice_top();
      vblanks += at_vblank;
    }
  }
}
void ps2_time_to_slice(void) {
  if (!at_vblank) ps2_time_pass(SLICE - into_slice);
}
void ps2_clock_to_vblank(void) {
  while (!at_vblank) {
    ee_ticks(SLICE - into_slice);
    slice_end();
    at_vblank = slice_top();
    vblanks += at_vblank;
  }
  at_vblank = 0;
}

uint32_t iop_lines(void) { return (irq_line ? 1u : 0) | dma_ended << 1; }
