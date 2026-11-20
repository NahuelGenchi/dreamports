// What the Nintendo 64 kit's own files share (n64.c, rsp.c, vu.c, rdp.c, vi.c), which a game doesn't need.

#ifndef DREAMPORTS_N64_KIT_H
#define DREAMPORTS_N64_KIT_H

#include "n64.h"
#include "kit.h"

/** The RSP's memories as the console keeps them, highest byte first: its data, DMEM, from 0, and its instructions,
 *  IMEM, from 0x1000. */
extern uint8_t n64_sp_mem[0x2000];

// SP_STATUS's bits
enum {
  SP_HALT = 0x001, SP_BROKE = 0x002, SP_DMA_BUSY_BIT = 0x004, SP_DMA_FULL_BIT = 0x008, SP_IO_FULL = 0x010,
  SP_SINGLE_STEP = 0x020, SP_INTR_BREAK = 0x040,
};
// DPC_STATUS's bits
enum { DPC_XBUS = 0x001, DPC_FREEZE = 0x002, DPC_FLUSH = 0x004 };

/** The RSP's registers, as its coprocessor 0 numbers them: the DMA's, its status and semaphore, and the RDP's. */
struct n64_sp {
  uint32_t mem_addr, dram_addr, rd_len, wr_len, status, semaphore, pc;
};
extern struct n64_sp n64_sp;
struct n64_dp {
  uint32_t start, end, current, status, clock, bufbusy, pipebusy, tmem;
};
extern struct n64_dp n64_dp;
/** MI_INTR: the interrupts raised and not yet seen. */
extern uint32_t n64_mi_intr;
/** The video interface's 14 registers, in the order of their addresses. */
extern uint32_t n64_vi[14];

/** Raises a chip's interrupt, a bit of MI_INTR. */
static inline void n64_interrupt(uint32_t bit) { n64_mi_intr |= bit; }

// numbers in the console's order, highest byte first
static inline uint32_t n64_be32(const uint8_t *p) { return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3]; }
static inline void n64_put_be32(uint8_t *p, uint32_t value) {
  p[0] = (uint8_t)(value >> 24); p[1] = (uint8_t)(value >> 16); p[2] = (uint8_t)(value >> 8); p[3] = (uint8_t)value;
}

/** The console as it starts: memory clear, every chip as it powers on, and the cartridge's first 4 KB in the RSP's
 *  data memory, where its boot code runs from. */
void n64_power(void);

/** The RSP as the console starts it: halted, with its memories and registers clear. */
void rsp_power(void);
/** A write to one of the RSP's registers from the processor: SP_STATUS, its DMA, its semaphore and its PC. */
void rsp_write(uint32_t reg, uint32_t value);
uint32_t rsp_read(uint32_t reg);
/** Runs the RSP from SP_PC until it breaks or halts, as the console's emulator runs a task: at once, whole. */
void rsp_run(void);
/** The vector unit as the console starts it. */
void vu_power(void);
/** One of the vector unit's instructions: COP2, LWC2 or SWC2 (vu.c). `sr` is the scalar unit's registers. */
void vu_cop2(uint32_t word, uint32_t *sr);
void vu_load(uint32_t word, const uint32_t *sr);
void vu_store(uint32_t word, const uint32_t *sr);

/** The RDP as the console starts it. */
void rdp_power(void);
/** A write to one of the RDP's command registers, from the processor or the RSP: DPC_END starts it on the commands
 *  from DPC_CURRENT. */
void rdp_write(uint32_t reg, uint32_t value);
uint32_t rdp_read(uint32_t reg);

/** The video interface as the console starts it. */
void vi_power(void);
/** The video interface's picture made from RDRAM, as each frame ends. */
void vi_update(void);

#endif
