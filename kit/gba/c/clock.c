// The Game Boy Advance's time, as mGBA 0.10.5 keeps it (clock.h). Every number of cycles here is the reference
// emulator's own rule for the console, and the kit's test measures them against it (tools/test/clock.mjs).

#include "clock.h"
#include "kit.h"

// the kit's own (kit/c/libc.c), as the WebAssembly build has no C library
void *memset(void *to, int value, size_t n);
void *memcpy(void *restrict to, const void *restrict from, size_t n);

// ---------------------------------------------------------------------------------------------------------------
// The memory's wait states, by the top byte of an address: each region's for a halfword and for a word, the first
// access of a run (nonsequential) and the rest (sequential). The cartridge's come from WAITCNT, as the game sets it.

enum { BIOS = 0x0, EWRAM = 0x2, IWRAM = 0x3, IO = 0x4, CARTRIDGE = 0x8, SRAM = 0xE };
static const uint8_t RESET_N16[16] = { 0, 0, 2, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4, 4 };
static const uint8_t RESET_N32[16] = { 0, 0, 5, 0, 0, 1, 1, 0, 7, 7, 9, 9, 13, 13, 9 };
static const uint8_t RESET_S16[16] = { 0, 0, 2, 0, 0, 0, 0, 0, 2, 2, 4, 4, 8, 8, 4 };
static const uint8_t RESET_S32[16] = { 0, 0, 5, 0, 0, 1, 1, 0, 5, 5, 9, 9, 17, 17, 9 };
// WAITCNT's choices: a first access's waits, and a sequential one's for each of the three cartridge windows
static const uint8_t CART_N[4] = { 4, 3, 2, 8 };
static const uint8_t CART_S[6] = { 2, 1, 4, 1, 8, 1 };

static struct {
  uint8_t n16[16], s16[16], n32[16], s32[16];
  int prefetch;              // whether the cartridge fetches ahead while the bus is idle
  uint32_t prefetched;       // how far it has, by the program counter (0 after a jump)
  int region;                // where the code runs from
} wait;

static void set_waitcnt(uint16_t value) {
  int windows[3] = { (value >> 2) & 3, (value >> 5) & 3, (value >> 8) & 3 };
  int sequential[3] = { (value >> 4) & 1, ((value >> 7) & 1) + 2, ((value >> 10) & 1) + 4 };
  int sram = value & 3;
  wait.n16[SRAM] = wait.n16[SRAM + 1] = wait.s16[SRAM] = wait.s16[SRAM + 1] = CART_N[sram];
  wait.n32[SRAM] = wait.n32[SRAM + 1] = wait.s32[SRAM] = wait.s32[SRAM + 1] = 2 * CART_N[sram] + 1;
  for (int w = 0; w < 3; w++) {
    int r = CARTRIDGE + 2 * w;
    wait.n16[r] = wait.n16[r + 1] = CART_N[windows[w]];
    wait.s16[r] = wait.s16[r + 1] = CART_S[sequential[w]];
    wait.n32[r] = wait.n32[r + 1] = wait.n16[r] + 1 + wait.s16[r];
    wait.s32[r] = wait.s32[r + 1] = 2 * wait.s16[r] + 1;
  }
  wait.prefetch = (value & 0x4000) != 0;
}

// With the prefetch on and the code in the cartridge, the cartridge reads ahead, up to 8 halfwords, while an access
// elsewhere keeps the bus busy, and an access's wait shrinks by what that saved (mGBA's GBAMemoryStall).
static int stall(uint32_t pc_register, int cycles) {
  if (wait.region < CARTRIDGE || !wait.prefetch) return cycles;
  int previous = 0, most = 8;
  uint32_t ahead = wait.prefetched - pc_register;
  if (ahead < 16) {
    previous = (int)(ahead >> 1);
    most -= previous;
  }
  int s = wait.s16[wait.region], first_to_sequential = wait.n16[wait.region] - wait.s16[wait.region] + 1;
  int taken = s + 1, loads = 1;
  while (taken < cycles && loads < most) {
    taken += s;
    ++loads;
  }
  wait.prefetched = pc_register + 2 * (uint32_t)(loads + previous - 1);
  if (taken > cycles) cycles = taken;
  return cycles - first_to_sequential - (taken - 1);
}

// one load or store of `bytes` at `address`: its region's first-access wait, and the processor's own cycle or two
static int access_time(uint32_t pc_register, uint32_t address, int bytes, int writes) {
  int region = (address >> 24) & 15;
  int cycles = (bytes == 4 && region < SRAM) ? wait.n32[region] : wait.n16[region];
  cycles += writes ? 1 : 2;
  if (address < 0x08000000) cycles = stall(pc_register, cycles);
  return cycles;
}

// a block move of `words` words from `address`
static int block_time(uint32_t pc_register, uint32_t address, int words, int writes) {
  int region = (address >> 24) & 15;
  int cycles = wait.s32[region] - wait.n32[region];
  for (int i = 0; i < words; i++) cycles += wait.s32[region] + 1;
  if (!words) cycles += wait.s32[region] + 16;
  if (!writes) ++cycles;
  if (address < 0x08000000) cycles = stall(pc_register, cycles);
  return cycles;
}

// the pipeline filled again after a jump, from where it lands
static int jump_time(uint32_t to, int thumb) {
  wait.prefetched = 0;
  wait.region = (to >> 24) & 15;
  return thumb ? 2 + wait.n16[wait.region] + wait.s16[wait.region] : 2 + wait.n32[wait.region] + wait.s32[wait.region];
}

// a multiply's extra cycles, by how many of its first register's bytes aren't all 0 or all 1
static int multiply_time(uint32_t pc_register, uint32_t r) {
  int cycles = (r & 0xFFFFFF00u) == 0xFFFFFF00u || !(r & 0xFFFFFF00u) ? 1
             : (r & 0xFFFF0000u) == 0xFFFF0000u || !(r & 0xFFFF0000u) ? 2
             : (r & 0xFF000000u) == 0xFF000000u || !(r & 0xFF000000u) ? 3 : 4;
  return stall(pc_register, cycles);
}

// ---------------------------------------------------------------------------------------------------------------
// The events between instructions, on the emulator's own rules (its mTiming): the DMA channels, which hold the
// processor while they run, the timers, and the sound's two FIFOs, which a timer's overflow takes a sample from and
// which ask their DMA for more when half empty. `master` is the time events have run to, `cycles` the processor's
// beyond it.

static int64_t master, cycles;
#define NOW (master + cycles)

// The first frame ends where the emulator's display reaches the V-blank: it starts on line 126 with 117 cycles to the
// line's H-blank, which takes 224, and 33 lines of 1,232 more reach line 160. Each one after ends a frame later: 228
// lines of 1,232.
enum { LINE = 1232, HBLANK = 224, LINES = 228, FRAME = LINES * LINE, FIRST_HBLANK = 117, FIRST_LINE = 126,
       FIRST_FRAME_END = FIRST_HBLANK + HBLANK + (160 - 127) * LINE };

static struct dma {
  uint32_t source, dest, count, next_source, next_dest, next_count;
  uint16_t control;
  int64_t when;
} dma[4];
static int active_dma = -1, blocked;
static int64_t dma_event = -1;
static const int STEP[4] = { 1, -1, 0, 1 };   // a DMA address's step for each of its settings, in units

static struct timer {
  int enabled, counts_up, prescale, interrupts;
  uint16_t reload, counter;
  int64_t last, when;
} timers[4];

