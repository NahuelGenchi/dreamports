// The original's side of the Super Nintendo's function check: one function of a game's cartridge, run in Snes9x's own
// 65816. The build compiles that emulator's cpuops.cpp, the processor's instructions, and globals.cpp, the state they
// keep, as its makers wrote them, from the source the proof tools fetch for the reference emulator at the commit
// tools/consoles.mjs fixes, beside this file, which stands in for the rest of the console (original.mjs). So the
// reference is the processor that the proof's own emulator runs every game on, and this file drives it as that
// emulator's main loop does (cpuexec.cpp), but for interrupts, which a call never meets.
//
// What the processor sees is laid out by the tools for each cartridge, 4 KB at a time, as Snes9x lays it out: the
// cartridge's ROM, LoROM or HiROM; its save memory; the console's 128 KB of work memory at $7E0000, with its first
// 8 KB again at the bottom of the low banks; and the hardware's registers, $2100 to $21FF and $4000 to $43FF, kept as
// memory, so a store to one is kept and a read gives what was kept there, but for what the console does with a few of
// them that's memory or sums, not picture or sound: the work memory's port ($2180 to $2183), the multiply and divide
// unit ($4202 to $4206, done at once, as Snes9x does), the sound processor's four ports seen again up to $217F, and the
// two flags a read clears ($4210, $4211). Every 4 KB of Snes9x's map is one it hands, with its whole address, to a chip
// of the cartridge, the BS-X's, whose two functions this file stands in for, so each byte the processor reads or
// writes comes here, and it runs its instructions the way it does wherever it has no pointer to the code, reading
// each byte through the map. Anything the console has nothing at, a write to the ROM, or code run anywhere but the
// ROM, the save memory and the work memory, stops the call.
//
// It's kept running and told what to do on its standard input, in little-endian words, and answers on its standard
// output:
//
//   'R' cartridge  the ROM, its size in bytes and the bytes, then the save memory's size in bytes, then the map: 4096
//                  blocks of 4 KB, each three words, what it is (0 nothing, 1 the work memory, 2 the hardware, 3 the
//                  ROM, 4 the save memory), where its first byte is in what it is, and a mask that place is kept
//                  within. Answers 'k'.
//   'I' image      the memory every call starts from: IMAGE bytes, the work memory's 128 KB, then the hardware's
//                  registers, $2100 to $21FF and $4000 to $43FF, then the save memory. Answers 'k'.
//   'C' call       runs a function from that memory with some of it changed: the function's address, how many bytes
//                  long it is, how many instructions it may run, how it comes back (0 RTS, 1 RTL, 2 RTI) and where to,
//                  the registers A, X, Y, S, D, DB, P and E, and the changes, a count and then each one's address,
//                  bytes (1, 2 or 4) and value. The address it comes back to is pushed on its stack, as a call or an
//                  interrupt pushes it, and the call ends when the processor reaches it. Answers how it ended, the
//                  words below, and then the memory every call starts from is as it was.
//   'Q'            ends the program.
//
// What a call answers, in words but for the bytes of what ran and of the memory:
//   end        0 came back, 1 ran out of instructions, 2 waits for an interrupt (WAI), 3 stopped the processor (STP),
//              4 ran code where no code can be, 5 read or wrote where nothing is, or wrote to the ROM
//   detail     the address it ran or reached, with 0x1000000 added for a write
//   pc         where it was when it ended, bank and all
//   steps      how many instructions it ran
//   cycles     how many of the console's master cycles they took, as Snes9x counts them
//   9 words    the registers as it left them: A, X, Y, S, D, DB, PB, P and E
//   span bytes one for each byte of the function: 1 an instruction started there, 2 a branch there went to its
//              target, 4 it went on past it, 8 it ran with A of 8 bits, 16 with A of 16, 32 with X and Y of 8 bits,
//              64 with X and Y of 16, 128 in the 6502's mode
//   reads      a count, then each byte it read the first time, but for its own instructions and the address it comes
//              back to: address and value
//   hardware   a count, then each read and write of the hardware's registers in order: the register, the value, and
//              0 for a read or 1 for a write
//   chunks     a count, then each 256 bytes of the image it wrote: where they are, in 256s, and the bytes as it left
//              them

