// What the Nintendo DS kit's own files share, which a game doesn't need (kit/nds/c/README.md).

#ifndef DREAMPORTS_NDS_KIT_H
#define DREAMPORTS_NDS_KIT_H

#include <stdint.h>

/** Stops the game where the kit meets something of the console it doesn't do yet, so a Dreamport never shows a picture
 *  or plays a sound the console wouldn't: the page says the game stopped there. */
void nds_not_yet(void);

// The 2D engines and the video memory (video.c), as the ARM9 sees them
extern uint8_t nds_palette[0x800];
void nds_video_power(void);
/** A write or a read of the video's registers or memory: 1 when it's one of them. */
int nds_video_write(uint32_t address, uint32_t value, int bytes);
int nds_video_read(uint32_t address, int bytes, uint32_t *value);
uint32_t nds_video_dispcnt(int engine);
/** An engine's line `y`, colours of 15 bits. */
void nds_video_line(int engine, int y, uint16_t *line);

// The shared memory, the ARM7's own, the sync register and the message queue (ipc.c), each processor's side by `seven`:
// 1 when it's one of them
void nds_ipc_power(void);
int nds_ipc_read(int seven, uint32_t address, int bytes, uint32_t *value);
int nds_ipc_write(int seven, uint32_t address, uint32_t value, int bytes);

// Each processor's interrupt registers, display status and timers (irq.c), by `seven`, at its time `now`
void nds_irq_power(void);
/** A read or a write of them: 1 when it's one of them. */
int nds_irq_read(int seven, uint64_t now, uint32_t address, int bytes, uint32_t *value);
int nds_irq_write(int seven, uint64_t now, uint32_t address, uint32_t value, int bytes);
/** The display's status as the processor reads it. */
uint32_t nds_irq_dispstat(int seven, uint64_t now);
/** Raises the processor's interrupts due up to `now`: the V-blank's and the timers'. */
void nds_irq_run(int seven, uint64_t now);
/** Raises interrupt `irq` (IF's bit) now, for those another part of the kit raises: the sync register's and the queue's. */
void nds_irq_raise(int seven, int irq);
/** When the next interrupt the processor has on in IE comes of the V-blank or a timer, or UINT64_MAX. */
uint64_t nds_irq_next(int seven);
/** IE and IF together, IME's bit, and IE. */
uint32_t nds_irq_pending(int seven);
int nds_irq_master(int seven);
uint32_t nds_irq_enabled(int seven);

// Each processor's DMA channels (dma.c), by `seven`
void nds_dma_power(void);
/** A read or a write of their registers, or the ARM9's fill registers: 1 when it's one of them. A write that starts a
 *  channel runs it. */
int nds_dma_read(int seven, uint32_t address, int bytes, uint32_t *value);
int nds_dma_write(int seven, uint32_t address, uint32_t value, int bytes);
/** When the next V-blank comes that a channel waits for, or UINT64_MAX. */
uint64_t nds_dma_next(int seven);
/** Whether a V-blank a channel waits for has come by `now`, and when (`at`): each is told once. */
int nds_dma_due(int seven, uint64_t now, uint64_t *at);
/** Runs the channels that wait for the V-blank, from the processor's time. */
void nds_dma_vblank(int seven);
/** A processor's time, which a channel moves on as it runs, and a read and a write on its bus (nds.c). */
uint64_t *nds_time(int seven);
uint32_t nds_bus_read(int seven, uint32_t address, int bytes);
void nds_bus_write(int seven, uint32_t address, uint32_t value, int bytes);

// The ARM9's divider and square root (math.c), at its time `now`: 1 when it's one of their registers
void nds_math_power(void);
int nds_math_read(uint64_t now, uint32_t address, int bytes, uint32_t *value);
int nds_math_write(uint64_t now, uint32_t address, uint32_t value, int bytes);

// The cartridge slot and the cartridge (cart.c), each processor's side by `seven`, at its time `now`
void nds_cart_power(void);
/** A read or a write of the slot's registers, the cartridge's data or EXMEMCNT: 1 when it's one of them. */
int nds_cart_read(int seven, uint64_t now, uint32_t address, int bytes, uint32_t *value);
int nds_cart_write(int seven, uint64_t now, uint32_t address, uint32_t value, int bytes);
/** Brings a side's transfer up to `now`: the words that come, and its end. */
void nds_cart_run(int seven, uint64_t now);
/** When a side's next word comes, or its transfer ends, or UINT64_MAX. */
uint64_t nds_cart_next(int seven);

// The sound (sound.c), on the ARM7's side, by the console's clock.
void nds_sound_power(void);
/** Runs the mixer through every mix that happens before tick `until`, keeping each pair of samples. */
void nds_sound_run(uint64_t until);
/** A write of the ARM7's to the sound's registers, at tick `now`: every mix up to and at that tick happens first. */
void nds_sound_write(uint64_t now, uint32_t address, uint32_t value, int bytes);
uint32_t nds_sound_read(uint32_t address, int bytes);
/** Whether the sound is on at all, as the ARM7's power register's lowest bit says. */
void nds_sound_powered(int on);
/** Takes `count` pairs of samples kept, mixing more where too few are, as -1 to 1. */
void nds_sound_take(float *left, float *right, int count);
/** Drops the samples kept. */
void nds_sound_drop(void);

#endif
