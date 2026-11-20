// The console's compiler's own helpers, as the Game Boy Advance's compiler links them from its libgcc: the calls it
// makes through a register for a call through a pointer, and the division of two numbers with a sign. They're Thumb
// assembly, written here as the routines are, so the console's compiler gives them back byte for byte, which is their
// proof (match). Each is written by hand from the console's instructions as npm run dp -- read prints them.
//
// In a Dreamport, the C the game is written in does that work itself: a call through a pointer is C's own, and a
// division is the processor's. So a twin's C there is the routine's work, for the function check (twin), where one
// has work it can be checked by.
// each routine is its instructions alone, with nothing the compiler adds before or after them
#ifdef MATCHING
unsigned int _call_via_r0(void) __attribute__((naked));
unsigned int _call_via_r1(void) __attribute__((naked));
unsigned int _call_via_r2(void) __attribute__((naked));
unsigned int _call_via_r3(void) __attribute__((naked));
unsigned int _call_via_r4(void) __attribute__((naked));
unsigned int _call_via_r5(void) __attribute__((naked));
unsigned int _call_via_r6(void) __attribute__((naked));
unsigned int _call_via_r7(void) __attribute__((naked));
unsigned int _call_via_r8(void) __attribute__((naked));
unsigned int _call_via_r9(void) __attribute__((naked));
unsigned int _call_via_sl(void) __attribute__((naked));
unsigned int _call_via_fp(void) __attribute__((naked));
unsigned int _call_via_ip(void) __attribute__((naked));
unsigned int _call_via_sp(void) __attribute__((naked));
unsigned int _call_via_lr(void) __attribute__((naked));
int __divsi3(int numerator, int denominator) __attribute__((naked));
void __div0(void) __attribute__((naked));
#endif

/** _call_via_r0: a call through r0, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r0(void)
{
#ifdef MATCHING
    asm("bx r0");
#else
    return 0;
#endif
}

/** _call_via_r1: a call through r1, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r1(void)
{
#ifdef MATCHING
    asm("bx r1");
#else
    return 0;
#endif
}

/** _call_via_r2: a call through r2, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r2(void)
{
#ifdef MATCHING
    asm("bx r2");
#else
    return 0;
#endif
}

/** _call_via_r3: a call through r3, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r3(void)
{
#ifdef MATCHING
    asm("bx r3");
#else
    return 0;
#endif
}

/** _call_via_r4: a call through r4, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r4(void)
{
#ifdef MATCHING
    asm("bx r4");
#else
    return 0;
#endif
}

/** _call_via_r5: a call through r5, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r5(void)
{
#ifdef MATCHING
    asm("bx r5");
#else
    return 0;
#endif
}

/** _call_via_r6: a call through r6, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r6(void)
{
#ifdef MATCHING
    asm("bx r6");
#else
    return 0;
#endif
}

/** _call_via_r7: a call through r7, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r7(void)
{
#ifdef MATCHING
    asm("bx r7");
#else
    return 0;
#endif
}

/** _call_via_r8: a call through r8, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r8(void)
{
#ifdef MATCHING
    asm("bx r8");
#else
    return 0;
#endif
}

/** _call_via_r9: a call through r9, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_r9(void)
{
#ifdef MATCHING
    asm("bx r9");
#else
    return 0;
#endif
}

/** _call_via_sl: a call through sl, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_sl(void)
{
#ifdef MATCHING
    asm("bx r10");
#else
    return 0;
#endif
}

/** _call_via_fp: a call through fp, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_fp(void)
{
#ifdef MATCHING
    asm("bx r11");
#else
    return 0;
#endif
}

/** _call_via_ip: a call through ip, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_ip(void)
{
#ifdef MATCHING
    asm("bx r12");
#else
    return 0;
#endif
}

/** _call_via_sp: a call through sp, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_sp(void)
{
#ifdef MATCHING
    asm("bx sp");
#else
    return 0;
#endif
}

/** _call_via_lr: a call through lr, as the compiler makes one through a pointer, which gives back what the
 *  function it calls does. */
unsigned int _call_via_lr(void)
{
#ifdef MATCHING
    asm("bx lr");
#else
    return 0;
#endif
}

void __div0(void);

/**
 * __divsi3: `numerator` divided by `denominator`, rounded toward zero: the two numbers made positive, the quotient
 * a bit at a time, four bits a turn once the denominator is lined up, and its sign as the two numbers' signs say. By 0
 * it calls __div0 and gives back 0, and the lowest number by -1 gives itself.
 */
