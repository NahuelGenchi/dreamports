// The Nintendo DS's part of what the page calls, by name, to run a game in C (kit/c/game.js), and its two processors'
// programs side by side (kit/nds/c/README.md). The ARM9's program runs on the game's side (kit_run) and the ARM7's
// beside it (kit_run_beside), each with a time of its own in ticks of the console's clock, and before either reads or
// writes anything the other can, the one behind runs first up to the other's time, so their reads and writes happen in
// the order of their times. A frame of the proof tools runs from one V-blank's start to the next's, as a frame's
// picture and sound follow from what the programs wrote in the V-blank before it (tools/nds/melonds/libretro.cpp).
//
// The display is as melonDS puts it together (its GPU_Soft.cpp): each engine, A and B, on the screen the power
// register's top bit puts it on, white when its display is off or blanked, black for A and white for B when the power
// register turns it off, and black when the screens are off. With its display on, an engine draws its line (video.c).
// An engine's picture is the one its registers and memory hold once the V-blank's writes are done, as the console
// draws it in the frame after.
//
// A processor takes an interrupt (irq.c) as it next reads or writes once its time has reached it, and where it waits,
// for the V-blank or halted, at the interrupt's own time: the kit runs the BIOS's way to the game's handler, the
// handler, and the way back, then goes on. Where one processor can ask for the other's interrupts, through the sync
// register or the message queue, the waiting one runs beside the other, so it takes the interrupt where it comes.
//
// A DMA channel (dma.c) runs on its processor's bus, as the processor waits: one started by a write runs then, and one
// that waits for the V-blank runs from the V-blank's start, as the processor next reads or writes once its time has
// passed it, or where it waits, and the processor's own work after the V-blank waits as long.

#include "nds.h"
#include "nds-kit.h"
#include "kit.h"
#include "page.h"

uint8_t nds_main[0x400000];

static uint64_t t9, t7;            // each processor's time, in ticks from power-on
static uint64_t window_end;        // the end of the frame being run: the next V-blank's start
static int done9, done7;           // whether each has reached the end of the frame being run
#define NEVER UINT64_MAX
static void (*handlers[2])(void);  // each processor's interrupt handler
static int handling[2];            // whether each is in its handler
static int waiting[2], halted[2];  // whether each is waiting, and halted until an interrupt asks for it
static uint64_t woken_at[2];       // when the other processor woke a waiting one, or NEVER
static int frame;                  // the frame being run, -1 at power-on
static uint32_t held;              // the buttons, as console.h's bits
static int touched, touch_x, touch_y;

// the power register
static uint16_t powcnt = 0x820F;

// the serial bus to the touch screen's chip, and the chip
static uint16_t spicnt;
static uint64_t spi_until;         // when the transfer going on ends
static uint8_t tsc_control, tsc_data;
static int tsc_position;
static uint16_t tsc_result;

static uint64_t vblank_of(int f) { return (uint64_t)f * NDS_FRAME + NDS_VBLANK; }
int nds_frame(void) { return frame; }
uint64_t nds9_now(void) { return t9; }
uint64_t nds7_now(void) { return t7; }

void nds_not_yet(void) { __builtin_trap(); }

// The free BIOS's code around a game's own, in ticks of the clock, as melonDS runs it from the BIOS: the way to an
// interrupt's handler and back, and into a call (swi) and out. They're the kit's reckoning from the BIOS's
// instructions, which no test has measured yet: a game that reads a timer in its handler sees them.
#define TO_HANDLER9 20
#define FROM_HANDLER9 16
#define TO_HANDLER7 18
#define FROM_HANDLER7 14
#define INTO_CALL9 16
#define OUT_OF_CALL9 12
#define INTO_CALL7 14
#define OUT_OF_CALL7 10

uint64_t *nds_time(int seven) { return seven ? &t7 : &t9; }

