// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// interrupts and timers (nds-kit.mjs): each processor waits for the V-blank in the BIOS, counts its interrupts in its
// handler and reads a timer there.
//
// Each processor starts in ARM code, as the console's firmware leaves it, and turns its interrupts on in the system
// mode, with a stack of its own, before going on in Thumb. It keeps its handler's address where the BIOS takes it, turns
// on the V-blank's interrupt and its timers, and waits for each V-blank with the BIOS's VBlankIntrWait, halted, waking
// for the other interrupts it has on meanwhile. Each handler counts the interrupts it takes and, at the V-blank, reads a
// timer that counts the clock itself and keeps its counts as they stand then, for the frame to show.
//
// The ARM9's timer 0 counts a 1024th of the clock and overflows every 1024 counts, with its interrupt, and timer 1
// counts its overflows, with its own every third; timer 2 counts the clock. Each frame it shows its counts on the upper
// screen and the ARM7's on the lower, or on odd frames the two timers their handlers read. Holding A stops timer 0,
// which starts again from its reload when let go; B asks for the ARM7's sync interrupt; Start sends the frame's count
// through the queue. A while later, mid-frame, it takes what the ARM7's handler kept at the V-blank.
// The ARM7's timer 0 counts a 256th of the clock and overflows every 8192 counts, with its interrupt, and timer 1
// counts the clock. Its handler, in ARM code as the ARM7's BIOS goes to it, counts the V-blanks, timer 0's interrupts,
// the sync interrupts and the words the queue brings, which it takes and adds up.
//
// The ARM9 also reads timer 2 just after it writes timer 0's control, and keeps it where nothing shows it: what the
// test's maker read on melonDS to time the Dreamport's start of the timer again.

import { ARM7, ARM9, cartridgeWith, programWithNames } from './made-up-nds.mjs';

/** Where the handlers keep their counts, in the main memory: the ARM9's V-blanks, timer 0's and timer 1's interrupts,
 *  timer 2 at the V-blank; the ARM7's V-blanks, timer 0's interrupts, the sync's and the queue's words, timer 1 at the
 *  V-blank; the ARM7's counts and timer as the ARM9 took them; the ARM9's counts and the ARM7's at the V-blank; and
 *  timer 2 as the ARM9 wrote timer 0's control. */
export const COUNTS = 0x02210000;
/** How many turns the ARM9's loop takes after its work each frame, before it takes the ARM7's counts. */
export const WAIT = 10000;

// the start in ARM code: the system mode, interrupts on, the stack, and on in Thumb
const START = stack => `
	.text
	.code 16
	.thumb_func
main:
	bx pc
	mov r8, r8
	.arm
	mov r0, #0x1F
	msr cpsr_c, r0
	ldr sp, .Lstack
	ldr r0, .Lgo
	bx r0
.Lstack: .word ${stack}
.Lgo: .word start+1
	.code 16
	.thumb_func
start:
`;

const ARM9_PROGRAM = `${START('0x03002F00')}
	ldr r0, .Lpowcnt
	ldr r1, .Lpowcnt_value
	strh r1, [r0]
	ldr r0, .Ldispcnt_a
	ldr r1, .Lscreen_on
	str r1, [r0]
	ldr r0, .Ldispcnt_b
	str r1, [r0]
	ldr r0, .Lhandler_at
	ldr r1, .Lhandler
	str r1, [r0]
	ldr r0, .Lfifocnt
	ldr r1, .Lfifo_on
	strh r1, [r0]
	ldr r0, .Ltimer2
	ldr r1, .Ltimer2_on
	str r1, [r0]
	ldr r0, .Ltimer1
	ldr r1, .Ltimer1_on
	str r1, [r0]
	ldr r0, .Ltimer0
	ldr r1, .Ltimer0_on
	str r1, [r0]
	ldr r0, .Ldispstat
	mov r1, #8
	strh r1, [r0]
	ldr r0, .Lie
	mov r1, #0x19
	str r1, [r0]
	ldr r0, .Lime
	mov r1, #1
	str r1, [r0]
	mov r7, #0
	ldr r6, .Lcounts
.Lframe:
	swi 5
	add r7, #1
	mov r0, #1
	tst r7, r0
	bne .Lodd
	ldr r1, [r6, #40]
	ldr r3, [r6, #32]
	b .Lshow
.Lodd:
	ldr r1, [r6, #12]
	ldr r3, [r6, #36]
.Lshow:
	ldr r2, .Lcolour_mask
	and r1, r2
	and r3, r2
	ldr r0, .Lpalette_a
	strh r1, [r0]
	ldr r0, .Lpalette_b
	strh r3, [r0]
	ldr r0, .Lkeyinput
	ldrh r5, [r0]
	ldr r0, .Ltimer0_control
	mov r1, #0xC3
	mov r2, #1
	tst r5, r2
	bne .Lkeep
	mov r1, #0x43
.Lkeep:
	strh r1, [r0]
	ldr r0, .Ltimer2
	ldrh r1, [r0]
	str r1, [r6, #48]
	mov r2, #2
	tst r5, r2
	bne .Lno_sync
	ldr r0, .Lsync
	ldr r1, .Lsync_ask
	strh r1, [r0]
.Lno_sync:
	mov r2, #8
	tst r5, r2
	bne .Lno_send
	ldr r0, .Lsend
	str r7, [r0]
.Lno_send:
	ldr r0, .Lwait
.Lwaiting:
	sub r0, #1
	bne .Lwaiting
	ldr r1, [r6, #44]
	str r1, [r6, #32]
	ldr r1, [r6, #28]
	str r1, [r6, #36]
	b .Lframe

	.thumb_func
handler9:
	push {r4, r5}
	ldr r0, .Lif
	ldr r1, [r0]
	str r1, [r0]
	ldr r2, .Lcounts
	mov r3, #8
	tst r1, r3
	beq .Lnot_timer0
	ldr r3, [r2, #4]
	add r3, #1
	str r3, [r2, #4]
.Lnot_timer0:
	mov r3, #16
	tst r1, r3
	beq .Lnot_timer1
	ldr r3, [r2, #8]
	add r3, #1
	str r3, [r2, #8]
.Lnot_timer1:
	mov r3, #1
	tst r1, r3
	beq .Lnot_vblank
	ldr r0, .Ltimer2
	ldrh r3, [r0]
	str r3, [r2, #12]
	ldr r3, [r2]
	add r3, #1
	str r3, [r2]
	mov r5, #31
	and r3, r5
	ldr r4, [r2, #4]
	and r4, r5
	lsl r4, r4, #5
	orr r3, r4
	ldr r4, [r2, #8]
	and r4, r5
	lsl r4, r4, #10
	orr r3, r4
	str r3, [r2, #40]
.Lnot_vblank:
	ldr r2, .Lcheck
	ldr r3, [r2]
	orr r3, r1
	str r3, [r2]
	pop {r4, r5}
	bx lr

	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Lscreen_on: .word 0x00010000
.Lhandler_at: .word 0x03003FFC
.Lhandler: .word handler9+1
.Lcheck: .word 0x03003FF8
.Lfifocnt: .word 0x04000184
.Lfifo_on: .word 0x8000
.Ltimer0: .word 0x04000100
.Ltimer0_control: .word 0x04000102
.Ltimer0_on: .word 0x00C3FC00
.Ltimer1: .word 0x04000104
.Ltimer1_on: .word 0x00C4FFFD
.Ltimer2: .word 0x04000108
.Ltimer2_on: .word 0x00800000
.Ldispstat: .word 0x04000004
.Lie: .word 0x04000210
.Lime: .word 0x04000208
.Lif: .word 0x04000214
.Lcounts: .word ${COUNTS}
.Lcolour_mask: .word 0x7FFF
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
.Lkeyinput: .word 0x04000130
.Lsync: .word 0x04000180
.Lsync_ask: .word 0x2000
.Lsend: .word 0x04000188
.Lwait: .word ${WAIT}
`;

