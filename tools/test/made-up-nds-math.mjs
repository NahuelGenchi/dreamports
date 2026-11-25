// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// divider and square root (nds-kit.mjs): the ARM9 divides and takes a square root of each frame's numbers.
//
// Each frame, as the V-blank starts, the ARM9 sets the divider to one of its sizes in turn (32 by 32, 64 by 32, 64 by
// 64 bits, and 64 by 32 again), and writes a numerator of the frame's count times 0x01234567, with a high word that
// starts negative, and a denominator of the count's lowest four bits less 3, sign and all, so every 16th frame divides by
// zero. Straight after, it reads the quotient and the control, before the answer can be there, then waits for the busy
// flag to go and reads the answer. The square root is of the count times 0x01234567, 32 or 64 bits in turn, its high
// word the count times 37, read too soon and then once it's there. On even frames engine A's backdrop shows the
// quotient and remainder, on odd ones the square root; engine B's shows what was read too soon, with the busy flag and
// the division by zero's flag.

import { ARM7, ARM9, cartridgeWith, programWithNames } from './made-up-nds.mjs';

const ARM9_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r0, .Lpowcnt
	ldr r1, .Lpowcnt_value
	strh r1, [r0]
	ldr r0, .Ldispcnt_a
	ldr r1, .Lscreen_on
	str r1, [r0]
	ldr r0, .Ldispcnt_b
	str r1, [r0]
	mov r7, #0
.Lframe:
	ldr r0, .Ldispstat
	mov r2, #1
.Lin_blank:
	ldrh r1, [r0]
	tst r1, r2
	bne .Lin_blank
.Lshowing:
	ldrh r1, [r0]
	tst r1, r2
	beq .Lshowing
	add r7, #1
	ldr r5, .Ldivcnt
	@ the division
	mov r0, #3
	and r0, r7
	strh r0, [r5]
	ldr r1, .Lfactor
	mov r0, r7
	mul r0, r1
	str r0, [r5, #0x10]
	mov r0, r7
	sub r0, #100
	str r0, [r5, #0x14]
	mov r0, #15
	and r0, r7
	sub r0, #3
	str r0, [r5, #0x18]
	asr r0, r0, #31
	str r0, [r5, #0x1C]
	ldr r6, [r5, #0x20]
	ldrh r4, [r5]
.Ldividing:
	ldrh r0, [r5]
	lsr r0, r0, #15
	bne .Ldividing
	ldrh r0, [r5]
	lsr r0, r0, #14
	lsl r0, r0, #11
	lsr r4, r4, #15
	lsl r4, r4, #10
	orr r4, r0
	ldr r0, .Lten_bits
	and r6, r0
	orr r4, r6
	ldr r2, [r5, #0x20]
	ldr r3, [r5, #0x24]
	eor r2, r3
	ldr r3, [r5, #0x28]
	eor r2, r3
	ldr r3, [r5, #0x2C]
	eor r2, r3
	@ the square root
	mov r0, #1
	and r0, r7
	mov r1, r5
	add r1, #0x30
	strh r0, [r1]
	ldr r1, .Lfactor
	mov r0, r7
	mul r0, r1
	str r0, [r5, #0x38]
	mov r0, #37
	mul r0, r7
	str r0, [r5, #0x3C]
	ldr r6, [r5, #0x34]
.Lrooting:
	mov r0, r5
	add r0, #0x30
	ldrh r0, [r0]
	lsr r0, r0, #15
	bne .Lrooting
	ldr r3, [r5, #0x34]
	@ the backdrops
	mov r0, #1
	tst r7, r0
	beq .Leven
	mov r2, r3
	eor r6, r4
	mov r4, r6
.Leven:
	ldr r0, .Lcolour_mask
	and r2, r0
	and r4, r0
	ldr r0, .Lpalette_a
	strh r2, [r0]
	ldr r0, .Lpalette_b
	strh r4, [r0]
	b .Lframe
	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Lscreen_on: .word 0x00010000
.Ldispstat: .word 0x04000004
.Ldivcnt: .word 0x04000280
.Lfactor: .word 0x01234567
.Lten_bits: .word 0x3FF
.Lcolour_mask: .word 0x7FFF
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
`;

const ARM7_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	mov r0, r0
.Lforever:
	b .Lforever
`;

/** The cartridge's bytes and SHA-1. */
export function madeUpNdsMath({ title = 'MADE UP MATH', code = 'MDME' } = {}) {
  return cartridgeWith({ title, code, arm9: programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7: programWithNames(ARM7_PROGRAM, ARM7.address).bytes });
}