// each FIFO as the emulator keeps it (its GBAAudioFIFO): eight words in a ring, which a word written when all eight are
// taken writes over, so it reads as nearly empty again, the word it plays from, a byte at a time, and how many of its
// bytes are left
static struct fifo { int written, read, left, dma; uint32_t words[8], sample; } fifos[2];
// the game's own copy of the registers (gba_clock_registers)
static const volatile uint16_t *register_file;
// what's told of each sample a FIFO plays from a timer's overflow on (gba_clock_on_fifo)
static void (*on_fifo)(int which, uint64_t when, int value);
void gba_clock_on_fifo(void (*latch)(int which, uint64_t when, int value)) { on_fifo = latch; }
static uint16_t soundcnt_high, soundcnt_x, soundbias = 0x200;
// The emulator's mix (its sampleEvent and lastSample): every 1024 cycles it takes the steps of the 1024 before, 4 of
// 256 cycles at the bias's rate of 65536 a second, from `step_start` on, and a FIFO's sample goes to the steps the
// time to the next of those says (GBAAudioSampleFIFO). The emulator schedules its next from the time it ran at, less
// how late, so an interrupt taken earlier in the same turn, which moves that time on by 2, moves it on for good; the
// clock keeps it on its 1024 cycles, as the interrupts it takes aren't the emulator's in every turn of a frame yet
// (kit/gba/c/README.md, The console's own sound engine).
static int64_t step_when, step_start;

// The interrupts, on the emulator's rules (its GBARaiseIRQ, GBATestIRQ and _triggerIRQ, and ARMRaiseIRQ; mgba-emu/mgba
// 26b7884b, 0.10.5): one that's raised sets its bit of IF, and with a bit of IF that IE has too, the processor is asked
// 7 cycles later, unless it's been asked already and not yet answered. Asked, it wakes if it was halted, and takes the
// interrupt if IME is on and it isn't keeping interrupts off, which it does from taking one until the BIOS gives the
// interrupted code back, and during the first and last steps of a call to the BIOS.
enum { IRQ_DELAY = 7, IRQ_VBLANK = 0, IRQ_HBLANK = 1, IRQ_VCOUNT = 2 };
static struct {
  uint16_t enabled, flags, on, display;   // IE, IF, IME and DISPSTAT, as the game wrote them
  int off;                                // the processor keeping interrupts off
  int halted, taken;                      // waiting for one, and one taken that the next instruction comes after
  int quiet;                              // while the time catches up with a stretch the game didn't time
  int64_t when;                           // when the processor is asked
} irq;
// The display's two events a line, as the emulator has them: a line's H-blank starts, and 224 cycles on the next
// line starts, 1,008 before its own H-blank. Each is set from the time the one before it ran at, so the 2 cycles the
// processor's jump to the interrupt vector takes, when it comes just before one in the same turn of the events, move
// every line and every frame's end after it by 2, as they do in the emulator.
static struct {
  int64_t when;            // the next event
  int hblank;              // whether it's a line's H-blank starting, and not the next line
  int line;                // the line the display is on, which VCOUNT holds
  uint32_t vblanks;        // how many times it reached the V-blank, each a frame's end
  int64_t vblank_at[16];   // when the latest ones were
} video;
static void (*interrupt_handler)(void);
static void (*line_drawn)(int y);
void gba_clock_on_line(void (*line)(int y)) { line_drawn = line; }
static uint32_t interrupt_address;

static void irq_test(int64_t late) {
  if ((irq.enabled & irq.flags) && irq.when == INT64_MAX) irq.when = NOW - late + IRQ_DELAY;
}
static void irq_raise(int which, int64_t late) {
  if (irq.quiet) return;
  irq.flags |= (uint16_t)(1u << which);
  irq_test(late);
}

static void dma_update(void) {
  int64_t least = 0;
  active_dma = -1;
  for (int i = 0; i < 4; i++) {
    if (!(dma[i].control & 0x8000) || !dma[i].next_count) continue;
    int64_t time = dma[i].when - NOW;
    if (active_dma < 0 || time < least) {
      least = time;
      active_dma = i;
    }
  }
  if (active_dma >= 0) dma_event = dma[active_dma].when;
  else {
    dma_event = -1;
    blocked = 0;
  }
}

static void dma_schedule(int n) {
  int timing = (dma[n].control >> 12) & 3;
  if (timing == 0) {
    dma[n].when = NOW + 3;
    dma[n].next_count = dma[n].count;
  } else if (timing != 3) return;
  dma_update();
}

static void fifo_written(int which, uint32_t word) {
  struct fifo *f = &fifos[which];
  f->words[f->written] = word;
  f->written = (f->written + 1) & 7;
}

#ifndef GBA_CLOCK_DATA
// the word a DMA reads at `at`: the console's memory, where the same-memory build keeps it, with its mirrors, or the
// player's copy in the cartridge, and elsewhere what the DMA read last, as the emulator's DMA keeps it
static uint32_t dma_read_last;
static uint32_t data32(uint32_t at) {
  at &= ~3u;
  if (at >> 24 == 2) return dma_read_last = *(const volatile uint32_t *)(uintptr_t)(0x02000000u | (at & 0x3FFFF));
  if (at >> 24 == 3) return dma_read_last = *(const volatile uint32_t *)(uintptr_t)(0x03000000u | (at & 0x7FFF));
  if (at >= 0x08000000u && at < 0x0E000000u && (at & 0x01FFFFFF) + 4 <= kit_copy_size) {
    uint32_t o = at & 0x01FFFFFF;
    return dma_read_last = (uint32_t)(kit_copy[o] | kit_copy[o + 1] << 8 | kit_copy[o + 2] << 16 | (uint32_t)kit_copy[o + 3] << 24);
  }
  return dma_read_last;
}
#else
uint32_t GBA_CLOCK_DATA(uint32_t at);
#define data32 GBA_CLOCK_DATA
#endif

// one unit of a DMA: a first one's waits, then sequential ones'
static void dma_unit(int n) {
  struct dma *d = &dma[n];
  uint32_t width = 2u << ((d->control >> 10) & 1);
  int from = (d->next_source >> 24) & 15, to = (d->next_dest >> 24) & 15;
  int time = 2;
  if (d->count == d->next_count) time += width == 4 ? wait.n32[from] + wait.n32[to] : wait.n16[from] + wait.n16[to];
  else time += width == 4 ? wait.s32[from] + wait.s32[to] : wait.s16[from] + wait.s16[to];
  d->when += time;
  blocked = 1;
  if ((d->next_dest & ~3u) == 0x040000A0) fifo_written(0, data32(d->next_source));
  if ((d->next_dest & ~3u) == 0x040000A4) fifo_written(1, data32(d->next_source));
  int source_step = d->next_source >= 0x08000000 && d->next_source < 0x0E000000 && ((d->control >> 7) & 3) < 3
    ? (int)width : STEP[(d->control >> 7) & 3] * (int)width;
  if (d->next_source) d->next_source += (uint32_t)source_step;
  d->next_dest += (uint32_t)(STEP[(d->control >> 5) & 3] * (int)width);
  d->next_count--;
  for (int i = 0; i < 4; i++)
    if (dma[i].when < d->when && (dma[i].control & 0x8000) && dma[i].next_count) dma[i].when = d->when;
  if (!d->next_count) {
    d->next_count = 0x80000000u;
    if (from < CARTRIDGE || to < CARTRIDGE) d->when += 2;
  }
  dma_update();
}

static void dma_due(void) {
  struct dma *d = &dma[active_dma];
  if (d->next_count == d->count) d->when = NOW;
  if (d->next_count & 0xFFFFF) dma_unit(active_dma);
  else {
    int timing = (d->control >> 12) & 3;
    d->next_count = 0;
    if (!(d->control & 0x0200) || timing == 0) d->control &= (uint16_t)~0x8000;
    if (((d->control >> 5) & 3) == 3) d->next_dest = d->dest;
    dma_update();
  }
}

static void timer_count(int n, int64_t late) {
  struct timer *t = &timers[n];
  if (!t->enabled || t->counts_up) return;
  int64_t mask = (1 << t->prescale) - 1, now = (NOW - late) & ~mask;
  int64_t ticks = ((now - t->last) >> t->prescale) + t->counter;
  t->last = now;
  while (ticks >= 0x10000) ticks -= 0x10000 - t->reload;
  t->counter = (uint16_t)ticks;
  t->when = (now + ((0x10000 - ticks) << t->prescale)) & ~mask;
}

