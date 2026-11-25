// The Game Boy's part of what the page calls, by name, to run a game in C (kit/c/game.js as WebAssembly, kit/c/native.c
// on a computer), and the console around its processor: the memory's map with the cartridge's banks, the buttons, the
// timer, the interrupts and the time. The screen is lcd.c and the sound apu.c. The copy, the save memory, the start
// point's words and memory are what every console's kit in C shares (kit/c/kit.c).
//
// Time is the processor's cycles from power-on, counted from where the console's reference emulator starts its count,
// as the timer's and the sound's steps fall where that count's low bits say. A frame is what the emulator plays in one
// go: up to when a picture is complete, as its V-blank starts, or, with the screen off, a picture's time after the last.

#include "gb.h"
#include "gb-kit.h"
#include "page.h"

#define NEVER UINT64_MAX

uint8_t gb_wram[0x8000];
uint8_t gb_hram[0x7F];
uint8_t gb_vram[0x4000];
uint8_t gb_oam[0xA0];
const uint8_t *gb_rom;
uint32_t gb_rom_size;
uint8_t *gb_sram;
uint32_t gb_sram_size;
int gb_colour;
uint8_t gb_requested;

// the hardware's registers as the processor reads them back, $FF00-$FF7F, and what the console's own start-up leaves
// in them on a Game Boy and on a Game Boy Color
static uint8_t io[0x80];
static const uint8_t IO_GB[0x80] = {
  0xCF, 0x00, 0x7E, 0xFF, 0x1C, 0x00, 0x00, 0xF8, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xE1,
  0x80, 0xBF, 0xF3, 0xFF, 0xBF, 0xFF, 0x3F, 0x00, 0xFF, 0xBF, 0x7F, 0xFF, 0x9F, 0xFF, 0xBF, 0xFF,
  0xFF, 0x00, 0x00, 0xBF, 0x77, 0xF3, 0xF1, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  0x71, 0x72, 0xD5, 0x91, 0x58, 0xBB, 0x2A, 0xFA, 0xCF, 0x3C, 0x54, 0x75, 0x48, 0xCF, 0x8F, 0xD9,
  0x91, 0x80, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFC, 0xFF, 0xFF, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF,
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
};
static const uint8_t IO_GBC[0x80] = {
  0xCF, 0x00, 0x7C, 0xFF, 0x1C, 0x00, 0x00, 0xF8, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xE1,
  0x80, 0xBF, 0xF3, 0xFF, 0xBF, 0xFF, 0x3F, 0x00, 0xFF, 0xBF, 0x7F, 0xFF, 0x9F, 0xFF, 0xBF, 0xFF,
  0xFF, 0x00, 0x00, 0xBF, 0x77, 0xF3, 0xF1, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF,
  0x91, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFC, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7E, 0xFF, 0xFE,
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x3E, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
  0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xC0, 0xFF, 0xC1, 0x00, 0xFE, 0xFF, 0xFF, 0xFF,
  0xF8, 0xFF, 0x00, 0x00, 0x00, 0x8F, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
};

static uint64_t now;
static uint8_t enabled;                 // $FFFF
static uint32_t held;

// the cartridge's chip
enum { PLAIN, MBC1, MBC3, MBC5 };
static int chip, battery, sram_open, mbc1_mode;
static uint32_t rom_bank, sram_bank, rom_banks, sram_banks, low_bits, high_bits;
static uint8_t *saved;
static int wram_bank = 1, vram_bank;

// frames: the pictures completed since power-on, the first of which ends the emulator's first frame, which nothing is
// compared with, and how many frames have been stepped. A call of the game's that runs on past its frame's end has run
// the next ones too, and the page gets each of their pictures in turn: the last few are kept, with how much sound had
// been made as each was completed.
static uint64_t blit_time;
static int blank_next;
static uint32_t ended, stepped;
#define KEPT 8
static uint32_t *kept;
static uint64_t sound_then[KEPT];

// the processor's HALT, waiting, and the cycle's low bits it started at, which its waking keeps
static int halted;
static uint64_t halt_phase;

