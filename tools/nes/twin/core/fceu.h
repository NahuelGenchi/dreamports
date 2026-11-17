// What FCEUmm's processor (its x6502.c, built as it is from its makers' source) asks of the rest of the emulator, and
// no more, for the function check (../../twin.mjs): the build puts this beside its copy of that file, where it stands
// in for the emulator's own header of this name.
#ifndef DREAMPORTS_TWIN_FCEU_H
#define DREAMPORTS_TWIN_FCEU_H
#include <stdint.h>
#include "fceu-types.h"
extern uint8_t *RAM;
extern readfunc ARead[0x10000];
extern writefunc BWrite[0x10000];
extern uint8_t PAL;
extern int overclocked;
#define dendy 0
#endif
