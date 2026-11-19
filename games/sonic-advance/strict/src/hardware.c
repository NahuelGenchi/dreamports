// The console's hardware as the twins reach it in a Dreamport, where the kit is the hardware: nothing here is a twin,
// and the console's own compiler builds none of it.
#ifndef MATCHING
#include "console.h"
#include "core.h"
#include "clock.h"

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

// ---------------------------------------------------------------------------------------------------------------
// The registers. The display's are the kit's, gba_io, written through gba_write so the kit draws with them. The rest,
// the interrupts', the DMA channels', the timers', the sound's, the link cable's and the buttons', are kept here, as
// the console keeps them, by how far each is from 0x04000000.
enum {
  IO_DISPSTAT = 0x004, IO_VCOUNT = 0x006, IO_KEYINPUT = 0x130, IO_RCNT = 0x134, IO_IE = 0x200, IO_IF = 0x202, IO_IME = 0x208,
  STAT_VBLANK = 0x0001, STAT_HBLANK = 0x0002, STAT_VCOUNT = 0x0004, STAT_VBLANK_IRQ = 0x0008, STAT_HBLANK_IRQ = 0x0010,
  STAT_VCOUNT_IRQ = 0x0020, IRQ_VBLANK = 0x0001, IRQ_HBLANK = 0x0002, IRQ_VCOUNT = 0x0004, LINES = 228,
};
u16 console_io[0x210];
// the buttons held this frame, a bit each as KEYINPUT has them when they're down; the line being drawn; whether the
// V-blank is on, as the main loop's wait for its end reads it
static u16 console_keys;
static int console_line = LINES - 1, console_in_vblank;
// how many interrupts are being seen to: their handlers change the display's status, which isn't looking for the end
static int console_handling;

void console_set_keys(u16 keys) { console_keys = keys; }

// where the line count is, a line on: time goes on while the game waits for a line by reading it from memory
u32 console_vcount_at(void) {
  console_line = (console_line + 1) % LINES;
  console_io[IO_VCOUNT >> 1] = (u16)console_line;
  return (u32)&console_io[IO_VCOUNT >> 1];
}


u16 console_read16(u32 at) {
  if (at == IO_DISPSTAT) {
    // in the V-blank as the frame's time says, or as the console was when the function check gives its registers in
    // console_io, which play never writes there, the display's being the kit's
    u16 status = (console_in_vblank || (console_io[IO_DISPSTAT >> 1] & STAT_VBLANK) ? STAT_VBLANK : 0)
      | ((gba_io[IO_DISPSTAT >> 1] >> 8) == console_line ? STAT_VCOUNT : 0);
    // the V-blank's end comes as soon as the game looks for it: the frame's drawing waits for the game's next step. An
    // interrupt's handler only changes the register, as the V-blank's own does at its start
    if (!console_handling) console_in_vblank = 0;
    return (gba_io[IO_DISPSTAT >> 1] & ~7) | status;
  }
  if (at == IO_VCOUNT) return (u16)console_line;
  if (at == IO_KEYINPUT) return ~console_keys & 0x3FF;
  if (at < sizeof gba_io) return gba_io[at >> 1];
  return at < sizeof console_io ? console_io[at >> 1] : 0;
}

void console_write16(u32 at, u16 value) {
  // the console's time takes what decides it: the DMA channels', the timers', the sound's and WAITCNT
  if ((at >= 0x80 && at < 0x88) || (at >= 0xB0 && at < 0xE0) || (at >= 0x100 && at < 0x110) || at == 0x204) gba_clock_written(0x04000000u + at, value);
  if (at < sizeof gba_io) gba_write(at, value);
  else if (at == IO_IF) console_io[IO_IF >> 1] &= ~value;   // a 1 says an interrupt was seen to
  else if (at < sizeof console_io) console_io[at >> 1] = value;
}