#include <csetjmp>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#include "snes9x.h"
#include "memmap.h"
#include "getset.h"
#include "cpuexec.h"

enum { WRAM = 0x20000, PPU_AT = WRAM, CPU_AT = WRAM + 0x100, SRAM_AT = WRAM + 0x500, MOST_SRAM = 0x80000, CHUNK = 256 };
enum { BLOCKS = 0x1000, MOST_READS = 4096, MOST_HARDWARE = 4096 };
enum { NOTHING, WORK, HARDWARE, ROM_KIND, SAVE };
enum { END_BACK, END_STEPS, END_WAIT, END_STOP, END_ELSEWHERE, END_NOWHERE };
enum { WRITE = 0x1000000 };

static uint8 *rom;
static uint32 rom_bytes, sram_bytes, image_bytes;
static uint32 kind[BLOCKS], base_of[BLOCKS], mask_of[BLOCKS];
static uint8 *base, *image, *dirty;
static jmp_buf out;
static uint32 ended, detail, steps;
static uint32 reads[MOST_READS][2], read_count;
static uint32 hardware[MOST_HARDWARE][3], hardware_count;
static uint32 fetch_from, fetch_to;
// the stack's bytes the call pushed itself, the address it comes back to, which are no value it was given
static uint32 pushed[4], pushed_count;

static void stop(uint32 how, uint32 what) {
  ended = how;
  detail = what;
  longjmp(out, 1);
}

static void keep(uint32 at, uint8 value) {
  image[at] = value;
  dirty[at / CHUNK] = 1;
}

// Where a hardware register is in the image, or -1: the sound processor's four ports are seen again every four bytes
// up to $217F, as the console wires them.
static int register_at(uint32 address) {
  uint32 low = address & 0xFFFF;
  if (low >= 0x2140 && low < 0x2180) low = 0x2140 | (low & 3);
  if (low >= 0x2100 && low < 0x2200) return PPU_AT + (low - 0x2100);
  if (low >= 0x4000 && low < 0x4400) return CPU_AT + (low - 0x4000);
  return -1;
}

static uint32 register_of(uint32 address) {
  uint32 low = address & 0xFFFF;
  return low >= 0x2140 && low < 0x2180 ? 0x2140 | (low & 3) : low;
}

static void note_read(uint32 address, uint8 value);

static void note_hardware(uint32 address, uint8 value, int write) {
  if (hardware_count >= MOST_HARDWARE) return;
  hardware[hardware_count][0] = register_of(address);
  hardware[hardware_count][1] = value;
  hardware[hardware_count++][2] = write;
}

// the work memory's port: the address in $2181 to $2183, 17 bits of it, and on to the next byte after each
static uint32 port_address(void) {
  return (image[PPU_AT + 0x81] | image[PPU_AT + 0x82] << 8 | (image[PPU_AT + 0x83] & 1) << 16) & (WRAM - 1);
}

static void port_next(uint32 at) {
  at = (at + 1) & (WRAM - 1);
  keep(PPU_AT + 0x81, (uint8)at);
  keep(PPU_AT + 0x82, (uint8)(at >> 8));
  keep(PPU_AT + 0x83, (uint8)((image[PPU_AT + 0x83] & 0xFE) | (at >> 16)));
}

static uint8 read_register(uint32 address) {
  int at = register_at(address);
  if (at < 0) stop(END_NOWHERE, address & 0xFFFFFF);
  uint32 low = register_of(address);
  uint8 value;
  if (low == 0x2180) {
    uint32 from = port_address();
    value = image[from];
    port_next(from);
  } else {
    value = image[at];
    // the flags of the picture's last line and of the timer, cleared by reading them
    if (low == 0x4210 || low == 0x4211) keep(at, value & 0x7F);
  }
  note_hardware(address, value, 0);
  note_read(address, value);
  return value;
}

