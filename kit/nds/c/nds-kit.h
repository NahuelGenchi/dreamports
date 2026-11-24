// What the Nintendo DS kit's own files share, which a game doesn't need (kit/nds/c/README.md).

#ifndef DREAMPORTS_NDS_KIT_H
#define DREAMPORTS_NDS_KIT_H

#include <stdint.h>

/** Stops the game where the kit meets something of the console it doesn't do yet, so a Dreamport never shows a picture
 *  or plays a sound the console wouldn't: the page says the game stopped there. */
void nds_not_yet(void);

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
