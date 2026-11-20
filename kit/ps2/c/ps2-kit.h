// What the PlayStation 2 kit's own files share (gs.c, ps2.c), which a game doesn't need.

#ifndef DREAMPORTS_PS2_KIT_H
#define DREAMPORTS_PS2_KIT_H

#include "ps2.h"
#include "floats.h"

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

// What the EE's memories and the paths to the GS share (bus.c, dmac.c, vif.c, gif.c, vu.c)

/** Where a DMA address points: the scratchpad when its top bit is set, or main memory, which wraps at 32 MB as the
 *  console's does. */
uint8_t *ps2_dma_memory(uint32_t address);

/** The DMA controller's registers, read and written (dmac.c). */
uint32_t dmac_read(uint32_t address);
void dmac_write(uint32_t address, uint32_t value);
/** Goes on with every channel that's started and was held up, as the console does as soon as what held it is gone. */
void dmac_resume(void);
/** Goes on with one channel at once, from inside another's transfer, as unmasking PATH3 does with the GIF's (2). */
void dmac_resume_channel(int n);

/** The VIFs (vif.c): their registers and their FIFOs, a word at a time, and a DMA transfer to one, `qwc` quadwords at
 *  a DMA address, the first being the DMA tag when `tag` is set. It gives how many it took. */
uint32_t vif_read(uint32_t address);
void vif_write(uint32_t address, uint32_t value);
uint32_t vif_receive(int unit, uint32_t address, uint32_t qwc, int tag);
/** What a program on vector unit 1 reads with XTOP, and on either with XITOP. */
uint32_t vif1_top(void);
uint32_t vif_itop(int unit);

/** The GIF (gif.c): one packet, or as many as there are, from `memory` of `size` bytes, from `at` to `end`, on `path`
 *  (1 for vector unit 1's XGKICK, 2 for the VIF's DIRECT, 3 for its own DMA channel). Each gives how many bytes it took,
 *  which is fewer when the GIF is busy with another path. */
uint32_t gif_path_packet(int path, const uint8_t *memory, uint32_t size, uint32_t at, uint32_t end);
uint32_t gif_path_packets(int path, const uint8_t *memory, uint32_t size, uint32_t at, uint32_t end);
/** A DMA transfer to the GIF, as vif_receive's. */
uint32_t gif_receive(uint32_t address, uint32_t qwc, int tag);
uint32_t gif_read(uint32_t address);
void gif_write(uint32_t address, uint32_t value);
/** Which path is sending a packet, or 0, and PATH3 masked or let through, as the VIF's MSKPATH3 does. */
int gif_active_path(void);
void gif_mask_path3(int masked);

/** The vector units (vu.c): each one's code and data memory, whether it's free to start a program, and starting one
 *  at a place in its code, which runs to its end then and there. */
uint8_t *vu_code(int unit);
uint8_t *vu_data(int unit);
uint32_t vu_code_size(int unit);
uint32_t vu_data_size(int unit);
int vu_ready(int unit);
void vu_start(int unit, uint32_t address);
/** Where the program last stopped, for MSCNT to go on from. */
uint32_t vu_stopped_at(int unit);
/** A unit's registers as 158 words the function check gives and reads (vu.c): with `set` the words are put in the
 *  unit, and without it read from it. Either way it gives where the words are. */
uint32_t *vu_registers(int unit, int set);

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
/** The disc drive's servers (cdvd.c): set up as the console starts, the IOP's ticks passing, and the kind of disc as
 *  the drive says it. The console's date by its own clock (iop.c). */
void cdvd_power(void);
void cdvd_ticks(uint32_t ticks);
uint32_t cdvd_disc_type(void);
void ps2_console_date(uint32_t parts[6]);
uint32_t ps2_console_seconds(void);
void ps2_date_of(uint32_t seconds, uint32_t parts[6]);
/** The memory cards' server (mc.c): set up as the console starts, the IOP's ticks passing, how many times a call has
 *  changed a card, and the cards as the bytes the page keeps and the proof tools compare. */
void mc_power(void);
void mc_ticks(uint32_t ticks);
int mc_serve(uint32_t number, uint8_t *arguments, uint32_t arguments_size, uint8_t *returned, uint32_t returned_size);
uint32_t mc_changes(void);
const uint8_t *mc_bytes(uint32_t *size);
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
