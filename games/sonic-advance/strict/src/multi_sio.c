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
  CpuCopy32(MultiSioRecvBufChangeCode, gMultiSioRecvFuncBuf, sizeof(gMultiSioRecvFuncBuf));
  CpuCopy32(MultiSioIntrCode, gMultiSioIntrFuncBuf, sizeof(gMultiSioIntrFuncBuf));
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

// The two below are ARM code in the original, written by hand, which no compiler gives back: their twins are proven by
// the memory they leave. Each reads and writes as the processor's own instructions do.

// A halfword as the processor's LDR of a word gives it, at an address it needn't line up: the word around the address,
// turned so that the byte at the address comes first.
#define ARM_WORD_LOW16(at) \
  ((u16)((at) & 3 ? *(u32 *)((at) & ~3u) >> ((at) & 3) * 8 | *(u32 *)((at) & ~3u) << (32 - ((at) & 3) * 8) : *(u32 *)(at)))

/** MultiSioRecvBufChange, 0x080001CC, ARM, run from its copy in the fast work memory: with the interrupts off, each
 *  console's last packet and the one being checked trade places, and the flags of the packets that came in whole are
 *  given back, a byte a console, and cleared. */
u32 MultiSioRecvBufChange(void) {
  u16 *last[4];
  u32 i, received;

  REG_WRITE16(REG_IME, 0);
  for (i = 0; i < 4; i++) last[i] = gMultiSioArea.lastRecvBufp[i];
  for (i = 0; i < 4; i++) gMultiSioArea.lastRecvBufp[i] = gMultiSioArea.recvCheckBufp[i];
  for (i = 0; i < 4; i++) gMultiSioArea.recvCheckBufp[i] = last[i];
  received = *(u32 *)gMultiSioArea.syncRecvFlag;
  *(u32 *)gMultiSioArea.syncRecvFlag = 0;
  REG_WRITE16(REG_IME, 1);
  return received;
}

/** MultiSioIntr, 0x0800020C, dp:unaligned, ARM, run from its copy in the fast work memory as the link's interrupt,
 *  which reads the next halfword to send with a word's load, where no word starts every other time: what each console
 *  sent is read, the next halfword of this console's packet sent, or the mark that one starts, and each console's
 *  halfword kept in its packet, a whole packet traded for the last one. A parent console starts the next send. */
void MultiSioIntr(void) {
  u16 recv[4];
  s32 counter, i;
  u16 *swap;

  for (i = 0; i < 4; i++) recv[i] = REG_READ16(REG_SIOMULTI0 + 2 * i);
  gMultiSioArea.hardError = REG_READ16(REG_SIOCNT) & SIO_ERROR;
  counter = gMultiSioArea.sendBufCounter;
  if (counter == -1) {
    REG_WRITE16(REG_SIOMLT_SEND, MULTI_SIO_SYNC_DATA);
    swap = gMultiSioArea.nextSendBufp;
    gMultiSioArea.nextSendBufp = gMultiSioArea.currentSendBufp;
    gMultiSioArea.currentSendBufp = swap;
  } else if (counter >= 0) {
    REG_WRITE16(REG_SIOMLT_SEND, ARM_WORD_LOW16((u32)gMultiSioArea.currentSendBufp + (u32)counter * 2));
  }
  if (counter < 13) gMultiSioArea.sendBufCounter = counter + 1;

  for (i = 3; i >= 0; i--) {
    s32 n = gMultiSioArea.recvBufCounter[i];
    if (recv[i] == MULTI_SIO_SYNC_DATA && n > 11) {
      n = -1;
    } else {
      u16 *buf = gMultiSioArea.currentRecvBufp[i];
      // STRH: the halfword at the address with its lowest bit dropped
      *(u16 *)(((u32)buf + (u32)n * 2) & ~1u) = recv[i];
      if (n == 11) {
        gMultiSioArea.currentRecvBufp[i] = gMultiSioArea.lastRecvBufp[i];
        gMultiSioArea.lastRecvBufp[i] = buf;
        gMultiSioArea.syncRecvFlag[i] = 1;
      }
    }
    if (n < 13) n++;
    gMultiSioArea.recvBufCounter[i] = n;
  }

  if (gMultiSioArea.type) {
    REG_WRITE16(REG_TM3CNT_H, 0);
    REG_WRITE16(REG_SIOCNT, REG_READ16(REG_SIOCNT) | SIO_ENABLE);
    REG_WRITE16(REG_TM3CNT_H, 0xC0);
  }
}
