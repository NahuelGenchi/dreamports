// The GIF: what turns packets into the GS's register writes (ps2.h), the way the console's does, so a Dreamport that
// builds its original's packets, or whose DMA chains and vector unit programs build them, has its original's draw list.
//
// Packets come by three paths: PATH1 from vector unit 1's memory, as its XGKICK sends one, PATH2 from the VIF's DIRECT,
// and PATH3 from the GIF's own DMA channel or its FIFO. The GIF keeps one packet's state, so a packet split across two
// transfers goes on where it left off, and while one path is partway through a packet the others wait: PATH3's data
// waits in the FIFO, 16 quadwords of it. PATH3 can be masked, by the VIF's MSKPATH3 or GIF_MODE's M3R. This is how Play!,
// the console's emulator the proof tools run, orders them (Source/ee/GIF.cpp), so the GS gets the three paths' writes in
// the same order, including the one packet it lets through as PATH3 is unmasked.
//
// A packet is a run of tags, each saying how its data is laid out and how many times, to the one that ends it. PACKED
// data has a register in each 128 bits, in the shape the register's kind takes it; REGLIST has one in each 64, as it
// is; IMAGE is a picture's data. A write to SIGNAL that the GS hasn't yet been asked about holds the console's GIF up,
// which doesn't happen here.

#include "ps2-kit.h"

#define FIFO_SIZE 256
#define ONE 0x3F800000u

enum { MODE_M3R = 1 };
enum { STAT_M3R = 1, STAT_M3P = 2, STAT_OPH = 0x200 };
enum { PATH3_FREE, PATH3_LETTING_ONE, PATH3_LET_ONE };

// the packet being sent: what's left of its tag's loops and of this loop's registers, its layout and its registers, and
// the Q the last ST gave, which an RGBA's write carries
static uint32_t loops, kind, regs, regs_left, q = ONE;
static uint64_t list;
static int ends, active;
static int masked, mode, let_through;
static uint8_t fifo[FIFO_SIZE];
static uint32_t fifo_used;

static uint32_t word(const uint8_t *at, int index) {
  uint32_t value;
  __builtin_memcpy(&value, at + index * 4, 4);
  return value;
}
static uint64_t half(const uint8_t *at, int index) { return word(at, index * 2) | (uint64_t)word(at, index * 2 + 1) << 32; }

// one register's 128 bits of PACKED data, as its kind lays it out
static void packed(uint32_t reg, const uint8_t *at) {
  uint32_t v0 = word(at, 0), v1 = word(at, 1), v2 = word(at, 2), v3 = word(at, 3);
  switch (reg) {
  case 0x0: gs_write(GS_PRIM, v0); break;
  case 0x1: gs_write(GS_RGBAQ, (uint64_t)((v0 & 0xFF) | (v1 & 0xFF) << 8 | (v2 & 0xFF) << 16 | (v3 & 0xFF) << 24) | (uint64_t)q << 32); break;
  case 0x2: q = v2; gs_write(GS_ST, half(at, 0)); break;
  case 0x3: gs_write(GS_UV, (v0 & 0x7FFF) | (v1 & 0x7FFF) << 16); break;
  // a corner with its fog, and one without: the fourth word's bit 15 says it's written without drawing
  case 0x4: gs_write(v3 & 0x8000 ? GS_XYZF3 : GS_XYZF2, (uint64_t)((v0 & 0xFFFF) | (v1 & 0xFFFF) << 16) | (uint64_t)(v2 & 0x0FFFFFF0) << 28 | (uint64_t)(v3 & 0xFF0) << 52); break;
  case 0x5: gs_write(v3 & 0x8000 ? GS_XYZ3 : GS_XYZ2, (uint64_t)((v0 & 0xFFFF) | (v1 & 0xFFFF) << 16) | (uint64_t)v2 << 32); break;
  // these take their 64 bits as they are
  case 0x6: case 0x7: case 0x8: case 0x9: case 0xC: case 0xD: gs_write((uint8_t)reg, half(at, 0)); break;
  case 0xA: gs_write(GS_FOG, (half(at, 1) >> 36) << 56); break;
  // a register's number with its 64 bits
  case 0xE: gs_write((uint8_t)half(at, 1), half(at, 0)); break;
  default: break;
  }
}

static uint32_t send_packed(const uint8_t *memory, uint32_t at, uint32_t end) {
  uint32_t start = at;
  while (loops && at < end) {
    for (; regs_left && at < end; regs_left--, at += 16) packed((uint32_t)(list >> ((regs - regs_left) * 4)) & 0xF, memory + at);
    if (!regs_left) loops--, regs_left = regs;
  }
  return at - start;
}

static uint32_t send_reglist(const uint8_t *memory, uint32_t at, uint32_t end) {
  uint32_t start = at;
  while (loops && at < end) {
    for (; regs_left && at < end; regs_left--, at += 8) {
      uint32_t reg = (uint32_t)(list >> ((regs - regs_left) * 4)) & 0xF;
      if (reg != 0xF) gs_write((uint8_t)reg, half(memory + at, 0));
    }
    if (!regs_left) loops--, regs_left = regs;
  }
  // a list of an odd number of registers is filled out to 128 bits
  if (at & 15) at += 8;
  return at - start;
}

