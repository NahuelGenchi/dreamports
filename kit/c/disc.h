// The player's disc, read as the console's drive reads it, for the kits of consoles whose games come on discs, the
// PlayStation's and the PlayStation 2's (kit/c/README.md, The player's disc). A disc can be several gigabytes, which a
// browser can't hold, so the page reads its sectors from the player's file as the game asks for them (kit/copy/disc.js)
// and keeps only the last few megabytes of them here.
//
// Sectors are counted as the drive counts them: from 0, which on a CD is at 00:02:00. A CD's sector is 2352 bytes as
// the drive reads it whole, and a DVD's 2048. Whatever file the disc came in, the game gets the same bytes: what an
// ISO leaves out of a CD's sectors, their sync, header, subheader, EDC and ECC, is made again as the disc holds them.
//
// What the console's drive takes, in the console's time, to seek and read is the console kit's to count. These give
// the bytes as soon as they're asked for, as far as the game's C can tell: when the page hasn't fetched them yet, the
// game pauses partway through its frame, the page fetches them, and the frame goes on from there (kit.h, kit_pause), so
// a disc is read from code that runs under kit_run.

#ifndef DREAMPORTS_DISC_H
#define DREAMPORTS_DISC_H

#include <stdint.h>

/** What the copy is: no disc, a CD, or a DVD (a UMD is read as a DVD is). */
#define KIT_DISC_NONE 0
#define KIT_DISC_CD 1
#define KIT_DISC_DVD 2

/** A track's kind. */
#define KIT_TRACK_AUDIO 0
#define KIT_TRACK_MODE1 1
#define KIT_TRACK_MODE2 2

/** A track as the disc's table of contents has it: its number, its kind, its first sector (index 1), the sectors of its
 *  own before that (its pregap, from index 0), and how many sectors it has from its first to the next one's pregap. */
typedef struct {
  uint8_t number, type;
  uint32_t first, pregap, sectors;
} kit_track;

/** The copy's kind, KIT_DISC_NONE for a copy that isn't a disc. */
int kit_disc_kind(void);
/** How many sectors the disc has: a CD's lead-out. */
uint32_t kit_disc_sectors(void);
/** Where a DVD's second layer starts, or 0 for a disc of one layer. */
uint32_t kit_disc_layer_break(void);
/** How many tracks it has, and track `number` (from 1), or NULL past the last. */
int kit_disc_track_count(void);
const kit_track *kit_disc_track(int number);

/**
 * Reads `count` sectors from `lba` into `to`: of each, `size` bytes from byte `from` of the whole sector as the drive
 * reads it. On a CD that's 2352 bytes: its sync at 0, its header at 12, a Mode 2 sector's subheader at 16 and its data
 * at 24, a Mode 1 sector's data at 16, or 2352 bytes of sound. On a DVD it's the 2048 bytes of data. Returns how many it
 * read: fewer past the disc's end. `from` + `size` past a sector's end stops the game, as a wrong read in C would.
 */
uint32_t kit_disc_read(uint32_t lba, uint32_t count, uint32_t from, uint32_t size, uint8_t *to);

/** The subchannel Q a CD's drive reads beside sector `lba`: its track's kind and number, its index, the time within the
 *  track and on the disc, each in BCD, and the CRC, 12 bytes. In a pregap the time counts down to the track's start. */
void kit_disc_q(uint32_t lba, uint8_t q[12]);

/** Says the drive was told to read from `lba`: the page fetches those sectors while the console's drive would be
 *  seeking, so the read seldom has to wait for them. */
void kit_disc_ahead(uint32_t lba, uint32_t count);

#endif
