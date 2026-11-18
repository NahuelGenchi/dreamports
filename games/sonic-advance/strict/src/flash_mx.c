// The flash library's code for the MX29L512 chip and the chips it shares with.
#include "flash.h"
#include "core.h"

/** ProgramFlashSector_MX, 0x0809947C: a sector erased, then written a byte at a time from `src`. */
u16 ProgramFlashSector_MX(u16 sectorNum, void *src) {
  u16 result;
  u8 *dest;
  u16 readFlash1Buffer[0x20];

  if (sectorNum >= SECTORS_PER_BANK) return 0x80FF;
  result = EraseFlashSector_LE(sectorNum);
  if (result != 0) return result;
  SetReadFlash1(readFlash1Buffer);
  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | gFlash->wait[0]);
  gFlashNumRemainingBytes = gFlash->sector.size;
  dest = FLASH_BASE + (sectorNum << gFlash->sector.shift);
  while (gFlashNumRemainingBytes > 0) {
    result = ProgramByte(src, dest);
    if (result != 0) break;
    gFlashNumRemainingBytes--;
    src++;
    dest++;
  }
  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  return result;
}
