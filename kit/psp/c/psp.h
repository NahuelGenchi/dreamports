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
int sceKernelSleepThreadCB(void);
int sceKernelWakeupThread(SceUID thread);
int sceKernelDelayThread(uint32_t microseconds);
int sceKernelDelayThreadCB(uint32_t microseconds);
SceUID sceKernelGetThreadId(void);
uint32_t sceKernelGetSystemTimeLow(void);
uint64_t sceKernelGetSystemTimeWide(void);

// ---- semaphores and event flags -------------------------------------------------------------------------------------

// a semaphore that wakes its threads by their priority, not in the order they came; an event flag more than one thread
// may wait for; and how a wait for an event flag matches and what it clears
enum { PSP_SEMA_PRIORITY = 0x100, PSP_EVENT_MULTIPLE = 0x200, PSP_EVENT_AND = 0x00, PSP_EVENT_OR = 0x01, PSP_EVENT_CLEAR_ALL = 0x10, PSP_EVENT_CLEAR = 0x20 };
/** A wait's timeout is the address of a word in the console's memory saying how many microseconds, which the system
 *  writes what was left of to as the wait ends, or 0 for none. */
SceUID sceKernelCreateSema(const char *name, uint32_t attributes, int count, int most, uint32_t options);
int sceKernelDeleteSema(SceUID sema);
int sceKernelSignalSema(SceUID sema, int count);
int sceKernelWaitSema(SceUID sema, int count, uint32_t timeout);
int sceKernelPollSema(SceUID sema, int count);
int sceKernelReferSemaStatus(SceUID sema, uint32_t info);
SceUID sceKernelCreateEventFlag(const char *name, uint32_t attributes, uint32_t pattern, uint32_t options);
int sceKernelDeleteEventFlag(SceUID flag);
int sceKernelSetEventFlag(SceUID flag, uint32_t bits);
int sceKernelClearEventFlag(SceUID flag, uint32_t bits);
int sceKernelCancelEventFlag(SceUID flag, uint32_t pattern, uint32_t waiting);
int sceKernelWaitEventFlag(SceUID flag, uint32_t bits, uint32_t how, uint32_t out, uint32_t timeout);
int sceKernelPollEventFlag(SceUID flag, uint32_t bits, uint32_t how, uint32_t out);
int sceKernelReferEventFlagStatus(SceUID flag, uint32_t info);
/** The waits that take callbacks, which with no callback notified wait as the others do. */
int sceKernelWaitSemaCB(SceUID sema, int count, uint32_t timeout);
int sceKernelWaitEventFlagCB(SceUID flag, uint32_t bits, uint32_t how, uint32_t out, uint32_t timeout);

// ---- mutexes, lightweight mutexes and callbacks ---------------------------------------------------------------------

// a mutex that wakes its threads by their priority, and one its thread may lock again
enum { PSP_MUTEX_PRIORITY = 0x100, PSP_MUTEX_RECURSIVE = 0x200 };
SceUID sceKernelCreateMutex(const char *name, uint32_t attributes, int count, uint32_t options);
int sceKernelDeleteMutex(SceUID mutex);
int sceKernelLockMutex(SceUID mutex, int count, uint32_t timeout);
int sceKernelLockMutexCB(SceUID mutex, int count, uint32_t timeout);
int sceKernelTryLockMutex(SceUID mutex, int count);
int sceKernelUnlockMutex(SceUID mutex, int count);
int sceKernelCancelMutex(SceUID mutex, int count, uint32_t waiting);
int sceKernelReferMutexStatus(SceUID mutex, uint32_t info);
/** A lightweight mutex keeps its state in a work area of 32 bytes in the console's memory, at `area`. */
int sceKernelCreateLwMutex(uint32_t area, const char *name, uint32_t attributes, int count, uint32_t options);
int sceKernelDeleteLwMutex(uint32_t area);
int sceKernelLockLwMutex(uint32_t area, int count, uint32_t timeout);
int sceKernelLockLwMutexCB(uint32_t area, int count, uint32_t timeout);
int sceKernelTryLockLwMutex(uint32_t area, int count);
int sceKernelUnlockLwMutex(uint32_t area, int count);
int sceKernelReferLwMutexStatus(uint32_t area, uint32_t info);
int sceKernelReferLwMutexStatusByID(SceUID mutex, uint32_t info);
/** A callback: what a thread runs when it's notified, as the system calls it, with the times notified, what it was
 *  notified with and what it was made with. The kit doesn't run one a game notifies yet (kit/psp/c/README.md). */
