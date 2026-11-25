// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// DMA channels (nds-kit.mjs): both processors copy and fill memory with DMA, at once and at each V-blank, and the ARM9
// times one of its copies with a timer.
//
// Each frame, as the V-blank starts, the ARM9 writes a block of 32 colours in the main memory, which its channel 1
// copies backwards, by halfwords counting down, and its channel 2 fills 8 words from its fill register, the frame's
// count twice. Its channel 3 then copies, by halfwords or words, one of four ways in turn: the main memory to itself, to
// engine B's colours, engine A's colours to the main memory, or the main memory to bank A of the video memory, given to
// its own place, each way for two frames; 20 to 147 units, more each frame, timed by timer 2, which counts the clock. Its channel 0, started once,
// copies a halfword to engine A's backdrop at each V-blank, again and again, with its interrupt's flag, which the ARM9
// counts and clears. That halfword is, on even frames, a colour of the backwards copy and a word of the fill together,
// and on odd ones how long the timed copy took. Engine B's backdrop shows the flags it counted and what the ARM7 copied.
// The ARM7, a while after each V-blank starts, copies the block into its own memory by words, with its channel 3, and
// back, backwards, by halfwords, with its channel 0, for the ARM9 to show.

import { ARM7, ARM9, cartridgeWith, programWithNames } from './made-up-nds.mjs';

