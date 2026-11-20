// What the PlayStation 2 kit's own files share (gs.c, ps2.c), which a game doesn't need.

#ifndef DREAMPORTS_PS2_KIT_H
#define DREAMPORTS_PS2_KIT_H

#include "ps2.h"

/** Gives the GS its memory, once. */
void gs_power(void);
/** Starts a frame: its draw list again, and the V-blank it starts with, CSR's VSINT and its field and the interrupt
 *  they raise. */
void gs_list_start(void);
/** The hash of what has been written since, as the proof tools hash the original's, and how many things that was. */
uint32_t gs_list_hash(void);
uint32_t gs_list_count(void);
/** The whole list since it started, its size in `size`, or 0xFFFFFFFF there when it was too long to keep. */
const uint8_t *gs_list_bytes(uint32_t *size);

/** The console's time (iop.c): set from power-on, and run to the next V-blank's start, mixing the sound due on the way. */
void ps2_clock_power(void);
void ps2_clock_to_vblank(void);
/** The SIF as the EE's ticks pass (sif.c), the IOP's kernel set up as the console starts, and its threads woken by the
 *  V-blank (iop-bios.c). */
void sif_ticks(uint32_t ticks);
void sif_iop_run(void);
void iop_bios_power(void);
void iop_vblank(void);
void iop_threads(void);
/** The pads on the SIO2 (pad.c): set as the console starts, given the frame's buttons, and the SIO2's registers and its
 *  two DMA channels as the IOP reaches them. */
void pad_power(void);
void pad_hold(uint32_t held);
void sio2_write(uint32_t address, uint32_t value);
uint32_t sio2_read(uint32_t address);
uint32_t sio2_dma_in(uint8_t *buffer, uint32_t block_size, uint32_t blocks);
uint32_t sio2_dma_out(uint8_t *buffer, uint32_t block_size, uint32_t blocks);
/** The IOP's interrupt lines the kit keeps: the sound chip's, then the two sound DMA channels' ended transfers. */
uint32_t iop_lines(void);
/** The sound chip (spu2.c): a register written or read, at its IOP address, a DMA transfer to or from a core, giving
 *  how many blocks it took, a block of 45 samples mixed, and whether a core's interrupt is pending. */
void spu2_write(uint32_t address, uint32_t value);
uint32_t spu2_read(uint32_t address);
uint32_t spu2_dma(int core, uint8_t *buffer, uint32_t block_size, uint32_t blocks, uint32_t direction);
void spu2_block(void);
int spu2_irq(void);
/** The frame's sound list, as the draw list is kept (gs.c), and the samples mixed since it started, left and right. */
void spu2_list_start(void);
uint32_t spu2_list_hash(void);
uint32_t spu2_list_count(void);
const uint8_t *spu2_list_bytes(uint32_t *size);
const int16_t *spu2_heard(uint32_t *pairs);

#endif