static void write_register(uint32 address, uint8 value) {
  int at = register_at(address);
  if (at < 0) stop(END_NOWHERE, (address & 0xFFFFFF) | WRITE);
  uint32 low = register_of(address);
  note_hardware(address, value, 1);
  if (low == 0x2180) {
    uint32 to = port_address();
    keep(to, value);
    port_next(to);
    return;
  }
  keep(at, value);
  if (low == 0x4203) {
    uint32 product = image[CPU_AT + 0x202] * value;
    keep(CPU_AT + 0x216, (uint8)product);
    keep(CPU_AT + 0x217, (uint8)(product >> 8));
  } else if (low == 0x4206) {
    uint32 dividend = image[CPU_AT + 0x204] | image[CPU_AT + 0x205] << 8;
    uint32 quotient = value ? dividend / value : 0xFFFF, rest = value ? dividend % value : dividend;
    keep(CPU_AT + 0x214, (uint8)quotient);
    keep(CPU_AT + 0x215, (uint8)(quotient >> 8));
    keep(CPU_AT + 0x216, (uint8)rest);
    keep(CPU_AT + 0x217, (uint8)(rest >> 8));
  } else if (low == 0x420D) {
    CPU.FastROMSpeed = (value & 1) ? ONE_CYCLE : SLOW_ONE_CYCLE;
  }
}

// a byte of the map: what it is, and where in the ROM or the image, or nothing when the map says a place past what
// it's in
static uint32 block_place(uint32 address, uint32 *what) {
  uint32 block = (address & 0xFFFFFF) >> 12, at = (base_of[block] + (address & 0xFFF)) & mask_of[block];
  uint32 size = kind[block] == WORK ? WRAM : kind[block] == SAVE ? sram_bytes : kind[block] == ROM_KIND ? rom_bytes : 0x10000;
  *what = at < size ? kind[block] : NOTHING;
  return at;
}

// the places a call read already, kept as a small open table so a loop that reads a lot doesn't look through every
// one each time
enum { SEEN = 4 * MOST_READS };
static uint32 seen_key[SEEN];
static uint8 seen_used[SEEN];

static int seen_before(uint32 address) {
  uint32 at = (address * 2654435761u) >> 18 & (SEEN - 1);
  while (seen_used[at]) {
    if (seen_key[at] == address) return 1;
    at = (at + 1) & (SEEN - 1);
  }
  seen_used[at] = 1;
  seen_key[at] = address;
  return 0;
}

static void note_read(uint32 address, uint8 value) {
  address &= 0xFFFFFF;
  if (address >= fetch_from && address < fetch_to) return;
  for (uint32 i = 0; i < pushed_count; i++) if (address == pushed[i]) return;
  if (read_count >= MOST_READS || seen_before(address)) return;
  reads[read_count][0] = address;
  reads[read_count++][1] = value;
}

// the two functions of the cartridge's chip that every byte of the map is handed to
uint8 S9xGetBSX(uint32 address) {
  uint32 what, at = block_place(address, &what);
  uint8 value;
  switch (what) {
    case WORK: value = image[at]; break;
    case SAVE: value = image[SRAM_AT + at]; break;
    case ROM_KIND: value = rom[at]; break;
    case HARDWARE: return read_register(address);
    default: stop(END_NOWHERE, address & 0xFFFFFF); return 0;
  }
  note_read(address, value);
  return value;
}

void S9xSetBSX(uint8 value, uint32 address) {
  uint32 what, at = block_place(address, &what);
  switch (what) {
    case WORK: keep(at, value); return;
    case SAVE: keep(SRAM_AT + at, value); return;
    case HARDWARE: write_register(address, value); return;
    default: stop(END_NOWHERE, (address & 0xFFFFFF) | WRITE);
  }
}

// no pointer to any code, so the processor reads every byte of it through the map
uint8 *S9xGetBasePointerBSX(uint32 address) { (void)address; return NULL; }