// ---------------------------------------------------------------------------------------------------------------
// The four DMA channels, each given its three words as the console takes them. A channel starts only as its switch
// goes on: a start while it's on already is no start. One asked to start at the V-blank, at each line's H-blank or at
// the sound's time waits, on, which is also what a size that spills into the control asks for; the V-blank and the
// lines run those (console_vblank, console_hblank) and the sound's never run here, as the sound is the kit's. One to
// start now runs at once, each address going up, down or nowhere as its control says, and is then off unless it
// repeats. A value of the Dreamport's own, as a fill's is, is read where it is, as the console reads its stack.
struct console_dma { u32 src, dest, count; u16 control; const u8 *own; u8 *into; };
static struct console_dma dma[4];

static void dma_run(struct console_dma *d) {
  static const int step[4] = { 1, -1, 0, 1 };
  u32 count = d->count, wide = d->control >> 10 & 1 ? 4 : 2, i, b;
  int from_step = step[d->control >> 7 & 3] * (int)wide, to_step = step[d->control >> 5 & 3] * (int)wide;
  // a count of none is the most the channel takes
  if (count == 0) count = d == &dma[3] ? 0x10000 : 0x4000;
  for (i = 0; i < count; i++) {
    u32 at = d->src + i * from_step;
    const u8 *from = d->own ? d->own + (int)i * from_step : console_at(at, 0);
    u8 *to = d->into ? d->into + (int)i * to_step : console_at(d->dest + i * to_step, 1);
    // past the cartridge's end the console reads what its bus is left holding: each halfword the address's own, halved
    u8 bus[4];
    if (from == NULL && at >> 24 >= 0x08 && at >> 24 <= 0x0D) {
      for (b = 0; b < wide; b += 2) { bus[b] = (u8)((at + b) >> 1); bus[b + 1] = (u8)((at + b) >> 9); }
      from = bus;
    }
    if (from != NULL && to != NULL) for (b = 0; b < wide; b++) to[b] = from[b];
  }
  // a repeating channel goes on from where it got to, its destination back where it started if its control says so
  if (!d->own) d->src += count * from_step;
  if ((d->control >> 5 & 3) != 3) d->dest += count * to_step;
  if (!(d->control & 0x0200) || !(d->control >> 12 & 3)) d->control &= ~0x8000;
}

// the console's time: a channel's three words as the processor writes them, a value of the Dreamport's own read from
// where the console has its stack
static void dma_timed(u32 n, u32 src, int own, u32 dest, u32 control) {
  u32 at = 0x040000B0u + 12 * (n & 3);
  if (own) src = 0x03007F00u;
  gba_clock_written(at, (u16)src);
  gba_clock_written(at + 2, (u16)(src >> 16));
  gba_clock_written(at + 4, (u16)dest);
  gba_clock_written(at + 6, (u16)(dest >> 16));
  gba_clock_written(at + 8, (u16)control);
  gba_clock_written(at + 10, (u16)(control >> 16));
}

static void dma_start(u32 n, u32 src, const u8 *own, u32 dest, u8 *into, u32 control) {
  struct console_dma *d = &dma[n & 3];
  if (!into) dma_timed(n, src, own != NULL, dest, control);
  u16 was = d->control;
  u32 wide;
  d->control = (u16)(control >> 16) & (n == 3 ? 0xFFE0 : 0xF7E0);
  if (!(d->control & 0x8000) || (was & 0x8000)) return;
  wide = d->control >> 10 & 1 ? 4 : 2;
  d->src = src & ~(wide - 1);
  d->own = own;
  d->into = into;
  d->dest = dest & ~(wide - 1);
  d->count = control & (n == 3 ? 0xFFFF : 0x3FFF);
  if (!(d->control >> 12 & 3)) dma_run(d);
}

void console_dma(u32 n, u32 src, u32 dest, u32 control) { dma_start(n, src, NULL, dest, NULL, control); }
void console_dma_own(u32 n, const void *src, u32 dest, u32 control) { dma_start(n, 0, (const u8 *)src, dest, NULL, control); }
void console_dma3(u32 src, u32 dest, u32 control) { dma_start(3, src, NULL, dest, NULL, control); }
void console_dma3_own(const void *src, u32 dest, u32 control) { dma_start(3, 0, (const u8 *)src, dest, NULL, control); }
/** DMA channel 3 copying into a value of the Dreamport's own, as a twin's local is where the console's function has
 *  its stack: the channel starts, or doesn't, as the console's does, and what it copies lands there. */
