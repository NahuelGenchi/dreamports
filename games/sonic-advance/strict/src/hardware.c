// The console's hardware as the twins reach it in a Dreamport, where the kit is the hardware: nothing here is a twin,
// and the console's own compiler builds none of it.
#ifndef MATCHING
#include "console.h"

// Where the console has an address, in a Dreamport: the work memory and the cartridge are at their own addresses, and
// the colours, the video memory and the sprites' list are the kit's. NULL for anywhere else.
static u8 *console_at(u32 address) {
  if (address >= 0x05000000 && address < 0x05000400) return (u8 *)gba_pal + (address - 0x05000000);
  if (address >= 0x06000000 && address < 0x06018000) return (u8 *)gba_vram + (address - 0x06000000);
  if (address >= 0x07000000 && address < 0x07000400) return (u8 *)gba_oam + (address - 0x07000000);
  if (address >= 0x04000000 && address < 0x05000000) return NULL;
  return (u8 *)address;
}

u16 console_read16(u32 at) { return at < 0x400 ? gba_io[at >> 1] : 0; }

void console_dma3(u32 src, u32 dest, u32 control) {
  u32 count = control & 0xFFFF, wide = control >> 26 & 1 ? 4 : 2, fixed = control >> 24 & 1, i, b;
  // a count of none is the most the channel takes
  if (count == 0) count = 0x10000;
  for (i = 0; i < count; i++) {
    const u8 *from = console_at(src + (fixed ? 0 : i * wide));
    u8 *to = console_at(dest + i * wide);
    if (from == NULL || to == NULL) continue;
    for (b = 0; b < wide; b++) to[b] = from[b];
  }
}

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
