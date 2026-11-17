// A small program of the project's own, with nothing from any game in it, written the way a Dreamport made the
// stricter way is (docs/STANDARD.md): every value where the console keeps it, and the same C for the cartridge and for
// the Dreamport. Only this header tells the two builds apart: MATCHING is defined when the console's compiler builds
// it, as match defines it (tools/README.md, Matching the original's bytes).
#ifndef CART_H
#define CART_H

enum { DISPCNT = 0x00, BG0CNT = 0x08, BG0HOFS = 0x10, BG0VOFS = 0x12 };

// the work memory, at the console's addresses in both builds
#define IWRAM 0x03000000
#define EWRAM 0x02000000

#ifdef MATCHING
// built with the console's compiler: the hardware is the console's
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed short s16;
typedef signed int s32;
#define NULL ((void *)0)
enum { KEY_A = 0x1, KEY_B = 0x2, KEY_SELECT = 0x4, KEY_START = 0x8, KEY_RIGHT = 0x10, KEY_LEFT = 0x20, KEY_UP = 0x40, KEY_DOWN = 0x80 };
#define VRAM ((u8 *)0x06000000)
#define VRAM_BYTE(at, value) (*(volatile u8 *)(0x06000000 + (at)) = (value))
#define COLOURS ((u16 *)0x05000000)
#define OAM ((u16 *)0x07000000)
#define REGISTER(at, value) (*(volatile u16 *)(0x04000000 + (at)) = (value))
#define KEYS() (~*(volatile u16 *)0x04000130 & 0x3FF)
#define CODE(function) function
#define CALL(pointer) pointer
extern const u16 gWave[8];
#else
// built for a Dreamport: the hardware is the kit's, memory names a function by its address in the cartridge, and the
// cartridge's own data is read where the cartridge has it
#include "gba.h"
#include "twins.h"
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int16_t s16;
typedef int32_t s32;
extern u16 cart_keys;
#define VRAM gba_vram
#define VRAM_BYTE(at, value) gba_vram_write8(at, value)
#define COLOURS gba_pal
#define OAM gba_oam
#define REGISTER(at, value) gba_write(at, value)
#define KEYS() cart_keys
#define CODE(function) TWIN_ADDRESS(function)
#define CALL(pointer) TWIN(pointer)
#define gWave ((const u16 *)ADDRESS_gWave)
#endif

/** Something on the screen: a sprite that one function moves each frame. The list's links and the functions are kept
 *  as the console keeps them, as 32-bit addresses. */
struct Obj {
  /* 0x00 */ struct Obj *next;
  /* 0x04 */ void (*update)(struct Obj *);
  /* 0x08 */ s16 x, y;
  /* 0x0C */ s16 dx, dy;
  /* 0x10 */ u16 tile;
  /* 0x12 */ u16 timer;
};

#define gFrame (*(u32 *)(IWRAM + 0x00))
#define gKeys (*(u16 *)(IWRAM + 0x04))
#define gScroll (*(u16 *)(IWRAM + 0x06))
#define gFirst (*(struct Obj **)(IWRAM + 0x08))
// where in the cartridge's data the backdrop's colours are read from, kept as the address it is
#define gColours (*(const u16 **)(IWRAM + 0x0C))
#define gObjs ((struct Obj *)(IWRAM + 0x10))
// how many times A has been pressed, which nothing on the screen shows
#define gPresses (*(u32 *)(IWRAM + 0x100))
// where the first sprite has been, a frame each, in the slow work memory
#define gTrail ((s16 *)EWRAM)

void AgbMain(void);
void CartInit(void);
void CartFrame(void);
/** Waits for the screen to finish its frame: the cartridge watches the line the console is drawing, and a Dreamport
 *  ends its frame there. The program calls it from wherever it waits, as a console's program does. */
void WaitFrame(void);
void ObjBounce(struct Obj *obj);
void ObjKeys(struct Obj *obj);
void ObjBlink(struct Obj *obj);

#endif