void console_dma3_into(u32 src, void *dest, u32 control) { dma_start(3, src, NULL, 0, (u8 *)dest, control); }

/** A halfword stored at an address of the console's, as its processor stores one: at the address with its lowest bit
 *  dropped, in whichever memory is there, and nowhere for the cartridge. */
void console_store16(u32 at, u16 value) {
  u8 *to = console_at(at & ~1u, 1);
  if (to != NULL) { to[0] = (u8)value; to[1] = (u8)(value >> 8); }
}
void console_dma_stop(u32 n) { dma[n & 3].control &= ~(0x3000 | 0x0800 | 0x0200 | 0x8000); }

// the channels waiting for this moment: 1 the V-blank, 2 a line's H-blank
static void dma_at(u32 timing) {
  u32 n;
  for (n = 0; n < 4; n++) if ((dma[n].control & 0x8000) && (dma[n].control >> 12 & 3) == timing) dma_run(&dma[n]);
}

void console_vblank_dma3(void) { if ((dma[3].control & 0xB000) == 0x9000) dma_run(&dma[3]); }

// ---------------------------------------------------------------------------------------------------------------
// The interrupts, as the cartridge's own handler takes them (IntrMain, ARM code the engine copies to the fast work
// memory and the BIOS jumps to): of those both enabled and asked for, the first in its order, seen to and then run
// from gIntrTable, one after another while any is left and the master switch is on.
static const u16 intr_order[13] = { 0x00C0, IRQ_VBLANK, IRQ_HBLANK, IRQ_VCOUNT, 0x0008, 0x0010, 0x0020, 0x0100, 0x0200, 0x0400, 0x0800, 0x1000, 0x2000 };

void console_interrupt(u16 flags) {
  console_io[IO_IF >> 1] |= flags;
  for (;;) {
    u16 pending = console_io[IO_IE >> 1] & console_io[IO_IF >> 1];
    u32 i;
    if (!(console_io[IO_IME >> 1] & 1) || !pending) return;
    for (i = 0; i < 12 && !(pending & intr_order[i]); i++) {}
    console_io[IO_IF >> 1] &= ~(pending & intr_order[i]);
    console_handling++;
    TWIN(gIntrTable[i])();
    console_handling--;
  }
}

// The V-blank: the line count at its first line, its DMA, then its interrupt as the display's status asks for it.
static void console_vblank(void) {
  console_line = 160;
  console_io[IO_VCOUNT >> 1] = 160;
  console_in_vblank = 1;
  dma_at(1);
  if (gba_io[IO_DISPSTAT >> 1] & STAT_VBLANK_IRQ) console_interrupt(IRQ_VBLANK);
  if ((gba_io[IO_DISPSTAT >> 1] & STAT_VCOUNT_IRQ) && (gba_io[IO_DISPSTAT >> 1] >> 8) == 160) console_interrupt(IRQ_VCOUNT);
}

// After each line the kit draws: its H-blank DMA and interrupt, and the next line's count and its interrupt.
void console_hblank(int y) {
  console_line = y;
  console_io[IO_VCOUNT >> 1] = (u16)y;
  dma_at(2);
  if (gba_io[IO_DISPSTAT >> 1] & STAT_HBLANK_IRQ) console_interrupt(IRQ_HBLANK);
  console_line = y + 1;
  console_io[IO_VCOUNT >> 1] = (u16)(y + 1);
  if ((gba_io[IO_DISPSTAT >> 1] & STAT_VCOUNT_IRQ) && (gba_io[IO_DISPSTAT >> 1] >> 8) == console_line) console_interrupt(IRQ_VCOUNT);
}

// ---------------------------------------------------------------------------------------------------------------
// The BIOS's work, which the game calls through its stubs.

/** VBlankIntrWait: until the V-blank's interrupt has said it ran, the frame's lines drawn and the V-blank begun. The
 *  frame ends here: the kit draws it once the game's step is over, and the game goes on from here in the next. */