// the timer: when its count last stepped, when it's next loaded from TMA after running over, and when it next asks
static uint64_t timer_last, timer_loads = NEVER, timer_asks = NEVER, divider_from;
static uint8_t tima, tma, tac = 0xF8, divider;
static const uint8_t TIMER_SHIFT[4] = { 10, 4, 6, 8 };
static uint64_t serial_ends = NEVER;

// A picture is complete. The emulator's frame, and the sound it holds, ends where the processor stops once it is:
// at the end of the instruction it's in, or, waiting in HALT, on its own four-cycle step, `stop`. Only the first
// frame's end is heard, as what's before it is left out.
static void present(uint64_t stop) {
  gb_lcd_run_to(blit_time);
  gb_lcd_present(blank_next);
  gb_lcd_draw(kept + (size_t)(ended % KEPT) * SCREEN_W * SCREEN_H);
  gb_apu_run_to(stop);
  sound_then[ended % KEPT] = gb_apu_total();
  ended++;
}

// the longest instruction, so a time a game spends up to that far past a picture's end is the end of the instruction
// the processor was in
#define LONGEST 24
// the cycles of an interrupt the processor takes before the frame ends, when it's waiting as the picture is complete
static uint64_t taken_too;

// the console on to `to`, through each picture that completes on the way
static void advance(uint64_t to) {
  while (blit_time <= to) {
    int on = gb_lcd_on();
    if (on || blank_next) present(to - blit_time <= LONGEST ? to + taken_too : blit_time);
    blank_next = !on;
    blit_time += GB_FRAME;
  }
  now = to;
}

static void timer_count(void) {
  if (!(tac & 4)) return;
  unsigned shift = TIMER_SHIFT[tac & 3];
  uint64_t steps = (now - timer_last) >> shift;
  timer_last += steps << shift;
  if (now >= timer_loads) {
    if (now >= timer_loads + 4) timer_loads = NEVER;
    tima = tma;
  }
  uint64_t count = tima + steps;
  while (count > 0x100) count -= 0x100u - tma;
  if (count == 0x100) {
    // run over: it reads 0 for the three cycles before TMA is loaded
    count = 0;
    timer_loads = timer_last + 3;
    if (now >= timer_loads) {
      if (now >= timer_loads + 4) timer_loads = NEVER;
      count = tma;
    }
  }
  tima = (uint8_t)count;
}

// every interrupt the hardware asks for up to now
static void requests(void) {
  gb_lcd_request_to(now);
  if (tac & 4) {
    while (timer_asks <= now) {
      gb_requested |= GB_TIMER;
      timer_asks += (uint64_t)(0x100u - tma) << TIMER_SHIFT[tac & 3];
    }
  }
  if (serial_ends <= now) {
    serial_ends = NEVER;
    io[0x01] = 0xFF;
    io[0x02] &= 0x7F;
    gb_requested |= GB_SERIAL;
  }
}

static int waiting(void) { return gb_requested & enabled & 0x1F; }

static int take(void) {
  int bit = waiting() & -waiting();
  gb_requested = (uint8_t)(gb_requested & ~bit);
  advance(now + 20);
  return bit;
}

int gb_interrupt(void) {
  if (gb_frame_ended()) return -1;
  requests();
  return waiting() ? take() : 0;
}

int gb_halt(void) {
  if (!halted) {
    advance(now + 4);
    halted = 1;
    halt_phase = now & 3;
  }
  for (;;) {
    if (gb_frame_ended()) return 0;
    requests();
    if (waiting()) break;
    uint64_t soon = gb_lcd_next_request(now);
    if ((tac & 4) && timer_asks < soon) soon = timer_asks;
    if (serial_ends < soon) soon = serial_ends;
    if (blit_time <= soon) {
      // The picture ends while it waits, and the processor stops on its own four-cycle step after it. The emulator
      // handles every event due by then before its frame ends, so an interrupt asked for by then, as V-blank's is
      // with the picture, is taken within the frame, and its sound with it.
      uint64_t at = blit_time + ((halt_phase - blit_time) & 3), was = now;
      now = at;
      requests();
      now = was;
      taken_too = waiting() ? (gb_colour ? 4 : 0) + 20 : 0;
      advance(at);
      taken_too = 0;
      continue;
    }
    // the processor wakes on its own four-cycle step
    advance(soon + ((halt_phase - soon) & 3));
  }
  halted = 0;
  if (gb_colour) advance(now + 4);
  return take();
}

