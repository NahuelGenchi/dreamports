// The RSP, the console's signal processor: its registers as the processor writes them, its DMA between RDRAM and its
// two memories, and its scalar unit, which runs the microcode a game copies into its instruction memory, a word at a
// time from SP_PC until a BREAK, with each branch's delay slot. Its vector unit's instructions are in vu.c.
//
// It does what cxd4, the RSP the proof tools' Nintendo 64 emulator runs, does with them, a task at once and whole,
// and where cxd4 and the console's own documentation part, cxd4's way is kept so a proof can compare the two: a write
// to SP_STATUS from the RSP that sets the interrupt also halts it, as cxd4 has it. Followed from cxd4 by Iconoclast, in
// libretro/parallel-n64 at 2d90e20fa140b104d810bc0ea289f6f382e5086a (mupen64plus-rsp-cxd4), dedicated to the public
// domain under CC0, and from mupen64plus-core in the same repository for what the processor's writes do.

#include "n64-kit.h"

struct n64_sp n64_sp;

// a task that never reaches a BREAK, as one that waits for the processor does, is stopped after this many
// instructions, where it is, so the frame can go on
#define MOST_STEPS 50000000

void rsp_power(void) {
  n64_sp = (struct n64_sp){ .status = SP_HALT };
  vu_power();
}

// What the processor's DMA does, as the console's emulator has it: `length` bytes a row, rounded up to eight, for
// `count` rows, RDRAM `skip` bytes on between them, within the 4 KB memory the address's bit 12 picks.
static void processor_dma(uint32_t lengths, int to_rdram) {
  uint32_t length = ((lengths & 0xFFF) | 7) + 1, count = ((lengths >> 12) & 0xFF) + 1, skip = (lengths >> 20) & 0xFF8;
  uint32_t bank = n64_sp.mem_addr & 0x1000, mem = n64_sp.mem_addr & 0xFF8, dram = n64_sp.dram_addr & 0xFFFFF8;
  for (uint32_t row = 0; row < count; row++) {
    if (row) dram += skip;
    for (uint32_t i = 0; i < length; i++, mem++, dram++) {
      uint8_t *sp = &n64_sp_mem[bank + (mem & 0xFFF)], *rdram = &n64_rdram[dram & 0x7FFFFF];
      if (to_rdram) *rdram = *sp;
      else *sp = *rdram;
    }
  }
}

// What the RSP's own DMA does, as cxd4 has it: the same rows, from the last to the first, eight bytes at a time, across
// from data memory into instruction memory, and nothing but zeros read from past RDRAM's end.
static void rsp_dma(uint32_t lengths, int to_rdram) {
  uint32_t length = (lengths & 0xFFF) + 1, count = ((lengths >> 12) & 0xFF) + 1, skip = (lengths >> 20) + length;
  while (count--) {
    for (uint32_t i = 0; i < length; i += 8) {
      uint32_t sp = (count * length + n64_sp.mem_addr + i) & 0x1FF8, dram = (count * skip + n64_sp.dram_addr + i) & 0xFFFFF8;
      for (int b = 0; b < 8; b++) {
        if (to_rdram) {
          if (dram < N64_RDRAM_SIZE) n64_rdram[dram + b] = n64_sp_mem[sp + b];
        } else n64_sp_mem[sp + b] = dram < N64_RDRAM_SIZE ? n64_rdram[dram + b] : 0;
      }
    }
  }
}