// a processor's DMA channels that wait for the V-blank, once its time has passed one: they run from the V-blank's start
static void vblank_dmas(int seven) {
  uint64_t *now = seven ? &t7 : &t9, at;
  while (nds_dma_due(seven, *now, &at)) {
    uint64_t was = *now;
    *now = at;
    nds_dma_vblank(seven);
    *now = was + (*now - at);
  }
}

void nds9_on_interrupt(void (*handler)(void)) { handlers[0] = handler; }
void nds7_on_interrupt(void (*handler)(void)) { handlers[1] = handler; }

// whether a processor's interrupts would end its wait: halted, the ARM7 wakes for any it has on and the ARM9 only with
// IME on as well; waiting for the V-blank, each takes one it has on with IME on
static int would_wake(int seven) {
  if (!nds_irq_pending(seven)) return 0;
  if (halted[seven]) return seven || nds_irq_master(seven);
  return nds_irq_master(seven) && !handling[seven];
}

// a processor takes the interrupts its time has reached: the BIOS's way to its handler, the handler, and the way back
static void interrupts(int seven) {
  uint64_t *now = seven ? &t7 : &t9;
  while (!handling[seven]) {
    nds_irq_run(seven, *now);
    if (!nds_irq_master(seven) || !nds_irq_pending(seven)) return;
    if (!handlers[seven]) nds_not_yet();
    handling[seven] = 1;
    *now += seven ? TO_HANDLER7 : TO_HANDLER9;
    handlers[seven]();
    *now += seven ? FROM_HANDLER7 : FROM_HANDLER9;
    handling[seven] = 0;
  }
}

static void arm9_entry(void) {
  game_arm9();
  for (;;) kit_wait_frame();
}

static void arm7_entry(void) {
  game_arm7();
  for (;;) {
    done7 = 1;
    kit_wait_beside();
  }
}

// the ARM7 runs until it's caught up with the ARM9, or has nothing more to do this frame
static void catch_up7(void) {
  while (!done7 && t7 < t9) kit_run_beside(arm7_entry);
}

// the ARM7, ahead of the ARM9, lets it catch up before it reads or writes
static void wait7(void) {
  while (!done9 && t7 > t9) kit_wait_beside();
}

static uint64_t next_vblank(uint64_t now) {
  int f = now < NDS_VBLANK ? 0 : (int)((now - NDS_VBLANK) / NDS_FRAME) + 1;
  return vblank_of(f);
}

// a read or write of one processor's that asks for the other's interrupt wakes it where it waits for one: the ARM7
// runs again this frame, or lets the ARM9 go on from there
static void woke(int seven) {
  if (!waiting[seven] || woken_at[seven] != NEVER || !would_wake(seven)) return;
  woken_at[seven] = seven ? t9 : t7;
  if (seven) done7 = 0;
  else kit_wait_beside();
}

// whether the other processor can ask for one of this one's interrupts while it waits
static int beside(int seven, int halt) {
  return (nds_irq_enabled(seven) & 0x70000) && (halt || nds_irq_master(seven));
}

// The ARM9 doing nothing a game sees until `target`, or with `halt`, until an interrupt wakes it, taking those that
// come meanwhile, as the ARM7 runs up to each, or to the end of the frame.
static void wait9(uint64_t target, int halt) {
  waiting[0] = 1, halted[0] = halt;
  for (;;) {
    woken_at[0] = NEVER;
    vblank_dmas(0);
    nds_irq_run(0, t9);
    if (halt ? would_wake(0) : t9 >= target) break;
    if (!halt && !handling[0] && nds_irq_master(0) && nds_irq_pending(0)) {
      waiting[0] = 0;
      interrupts(0);
      waiting[0] = 1;
      continue;
    }
    uint64_t next = nds_irq_next(0), dma = nds_dma_next(0);
    if (dma < next) next = dma;
    if (!halt && target < next) next = target;
    if (next >= window_end) {
      done9 = 1;
      while (!done7 && woken_at[0] == NEVER) kit_run_beside(arm7_entry);
      done9 = 0;
      if (woken_at[0] != NEVER) { if (woken_at[0] > t9) t9 = woken_at[0]; continue; }
      kit_wait_frame();
      continue;
    }
    uint64_t from = t9;
    t9 = next;
    if (beside(0, halt)) {
      while (!done7 && t7 < t9 && woken_at[0] == NEVER) kit_run_beside(arm7_entry);
      if (woken_at[0] != NEVER) t9 = woken_at[0] > from ? woken_at[0] : from;
    }
  }
  waiting[0] = halted[0] = 0;
}