// the rest of the console, which a map of the tools' own never hands anything to
static uint8 never(uint32 address) { stop(END_NOWHERE, address & 0xFFFFFF); return 0; }
static void never_write(uint32 address) { stop(END_NOWHERE, (address & 0xFFFFFF) | WRITE); }
uint8 S9xGetCPU(uint16 address) { return never(address); }
void S9xSetCPU(uint8 value, uint16 address) { (void)value; never_write(address); }
uint8 S9xGetPPU(uint16 address) { return never(address); }
void S9xSetPPU(uint8 value, uint16 address) { (void)value; never_write(address); }
uint8 S9xGetDSP(uint16 address) { return never(address); }
void S9xSetDSP(uint8 value, uint16 address) { (void)value; never_write(address); }
uint8 S9xGetC4(uint16 address) { return never(address); }
void S9xSetC4(uint8 value, uint16 address) { (void)value; never_write(address); }
uint8 *S9xGetBasePointerC4(uint16 address) { (void)address; return NULL; }
uint8 S9xGetOBC1(uint16 address) { return never(address); }
void S9xSetOBC1(uint8 value, uint16 address) { (void)value; never_write(address); }
uint8 *S9xGetBasePointerOBC1(uint16 address) { (void)address; return NULL; }
uint8 S9xGetSetaDSP(uint32 address) { return never(address); }
void S9xSetSetaDSP(uint8 value, uint32 address) { (void)value; never_write(address); }
uint8 S9xGetST018(uint32 address) { return never(address); }
void S9xSetST018(uint8 value, uint32 address) { (void)value; never_write(address); }
uint8 S9xGetSPC7110(uint16 address) { return never(address); }
uint8 S9xGetSPC7110Byte(uint32 address) { return never(address); }
uint8 *S9xGetBasePointerSPC7110(uint32 address) { (void)address; return NULL; }
uint8 S9xSA1ReadCC1(uint32 address) { return never(address); }
int S9xSA1BWRAMWriteProtected(uint32 address) { never_write(address); return 0; }
void S9xDoHEventProcessing(void) {}

static int is_branch(uint8 op) {
  return (op & 0x1F) == 0x10;
}

// The call being run: where it comes back to, how many instructions it may run, its function and what of it ran, and
// the conditional branch being run, until where the processor is next says which way it went.
static uint32 back, limit, start, span;
static uint8 *ran;

static uint8 peek(uint32 address) {
  uint32 what, at = block_place(address, &what);
  if (what == ROM_KIND) return rom[at];
  if (what == WORK) return image[at];
  if (what == SAVE) return image[SRAM_AT + at];
  return 0;
}

static int runs_here(uint32 address) {
  uint32 what;
  block_place(address, &what);
  return what == ROM_KIND || what == WORK || what == SAVE;
}

static uint32 offset_of(uint32 pc) {
  return (pc & 0xFF0000) == (start & 0xFF0000) ? (pc - start) & 0xFFFF : span;
}

// One instruction, as the reference emulator's main loop runs one where it has no pointer to the code, with what ran
// noted first and which way a branch went noted after.
static void step(void) {
  uint32 pc = Registers.PBPC;
  if (pc == back) stop(END_BACK, 0);
  if (!runs_here(pc)) stop(END_ELSEWHERE, pc);
  if (steps >= limit) stop(END_STEPS, 0);
  steps++;
  uint8 op = peek(pc);
  uint32 offset = offset_of(pc);
  if (offset < span) {
    uint8 flags = CheckEmulation() ? 128 | 8 | 32 : (CheckMemory() ? 8 : 16) | (CheckIndex() ? 32 : 64);
    ran[offset] |= 1 | flags;
  }
  fetch_from = pc;
  fetch_to = pc + ICPU.S9xOpLengths[op];

  uint8 Op;
  struct SOpcodes *Opcodes;
  if (CPU.PCBase) {
    Op = CPU.PCBase[Registers.PCw];
    CPU.Cycles += CPU.MemSpeed;
    Opcodes = ICPU.S9xOpcodes;
  } else {
    Op = S9xGetByte(Registers.PBPC);
    OpenBus = Op;
    Opcodes = S9xOpcodesSlow;
  }
  if ((Registers.PCw & MEMMAP_MASK) + ICPU.S9xOpLengths[Op] >= MEMMAP_BLOCK_SIZE) {
    uint8 *oldPCBase = CPU.PCBase;
    CPU.PCBase = S9xGetBasePointer(ICPU.ShiftedPB + ((uint16)(Registers.PCw + 4)));
    if (oldPCBase != CPU.PCBase || (Registers.PCw & ~MEMMAP_MASK) == (0xffff & ~MEMMAP_MASK)) Opcodes = S9xOpcodesSlow;
  }
  Registers.PCw++;
  (*Opcodes[Op].S9xOpcode)();
  fetch_from = fetch_to = 0;

  if (offset < span && is_branch(op)) {
    uint32 next = (pc & 0xFF0000) | ((pc + 2) & 0xFFFF);
    uint32 target = (pc & 0xFF0000) | ((pc + 2 + (int8)peek((pc & 0xFF0000) | ((pc + 1) & 0xFFFF))) & 0xFFFF);
    if (Registers.PBPC == target) ran[offset] |= 2;
    if (Registers.PBPC == next) ran[offset] |= 4;
  }
  if (CPU.WaitingForInterrupt) stop(END_WAIT, 0);
  if (CPU.Flags & HALTED_FLAG) stop(END_STOP, 0);
}

