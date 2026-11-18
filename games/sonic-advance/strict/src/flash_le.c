// The flash library's code for the LE39FW512 chip and the chips it shares with.
#include "flash.h"
#include "core.h"

/** EraseFlashSector_LE, 0x08099248: a sector of the flash erased, waited on. */
u16 EraseFlashSector_LE(u16 sectorNum) {
  u16 result;
  u8 *addr;
  u16 readFlash1Buffer[0x20];

  if (sectorNum >= 0x10) return 0x80FF;

  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | gFlash->wait[0]);
  addr = FLASH_BASE + (sectorNum << gFlash->sector.shift);
  FLASH_WRITE(0x5555, 0xAA);
  FLASH_WRITE(0x2AAA, 0x55);
  FLASH_WRITE(0x5555, 0x80);
  FLASH_WRITE(0x5555, 0xAA);
  FLASH_WRITE(0x2AAA, 0x55);
  FLASH_POKE(addr, 0x30);
  SetReadFlash1(readFlash1Buffer);
  result = CALL(WaitForFlashWrite)(2, addr, 0xFF);
  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  return result;
}

/** 0x080992E4, ProgramByte: a byte written to the flash, waited on. */
u16 ProgramByte(u8 *src, u8 *dest) {
  FLASH_WRITE(0x5555, 0xAA);
  FLASH_WRITE(0x2AAA, 0x55);
  FLASH_WRITE(0x5555, 0xA0);
  FLASH_POKE(dest, *src);
  return CALL(WaitForFlashWrite)(1, dest, *src);
}