int gb_frame_ended(void) { return ended > stepped; }

void gb_spend(int cycles) {
  if (cycles > 0) advance(now + (uint64_t)cycles);
}
uint64_t gb_now(void) { return now; }
int gb_frame(void) { return (int)ended - 1; }
uint32_t gb_buttons(void) { return held; }

void gb_sram_write(void) {
  if (!saved) return;
  for (uint32_t i = 0; i < gb_sram_size; i++) saved[i] = gb_sram[i];
  kit_save_write();
}

// the buttons' register: the two halves the game chooses between, a 0 for each button held
static void buttons_read(void) {
  uint8_t lines = 0x0F;
  if (!(io[0x00] & 0x10)) {
    if (held & BUTTON_RIGHT) lines &= ~1;
    if (held & BUTTON_LEFT) lines &= ~2;
    if (held & BUTTON_UP) lines &= ~4;
    if (held & BUTTON_DOWN) lines &= ~8;
  }
  if (!(io[0x00] & 0x20)) {
    if (held & BUTTON_A) lines &= ~1;
    if (held & BUTTON_B) lines &= ~2;
    if (held & BUTTON_SELECT) lines &= ~4;
    if (held & BUTTON_START) lines &= ~8;
  }
  if (lines != 0x0F && (io[0x00] & 0x0F) == 0x0F) gb_requested |= GB_JOYPAD;
  io[0x00] = (uint8_t)((io[0x00] & 0xF0) | lines);
}

static uint32_t rom_at(uint32_t bank, uint16_t address) {
  return gb_rom_size ? (bank * 0x4000u + (address & 0x3FFF)) % gb_rom_size : 0;
}

// the cartridge's chip: what a write to $0000-$7FFF switches
static void chip_write(uint16_t address, uint8_t value) {
  if (chip == PLAIN) return;
  if (address < 0x2000) {
    sram_open = (value & 0x0F) == 0x0A;
    return;
  }
  if (chip == MBC5) {
    if (address < 0x3000) low_bits = value;
    else if (address < 0x4000) high_bits = value & 1;
    else if (address < 0x6000) sram_bank = value & 0x0F;
    rom_bank = high_bits << 8 | low_bits;
  } else if (chip == MBC3) {
    if (address < 0x4000) rom_bank = (value & 0x7F) ? value & 0x7F : 1;
    else if (address < 0x6000) sram_bank = value & 0x0F;
  } else {
    if (address < 0x4000) low_bits = (value & 0x1F) ? value & 0x1F : 1;
    else if (address < 0x6000) high_bits = value & 3;
    else mbc1_mode = value & 1;
    rom_bank = mbc1_mode ? low_bits : high_bits << 5 | low_bits;
    sram_bank = mbc1_mode ? high_bits : 0;
  }
  if (rom_banks) rom_bank %= rom_banks;
}

static uint8_t *sram_byte(uint16_t address) {
  if (!sram_open || !gb_sram_size || (chip == MBC3 && sram_bank > 3)) return NULL;
  return gb_sram + ((sram_banks ? sram_bank % sram_banks : 0) * 0x2000u + (address & 0x1FFF)) % gb_sram_size;
}

// a byte of the memory with nothing in the way, as the hardware's own copy to the sprites reads it
static uint8_t plain_read(uint16_t address) {
  if (address < 0x4000) return gb_rom_size ? gb_rom[rom_at(0, address)] : 0xFF;
  if (address < 0x8000) return gb_rom_size ? gb_rom[rom_at(rom_bank, address)] : 0xFF;
  if (address < 0xA000) return gb_vram[vram_bank * 0x2000 + (address & 0x1FFF)];
  if (address < 0xC000) {
    const uint8_t *byte = sram_byte(address);
    return byte ? *byte : 0xFF;
  }
  if (address < 0xFE00) return gb_wram[(address & 0x1000 ? wram_bank : 0) * 0x1000 + (address & 0x0FFF)];
  if (address < 0xFEA0) return gb_oam[address - 0xFE00];
  return 0xFF;
}