static uint32_t send_image(const uint8_t *memory, uint32_t size, uint32_t at, uint32_t end) {
  uint32_t count = (end - at) / 16 < loops ? (end - at) / 16 : loops, bytes = count * 16;
  // a picture that runs past the end of its memory goes on from its start, as one in vector unit 1's memory does
  uint32_t first = at + bytes > size ? size - at : bytes;
  if (first) gs_image(memory + at, first);
  if (bytes > first) gs_image(memory, bytes - first);
  loops -= count;
  return bytes;
}

static void drain_fifo(void);

uint32_t gif_path_packet(int path, const uint8_t *memory, uint32_t size, uint32_t at, uint32_t end) {
  uint32_t start = at;
  while (at < end) {
    if (!loops) {
      if (ends) {
        ends = 0, active = 0;
        break;
      }
      uint32_t first = word(memory + at, 0), second = word(memory + at, 1);
      list = half(memory + at, 1);
      at += 16;
      loops = first & 0x7FFF, ends = first >> 15 & 1, kind = second >> 26 & 3, regs = second >> 28;
      q = ONE;
      if (kind != 1 && second >> 14 & 1) gs_write(GS_PRIM, second >> 15 & 0x7FF);
      if (!regs) regs = 16;
      regs_left = regs;
      active = path;
      continue;
    }
    if (kind == 0) at += send_packed(memory, at, end);
    else if (kind == 1) at += send_reglist(memory, at, end);
    else at += send_image(memory, size, at, end);
  }
  if (!loops && ends) ends = 0, active = 0;
  if (!active && path == 3 && let_through == PATH3_LETTING_ONE) let_through = PATH3_LET_ONE;
  // PATH3's data that waited goes on once the other paths are done with the GIF
  if (!active && path != 3 && fifo_used) drain_fifo();
  return at - start;
}

static int path3_held(void) { return masked || (mode & MODE_M3R) || let_through == PATH3_LET_ONE; }

uint32_t gif_path_packets(int path, const uint8_t *memory, uint32_t size, uint32_t at, uint32_t end) {
  if (active && active != path) return 0;
  uint32_t start = at;
  while (at < end) {
    if (path == 3 && !active && path3_held()) break;
    at += gif_path_packet(path, memory, size, at, end);
  }
  return at - start;
}

static void drain_fifo(void) {
  uint32_t sent = gif_path_packets(3, fifo, FIFO_SIZE, 0, fifo_used);
  __builtin_memmove(fifo, fifo + sent, fifo_used - sent);
  fifo_used -= sent;
}

uint32_t gif_receive(uint32_t address, uint32_t qwc, int tag) {
  const uint8_t *memory = address & 0x80000000 ? ps2_scratchpad() : ps2_memory();
  uint32_t size = address & 0x80000000 ? PS2_SCRATCHPAD_SIZE : PS2_RAM_SIZE;
  uint32_t at = address & (size - 1), start = at, end = at + qwc * 16;
  // a tag sent with TTE is nothing to the GIF
  if (tag) at += 16;
  int free = !active || active == 3;
  if (free && fifo_used) drain_fifo();
  if (fifo_used) return 0;
  if (!free) {
    // the GIF is busy with another path: what fits waits in the FIFO
    if (end - at + fifo_used > FIFO_SIZE) return 0;
    __builtin_memcpy(fifo + fifo_used, memory + at, end - at);
    fifo_used += end - at;
    return qwc;
  }
  at += gif_path_packets(3, memory, size, at, end);
  return (at - start) / 16;
}

int gif_active_path(void) { return active; }

void gif_mask_path3(int mask) {
  int unmasking = masked && !mask;
  masked = mask;
  // as PATH3 is let through, the GIF's DMA goes on at once, for one packet
  if (unmasking) {
    let_through = PATH3_LETTING_ONE;
    dmac_resume_channel(2);
    let_through = PATH3_FREE;
  }
}

uint32_t gif_read(uint32_t address) {
  if (address != GIF_STAT) return address == GIF_MODE ? (uint32_t)mode : 0;
  uint32_t stat = (mode & MODE_M3R ? STAT_M3R : 0) | (uint32_t)active << 10 | (active ? STAT_OPH : 0);
  // masked, the GIF says its FIFO is full, as Play! does
  if (masked) stat |= STAT_M3P | 16u << 24;
  return stat;
}

void gif_write(uint32_t address, uint32_t value) {
  if (address >= GIF_FIFO && address < GIF_FIFO + 0x1000) {
    if (fifo_used == FIFO_SIZE) return;
    __builtin_memcpy(fifo + fifo_used, &value, 4);
    fifo_used += 4;
    if (fifo_used == 16) drain_fifo();
  } else if (address == GIF_MODE) {
    mode = (int)value;
  } else if (address == GIF_CTRL && (value & 1)) {
    // a reset ends whatever packet was being sent
    loops = 0, ends = 0, active = 0, q = ONE, fifo_used = 0, mode = 0;
  }
}

uint32_t gif_packet(const void *data, uint32_t most) { return gif_path_packet(1, data, most, 0, most); }

void gif_send(const void *data, uint32_t bytes) { gif_path_packets(3, data, bytes, 0, bytes & ~15u); }