static void fifo_sample(int which, int64_t late) {
  struct fifo *f = &fifos[which];
  int size = f->written >= f->read ? f->written - f->read : 8 - f->read + f->written;
  if (8 - size > 4 && f->dma > 0) {
    struct dma *d = &dma[f->dma];
    if (((d->control >> 12) & 3) == 3) {
      d->when = NOW - late;
      d->next_count = 4;
      dma_schedule(f->dma);
    }
  }
  if (!f->left && size) {
    f->sample = f->words[f->read];
    f->left = 4;
    f->read = (f->read + 1) & 7;
  }
  // the byte it plays from now on: the emulator puts it in the steps of the mix's 1024 cycles from the one the time to
  // its next says, rounded up, and in none when that's less than a step's worth, as when it runs in the few cycles
  // just before that time
  int res = soundbias >> 14, bits = 2 << res, shift = 9 - res;
  int64_t until = (step_when - NOW - 1 + (1 << shift)) >> shift;
  if (until > bits) until = bits;
  if (on_fifo && until > 0) on_fifo(which, (uint64_t)(step_start + (bits - until) * (0x200 >> res)), (int8_t)(f->sample & 0xFF));
  if (f->left) {
    f->sample >>= 8;
    f->left--;
  }
}

static void timer_overflows(int n, int64_t late) {
  struct timer *t = &timers[n];
  if (t->counts_up) t->counter = t->reload;
  else timer_count(n, late);
  if (t->interrupts) irq_raise(3 + n, late);
  if ((soundcnt_x & 0x80) && n < 2) {
    if ((soundcnt_high & 0x0300) && ((soundcnt_high >> 10) & 1) == n) fifo_sample(0, late);
    if ((soundcnt_high & 0x3000) && ((soundcnt_high >> 14) & 1) == n) fifo_sample(1, late);
  }
}

static int64_t next_event(void) {
  int64_t best = INT64_MAX;
  for (int i = 0; i < 4; i++)
    if (timers[i].enabled && !timers[i].counts_up && timers[i].when < best) best = timers[i].when;
  if (dma_event >= 0 && dma_event < best) best = dma_event;
  if (step_when < best) best = step_when;
  if (video.when < best) best = video.when;
  if (irq.when < best) best = irq.when;
  return best;
}

static int jump_time(uint32_t to, int thumb);

// time to `master + by`, each event due on the way run in turn: at the same time, the processor asked about an
// interrupt first, then the display, the timers and a DMA, as the emulator orders them. `cycles` is 0 through it,
// but for the 2 an interrupt taken adds, which the events after it in the same turn see, as the emulator's do.
static void tick(int64_t by) {
  master += by;
  for (;;) {
    int64_t when = INT64_MAX;
    int which = -1;
    for (int i = 0; i < 4; i++)
      if (timers[i].enabled && !timers[i].counts_up && timers[i].when <= master && timers[i].when < when) {
        when = timers[i].when;
        which = i;
      }
    if (dma_event >= 0 && dma_event <= master && dma_event < when) {
      when = dma_event;
      which = 4;
    }
    if (step_when <= master && step_when <= when) {
      when = step_when;
      which = 7;
    }
    if (video.when <= master && video.when <= when) {
      when = video.when;
      which = 5;
    }
    if (irq.when <= master && irq.when <= when) {
      when = irq.when;
      which = 6;
    }
    if (which < 0) return;
    int64_t late = master - when;
    if (which == 4) {
      dma_event = -1;
      dma_due();
    } else if (which == 7) {
      step_start += 1024;
      step_when += 1024;
    } else if (which == 5 && video.hblank) {
      // a line's H-blank starts, with its interrupt if DISPSTAT asks for it, 6 cycles on; a line of the picture is
      // drawn now, as the emulator draws it
      video.hblank = 0;
      video.when = NOW - late + HBLANK;
      if (irq.display & 0x0010) irq_raise(IRQ_HBLANK, late - 6);
      if (video.line < 160 && line_drawn) line_drawn(video.line);
    } else if (which == 5) {
      // the next line starts: the line count's interrupt on the line DISPSTAT names, and at line 160 the V-blank,
      // which is a frame's end, and its interrupt
      video.hblank = 1;
      video.when = NOW - late + (LINE - HBLANK);
      video.line = (video.line + 1) % LINES;
      if ((irq.display & 0x0020) && video.line == irq.display >> 8) irq_raise(IRQ_VCOUNT, late);
      if (video.line == 160) {
        video.vblank_at[video.vblanks++ & 15] = when;
        if (irq.display & 0x0008) irq_raise(IRQ_VBLANK, late);
      }
    } else if (which == 6) {
      irq.when = INT64_MAX;
      irq.halted = 0;
      if ((irq.enabled & irq.flags) && irq.on && !irq.off && interrupt_handler) {
        // taken: the processor goes to the BIOS's vector, its pipeline filled again from there
        irq.off = irq.taken = 1;
        cycles += jump_time(0, 0);
      }
    } else {
      timers[which].when = INT64_MAX;
      timer_overflows(which, late);
    }
  }
}

// the events due before the processor goes on, a DMA holding it until it's done
static void run_events(void) {
  int64_t next = next_event() - master;
  while (cycles >= next) {
    next = 0;
    do {
      int64_t ran = cycles;
      cycles = 0;
      tick(ran < next ? next : ran);
      next = next_event() - master;
    } while (blocked);
  }
  if (blocked) cycles = next;
}

static uint64_t started;

void gba_clock_write16(uint32_t address, uint16_t value) {
  // the instruction storing it runs from its start's time, as the emulator's store does
  int64_t kept = cycles;
  cycles = (int64_t)started - master;
  uint32_t at = address & 0x3FE;
  if (at == 0x204) set_waitcnt(value);
  // the display's and the interrupts' own: a write of any of the three asks the processor again, a cycle sooner
  if (at == 0x004) irq.display = value;
  if (at == 0x200 || at == 0x202 || at == 0x208) {
    if (at == 0x200) irq.enabled = value;
    if (at == 0x202) irq.flags &= (uint16_t)~value;
    if (at == 0x208) irq.on = value & 1;
    irq_test(1);
  }
  if (at >= 0xB0 && at < 0xE0) {
    int n = (int)(at - 0xB0) / 12, part = (int)(at - 0xB0) % 12;
    struct dma *d = &dma[n];
    if (part == 0) d->source = (d->source & 0xFFFF0000u) | value;
    if (part == 2) d->source = (d->source & 0xFFFFu) | (uint32_t)value << 16;
    if (part == 4) d->dest = (d->dest & 0xFFFF0000u) | value;
    if (part == 6) d->dest = (d->dest & 0xFFFFu) | (uint32_t)value << 16;
    if (part == 8) d->count = value ? value : (n == 3 ? 0x10000u : 0x4000u);
    if (part == 10) {
      int was = d->control & 0x8000;
      d->control = value & (n < 3 ? 0xF7E0 : 0xFFE0);
      if (!was && (d->control & 0x8000)) {
        uint32_t width = 2u << ((d->control >> 10) & 1);
        d->next_source = d->source & -width;
        d->next_dest = d->dest & -width;
        if (((d->control >> 12) & 3) == 3 && (n == 1 || n == 2)) {
          // a sound FIFO's: a word at a time to a fixed address
          d->control = (uint16_t)((d->control & ~0x0460) | 0x0440);
          if (d->dest == 0x040000A0) fifos[0].dma = n;
          if (d->dest == 0x040000A4) fifos[1].dma = n;
        }
        dma_schedule(n);
      }
    }
  }
  if (at >= 0x100 && at < 0x110) {
    int n = (int)(at - 0x100) / 4;
    struct timer *t = &timers[n];
    if (!(at & 2)) t->reload = value;
    else {
      static const int PRESCALE[4] = { 0, 6, 8, 10 };
      timer_count(n, 0);
      int was = t->enabled, was_up = t->counts_up, was_prescale = t->prescale;
      t->prescale = PRESCALE[value & 3];
      t->counts_up = n > 0 && (value & 4);
      t->interrupts = (value & 0x40) != 0;
      t->enabled = (value & 0x80) != 0;
      int again = was != t->enabled || was_up != t->counts_up || was_prescale != t->prescale;
      if (was != t->enabled && t->enabled) t->counter = t->reload;
      if (again) {
        t->when = INT64_MAX;
        if (t->enabled && !t->counts_up) {
          t->last = NOW & ~(int64_t)((1 << t->prescale) - 1);
          timer_count(n, 0);
        }
      }
    }
  }
  if (at == 0x82) {
    soundcnt_high = value;
    if (value & 0x0800) fifos[0].written = fifos[0].read = 0;
    if (value & 0x8000) fifos[1].written = fifos[1].read = 0;
  }
  if (at == 0x84) soundcnt_x = value;
  if (at == 0x88) soundbias = value;
  // a word written by the processor, as the emulator writes a halfword of it with the other half its copy holds
  if (at == 0xA0 || at == 0xA4) fifo_written(at == 0xA4, value | (uint32_t)(register_file ? register_file[(at + 2) >> 1] : 0) << 16);
  cycles = kept;
}

