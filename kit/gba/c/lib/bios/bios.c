// The calls to the console's BIOS, as a game links them from its maker's library of stubs: each a swi with the call's
// number, the BIOS doing the work, and back. They're Thumb assembly, written here as the stubs are, so the console's
// compiler gives them back byte for byte, which is their proof (match). Each is written by hand from the console's
// instructions as npm run dp -- read prints them.
//
// In a Dreamport the BIOS's work is the version's own, as its hardware has it: a version that takes this library
// gives each of these (console_cpu_fast_set, console_cpu_set, console_div, console_mod, console_vblank_intr_wait), and the twin calls it,
// so the function check (twin) compares that work with the BIOS's.
void console_cpu_fast_set(const void *src, void *dest, unsigned int control);
void console_cpu_set(const void *src, void *dest, unsigned int control);
int console_div(int num, int denom);
int console_mod(int num, int denom);
void console_vblank_intr_wait(void);

// each stub is its instructions alone, with nothing the compiler adds before or after them
#ifndef MATCHING
// and in a Dreamport each says its swi to the console's stack, which has what the BIOS pushes there (kit/gba/c/stack.h)
#include "stack.h"
#else
void CpuFastSet(const void *src, void *dest, unsigned int control) __attribute__((naked));
void CpuSet(const void *src, void *dest, unsigned int control) __attribute__((naked));
int Div(int num, int denom) __attribute__((naked));
int Mod(int num, int denom) __attribute__((naked));
void VBlankIntrWait(void) __attribute__((naked));
#endif

/** CpuFastSet: the BIOS's fast copy, or fill, of as many words as `control` says, eight at a time, from `src` to
 *  `dest`. */
void CpuFastSet(const void *src, void *dest, unsigned int control)
{
#ifdef MATCHING
    asm("swi 12\n\tbx lr");
#else
    gba_stack_swi(12, control);
    console_cpu_fast_set(src, dest, control);
#endif
}

/** CpuSet: the BIOS's copy, or fill, of as many halfwords or words as `control` says, from `src` to `dest`. */
void CpuSet(const void *src, void *dest, unsigned int control)
{
#ifdef MATCHING
    asm("swi 11\n\tbx lr");
#else
    gba_stack_swi(11, control);
    console_cpu_set(src, dest, control);
#endif
}

/** Div: `num` divided by `denom`, by the BIOS. */
int Div(int num, int denom)
{
#ifdef MATCHING
    asm("swi 6\n\tbx lr");
#else
    gba_stack_swi(6, GBA_STACK_NONE);
    return console_div(num, denom);
#endif
}

/** Mod: what's left of `num` divided by `denom`, by the BIOS's division, which gives it back second. */
int Mod(int num, int denom)
{
#ifdef MATCHING
    asm("swi 6\n\tmov r0, r1\n\tbx lr");
#else
    gba_stack_swi(6, GBA_STACK_NONE);
    return console_mod(num, denom);
#endif
}

/** VBlankIntrWait: the processor halted until the V-blank's interrupt has run, by the BIOS's IntrWait. */
void VBlankIntrWait(void)
{
#ifdef MATCHING
    asm("mov r2, #0\n\tswi 5\n\tbx lr");
#else
    gba_stack_swi(5, 0);
    console_vblank_intr_wait();
#endif
}
