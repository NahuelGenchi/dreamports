// Each Nintendo DS processor's four DMA channels and the ARM9's fill registers (kit/nds/c/README.md), as melonDS, the
// reference emulator, has them (its DMA.cpp and DMA_Timings.cpp): each channel's source, destination and control, by
// halfwords or words, counting up, down or not at all, started at once or at each V-blank, repeating, with its
// interrupt at the end. A channel copies a unit at a time on its processor's bus (nds.c), each unit taking the time
// melonDS gives it from the two places' timings, with the main memory's bursts from melonDS's own tables, while its
// processor waits. Each processor's side is told apart by `seven`.

#include "nds.h"
#include "nds-kit.h"

typedef struct {
  uint32_t source, destination, control;
  uint32_t from, to, left;
  int step_from, step_to;
  const uint8_t *burst;   // the main memory's burst it's in, and how far
  int at;
} nds_channel;

static nds_channel channels[8];
static uint32_t fill[4];
static uint64_t seen[2];  // the time each processor's V-blank starts were looked at up to

// The main memory's bursts, as melonDS's tables give each unit's time, ending in a 0, as runs of a time
static uint8_t READ16[256], READ32_NARROW[256], READ32_WIDE[256], WRITE16[256], WRITE32_NARROW[256], WRITE32_WIDE[256];
static const uint8_t NONE[1] = { 0 };
static void runs(uint8_t *table, const uint8_t *pairs, int count) {
  int at = 0;
  for (int i = 0; i < count; i++)
    for (int n = 0; n < pairs[2 * i + 1]; n++) table[at++] = pairs[2 * i];
  while (at < 256) table[at++] = 0;
}

void nds_dma_power(void) {
  for (int i = 0; i < 8; i++) channels[i] = (nds_channel){ 0, 0, 0, 0, 0, 0, 1, 1, NONE, 0 };
  for (int i = 0; i < 4; i++) fill[i] = 0;
  seen[0] = seen[1] = 0;
  static const uint8_t read16[] = { 7, 1, 3, 1, 2, 117, 7, 1, 3, 1, 2, 117, 7, 1, 3, 1 };
  static const uint8_t read32_narrow[] = { 9, 1, 4, 1, 3, 77, 9, 1 }, read32_wide[] = { 9, 1, 3, 1, 2, 116 };
  static const uint8_t write16[] = { 8, 1, 2, 119 }, write32_narrow[] = { 9, 1, 4, 59 }, write32_wide[] = { 9, 1, 3, 79 };
  runs(READ16, read16, 8);
  runs(READ32_NARROW, read32_narrow, 4);
  runs(READ32_WIDE, read32_wide, 3);
  runs(WRITE16, write16, 2);
  runs(WRITE32_NARROW, write32_narrow, 2);
  runs(WRITE32_WIDE, write32_wide, 2);
}

// The places a unit reads and writes, as melonDS tells them apart for their timing, and their times: the first of a
// run (N) and the next (S), by halfwords and words. The main memory's bus is 16 bits wide, 8 for the first and 1 after.
enum { VOID = 0, BIOS = 1, MAIN = 2, WRAM = 4, IO = 8, PALETTE = 16, VRAM = 32, OAM = 64 };
typedef struct { int n16, s16, n32, s32; } nds_timing;
static int place(int seven, uint32_t address) {
  switch (address >> 24) {
  case 0x00: return seven && address < 0x10000 ? BIOS : VOID;
  case 0x02: return MAIN;
  case 0x03: return WRAM;
  case 0x04: return seven && address >= 0x04800000 ? VOID : IO;
  case 0x05: return seven ? VOID : PALETTE;
  case 0x06: return VRAM;
  case 0x07: return seven ? VOID : OAM;
  case 0xFF: return !seven && address >= 0xFFFF0000 ? BIOS : VOID;
  }
  return VOID;
}
static nds_timing timing(int where) {
  if (where == MAIN) return (nds_timing){ 8, 1, 9, 2 };
  if (where == PALETTE || where == VRAM) return (nds_timing){ 1, 1, 2, 2 };
  return (nds_timing){ 1, 1, 1, 1 };
}

static int burst(nds_channel *c, int start, const uint8_t *table) {
  if (start || c->burst[c->at] == 0) c->at = 0, c->burst = table;
  return c->burst[c->at++];
}

// a unit's time in ticks, as melonDS's UnitTimings9_16 and the others give it
static int unit_time(nds_channel *c, int seven, int words, int start) {
  int from = place(seven, c->from), to = place(seven, c->to);
  nds_timing s = timing(from), d = timing(to);
  int sn = words ? s.n32 : s.n16, ss = words ? s.s32 : s.s16, dn = words ? d.n32 : d.n16, ds = words ? d.s32 : d.s16;
  if (from == MAIN) {
    if (to == MAIN) return words ? 18 : 16;
    if (c->step_from > 0) return burst(c, start, !words ? READ16 : dn == 2 ? READ32_NARROW : READ32_WIDE);
    if (!words) return ((c->from & 0x1F) == 0x1E ? 7 : 8) + (start ? dn : ds);
    return ((c->from & 0x1F) == 0x1C ? (dn == 2 ? 7 : 8) : 9) + (start ? dn : ds);
  }
  if (to == MAIN) {
    if (c->step_to > 0) return burst(c, start, !words ? WRITE16 : sn == 2 ? WRITE32_NARROW : WRITE32_WIDE);
    return (start ? sn : ss) + (words ? 8 : 7);
  }
  if (from & to) return sn + dn + 1;
  return start ? sn + dn : ss + ds;
}

static int stepping(uint32_t mode) { return mode == 1 ? -1 : mode == 2 ? 0 : 1; }

