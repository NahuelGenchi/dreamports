// A small program of the project's own, with nothing from any game in it, for the test of a game whose parts are its
// tasks (../../part-tasks.mjs): a title that waits for Start, a flash, and a block the arrows move. It's written the
// way a Dreamport made the stricter way is (docs/STANDARD.md): every value where the console keeps it, and the same C
// for the cartridge and for the Dreamport. Only this header tells the two builds apart: MATCHING is defined when the
// console's compiler builds it, as match defines it (tools/README.md, Matching the original's bytes).
#ifndef CART_H
#define CART_H

enum { DISPCNT = 0x00 };

// the work memory, at the console's addresses in both builds
#define IWRAM 0x03000000

#ifdef MATCHING
// built with the console's compiler: the hardware is the console's
typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed short s16;
typedef signed int s32;
#define NULL ((void *)0)
enum { KEY_A = 0x1, KEY_B = 0x2, KEY_SELECT = 0x4, KEY_START = 0x8, KEY_RIGHT = 0x10, KEY_LEFT = 0x20, KEY_UP = 0x40, KEY_DOWN = 0x80, KEY_R = 0x100, KEY_L = 0x200 };
#define VRAM ((u8 *)0x06000000)
#define COLOURS ((u16 *)0x05000000)
#define OAM ((u16 *)0x07000000)
#define REGISTER(at, value) (*(volatile u16 *)(0x04000000 + (at)) = (value))
#define KEYS() (~*(volatile u16 *)0x04000130 & 0x3FF)
#define CODE(function) function
// the cartridge's own way to wait for the screen: it watches the line the console is drawing
#define WAIT_FOR_SCREEN() do { while (*(volatile u16 *)0x04000006 >= 160) {} while (*(volatile u16 *)0x04000006 < 160) {} } while (0)
#else
// built for a Dreamport: the hardware is the kit's, and memory names a function by its address in the cartridge
#include "gba.h"
#include "twins.h"
typedef uint8_t u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int16_t s16;
typedef int32_t s32;
extern u16 cart_keys;
#define VRAM gba_vram
#define COLOURS gba_pal
#define OAM gba_oam
#define REGISTER(at, value) gba_write(at, value)
#define KEYS() cart_keys
#define CODE(function) TWIN_ADDRESS(function)
// where the cartridge watches the line the console is drawing, a Dreamport ends its frame
#define WAIT_FOR_SCREEN() kit_wait_frame()
#endif

// the cartridge's own data, named as plain C names it in both builds: the cartridge defines it (cart.c), and a
// Dreamport's build puts the name where the cartridge has it, in the player's copy (proof/addresses.json)
extern const u16 gWave[8];

#define gFrame (*(u32 *)(IWRAM + 0x00))
#define gKeys (*(u16 *)(IWRAM + 0x04))
// 0 on the title, 1 once play has begun
#define gMode (*(u16 *)(IWRAM + 0x06))
#define gX (*(s16 *)(IWRAM + 0x08))
#define gY (*(s16 *)(IWRAM + 0x0A))
// a function kept for later as the console keeps one, as its 32-bit address
#define gAfter (*(u32 *)(IWRAM + 0x0C))
#define gSecrets (*(u32 *)(IWRAM + 0x10))

void AgbMain(void);
void WaitFrame(void);
void Init(void);
void Frame(void);
void Title(void);
void Flash(void);
void Play(void);
void Move(void);
void Draw(void);
void Secret(void);
void Bonus(void);

#endif
