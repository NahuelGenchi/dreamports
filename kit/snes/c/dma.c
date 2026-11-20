// The Super Nintendo's DMA, as a write to $420B starts it: each channel's bytes moved, one channel after another, from
// the lowest, between a 24-bit address of the console's own memories and a register of the picture's and the sound's,
// $2100 to $21FF, as the channel's registers, $43x0 to $43x6, say. A channel's address and count are left as the move
// leaves them, as the console leaves them.

#include "snes-kit.h"

// which of the channel's registers each byte goes to, in turn, by the transfer's mode, $43x0's low three bits
static const uint8_t PATTERNS[8][4] = {
  { 0, 0, 0, 0 }, { 0, 1, 0, 1 }, { 0, 0, 0, 0 }, { 0, 0, 1, 1 },
  { 0, 1, 2, 3 }, { 0, 1, 0, 1 }, { 0, 0, 0, 0 }, { 0, 0, 1, 1 },
};

void dma_start(uint8_t channels) {
  uint8_t *cpu = SNES_CPU_REGISTERS;
  for (int c = 0; c < 8; c++) {
    if (!(channels >> c & 1)) continue;
    uint8_t *r = cpu + 0x300 + c * 0x10;
    uint8_t control = r[0], target = r[1];
    uint16_t address = (uint16_t)(r[2] | r[3] << 8);
    uint32_t bank = (uint32_t)r[4] << 16;
    uint32_t count = (uint32_t)(r[5] | r[6] << 8);
    if (!count) count = 0x10000;
    // the A bus's address moves on by one, back by one, or stays, as bits 3 and 4 say
    int step = control & 0x08 ? 0 : control & 0x10 ? -1 : 1;
    for (uint32_t i = 0; i < count; i++) {
      uint16_t to = (uint16_t)(0x2100 | (uint8_t)(target + PATTERNS[control & 7][i & 3]));
      if (control & 0x80) snes_bus_write(bank | address, snes_read(to));
      else snes_write(to, snes_bus(bank | address));
      address = (uint16_t)(address + step);
    }
    r[2] = (uint8_t)address;
    r[3] = (uint8_t)(address >> 8);
    r[5] = r[6] = 0;
  }
}

// HDMA: on each channel $420C turns on, a table in the console's memory of how many lines to wait and the bytes to
// write to the channel's registers on them, once or on every line, the bytes in the table or, with $43x0's bit 6, at
// an address the table gives. The kit starts it at line 0, and moves on one line as each line's H-blank comes, as
// Snes9x does (its dma.cpp); its writes show from the next line down. A channel keeps its place in its registers, the
// table's address at $43x8 and the indirect one at $43x5, as the console keeps them, and here the lines left and
// whether it writes on each.

// the bytes each transfer mode writes, and to which of the channel's registers, in order
static const uint8_t HDMA_BYTES[8] = { 1, 2, 2, 4, 4, 4, 2, 4 };
static struct {
  uint8_t lines, repeat, transfer;
} hdma[8];
// the channels running and those whose tables have ended this frame
static uint8_t hdma_running, hdma_ended;

static uint8_t *channel(int c) { return SNES_CPU_REGISTERS + 0x300 + c * 0x10; }
static uint16_t word_at(const uint8_t *r, int at) { return (uint16_t)(r[at] | r[at + 1] << 8); }
static void set_word(uint8_t *r, int at, uint16_t value) {
  r[at] = (uint8_t)value;
  r[at + 1] = (uint8_t)(value >> 8);
}
static uint16_t bus_word(uint32_t address) { return (uint16_t)(snes_bus(address) | snes_bus((address + 1) & 0xFFFFFF) << 8); }
// $43xA as the console reads it back
static void show_lines(int c) { channel(c)[10] = (uint8_t)(hdma[c].lines ^ (hdma[c].repeat ? 0x00 : 0x80)); }

// the channel's next entry from its table: how many lines, whether it writes on each, and for an indirect channel
// where its bytes are; 0 when the table ends
static int hdma_entry(int c) {
  uint8_t *r = channel(c);
  uint32_t bank = (uint32_t)r[4] << 16;
  uint16_t address = word_at(r, 8);
  uint8_t line = snes_bus(bank | address);
  if (!line) {
    hdma[c].repeat = 0;
    hdma[c].lines = 128;
    // an indirect channel reads an address even as its table ends, past one byte more when a later channel runs
    if (r[0] & 0x40) {
      if (hdma_running & (0xFE << c)) address++;
      set_word(r, 5, bus_word(bank | address));
      address++;
    }
    set_word(r, 8, (uint16_t)(address + 1));
    show_lines(c);
    return 0;
  }
  if (line == 0x80) {
    hdma[c].repeat = 1;
    hdma[c].lines = 128;
  } else {
    hdma[c].repeat = !(line & 0x80);
    hdma[c].lines = line & 0x7F;
  }
  address++;
  hdma[c].transfer = 1;
  if (r[0] & 0x40) {
    set_word(r, 5, bus_word(bank | address));
    address = (uint16_t)(address + 2);
  }
  set_word(r, 8, address);
  show_lines(c);
  return 1;
}

void hdma_start(void) {
  hdma_running = SNES_CPU_REGISTERS[0x20C];
  hdma_ended = 0;
  for (int c = 0; c < 8; c++) {
    if (!(hdma_running >> c & 1)) {
      hdma[c].transfer = 0;
      continue;
    }
    uint8_t *r = channel(c);
    set_word(r, 8, word_at(r, 2));
    if (!hdma_entry(c)) {
      hdma_running &= (uint8_t)~(1 << c);
      hdma_ended |= (uint8_t)(1 << c);
    }
  }
}

void hdma_line(void) {
  uint8_t running = hdma_running;
  for (int c = 0; c < 8; c++) {
    if (!(running >> c & 1) || !hdma[c].transfer) continue;
    uint8_t *r = channel(c);
    int indirect = r[0] & 0x40, mode = r[0] & 7;
    uint32_t bank = (uint32_t)(indirect ? r[7] : r[4]) << 16;
    uint16_t from = indirect ? word_at(r, 5) : word_at(r, 8);
    for (int i = 0; i < HDMA_BYTES[mode]; i++) {
      // the same registers in turn as DMA's patterns
      uint8_t to = (uint8_t)(r[1] + PATTERNS[mode][i]);
      uint32_t at = bank | (uint16_t)(from + i);
      if (r[0] & 0x80) snes_bus_write(at, snes_read((uint16_t)(0x2100 | to)));
      else snes_write((uint16_t)(0x2100 | to), snes_bus(at));
    }
  }
  for (int c = 0; c < 8; c++) {
    if (!(running >> c & 1)) continue;
    uint8_t *r = channel(c);
    if (hdma[c].transfer) set_word(r, r[0] & 0x40 ? 5 : 8, (uint16_t)(word_at(r, r[0] & 0x40 ? 5 : 8) + HDMA_BYTES[r[0] & 7]));
    hdma[c].transfer = !hdma[c].repeat;
    if (!--hdma[c].lines && !hdma_entry(c)) {
      running &= (uint8_t)~(1 << c);
      hdma_ended |= (uint8_t)(1 << c);
      hdma[c].transfer = 0;
    }
    show_lines(c);
  }
  hdma_running = running;
}

void hdma_lines_written(int c, uint8_t value) {
  // a write to $43xA: the lines left, and whether it writes on each
  if (value & 0x7F) {
    hdma[c].lines = value & 0x7F;
    hdma[c].repeat = !(value & 0x80);
  } else {
    hdma[c].lines = 128;
    hdma[c].repeat = !!(value & 0x80);
  }
}
