// A game in C on the Nintendo 64's kit: the console's memory as its processor reaches it, the interrupts its chips
// raise, the cartridge read through the peripheral interface, and what the page calls, by name, to start the game, run
// its frames, draw them and hear them, as kit/c/console.c does for a console with no kit of its own.
//
// The chips do their work at once, where the console's take some time: the RSP runs a task whole when it's started,
// the RDP draws a list when it's sent, and a DMA is done when it's asked for, each raising its interrupt as it ends. A
// game in C runs a frame of its original's in game_step, which starts as the video interface's interrupt does.

#include "n64-kit.h"
#include "page.h"

uint8_t n64_rdram[N64_RDRAM_SIZE];
uint8_t n64_sp_mem[0x2000];
uint32_t n64_mi_intr;
static uint32_t mi_mode, mi_mask;
static uint32_t ai[6], pi[13], ri[8], si[7];

// the cartridge as the player's copy has it, in any of the three orders copies come in: highest byte first (.z64),
// each half-word's bytes swapped (.v64) or each word's (.n64), which its first word tells apart
static uint32_t copy_order;
static uint8_t cartridge_byte(uint32_t offset) {
  if (offset >= kit_copy_size) return 0;
  return kit_copy[offset ^ copy_order];
}

void n64_power(void) {
  for (uint32_t i = 0; i < N64_RDRAM_SIZE; i++) n64_rdram[i] = 0;
  for (int i = 0; i < 0x2000; i++) n64_sp_mem[i] = 0;
  n64_mi_intr = mi_mode = mi_mask = 0;
  for (int i = 0; i < 6; i++) ai[i] = 0;
  for (int i = 0; i < 13; i++) pi[i] = 0;
  for (int i = 0; i < 8; i++) ri[i] = 0;
  for (int i = 0; i < 7; i++) si[i] = 0;
  copy_order = 0;
  if (kit_copy_size >= 4) {
    uint32_t first = n64_be32(kit_copy);
    copy_order = first == 0x37804012 ? 1 : first == 0x40123780 ? 3 : 0;
  }
  rsp_power();
  rdp_power();
  vi_power();
  // as the console's boot does, the cartridge's first 4 KB in the RSP's data memory
  for (uint32_t i = 0; i < 0x1000; i++) n64_sp_mem[i] = cartridge_byte(i);
}

// a cartridge's bytes into RDRAM, as the peripheral interface copies them when PI_WR_LEN is written: an even number of
// them to an even address, those past the copy's end as zero, and a first block shorter than the address's distance
// from eight bytes, as the console's emulator has it, giving nothing
static void pi_dma(void) {
  uint32_t cart = pi[1] & ~1u, dram = pi[0] & 0xFFFFFE, length = (pi[3] & 0xFFFFFF) + 1;
  if (length >= 0x7F && (length & 1)) length++;
  if (length <= 0x80) {
    uint32_t misalign = dram & 7;
    length = length > misalign ? length - misalign : 0;
  }
  if (cart >= 0x10000000 && cart < 0x1FC00000) {
    uint32_t from = cart & 0x03FFFFFF;
    for (uint32_t i = 0; i < length && dram + i < N64_RDRAM_SIZE; i++) n64_rdram[dram + i] = cartridge_byte(from + i);
  }
  pi[0] = (dram + length + 7) & ~7u;
  pi[1] = (cart + length + 1) & ~1u;
  n64_interrupt(MI_INTR_PI);
}

static void mi_write(uint32_t reg, uint32_t value) {
  if (reg == 0) {
    // MI_MODE: its low bits, and the DP interrupt seen when bit 11 says so
    mi_mode = (mi_mode & ~0x7Fu) | (value & 0x7F);
    if (value & 0x0080) mi_mode &= ~0x080u;
    if (value & 0x0100) mi_mode |= 0x080;
    if (value & 0x0200) mi_mode &= ~0x100u;
    if (value & 0x0400) mi_mode |= 0x100;
    if (value & 0x0800) n64_mi_intr &= ~(uint32_t)MI_INTR_DP;
    if (value & 0x1000) mi_mode &= ~0x200u;
    if (value & 0x2000) mi_mode |= 0x200;
  } else if (reg == 3) {
    // MI_INTR_MASK: a pair of bits, clear and set, for each interrupt
    for (int bit = 0; bit < 6; bit++) {
      if (value & (1u << (bit * 2))) mi_mask &= ~(1u << bit);
      if (value & (2u << (bit * 2))) mi_mask |= 1u << bit;
    }
  }
}

static uint32_t physical(uint32_t address) { return address & 0x1FFFFFFF; }

