// The kit's own: what the emulator's psemuxa.h says of the CD's XA sound, which dfsound's stdafx.h includes and
// nothing of the sound chip calls (kit/ps1/c/dfsound/NOTICE.md).
#ifndef DECODEXA_H
#define DECODEXA_H

struct xa_decode;

int xa_decode_sector(struct xa_decode *xdp, unsigned char *sectorp, int is_first_sector);

#endif
