// The PlayStation Portable's kit in C, on what every console's kit in C shares (kit/c/README.md). A game keeps the
// console's memory at the console's own addresses, runs in the console's threads and time, and asks the system for
// what its original asks, by the same names: the screen, the buttons, the sound channels and the graphics chip's
// display lists. The kit answers as the console's emulator in the proof tools does, PPSSPP (kit/psp/c/README.md).

#ifndef DREAMPORTS_PSP_H
#define DREAMPORTS_PSP_H

#include "console.h"

// ---- the console's memory ----------------------------------------------------------------------------------------

// where the processor sees each of its memories: the scratchpad's 16 KB, the video memory's 2 MB and the main memory,
// 64 MB from PSP_RAM on a console with the larger memory, of which a game's own starts at PSP_USER
enum { PSP_SCRATCHPAD = 0x00010000, PSP_SCRATCHPAD_SIZE = 0x4000, PSP_VRAM = 0x04000000, PSP_VRAM_SIZE = 0x00200000, PSP_RAM = 0x08000000, PSP_USER = 0x08800000, PSP_RAM_SIZE = 0x04000000 };

/** Where the kit keeps what the console has at `address`, whichever of its mirrors the address is in (0x4xxxxxxx
 *  uncached, 0x8xxxxxxx the kernel's), or NULL where the console has no memory. As WebAssembly this is the address
 *  itself, less its mirror, so a twin reads and writes the console's addresses as they are. */
void *psp_memory(uint32_t address);
uint8_t psp_read8(uint32_t address);
uint16_t psp_read16(uint32_t address);
uint32_t psp_read32(uint32_t address);
void psp_write8(uint32_t address, uint8_t value);
void psp_write16(uint32_t address, uint16_t value);
void psp_write32(uint32_t address, uint32_t value);

// ---- the console's time and threads ------------------------------------------------------------------------------

/** How many of the processor's cycles a second has: the console's time is counted in them. */
#define PSP_CYCLES_A_SECOND 222000000

/** Says the game's own code took `cycles` of the processor's time, the instructions its original ran since the game
 *  last said so or last asked the system for something. The kit's own answers take the time the emulator's take, and a
 *  game's C takes none unless it says so here, which is right while its original's work is short beside a frame. What
 *  is due by then happens here: a V-blank, a block of sound mixed, a thread woken, which runs first if it comes first. */
void psp_time_pass(uint32_t cycles);
/** The console's time now, in cycles since it started. */
uint64_t psp_time(void);

typedef int32_t SceUID;
/** What a thread starts at: the size of what it was given and where that is, in the console's memory. */
typedef int (*psp_thread_entry)(uint32_t size, uint32_t arguments);

SceUID sceKernelCreateThread(const char *name, psp_thread_entry entry, int priority, int stack_size, uint32_t attributes, uint32_t options);
int sceKernelStartThread(SceUID thread, uint32_t size, uint32_t arguments);
int sceKernelExitThread(int status);
int sceKernelExitDeleteThread(int status);
int sceKernelDeleteThread(SceUID thread);
int sceKernelSleepThread(void);
int sceKernelWakeupThread(SceUID thread);
int sceKernelDelayThread(uint32_t microseconds);
SceUID sceKernelGetThreadId(void);
uint32_t sceKernelGetSystemTimeLow(void);
uint64_t sceKernelGetSystemTimeWide(void);

// ---- the screen ----------------------------------------------------------------------------------------------------

// a pixel's format, in a framebuffer and in a texture's first four
enum { PSP_FORMAT_565, PSP_FORMAT_5551, PSP_FORMAT_4444, PSP_FORMAT_8888 };
// when a new framebuffer is shown: at once, or from the next V-blank
enum { PSP_SETBUF_IMMEDIATE, PSP_SETBUF_NEXTFRAME };

int sceDisplaySetMode(int mode, int width, int height);
int sceDisplaySetFrameBuf(uint32_t address, int line, int format, int when);
int sceDisplayGetFrameBuf(uint32_t address_to, uint32_t line_to, uint32_t format_to, int which);
int sceDisplayWaitVblankStart(void);
int sceDisplayWaitVblank(void);
int sceDisplayGetVcount(void);
int sceDisplayIsVblank(void);
/** Paints the page's picture with what the screen shows: 480 by 272 of the framebuffer the game last named, or black
 *  with none. For game_draw. */
