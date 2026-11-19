// The link cable.
#include "multi_sio.h"

/** MultiSioInit, 0x08006C60: the serial port in multi-player mode, its work area emptied, the code its interrupt runs
 *  copied to the fast work memory, and the packets' buffers pointed at. */
void MultiSioInit(u32 connectedFlags) {
  s32 i;

  REG_WRITE16(REG_IME, 0);
  REG_WRITE16(REG_IE, REG_READ16(REG_IE) & ~(INTR_FLAG_SERIAL | INTR_FLAG_TIMER3));
  REG_WRITE16(REG_IME, 1);
  REG_WRITE16(REG_RCNT, 0);
  REG_WRITE32(REG_SIOCNT, SIO_MULTI_MODE);
  REG_WRITE16(REG_SIOCNT, REG_READ16(REG_SIOCNT) | SIO_INTR_ENABLE | MULTI_SIO_BAUD_RATE_NO);
  CpuFill32(0, &gMultiSioArea, sizeof(struct MultiSioArea));
  CpuCopy32(MultiSioRecvBufChange, gMultiSioRecvFuncBuf, sizeof(gMultiSioRecvFuncBuf));
  CpuCopy32(MultiSioIntr, gMultiSioIntrFuncBuf, sizeof(gMultiSioIntrFuncBuf));
  gMultiSioArea.connectedFlags = connectedFlags;
  gMultiSioArea.sendBufCounter = 13;
  gMultiSioArea.nextSendBufp = (u16 *)&gMultiSioArea.sendBuf[0];
  gMultiSioArea.currentSendBufp = (u16 *)&gMultiSioArea.sendBuf[1];
  for (i = 0; i < 4; ++i) {
    gMultiSioArea.currentRecvBufp[i] = (u16 *)&gMultiSioArea.recvBuf[i][0];
    gMultiSioArea.lastRecvBufp[i] = (u16 *)&gMultiSioArea.recvBuf[i][1];
    gMultiSioArea.recvCheckBufp[i] = (u16 *)&gMultiSioArea.recvBuf[i][2];
  }
  REG_WRITE16(REG_IME, 0);
  REG_WRITE16(REG_IE, REG_READ16(REG_IE) | INTR_FLAG_SERIAL);
  REG_WRITE16(REG_IME, 1);
}