static uint8_t io_read(uint8_t reg) {
  switch (reg) {
    case 0x00:
      buttons_read();
      return io[0x00];
    case 0x04: return (uint8_t)(divider + ((now - divider_from) >> 8));
    case 0x05:
      timer_count();
      return tima;
    case 0x06: return tma;
    case 0x07: return tac;
    case 0x0F:
      requests();
      return (uint8_t)(0xE0 | gb_requested);
    case 0x26:
      gb_apu_run_to(now);
      return gb_apu_read(reg);
    case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x47: case 0x48: case 0x49: case 0x4A: case 0x4B:
    case 0x68: case 0x69: case 0x6A: case 0x6B:
      requests();
      return gb_lcd_read(reg, now);
  }
  if (reg >= 0x30 && reg < 0x40) {
    gb_apu_run_to(now);
    return gb_apu_read(reg);
  }
  return io[reg];
}

uint8_t gb_read(uint16_t address) {
  if (address < 0x8000) return plain_read(address);
  if (address < 0xA000) return gb_lcd_vram_open(now) ? plain_read(address) : 0xFF;
  if (address < 0xFE00) return plain_read(address);
  if (address < 0xFEA0) return gb_lcd_oam_open(now) ? gb_oam[address - 0xFE00] : 0xFF;
  if (address < 0xFF00) return 0xFF;
  if (address < 0xFF80) return io_read((uint8_t)address);
  if (address < 0xFFFF) return gb_hram[address - 0xFF80];
  return enabled;
}

// what a sound register reads back besides what was written: the bits it doesn't have, as ones
static const uint8_t SOUND_READS[0x16] = { 0x80, 0x3F, 0x00, 0xFF, 0xBF, 0xFF, 0x3F, 0x00, 0xFF, 0xBF, 0x7F, 0xFF, 0x9F, 0xFF, 0xBF, 0xFF, 0xFF, 0x00, 0x00, 0xBF, 0x00, 0x00 };

