// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// backgrounds (nds-kit.mjs): it gives the video memory's bank A to engine A's backgrounds and bank C to engine B's,
// writes their colours, tiles and maps, and scrolls them once a frame, as the V-blank starts. A byte it writes to one
// of the colours is lost, as the ARM9's byte writes to the colours are.
//
// Engine A, on the upper screen, has two text backgrounds of 16-colour tiles: the first at priority 1, its tiles a
// stripe of eight colours and a block of one, alternating, in two of the colours' banks, every other pair of rows
// flipped across; the second at priority 0, so in front, a tile here and there, flipped down. Engine B, on the lower,
// has one background of 256-colour tiles, a tile of 64 colours, flipped every other way. The first background scrolls
// right a dot a frame and down a dot every other frame, engine B's down a dot a frame, and while A is held the second
// one moves left two dots a frame, and while Right is held engine B's moves right. The ARM7's program waits.

import { ARM7, ARM9, cartridgeWith, programWithNames } from './made-up-nds.mjs';

/** Where the program keeps its count and its second background's place, in the main memory. */
export const STATE = 0x02200000;

const ARM9_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r0, .Lpowcnt
	ldr r1, .Lpowcnt_value
	strh r1, [r0]
	ldr r0, .Lvramcnt_a
	mov r1, #0x81
	strb r1, [r0]
	mov r1, #0x84
	strb r1, [r0, #2]
	ldr r0, .Lpalette_a
	ldr r1, .Lcolours_a
	mov r2, #32
	bl copy_halves
	ldr r0, .Lpalette_a
	mov r1, #0xFF
	strb r1, [r0, #2]
	ldr r0, .Lpalette_b
	mov r2, #0
.Lcolours_b:
	strh r2, [r0]
	add r0, #2
	ldr r3, .Lcolour_step
	add r2, r3
	ldr r1, .Lcolour_mask
	and r2, r1
	ldr r1, .Lpalette_b_end
	cmp r0, r1
	bne .Lcolours_b
	ldr r0, .Ltiles_a
	ldr r1, .Lstripe
	mov r2, #8
	bl fill_words
	ldr r1, .Lblock
	mov r2, #8
	bl fill_words
	ldr r0, .Ltiles_b
	mov r2, #1
.Ltile_b:
	add r1, r2, #1
	lsl r1, r1, #8
	orr r1, r2
	strh r1, [r0]
	add r0, #2
	add r2, #2
	cmp r2, #65
	bne .Ltile_b
	ldr r0, .Lmap_a
	mov r3, #0
.Lmap0:
	lsr r1, r3, #5
	eor r1, r3
	mov r2, #1
	and r1, r2
	add r1, #1
	lsr r2, r3, #2
	mov r4, #1
	and r2, r4
	lsl r2, r2, #12
	orr r1, r2
	lsr r2, r3, #6
	and r2, r4
	lsl r2, r2, #10
	orr r1, r2
	strh r1, [r0]
	add r0, #2
	add r3, #1
	ldr r2, .Lmap_size
	cmp r3, r2
	bne .Lmap0
	ldr r0, .Lmap_a1
	mov r3, #0
.Lmap1:
	mov r1, #0
	mov r2, #7
	and r2, r3
	bne .Lempty
	ldr r1, .Lfront_tile
.Lempty:
	strh r1, [r0]
	add r0, #2
	add r3, #1
	ldr r2, .Lmap_size
	cmp r3, r2
	bne .Lmap1
	ldr r0, .Lmap_b
	mov r3, #0
.Lmapb:
	mov r1, #3
	and r1, r3
	lsl r1, r1, #10
	add r1, #1
	strh r1, [r0]
	add r0, #2
	add r3, #1
	ldr r2, .Lmap_size
	cmp r3, r2
	bne .Lmapb
	ldr r0, .Lbgcnt_a
	ldr r1, .Lbg0cnt
	strh r1, [r0]
	ldr r1, .Lbg1cnt
	strh r1, [r0, #2]
	ldr r0, .Lbgcnt_b
	ldr r1, .Lbgbcnt
	strh r1, [r0]
	ldr r0, .Ldispcnt_a
	ldr r1, .Ldisplay_a
	str r1, [r0]
	ldr r0, .Ldispcnt_b
	ldr r1, .Ldisplay_b
	str r1, [r0]
	ldr r4, .Lstate
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
	ldr r0, .Lscroll_a
	strh r7, [r0]
	lsr r1, r7, #1
	strh r1, [r0, #2]
	ldr r0, .Lkeyinput
	ldrh r5, [r0]
	ldr r1, [r4]
	mov r2, #1
	tst r5, r2
	bne .Lno_a
	add r1, #2
	str r1, [r4]
.Lno_a:
	ldr r0, .Lscroll_a
	neg r2, r1
	strh r2, [r0, #4]
	ldr r1, [r4, #4]
	mov r2, #16
	tst r5, r2
	bne .Lno_right
	sub r1, #1
	str r1, [r4, #4]
.Lno_right:
	ldr r0, .Lscroll_b
	strh r1, [r0]
	strh r7, [r0, #2]
	b .Lframe
	.thumb_func
copy_halves:
	ldrh r3, [r1]
	strh r3, [r0]
	add r0, #2
	add r1, #2
	sub r2, #1
	bne copy_halves
	bx lr
	.thumb_func
fill_words:
	str r1, [r0]
	add r0, #4
	sub r2, #1
	bne fill_words
	bx lr
	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Lvramcnt_a: .word 0x04000240
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
.Lpalette_b_end: .word 0x05000600
.Lcolour_step: .word 0x0421
.Lcolour_mask: .word 0x7FFF
.Lcolours_a: .word colours
.Ltiles_a: .word 0x06004020
.Ltiles_b: .word 0x06204040
.Lstripe: .word 0x76543210
.Lblock: .word 0x99999999
.Lmap_a: .word 0x06000000
.Lmap_a1: .word 0x06000800
.Lmap_b: .word 0x06200000
.Lmap_size: .word 1024
.Lfront_tile: .word 0x1802
.Lbgcnt_a: .word 0x04000008
.Lbgcnt_b: .word 0x04001008
.Lbg0cnt: .word 0x0005
.Lbg1cnt: .word 0x0104
.Lbgbcnt: .word 0x0084
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Ldisplay_a: .word 0x00010300
.Ldisplay_b: .word 0x00010100
.Lstate: .word ${STATE}
.Ldispstat: .word 0x04000004
.Lkeyinput: .word 0x04000130
.Lscroll_a: .word 0x04000010
.Lscroll_b: .word 0x04001010
colours:
	.hword 0x0000, 0x001F, 0x03E0, 0x7C00, 0x03FF, 0x7FE0, 0x7C1F, 0x4210
	.hword 0x2108, 0x6318, 0x0010, 0x0200, 0x4000, 0x0210, 0x4200, 0x4010
	.hword 0x0000, 0x0C63, 0x1CE7, 0x2D6B, 0x3DEF, 0x4E73, 0x5EF7, 0x6F7B
	.hword 0x7FFF, 0x1234, 0x2345, 0x3456, 0x4567, 0x5678, 0x6789, 0x789A
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
export function madeUpNdsBackgrounds({ title = 'MADE UP BGS', code = 'MDBE' } = {}) {
  return cartridgeWith({ title, code, arm9: programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7: programWithNames(ARM7_PROGRAM, ARM7.address).bytes });
}
