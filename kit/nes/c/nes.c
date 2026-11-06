// The NES's part of what the page calls, by name, to run a game in C (kit/c/game.js as WebAssembly, kit/c/native.c on
// a computer): starting it with the cartridge read from the player's copy, its frames, the CPU's reads and writes of the
// hardware, drawing the frame with the PPU and hearing it with the APU. The copy, the save memory, the start point's
// words and memory are what every console's kit in C shares (kit/c/kit.c).

#include "nes.h"
#include "nes-kit.h"
#include "page.h"

uint8_t nes_ram[0x800];
const uint8_t *nes_prg;
uint32_t nes_prg_size;
uint8_t *nes_chr;
uint32_t nes_chr_size;
int nes_mapper;
uint8_t nes_wram[0x2000];
int nes_chr_writable;

static uint8_t *chr_ram;
static uint8_t *battery;
static uint32_t frame;
static uint64_t frame_start;            // dots from power-on to this frame's start
static uint32_t held;
static uint8_t strobe, shifted;

uint8_t nes_prg_byte(uint16_t address) {
  if (!nes_prg_size) return 0;
  return nes_prg[(address & 0x7FFF) % nes_prg_size];
}

void nes_wram_write(void) {
  if (!battery) return;
  for (int i = 0; i < 0x2000; i++) battery[i] = nes_wram[i];
  kit_save_write();
}

// the cartridge, from the copy's iNES header: 16 bytes, then a trainer of 512 if bit 2 of byte 6 says so, the program
// in 16 KB blocks and the tiles in 8 KB ones
static void cartridge(void) {
  const uint8_t *h = kit_copy;
  int ines = kit_copy_size >= 16 && h[0] == 'N' && h[1] == 'E' && h[2] == 'S' && h[3] == 0x1A;
  uint32_t at = ines ? 16 + ((h[6] & 4) ? 512 : 0) : 0;
  uint32_t prg = ines ? h[4] * 0x4000u : kit_copy_size, chr = ines ? h[5] * 0x2000u : 0;
  if (at + prg > kit_copy_size) prg = kit_copy_size > at ? kit_copy_size - at : 0;
  nes_prg = kit_copy + at;
  nes_prg_size = prg;
  if (chr && at + prg + chr <= kit_copy_size) {
    // the copy's tiles, in memory of the game's own so a mapper's game can point the PPU at any of them
    nes_chr = kit_alloc(chr);
    for (uint32_t i = 0; i < chr; i++) nes_chr[i] = kit_copy[at + prg + i];
    nes_chr_size = chr;
    nes_chr_writable = 0;
  } else {
    if (!chr_ram) chr_ram = kit_alloc(0x2000);
    nes_chr = chr_ram;
    nes_chr_size = 0x2000;
    nes_chr_writable = 1;
  }
  nes_mapper = ines ? (h[6] >> 4) | (h[7] & 0xF0) : 0;
  nes_ppu_wiring();
  nes_mirroring(ines && (h[6] & 1) ? NES_MIRROR_VERTICAL : NES_MIRROR_HORIZONTAL);
  if (ines && (h[6] & 2)) {
    battery = kit_save(0x2000);
    for (int i = 0; i < 0x2000; i++) nes_wram[i] = battery[i];
  }
}

void nes_write(uint16_t address, uint8_t value) {
  if (address < 0x2000) nes_ram[address & 0x7FF] = value;
  else if (address < 0x4000) nes_ppu_write(address, value);
  else if (address == 0x4014) {
    // a page of memory to the sprites, which holds the CPU for 513 cycles
    uint8_t page[256];
    uint16_t from = (uint16_t)(value << 8);
    for (int i = 0; i < 256; i++) {
      uint16_t a = (uint16_t)(from + i);
      page[i] = a < 0x2000 ? nes_ram[a & 0x7FF] : a >= 0x6000 && a < 0x8000 ? nes_wram[a - 0x6000] : a >= 0x8000 ? nes_prg_byte(a) : 0;
    }
    nes_oam_dma(page);
    nes_spend(513);
  } else if (address == 0x4016) {
    strobe = value & 1;
    if (strobe) shifted = (uint8_t)held;
  } else if (address < 0x4018) {
    nes_apu_run_to(frame_start + (uint64_t)nes_now());
    nes_apu_write(address, value);
  } else if (address >= 0x6000 && address < 0x8000) nes_wram[address - 0x6000] = value;
}

uint8_t nes_read(uint16_t address) {
  if (address < 0x2000) return nes_ram[address & 0x7FF];
  if (address < 0x4000) return nes_ppu_read(address);
  if (address == 0x4015) {
    nes_apu_run_to(frame_start + (uint64_t)nes_now());
    return nes_apu_status();
  }
  if (address == 0x4016) {
    // the controller sends its buttons a bit at a time, A first, and then ones; with the strobe held, A again
    if (strobe) shifted = (uint8_t)held;
    uint8_t bit = shifted & 1;
    shifted = (uint8_t)(shifted >> 1 | 0x80);
    return 0x40 | bit;
  }
  if (address == 0x4017) return 0x40;
  if (address >= 0x6000 && address < 0x8000) return nes_wram[address - 0x6000];
  if (address >= 0x8000) return nes_prg_byte(address);
  return 0;
}

uint32_t nes_frame(void) { return frame; }

void nes_start_at(uint32_t later) {
  // the frames from power-on to there, and their sound's time: the PPU's dead frame, then frames a dot short every
  // other one
  frame = later;
  frame_start = (uint64_t)nes_frame_dots;
  for (uint32_t f = 0; f < later; f++) frame_start += (uint64_t)nes_frame_length((int)f);
  nes_apu_run_to(frame_start);
}
uint32_t nes_buttons(void) { return held; }

/** Starts the game: the console at power-on, with the cartridge in its slot. */
EXPORT("dp_start") void dp_start(void) {
  kit_screen(SCREEN_W, SCREEN_H);
  nes_ppu_power();
  nes_apu_power();
  for (int i = 0; i < 0x800; i++) nes_ram[i] = 0;
  frame = 0;
  // the emulator's first frame, which nothing is compared with (ppu.c)
  frame_start = (uint64_t)nes_frame_dots;
  cartridge();
  game_start();
  // the sound of the frames before the first, which nothing plays
  nes_apu_run_to(frame_start);
  nes_apu_drop();
}

/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  held = buttons & 0xFF;
  nes_ppu_frame_start(frame);
  game_step(held);
  nes_ppu_frame_end();
  frame_start += (uint64_t)nes_ppu_frame_length();
  nes_apu_run_to(frame_start);
  frame++;
}

/** Draws the last frame, and gives where its 256 × 240 words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  uint32_t *screen = kit_screen(SCREEN_W, SCREEN_H);
  nes_ppu_draw(screen);
  return screen;
}

// the most samples one call gives, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];

/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  if (count > 0) nes_apu_take(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
