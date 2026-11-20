// The kit's own: what PCSX ReARMed's libpcsxcore/cdrom.c and decode_xa.c take from the rest of that emulator, by the
// same names, in place of its own headers, which cdrom.h, cdrom.c and decode_xa.c include it for. The processor's
// clock and events, its hardware registers, the emulator's settings, its disc reader and its sound chip are the kit's,
// which ../cd.c gives them (kit/ps1/c/cdrom/NOTICE.md). Each number here is the emulator's, at the commit
// tools/consoles.mjs fixes, from the file named beside it.

#ifndef DREAMPORTS_PCSX_H
#define DREAMPORTS_PCSX_H

#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "../dfsound/psemu_plugin_defs.h"

// psxcommon.h's types, on a computer that keeps the console's byte order, as the kit's always do
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef uint64_t u64;
typedef int8_t s8;
typedef int16_t s16;
typedef int32_t s32;
typedef int64_t s64;
typedef uint8_t boolean;
#define TRUE 1
#define FALSE 0
#define SWAP16(v) (v)
#define SWAP32(v) (v)
#define SWAPu32(v) ((u32)(v))

// psxcommon.h: the processor's clock, 33.8688 MHz, and the settings cdrom.c reads, as ../cd.c sets them from the
// options tools/consoles.mjs gives the emulator
#define PSXCLK 33868800
enum { PSX_TYPE_NTSC = 0, PSX_TYPE_PAL };
typedef struct {
  u8 HLE, SlowBoot, TurboCD, Xa, Cdda, PsxType;
  struct { u8 cdr_read_timing; } hacks;
} PcsxConfig;
extern PcsxConfig Config;
// misc.c: the disc's name, as the emulator finds it in its SYSTEM.CNF
extern char CdromId[10];

// psxevents.h: the processor's events, in the emulator's order, which is also the order it runs those due at once in
enum {
  PSXINT_SIO, PSXINT_CDR, PSXINT_CDREAD, PSXINT_GPUDMA, PSXINT_MDECOUTDMA, PSXINT_SPUDMA, PSXINT_SPU_IRQ,
  PSXINT_MDECINDMA, PSXINT_GPUOTCDMA, PSXINT_CDRDMA, PSXINT_NEWDRC_CHECK, PSXINT_RCNT, PSXINT_CDRLID, PSXINT_IRQ10,
  PSXINT_SPU_UPDATE, PSXINT_COUNT
};
// r3000a.h: what cdrom.c reads and sets of the processor's registers: its cycle, the events it has set, when each was
// set and how far ahead, and where each is due
typedef struct {
  u32 cycle, interrupt;
  struct { u32 sCycle, cycle; } intCycle[20];
  u32 event_cycles[20];
  u32 pc;
} psxRegisters;
extern psxRegisters psxRegs;
/** Puts event `which` on the kit's clock at cycle `at`, in place of any it had (../cd.c). */
void cd_event_at(int which, u32 at);
#define set_event_raw_abs(e, abs) cd_event_at(e, abs)
#define set_event(e, c) do { \
  psxRegs.interrupt |= 1u << (e); \
  psxRegs.intCycle[e].cycle = (c); \
  psxRegs.intCycle[e].sCycle = psxRegs.cycle; \
  cd_event_at(e, psxRegs.cycle + (c)); \
} while (0)
// psxcounters.h: the root counters' starts, which only a timing hack cdrom.c leaves off reads
typedef struct { u32 cycleStart; } PcsxCounter;
extern PcsxCounter rcnts[4];

// psxmem.h, psxhw.h: the hardware registers cdrom.c writes, as ../cd.c keeps them: the interrupt controller's status,
// DMA channel 3's and DMA's interrupt register, and the CD's own bytes it keeps a copy of
u32 *cd_hardware_word(u32 address);
extern u8 cd_hardware_bytes[4];
#define psxHu32ref(address) (*cd_hardware_word(address))
#define psxHu8(address) (cd_hardware_bytes[(address) & 3])
#define HW_DMA3_MADR psxHu32ref(0x10b0)
#define HW_DMA3_BCR psxHu32ref(0x10b4)
#define HW_DMA3_CHCR psxHu32ref(0x10b8)
#define HW_DMA_ICR psxHu32ref(0x10f4)
#define HW_DMA_ICR_GLOBAL_ENABLE (1u << 23)
#define HW_DMA_ICR_IRQ_SENT (1u << 31)
// a channel's transfer done: its flag set, and the interrupt controller's DMA interrupt if the channel's is let in
#define DMA_INTERRUPT(n) { \
  u32 icr = HW_DMA_ICR; \
  if (icr & (1u << (16 + (n)))) { \
    icr |= 1u << (24 + (n)); \
    if (icr & HW_DMA_ICR_GLOBAL_ENABLE && !(icr & HW_DMA_ICR_IRQ_SENT)) { \
      psxHu32ref(0x1070) |= 8; \
      icr |= HW_DMA_ICR_IRQ_SENT; \
    } \
    HW_DMA_ICR = icr; \
  } \
}
// psxmem.h: where a DMA transfer goes, and how many words fit there, which ../cd.c gives from the game's own memory
#define INVALID_PTR NULL
u8 *getDmaRam(u32 address, u32 *max_words);
// r3000a.h: the processor's cached code, which the kit, running C, doesn't keep
typedef struct { void (*Clear)(u32 address, u32 words); } PcsxCpu;
extern const PcsxCpu *psxCpu;

