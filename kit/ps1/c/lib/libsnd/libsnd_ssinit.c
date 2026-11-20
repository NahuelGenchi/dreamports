// SPDX-License-Identifier: MIT
#include "libsnd_i.h"

typedef void (*SndSsMarkCallbackProc)(short seq_no, short sep_no, short data);
extern SndSsMarkCallbackProc _SsMarkCallback[32][16];

static short spu_voice_defaults[] = {
    0x0000, 0x0000, 0x1000, 0x3000, 0x00BF, 0x0000, 0x0000, 0x0000};
static short spu_common_defaults[] = {
    0x3FFF, 0x3FFF, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000,
    0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000, 0x0000};

void _SsInit(void) {
    u16* var_a2;
    int i, j;

    var_a2 = (u16*)0x1F801C00;
    for (i = 0; i < 24; i++) {
        for (j = 0; j < 8; j++) {
#ifdef PLATFORM_PSYZ
            write_16(0x1F801C00 + (i * 8 + j) * 2, spu_voice_defaults[j], __FILE__,
                     __LINE__);
#else
            *var_a2++ = spu_voice_defaults[j];
#endif
        }
    }

    var_a2 = (u16*)0x1F801D80;
    for (i = 0; i < 16; i++) {
#ifdef PLATFORM_PSYZ
        write_16(0x1F801D80 + i * 2, spu_common_defaults[i], __FILE__, __LINE__);
#else
        *var_a2++ = spu_common_defaults[i];
#endif
    }

    SpuVmInit(24);

    for (j = 0; j < 32; j++) {
        for (i = 0; i < 16; i++) {
            _SsMarkCallback[j][i] = 0;
        }
    }

    VBLANK_MINUS = 60;
    _snd_openflag = 0;
    _snd_ev_flag = 0;
}
