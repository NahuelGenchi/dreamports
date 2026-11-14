// The GIF: what turns a packet, as a game or a program on a vector unit builds one, into the GS's register writes
// (ps2.h), the way the console's does, so a Dreamport that builds its original's packets has its original's draw list.
// A packet is a run of tags, each saying how its data is laid out and how many times, to the one that ends it.
//
// PACKED data has a register in each 128 bits, in the shape the register's kind takes it; REGLIST has one in each 64, as
// it is; IMAGE is a picture's data. A write to SIGNAL that the GS hasn't yet been asked about holds the console's GIF up,
// which doesn't happen here.

#include "ps2-kit.h"

static uint32_t word(const uint8_t *at, int index) {
  uint32_t value;
  __builtin_memcpy(&value, at + index * 4, 4);
  return value;
}
static uint64_t half(const uint8_t *at, int index) { return word(at, index * 2) | (uint64_t)word(at, index * 2 + 1) << 32; }

// one register's 128 bits of PACKED data, as its kind lays it out. `q` is the Q the last ST gave, which RGBA's write has
static void packed(uint32_t kind, const uint8_t *at, uint32_t *q) {
  uint32_t v0 = word(at, 0), v1 = word(at, 1), v2 = word(at, 2), v3 = word(at, 3);
  switch (kind) {
  case 0x0: gs_write(GS_PRIM, v0); break;
  case 0x1: gs_write(GS_RGBAQ, (uint64_t)((v0 & 0xFF) | (v1 & 0xFF) << 8 | (v2 & 0xFF) << 16 | (v3 & 0xFF) << 24) | (uint64_t)*q << 32); break;
  case 0x2: *q = v2; gs_write(GS_ST, half(at, 0)); break;
  case 0x3: gs_write(GS_UV, (v0 & 0x7FFF) | (v1 & 0x7FFF) << 16); break;
  // a corner with its fog, and one without: the fourth word's bit 15 says it's written without drawing
  case 0x4: gs_write(v3 & 0x8000 ? GS_XYZF3 : GS_XYZF2, (uint64_t)((v0 & 0xFFFF) | (v1 & 0xFFFF) << 16) | (uint64_t)(v2 & 0x0FFFFFF0) << 28 | (uint64_t)(v3 & 0xFF0) << 52); break;
  case 0x5: gs_write(v3 & 0x8000 ? GS_XYZ3 : GS_XYZ2, (uint64_t)((v0 & 0xFFFF) | (v1 & 0xFFFF) << 16) | (uint64_t)v2 << 32); break;
  case 0x6: case 0x7: case 0x8: case 0x9: case 0xD: gs_write((uint8_t)kind, half(at, 0)); break;
  case 0xA: gs_write(GS_FOG, (half(at, 1) >> 36) << 56); break;
  // a register's number with its 64 bits
  case 0xE: gs_write((uint8_t)half(at, 1), half(at, 0)); break;
  default: break;
  }
}

// one tag and its data, `left` bytes of it at most: how many bytes it took, and whether it ends its packet
static uint32_t tagged(const uint8_t *at, uint32_t left, int *ends) {
  uint32_t first = word(at, 0), second = word(at, 1), loops = first & 0x7FFF, kind = second >> 26 & 3, count = second >> 28 ? second >> 28 : 16;
  uint64_t list = half(at, 1);
  uint32_t used = 16, q = 0x3F800000;
  *ends = first >> 15 & 1;
  if (kind != 1 && second >> 14 & 1) gs_write(GS_PRIM, second >> 15 & 0x7FF);
  if (kind >= 2) {
    uint32_t bytes = loops * 16 < left - used ? loops * 16 : left - used;
    if (bytes) gs_image(at + used, bytes);
    return used + bytes;
  }
  uint32_t size = kind ? 8 : 16;
  for (uint32_t loop = 0; loop < loops; loop++) {
    for (uint32_t i = 0; i < count && used + size <= left; i++, used += size) {
      uint32_t reg = (uint32_t)(list >> (i * 4)) & 0xF;
      if (!kind) packed(reg, at + used, &q);
      else if (reg != 0xF) gs_write((uint8_t)reg, half(at + used, 0));
    }
  }
  // a list of an odd number of registers is filled out to 128 bits
  return (used + 15) & ~15u;
}

uint32_t gif_packet(const void *data, uint32_t most) {
  uint32_t used = 0;
  for (int ends = 0; !ends && used + 16 <= most;) used += tagged((const uint8_t *)data + used, most - used, &ends);
  return used;
}

void gif_send(const void *data, uint32_t bytes) {
  for (uint32_t used = 0; used + 16 <= bytes;) {
    int ends;
    used += tagged((const uint8_t *)data + used, bytes - used, &ends);
  }
}