// ---------------------------------------------------------------------------------------------------------------
// The instructions. The emulator gives each the fetch of the next, one cycle and the code's sequential wait, then what
// it does: a load or store its access and the code's first-access wait over its sequential one, a jump the pipeline
// filled again, a shift by a register one cycle more, a multiply its own.

static uint32_t frame;
static int frame_ended;

// a frame's end: when the display reached its V-blank, for the latest ones gone by, and for one to come, when it
// will with the lines as long as they are
uint64_t gba_clock_frame_end(uint32_t f) {
  if (f < video.vblanks) return f + 16 >= video.vblanks ? (uint64_t)video.vblank_at[f & 15] : (uint64_t)FIRST_FRAME_END + (uint64_t)f * FRAME;
  int64_t next = video.when + (video.hblank ? HBLANK : 0) + (int64_t)((160 + LINES - (video.line + 1)) % LINES) * LINE;
  return (uint64_t)next + (uint64_t)(f - video.vblanks) * FRAME;
}
uint64_t gba_clock_now(void) { return (uint64_t)NOW; }
uint64_t gba_clock_started(void) { return started; }
uint32_t gba_clock_frame(void) { return frame; }
int gba_clock_frame_ended(void) { return frame_ended; }

static void interrupt(uint32_t pc, int thumb);

// before the instruction at `pc`: the events due, an interrupt if the processor took one, with the game's handler,
// and whether the instruction is the first of a new frame's to start after its end
static void begin(uint32_t pc, int thumb) {
  run_events();
  while (irq.taken) {
    irq.taken = 0;
    interrupt(pc, thumb);
    run_events();
  }
  frame_ended = 0;
  started = (uint64_t)NOW;
}
static void end(int time) {
  cycles += time;
  // the first instruction to start with the display's V-blank reached and not yet counted is its frame's last
  if (frame < video.vblanks) {
    frame_ended = 1;
    frame++;
  }
}

void gba_clock_thumb(uint32_t pc, uint16_t op, uint32_t next, uint32_t value, const gba_access *access, int count) {
  begin(pc, 1);
  wait.region = (pc >> 24) & 15;
  int time = 1 + wait.s16[wait.region];
  uint32_t pc_register = pc + 4;
  // a write of WAITCNT changes the waits as the instruction stores it, after the fetch was counted
  for (int i = 0; i < count; i++)
    if (access[i].writes && (access[i].address & ~1u) == 0x04000204 && access[i].bytes == 2) set_waitcnt((uint16_t)access[i].value);
  int first_over_sequential = wait.n16[wait.region] - wait.s16[wait.region];
  uint32_t to = next & ~1u;   // odd when it stays in Thumb code, as a bx's target says
  if ((op & 0xFC00) == 0x4000) {
    int alu = (op >> 6) & 15;
    if (alu == 2 || alu == 3 || alu == 4 || alu == 7) time += 1;                 // shifts by a register
    if (alu == 13) time += multiply_time(pc_register, value) + first_over_sequential;
  } else if ((op & 0xFC00) == 0x4400) {
    int kind = (op >> 8) & 3, rd = (op & 7) | ((op >> 4) & 8);
    if (kind == 3) time += jump_time(to, next & 1);                              // bx
    else if (rd == 15 && kind != 1) time += jump_time(to, 1);
  } else if ((op & 0xF600) == 0xB400 || (op & 0xF000) == 0xC000) {
    int writes = !(op & 0x0800), words = __builtin_popcount(op & ((op & 0xF000) == 0xC000 ? 0xFF : 0x1FF));
    time += block_time(pc_register, count ? access[0].address : 0, words, writes) + first_over_sequential;
    if (!writes && (((op & 0xF000) == 0xB000 && (op & 0x100)) || ((op & 0xF000) == 0xC000 && !(op & 0xFF)))) time += jump_time(to, 1);
  } else if ((op & 0xF800) == 0x4800 || (op & 0xF000) == 0x5000 || (op & 0xE000) == 0x6000 || (op & 0xF000) == 0x8000 || (op & 0xF000) == 0x9000) {
    for (int i = 0; i < count; i++) time += access_time(pc_register, access[i].address, (int)access[i].bytes, (int)access[i].writes) + first_over_sequential;
  } else if ((op & 0xF000) == 0xD000 && (op & 0x0F00) < 0x0E00) {
    if (to != pc + 2) time += jump_time(to, 1);                                  // a branch taken
  } else if ((op & 0xF800) == 0xE000 || (op & 0xF800) == 0xF800) time += jump_time(to, 1);
  end(time);
}

static int condition_holds(uint32_t cpsr, int condition) {
  int n = cpsr >> 31 & 1, z = cpsr >> 30 & 1, c = cpsr >> 29 & 1, v = cpsr >> 28 & 1;
  switch (condition) {
    case 0: return z;
    case 1: return !z;
    case 2: return c;
    case 3: return !c;
    case 4: return n;
    case 5: return !n;
    case 6: return v;
    case 7: return !v;
    case 8: return c && !z;
    case 9: return !c || z;
    case 10: return n == v;
    case 11: return n != v;
    case 12: return !z && n == v;
    case 13: return z || n != v;
    default: return 1;
  }
}

static int arm_time(uint32_t pc, uint32_t op, uint32_t next, int next_thumb, uint32_t cpsr, uint32_t value, const gba_access *access, int count) {
  wait.region = (pc >> 24) & 15;
  int time = 1 + wait.s32[wait.region], first_over_sequential = wait.n32[wait.region] - wait.s32[wait.region];
  uint32_t pc_register = pc + 8;
  if (!condition_holds(cpsr, (int)(op >> 28))) return time;
  if ((op & 0x0FFFFFF0) == 0x012FFF10) return time + jump_time(next, next_thumb);                         // bx
  if ((op & 0x0FC000F0) == 0x00000090) return time + multiply_time(pc_register, value) + first_over_sequential + (int)((op >> 21) & 1);
  if (((op & 0x0E000090) == 0x00000090 && (op & 0x60)) || (op & 0x0C000000) == 0x04000000) {
    for (int i = 0; i < count; i++) time += access_time(pc_register, access[i].address, (int)access[i].bytes, (int)access[i].writes) + first_over_sequential;
    if ((op & 0x00100000) && ((op >> 12) & 15) == 15) time += jump_time(next, next_thumb);                 // a load of pc
    return time;
  }
  if ((op & 0x0C000000) == 0) {
    if ((op & 0x0FB000F0) == 0x01000000 || (op & 0x0DB0F000) == 0x0120F000) return time;                  // mrs, msr
    if ((op & 0x02000010) == 0x00000010) time += 1;                                                         // shift by a register
    int kind = (int)((op >> 21) & 15);
    if (((op >> 12) & 15) == 15 && (kind < 8 || kind > 11)) time += jump_time(next, next_thumb);
    return time;
  }
  if ((op & 0x0E000000) == 0x08000000) {
    int writes = !(op & 0x00100000);
    time += block_time(pc_register, count ? access[0].address : 0, __builtin_popcount(op & 0xFFFF), writes) + first_over_sequential;
    if (!writes && (op & 0x8000)) time += jump_time(next, next_thumb);
    return time;
  }
  if ((op & 0x0E000000) == 0x0A000000) return time + jump_time(next, 0);                                 // b, bl
  return time;
}