// The ARM7's the same, as far as the ARM9 has gone where the ARM9 can ask for one of its interrupts.
static void wait7_until(uint64_t target, int halt) {
  waiting[1] = 1, halted[1] = halt;
  woken_at[1] = NEVER;
  for (;;) {
    if (woken_at[1] != NEVER) {
      if (woken_at[1] > t7) t7 = woken_at[1];
      woken_at[1] = NEVER;
    }
    vblank_dmas(1);
    nds_irq_run(1, t7);
    if (halt ? would_wake(1) : t7 >= target) break;
    if (!halt && !handling[1] && nds_irq_master(1) && nds_irq_pending(1)) {
      waiting[1] = 0;
      interrupts(1);
      waiting[1] = 1;
      continue;
    }
    uint64_t next = nds_irq_next(1), dma = nds_dma_next(1);
    if (dma < next) next = dma;
    if (!halt && target < next) next = target;
    if (next >= window_end) {
      done7 = 1;
      kit_wait_beside();
      continue;
    }
    if (beside(1, halt) && !done9 && next > t9) {
      if (t7 < t9) t7 = t9;
      kit_wait_beside();
      continue;
    }
    t7 = next;
  }
  waiting[1] = halted[1] = 0;
}

void nds9_wait_vblank(uint32_t after) { wait9(next_vblank(t9) + after, 0); }
void nds7_wait_vblank(uint32_t after) { wait7_until(next_vblank(t7) + after, 0); }

void nds9_halt(void) {
  wait9(0, 1);
  interrupts(0);
}

// the BIOS's check of the interrupts a game's handler has said it took, at the end of the ARM9's data memory or of the
// ARM7's own: those wanted are taken from it, with IME off meanwhile and on after
static int taken(int seven, uint32_t wanted) {
  uint32_t at = seven ? 0x03FFFFF8 : 0x03003FF8;
  uint32_t word = seven ? nds7_read32(at) : nds9_read32(at);
  if (seven) {
    nds7_write32(0x04000208, 0x04000000);
    nds7_write32(at, word & ~wanted);
    nds7_write32(0x04000208, 1);
  } else {
    nds9_write32(0x04000208, 0x04000000);
    nds9_write32(at, word & ~wanted);
    nds9_write32(0x04000208, 1);
  }
  return (word & wanted) != 0;
}

void nds9_intr_wait(int discard, uint32_t wanted) {
  nds9_spend(2 * INTO_CALL9);
  if (discard) taken(0, wanted);
  do nds9_halt(); while (!taken(0, wanted));
  nds9_spend(2 * OUT_OF_CALL9);
}

void nds7_intr_wait(int discard, uint32_t wanted) {
  nds7_spend(INTO_CALL7);
  if (discard) taken(1, wanted);
  do nds7_write8(NDS_HALTCNT, 0x80); while (!taken(1, wanted));
  nds7_spend(OUT_OF_CALL7);
}

void nds9_spend(uint32_t cycles) { t9 += (cycles + 1) / 2; }
void nds7_spend(uint32_t cycles) { t7 += cycles; }

static uint32_t vcount(uint64_t now) { return (uint32_t)((now % NDS_FRAME) / NDS_LINE); }

