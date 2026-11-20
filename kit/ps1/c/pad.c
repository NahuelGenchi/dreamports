// The PlayStation's pads, as a game reads them: through the serial port the pads and memory cards share, SIO0, a byte
// at a time, the game sending a byte and the pad sending one back. In the first port is the player's pad, a digital
// one, as the tools' emulator plugs in, a "standard controller" that PCSX ReARMed answers as a DualShock in its digital
// mode does, L3 and R3 too; in the second, a pad with nothing held. No memory card is plugged in yet, so a game that
// asks for one hears nothing back (kit/ps1/c/README.md).
//
// A pad answers the console's read, 0x01 and then 0x42, with its kind, 0x41, 0x5A, and the 16 bits of its buttons,
// low byte first, a bit clear for each button held: SELECT, L3, R3, START, UP, RIGHT, DOWN, LEFT, L2, R2, L1, R1,
// TRIANGLE, CIRCLE, CROSS and SQUARE, from the lowest. Taking 0x43 for 0x42, as the emulator does, it answers that the
// same way.

#include "ps1-kit.h"

// the port's registers, as the processor sees them
enum { SIO_DATA = 0x1F801040, SIO_STAT = 0x1F801044, SIO_MODE = 0x1F801048, SIO_CTRL = 0x1F80104A, SIO_BAUD = 0x1F80104E };
// what the port's status says: ready to send, something received, sent, and the pad's answer that it has more
enum { STAT_TX_READY = 1, STAT_RX_READY = 2, STAT_TX_DONE = 4, STAT_IRQ = 0x200 };
// what its control says: sending on, the port selected, the interrupt acknowledged, the port reset, the interrupt on
// each answer, and the second port
enum { CTRL_TX = 1, CTRL_SELECT = 2, CTRL_ACK = 0x10, CTRL_RESET = 0x40, CTRL_ACK_IRQ = 0x1000, CTRL_PORT2 = 0x2000 };

static uint32_t held;
static struct {
  uint16_t mode, ctrl, baud, stat;
  uint8_t received;
  // how far into the pad's answer the exchange is, or -1 when nothing answers the rest of it
  int at;
} sio;

void pad_power(void) {
  held = 0;
  sio.mode = sio.ctrl = sio.baud = 0;
  sio.stat = STAT_TX_READY | STAT_TX_DONE;
  sio.at = 0;
}

void pad_hold(uint32_t buttons) { held = buttons; }

uint16_t pad_buttons(int port) {
  if (port != 0) return 0xFFFF;
  // console.h's bit for each of the pad's, from its lowest
  static const uint32_t bits[16] = {
    BUTTON_SELECT, BUTTON_L3, BUTTON_R3, BUTTON_START, BUTTON_UP, BUTTON_RIGHT, BUTTON_DOWN, BUTTON_LEFT,
    BUTTON_L2, BUTTON_R2, BUTTON_L1, BUTTON_R1, BUTTON_TRIANGLE, BUTTON_CIRCLE, BUTTON_CROSS, BUTTON_SQUARE,
  };
  uint16_t word = 0xFFFF;
  for (int bit = 0; bit < 16; bit++) if (held & bits[bit]) word &= (uint16_t)~(1u << bit);
  return word;
}

// the byte the selected port sends back for `sent`, and whether the pad says it has more
static uint8_t exchange(uint8_t sent, int *more) {
  *more = 0;
  if (sio.at < 0) return 0xFF;
  int at = sio.at++;
  uint16_t buttons = pad_buttons(sio.ctrl & CTRL_PORT2 ? 1 : 0);
  switch (at) {
    // the first byte says who's asked: 0x01 a pad, which says it's there; anything else, a memory card, is no one
    case 0: if (sent != 0x01) { sio.at = -1; return 0xFF; } *more = 1; return 0xFF;
    case 1: if (sent != 0x42 && sent != 0x43) { sio.at = -1; return 0xFF; } *more = 1; return 0x41;
    case 2: *more = 1; return 0x5A;
    case 3: *more = 1; return (uint8_t)buttons;
    case 4: return (uint8_t)(buttons >> 8);
    default: sio.at = -1; return 0xFF;
  }
}

void sio_write(uint32_t address, uint32_t value) {
  switch (address) {
    case SIO_DATA: {
      int more = 0;
      sio.received = sio.ctrl & CTRL_SELECT && sio.ctrl & CTRL_TX ? exchange((uint8_t)value, &more) : 0xFF;
      sio.stat |= STAT_RX_READY;
      if (more && sio.ctrl & CTRL_ACK_IRQ) sio.stat |= STAT_IRQ;
      break;
    }
    case SIO_MODE: sio.mode = (uint16_t)(value & 0x013F); break;
    case SIO_CTRL:
      if (value & CTRL_ACK) sio.stat &= (uint16_t)~STAT_IRQ;
      // a port reset, or one no longer selected, ends what it was saying
      if (value & CTRL_RESET || !(value & CTRL_SELECT)) {
        sio.at = 0;
        sio.stat = STAT_TX_READY | STAT_TX_DONE;
      }
      sio.ctrl = (uint16_t)(value & 0x3F2F);
      break;
    case SIO_BAUD: sio.baud = (uint16_t)value; break;
    default: break;
  }
}

uint32_t sio_read(uint32_t address) {
  switch (address) {
    case SIO_DATA:
      sio.stat &= (uint16_t)~STAT_RX_READY;
      return sio.received;
    case SIO_STAT: return sio.stat;
    case SIO_MODE: return sio.mode;
    case SIO_CTRL: return sio.ctrl;
    case SIO_BAUD: return sio.baud;
    default: return 0;
  }
}