typedef int (*psp_callback)(int count, int argument, uint32_t common);
SceUID sceKernelCreateCallback(const char *name, psp_callback callback, uint32_t common);
int sceKernelDeleteCallback(SceUID callback);
int sceKernelRegisterExitCallback(SceUID callback);
int sceKernelCheckCallback(void);
int sceKernelGetCallbackCount(SceUID callback);
int sceKernelReferCallbackStatus(SceUID callback, uint32_t info);

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

// ---- the processor's own instructions -------------------------------------------------------------------------------
//
// What the Allegrex's instructions give where C has no word for them, or where C leaves what they give to the computer
// it runs on, as the console's emulator in the proof tools gives it with its interpreter: a twin calls one where its
// original runs the instruction. The rest, its sums, shifts, comparisons, loads and stores, and the floating-point
// unit's sums, square roots and comparisons, are C's own, which gives what the console gives.

/** How many of its top bits are 0 (clz), or 1 (clo): 32 for a word of none. */
static inline uint32_t psp_clz(uint32_t x) { return x ? (uint32_t)__builtin_clz(x) : 32; }
static inline uint32_t psp_clo(uint32_t x) { return psp_clz(~x); }
/** Its bits the other way round (bitrev). */
static inline uint32_t psp_bitrev(uint32_t x) {
  uint32_t out = 0;
  for (int i = 0; i < 32; i++) if (x & (1u << i)) out |= 0x80000000u >> i;
  return out;
}
/** Each half's two bytes swapped (wsbh), and all four the other way round (wsbw). */
static inline uint32_t psp_wsbh(uint32_t x) { return ((x & 0xFF00FF00u) >> 8) | ((x & 0x00FF00FFu) << 8); }
static inline uint32_t psp_wsbw(uint32_t x) { return __builtin_bswap32(x); }
/** Turned right by `by`, of which only the low five bits count (rotr, rotrv). */
static inline uint32_t psp_rotr(uint32_t x, uint32_t by) {
  by &= 31;
  return by ? (x >> by) | (x << (32 - by)) : x;
}
/** `size` bits of x from bit `at` (ext), and x with them put in `into` there (ins). */
static inline uint32_t psp_ext(uint32_t x, int at, int size) { return (x >> at) & (0xFFFFFFFFu >> (32 - size)); }
static inline uint32_t psp_ins(uint32_t into, uint32_t x, int at, int size) {
  uint32_t mask = 0xFFFFFFFFu >> (32 - size);
  return (into & ~(mask << at)) | ((x & mask) << at);
}

/** HI and LO, which multiplying and dividing leave. */
typedef struct { uint32_t hi, lo; } psp_hilo;
static inline psp_hilo psp_hilo_of(uint64_t v) { return (psp_hilo){ (uint32_t)(v >> 32), (uint32_t)v }; }
static inline uint64_t psp_hilo_value(psp_hilo h) { return (uint64_t)h.hi << 32 | h.lo; }
static inline psp_hilo psp_mult(int32_t a, int32_t b) { return psp_hilo_of((uint64_t)((int64_t)a * b)); }
static inline psp_hilo psp_multu(uint32_t a, uint32_t b) { return psp_hilo_of((uint64_t)a * b); }
/** HI and LO with a product added (madd, maddu) or taken away (msub, msubu). */
static inline psp_hilo psp_madd(psp_hilo h, int32_t a, int32_t b) { return psp_hilo_of(psp_hilo_value(h) + (uint64_t)((int64_t)a * b)); }
static inline psp_hilo psp_maddu(psp_hilo h, uint32_t a, uint32_t b) { return psp_hilo_of(psp_hilo_value(h) + (uint64_t)a * b); }
static inline psp_hilo psp_msub(psp_hilo h, int32_t a, int32_t b) { return psp_hilo_of(psp_hilo_value(h) - (uint64_t)((int64_t)a * b)); }
static inline psp_hilo psp_msubu(psp_hilo h, uint32_t a, uint32_t b) { return psp_hilo_of(psp_hilo_value(h) - (uint64_t)a * b); }
/** The quotient in LO and the remainder in HI (div, divu), with what the console gives for a division by zero, and for
 *  the least whole number by -1, where C gives nothing. */