// the ten buttons as the console's register has them, a 0 for each held
static uint32_t keyinput(void) {
  static const uint32_t BITS[][2] = {
    { BUTTON_A, 1 }, { BUTTON_B, 2 }, { BUTTON_SELECT, 4 }, { BUTTON_START, 8 }, { BUTTON_RIGHT, 16 }, { BUTTON_LEFT, 32 },
    { BUTTON_UP, 64 }, { BUTTON_DOWN, 128 }, { BUTTON_R, 256 }, { BUTTON_L, 512 },
  };
  uint32_t bits = 0x3FF;
  for (unsigned i = 0; i < sizeof BITS / sizeof BITS[0]; i++) if (held & BITS[i][0]) bits &= ~BITS[i][1];
  return bits;
}

// X, Y, the pen and the lid, as only the ARM7 reads them: a 0 for X or Y held and for the pen down, the lid open
static uint32_t extkeyin(void) {
  uint32_t bits = 0x7F;
  if (held & BUTTON_X) bits &= ~1u;
  if (held & BUTTON_Y) bits &= ~2u;
  if (touched) bits &= ~0x40u;
  return bits;
}

// the main memory, little-endian, with its mirrors
static uint32_t main_read(uint32_t address, int bytes) {
  const uint8_t *at = nds_main + (address & 0x3FFFFF & ~(uint32_t)(bytes - 1));
  return bytes == 1 ? at[0] : bytes == 2 ? (uint32_t)(at[0] | at[1] << 8) : at[0] | at[1] << 8 | at[2] << 16 | (uint32_t)at[3] << 24;
}
static void main_write(uint32_t address, uint32_t value, int bytes) {
  uint8_t *at = nds_main + (address & 0x3FFFFF & ~(uint32_t)(bytes - 1));
  for (int i = 0; i < bytes; i++) at[i] = (uint8_t)(value >> (8 * i));
}

// The ARM9's two fast memories, where the console's firmware leaves them for a game it starts, as the reference
// emulator's direct start puts them (melonDS's SetupDirectBoot): its code memory (ITCM), 32 KB, seen again and again up
// to 0x01FFFFFF, and its data memory (DTCM), 16 KB at 0x03000000, in front of the shared memory there. A game that moves
// them, with the system control coprocessor, isn't followed yet.
static uint8_t itcm[0x8000], dtcm[0x4000];
static uint8_t *fast_at(uint32_t address) {
  if (address < 0x02000000) return itcm + (address & 0x7FFF);
  if (address >= 0x03000000 && address < 0x03004000) return dtcm + (address & 0x3FFF);
  return 0;
}

static uint32_t arm9_load(uint32_t address, int bytes);
static void arm9_store(uint32_t address, uint32_t value, int bytes);
static uint32_t arm9_bus_load(uint32_t address, int bytes);
static void arm9_bus_store(uint32_t address, uint32_t value, int bytes);
static uint32_t arm7_load(uint32_t address, int bytes);
static void arm7_store(uint32_t address, uint32_t value, int bytes);

// a DMA channel's read and write, on its processor's bus: the ARM9's never reach its fast memories
uint32_t nds_bus_read(int seven, uint32_t address, int bytes) {
  if (seven) {
    wait7();
    uint32_t value = arm7_load(address, bytes);
    woke(0);
    return value;
  }
  catch_up7();
  uint32_t value = arm9_bus_load(address, bytes);
  woke(1);
  return value;
}

void nds_bus_write(int seven, uint32_t address, uint32_t value, int bytes) {
  if (seven) {
    wait7();
    arm7_store(address, value, bytes);
    woke(0);
    return;
  }
  catch_up7();
  arm9_bus_store(address, value, bytes);
  woke(1);
}

static uint32_t arm9_read(uint32_t address, int bytes) {
  catch_up7();
  vblank_dmas(0);
  interrupts(0);
  uint32_t value = arm9_load(address, bytes);
  woke(1);
  return value;
}

static void arm9_write(uint32_t address, uint32_t value, int bytes) {
  catch_up7();
  vblank_dmas(0);
  interrupts(0);
  arm9_store(address, value, bytes);
  woke(1);
}

