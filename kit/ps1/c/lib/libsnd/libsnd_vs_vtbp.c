// SPDX-License-Identifier: MIT
#include "libsnd_i.h"

static s32 vab_transfer_left = 0;
static s16 vab_transfer_id = -1;

short SsVabTransBodyPartly(
    unsigned char* addr, unsigned long bufsize, short vabid) {
    u32 new_bufsize;

    if (vabid < 0 || vabid > 0x10 || _svm_vab_used[vabid] != 2) {
        _spu_setInTransfer(0);
        return -1;
    }
    if (vab_transfer_left == 0) {
        vab_transfer_id = vabid;
        vab_transfer_left = _svm_vab_total[vabid];
        SpuSetTransferMode(0);
        SpuSetTransferStartAddr(_svm_vab_start[vabid]);
    }
    if (vab_transfer_id != vabid) {
        _spu_setInTransfer(0);
        return -1;
    }

    new_bufsize = (vab_transfer_left < bufsize) ? vab_transfer_left : bufsize;

    _spu_setInTransfer(1);
    SpuWritePartly(addr, new_bufsize);

    vab_transfer_left -= new_bufsize;
    if (vab_transfer_left != 0) {
        return -2;
    }
    vab_transfer_id = -1;
    vab_transfer_left = 0;
    _svm_vab_used[vabid] = 1;
    return vabid;
}