// when a channel's start mode starts it: 0 at once, 1 at each V-blank, and the others, which aren't here yet
static int start_mode(int seven, uint32_t control) {
  return seven ? (int)((control >> 28) & 3) : (int)((control >> 27) & 7);
}

// a channel runs: every unit, its processor waiting, then its interrupt, and off unless it repeats
static void run(int id) {
  nds_channel *c = &channels[id];
  int seven = id >> 2, words = (c->control >> 26) & 1;
  uint32_t most = seven ? (id == 7 ? 0xFFFF : 0x3FFF) : 0x1FFFFF;
  c->left = c->control & most;
  if (!c->left) c->left = most + 1;
  if ((c->control & 0x01800000) == 0x01800000) c->from = c->source;
  if ((c->control & 0x00600000) == 0x00600000) c->to = c->destination;
  c->burst = NONE, c->at = 0;
  uint64_t *now = nds_time(seven);
  for (int first = 1; c->left; first = 0, c->left--) {
    *now += (uint64_t)unit_time(c, seven, words, first);
    if (place(seven, c->from) == VOID || place(seven, c->to) == VOID || place(seven, c->from) == BIOS) nds_not_yet();
    nds_bus_write(seven, c->to, nds_bus_read(seven, c->from, words ? 4 : 2), words ? 4 : 2);
    c->from += (uint32_t)(c->step_from * (words ? 4 : 2));
    c->to += (uint32_t)(c->step_to * (words ? 4 : 2));
  }
  if (!(c->control & 0x02000000)) c->control &= ~0x80000000u;
  if (c->control & 0x40000000) nds_irq_raise(seven, 8 + (id & 3));
}

// a channel's control written, as melonDS's WriteCnt: turned on, it takes its source and destination, and starts now
// or waits for its start
static void control(int id, uint32_t value) {
  nds_channel *c = &channels[id];
  uint32_t was = c->control;
  c->control = value;
  if ((was & 0x80000000) || !(value & 0x80000000)) return;
  c->from = c->source, c->to = c->destination;
  c->step_to = stepping((value >> 21) & 3);
  c->step_from = stepping((value >> 23) & 3);
  int mode = start_mode(id >> 2, value);
  if (mode == 0) run(id);
  else if (mode != 1) nds_not_yet();
}

int nds_dma_read(int seven, uint32_t address, int bytes, uint32_t *value) {
  if (!seven && address >= 0x040000E0 && address < 0x040000F0) {
    uint32_t word = fill[(address - 0x040000E0) >> 2];
    *value = bytes == 4 ? word : bytes == 2 ? (word >> (8 * (address & 2))) & 0xFFFF : (word >> (8 * (address & 3))) & 0xFF;
    return 1;
  }
  if (address < 0x040000B0 || address >= 0x040000E0) return 0;
  nds_channel *c = &channels[seven * 4 + (address - 0x040000B0) / 12];
  uint32_t r = (address - 0x040000B0) % 12;
  if (bytes == 1) nds_not_yet();
  if (r == 8) *value = bytes == 4 ? c->control : c->control & 0xFFFF;
  else if (r == 10) *value = c->control >> 16;
  else if (bytes == 4) *value = r ? c->destination : c->source;
  else nds_not_yet();
  return 1;
}

int nds_dma_write(int seven, uint32_t address, uint32_t value, int bytes) {
  if (!seven && address >= 0x040000E0 && address < 0x040000F0) {
    uint32_t *word = &fill[(address - 0x040000E0) >> 2];
    if (bytes == 4) *word = value;
    else if (bytes == 2) *word = address & 2 ? (*word & 0xFFFF) | value << 16 : (*word & 0xFFFF0000) | value;
    else nds_not_yet();
    return 1;
  }
  if (address < 0x040000B0 || address >= 0x040000E0) return 0;
  int id = seven * 4 + (int)((address - 0x040000B0) / 12);
  uint32_t r = (address - 0x040000B0) % 12;
  if (bytes == 1) nds_not_yet();
  if (r == 8) control(id, bytes == 4 ? value : (channels[id].control & 0xFFFF0000) | value);
  else if (r == 10) control(id, (channels[id].control & 0xFFFF) | value << 16);
  else if (bytes == 4 && r == 0) channels[id].source = value;
  else if (bytes == 4 && r == 4) channels[id].destination = value;
  else nds_not_yet();
  return 1;
}

// the V-blank's start, line 192, of the frame at or after `after`
static uint64_t vblank_after(uint64_t after) {
  uint64_t f = after <= NDS_VBLANK ? 0 : (after - NDS_VBLANK + NDS_FRAME - 1) / NDS_FRAME;
  return f * NDS_FRAME + NDS_VBLANK;
}

static int waiting_for_vblank(int seven) {
  for (int id = seven * 4; id < seven * 4 + 4; id++)
    if ((channels[id].control & 0x80000000) && start_mode(seven, channels[id].control) == 1) return 1;
  return 0;
}

uint64_t nds_dma_next(int seven) {
  return waiting_for_vblank(seven) ? vblank_after(seen[seven] + 1) : UINT64_MAX;
}

int nds_dma_due(int seven, uint64_t now, uint64_t *at) {
  if (now <= seen[seven]) return 0;
  uint64_t v = vblank_after(seen[seven] + 1);
  if (v > now) { seen[seven] = now; return 0; }
  seen[seven] = v;
  if (!waiting_for_vblank(seven)) return 0;
  *at = v;
  return 1;
}

void nds_dma_vblank(int seven) {
  for (int id = seven * 4; id < seven * 4 + 4; id++)
    if ((channels[id].control & 0x80000000) && start_mode(seven, channels[id].control) == 1) run(id);
}
