// The cartridge's flash memory, which the save is kept in: the console's library for it, which Sonic Advance was given
// already built, with -O1 (its proof/original.json, "compiler").
#include "flash.h"
#include "core.h"
#include "time.h"

#define REG_TMCNT(n) (0x100 + (n) * 4)
#define INTR_FLAG_TIMER0 0x0008

// a wait long enough for the chip to take a command. In the console's time, it starts at `store`, where the count is
// kept, and goes round from `loop`, each turn a run: frames of power-on end in the middle of it
#ifdef MATCHING
#define DELAY(store, loop)               \
  do {                                   \
    vu16 i;                              \
    for (i = 20000; i != 0; i--) {}      \
  } while (0)
#else
#define DELAY(store, loop)                                                  \
  do {                                                                      \
    vu16 i;                                                                 \
    for (i = 20000; i != 0; i--) {                                          \
      if (i == 20000) TIME((store), (store) + 6, (loop) + 1, IW, IW);       \
      else TIME((loop), (loop) + 0xA, (loop) + 1, IW, IW, IW);              \
    }                                                                       \
    TIME((loop), (loop) + 0xA, (loop) + 0xC, IW, IW, IW);                   \
  } while (0)
#endif

/** ReadFlashId, 0x08098C54: the chip's maker and kind, read in its ID mode through ReadFlash1 run from the stack, as
 *  the flash can't be read while the cartridge's code runs from it. */
u16 ReadFlashId(void) {
  u16 flashId;
  u16 readFlash1Buffer[0x20];
  u8 (*readFlash1)(u8 *);

  TIME(0x08098C54, 0x08098C5C, 0x08098ECD);
  SetReadFlash1(readFlash1Buffer);
  readFlash1 = (u8(*)(u8 *))((s32)readFlash1Buffer + 1);

  FLASH_WRITE(0x5555, 0xAA);
  FLASH_WRITE(0x2AAA, 0x55);
  FLASH_WRITE(0x5555, 0x90);
  TIME(0x08098C5E, 0x08098C78, 0x08098C8D, 0x0E005555, 0x0E002AAA, 0x0E005555);
  DELAY(0x08098C8C, 0x08098C88);

  // each read through the compiler's bx to the copy
  TIME(0x08098C94, 0x08098C98, 0x08099859);
  TIME(0x08099858, 0x08099858, 0x03007E7D);
  flashId = CALL(readFlash1)(FLASH_BASE + 1) << 8;
  TIME(0x03007E7C, 0x03007E7E, BACK, 0x0E000001);
  TIME(0x08098C9A, 0x08098CA4, 0x08099859);
  TIME(0x08099858, 0x08099858, 0x03007E7D);
  flashId |= CALL(readFlash1)(FLASH_BASE);
  TIME(0x03007E7C, 0x03007E7E, BACK, 0x0E000000);

  FLASH_WRITE(0x5555, 0xAA);
  FLASH_WRITE(0x2AAA, 0x55);
  FLASH_WRITE(0x5555, 0xF0);
  TIME(0x08098CA6, 0x08098CC2, 0x08098CD9, 0x0E005555, 0x0E002AAA, 0x0E005555);
  DELAY(0x08098CD8, 0x08098CD4);
  TIME(0x08098CE0, 0x08098CE8, BACK);
  return flashId;
}

/** FlashTimerIntr, 0x08098D80: the timer's interrupt counts a wait down, and says when it has run out. */
void FlashTimerIntr(void) {
#ifdef MATCHING
  if (sTimerCount != 0 && --sTimerCount == 0) gFlashTimeoutFlag = 1;
#else
  if (sTimerCount == 0) {
    TIME(0x08098D80, 0x08098D86, 0x08098D9B, IW);
  } else if (--sTimerCount != 0) {
    TIME(0x08098D80, 0x08098D92, 0x08098D9B, IW, IW, IW);
  } else {
    gFlashTimeoutFlag = 1;
    TIME(0x08098D80, 0x08098D98, 0x08098D9B, IW, IW, IW, IW);
  }
  TIME(0x08098D9A, 0x08098D9A, BIOS_BACK);
#endif
}

/** SetFlashTimerIntr, 0x08098DA4: the flash library counts its waits on timer `timerNum`, whose interrupt runs
 *  FlashTimerIntr. None but timers 0 to 3. */