static void io_write(uint8_t reg, uint8_t value) {
  switch (reg) {
    case 0x00:
      io[0x00] = (uint8_t)((io[0x00] & ~0x30) | (value & 0x30));
      buttons_read();
      return;
    case 0x01: io[0x01] = value; return;
    case 0x02:
      // with its own clock and nobody at the other end, a byte of ones comes back 4,096 cycles on
      requests();
      serial_ends = (value & 0x81) == 0x81 ? (now & ~(uint64_t)0xFF) + 0x1000 : NEVER;
      io[0x02] = (uint8_t)(value | (gb_colour ? 0x7C : 0x7E));
      return;
    case 0x04:
      divider = 0;
      divider_from = now;
      return;
    case 0x05:
      if (tac & 4) {
        requests();
        timer_count();
        if (timer_loads - now < 4) timer_loads = NEVER;
        timer_asks = timer_last + ((uint64_t)(0x100u - value) << TIMER_SHIFT[tac & 3]) + 3;
      }
      tima = value;
      return;
    case 0x06:
      if (tac & 4) {
        requests();
        timer_count();
      }
      tma = value;
      return;
    case 0x07:
      value |= 0xF8;
      if (tac == value) return;
      if (tac & 4) {
        // switching it off, or to another rate, can step the count once more, as the console's own counter falls
        requests();
        timer_count();
        uint64_t half = ((uint64_t)1 << (TIMER_SHIFT[tac & 3] - 1)) + 3;
        timer_last -= half;
        if (timer_loads != NEVER) timer_loads -= half;
        if (now >= timer_asks - half) gb_requested |= GB_TIMER;
        timer_count();
        timer_loads = NEVER;
        timer_asks = NEVER;
      }
      if (value & 4) {
        unsigned shift = TIMER_SHIFT[value & 3];
        timer_last = (now >> shift) << shift;
        timer_asks = timer_last + ((uint64_t)(0x100u - tima) << shift) + 3;
      }
      tac = value;
      return;
    case 0x0F:
      requests();
      gb_requested = value & 0x1F;
      return;
    case 0x46: {
      // the hardware copies a page of memory to the sprites
      gb_lcd_request_to(now);
      gb_lcd_run_to(now);
      uint16_t from = (uint16_t)(value << 8);
      for (int i = 0; i < 0xA0; i++) gb_oam[i] = plain_read((uint16_t)(from + i));
      io[0x46] = value;
      return;
    }
    case 0x4D:
      if (gb_colour) io[0x4D] = (uint8_t)((io[0x4D] & ~1) | (value & 1));
      return;
    case 0x4F:
      if (gb_colour) {
        vram_bank = value & 1;
        io[0x4F] = (uint8_t)(0xFE | value);
      }
      return;
    case 0x70:
      if (gb_colour) {
        wram_bank = (value & 7) ? value & 7 : 1;
        io[0x70] = (uint8_t)(value | 0xF8);
      }
      return;
  }
  if (reg >= 0x10 && reg < 0x40) {
    gb_apu_run_to(now);
    int was = gb_apu_powered();
    gb_apu_write(reg, value);
    if (reg == 0x26) {
      // switched off, every register reads as if 0 had been written to it
      if (was && !gb_apu_powered()) for (int r = 0x10; r < 0x26; r++) if (SOUND_READS[r - 0x10] != 0xFF) io[r] = SOUND_READS[r - 0x10];
      return;
    }
    if (reg < 0x26) {
      if (!was && !(reg == 0x11 || reg == 0x16) ) return;
      if (!was && gb_colour) return;
      if (SOUND_READS[reg - 0x10] != 0xFF) io[reg] = (uint8_t)((was ? value : value & 0x3F) | SOUND_READS[reg - 0x10]);
    }
    return;
  }
  if ((reg >= 0x40 && reg <= 0x4B) || (reg >= 0x68 && reg <= 0x6B)) {
    int was_on = gb_lcd_on();
    gb_lcd_write(reg, value, now);
    if (reg == 0x40 && was_on != gb_lcd_on()) {
      // the next picture the page gets: the first whole one with the screen on, a blank one meanwhile
      if (gb_lcd_on()) blit_time = gb_lcd_vblank() + (blank_next ? 0 : GB_FRAME);
      else blit_time = now + 4 * GB_LINE;
    }
    return;
  }
}

void gb_write(uint16_t address, uint8_t value) {
  if (address < 0x8000) chip_write(address, value);
  else if (address < 0xA000) {
    if (!gb_lcd_vram_open(now)) return;
    gb_lcd_request_to(now);
    gb_lcd_run_to(now);
    gb_vram[vram_bank * 0x2000 + (address & 0x1FFF)] = value;
  } else if (address < 0xC000) {
    uint8_t *byte = sram_byte(address);
    if (byte) *byte = value;
  } else if (address < 0xFE00) gb_wram[(address & 0x1000 ? wram_bank : 0) * 0x1000 + (address & 0x0FFF)] = value;
  else if (address < 0xFEA0) {
    if (!gb_lcd_oam_open(now)) return;
    gb_lcd_request_to(now);
    gb_lcd_run_to(now);
    gb_oam[address - 0xFE00] = value;
  } else if (address < 0xFF00) return;
  else if (address < 0xFF80) io_write((uint8_t)address, value);
  else if (address < 0xFFFF) gb_hram[address - 0xFF80] = value;
  else {
    requests();
    enabled = value;
  }
}