uint32_t n64_read32(uint32_t address) {
  uint32_t at = physical(address) & ~3u;
  if (at < N64_RDRAM_SIZE) return n64_be32(n64_rdram + at);
  if (at >= 0x04000000 && at < 0x04040000) return n64_be32(n64_sp_mem + (at & 0x1FFF));
  if ((at >= 0x04040000 && at < 0x04040020) || at == 0x04080000) return rsp_read(at);
  if (at >= 0x04100000 && at < 0x04100020) return rdp_read(at);
  if (at >= 0x04300000 && at < 0x04300010) {
    uint32_t reg = (at >> 2) & 3;
    // the RCP's version, as the console's says
    return reg == 0 ? mi_mode : reg == 1 ? 0x02020102 : reg == 2 ? n64_mi_intr : mi_mask;
  }
  if (at >= 0x04400000 && at < 0x04400038) return n64_vi[(at >> 2) & 15];
  if (at >= 0x04500000 && at < 0x04500018) {
    uint32_t reg = (at >> 2) & 7;
    // its status, and its length, as an audio interface that plays nothing has them
    return reg == 3 ? 0 : reg == 1 ? 0 : ai[reg];
  }
  if (at >= 0x04600000 && at < 0x04600034) return (at >> 2 & 15) == 4 ? 0 : pi[(at >> 2) & 15];
  if (at >= 0x04700000 && at < 0x04700020) return ri[(at >> 2) & 7];
  if (at >= 0x04800000 && at < 0x0480001C) return si[(at >> 2) & 7];
  if (at >= 0x10000000 && at < 0x1FC00000) {
    uint32_t from = at & 0x03FFFFFF;
    return (uint32_t)cartridge_byte(from) << 24 | (uint32_t)cartridge_byte(from + 1) << 16 | (uint32_t)cartridge_byte(from + 2) << 8 | cartridge_byte(from + 3);
  }
  return 0;
}

void n64_write32(uint32_t address, uint32_t value) {
  uint32_t at = physical(address) & ~3u;
  if (at < N64_RDRAM_SIZE) n64_put_be32(n64_rdram + at, value);
  else if (at >= 0x04000000 && at < 0x04040000) n64_put_be32(n64_sp_mem + (at & 0x1FFF), value);
  else if ((at >= 0x04040000 && at < 0x04040020) || at == 0x04080000) rsp_write(at, value);
  else if (at >= 0x04100000 && at < 0x04100020) rdp_write(at, value);
  else if (at >= 0x04300000 && at < 0x04300010) mi_write((at >> 2) & 3, value);
  else if (at >= 0x04400000 && at < 0x04400038) {
    uint32_t reg = (at >> 2) & 15;
    // a write to VI_V_CURRENT is how a game says it saw the video interface's interrupt
    if (reg == 4) n64_mi_intr &= ~(uint32_t)MI_INTR_VI;
    else n64_vi[reg] = value;
  } else if (at >= 0x04500000 && at < 0x04500018) {
    uint32_t reg = (at >> 2) & 7;
    if (reg == 3) n64_mi_intr &= ~(uint32_t)MI_INTR_AI;
    else ai[reg] = value;
  } else if (at >= 0x04600000 && at < 0x04600034) {
    uint32_t reg = (at >> 2) & 15;
    if (reg == 4) {
      if (value & 2) n64_mi_intr &= ~(uint32_t)MI_INTR_PI;
    } else {
      pi[reg] = value;
      if (reg == 3) pi_dma();
    }
  } else if (at >= 0x04700000 && at < 0x04700020) ri[(at >> 2) & 7] = value;
  else if (at >= 0x04800000 && at < 0x0480001C) {
    uint32_t reg = (at >> 2) & 7;
    if (reg == 6) n64_mi_intr &= ~(uint32_t)MI_INTR_SI;
    else si[reg] = value;
  }
}

// a half-word or byte of memory: RDRAM or the RSP's
static uint8_t *memory_at(uint32_t address) {
  uint32_t at = physical(address);
  if (at < N64_RDRAM_SIZE) return n64_rdram + at;
  if (at >= 0x04000000 && at < 0x04040000) return n64_sp_mem + (at & 0x1FFF);
  return 0;
}
uint16_t n64_read16(uint32_t address) {
  const uint8_t *at = memory_at(address & ~1u);
  return at ? (uint16_t)(at[0] << 8 | at[1]) : (uint16_t)(n64_read32(address) >> (address & 2 ? 0 : 16));
}
void n64_write16(uint32_t address, uint16_t value) {
  uint8_t *at = memory_at(address & ~1u);
  if (at) at[0] = (uint8_t)(value >> 8), at[1] = (uint8_t)value;
}
uint8_t n64_read8(uint32_t address) {
  const uint8_t *at = memory_at(address);
  return at ? *at : (uint8_t)(n64_read32(address) >> (24 - 8 * (address & 3)));
}
void n64_write8(uint32_t address, uint8_t value) {
  uint8_t *at = memory_at(address);
  if (at) *at = value;
}

// the most samples one call makes, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_RATE / 10 + 1)
static float sound[SOUND_MAX * 2];

/** Starts the game. */
EXPORT("dp_start") void dp_start(void) {
  n64_power();
  game_start();
  vi_update();
}
/** Runs one frame with the buttons in `buttons` held, a bit each in kit/consoles.js's order (console.h): from the
 *  video interface's interrupt, once it's been set going. */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  if (n64_vi[6]) n64_interrupt(MI_INTR_VI);
  game_step(buttons);
  // the picture, once the frame is done rather than paused partway
  if (!kit_frame_paused()) vi_update();
}
/** Draws the frame, and gives where its words are, dp_width() × dp_height() of them. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  game_draw();
  return dp_width() > 0 && dp_height() > 0 ? kit_screen(dp_width(), dp_height()) : kit_screen(SCREEN_W, SCREEN_H);
}
/** The next `count` samples of the game's sound, at most dp_sound_render_max(), the left ones and then the right ones
 *  dp_sound_render_max() words on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  for (int i = 0; i < SOUND_MAX * 2; i++) sound[i] = 0;
  if (count > 0) game_sound(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
