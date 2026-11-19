// The PlayStation 2's pads, as a game's own pad modules on the IOP reach them through the SIO2 (ps2.h), answered as the
// console's emulator, Play!, answers them, since that's what a Dreamport is proven against: a DualShock 2 in each of
// the two ports, which a module asks for its buttons, its sticks and the pressure on its buttons, sets to digital,
// analog or pressure mode, and asks what it is, and no multitap and no memory card behind it. Play! is given the
// buttons each frame by the tools as bits, the sticks all the way over or not at all, and says each button is pressed
// all the way or not at all, so the kit does too, from the buttons each frame holds (ps2.c).
//
// Followed from Play! (https://github.com/jpd002/Play-), Copyright (c) 2006-2026, Jean-Philip Desjardins, under the
// BSD licence whose conditions and disclaimer kit/ps2/c/spu2.c carries in full.

#include "ps2-kit.h"

#define PADS 2
#define ID_DIGITAL 0x41
#define ID_ANALOG 0x73
#define ID_ANALOG_PRESSURE 0x79
#define ID_CONFIG 0xF3

// what a DualShock 2 says of itself: its model and its modes and actuators
static const uint8_t model[6] = { 0x03, 0x02, 0x00, 0x02, 0x01, 0x00 };
static const uint8_t ids[5][5] = {
  { 0x00, 0x01, 0x02, 0x00, 0x0A }, { 0x00, 0x01, 0x01, 0x01, 0x14 }, { 0x00, 0x02, 0x00, 0x01, 0x00 },
  { 0x00, 0x00, 0x04, 0x00, 0x00 }, { 0x00, 0x00, 0x07, 0x00, 0x00 },
};

typedef struct {
  uint8_t config, mode, poll_mask[3];
  uint16_t buttons;          // a bit each, 0 when held, in Play!'s order
  uint8_t sticks[4];         // right x and y, then left x and y
  uint8_t small_motor, large_motor;
} pad;
static pad pads[PADS];

static uint32_t regs[16], ctrl1[4], ctrl2[4], stat6c, current;
// what's been sent and what waits to be read
static uint8_t in[1024], out[2048];
static uint32_t in_size, out_from, out_size;

void pad_power(void) {
  for (int i = 0; i < PADS; i++) {
    pad *p = &pads[i];
    __builtin_memset(p, 0, sizeof *p);
    p->buttons = 0xFFFF;
    p->mode = ID_ANALOG;
    p->poll_mask[0] = p->poll_mask[1] = 0xFF;
    p->poll_mask[2] = 0x03;
    __builtin_memset(p->sticks, 0x7F, 4);
  }
}

// The frame's buttons, in kit/consoles.js's order (console.h), as Play! gets them from the tools: its own bit for each
// button, and the left stick's byte for each way it's pushed all the way, as Play! turns libretro's 32767 into one
void pad_hold(uint32_t held) {
  static const struct { uint32_t button; uint16_t mask; } map[] = {
    { BUTTON_UP, 0x1000 }, { BUTTON_DOWN, 0x4000 }, { BUTTON_LEFT, 0x8000 }, { BUTTON_RIGHT, 0x2000 },
    { BUTTON_SELECT, 0x0100 }, { BUTTON_START, 0x0800 }, { BUTTON_SQUARE, 0x0080 }, { BUTTON_TRIANGLE, 0x0010 },
    { BUTTON_CIRCLE, 0x0020 }, { BUTTON_CROSS, 0x0040 }, { BUTTON_L1, 0x0004 }, { BUTTON_L2, 0x0001 },
    { BUTTON_L3, 0x0200 }, { BUTTON_R1, 0x0008 }, { BUTTON_R2, 0x0002 }, { BUTTON_R3, 0x0400 },
  };
  pad *p = &pads[0];
  p->buttons = 0xFFFF;
  for (unsigned i = 0; i < sizeof map / sizeof map[0]; i++) if (held & map[i].button) p->buttons &= (uint16_t)~map[i].mask;
  // a stick pushed all the way one way is 0xFF, the other 0x00, and left alone 0x7F
  int x = (held & BUTTON_STICK_RIGHT ? 1 : 0) - (held & BUTTON_STICK_LEFT ? 1 : 0);
  int y = (held & BUTTON_STICK_DOWN ? 1 : 0) - (held & BUTTON_STICK_UP ? 1 : 0);
  p->sticks[2] = x > 0 ? 0xFF : x < 0 ? 0x00 : 0x7F;
  p->sticks[3] = y > 0 ? 0xFF : y < 0 ? 0x00 : 0x7F;
}