static uint32_t arm9_load(uint32_t address, int bytes) {
  uint8_t *fast = fast_at(address & ~(uint32_t)(bytes - 1));
  if (fast) {
    uint32_t value = 0;
    for (int i = 0; i < bytes; i++) value |= (uint32_t)fast[i] << (8 * i);
    return value;
  }
  return arm9_bus_load(address, bytes);
}

static uint32_t arm9_bus_load(uint32_t address, int bytes) {
  if (address >> 24 == 0x02) return main_read(address, bytes);
  uint32_t value;
  if (nds_video_read(address, bytes, &value) || nds_ipc_read(0, address, bytes, &value) || nds_irq_read(0, t9, address, bytes, &value) || nds_dma_read(0, address, bytes, &value) || nds_math_read(t9, address, bytes, &value)) return value;
  switch (address) {
  case NDS_DISPSTAT: return bytes == 4 ? nds_irq_dispstat(0, t9) | vcount(t9) << 16 : bytes == 1 ? nds_irq_dispstat(0, t9) & 0xFF : nds_irq_dispstat(0, t9);
  case NDS_DISPSTAT + 1: return nds_irq_dispstat(0, t9) >> 8;
  case NDS_DISPSTAT + 2: return vcount(t9);
  case NDS_KEYINPUT: return keyinput();
  case NDS_POWCNT: return powcnt;
  }
  nds_not_yet();
  return 0;
}

static void arm9_store(uint32_t address, uint32_t value, int bytes) {
  uint8_t *fast = fast_at(address & ~(uint32_t)(bytes - 1));
  if (fast) {
    for (int i = 0; i < bytes; i++) fast[i] = (uint8_t)(value >> (8 * i));
    return;
  }
  arm9_bus_store(address, value, bytes);
}

static void arm9_bus_store(uint32_t address, uint32_t value, int bytes) {
  if (address >> 24 == 0x02) { main_write(address, value, bytes); return; }
  if (nds_video_write(address, value, bytes) || nds_ipc_write(0, address, value, bytes) || nds_irq_write(0, t9, address, value, bytes) || nds_dma_write(0, address, value, bytes) || nds_math_write(t9, address, value, bytes)) return;
  if (address == NDS_POWCNT && bytes >= 2) { powcnt = value & 0x820F; return; }
  nds_not_yet();
}

// the touch screen's chip, given a byte over the serial bus: a control byte asks it to measure, and the two bytes after
// give the result back, 12 bits, the pixel times 16, or 0xFFF with nothing touching
static void tsc_write(uint8_t value) {
  tsc_data = tsc_position == 1 ? (tsc_result >> 5) & 0x7F : tsc_position == 2 ? (uint8_t)(tsc_result << 3) : 0;
  if (value & 0x80) {
    tsc_control = value;
    tsc_position = 1;
    switch (tsc_control & 0x70) {
    case 0x10: tsc_result = touched ? (uint16_t)(touch_y << 4) : 0xFFF; break;
    case 0x50: tsc_result = touched ? (uint16_t)(touch_x << 4) : 0; break;
    // the microphone hears nothing yet, which the chip gives as the middle of its range
    case 0x60: tsc_result = 0x800; break;
    default: tsc_result = 0xFFF;
    }
    if (tsc_control & 0x08) tsc_result &= 0x0FF0;
  } else {
    tsc_position++;
  }
}

static uint32_t arm7_read(uint32_t address, int bytes) {
  wait7();
  vblank_dmas(1);
  interrupts(1);
  uint32_t value = arm7_load(address, bytes);
  woke(0);
  return value;
}

static void arm7_write(uint32_t address, uint32_t value, int bytes) {
  wait7();
  vblank_dmas(1);
  interrupts(1);
  arm7_store(address, value, bytes);
  woke(0);
}

