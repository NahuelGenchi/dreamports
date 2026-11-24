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
