// The C library's memcpy and memset, as a game links them from its newlib: Thumb code the console's compiler gives
// back byte for byte from what's written here, which is their proof (match). Each is written by hand from the console's
// instructions as npm run dp -- read prints them.
//
// They're the console's build's alone: a Dreamport has the kit's own C library's memcpy and memset (kit/c/libc.c), so
// these are left out of it, and the function check (twin), which calls a twin by its name, calls those there.
#ifdef MATCHING
typedef unsigned int size_t;

// each is its instructions alone, with nothing the compiler adds before or after them
void *memcpy(void *dest, const void *src, size_t n) __attribute__((naked));
void *memset(void *dest, int c, size_t n) __attribute__((naked));

/** memcpy: `n` bytes from `src` to `dest`, a word at a time while both are on a word and 16 or more are left, and
 *  gives back `dest`. */
void *memcpy(void *dest, const void *src, size_t n)
{
    asm(        "push {r4, r5, lr}\n\t"
        "mov r5, r0\n\t"
        "mov r4, r5\n\t"
        "mov r3, r1\n\t"
        "cmp r2, #15\n\t"
        "bls .Lmemcpy_bytes\n\t"
        "mov r0, r3\n\t"
        "orr r0, r5\n\t"
        "mov r1, #3\n\t"
        "and r0, r1\n\t"
        "cmp r0, #0\n\t"
        "bne .Lmemcpy_bytes\n\t"
        "mov r1, r5\n\t"
        ".Lmemcpy_16:\n"
        "ldmia r3!, {r0}\n\t"
        "stmia r1!, {r0}\n\t"
        "ldmia r3!, {r0}\n\t"
        "stmia r1!, {r0}\n\t"
        "ldmia r3!, {r0}\n\t"
        "stmia r1!, {r0}\n\t"
        "ldmia r3!, {r0}\n\t"
        "stmia r1!, {r0}\n\t"
        "sub r2, #16\n\t"
        "cmp r2, #15\n\t"
        "bhi .Lmemcpy_16\n\t"
        "cmp r2, #3\n\t"
        "bls .Lmemcpy_words_done\n\t"
        ".Lmemcpy_4:\n"
        "ldmia r3!, {r0}\n\t"
        "stmia r1!, {r0}\n\t"
        "sub r2, #4\n\t"
        "cmp r2, #3\n\t"
        "bhi .Lmemcpy_4\n\t"
        ".Lmemcpy_words_done:\n"
        "mov r4, r1\n\t"
        ".Lmemcpy_bytes:\n"
        "sub r2, #1\n\t"
        "mov r0, #1\n\t"
        "neg r0, r0\n\t"
        "cmp r2, r0\n\t"
        "beq .Lmemcpy_done\n\t"
        "mov r1, r0\n\t"
        ".Lmemcpy_byte:\n"
        "ldrb r0, [r3, #0]\n\t"
        "strb r0, [r4, #0]\n\t"
        "add r3, #1\n\t"
        "add r4, #1\n\t"
        "sub r2, #1\n\t"
        "cmp r2, r1\n\t"
        "bne .Lmemcpy_byte\n\t"
        ".Lmemcpy_done:\n"
        "mov r0, r5\n\t"
        "pop {r4, r5, pc}");
}

/** memset: `n` bytes at `dest` set to `c`'s low byte, a word at a time while `dest` is on a word and 4 or more are
 *  left, and gives back `dest`. */
void *memset(void *dest, int c, size_t n)
{
    asm(        "push {r4, r5, lr}\n\t"
        "mov r5, r0\n\t"
        "mov r4, r1\n\t"
        "mov r3, r5\n\t"
        "cmp r2, #3\n\t"
        "bls .Lmemset_bytes\n\t"
        "mov r0, #3\n\t"
        "and r0, r5\n\t"
        "cmp r0, #0\n\t"
        "bne .Lmemset_bytes\n\t"
        "mov r1, r5\n\t"
        "mov r0, #255\n\t"
        "and r4, r0\n\t"
        "lsl r3, r4, #8\n\t"
        "orr r3, r4\n\t"
        "lsl r0, r3, #16\n\t"
        "orr r3, r0\n\t"
        "cmp r2, #15\n\t"
        "bls .Lmemset_4_test\n\t"
        ".Lmemset_16:\n"
        "stmia r1!, {r3}\n\t"
        "stmia r1!, {r3}\n\t"
        "stmia r1!, {r3}\n\t"
        "stmia r1!, {r3}\n\t"
        "sub r2, #16\n\t"
        "cmp r2, #15\n\t"
        "bhi .Lmemset_16\n\t"
        "b .Lmemset_4_test\n\t"
        ".Lmemset_4:\n"
        "stmia r1!, {r3}\n\t"
        "sub r2, #4\n\t"
        ".Lmemset_4_test:\n"
        "cmp r2, #3\n\t"
        "bhi .Lmemset_4\n\t"
        "mov r3, r1\n\t"
        "b .Lmemset_bytes\n\t"
        ".Lmemset_byte:\n"
        "strb r4, [r3, #0]\n\t"
        "add r3, #1\n\t"
        ".Lmemset_bytes:\n"
        "mov r0, r2\n\t"
        "sub r2, #1\n\t"
        "cmp r0, #0\n\t"
        "bne .Lmemset_byte\n\t"
        "mov r0, r5\n\t"
        "pop {r4, r5, pc}");
}
#else
// the kit's own, which the function check calls by these names
void *memcpy(void *dest, const void *src, unsigned long n);
void *memset(void *dest, int c, unsigned long n);
#endif
