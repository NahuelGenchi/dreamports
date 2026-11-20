// The cartridge's flash memory, which the save is kept in, and the console's library for it. Sonic Advance was given
// the library already built, with -O1 (the game's proof/original.json, "compiler": its stretch from 0x08098C54).
#ifndef SA_FLASH_H
#define SA_FLASH_H
#include "console.h"

#define FLASH_ROM_SIZE_1M 131072
#define SECTORS_PER_BANK 16

#ifdef MATCHING
// the flash chip, where the console has it
#define FLASH_BASE ((u8 *)0xE000000)
#define FLASH_WRITE(addr, data) ((*(vu8 *)(FLASH_BASE + (addr))) = (data))
#define FLASH_POKE(at, data) (*(at) = (data))
#define FLASH_PEEK(at) (*(at))
#define TIMER_WROTE(at)
#else
// the library writes its timer's registers through a pointer: each write is told to the console's time as it's made
void console_timer_wrote(const volatile u16 *at);
#define TIMER_WROTE(at) console_timer_wrote(at)
// a Dreamport's flash chip is hardware.c's, on the kit's save memory: reads see its bytes, writes are its commands
u8 *console_flash(void);
void console_flash_write(u32 addr, u8 data);
#define FLASH_BASE console_flash()
#define FLASH_WRITE(addr, data) console_flash_write(addr, data)
#define FLASH_POKE(at, data) console_flash_write((u32)((u8 *)(at) - FLASH_BASE), data)
/** A byte read as the chip answers: its own, or "busy" while it settles after a write or an erase. */
u8 console_flash_read(const u8 *at);
#define FLASH_PEEK(at) console_flash_read(at)
#endif

struct FlashSector {
  u32 size;
  u8 shift;
  u16 count;
  u16 top;
};

/** Which flash chip a cartridge has, as the library knows them. */
struct FlashType {
  u32 romSize;
  struct FlashSector sector;
  u16 wait[2];
  union {
    struct {
      u8 makerId;
      u8 deviceId;
    } separate;
    u16 joined;
  } ids;
};

/** A chip's own ways to write, erase and wait, and its type. */
struct FlashSetupInfo {
  u16 (*programFlashSector)(u16, void *);
  u16 (*eraseFlashChip)(void);
  u16 (*eraseFlashSector)(u16);
  u16 (*WaitForFlashWrite)(u8, u8 *, u8);
  const u16 *maxTime;
  struct FlashType type;
};

extern const struct FlashSetupInfo *const gSetup512KInfos[];
extern const struct FlashSetupInfo DefaultFlash512K;
extern u16 (*ProgramFlashSector)(u16, void *);
extern u16 (*EraseFlashChip)(void);
extern u16 (*EraseFlashSector)(u16);
extern u16 (*WaitForFlashWrite)(u8, u8 *, u8);
extern const u16 *gFlashMaxTime;
extern const struct FlashType *gFlash;
extern u16 gFlashNumRemainingBytes;
extern u8 (*PollFlashStatus)(u8 *);
extern u8 sTimerNum;
extern u16 sTimerCount;
extern u8 gFlashTimeoutFlag;
extern vu16 *gTimerReg;
extern u16 gSavedIme;

u16 ReadFlashId(void);
u16 IdentifyFlash(void);
void FlashTimerIntr(void);
u16 SetFlashTimerIntr(u8 timerNum, void (**intrFunc)(void));
void StartFlashTimer(u8 phase);
void StopFlashTimer(void);
u8 ReadFlash1(u8 *addr);
void SetReadFlash1(u16 *dest);
u16 WaitForFlashWrite512K_Common(u8 phase, u8 *addr, u8 lastData);
void ReadFlash_Core(u8 *src, u8 *dest, u32 size);
void ReadFlash(u16 sectorNum, u32 offset, void *dest, u32 size);
u32 VerifyFlashSector_Core(u8 *src, u8 *tgt, u32 size);
u32 VerifyFlashSector(u16 sectorNum, u8 *src);
u32 VerifyFlashSectorNBytes(u16 sectorNum, u8 *src, u32 n);
u32 ProgramFlashSectorAndVerifyNBytes(u16 sectorNum, void *dataSrc, u32 n);
u16 EraseFlashSector_LE(u16 sectorNum);
u16 ProgramByte(u8 *src, u8 *dest);
u16 ProgramFlashSector_MX(u16 sectorNum, void *src);

#endif
