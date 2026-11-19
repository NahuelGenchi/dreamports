// The link cable, in the console's multi-player mode: the work area of up to four consoles' packets.
#ifndef MULTI_SIO_H
#define MULTI_SIO_H
#include "console.h"

#define SIO_MULTI_MODE 0x2000
#define SIO_INTR_ENABLE 0x4000
#define SIO_ENABLE 0x0080
#define SIO_ERROR 0x0040
#define MULTI_SIO_BAUD_RATE_NO 3
/** What a console sends to say a packet starts. */
#define MULTI_SIO_SYNC_DATA 0xFEFE

// the link's registers, and timer 3's control, which paces the packets, by how far each is from 0x04000000
enum { REG_SIOMULTI0 = 0x120, REG_SIOMLT_SEND = 0x12A, REG_TM3CNT_H = 0x10E };

/** One packet each way. */
struct MultiSioPacket {
  /* 0x00 */ u8 frameCounter;
  /* 0x01 */ u8 recvErrorFlags;
  /* 0x02 */ u16 checkSum;
  /* 0x04 */ u16 data[12];
};

/** What the link cable's code keeps. */
struct MultiSioArea {
  /* 0x00 */ u8 type;
  /* 0x01 */ u8 state;
  /* 0x02 */ u8 connectedFlags;
  /* 0x03 */ u8 recvSuccessFlags;
  /* 0x04 */ u8 syncRecvFlag[4];
  /* 0x08 */ u8 flags;
  /* 0x09 */ u8 hardError;
  /* 0x0A */ u8 recvFlagsAvailableCounter;
  /* 0x0B */ u8 sendFrameCounter;
  /* 0x0C */ u8 recvFrameCounter[4][2];
  /* 0x14 */ s32 sendBufCounter;
  /* 0x18 */ s32 recvBufCounter[4];
  /* 0x28 */ u16 *nextSendBufp;
  /* 0x2C */ u16 *currentSendBufp;
  /* 0x30 */ u16 *currentRecvBufp[4];
  /* 0x40 */ u16 *lastRecvBufp[4];
  /* 0x50 */ u16 *recvCheckBufp[4];
  /* 0x60 */ struct MultiSioPacket sendBuf[2];
  /* 0x98 */ struct MultiSioPacket recvBuf[4][3];
};

extern struct MultiSioArea gMultiSioArea;
/** The ARM code of the two functions below, in the cartridge, which MultiSioInit copies to the fast work memory, where
 *  the console runs them. */
extern const u32 MultiSioRecvBufChangeCode[0x10];
extern const u32 MultiSioIntrCode[0x48];
extern u32 gMultiSioRecvFuncBuf[0x10];
extern u32 gMultiSioIntrFuncBuf[0x48];

void MultiSioInit(u32 connectedFlags);
u32 MultiSioRecvBufChange(void);
void MultiSioIntr(void);

#endif
