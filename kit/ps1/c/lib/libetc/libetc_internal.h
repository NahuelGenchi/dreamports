// SPDX-License-Identifier: MIT
// What libetc's twins share: the types they're written with, the table of callbacks its interrupt code keeps, and the
// functions of the PsyQ libraries they call, libapi's and libc's, which a game gives where its program has them.
#ifndef LIBETC_INTERNAL_H
#define LIBETC_INTERNAL_H

typedef signed int s32;
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned long u_long;
typedef unsigned int size_t;
typedef void (*Callback)();
// what sets a V-blank callback, as startIntrVSync gives it
typedef Callback (*VSyncSetter)(s32, Callback);

#define NULL ((void*)0)
#define true 1
#define false 0

// what setjmp keeps, a word each: where it goes back to, the stack, the frame, s0 to s7 and gp
#define JB_PC 0
#define JB_SP 1
#define JB_SIZE 12
typedef int jmp_buf[JB_SIZE];

// the callbacks the interrupt code keeps, which libetc's other functions reach through pCallbacks
struct Callbacks {
    const char* rcsid;
    Callback (*DMACallback)(int dma, Callback f);
    Callback (*InterruptCallback)(int irq, Callback f);
    void* (*ResetCallback)(void);
    void* (*StopCallback)(void);
    Callback (*VSyncCallbacks)(int ch, Callback f);
    void* (*RestartCallback)(void);
    void* intrEnv;
};

// libetc's own
void* ResetCallback(void);
void InterruptCallback(int irq, Callback f);
VSyncSetter startIntrVSync(void);
void* startIntrDMA(void);
void v_wait(s32 count, s32 max);

// libapi's
s32 setjmp(jmp_buf);
void HookEntryInt(jmp_buf);
void ResetEntryInt(void);
void ReturnFromException(void);
void EnterCriticalSection(void);
void ExitCriticalSection(void);
void ChangeClearPAD(s32);
void ChangeClearRCnt(s32, s32);
void PAD_init(s32, s32*);
void PAD_dr(void);
void StopPAD(void);
void _96_remove(void);

// libc's
int printf(char*, ...);
void puts(char*);

#endif
