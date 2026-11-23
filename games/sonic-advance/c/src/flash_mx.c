// The flash library's code for the MX29L512 chip and the chips it shares with.
#include "flash.h"
#include "core.h"
#include "time.h"

/** ProgramFlashSector_MX, 0x0809947C: a sector erased, then written a byte at a time from `src`. */
u16 ProgramFlashSector_MX(u16 sectorNum, void *src) {
  u16 result;
  u8 *dest;
  u16 readFlash1Buffer[0x20];

  if (sectorNum >= SECTORS_PER_BANK) return 0x80FF;
  TIME(0x0809947C, 0x08099488, 0x08099495);
  TIME(0x08099494, 0x08099498, 0x08099249);
  result = EraseFlashSector_LE(sectorNum);
  if (result != 0) return result;
  TIME(0x0809949A, 0x080994A6, 0x08098ECD);
  SetReadFlash1(readFlash1Buffer);
  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | gFlash->wait[0]);
  gFlashNumRemainingBytes = gFlash->sector.size;
  dest = FLASH_BASE + (sectorNum << gFlash->sector.shift);
  // (timed for a sector with bytes to write, each written at the first try)
  TIME(0x080994A8, 0x080994CC, 0x080994EB, 0x04000204, IW, ROM, 0x04000204, ROM, IW, ROM);
  TIME(0x080994EA, 0x080994F6, 0x080992E5, IW);
  while (gFlashNumRemainingBytes > 0) {
    result = ProgramByte(src, dest);
    if (result != 0) break;
    TIME(0x080994F8, 0x080994FE, 0x080994E1);
    gFlashNumRemainingBytes--;
    src++;
    dest++;
#ifndef MATCHING
    if (gFlashNumRemainingBytes > 0) TIME(0x080994E0, 0x080994F6, 0x080992E5, IW, IW, IW);
    else TIME(0x080994E0, 0x080994EE, 0x08099501, IW, IW, IW);
#endif
  }
  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  TIME(0x08099500, 0x08099516, BACK, 0x04000204, 0x04000204);
  return result;
}
