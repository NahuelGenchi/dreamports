// SPDX-License-Identifier: MIT
#include "libsnd_i.h"

void _SsSndPause(s16 arg0, s16 arg1) {
    struct SeqStruct* score = &_ss_score[arg0][arg1];
#ifdef MATCHING
    // Sony's call passes a second argument, which SpuVmSeqKeyOff doesn't take, and GCC builds it so
    SpuVmSeqKeyOff(arg1 << 8 | arg0, arg1 << 8);
#else
    SpuVmSeqKeyOff(arg1 << 8 | arg0);
#endif
    score->unk2b = 0;
    _ss_score[arg0][arg1].unk90 &= ~2;
}