u16 SetFlashTimerIntr(u8 timerNum, void (**intrFunc)(void)) {
  if (timerNum >= 4) return 1;

  sTimerNum = timerNum;
  gTimerReg = (vu16 *)(0x04000000 + REG_TMCNT(sTimerNum));
  *intrFunc = CODE(FlashTimerIntr);
  return 0;
}

/** IdentifyFlash, 0x08098CEC: the flash chip the cartridge has, by the id it answers, and the library's ways to write
 *  it. Gives back 0 for a chip it knows, and 1, with the last of its list's ways, for one it doesn't. */
u16 IdentifyFlash(void) {
  u16 result;
  u16 flashId;
  const struct FlashSetupInfo *const *setupInfo;

  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  TIME(0x08098CEC, 0x08098CFE, 0x08098C55, 0x04000204, 0x04000204);
  flashId = ReadFlashId();
  setupInfo = gSetup512KInfos;
  result = 1;

  for (;;) {
    if ((*setupInfo)->type.ids.separate.makerId == 0) break;
    if (flashId == (*setupInfo)->type.ids.joined) {
      result = 0;
      break;
    }
    setupInfo++;
  }

  ProgramFlashSector = (*setupInfo)->programFlashSector;
  EraseFlashChip = (*setupInfo)->eraseFlashChip;
  EraseFlashSector = (*setupInfo)->eraseFlashSector;
  WaitForFlashWrite = (*setupInfo)->WaitForFlashWrite;
  gFlashMaxTime = (*setupInfo)->maxTime;
  gFlash = &(*setupInfo)->type;
  return result;
}

/** StartFlashTimer, 0x08098DDC: a wait of `phase`'s length starts on the library's timer, whose interrupt counts it. */
void StartFlashTimer(u8 phase) {
  const u16 *maxTime = &gFlashMaxTime[phase * 3];

  gSavedIme = REG_READ16(REG_IME);
  REG_WRITE16(REG_IME, 0);
  gTimerReg[1] = 0;
  TIMER_WROTE(&gTimerReg[1]);
  REG_WRITE16(REG_IE, REG_READ16(REG_IE) | (INTR_FLAG_TIMER0 << sTimerNum));
  gFlashTimeoutFlag = 0;
  sTimerCount = *maxTime++;
  *gTimerReg++ = *maxTime++;
  TIMER_WROTE(gTimerReg - 1);
  *gTimerReg-- = *maxTime++;
  TIMER_WROTE(gTimerReg + 1);
  REG_WRITE16(REG_IF, INTR_FLAG_TIMER0 << sTimerNum);
  REG_WRITE16(REG_IME, 1);
  TIME(0x08098DDC, 0x08098E5C, BACK, IW, 0x04000208, IW, 0x04000208, IW, 0x04000106, IW, 0x04000200, 0x04000200, IW, ROM, IW, ROM,
       0x04000104, IW, ROM, 0x04000106, IW, IW, 0x04000202, 0x04000208);
}

/** StopFlashTimer, 0x08098E84: the library's timer stopped, and its interrupt off. */
void StopFlashTimer(void) {
  REG_WRITE16(REG_IME, 0);
  *gTimerReg++ = 0;
  TIMER_WROTE(gTimerReg - 1);
  *gTimerReg-- = 0;
  TIMER_WROTE(gTimerReg + 1);
  REG_WRITE16(REG_IE, REG_READ16(REG_IE) & ~(INTR_FLAG_TIMER0 << sTimerNum));
  REG_WRITE16(REG_IME, gSavedIme);
  TIME(0x08098E84, 0x08098EB0, BACK, 0x04000208, IW, 0x04000104, IW, 0x04000106, IW, IW, 0x04000200, 0x04000200, IW, 0x04000208);
}

/** 0x08098EC8, ReadFlash1: a byte of the flash, from code copied to RAM. */
u8 ReadFlash1(u8 *addr) { return FLASH_PEEK(addr); }