// SP_STATUS as the processor writes it: a pair of bits, clear and set, for each of its own
static void processor_status(uint32_t w) {
  uint32_t *s = &n64_sp.status;
  if ((w & 0x3) == 0x1) *s &= ~(uint32_t)SP_HALT;
  if ((w & 0x3) == 0x2) *s |= SP_HALT;
  if (w & 0x4) *s &= ~(uint32_t)SP_BROKE;
  if ((w & 0x18) == 0x08) n64_mi_intr &= ~(uint32_t)MI_INTR_SP;
  if ((w & 0x18) == 0x10) n64_interrupt(MI_INTR_SP);
  if ((w & 0x60) == 0x20) *s &= ~(uint32_t)SP_SINGLE_STEP;
  if ((w & 0x60) == 0x40) *s |= SP_SINGLE_STEP;
  if ((w & 0x180) == 0x080) *s &= ~(uint32_t)SP_INTR_BREAK;
  if ((w & 0x180) == 0x100) *s |= SP_INTR_BREAK;
  // the eight signals, from bit 7 of SP_STATUS on
  for (int signal = 0; signal < 8; signal++) {
    uint32_t pair = (w >> (9 + signal * 2)) & 3, bit = 0x80u << signal;
    if (pair == 1) *s &= ~bit;
    if (pair == 2) *s |= bit;
  }
  // a task starts when the write lets a halted or broken RSP go
  if (((w & 0x3) == 0x1 || (w & 0x4)) && !(*s & SP_HALT)) rsp_run();
}

void rsp_write(uint32_t reg, uint32_t value) {
  switch (reg & 0x040C001F) {
  case 0x04040000: n64_sp.mem_addr = value; break;
  case 0x04040004: n64_sp.dram_addr = value; break;
  case 0x04040008: n64_sp.rd_len = value; processor_dma(value, 0); break;
  case 0x0404000C: n64_sp.wr_len = value; processor_dma(value, 1); break;
  case 0x04040010: processor_status(value); break;
  case 0x0404001C: n64_sp.semaphore = 0; break;
  case 0x04080000: n64_sp.pc = value & 0xFFC; break;
  }
}

uint32_t rsp_read(uint32_t reg) {
  switch (reg & 0x040C001F) {
  case 0x04040000: return n64_sp.mem_addr;
  case 0x04040004: return n64_sp.dram_addr;
  case 0x04040008: return n64_sp.rd_len;
  case 0x0404000C: return n64_sp.wr_len;
  case 0x04040010: return n64_sp.status;
  case 0x0404001C: {
    uint32_t taken = n64_sp.semaphore;
    n64_sp.semaphore = 1;
    return taken;
  }
  case 0x04080000: return n64_sp.pc;
  }
  return 0;
}

// the RSP's coprocessor 0: its own registers 0 to 7, the RDP's 8 to 15
static uint32_t cop0_read(uint32_t rd) {
  static const uint32_t rdp_registers[8] = { DPC_START, DPC_END, DPC_CURRENT, DPC_STATUS, DPC_CLOCK, DPC_BUFBUSY, DPC_PIPEBUSY, DPC_TMEM };
  switch (rd & 15) {
  case 0: return n64_sp.mem_addr;
  case 1: return n64_sp.dram_addr;
  case 2: return n64_sp.rd_len;
  case 3: return n64_sp.wr_len;
  case 4: return n64_sp.status;
  case 5: case 6: return 0;
  case 7: return n64_sp.semaphore;
  default: return rdp_read(rdp_registers[rd & 7] & 0x1FFFFFFF);
  }
}

// SP_STATUS as the RSP writes it, as cxd4 has it: setting the interrupt halts it too
static void rsp_status(uint32_t w) {
  uint32_t *s = &n64_sp.status;
  if (w & 0x001) *s &= ~(uint32_t)SP_HALT;
  if (w & 0x002) *s |= SP_HALT;
  if (w & 0x004) *s &= ~(uint32_t)SP_BROKE;
  if (w & 0x008) n64_mi_intr &= ~(uint32_t)MI_INTR_SP;
  if (w & 0x010) n64_interrupt(MI_INTR_SP), *s |= SP_HALT;
  if (w & 0x020) *s &= ~(uint32_t)SP_SINGLE_STEP;
  if (w & 0x080) *s &= ~(uint32_t)SP_INTR_BREAK;
  if (w & 0x100) *s |= SP_INTR_BREAK;
  for (int signal = 0; signal < 8; signal++) {
    uint32_t bit = 0x80u << signal;
    if (w & (0x200u << (signal * 2))) *s &= ~bit;
    if (w & (0x400u << (signal * 2))) *s |= bit;
  }
}