void gba_clock_arm(uint32_t pc, uint32_t op, uint32_t next, uint32_t cpsr, uint32_t value, const gba_access *access, int count) {
  begin(pc, 0);
  end(arm_time(pc, op, next & ~1u, (int)(next & 1), cpsr, value, access, count));
}

// ---------------------------------------------------------------------------------------------------------------
// The BIOS's own code, as the emulator's runs it, a step at a time, each with the events due before it: all of it
// from the BIOS, which has no wait states, so a step is a cycle, and what it reaches of the rest of memory.

// what the game wrote to the registers and the runs haven't reached yet, and how many of its stores came after a frame's
// end in a run the frame ended in
enum { WAITING = 512 };
static uint32_t waiting_at[WAITING];
static uint16_t waiting_value[WAITING];
static int waiting_count, late;

static void (*frame_wait)(void);

void gba_clock_on_frame_end(void (*wait)(void)) { frame_wait = wait; }

// the frame over, if it ended: the game's wait ends the Dreamport's frame here
static void wait_if_ended(void) {
  if (frame_ended && frame_wait) frame_wait();
}
// a step of the BIOS's code taking `extra` cycles beyond its own, from the BIOS
#define BIOS_CODE 0x00000000u    // the BIOS's code, all of which jumps keep in the BIOS
static void bios(int extra) {
  begin(BIOS_CODE, 0);
  wait.region = BIOS;
  end(1 + extra);
  wait_if_ended();
}
// a step that writes the processor's status: interrupts kept off or let in again, and the processor asked again
static void bios_status(int extra, int off) {
  begin(BIOS_CODE, 0);
  wait.region = BIOS;
  irq.off = off;
  irq_test(0);
  end(1 + extra);
  wait_if_ended();
}
#define BIOS_STACK 0x03007F00u   // where the BIOS's stacks are: the fast work memory, no wait states
static int bios_block(int words, int writes) { return block_time(0, BIOS_STACK, words, writes); }
static int bios_load(uint32_t address, int bytes) { return access_time(0, address, bytes, 0); }
static int bios_store(uint32_t address, int bytes) { return access_time(0, address, bytes, 1); }


// whether the game's runs are timed: from power-on until the game first waits for a frame, after which they cost nothing
static int running;
// the return addresses of the calls the timed runs made, as the link register and the stack keep them, for a run that
// goes back to whichever call came to it
enum { CALLS = 32 };
static uint32_t calls[CALLS];
static int depth;

// An interrupt the processor took before the instruction at `pc`: the BIOS's vector and its code, which saves r0 to
// r3, r12 and lr and jumps to the handler whose address the game keeps at 0x03007FFC, the game's handler, and the
// BIOS's way back, which gives the registers back and goes on with the instruction, interrupts let in again.
static void interrupt(uint32_t pc, int thumb) {
  int kept = depth;
  bios(jump_time(BIOS_CODE, 0));
  bios(bios_block(6, 1));
  bios(0);
  bios(0);
  bios(bios_load(0x03FFFFFC, 4) + jump_time(interrupt_address, 0));
  calls[depth++ % CALLS] = GBA_CLOCK_BIOS_BACK;
  interrupt_handler();
  depth = kept;
  bios(bios_block(6, 0));
  begin(BIOS_CODE, 0);
  wait.region = BIOS;
  irq.off = 0;
  irq_test(0);
  end(1 + jump_time(pc, thumb));
  wait_if_ended();
}

void gba_clock_on_interrupt(uint32_t address, void (*handler)(void)) {
  interrupt_address = address;
  interrupt_handler = handler;
}
uint16_t gba_clock_interrupts(void) { return irq.flags; }
void gba_clock_raise(int interrupt) { irq_raise(interrupt, 0); }
void gba_clock_before(uint32_t pc) { if (running) begin(pc & ~1u, (int)(pc & 1)); }

static uint16_t (*check_read)(void);
static void (*check_write)(uint16_t value);
void gba_clock_on_wait(uint16_t (*read)(void), void (*write)(uint16_t value)) {
  check_read = read;
  check_write = write;
}

// The processor halted, as a write of HALTCNT from the BIOS leaves it: the time goes from event to event until the
// processor is asked about an interrupt, which wakes it whether or not it takes it. A frame whose end goes by with
// another after it before the processor wakes is over with no instruction to end it after.
static void halt(void) {
  irq.halted = 1;
  run_events();
  while (irq.halted) {
    int64_t next = next_event();
    if (next == INT64_MAX) break;
    if (cycles < next - master) cycles = next - master;
    run_events();
    while (irq.halted && frame + 1 < video.vblanks) {
      frame++;
      if (frame_wait) frame_wait();
    }
  }
}

void gba_clock_stop(void) { running = 0; }
int gba_clock_running(void) { return running; }

void gba_clock_start(void) {
  running = 1;
  depth = 0;
  memset(&wait, 0, sizeof wait);
  memcpy(wait.n16, RESET_N16, 16);
  memcpy(wait.n32, RESET_N32, 16);
  memcpy(wait.s16, RESET_S16, 16);
  memcpy(wait.s32, RESET_S32, 16);
  memset(dma, 0, sizeof dma);
  memset(timers, 0, sizeof timers);
  for (int i = 0; i < 4; i++) timers[i].when = INT64_MAX;
  soundbias = 0x200;
  step_when = 0;
  step_start = -1024;
  fifos[0] = (struct fifo){ 0, 0, 0, 1, { 0 }, 0 };
  fifos[1] = (struct fifo){ 0, 0, 0, 2, { 0 }, 0 };
  master = cycles = 0;
  memset(&irq, 0, sizeof irq);
  irq.when = INT64_MAX;
  memset(&video, 0, sizeof video);
  video.when = FIRST_HBLANK;
  video.hblank = 1;
  video.line = FIRST_LINE;
  active_dma = -1;
  blocked = 0;
  dma_event = -1;
  soundcnt_high = soundcnt_x = 0;
  frame = 0;
  frame_ended = 0;
  waiting_count = late = 0;
  // the BIOS from its reset: a branch to its start, which reads the cartridge's first instruction's top byte and,
  // with one there, goes on to the cartridge's start in ARM code
  bios(jump_time(BIOS_CODE, 0));
  bios(0);
  bios(bios_load(0x08000003, 1));
  bios(0);
  bios(0);
  bios(jump_time(0x08000000, 0));
}