// misc.h, ppf.h: the emulator's log, its save states, which the kit keeps its own way, and its patches for discs
// with LibCrypt protection and PPF files, which no Dreamport's disc has yet
#define SysPrintf(...) ((void)0)
#define log_unhandled(...) ((void)0)
#define gzfreeze(pointer, size) ((void)(pointer), (void)(size))
#define CheckSBI(sector) 0
#define CheckPPFCache(bytes, m, s, f) ((void)0)
unsigned short calcCrc(const unsigned char *bytes, int count);
/** Reads the disc's name and region again, as the emulator does once its lid closes on a disc (../cd.c). */
int CheckCdrom(void);

// plugins.h: the drive's state as the disc reader says it
struct CdrStat {
  uint32_t Type;
  uint32_t Status;
  uint8_t nodisk;
  uint8_t mode1;
};
// cdrom-async.h: the disc reader, which ../cd.c reads the player's disc through (kit/c/disc.h)
int cdra_getTN(unsigned char *tn);
int cdra_getTD(int track, unsigned char *rt);
int cdra_getStatus(struct CdrStat *stat);
int cdra_readTrack(const unsigned char *time);
int cdra_readCDDA(const unsigned char *time, void *buffer);
int cdra_readSub(const unsigned char *time, void *buffer);
int cdra_prefetch(unsigned char m, unsigned char s, unsigned char f, int is_cdda);
void *cdra_getBuffer(void);

// plugins.h: the sound chip's side of the CD's sound (../cd.c)
void SPU_playADPCMchannel(xa_decode_t *xa, unsigned int cycle, int is_start);
int SPU_playCDDAchannel(short *pcm, int bytes, unsigned int cycle, int is_start);
void SPU_setCDvol(unsigned char ll, unsigned char lr, unsigned char rl, unsigned char rr, unsigned int cycle);
// decode_xa.h
s32 xa_decode_sector(xa_decode_t *xdp, const unsigned char *sectorp, int is_first_sector);

// cdrom_bits.h: the drive's commands, its interrupts, its mode's bits, its status's bits and its errors, as the
// console has them (psx-spx, CDROM Controller)
enum {
  CdlNop = 1, CdlSetloc, CdlPlay, CdlForward, CdlBackward, CdlReadN, CdlStandby, CdlStop, CdlPause, CdlReset, CdlMute,
  CdlDemute, CdlSetfilter, CdlSetmode, CdlGetparam, CdlGetlocL, CdlGetlocP, CdlReadT, CdlGetTN, CdlGetTD, CdlSeekL,
  CdlSeekP, CdlSetclock, CdlGetclock, CdlTest, CdlID, CdlReadS, CdlInit, CdlGetQ, CdlReadToc,
};
enum { NoIntr, DataReady, Complete, Acknowledge, DataEnd, DiskError };
enum {
  MODE_CDDA = 1 << 0, MODE_AUTOPAUSE = 1 << 1, MODE_REPORT = 1 << 2, MODE_SF = 1 << 3, MODE_SIZE_2048 = 0,
  MODE_BIT4 = 1 << 4, MODE_SIZE_2328 = 1 << 4, MODE_SIZE_2340 = 1 << 5, MODE_STRSND = 1 << 6, MODE_SPEED = 1 << 7,
};
enum {
  STATUS_ERROR = 1 << 0, STATUS_ROTATING = 1 << 1, STATUS_SEEKERROR = 1 << 2, STATUS_UNKNOWN3 = 1 << 3,
  STATUS_SHELLOPEN = 1 << 4, STATUS_READ = 1 << 5, STATUS_SEEK = 1 << 6, STATUS_PLAY = 1 << 7,
};
enum {
  ERROR_SHELLOPEN = 1 << 3, ERROR_BAD_ARGVAL = 1 << 4, ERROR_BAD_ARGNUM = 1 << 5, ERROR_INVALIDCMD = 1 << 6,
  ERROR_NOTREADY = 1 << 7,
};

#endif
