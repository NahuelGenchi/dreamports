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
#endif