static uint32_t arm7_load(uint32_t address, int bytes) {
  if (address >> 24 == 0x02) return main_read(address, bytes);
  uint32_t value;
  if (nds_ipc_read(1, address, bytes, &value) || nds_irq_read(1, t7, address, bytes, &value) || nds_dma_read(1, address, bytes, &value)) return value;
  switch (address) {
  case NDS_DISPSTAT: return bytes == 4 ? nds_irq_dispstat(1, t7) | vcount(t7) << 16 : bytes == 1 ? nds_irq_dispstat(1, t7) & 0xFF : nds_irq_dispstat(1, t7);
  case NDS_DISPSTAT + 1: return nds_irq_dispstat(1, t7) >> 8;
  case NDS_DISPSTAT + 2: return vcount(t7);
  case NDS_KEYINPUT: return keyinput();
  case NDS_EXTKEYIN: return extkeyin();
  case NDS_SPICNT: return (spicnt & ~0x80u) | (t7 < spi_until ? 0x80 : 0);
  case NDS_SPIDATA:
    if (!(spicnt & 0x8000) || t7 < spi_until) return 0;
    return ((spicnt >> 8) & 3) == 2 ? tsc_data : 0;
  }
  if (address >= 0x04000400 && address < 0x04000520) return nds_sound_read(address, bytes);
  nds_not_yet();
  return 0;
}

static void arm7_store(uint32_t address, uint32_t value, int bytes) {
  if (address >> 24 == 0x02) { main_write(address, value, bytes); return; }
  if (address >= 0x04000400 && address < 0x04000520) { nds_sound_write(t7, address, value, bytes); return; }
  if (nds_ipc_write(1, address, value, bytes) || nds_irq_write(1, t7, address, value, bytes) || nds_dma_write(1, address, value, bytes)) return;
  switch (address) {
  case NDS_HALTCNT:
    // halted until an interrupt it has on asks for it, which it then takes with IME on
    if (bytes != 1 || (value & 0xC0) != 0x80) nds_not_yet();
    wait7_until(0, 1);
    interrupts(1);
    return;
  case NDS_SPICNT:
    // turning the bus off lets the chip go
    if ((spicnt & 0x8000) && !(value & 0x8000)) tsc_position = 0;
    spicnt = (spicnt & 0x80) | (value & 0xCF03);
    // the bus's interrupt at a transfer's end isn't here yet
    if (value & 0x4400) nds_not_yet();
    return;
  case NDS_SPIDATA:
    if (!(spicnt & 0x8000) || t7 < spi_until) return;
    if (((spicnt >> 8) & 3) != 2) nds_not_yet();
    tsc_write((uint8_t)value);
    if (!(spicnt & 0x0800)) tsc_position = 0;
    spi_until = t7 + 8 * (8u << (spicnt & 3));
    return;
  case NDS_POWCNT:
    nds_sound_run(t7 + 1);
    nds_sound_powered(value & 1);
    return;
  }
  nds_not_yet();
}

uint32_t nds9_read8(uint32_t address) { return arm9_read(address, 1); }
uint32_t nds9_read16(uint32_t address) { return arm9_read(address, 2); }
uint32_t nds9_read32(uint32_t address) { return arm9_read(address, 4); }
void nds9_write8(uint32_t address, uint32_t value) { arm9_write(address, value & 0xFF, 1); }
void nds9_write16(uint32_t address, uint32_t value) { arm9_write(address, value & 0xFFFF, 2); }
void nds9_write32(uint32_t address, uint32_t value) { arm9_write(address, value, 4); }
uint32_t nds7_read8(uint32_t address) { return arm7_read(address, 1); }
uint32_t nds7_read16(uint32_t address) { return arm7_read(address, 2); }
uint32_t nds7_read32(uint32_t address) { return arm7_read(address, 4); }
void nds7_write8(uint32_t address, uint32_t value) { arm7_write(address, value & 0xFF, 1); }
void nds7_write16(uint32_t address, uint32_t value) { arm7_write(address, value & 0xFFFF, 2); }
void nds7_write32(uint32_t address, uint32_t value) { arm7_write(address, value, 4); }

