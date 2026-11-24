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