void psp_show(void);

// ---- the graphics chip ------------------------------------------------------------------------------------------------

/** A command of a display list: its number in the top byte and what it's given in the other three. */
#define PSP_GE(command, value) (((uint32_t)(command) << 24) | ((uint32_t)(value) & 0x00FFFFFF))
// the commands a list for 2D drawing uses most, by number
enum {
  PSP_GE_NOP = 0x00, PSP_GE_VADDR = 0x01, PSP_GE_IADDR = 0x02, PSP_GE_PRIM = 0x04, PSP_GE_JUMP = 0x08, PSP_GE_CALL = 0x0A, PSP_GE_RET = 0x0B,
  PSP_GE_END = 0x0C, PSP_GE_SIGNAL = 0x0E, PSP_GE_FINISH = 0x0F, PSP_GE_BASE = 0x10, PSP_GE_VERTEXTYPE = 0x12, PSP_GE_OFFSETADDR = 0x13,
  PSP_GE_ORIGIN = 0x14, PSP_GE_REGION1 = 0x15, PSP_GE_REGION2 = 0x16, PSP_GE_TEXTUREMAPENABLE = 0x1E, PSP_GE_DITHERENABLE = 0x20,
  PSP_GE_ALPHABLENDENABLE = 0x21, PSP_GE_ALPHATESTENABLE = 0x22, PSP_GE_ZTESTENABLE = 0x23, PSP_GE_STENCILTESTENABLE = 0x24,
  PSP_GE_COLORTESTENABLE = 0x27, PSP_GE_LOGICOPENABLE = 0x28, PSP_GE_MATERIALAMBIENT = 0x55, PSP_GE_MATERIALALPHA = 0x58,
  PSP_GE_FRAMEBUFPTR = 0x9C, PSP_GE_FRAMEBUFWIDTH = 0x9D, PSP_GE_ZBUFPTR = 0x9E, PSP_GE_ZBUFWIDTH = 0x9F, PSP_GE_TRANSFERSRC = 0xB2,
  PSP_GE_TRANSFERSRCW = 0xB3, PSP_GE_TRANSFERDST = 0xB4, PSP_GE_TRANSFERDSTW = 0xB5, PSP_GE_FRAMEBUFPIXFORMAT = 0xD2, PSP_GE_CLEARMODE = 0xD3,
  PSP_GE_SCISSOR1 = 0xD4, PSP_GE_SCISSOR2 = 0xD5, PSP_GE_MINZ = 0xD6, PSP_GE_MAXZ = 0xD7, PSP_GE_COLORTEST = 0xD8, PSP_GE_COLORREF = 0xD9,
  PSP_GE_COLORTESTMASK = 0xDA, PSP_GE_ALPHATEST = 0xDB, PSP_GE_STENCILTEST = 0xDC, PSP_GE_STENCILOP = 0xDD, PSP_GE_ZTEST = 0xDE,
  PSP_GE_BLENDMODE = 0xDF, PSP_GE_BLENDFIXEDA = 0xE0, PSP_GE_BLENDFIXEDB = 0xE1, PSP_GE_DITH0 = 0xE2, PSP_GE_LOGICOP = 0xE6,
  PSP_GE_ZWRITEDISABLE = 0xE7, PSP_GE_MASKRGB = 0xE8, PSP_GE_MASKALPHA = 0xE9, PSP_GE_TRANSFERSTART = 0xEA, PSP_GE_TRANSFERSRCPOS = 0xEB,
  PSP_GE_TRANSFERDSTPOS = 0xEC, PSP_GE_TRANSFERSIZE = 0xEE,
};
// a vertex's parts for PSP_GE_VERTEXTYPE: its colour, its position, and whether it's in the screen's own coordinates
enum {
  PSP_GE_COLOR_565 = 4 << 2, PSP_GE_COLOR_5551 = 5 << 2, PSP_GE_COLOR_4444 = 6 << 2, PSP_GE_COLOR_8888 = 7 << 2,
  PSP_GE_POSITION_16BIT = 2 << 7, PSP_GE_POSITION_FLOAT = 3 << 7, PSP_GE_INDEX_8BIT = 1 << 11, PSP_GE_INDEX_16BIT = 2 << 11, PSP_GE_THROUGH = 1 << 23,
};
// what PSP_GE_PRIM draws
enum { PSP_GE_POINTS, PSP_GE_LINES, PSP_GE_LINE_STRIP, PSP_GE_TRIANGLES, PSP_GE_TRIANGLE_STRIP, PSP_GE_TRIANGLE_FAN, PSP_GE_RECTANGLES };
// what sceGeListSync and sceGeDrawSync say of a list
enum { PSP_GE_LIST_COMPLETED, PSP_GE_LIST_QUEUED, PSP_GE_LIST_DRAWING, PSP_GE_LIST_STALLING, PSP_GE_LIST_PAUSED };