/** Starts the console as the reference emulator starts a game, with its programs loaded: both run from tick 0 until
 *  each waits for the first V-blank. */
EXPORT("dp_start") void dp_start(void) {
  kit_screen(SCREEN_W, SCREEN_H);
  nds_sound_power();
  nds_video_power();
  nds_ipc_power();
  nds_irq_power();
  nds_dma_power();
  nds_math_power();
  handlers[0] = handlers[1] = 0;
  handling[0] = handling[1] = waiting[0] = waiting[1] = halted[0] = halted[1] = 0;
  for (int i = 0; i < 0x8000; i++) itcm[i] = 0;
  for (int i = 0; i < 0x4000; i++) dtcm[i] = 0;
  t9 = t7 = 0;
  frame = -1;
  window_end = vblank_of(0);
  done9 = done7 = 0;
  kit_run(arm9_entry);
  // the sound of the frames before the first, which nothing compares
  nds_sound_run(window_end);
  nds_sound_drop();
  frame = 0;
}

/** Runs one frame, from a V-blank's start to the next's, with the buttons in `buttons` held, a bit each in
 *  kit/consoles.js's order (console.h), and the touch the page gave (kit_touch). */
EXPORT("dp_step") void dp_step(uint32_t buttons) {
  held = buttons;
  touched = kit_touch(&touch_x, &touch_y);
  window_end = vblank_of(frame + 1);
  done9 = done7 = 0;
  kit_run(arm9_entry);
  nds_sound_run(window_end);
  frame++;
}

// a colour of 15 bits as the page's pixels hold it, red in the lowest byte, each of its 5 bits widened to 8 as the
// tools read the console's 6
static uint32_t shown(uint32_t colour) {
  return 0xFF000000u | (colour >> 10 & 31) << 19 | (colour >> 5 & 31) << 11 | (colour & 31) << 3;
}

// an engine's line as the screen shows it: what the power register and its display's mode make of what it draws
static void engine_line(int engine, int y, uint16_t *line) {
  uint32_t dispcnt = nds_video_dispcnt(engine);
  uint16_t fill = 0xFFFF;
  if (!(powcnt & (engine ? 0x200 : 0x2))) fill = engine ? 0x7FFF : 0;
  else if ((dispcnt & 0x80) || !((dispcnt >> 16) & 3)) fill = 0x7FFF;
  if (fill != 0xFFFF) { for (int x = 0; x < 256; x++) line[x] = fill; return; }
  nds_video_line(engine, y, line);
}

/** Draws the last frame's two screens, the upper above the lower, and gives where its words are. */
EXPORT("dp_draw") uint32_t *dp_draw(void) {
  uint32_t *screen = kit_screen(SCREEN_W, SCREEN_H);
  // engine A is on the upper screen when the power register's top bit says so
  int upper = powcnt & 0x8000 ? 0 : 1;
  static uint16_t line[256];
  for (int s = 0; s < 2; s++) {
    for (int y = 0; y < 192; y++) {
      uint32_t *row = screen + (s * 192 + y) * 256;
      if (!(powcnt & 1)) { for (int x = 0; x < 256; x++) row[x] = 0xFF000000u; continue; }
      engine_line(s ? !upper : upper, y, line);
      for (int x = 0; x < 256; x++) row[x] = shown(line[x]);
    }
  }
  return screen;
}

// the most samples one call gives, a tenth of a second's: the page asks again for more
#define SOUND_MAX (CONSOLE_SOUND_MOST / 10 + 1)
static float sound[SOUND_MAX * 2];

/** The next `count` samples of the game's sound, the left ones and then the right ones dp_sound_render_max() words
 *  on, each -1 to 1. */
EXPORT("dp_sound_render") float *dp_sound_render(int count) {
  if (count > SOUND_MAX) count = SOUND_MAX;
  if (count > 0) nds_sound_take(sound, sound + SOUND_MAX, count);
  return sound;
}
EXPORT("dp_sound_render_max") int dp_sound_render_max(void) { return SOUND_MAX; }
