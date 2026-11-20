// The kit's own: the few types dfsound takes from the emulator's include/psemu_plugin_defs.h, the CD's XA sound as the
// CD drive gives it to the chip and the chip's saved state, by the same names and in the same layout
// (kit/ps1/c/dfsound/NOTICE.md).
#ifndef _PSEMU_PLUGIN_DEFS_H
#define _PSEMU_PLUGIN_DEFS_H

#undef CALLBACK
#define CALLBACK

// the last two samples of each side, which the next sector's ADPCM is decoded from
typedef struct {
  int y0, y1;
} ADPCM_Decode_t;

// a sector of the CD's XA sound, decoded: its rate, its bits a sample, whether it's in stereo, and its samples
typedef struct xa_decode {
  int freq;
  int nbits;
  int stereo;
  int nsamples;
  ADPCM_Decode_t left, right;
  short pcm[16384];
} xa_decode_t;

// the chip's state as a save state keeps it, which the kit keeps its own way
typedef struct SPUFreeze SPUFreeze_t;

#endif
