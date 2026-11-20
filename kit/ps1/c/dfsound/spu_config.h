// The kit's own: dfsound's settings, which the emulator's spu_config.h says and its frontend sets from its options. The
// kit's sound.c sets them as the tools' emulator is set (tools/consoles.mjs; kit/ps1/c/dfsound/NOTICE.md).
#ifndef __P_SPU_CONFIG_H__
#define __P_SPU_CONFIG_H__

typedef struct {
  int iVolume;           // the mix's loudness, 1024 for as loud as the chip makes it
  int iXAPitch;          // a CD's sound sped up or slowed down to keep up, which the kit never does
  int iUseReverb;        // the chip's reverb
  int iUseInterpolation; // how a voice is stepped between its samples: 2 is the chip's own Gaussian table
  int iTempo;            // more samples made when the speakers want them, which a Dreamport's page never asks
  int iUseThread;        // mixed on a second thread, which the kit never does
} SPUConfig;

extern SPUConfig spu_config;

#endif