const ARM7_PROGRAM = `${START('0x0380FD00')}
	ldr r0, .Lhandler_at
	ldr r1, .Lhandler
	str r1, [r0]
	ldr r0, .Lsync
	ldr r1, .Lsync_on
	strh r1, [r0]
	ldr r0, .Lfifocnt
	ldr r1, .Lfifo_on
	strh r1, [r0]
	ldr r0, .Ltimer1
	ldr r1, .Ltimer1_on
	str r1, [r0]
	ldr r0, .Ltimer0
	ldr r1, .Ltimer0_on
	str r1, [r0]
	ldr r0, .Ldispstat
	mov r1, #8
	strh r1, [r0]
	ldr r0, .Lie
	ldr r1, .Lie_on
	str r1, [r0]
	ldr r0, .Lime
	mov r1, #1
	str r1, [r0]
.Lframe:
	swi 5
	b .Lframe

	.align 2
.Lhandler_at: .word 0x0380FFFC
.Lhandler: .word handler7
.Lsync: .word 0x04000180
.Lsync_on: .word 0x4000
.Lfifocnt: .word 0x04000184
.Lfifo_on: .word 0x8400
.Ltimer0: .word 0x04000100
.Ltimer0_on: .word 0x00C2E000
.Ltimer1: .word 0x04000104
.Ltimer1_on: .word 0x00800000
.Ldispstat: .word 0x04000004
.Lie: .word 0x04000210
.Lie_on: .word 0x00050009
.Lime: .word 0x04000208

	.arm
handler7:
	mov r0, #0x04000000
	ldr r1, [r0, #0x214]
	str r1, [r0, #0x214]
	ldr r2, .Lcounts
	tst r1, #8
	ldrne r3, [r2, #20]
	addne r3, r3, #1
	strne r3, [r2, #20]
	tst r1, #0x10000
	ldrne r3, [r2, #24]
	addne r3, r3, #1
	strne r3, [r2, #24]
	tst r1, #0x40000
	beq .Ldrained
.Ldrain:
	ldr r3, .Lfifocnt_at
	ldrh r3, [r3]
	tst r3, #0x100
	bne .Ldrained
	ldr r3, .Lreceive
	ldr r3, [r3]
	ldr r12, [r2, #24]
	add r12, r12, r3
	str r12, [r2, #24]
	b .Ldrain
.Ldrained:
	tst r1, #1
	beq .Ldone
	ldr r3, .Ltimer1_counter
	ldrh r3, [r3]
	str r3, [r2, #28]
	ldr r3, [r2, #16]
	add r3, r3, #1
	str r3, [r2, #16]
	and r3, r3, #31
	ldr r12, [r2, #20]
	and r12, r12, #31
	orr r3, r3, r12, lsl #5
	ldr r12, [r2, #24]
	and r12, r12, #31
	orr r3, r3, r12, lsl #10
	str r3, [r2, #44]
.Ldone:
	ldr r3, [r0, #-8]
	orr r3, r3, r1
	str r3, [r0, #-8]
	bx lr
.Lcounts: .word ${COUNTS}
.Ltimer1_counter: .word 0x04000104
.Lfifocnt_at: .word 0x04000184
.Lreceive: .word 0x04100000
`;

/** The cartridge's bytes and SHA-1. */
export function madeUpNdsIrq({ title = 'MADE UP IRQ', code = 'MDQE' } = {}) {
  return cartridgeWith({ title, code, arm9: programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7: programWithNames(ARM7_PROGRAM, ARM7.address).bytes });
}