static void controller(unsigned port, uint32_t at, uint32_t to_size) {
  // a port with no pad leaves its answer as 0xFF
  if (port >= PADS) return;
  pad *p = &pads[port & 1];
  uint8_t *o = out + at;
  o[0] = 0xFF;
  o[1] = p->config ? ID_CONFIG : p->mode;
  o[2] = 0x5A;
  switch (in[1]) {
  case 0x40:
    o[3] = 0x00; o[4] = 0x00; o[5] = 0x02; o[6] = 0x00; o[7] = 0x00; o[8] = 0x5A;
    break;
  case 0x41:
    if (p->mode == ID_DIGITAL) {
      for (int i = 3; i <= 8; i++) o[i] = 0x00;
    } else {
      o[3] = p->poll_mask[0]; o[4] = p->poll_mask[1]; o[5] = p->poll_mask[2]; o[6] = 0x00; o[7] = 0x00; o[8] = 0x5A;
    }
    break;
  case 0x42:
    o[3] = (uint8_t)(p->buttons >> 8);
    o[4] = (uint8_t)p->buttons;
    p->small_motor = in[3] & 0x01;
    p->large_motor = in[4];
    if (to_size >= 9) {
      for (int i = 0; i < 4; i++) o[5 + i] = p->sticks[i];
      if (to_size == 21) {
        // the pressure on each button, as Play! has it: all the way when held, none when not
        static const uint16_t pressed[12] = { 0x2000, 0x8000, 0x1000, 0x4000, 0x0010, 0x0020, 0x0040, 0x0080, 0x0004, 0x0008, 0x0001, 0x0002 };
        for (int i = 0; i < 12; i++) o[9 + i] = (p->buttons & pressed[i]) == 0 ? 0xFF : 0x00;
      }
    }
    break;
  case 0x43:
    p->config = in[3] == 0x01;
    break;
  case 0x44:
    o[3] = 0x00; o[4] = 0x00;
    if (to_size == 9) for (int i = 5; i <= 8; i++) o[i] = 0x00;
    p->mode = in[3] == 0x01 ? ID_ANALOG : ID_DIGITAL;
    break;
  case 0x45:
    for (int i = 0; i < 6; i++) o[3 + i] = model[i];
    o[5] = p->mode == ID_DIGITAL ? 0x00 : 0x01;
    break;
  case 0x46:
    for (int i = 0; i < 5; i++) o[4 + i] = ids[in[3] == 0x00 ? 0 : 1][i];
    break;
  case 0x47:
    for (int i = 0; i < 5; i++) o[4 + i] = ids[2][i];
    break;
  case 0x4C:
    for (int i = 0; i < 5; i++) o[4 + i] = ids[in[3] == 0x00 ? 3 : 4][i];
    break;
  case 0x4F:
    p->mode = ID_ANALOG_PRESSURE;
    o[3] = 0x00; o[4] = 0x00; o[5] = 0x00; o[6] = 0x00; o[7] = 0x00; o[8] = 0x5A;
    p->poll_mask[0] = in[3];
    p->poll_mask[1] = in[4];
    p->poll_mask[2] = in[5];
    break;
  }
}

// a multitap Play! says isn't there, so a game finds none
static void multitap(uint32_t at) {
  stat6c = 0x10000;
  if (in[1] == 0x12 || in[1] == 0x13) out[at + 3] = 1;
  else if (in[1] == 0x21 || in[1] == 0x22) out[at + 5] = 0;
}