static inline psp_hilo psp_div(int32_t a, int32_t b) {
  if (a == (int32_t)0x80000000 && b == -1) return (psp_hilo){ 0xFFFFFFFFu, 0x80000000u };
  if (b == 0) return (psp_hilo){ (uint32_t)a, a < 0 ? 1u : 0xFFFFFFFFu };
  return (psp_hilo){ (uint32_t)(a % b), (uint32_t)(a / b) };
}
static inline psp_hilo psp_divu(uint32_t a, uint32_t b) {
  if (b == 0) return (psp_hilo){ a, a <= 0xFFFF ? 0xFFFFu : 0xFFFFFFFFu };
  return (psp_hilo){ a % b, a / b };
}

// The floating-point unit's conversions to whole numbers: each as its instruction rounds, or as the control register
// says for cvt.w.s, PSP_FPU_NEAREST unless a game set another. Not a number, or infinity, gives the most a whole number
// of 32 bits holds, or the least for minus infinity, and a number past them gives the nearest of them, as the tools'
// patch to the emulator has it give on every computer.
enum { PSP_FPU_NEAREST, PSP_FPU_TOWARD_ZERO, PSP_FPU_UP, PSP_FPU_DOWN };
static inline int psp_fpu_special(float x, int32_t *out) {
  uint32_t bits;
  __builtin_memcpy(&bits, &x, 4);
  if ((bits & 0x7F800000u) != 0x7F800000u) return 0;
  *out = bits == 0xFF800000u ? (int32_t)0x80000000 : 0x7FFFFFFF;
  return 1;
}
static inline int32_t psp_fpu_whole(double x) {
  if (x >= 2147483648.0) return 0x7FFFFFFF;
  if (x < -2147483648.0) return (int32_t)0x80000000;
  return (int32_t)x;
}
/** round.w.s: the whole number below x and a half. */
static inline int32_t psp_round_w_s(float x) {
  int32_t out;
  return psp_fpu_special(x, &out) ? out : psp_fpu_whole(__builtin_floorf(x + 0.5f));
}
/** trunc.w.s: x without what's after its point. */
static inline int32_t psp_trunc_w_s(float x) {
  int32_t out;
  if (psp_fpu_special(x, &out)) return out;
  if (x >= 0.0f) {
    out = psp_fpu_whole(__builtin_floorf(x));
    return out == (int32_t)0x80000000 ? 0x7FFFFFFF : out;
  }
  return psp_fpu_whole(__builtin_ceilf(x));
}
/** ceil.w.s and floor.w.s. */
static inline int32_t psp_ceil_w_s(float x) {
  int32_t out;
  return psp_fpu_special(x, &out) ? out : psp_fpu_whole(__builtin_ceilf(x));
}
static inline int32_t psp_floor_w_s(float x) {
  int32_t out;
  return psp_fpu_special(x, &out) ? out : psp_fpu_whole(__builtin_floorf(x));
}
/** cvt.w.s, in the rounding the control register's low two bits name: to the nearest, a half to the even one. */
static inline int32_t psp_cvt_w_s(float x, uint32_t control) {
  int32_t out;
  if (psp_fpu_special(x, &out)) return out;
  switch (control & 3) {
  case PSP_FPU_NEAREST: {
    // as the emulator works it out, partly in doubles
    double d = x;
    float below = (float)__builtin_floor(d), half;
    d -= below;
    if (d < 0.5f) return psp_fpu_whole(below);
    if (d > 0.5f) return psp_fpu_whole(below + 1.0f);
    half = __builtin_truncf(below / 2.0f);
    return psp_fpu_whole(2.0f * half == below ? below : below + 1.0f);
  }
  case PSP_FPU_TOWARD_ZERO: return psp_fpu_whole(x);
  case PSP_FPU_UP: return psp_fpu_whole(__builtin_ceilf(x));
  default: return psp_fpu_whole(__builtin_floorf(x));
  }
}
/** mul.s: infinity by zero is the console's own not-a-number, with no sign, where a computer's processor may give one
 *  with a sign. Every other product is C's. */
static inline float psp_mul_s(float a, float b) {
  if ((__builtin_isinf(a) && b == 0.0f) || (__builtin_isinf(b) && a == 0.0f)) {
    uint32_t bits = 0x7FC00000u;
    float out;
    __builtin_memcpy(&out, &bits, 4);
    return out;
  }
  return a * b;
}

#endif
