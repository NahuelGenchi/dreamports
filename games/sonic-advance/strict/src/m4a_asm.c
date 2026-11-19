// The sound library's part written in assembly, as C: the sequencer's commands and helpers, from SAT-R's m4a0.s, an
// instruction's work at a time. The console's compiler can't give their bytes back, as they were never C, so their
// proof is the same memory.
#include "m4a_internal.h"

/** SoundMainBTM, 0x08096ED8: 64 bytes at `at` zeroed. */
void SoundMainBTM(void *at) {
  u32 *word = at;
  u32 i;
  for (i = 0; i < 16; i++) word[i] = 0;
}

/** MP2KClearChain, 0x08096EF0: a channel out of its track's chain of channels, if it's in one. */
void MP2KClearChain(struct MixerSource *chan) {
  struct MP2KTrack *track = chan->track;
  struct MixerSource *next, *prev;
  if (track == NULL) return;
  next = chan->next;
  prev = chan->prev;
  if (prev != NULL) prev->next = next;
  else track->chan = next;
  if (next != NULL) next->prev = prev;
  chan->track = NULL;
}

// the cartridge's table of the sequencer's commands, which MPlayJumpTableCopy copies
extern void *const gMPlayJumpTableTemplate[36];

/** MPlayJumpTableCopy, 0x08096F40: the sequencer's 36 commands, each its function's address, from the cartridge's
 *  table into `table`. */
void MPlayJumpTableCopy(void **table) {
  u32 i;
  for (i = 0; i < 36; i++) table[i] = gMPlayJumpTableTemplate[i];
}