static void cop0_write(uint32_t rd, uint32_t value) {
  switch (rd & 15) {
  case 0: n64_sp.mem_addr = value & ~7u; break;
  case 1: n64_sp.dram_addr = value & ~7u; break;
  case 2: n64_sp.rd_len = value | 7; rsp_dma(n64_sp.rd_len, 0); break;
  case 3: n64_sp.wr_len = value | 7; rsp_dma(n64_sp.wr_len, 1); break;
  case 4: rsp_status(value); break;
  case 7: n64_sp.semaphore = 0; break;
  // DPC_START from the RSP sets where the list ends too, as cxd4 has it
  case 8: rdp_write(0x04100000, value); n64_dp.end = n64_dp.start; break;
  case 9: rdp_write(0x04100004, value); break;
  case 11: rdp_write(0x0410000C, value); break;
  case 12: n64_dp.clock = value; break;
  }
}

// data memory as the scalar unit's loads and stores reach it, a byte at a time, round its 4 KB
static uint8_t *dmem(uint32_t address) { return &n64_sp_mem[address & 0xFFF]; }

static uint32_t sr[32];

// One instruction of the scalar unit at `pc`, the address after it: 0 when it goes on to the next, 1 when it jumps to
// `*target`, after the next, and -1 when it halts the RSP.
static int step(uint32_t word, uint32_t pc, uint32_t *target) {
  uint32_t rs = word >> 21 & 31, rt = word >> 16 & 31, rd = word >> 11 & 31, sa = word >> 6 & 31;
  uint32_t immediate = word & 0xFFFF, extended = (uint32_t)(int32_t)(int16_t)immediate;
  uint32_t address = sr[rs] + extended;
  int jumps = 0;
  switch (word >> 26) {
  case 0x00:
    switch (word & 63) {
    case 0x00: sr[rd] = sr[rt] << sa; break;
    case 0x02: sr[rd] = sr[rt] >> sa; break;
    case 0x03: sr[rd] = (uint32_t)((int32_t)sr[rt] >> sa); break;
    case 0x04: sr[rd] = sr[rt] << (sr[rs] & 31); break;
    case 0x06: sr[rd] = sr[rt] >> (sr[rs] & 31); break;
    case 0x07: sr[rd] = (uint32_t)((int32_t)sr[rt] >> (sr[rs] & 31)); break;
    case 0x09: *target = sr[rs]; sr[rd] = (pc + 4) & 0xFFC; jumps = 1; break;
    case 0x08: *target = sr[rs]; jumps = 1; break;
    case 0x0D:
      n64_sp.status |= SP_BROKE | SP_HALT;
      if (n64_sp.status & SP_INTR_BREAK) n64_interrupt(MI_INTR_SP);
      return -1;
    case 0x20: case 0x21: sr[rd] = sr[rs] + sr[rt]; break;
    case 0x22: case 0x23: sr[rd] = sr[rs] - sr[rt]; break;
    case 0x24: sr[rd] = sr[rs] & sr[rt]; break;
    case 0x25: sr[rd] = sr[rs] | sr[rt]; break;
    case 0x26: sr[rd] = sr[rs] ^ sr[rt]; break;
    case 0x27: sr[rd] = ~(sr[rs] | sr[rt]); break;
    case 0x2A: sr[rd] = (int32_t)sr[rs] < (int32_t)sr[rt]; break;
    case 0x2B: sr[rd] = sr[rs] < sr[rt]; break;
    }
    break;
  case 0x01: {
    // BLTZ, BGEZ, and with $ra set first, whether they branch or not, BLTZAL and BGEZAL
    if (rt == 0x10 || rt == 0x11) sr[31] = (pc + 4) & 0xFFC;
    if (rt == 0x00 || rt == 0x10) jumps = (int32_t)sr[rs] < 0;
    if (rt == 0x01 || rt == 0x11) jumps = (int32_t)sr[rs] >= 0;
    *target = pc + (extended << 2);
    break;
  }
  case 0x02: *target = word << 2; jumps = 1; break;
  case 0x03: sr[31] = (pc + 4) & 0xFFC; *target = word << 2; jumps = 1; break;
  case 0x04: jumps = sr[rs] == sr[rt]; *target = pc + (extended << 2); break;
  case 0x05: jumps = sr[rs] != sr[rt]; *target = pc + (extended << 2); break;
  case 0x06: jumps = (int32_t)sr[rs] <= 0; *target = pc + (extended << 2); break;
  case 0x07: jumps = (int32_t)sr[rs] > 0; *target = pc + (extended << 2); break;
  case 0x08: case 0x09: sr[rt] = sr[rs] + extended; break;
  case 0x0A: sr[rt] = (int32_t)sr[rs] < (int32_t)extended; break;
  case 0x0B: sr[rt] = sr[rs] < immediate; break;
  case 0x0C: sr[rt] = sr[rs] & immediate; break;
  case 0x0D: sr[rt] = sr[rs] | immediate; break;
  case 0x0E: sr[rt] = sr[rs] ^ immediate; break;
  case 0x0F: sr[rt] = immediate << 16; break;
  case 0x10:
    if (rs == 0x00) sr[rt] = cop0_read(rd);
    else if (rs == 0x04) cop0_write(rd, sr[rt]);
    sr[0] = 0;
    return n64_sp.status & SP_HALT ? -1 : 0;
  case 0x12: vu_cop2(word, sr); break;
  case 0x20: sr[rt] = (uint32_t)(int32_t)(int8_t)*dmem(address); break;
  case 0x21: sr[rt] = (uint32_t)(int32_t)(int16_t)(*dmem(address) << 8 | *dmem(address + 1)); break;
  case 0x23: sr[rt] = (uint32_t)*dmem(address) << 24 | (uint32_t)*dmem(address + 1) << 16 | (uint32_t)*dmem(address + 2) << 8 | *dmem(address + 3); break;
  case 0x24: sr[rt] = *dmem(address); break;
  case 0x25: sr[rt] = (uint32_t)(*dmem(address) << 8 | *dmem(address + 1)); break;
  case 0x28: *dmem(address) = (uint8_t)sr[rt]; break;
  case 0x29: *dmem(address) = (uint8_t)(sr[rt] >> 8); *dmem(address + 1) = (uint8_t)sr[rt]; break;
  case 0x2B:
    for (int b = 0; b < 4; b++) *dmem(address + b) = (uint8_t)(sr[rt] >> (24 - 8 * b));
    break;
  case 0x32: vu_load(word, sr); break;
  case 0x3A: vu_store(word, sr); break;
  }
  sr[0] = 0;
  return jumps;
}

static uint32_t fetch(uint32_t pc) { return n64_be32(&n64_sp_mem[0x1000 + (pc & 0xFFC)]); }

void rsp_run(void) {
  uint32_t pc = n64_sp.pc & 0xFFC;
  for (long steps = 0; steps < MOST_STEPS; steps++) {
    uint32_t word = fetch(pc), target = 0;
    pc = (pc + 4) & 0xFFC;
    int done = step(word, pc, &target);
    // a jump runs the instruction after it, its delay slot, and goes on from where it jumps to: and a jump in a delay
    // slot runs the first one's target as its own delay slot, as cxd4 does
    while (done == 1) {
      word = fetch(pc);
      pc = target & 0xFFC;
      done = step(word, pc, &target);
    }
    if (done < 0) break;
  }
  n64_sp.pc = pc;
}