int __divsi3(int numerator, int denominator)
{
#ifdef MATCHING
    asm("cmp r1, #0\n\t"
        "beq .Ldivsi3_by_0\n\t"
        "push {r4}\n\t"
        "mov r4, r0\n\t"
        "eor r4, r1\n\t"
        "mov r12, r4\n\t"
        "mov r3, #1\n\t"
        "mov r2, #0\n\t"
        "cmp r1, #0\n\t"
        "bpl .Ldivsi3_denominator\n\t"
        "neg r1, r1\n"
        ".Ldivsi3_denominator:\n\t"
        "cmp r0, #0\n\t"
        "bpl .Ldivsi3_numerator\n\t"
        "neg r0, r0\n"
        ".Ldivsi3_numerator:\n\t"
        "cmp r0, r1\n\t"
        "bcc .Ldivsi3_got\n\t"
        "mov r4, #1\n\t"
        "lsl r4, r4, #28\n"
        ".Ldivsi3_by_16:\n\t"
        "cmp r1, r4\n\t"
        "bcs .Ldivsi3_lined_16\n\t"
        "cmp r1, r0\n\t"
        "bcs .Ldivsi3_lined_16\n\t"
        "lsl r1, r1, #4\n\t"
        "lsl r3, r3, #4\n\t"
        "b .Ldivsi3_by_16\n"
        ".Ldivsi3_lined_16:\n\t"
        "lsl r4, r4, #3\n"
        ".Ldivsi3_by_2:\n\t"
        "cmp r1, r4\n\t"
        "bcs .Ldivsi3_turn\n\t"
        "cmp r1, r0\n\t"
        "bcs .Ldivsi3_turn\n\t"
        "lsl r1, r1, #1\n\t"
        "lsl r3, r3, #1\n\t"
        "b .Ldivsi3_by_2\n"
        ".Ldivsi3_turn:\n\t"
        "cmp r0, r1\n\t"
        "bcc .Ldivsi3_bit_1\n\t"
        "sub r0, r0, r1\n\t"
        "orr r2, r3\n"
        ".Ldivsi3_bit_1:\n\t"
        "lsr r4, r1, #1\n\t"
        "cmp r0, r4\n\t"
        "bcc .Ldivsi3_bit_2\n\t"
        "sub r0, r0, r4\n\t"
        "lsr r4, r3, #1\n\t"
        "orr r2, r4\n"
        ".Ldivsi3_bit_2:\n\t"
        "lsr r4, r1, #2\n\t"
        "cmp r0, r4\n\t"
        "bcc .Ldivsi3_bit_3\n\t"
        "sub r0, r0, r4\n\t"
        "lsr r4, r3, #2\n\t"
        "orr r2, r4\n"
        ".Ldivsi3_bit_3:\n\t"
        "lsr r4, r1, #3\n\t"
        "cmp r0, r4\n\t"
        "bcc .Ldivsi3_next\n\t"
        "sub r0, r0, r4\n\t"
        "lsr r4, r3, #3\n\t"
        "orr r2, r4\n"
        ".Ldivsi3_next:\n\t"
        "cmp r0, #0\n\t"
        "beq .Ldivsi3_got\n\t"
        "lsr r3, r3, #4\n\t"
        "beq .Ldivsi3_got\n\t"
        "lsr r1, r1, #4\n\t"
        "b .Ldivsi3_turn\n"
        ".Ldivsi3_got:\n\t"
        "mov r0, r2\n\t"
        "mov r4, r12\n\t"
        "cmp r4, #0\n\t"
        "bpl .Ldivsi3_signed\n\t"
        "neg r0, r0\n"
        ".Ldivsi3_signed:\n\t"
        "pop {r4}\n\t"
        "mov pc, lr\n"
        ".Ldivsi3_by_0:\n\t"
        "push {lr}\n\t"
        "bl __div0\n\t"
        "mov r0, #0\n\t"
        "pop {pc}");
#else
    unsigned n = numerator < 0 ? -(unsigned)numerator : (unsigned)numerator;
    unsigned d = denominator < 0 ? -(unsigned)denominator : (unsigned)denominator;
    unsigned q;
    if (denominator == 0) {
        __div0();
        return 0;
    }
    q = n / d;
    return (int)((numerator ^ denominator) < 0 ? -q : q);
#endif
}

/** __div0: what a division by 0 calls, which does nothing and goes back. */
void __div0(void)
{
#ifdef MATCHING
    asm("mov pc, lr");
#endif
}
