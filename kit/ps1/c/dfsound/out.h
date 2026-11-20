// The kit's own: what dfsound gives its samples to, which the emulator's out.h says and the kit's sound.c fills in, as
// the emulator's frontend fills it in for its own speakers (kit/ps1/c/dfsound/NOTICE.md).
#ifndef __P_OUT_H__
#define __P_OUT_H__

struct out_driver {
  const char *name;
  int (*init)(void);
  void (*finish)(void);
  int (*busy)(void);
  void (*feed)(void *data, int bytes);
};

/** Where SPUasync gives each frame's samples, 16 bits each, left and then right. */
extern struct out_driver *out_current;

/** Picks where the samples go, as the chip is opened: the kit's own. */
void SetupSound(void);

#endif