static void run(void) {
  steps = 0;
  ended = END_BACK;
  detail = 0;
  CPU.Cycles = 0;
  if (!setjmp(out)) {
    for (;;) step();
  }
  fetch_from = fetch_to = 0;
  S9xPackStatus();
}

static int take(void *to, size_t bytes) { return fread(to, 1, bytes, stdin) == bytes; }
static uint32 word(void) {
  uint8 b[4];
  if (!take(b, 4)) exit(0);
  return b[0] | b[1] << 8 | (uint32)b[2] << 16 | (uint32)b[3] << 24;
}
static void say(uint32 value) {
  uint8 b[4] = { (uint8)value, (uint8)(value >> 8), (uint8)(value >> 16), (uint8)(value >> 24) };
  fwrite(b, 1, 4, stdout);
}

// Where an address is in the image, or -1: the work memory, the hardware's registers or the save memory.
static int64_t in_image(uint32 address) {
  uint32 what, at = block_place(address, &what);
  if (what == WORK) return at;
  if (what == SAVE) return SRAM_AT + at;
  if (what == HARDWARE) return register_at(address);
  return -1;
}

// a byte pushed on the stack as the processor pushes one, before the call: part of what it starts from
static void push(uint8 value) {
  pushed[pushed_count++] = Registers.S.W;
  int64_t at = in_image(Registers.S.W);
  if (at >= 0) image[at] = value;
  if (CheckEmulation()) Registers.SL--;
  else Registers.S.W--;
}

