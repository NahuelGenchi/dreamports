// What the PlayStation kit's own files share (gpu.c, ps1.c), which a game doesn't need.

#ifndef DREAMPORTS_PS1_KIT_H
#define DREAMPORTS_PS1_KIT_H

#include "ps1.h"
#include "kit.h"

/** Puts the GPU as the console starts it: nothing shown, and video memory as it was. */
void gpu_power(void);

#endif
