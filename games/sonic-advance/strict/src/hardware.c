// The console's hardware as the twins reach it in a Dreamport, where the kit is the hardware: nothing here is a twin,
// and the console's own compiler builds none of it.
#ifndef MATCHING
#include "console.h"

// Where the console has an address, in a Dreamport: the work memory and the cartridge are at their own addresses, and
// the colours, the video memory and the sprites' list are the kit's. Each memory shows again all through its stretch
// of addresses, as on the console, and the cartridge in each of its three. NULL for anywhere else, and for the
// cartridge when it's written to: the console's DMA reads nothing there and writes nothing.
static u8 *console_at(u32 address, int writing) {
  switch (address >> 24) {
  case 0x02: return (u8 *)(0x02000000 + (address & 0x3FFFF));
  case 0x03: return (u8 *)(0x03000000 + (address & 0x7FFF));
  case 0x05: return (u8 *)gba_pal + (address & 0x3FF);
  case 0x06: {
    u32 at = address & 0x1FFFF;
    return (u8 *)gba_vram + (at >= 0x18000 ? at - 0x8000 : at);
  }
  case 0x07: return (u8 *)gba_oam + (address & 0x3FF);
  case 0x08: case 0x09: case 0x0A: case 0x0B: case 0x0C: case 0x0D:
    if (writing || (address & 0x1FFFFFF) >= gba_rom_size) return NULL;
    return (u8 *)(0x08000000 + (address & 0x1FFFFFF));
  default: return NULL;
  }
}

// The display's registers are the kit's; the rest read as 0 here until the version gives them to the kit.
u16 console_read16(u32 at) { return at < sizeof gba_io ? gba_io[at >> 1] : 0; }

// DMA channel 3's control, as the console keeps it: the channel is on while its top bit is.
static u16 dma3_control;

// DMA channel 3 given its three words, as the console takes them. The channel starts only as its switch goes on: a
// start while it's on already is no start. One asked to start at the next V-blank, H-blank or the sound's time waits,
// on, which is what a size that spills into the control asks for, and console_vblank_dma3 runs one waiting for the
// V-blank. One to start now runs at once, each address going up, down or nowhere as its control says, and is then off.
static void dma3_run(u32 src, const u8 *own, u32 dest, u32 control) {
  static const int step[4] = { 1, -1, 0, 1 };
  u32 count = control & 0xFFFF, wide = control >> 26 & 1 ? 4 : 2, i, b;
  int from_step = step[control >> 23 & 3] * (int)wide, to_step = step[control >> 21 & 3] * (int)wide;
  // a count of none is the most the channel takes
  if (count == 0) count = 0x10000;
  src &= ~(wide - 1);
  dest &= ~(wide - 1);
  for (i = 0; i < count; i++) {
    const u8 *from = own ? own + (int)i * from_step : console_at(src + i * from_step, 0);
    u8 *to = console_at(dest + i * to_step, 1);
    if (from == NULL || to == NULL) continue;
    for (b = 0; b < wide; b++) to[b] = from[b];
  }
}

static u32 dma3_src, dma3_dest, dma3_count;
static const u8 *dma3_own;

// from a console's address, or, with `own`, from a value of the Dreamport's own
static void dma3_start(u32 src, const u8 *own, u32 dest, u32 control) {
  u16 was = dma3_control;
  dma3_control = (u16)(control >> 16) & 0xFFE0;
  if (!(dma3_control & 0x8000) || (was & 0x8000)) return;
  if (dma3_control >> 12 & 3) {
    dma3_src = src;
    dma3_own = own;
    dma3_dest = dest;
    dma3_count = control & 0xFFFF;
    return;
  }
  dma3_run(src, own, dest, (u32)dma3_control << 16 | (control & 0xFFFF));
  dma3_control &= ~0x8000;
}

void console_dma3(u32 src, u32 dest, u32 control) { dma3_start(src, NULL, dest, control); }
void console_dma3_own(const void *src, u32 dest, u32 control) { dma3_start(0, (const u8 *)src, dest, control); }

// At the V-blank, DMA channel 3 if it waits for it, and then off unless it repeats.
void console_vblank_dma3(void) {
  if ((dma3_control & 0xB000) != 0x9000) return;
  dma3_run(dma3_src, dma3_own, dma3_dest, (u32)dma3_control << 16 | dma3_count);
  if (!(dma3_control & 0x0200)) dma3_control &= ~0x8000;
}

// The BIOS's division, which the game calls through its two stubs, Div and Mod: the quotient and the remainder, each
// rounded toward zero, as the console's BIOS gives them.
s32 Div(s32 num, s32 denom) { return num / denom; }
s32 Mod(s32 num, s32 denom) { return num % denom; }

// The cartridge's flash chip, 64 KB as Sonic Advance's, on the kit's save memory, which the kit keeps for the player.
// It reads as its bytes and takes the chip's commands as writes: two unlock writes, then which command, at 0x5555.
// It names itself as mGBA's does (a Panasonic chip, 0x1B32), and an erase or a write is done at once, so the
// library's wait for it ends on its first look.
enum { FLASH_SIZE = 0x10000, FLASH_SECTOR = 0x1000 };
static u8 flash_id_mode, flash_unlocked, flash_erasing, flash_writing, flash_hidden[2];

u8 *console_flash(void) { return gba_save(FLASH_SIZE); }

void console_flash_write(u32 addr, u8 data) {
  u8 *flash = console_flash();
  u32 i;
  addr &= FLASH_SIZE - 1;
  if (flash_writing) {
    flash_writing = 0;
    flash[addr] = data;
    gba_save_write();
    return;
  }
  if (flash_unlocked == 0) {
    if (addr == 0x5555 && data == 0xAA) flash_unlocked = 1;
    else if (data == 0xF0) flash_unlocked = 0;
    return;
  }
  if (flash_unlocked == 1) {
    flash_unlocked = addr == 0x2AAA && data == 0x55 ? 2 : 0;
    return;
  }
  flash_unlocked = 0;
  if (flash_erasing && data == 0x30) {
    flash_erasing = 0;
    addr &= ~(u32)(FLASH_SECTOR - 1);
    for (i = 0; i < FLASH_SECTOR; i++) flash[addr + i] = 0xFF;
    gba_save_write();
    return;
  }
  if (flash_erasing && data == 0x10 && addr == 0x5555) {
    flash_erasing = 0;
    for (i = 0; i < FLASH_SIZE; i++) flash[i] = 0xFF;
    gba_save_write();
    return;
  }
  flash_erasing = 0;
  if (addr != 0x5555) return;
  if (data == 0x90 && !flash_id_mode) {
    // the chip's name shows where its first two bytes are, until it's told to leave
    flash_id_mode = 1;
    flash_hidden[0] = flash[0], flash_hidden[1] = flash[1];
    flash[0] = 0x32, flash[1] = 0x1B;
  } else if (data == 0xF0 && flash_id_mode) {
    flash_id_mode = 0;
    flash[0] = flash_hidden[0], flash[1] = flash_hidden[1];
  } else if (data == 0x80) {
    flash_erasing = 1;
  } else if (data == 0xA0) {
    flash_writing = 1;
  }
}
#endif