// the cartridge, from the copy's header: its chip, how much memory of its own it has, and whether a battery keeps it
static void cartridge(void) {
  static const uint32_t SRAM_SIZES[6] = { 0, 0x800, 0x2000, 0x8000, 0x20000, 0x10000 };
  gb_rom = kit_copy;
  gb_rom_size = kit_copy_size;
  uint8_t kind = gb_rom_size > 0x149 ? gb_rom[0x147] : 0, sizes = gb_rom_size > 0x149 ? gb_rom[0x149] : 0;
  chip = kind >= 0x01 && kind <= 0x03 ? MBC1 : kind >= 0x0F && kind <= 0x13 ? MBC3 : kind >= 0x19 && kind <= 0x1E ? MBC5 : PLAIN;
  battery = kind == 0x03 || kind == 0x09 || kind == 0x0F || kind == 0x10 || kind == 0x13 || kind == 0x1B || kind == 0x1E;
  gb_colour = gb_rom_size > 0x143 && (gb_rom[0x143] & 0x80) != 0;
  rom_banks = gb_rom_size / 0x4000;
  rom_bank = 1;
  low_bits = 1;
  high_bits = 0;
  sram_bank = 0;
  sram_open = 0;
  mbc1_mode = 0;
  uint32_t size = sizes < 6 ? SRAM_SIZES[sizes] : 0;
  sram_banks = size / 0x2000;
  saved = NULL;
  if (size && battery) {
    saved = kit_save(size);
    if (!gb_sram || gb_sram_size != size) gb_sram = kit_alloc(size);
    for (uint32_t i = 0; i < size; i++) gb_sram[i] = saved[i];
  } else if (size) {
    if (!gb_sram || gb_sram_size != size) gb_sram = kit_alloc(size);
    for (uint32_t i = 0; i < size; i++) gb_sram[i] = 0xFF;
  }
  gb_sram_size = size;
}

static void step(uint32_t buttons) {
  uint32_t frame = stepped++;
  if (ended != frame + 1) return;
  held = buttons;
  buttons_read();
  game_step(held);
  while (ended == frame + 1) advance(blit_time);
}

void gb_play_ahead(int frames) {
  while (!ended) advance(blit_time);
  for (int i = 0; i < frames; i++) step(0);
}

/** Starts the game: the console as its own start-up leaves it, with the cartridge in its slot. */
EXPORT("dp_start") void dp_start(void) {
  kit_screen(SCREEN_W, SCREEN_H);
  if (!kept) kept = kit_alloc((size_t)KEPT * SCREEN_W * SCREEN_H * sizeof(uint32_t));
  cartridge();
  for (int i = 0; i < 0x8000; i++) gb_wram[i] = 0;
  for (int i = 0; i < 0x4000; i++) gb_vram[i] = 0;
  for (int i = 0; i < 0x7F; i++) gb_hram[i] = 0;
  for (int i = 0; i < 0xA0; i++) gb_oam[i] = 0;
  const uint8_t *start = gb_colour ? IO_GBC : IO_GB;
  for (int i = 0; i < 0x80; i++) io[i] = start[i];
  now = gb_colour ? 0x102A0 : 0x102A0 + 0x8D2C;
  enabled = 0;
  gb_requested = io[0x0F] & 0x1F;
  held = 0;
  halted = 0;
  wram_bank = 1;
  vram_bank = 0;
  divider = io[0x04];
  divider_from = 0;
  tima = io[0x05];
  tma = io[0x06];
  tac = io[0x07];
  timer_last = 0;
  timer_loads = timer_asks = serial_ends = NEVER;
  gb_lcd_power(gb_colour, now, io);
  gb_apu_power(gb_colour, now, io);
  // the console starts in V-blank with the screen on, so the first picture is the next one's
  blit_time = gb_lcd_vblank() + GB_FRAME;
  blank_next = 0;
  ended = stepped = 0;
  game_start();
  // the emulator's first frame, which nothing is compared with, ends with the first picture, and a start point's
  // frames with theirs
  while (ended <= stepped) advance(blit_time);
  // and their sound, which nothing plays: what was made before the picture the page's first frame starts from
  gb_apu_run_to(now);
  uint64_t since = gb_apu_total() - sound_then[stepped % KEPT];
  float unused[2];
  while ((uint64_t)gb_apu_made() > since) gb_apu_take(unused, unused + 1, 1);
}

/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  step(buttons & 0xFF);
}

/** Draws the last frame, and gives where its 160 × 144 words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  uint32_t *screen = kit_screen(SCREEN_W, SCREEN_H);
  const uint32_t *picture = kept + (size_t)(stepped % KEPT) * SCREEN_W * SCREEN_H;
  for (int i = 0; i < SCREEN_W * SCREEN_H; i++) screen[i] = picture[i];
  return screen;
}

// the most samples one call gives, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];

/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  gb_apu_run_to(now);
  if (count > 0) gb_apu_take(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