void VBlankIntrWait(void) {
  // from the game's first wait on, its waits end its frames, not the console's time
  gba_clock_on_frame_end(NULL);
  *(vu16 *)0x03007FF8 &= ~1;
  console_io[IO_IME >> 1] = 1;
  do {
    kit_wait_frame();
    console_vblank();
  } while (!(*(vu16 *)0x03007FF8 & 1));
  *(vu16 *)0x03007FF8 &= ~1;
}

// where a pointer the game gives the BIOS is: the colours, the video memory and the sprites' list are the kit's, and
// anything else, the work memory, the cartridge or a value of the Dreamport's own, is where it says
static u8 *bios_at(u32 address) {
  return address >> 24 >= 0x05 && address >> 24 <= 0x07 ? console_at(address, 1) : (u8 *)address;
}

/** CpuSet: `control`'s count of halfwords, or words with bit 26, from `src` to `dest`, or the one at `src` over all of
 *  them with bit 24, as the BIOS copies them, one at a time. */
void CpuSet(const void *src, void *dest, u32 control) {
  u32 count = control & 0x1FFFFF, wide = control >> 26 & 1 ? 4 : 2, fixed = control >> 24 & 1, i, b;
  u32 from = (u32)src & ~(wide - 1), to = (u32)dest & ~(wide - 1);
  for (i = 0; i < count; i++) {
    const u8 *in = bios_at(from + (fixed ? 0 : i * wide));
    u8 *out = bios_at(to + i * wide);
    for (b = 0; b < wide; b++) out[b] = in[b];
  }
}

void AgbMain(void);

/** The cartridge's start, ARM code at 0x08000000: the interrupt handler's address where the BIOS looks for it, and
 *  then AgbMain, which never comes back. The stacks it sets are the console's processor's, which C has none of. */
void console_start(void) {
  // in the console's time: its branch past the header, the processor's modes and stacks, and the interrupt handler's
  // address kept, then a jump to AgbMain in Thumb code
  static const u32 vector[] = { 0x03007FFC };
  gba_clock_run_arm(0x08000000, 0x08000000, 0x080000C0, NULL, 0);
  gba_clock_run_arm(0x080000C0, 0x080000EC, 0x08001495, vector, 1);
  *(u32 *)0x03007FFC = 0x080000FC;
  AgbMain();
}

/** SoftReset, with the link cable's registers set as the console starts them first, as Sonic Advance asks: the top
 *  of the fast work memory cleared, as the BIOS clears its stacks and its flags there, and the cartridge from its
 *  start. It never comes back. */
void SoftReset(u32 flags) {
  u32 *at;
  if (flags & 0x20) console_io[IO_RCNT >> 1] = 0x8000;
  for (at = (u32 *)0x03007E00; at < (u32 *)0x03008000; at++) *at = 0;
  console_start();
}

// A frame of the console's time over: the Dreamport's frame f is the console's f + 1, whose picture shows frame f's
// work, so the console's first frame, before any of the game's, has none of the Dreamport's
static void console_frame_end(void) {
  if (gba_clock_frame() > 1) kit_wait_frame();
}

/** The console from power-on: the link cable's registers as its BIOS leaves them, and the lines' callbacks. */
void console_power_on(void) {
  // the console's time from power-on, which ends power-on's frames where the console's end
  gba_clock_start();
  gba_clock_on_frame_end(console_frame_end);
  console_io[IO_RCNT >> 1] = 0x8000;
  gba_on_hblank(console_hblank);
}

// The BIOS's division, which the game calls through its two stubs, Div and Mod: the quotient and the remainder, each
// rounded toward zero, as the console's BIOS gives them. Where the console's BIOS never comes back, dividing by 0, the
// function check's emulator gives a quotient of 1, or -1 below 0, and the number as the remainder, and the one sum
// that doesn't fit, the lowest number by -1, gives itself and 0: so does this, rather than stop the game, as a call
// with made-up values may divide so, though play never does.
s32 Div(s32 num, s32 denom) {
  if (denom == 0) return num < 0 ? -1 : 1;
  if (denom == -1 && num == (s32)0x80000000u) return num;
  return num / denom;
}
s32 Mod(s32 num, s32 denom) {
  if (denom == 0) return num;
  if (denom == -1) return 0;
  return num % denom;
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