// A call to the BIOS from the Thumb instruction at `pc`: the swi, which keeps interrupts off, the vector's branch to
// the dispatcher, which saves r11, r12 and lr, reads the call's number from the swi, looks its code up, keeps the mode,
// goes to the system mode with interrupts as the caller had them, saves r2 and lr there and goes to the call's code.
static void swi_enter(uint32_t pc, int off) {
  begin(pc, 1);
  wait.region = (pc >> 24) & 15;
  irq.off = 1;
  end(1 + wait.s16[wait.region] + jump_time(BIOS_CODE, 0));
  wait_if_ended();
  bios(jump_time(BIOS_CODE, 0));
  bios(0);
  bios(0);
  bios(0);
  bios(bios_block(3, 1));
  bios(bios_load(pc, 1));
  bios(0);
  bios(bios_load(0x00000100, 4));
  bios(0);
  bios(0);
  bios(0);
  bios(bios_block(1, 1));
  bios(0);
  bios(0);
  bios_status(0, off);
  bios(0);
  bios(bios_block(2, 1));
  bios(0);
  for (int i = 0; i < 6; i++) bios(0);
  bios(0);
  bios(jump_time(BIOS_CODE, 0));
}

// Back from the call's code: the dispatcher gives r2 and lr back, goes to the supervisor's mode with interrupts off,
// puts the mode and the registers back and returns to the Thumb code after the swi, interrupts as the caller had them.
static void swi_leave(uint32_t pc, int off) {
  bios(0);
  bios(0);
  bios(0);
  bios(bios_block(2, 0));
  bios_status(0, 1);
  bios(bios_block(1, 0));
  bios(0);
  bios(bios_block(3, 0));
  bios_status(jump_time(pc + 2, 1), off);
}

// The BIOS's wait for an interrupt (IntrWait, and VBlankIntrWait, which is one for the V-blank's with the flag
// cleared first): with `discard`, the interrupts of `flags` already acknowledged in the game's halfword at
// 0x03007FF8 are forgotten and the processor halts. Each time it wakes, with IME off, the halfword is looked at: with
// none of `flags` in it the processor halts again, and otherwise those are taken out of it and the wait is over.
// IME is on from there, whatever it was.
static void intr_wait(uint32_t discard, uint32_t flags) {
  bios(bios_block(3, 1));
  bios(0);
  bios(0);
  bios(0);
  bios(0);
  bios(discard ? 0 : jump_time(BIOS_CODE, 0));
  int halts = discard != 0;
  if (discard) {
    uint16_t word = check_read ? check_read() : 0;
    bios(bios_load(0x03FFFFF8, 2));
    bios(0);
    bios(bios_store(0x03FFFFF8, 2));
    if (check_write) check_write(word & (uint16_t)~flags);
  }
  for (;;) {
    if (halts) {
      bios(bios_store(0x04000301, 1));
      halt();
    }
    halts = 1;
    begin(BIOS_CODE, 0);
    wait.region = BIOS;
    irq.on = 0;
    irq_test(1);
    end(1 + bios_store(0x04000208, 1));
    wait_if_ended();
    bios(bios_load(0x03FFFFF8, 2));
    // with no halfword of the game's to look at, the first interrupt ends the wait
    uint16_t word = check_read ? check_read() : (uint16_t)flags, hit = word & (uint16_t)flags;
    bios(0);
    bios(0);
    bios(hit ? bios_store(0x03FFFFF8, 2) : 0);
    if (hit && check_write) check_write(hit ^ (uint16_t)flags);
    begin(BIOS_CODE, 0);
    wait.region = BIOS;
    irq.on = 1;
    irq_test(1);
    end(1 + bios_store(0x04000208, 1));
    wait_if_ended();
    if (hit) break;
    bios(jump_time(BIOS_CODE, 0));
  }
  bios(0);
  bios(bios_block(3, 0) + jump_time(BIOS_CODE, 0));
}

// What the game wrote to the registers in work it didn't time: no run of it will take those stores, and by its call
// to the BIOS they're over, so each takes effect as the time stands, in order, as what the register holds. A DMA
// channel started at once copied in that work, and isn't started again; one waiting for its moment waits for it.
static void settle(void) {
  for (int i = 0; i < waiting_count; i++) {
    uint32_t at = waiting_at[i] & 0x3FE;
    uint16_t value = waiting_value[i];
    if (at >= 0xB0 && at < 0xE0 && (at - 0xB0) % 12 == 10 && !(value >> 12 & 3)) value &= (uint16_t)~0x8000;
    gba_clock_write16(waiting_at[i], value);
  }
  waiting_count = 0;
}

