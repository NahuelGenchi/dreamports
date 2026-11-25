// The GameCube's serial interface, which talks to the controllers, as Dolphin, the console's reference in the proof
// tools, answers for a standard controller in the first port through its libretro front. The reference polls every
// port from the start of each field on, whatever the game asks for, so a game reads in a frame the buttons the tools
// hold in it. A standard controller answers in two words, in the mode the reference starts it in:
//
//   the first   its buttons and 0x0080, which says it was centred as it started, then the main stick across and down
//   the second  the C stick across and down, then the left trigger and the right one
//
// A stick is all the way over in each direction a recording holds, 0x01 or 0xFF either side of 0x80, on both of its
// axes for a diagonal, and a trigger is at 0xFF when it's pressed to its click, its button's bit with it, or short of
// it, without. That's what the reference gives for each of the only presses a recording can hold.
//
// The other three ports, a command sent with the communication register, and the interrupts aren't here yet.

#include "gamecube-kit.h"

static uint32_t out[4], poll, com_csr, status;
static uint32_t held;

void si_power(void) {
  for (int i = 0; i < 4; i++) out[i] = 0;
  poll = com_csr = status = 0;
  held = 0;
}

void si_buttons(uint32_t buttons) { held = buttons; }

// a stick's axis: all the way one way or the other, or in the middle
static uint32_t axis(uint32_t less, uint32_t more) {
  int value = 0x80 + (held & more ? 0x7F : 0) - (held & less ? 0x7F : 0);
  return (uint32_t)value;
}

static uint32_t first_word(void) {
  static const struct { uint32_t button, bit; } map[] = {
    { BUTTON_A, 0x0100 }, { BUTTON_B, 0x0200 }, { BUTTON_X, 0x0400 }, { BUTTON_Y, 0x0800 }, { BUTTON_Z, 0x0010 },
    { BUTTON_L, 0x0040 }, { BUTTON_R, 0x0020 }, { BUTTON_START, 0x1000 },
    { BUTTON_UP, 0x0008 }, { BUTTON_DOWN, 0x0004 }, { BUTTON_LEFT, 0x0001 }, { BUTTON_RIGHT, 0x0002 },
  };
  uint32_t bits = 0x0080;
  for (unsigned i = 0; i < sizeof map / sizeof map[0]; i++) if (held & map[i].button) bits |= map[i].bit;
  return bits << 16 | axis(BUTTON_STICK_LEFT, BUTTON_STICK_RIGHT) << 8 | axis(BUTTON_STICK_DOWN, BUTTON_STICK_UP);
}

static uint32_t second_word(void) {
  uint32_t left = held & (BUTTON_L | BUTTON_L_ANALOG) ? 0xFF : 0, right = held & (BUTTON_R | BUTTON_R_ANALOG) ? 0xFF : 0;
  return axis(BUTTON_C_LEFT, BUTTON_C_RIGHT) << 24 | axis(BUTTON_C_DOWN, BUTTON_C_UP) << 16 | left << 8 | right;
}

uint32_t si_read(uint32_t reg) {
  reg &= 0xFC;
  if (reg == 0x04) return first_word();
  if (reg == 0x08) return second_word();
  if (reg < 0x30 && reg % 12 == 0) return out[reg / 12];
  if (reg == 0x30) return poll;
  if (reg == 0x34) return com_csr;
  if (reg == 0x38) return status;
  return 0;
}

void si_write(uint32_t reg, uint32_t value) {
  reg &= 0xFC;
  if (reg < 0x30 && reg % 12 == 0) out[reg / 12] = value;
  else if (reg == 0x30) poll = value;
}