uint32_t sceGeEdramGetAddr(void);
uint32_t sceGeEdramGetSize(void);
/** Hands the chip the list at `list`, which it runs as far as `stall`, or to its end with a stall of 0, and gives the
 *  list's number. `callback` and `args` are the console's own: the kit calls no callback of the game's yet. */
int sceGeListEnQueue(uint32_t list, uint32_t stall, int callback, uint32_t args);
int sceGeListEnQueueHead(uint32_t list, uint32_t stall, int callback, uint32_t args);
int sceGeListDeQueue(int list);
int sceGeListUpdateStallAddr(int list, uint32_t stall);
/** Waits for the list to be done (mode 0), or says how it is (1). */
int sceGeListSync(int list, int mode);
/** Waits for every list to be done (mode 0), or says how the first is (1). */
int sceGeDrawSync(int mode);

// ---- the buttons and the stick --------------------------------------------------------------------------------------

// the buttons as the console gives them, a bit each
enum {
  PSP_CTRL_SELECT = 0x0001, PSP_CTRL_START = 0x0008, PSP_CTRL_UP = 0x0010, PSP_CTRL_RIGHT = 0x0020, PSP_CTRL_DOWN = 0x0040, PSP_CTRL_LEFT = 0x0080,
  PSP_CTRL_LTRIGGER = 0x0100, PSP_CTRL_RTRIGGER = 0x0200, PSP_CTRL_TRIANGLE = 0x1000, PSP_CTRL_CIRCLE = 0x2000, PSP_CTRL_CROSS = 0x4000, PSP_CTRL_SQUARE = 0x8000,
};
/** What a read of the pad writes at the address it's given, 16 bytes: when it was sampled, in microseconds, the buttons,
 *  the stick across and down, each 0 to 255 with 128 its middle, and six bytes more. */
typedef struct { uint32_t time, buttons; uint8_t x, y, more[6]; } SceCtrlData;

int sceCtrlSetSamplingCycle(int microseconds);
int sceCtrlSetSamplingMode(int mode);
int sceCtrlPeekBufferPositive(uint32_t address, int count);
int sceCtrlPeekBufferNegative(uint32_t address, int count);
int sceCtrlReadBufferPositive(uint32_t address, int count);
int sceCtrlReadBufferNegative(uint32_t address, int count);

// ---- the sound channels -----------------------------------------------------------------------------------------------

enum { PSP_AUDIO_STEREO = 0, PSP_AUDIO_MONO = 0x10, PSP_AUDIO_VOLUME_MAX = 0x8000 };

int sceAudioChReserve(int channel, int samples, int format);
int sceAudioChRelease(int channel);
int sceAudioSetChannelDataLen(int channel, int samples);
int sceAudioChangeChannelConfig(int channel, int format);
int sceAudioChangeChannelVolume(int channel, int left, int right);
int sceAudioOutput(int channel, int volume, uint32_t samples);
int sceAudioOutputBlocking(int channel, int volume, uint32_t samples);
int sceAudioOutputPanned(int channel, int left, int right, uint32_t samples);
int sceAudioOutputPannedBlocking(int channel, int left, int right, uint32_t samples);
int sceAudioGetChannelRestLen(int channel);

#endif