static void call(void) {
  start = word() & 0xFFFFFF;
  span = word();
  limit = word();
  uint32 way = word();
  back = word() & 0xFFFFFF;
  uint32 a = word(), x = word(), y = word(), s = word(), d = word(), db = word(), p = word(), e = word();
  memcpy(image, base, image_bytes);
  uint32 changes = word();
  for (uint32 i = 0; i < changes; i++) {
    uint32 address = word(), bytes = word(), value = word();
    for (uint32 j = 0; j < bytes; j++) {
      int64_t at = in_image(address + j);
      if (at >= 0) image[at] = (uint8)(value >> (8 * j));
    }
  }

  memset(&Registers, 0, sizeof Registers);
  Registers.A.W = (uint16)a;
  Registers.X.W = (uint16)x;
  Registers.Y.W = (uint16)y;
  Registers.S.W = (uint16)s;
  Registers.D.W = (uint16)d;
  Registers.DB = (uint8)db;
  Registers.PL = (uint8)p;
  Registers.PH = e ? 1 : 0;
  // in the 6502's mode the stack is in page 1, and with 8-bit indexes their high bytes are 0, as the console has them
  if (CheckEmulation()) {
    Registers.PL |= MemoryFlag | IndexFlag;
    Registers.SH = 1;
  }
  if (CheckIndex()) Registers.XH = Registers.YH = 0;
  ICPU.ShiftedDB = Registers.DB << 16;
  S9xUnpackStatus();
  S9xFixCycles();
  // the address it comes back to, as the call or the interrupt that starts it pushes it
  pushed_count = 0;
  if (way == 1 || (way == 2 && !CheckEmulation())) push((uint8)(back >> 16));
  uint16 pushed = (uint16)(way == 2 ? back : back - 1);
  push((uint8)(pushed >> 8));
  push((uint8)pushed);
  if (way == 2) push(Registers.PL);
  // what the changes and the push wrote is part of what the call starts from, not of what it left
  memset(dirty, 0, image_bytes / CHUNK + 1);

  CPU.Flags = 0;
  CPU.WaitingForInterrupt = FALSE;
  CPU.InDMA = CPU.InHDMA = CPU.InDMAorHDMA = CPU.InWRAMDMAorHDMA = FALSE;
  CPU.NextEvent = 0x7FFFFFFF;
  CPU.FastROMSpeed = (image[CPU_AT + 0x20D] & 1) ? ONE_CYCLE : SLOW_ONE_CYCLE;
  S9xSetPCBase(start);
  read_count = 0;
  hardware_count = 0;
  memset(seen_used, 0, sizeof seen_used);
  ran = (uint8 *)calloc(span + 1, 1);
  run();

  say(ended);
  say(detail);
  say(Registers.PBPC & 0xFFFFFF);
  say(steps);
  say((uint32)CPU.Cycles);
  say(Registers.A.W);
  say(Registers.X.W);
  say(Registers.Y.W);
  say(Registers.S.W);
  say(Registers.D.W);
  say(Registers.DB);
  say(Registers.PB);
  say(Registers.PL);
  say(CheckEmulation() ? 1 : 0);
  fwrite(ran, 1, span, stdout);
  free(ran);
  say(read_count);
  for (uint32 i = 0; i < read_count; i++) for (int j = 0; j < 2; j++) say(reads[i][j]);
  say(hardware_count);
  for (uint32 i = 0; i < hardware_count; i++) for (int j = 0; j < 3; j++) say(hardware[i][j]);
  uint32 chunks = image_bytes / CHUNK, written = 0;
  for (uint32 i = 0; i < chunks; i++) written += dirty[i];
  say(written);
  for (uint32 i = 0; i < chunks; i++) {
    if (!dirty[i]) continue;
    say(i);
    fwrite(image + i * CHUNK, 1, CHUNK, stdout);
  }
  fflush(stdout);
}

static int cartridge(void) {
  rom_bytes = word();
  free(rom);
  rom = (uint8 *)malloc(rom_bytes ? rom_bytes : 1);
  if (!take(rom, rom_bytes)) return 0;
  sram_bytes = word();
  if (sram_bytes > MOST_SRAM || sram_bytes % CHUNK) return 0;
  for (uint32 i = 0; i < BLOCKS; i++) {
    kind[i] = word();
    base_of[i] = word();
    mask_of[i] = word();
  }
  image_bytes = SRAM_AT + sram_bytes;
  free(base);
  free(image);
  free(dirty);
  base = (uint8 *)calloc(image_bytes, 1);
  image = (uint8 *)calloc(image_bytes, 1);
  dirty = (uint8 *)calloc(image_bytes / CHUNK + 1, 1);
  return 1;
}

int main(void) {
#ifdef _WIN32
  _setmode(_fileno(stdin), _O_BINARY);
  _setmode(_fileno(stdout), _O_BINARY);
#endif
  // as the reference emulator sets them (libretro.cpp), and no chip of a cartridge's but the stand-in above
  Settings.OneClockCycle = 6;
  Settings.OneSlowClockCycle = 8;
  Settings.TwoClockCycles = 12;
  static uint8 fill[0x8000];
  Memory.FillRAM = fill;
  for (uint32 i = 0; i < BLOCKS; i++) {
    Memory.Map[i] = Memory.WriteMap[i] = (uint8 *)CMemory::MAP_BSX;
    Memory.BlockIsRAM[i] = Memory.BlockIsROM[i] = FALSE;
  }
  for (;;) {
    int command = getchar();
    if (command == EOF || command == 'Q') return 0;
    if (command == 'R') {
      if (!cartridge()) return 1;
      putchar('k');
      fflush(stdout);
    } else if (command == 'I') {
      if (!image || !take(base, image_bytes)) return 1;
      putchar('k');
      fflush(stdout);
    } else if (command == 'C') {
      if (!image) return 1;
      call();
    } else {
      fprintf(stderr, "unknown command %d\n", command);
      return 1;
    }
  }
}