/** SetReadFlash1, 0x08098ECC: ReadFlash1 copied to `dest`, from where PollFlashStatus runs it. */
void SetReadFlash1(u16 *dest) {
  u16 *src;
  u16 i;

  PollFlashStatus = (u8(*)(u8 *))((s32)dest + 1);
  src = (u16 *)CODE(ReadFlash1);
  src = (u16 *)((s32)src ^ 1);
  i = ((s32)CODE(SetReadFlash1) - (s32)CODE(ReadFlash1)) >> 1;
  TIME(0x08098ECC, 0x08098EE2, 0x08098EFD, IW);
#ifndef MATCHING
  if (i != 0) TIME(0x08098EFC, 0x08098F00, 0x08098EF1);
  else TIME(0x08098EFC, 0x08098F02, BACK);
#endif
  while (i != 0) {
    *dest++ = *src++;
    i--;
#ifndef MATCHING
    if (i != 0) TIME(0x08098EF0, 0x08098F00, 0x08098EF1, ROM, IW);
    else TIME(0x08098EF0, 0x08098F02, BACK, ROM, IW);
#endif
  }
}

// The chip's status, read by the reader's copy on the stack: in the console's time, the load of the copy's address
// and the call through the compiler's bx, the copy's own two instructions, and back
#ifdef MATCHING
#define POLL_FLASH(addr) CALL(PollFlashStatus)(addr)
#else
static u8 poll_flash(u8 *addr) {
  u8 status;
  TIME(0x08098F54, 0x08098F5A, 0x08099849, IW);
  TIME(0x08099848, 0x08099848, (u32)PollFlashStatus);
  status = CALL(PollFlashStatus)(addr);
  TIME((u32)PollFlashStatus & ~1u, ((u32)PollFlashStatus & ~1u) + 2, BACK, 0x0E000000u);
  return status;
}
#define POLL_FLASH(addr) poll_flash(addr)
#endif

/** WaitForFlashWrite512K_Common, 0x08098F04: waits until the chip reads back `lastData` at `addr`, or `phase`'s time
 *  is out, which is an error (0xC000 and the phase). */
u16 WaitForFlashWrite512K_Common(u8 phase, u8 *addr, u8 lastData) {
  u16 result = 0;
  u8 status;

  TIME(0x08098F04, 0x08098F1E, 0x08098DDD);
  StartFlashTimer(phase);
  TIME(0x08098F20, 0x08098F2A, 0x08098F55);
  while ((status = POLL_FLASH(addr)) != lastData) {
    if (gFlashTimeoutFlag) {
      if (CALL(PollFlashStatus)(addr) == lastData) break;
      if (gFlash->ids.joined == 0x1cc2) FLASH_WRITE(0x5555, 0xF0);
      result = phase | 0xC000u;
      break;
    }
    TIME(0x08098F5C, 0x08098F6A, 0x08098F55, IW);
  }
  // (the way out through a time-out isn't timed)
#ifndef MATCHING
  if (status == lastData) TIME(0x08098F5C, 0x08098F62, 0x08098F7D);
#endif
  TIME(0x08098F7C, 0x08098F7E, 0x08098E85);
  StopFlashTimer();
  TIME(0x08098F80, 0x08098F8A, BACK);
  return result;
}

/** ReadFlash_Core, 0x08098F90: `size` bytes copied, run from RAM. */
void ReadFlash_Core(u8 *src, u8 *dest, u32 size) {
  while (size-- != 0) *dest++ = *src++;
}

/** ReadFlash, 0x08098FB4: `size` bytes of a sector of the flash from `offset`, read by ReadFlash_Core run from the
 *  stack. */
void ReadFlash(u16 sectorNum, u32 offset, void *dest, u32 size) {
  u8 *src;
  u16 i;
  u16 readFlash_Core_Buffer[0x40];
  u16 *funcSrc;
  u16 *funcDest;
  void (*readFlash_Core)(u8 *, u8 *, u32);

  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  funcSrc = (u16 *)CODE(ReadFlash_Core);
  funcSrc = (u16 *)((s32)funcSrc ^ 1);
  funcDest = readFlash_Core_Buffer;
  i = ((s32)CODE(ReadFlash) - (s32)CODE(ReadFlash_Core)) >> 1;
  while (i != 0) {
    *funcDest++ = *funcSrc++;
    i--;
  }
  readFlash_Core = (void (*)(u8 *, u8 *, u32))((s32)readFlash_Core_Buffer + 1);
  src = FLASH_BASE + (sectorNum << DefaultFlash512K.type.sector.shift) + offset;
  CALL(readFlash_Core)(src, dest, size);
}