/** Where the program keeps its blocks in the main memory. */
export const BLOCK = 0x02200000;

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
	ldr r0, .Lvramcnt_a
	mov r1, #0x80
	strb r1, [r0]
	ldr r0, .Ltimer2
	ldr r1, .Ltimer2_on
	str r1, [r0]
	ldr r5, .Ldma
	ldr r0, .Lw
	str r0, [r5]
	ldr r0, .Lpalette_a
	str r0, [r5, #4]
	ldr r0, .Lvblank_control
	str r0, [r5, #8]
	ldr r6, .Lblock
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
	@ the block of colours
	mov r0, #0
	lsl r2, r7, #3
	sub r2, r2, r7
	ldr r3, .Lcolour_mask
	mov r4, r6
.Lbuild:
	mov r1, r2
	and r1, r3
	strh r1, [r4]
	add r4, #2
	add r2, #3
	add r0, #1
	cmp r0, #32
	bne .Lbuild
	ldr r5, .Ldma
	@ channel 1: the block, backwards
	str r6, [r5, #12]
	ldr r0, .Lreversed_end
	str r0, [r5, #16]
	ldr r0, .Lreverse_control
	str r0, [r5, #20]
	@ channel 2: a fill of 8 words
	lsl r0, r7, #16
	orr r0, r7
	ldr r1, .Lfill
	str r0, [r1]
	str r1, [r5, #24]
	ldr r0, .Lfilled
	str r0, [r5, #28]
	ldr r0, .Lfill_control
	str r0, [r5, #32]
	@ channel 3: one of four ways, a way for two frames, 20 to 147 units, timed
	lsr r0, r7, #1
	mov r1, #3
	and r0, r1
	lsl r1, r0, #3
	ldr r2, .Lways_at
	add r2, r1
	ldr r1, [r2]
	str r1, [r5, #36]
	ldr r1, [r2, #4]
	str r1, [r5, #40]
	lsl r0, r0, #2
	ldr r2, .Lway_controls_at
	ldr r4, [r2, r0]
	mov r0, #127
	and r0, r7
	add r0, #20
	orr r4, r0
	ldr r1, .Ltimer2
	ldrh r2, [r1]
	str r4, [r5, #44]
	ldrh r3, [r1]
	sub r3, r3, r2
	@ the halfword channel 0 shows at the next V-blank
	mov r0, #1
	tst r7, r0
	bne .Lodd
	mov r0, #31
	and r0, r7
	lsl r0, r0, #1
	ldr r1, .Lreversed
	ldrh r2, [r1, r0]
	mov r0, #7
	and r0, r7
	lsl r0, r0, #2
	ldr r1, .Lfilled
	ldr r3, [r1, r0]
	eor r2, r3
	b .Lkeep
.Lodd:
	mov r2, r3
.Lkeep:
	ldr r1, .Lcolour_mask
	and r2, r1
	ldr r1, .Lw
	strh r2, [r1]
	@ channel 0's interrupt flags, counted and cleared, and what the ARM7 copied, on engine B's backdrop
	ldr r0, .Lif
	ldr r1, [r0]
	lsr r1, r1, #8
	mov r2, #1
	and r1, r2
	lsl r2, r2, #8
	str r2, [r0]
	ldr r0, .Lflags
	ldr r2, [r0]
	add r2, r1
	str r2, [r0]
	mov r1, #31
	and r2, r1
	mov r0, #15
	and r0, r7
	lsl r0, r0, #1
	ldr r1, .Lsevens
	ldrh r3, [r1, r0]
	ldr r1, .Lten_bits
	and r3, r1
	lsl r3, r3, #5
	orr r2, r3
	ldr r0, .Lpalette_b
	strh r2, [r0]
	b .Lframe

	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Lscreen_on: .word 0x00010000
.Lvramcnt_a: .word 0x04000240
.Ltimer2: .word 0x04000108
.Ltimer2_on: .word 0x00800000
.Ldma: .word 0x040000B0
.Lvblank_control: .word 0xCB600001
.Lreverse_control: .word 0x80200020
.Lfill_control: .word 0x85000008
.Lfill: .word 0x040000E0
.Ldispstat: .word 0x04000004
.Lif: .word 0x04000214
.Lcolour_mask: .word 0x7FFF
.Lten_bits: .word 0x3FF
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
.Lblock: .word ${BLOCK}
.Lreversed: .word ${BLOCK + 0x1000}
.Lreversed_end: .word ${BLOCK + 0x103E}
.Lfilled: .word ${BLOCK + 0x1100}
.Lflags: .word ${BLOCK + 0x1300}
.Lsevens: .word ${BLOCK + 0x3000}
.Lw: .word ${BLOCK + 0x30000}
.Lways_at: .word ways
.Lway_controls_at: .word way_controls
ways:
	.word ${BLOCK}, ${BLOCK + 0x2000}
	.word ${BLOCK}, 0x05000404
	.word 0x05000002, ${BLOCK + 0x2000}
	.word ${BLOCK}, 0x06800000
way_controls:
	.word 0x80000000, 0x84000000, 0x80000000, 0x84000000
`;

const ARM7_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r5, .Ldma
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
	ldr r0, .Lwait
.Lwaiting:
	sub r0, #1
	bne .Lwaiting
	@ channel 3: the block into the ARM7's own memory, by words
	ldr r0, .Lblock
	str r0, [r5, #36]
	ldr r0, .Lown
	str r0, [r5, #40]
	ldr r0, .Linto_control
	str r0, [r5, #44]
	@ channel 0: back, backwards, by halfwords
	ldr r0, .Lown_end
	str r0, [r5]
	ldr r0, .Lsevens
	str r0, [r5, #4]
	ldr r0, .Lback_control
	str r0, [r5, #8]
	b .Lframe
	.align 2
.Ldma: .word 0x040000B0
.Ldispstat: .word 0x04000004
.Lwait: .word 5000
.Lblock: .word ${BLOCK}
.Lown: .word 0x03800100
.Lown_end: .word 0x0380013E
.Lsevens: .word ${BLOCK + 0x3000}
.Linto_control: .word 0x84000010
.Lback_control: .word 0x80800020
`;

/** The cartridge's bytes and SHA-1. */
export function madeUpNdsDma({ title = 'MADE UP DMA', code = 'MDDE' } = {}) {
  return cartridgeWith({ title, code, arm9: programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7: programWithNames(ARM7_PROGRAM, ARM7.address).bytes });
}
