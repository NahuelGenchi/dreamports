// The flash library's code for the LE39FW512 chip and the chips it shares with.
#include "flash.h"
#include "core.h"
#include "time.h"

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
  // the erase starts at its own store's time, from which the chip settles
  TIME(0x08099248, 0x0809928C, 0x0809928F, 0x04000204, IW, ROM, 0x04000204, ROM, FLASH, FLASH, FLASH, FLASH, FLASH);
  FLASH_POKE(addr, 0x30);
  TIME(0x0809928E, 0x08099294, 0x08098ECD, FLASH);
  SetReadFlash1(readFlash1Buffer);
  TIME(0x08099296, 0x080992A2, 0x08099851, IW);
  TIME(0x08099850, 0x08099850, (u32)WaitForFlashWrite);
  result = CALL(WaitForFlashWrite)(2, addr, 0xFF);
  REG_WRITE16(REG_WAITCNT, (REG_READ16(REG_WAITCNT) & ~3) | 3);
  TIME(0x080992A4, 0x080992B4, 0x080992D3, 0x04000204, 0x04000204);
  TIME(0x080992D2, 0x080992DC, BACK);
  return result;
}

/** 0x080992E4, ProgramByte: a byte written to the flash, waited on. */
u16 ProgramByte(u8 *src, u8 *dest) {
  FLASH_WRITE(0x5555, 0xAA);
  FLASH_WRITE(0x2AAA, 0x55);
  FLASH_WRITE(0x5555, 0xA0);
  // the byte is written at its own store's time, from which the chip settles
  TIME(0x080992E4, 0x080992F6, 0x080992F9, FLASH, FLASH, FLASH, IW);
  FLASH_POKE(dest, *src);
#ifdef MATCHING
  return CALL(WaitForFlashWrite)(1, dest, *src);
#else
  {
    u16 result;
    TIME(0x080992F8, 0x08099304, 0x08099851, FLASH, IW, IW);
    TIME(0x08099850, 0x08099850, (u32)WaitForFlashWrite);
    result = CALL(WaitForFlashWrite)(1, dest, *src);
    TIME(0x08099306, 0x0809930E, BACK);
    return result;
  }
#endif
}