// a memory card on the SIO2, as Play! answers it, which its own memory card server stands in front of: it says it's
// there and what size it is, takes what's written and reads back 0xCC
static uint8_t termination = 0x55;
static uint32_t page;
static uint8_t check(uint32_t from, uint32_t size) {
  uint8_t sum = 0;
  for (uint32_t i = 0; i < size; i++) sum ^= out[from + i];
  return sum;
}
static void memory_card(uint32_t at) {
  uint8_t *o = out + at;
  switch (in[1]) {
  case 0x11: case 0x12: case 0x81: case 0x82: o[3] = termination; break;
  case 0x21: case 0x22: o[8] = termination; break;
  case 0x23:
    page = (uint32_t)in[3] << 8 | in[2];
    o[8] = termination;
    break;
  case 0x26:
    o[2] = 0; o[3] = 0x00; o[4] = 0x02; o[5] = 0; o[6] = 0x20; o[7] = 0; o[8] = 0; o[9] = 0x80; o[10] = 0;
    o[11] = check(at + 3, 8);
    o[12] = termination;
    break;
  case 0x27:
    termination = in[2];
    o[4] = termination;
    break;
  case 0x28: o[4] = 0x66; break;
  case 0x42: o[in[2] + 5] = termination; break;
  case 0x43: {
    uint8_t count = in[2];
    for (uint32_t i = 0; i < count; i++) o[4 + i] = 0xCC;
    page++;
    o[4 + count] = check(at + 4, count);
    o[4 + count + 1] = termination;
    break;
  }
  case 0xBF: o[4] = termination; break;
  case 0xF3: o[3] = 0x2B; break;
  }
}

// a command, once all its bytes are in: the next of the registers says its port and how many bytes go each way
static void command(void) {
  uint32_t reg = regs[current & 15], from_size = (reg >> 8) & 0x1FF, to_size = (reg >> 18) & 0x1FF;
  if (in_size < from_size) return;
  unsigned port = reg & 3;
  uint32_t device = ctrl2[port], at = out_size;
  stat6c = 0;
  if (out_size + to_size > sizeof out) __builtin_trap();
  for (uint32_t i = 0; i < to_size; i++) out[out_size++] = 0xFF;
  if (device == 0x00030064) multitap(at);
  else if (device == 0x5FFFF) memory_card(at);
  else controller(port, at, to_size);
  in_size = 0;
  current++;
}
static void take(uint8_t byte) {
  if (in_size < sizeof in) in[in_size++] = byte;
  command();
}
static uint8_t give(void) {
  if (out_from == out_size) return 0;
  uint8_t byte = out[out_from++];
  if (out_from == out_size) out_from = out_size = 0;
  return byte;
}

void sio2_write(uint32_t address, uint32_t value) {
  if (address >= 0x1F808200 && address <= 0x1F80823F) regs[(address - 0x1F808200) / 4] = value;
  else if (address >= 0x1F808240 && address <= 0x1F80825C) {
    unsigned port = (address - 0x1F808240) / 8;
    if (address & 4) ctrl2[port] = value;
    else ctrl1[port] = value;
  } else if (address == 0x1F808268) {
    if (value == 0x0C) current = 0;
  } else if (address == 0x1F808260) take((uint8_t)value);
}
uint32_t sio2_read(uint32_t address) {
  if (address == 0x1F808264) return give();
  if (address == 0x1F80826C) return stat6c;
  return 0;
}
// DMA channel 11 sends the SIO2 its commands, a block each, and channel 12 brings back their answers
uint32_t sio2_dma_in(uint8_t *buffer, uint32_t block_size, uint32_t blocks) {
  for (uint32_t i = 0; i < blocks; i++, buffer += block_size) for (uint32_t j = 0; j < block_size; j++) {
    if (in_size < sizeof in) in[in_size++] = buffer[j];
    if (j == block_size - 1) command();
  }
  return blocks;
}
uint32_t sio2_dma_out(uint8_t *buffer, uint32_t block_size, uint32_t blocks) {
  for (uint32_t i = 0; i < blocks; i++, buffer += block_size) {
    uint32_t to_size = (regs[i & 15] >> 18) & 0x1FF;
    for (uint32_t j = 0; j < to_size; j++) buffer[j] = give();
  }
  return blocks;
}