#ifndef MATCHING
// where the copy of it that's running is, for its time: the stack, as VerifyFlashSectorNBytes puts it there
static u32 verify_core_at;
#endif

/** VerifyFlashSector_Core, 0x08099030: where two runs of bytes first differ, or 0, run from RAM. */
u32 VerifyFlashSector_Core(u8 *src, u8 *tgt, u32 size) {
#ifdef MATCHING
  while (size-- != 0) {
    if (*tgt++ != *src++) return (u32)(tgt - 1);
  }
#else
  u32 at = verify_core_at, first = 1;
  // (timed where every byte is the same, from the first)
  while (size-- != 0) {
    if (*tgt++ != *src++) return (u32)(tgt - 1);
    if (first) TIME(at, at + 0x1A, at + 0x21, FLASH, IW);
    else TIME(at + 0x10, at + 0x1A, at + 0x21, FLASH, IW);
    first = 0;
    if (size != 0) TIME(at + 0x20, at + 0x24, at + 0x11);
    else TIME(at + 0x20, at + 0x2C, BACK);
  }
#endif
  return 0;
}

/** VerifyFlashSectorNBytes, 0x080990D4: where a sector's first `n` bytes first differ from `src`, or 0, by
 *  VerifyFlashSector_Core run from the stack. */
u32 VerifyFlashSectorNBytes(u16 sectorNum, u8 *src, u32 n) {
  u16 i;
  u16 verifyFlashSector_Core_Buffer[0x80];
  u16 *funcSrc;
  u16 *funcDest;
  u8 *tgt;
  u32 (*verifyFlashSector_Core)(u8 *, u8 *, u32);

  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  funcSrc = (u16 *)CODE(VerifyFlashSector_Core);
  funcSrc = (u16 *)((s32)funcSrc ^ 1);
  funcDest = verifyFlashSector_Core_Buffer;
  i = ((s32)CODE(VerifyFlashSector) - (s32)CODE(VerifyFlashSector_Core)) >> 1;
  TIME(0x080990D4, 0x080990FE, 0x0809911D, 0x04000204, 0x04000204);
  TIME(0x0809911C, 0x08099120, 0x08099111);
  while (i != 0) {
    *funcDest++ = *funcSrc++;
    i--;
#ifndef MATCHING
    if (i != 0) TIME(0x08099110, 0x08099120, 0x08099111, ROM, IW);
#endif
  }
  verifyFlashSector_Core = (u32(*)(u8 *, u8 *, u32))((s32)verifyFlashSector_Core_Buffer + 1);
  tgt = FLASH_BASE + (sectorNum << DefaultFlash512K.type.sector.shift);
#ifdef MATCHING
  return CALL(verifyFlashSector_Core)(src, tgt, n);
#else
  {
    u32 differs;
    TIME(0x08099110, 0x0809913A, 0x08099851, ROM, IW, ROM);
    TIME(0x08099850, 0x08099850, (u32)verifyFlashSector_Core);
    verify_core_at = (u32)verifyFlashSector_Core & ~1u;
    differs = CALL(verifyFlashSector_Core)(src, tgt, n);
    TIME(0x0809913C, 0x08099142, BACK);
    return differs;
  }
#endif
}

/** ProgramFlashSectorAndVerifyNBytes, 0x0809918C: a sector written and its first `n` bytes checked, up to three
 *  times. Gives back 0 once they read back. */
u32 ProgramFlashSectorAndVerifyNBytes(u16 sectorNum, void *dataSrc, u32 n) {
  u8 i;
  u32 result;

  // (timed where the first try is the one that reads back, as every one does on a chip that works)
  TIME(0x0809918C, 0x08099198, 0x080991A1);
  for (i = 0; i < 3; i++) {
    TIME(0x080991A0, 0x080991AE, 0x0809984D, IW);
    TIME(0x0809984C, 0x0809984C, (u32)ProgramFlashSector);
    result = CALL(ProgramFlashSector)(sectorNum, dataSrc);
    if (result != 0) continue;
    TIME(0x080991B0, 0x080991C0, 0x080990D5);
    result = VerifyFlashSectorNBytes(sectorNum, dataSrc, n);
    if (result == 0) break;
  }
  TIME(0x080991C2, 0x080991CE, BACK);
  return result;
}