// CpuSet copies or fills a halfword or a word at a time, and `unit` does the game's work of each, as its store runs,
// `index` from 0. Halt, IntrWait and VBlankIntrWait wait for an interrupt, the game's handler run from inside them.
int gba_clock_swi(uint32_t pc, uint8_t number, uint32_t r0, uint32_t r1, uint32_t r2, void (*unit)(uint32_t index)) {
  if ((number != 0x0B && number != 0x02 && number != 0x04 && number != 0x05) || !running) return -1;
  settle();
  int off = irq.off;
  swi_enter(pc, off);
  if (number == 0x02) {
    // Halt: HALTCNT written, and back once the processor wakes
    bios(0);
    bios(0);
    bios(bios_store(0x04000301, 1));
    halt();
    bios(jump_time(BIOS_CODE, 0));
    swi_leave(pc, off);
    return 0;
  }
  if (number != 0x0B) {
    if (number == 0x05) {
      bios(0);
      bios(0);
      r0 = r1 = 1;
    }
    intr_wait(r0, r1);
    swi_leave(pc, off);
    return 0;
  }
  // CpuSet: saves r4, r5 and lr, takes its arguments, and fills or copies by words or halfwords
  int fill = (r2 & 0x01000000) != 0, words = (r2 & 0x04000000) != 0;
  uint32_t count = r2 & 0x1FFFFF, source = r0, dest = r1;
  bios(bios_block(3, 1));
  bios(0);
  bios(0);
  bios(0);
  bios(0);
  bios(fill ? 0 : jump_time(BIOS_CODE, 0));
  if (fill) {
    bios(0);
    bios(words ? 0 : jump_time(BIOS_CODE, 0));
    if (words) {
      bios(0);
      bios(block_time(0, source, 1, 0));
      for (uint32_t i = 0; i < count; i++) {
        bios(0);
        begin(BIOS_CODE, 0);
        wait.region = BIOS;
        end(1 + block_time(0, dest + 4 * i, 1, 1));
        if (unit) unit(i);
        wait_if_ended();
        bios(jump_time(BIOS_CODE, 0));
      }
      bios(0);
      bios(0);
      bios(0);
      bios(jump_time(BIOS_CODE, 0));
    } else {
      bios(0);
      bios(0);
      bios(0);
      bios(bios_load(source & ~1u, 2));
      for (uint32_t i = 0; i < count; i++) {
        bios(0);
        begin(BIOS_CODE, 0);
        wait.region = BIOS;
        end(1 + bios_store((dest & ~1u) + 2 * i, 2));
        if (unit) unit(i);
        wait_if_ended();
        bios(jump_time(BIOS_CODE, 0));
      }
      bios(0);
      bios(0);
      bios(0);
      bios(jump_time(BIOS_CODE, 0));
    }
  } else {
    bios(0);
    bios(words ? 0 : jump_time(BIOS_CODE, 0));
    if (words) {
      bios(0);
      for (uint32_t i = 0; i < count; i++) {
        bios(0);
        bios(block_time(0, source + 4 * i, 1, 0));
        begin(BIOS_CODE, 0);
        wait.region = BIOS;
        end(1 + block_time(0, dest + 4 * i, 1, 1));
        if (unit) unit(i);
        wait_if_ended();
        bios(jump_time(BIOS_CODE, 0));
      }
      bios(0);
      bios(0);
      bios(0);
      bios(0);
      bios(jump_time(BIOS_CODE, 0));
    } else {
      bios(0);
      for (uint32_t i = 0; i < count; i++) {
        bios(0);
        bios(bios_load(source + 2 * i, 2));
        begin(BIOS_CODE, 0);
        wait.region = BIOS;
        end(1 + bios_store(dest + 2 * i, 2));
        if (unit) unit(i);
        wait_if_ended();
        bios(jump_time(BIOS_CODE, 0));
      }
      bios(0);
      bios(0);
      bios(0);
      bios(0);
    }
  }
  // the end: r3 as the console's BIOS leaves it, and back to the dispatcher
  bios(0);
  bios(bios_block(3, 0) + jump_time(BIOS_CODE, 0));
  swi_leave(pc, off);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// A run of the original's Thumb instructions, read from the player's copy, whose work the game has just done. What it
// wrote to the registers waits here until the run's store of each, which takes it at that store's own time.


#ifndef GBA_CLOCK_CODE
// the code at `at`: the player's copy in the cartridge, or what the game copied to the console's memory, where the
// same-memory build keeps it (gba_console_memory)
static uint16_t code16(uint32_t at) {
  if (at < 0x08000000u) return *(const volatile uint16_t *)(uintptr_t)at;
  uint32_t offset = at - 0x08000000u;
  if (offset + 2 > kit_copy_size) return 0;
  return (uint16_t)(kit_copy[offset] | kit_copy[offset + 1] << 8);
}
#else
uint16_t GBA_CLOCK_CODE(uint32_t at);
#define code16 GBA_CLOCK_CODE
#endif


void gba_clock_written(uint32_t address, uint16_t value) {
  // with the time stopped, no run's store will take it: it's written as the time stands, and what it starts goes on
  // when the time does
  if (!running) {
    gba_clock_write16(address, value);
    return;
  }
  if (waiting_count == WAITING) {
    // more than any run writes: the oldest goes on now
    gba_clock_write16(waiting_at[0], waiting_value[0]);
    for (int i = 1; i < WAITING; i++) {
      waiting_at[i - 1] = waiting_at[i];
      waiting_value[i - 1] = waiting_value[i];
    }
    waiting_count--;
  }
  waiting_at[waiting_count] = address & ~1u;
  waiting_value[waiting_count++] = value;
}

// a game's own copy of the registers, where it keeps what it writes there without telling the clock
static const volatile uint16_t *register_file;
void gba_clock_registers(const volatile uint16_t *file) { register_file = file; }

// a halfword of the game's copy of the registers, as the console's would hold it: a DMA channel's address that points
// into the copy itself, as a sound channel's to its FIFO does, is the console's register there
static uint16_t register_held(uint32_t half) {
  uint32_t at = half - 0x04000000u;
  uint16_t now = register_file[at >> 1];
  if (at >= 0xB0 && at < 0xE0 && (at - 0xB0) % 12 < 8) {
    uint32_t word = (at & ~3u) >> 1;
    uint32_t value = (uint32_t)register_file[word] | (uint32_t)register_file[word + 1] << 16;
    uint32_t file = (uint32_t)(uintptr_t)register_file;
    if (value - file < 0x400) {
      value = 0x04000000u + (value - file);
      now = (uint16_t)(half & 2 ? value >> 16 : value);
    }
  }
  return now;
}

// what the game wrote to the registers a store of `bytes` at `address` reaches, the earliest write of each halfword
// that waits: WAITCNT's value, which changes the store's own waits, alone (`waitcnt`), or the rest, at the time the
// store started
static int take_written(uint32_t address, uint32_t bytes, int waitcnt) {
  int value = -1;
  for (uint32_t half = address & ~1u; half < address + bytes; half += 2) {
    if ((half == 0x04000204) != (waitcnt != 0)) continue;
    int found = 0;
    for (int i = 0; i < waiting_count && !found; i++) {
      if (waiting_at[i] != half) continue;
      if (waitcnt) value = waiting_value[i];
      else gba_clock_write16(waiting_at[i], waiting_value[i]);
      for (int j = i + 1; j < waiting_count; j++) {
        waiting_at[j - 1] = waiting_at[j];
        waiting_value[j - 1] = waiting_value[j];
      }
      waiting_count--;
      found = 1;
    }
    // none waits: what the game's copy of the registers holds now
    if (!found && register_file && half - 0x04000000u < 0x400) {
      uint16_t now = register_held(half);
      if (waitcnt) value = now;
      else gba_clock_write16(half, now);
    }
  }
  return value;
}

int gba_clock_late(void) { return late; }


// whether a Thumb instruction writes memory: a store, a push, a block store
static int thumb_writes(uint16_t op) {
  if ((op & 0xF000) == 0x5000) return ((op >> 9) & 7) <= 2;
  if ((op & 0xE000) == 0x6000 || (op & 0xF000) == 0x8000 || (op & 0xF000) == 0x9000 || (op & 0xF000) == 0xC000) return !(op & 0x0800);
  return (op & 0xF600) == 0xB400;
}

// A Thumb instruction that goes back from a call: bx, a pop into the program counter or a mov to it.
static int thumb_returns(uint16_t op) { return (op & 0xFF80) == 0x4700 || (op & 0xFF00) == 0xBD00 || (op & 0xFF87) == 0x4687; }

void gba_clock_run(uint32_t from, uint32_t to, uint32_t next, const uint32_t *at, int count) {
  if (!running) return;
  int k = 0, ended = 0;
  // the call it goes back to, the latest one's: a run whose return the game names goes back from that call too
  if (thumb_returns(code16(to))) {
    if (next == GBA_CLOCK_BACK) next = depth ? calls[--depth % CALLS] : 0x08000001u;   // none timed: the cartridge's
    else if (depth && (calls[(depth - 1) % CALLS] & ~1u) == (next & ~1u)) depth--;
  }
  // a bl's second half, which is the run's last instruction, keeps where the call goes back to
  if ((code16(to) & 0xF800) == 0xF800) calls[depth++ % CALLS] = to + 3;
  for (uint32_t pc = from; pc <= to; pc += 2) {
    uint16_t op = code16(pc);
    gba_access a[1] = { { 0, 0, 0, 0 } };
    int n = 0;
    uint32_t value = 0;
    if ((op & 0xF800) == 0x4800) {
      a[0] = (gba_access){ ((pc + 4) & ~3u) + (op & 0xFF) * 4u, 4, 0, 0 };   // a load from the code's pool
      n = 1;
    } else if ((op & 0xF000) == 0x9000) {
      a[0] = (gba_access){ BIOS_STACK, 4, !(op & 0x0800), 0 };              // the stack
      n = 1;
    } else if ((op & 0xF600) == 0xB400) {
      a[0] = (gba_access){ BIOS_STACK, 0x100u | (uint32_t)__builtin_popcount(op & 0x1FF), !(op & 0x0800), 0 };
      n = 1;
    } else if ((op & 0xF000) == 0xC000) {
      a[0] = (gba_access){ k < count ? at[k++] : 0, 0x100u | (uint32_t)__builtin_popcount(op & 0xFF), !(op & 0x0800), 0 };
      n = 1;
    } else if ((op & 0xF000) == 0x5000 || (op & 0xE000) == 0x6000 || (op & 0xF000) == 0x8000) {
      int writes, bytes;
      if ((op & 0xF000) == 0x5000) {
        static const int BYTES[8] = { 4, 2, 1, 1, 4, 2, 1, 2 };
        bytes = BYTES[(op >> 9) & 7];
        writes = ((op >> 9) & 7) <= 2;
      } else if ((op & 0xE000) == 0x6000) {
        bytes = op & 0x1000 ? 1 : 4;
        writes = !(op & 0x0800);
      } else {
        bytes = 2;
        writes = !(op & 0x0800);
      }
      a[0] = (gba_access){ k < count ? at[k++] : 0, (uint32_t)bytes, (uint32_t)writes, 0 };
      n = 1;
    } else if ((op & 0xFFC0) == 0x4340) value = k < count ? at[k++] : 0;   // mul: what it multiplies by
    // a store to the registers takes what the game wrote there as it runs, WAITCNT's within the instruction
    int registers = n && a[0].writes && (a[0].address >> 24) == 4;
    uint32_t reach = a[0].bytes & 0x100 ? 4 * (a[0].bytes & 0xFF) : a[0].bytes;
    if (registers) {
      int waitcnt = take_written(a[0].address, reach, 1);
      if (waitcnt >= 0) a[0].value = (uint32_t)waitcnt;
    }
    gba_clock_thumb(pc, op, pc == to ? next : pc + 2, value, a, n);
    if (registers) take_written(a[0].address, reach, 0);
    if (frame_ended) ended++;
    // a store to the work memory after the frame's end, in a run the game did whole before the call, is one the
    // Dreamport's frame has and the console's doesn't: the run should end there
    else if (ended && thumb_writes(op) && !((op & 0xF000) == 0x9000 || (op & 0xF600) == 0xB400) && n && (a[0].address >> 24) != 4) late++;
  }
  while (ended-- > 0)
    if (frame_wait) frame_wait();
}

static uint32_t code32(uint32_t at) { return (uint32_t)code16(at) | (uint32_t)code16(at + 2) << 16; }

void gba_clock_run_arm(uint32_t from, uint32_t to, uint32_t next, const uint32_t *at, int count) {
  if (!running) return;
  int k = 0, ended = 0;
  for (uint32_t pc = from; pc <= to; pc += 4) {
    uint32_t op = code32(pc);
    gba_access a[1] = { { 0, 0, 0, 0 } };
    int n = 0;
    if ((op & 0x0C000000) == 0x04000000) {
      int writes = !(op & 0x00100000), bytes = op & 0x00400000 ? 1 : 4;
      uint32_t address = ((op >> 16) & 15) == 15 ? pc + 8 + ((op & 0x00800000) ? 1 : -1) * (op & 0xFFF) : (k < count ? at[k++] : 0);
      a[0] = (gba_access){ address, (uint32_t)bytes, (uint32_t)writes, 0 };
      n = 1;
    } else if ((op & 0x0E000090) == 0x00000090 && (op & 0x60)) {
      // a halfword's or a signed byte's load or store: strh, ldrh, ldrsb, ldrsh, its offset immediate or a register's
      int writes = !(op & 0x00100000), bytes = (op & 0x60) == 0x40 ? 1 : 2;
      uint32_t offset = (op >> 4 & 0xF0) | (op & 0xF);
      uint32_t address = ((op >> 16) & 15) == 15 && (op & 0x00400000) ? pc + 8 + ((op & 0x00800000) ? 1 : -1) * offset
                                                                         : (k < count ? at[k++] : 0);
      a[0] = (gba_access){ address, (uint32_t)bytes, (uint32_t)writes, 0 };
      n = 1;
    }
    // a branch whose condition fails goes on to the next instruction, and takes the time of any that doesn't run
    uint32_t after = pc == to ? next : pc + 4;
    if ((op & 0x0E000000) == 0x0A000000 && (op >> 28) != 14 && after == pc + 4) op = 0xE1A00000;
    // a store to the registers takes what the game wrote there as it runs, WAITCNT's within the instruction, as in
    // Thumb code
    int registers = n && a[0].writes && (a[0].address >> 24) == 4;
    if (registers) {
      int waitcnt = take_written(a[0].address, a[0].bytes, 1);
      if (waitcnt >= 0) a[0].value = (uint32_t)waitcnt;
    }
    gba_clock_arm(pc, op, after, 0, 0, a, n);
    if (registers) take_written(a[0].address, a[0].bytes, 0);
    if (frame_ended) ended++;
  }
  while (ended-- > 0)
    if (frame_wait) frame_wait();
}

// ---------------------------------------------------------------------------------------------------------------
// What a game's C does in one line and the original does in the libraries every game of the console's compiler has.

uint16_t gba_clock_vcount(void) {
  // the events due before the next instruction, which is the one that reads it
  run_events();
  return (uint16_t)video.line;
}

// libgcc's __divsi3, at `at`, as the console's compiler's library has it: the signs taken off, the divisor moved up
// four bits at a time and then one, the quotient's bits found four at a time, and the sign put back. Its path is the
// numbers' own, so it's worked out here, a run at a time, back to `back`; dividing by 0 calls __div0 and gives 0.
void gba_clock_divsi3(uint32_t at, int32_t numerator, int32_t denominator, uint32_t back) {
  uint32_t r0 = (uint32_t)numerator, r1 = (uint32_t)denominator, r3 = 1, r4, from = at;
#define DIVIDE_GOES(last, to)                              \
  do {                                                     \
    gba_clock_run(from, at + (last), at + (to) + 1, NULL, 0); \
    from = at + (to);                                      \
  } while (0)
  if (!r1) {
    DIVIDE_GOES(0x02, 0x88);
    DIVIDE_GOES(0x8C, 0x94);                               // __div0, which comes straight back
    DIVIDE_GOES(0x94, 0x8E);
    gba_clock_run(from, at + 0x90, back, NULL, 0);
    return;
  }
  if ((int32_t)r1 >= 0) DIVIDE_GOES(0x12, 0x16);
  else r1 = 0u - r1;
  if ((int32_t)r0 >= 0) DIVIDE_GOES(0x18, 0x1C);
  else r0 = 0u - r0;
  if (r0 < r1) DIVIDE_GOES(0x1E, 0x7A);
  else {
    r4 = 1u << 28;
    for (;;) {
      if (r1 >= r4) { DIVIDE_GOES(0x26, 0x32); break; }
      if (r1 >= r0) { DIVIDE_GOES(0x2A, 0x32); break; }
      r1 <<= 4;
      r3 <<= 4;
      DIVIDE_GOES(0x30, 0x24);
    }
    r4 <<= 3;
    for (;;) {
      if (r1 >= r4) { DIVIDE_GOES(0x36, 0x42); break; }
      if (r1 >= r0) { DIVIDE_GOES(0x3A, 0x42); break; }
      r1 <<= 1;
      r3 <<= 1;
      DIVIDE_GOES(0x40, 0x34);
    }
    for (;;) {
      if (r0 < r1) DIVIDE_GOES(0x44, 0x4A);
      else r0 -= r1;
      if (r0 < (r1 >> 1)) DIVIDE_GOES(0x4E, 0x56);
      else r0 -= r1 >> 1;
      if (r0 < (r1 >> 2)) DIVIDE_GOES(0x5A, 0x62);
      else r0 -= r1 >> 2;
      if (r0 < (r1 >> 3)) DIVIDE_GOES(0x66, 0x6E);
      else r0 -= r1 >> 3;
      if (!r0) { DIVIDE_GOES(0x70, 0x7A); break; }
      r3 >>= 4;
      if (!r3) { DIVIDE_GOES(0x74, 0x7A); break; }
      r1 >>= 4;
      DIVIDE_GOES(0x78, 0x42);
    }
  }
  if ((int32_t)((uint32_t)numerator ^ (uint32_t)denominator) >= 0) DIVIDE_GOES(0x80, 0x84);
  gba_clock_run(from, at + 0x86, back, NULL, 0);
#undef DIVIDE_GOES
}

// ---------------------------------------------------------------------------------------------------------------
// The console's time again, for a stretch a game has to time after power-on: the work it does in the V-blank, which
// asks the display whether the blank lines are over.

void gba_clock_resume(uint64_t time) {
  running = 1;
  // the timers and the sound's DMA go on to `time` as they would have, an event at a time, each at its own time: a
  // DMA that holds the processor past `time` leaves it there
  // (the interrupts of that stretch were the game's own to take: none is raised for it)
  irq.quiet = 1;
  while (NOW < (int64_t)time) {
    int64_t next = next_event(), to = next > NOW && next < (int64_t)time ? next : (int64_t)time;
    cycles += to - NOW;
    run_events();
  }
  irq.quiet = 0;
  // the frames whose ends went by meanwhile are over: the next instruction doesn't end them again
  frame = video.vblanks;
}
