// A small Nintendo DS program with nothing from any game in it, written here, for the end-to-end test of a game made a
// part at a time, each part a task of the functions it runs (nds-flow.mjs): a program for each of the console's two
// processors, as every game has, whose game is two functions small enough to say in a line of C each.
//
// The ARM9's program turns both screens on and, once a frame, as the V-blank starts, reads its buttons into a record of
// its own in the main memory and calls `tick`, which counts the frame and works out the upper screen's colour. While A
// is held it also calls `bump`, which counts the presses and works out the lower screen's. Then it colours each
// screen. So a part played with no button runs `tick` alone, and a part with A held runs `bump` as well. Both do all
// their work in the main memory, given the record's address, so the function check can call each of them. The ARM7's
// program waits for ever, in a loop that never goes back to its start.
//
// The header has no logo, as the logo is Nintendo's (made-up-nds.mjs).

import { ARM7, ARM9, cartridgeWith, programWithNames } from './made-up-nds.mjs';

/** Where the record is in the main memory, and where each of its values is in it. */
export const STATE = 0x02200000;
export const FIELDS = { keys: 0, frames: 4, colour: 8, lower: 10, presses: 12 };

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
	ldr r4, .Lstate
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
	ldr r0, .Lkeyinput
	ldrh r1, [r0]
	mvn r1, r1
	str r1, [r4]
	mov r0, r4
	bl tick
	ldr r1, [r4]
	mov r2, #1
	tst r1, r2
	beq .Lunpressed
	mov r0, r4
	bl bump
.Lunpressed:
	ldrh r1, [r4, #8]
	ldr r0, .Lpalette_a
	strh r1, [r0]
	ldrh r1, [r4, #10]
	ldr r0, .Lpalette_b
	strh r1, [r0]
	b .Lframe
	.thumb_func
tick:
	ldr r1, [r0, #4]
	add r1, #1
	str r1, [r0, #4]
	mov r2, #31
	and r2, r1
	strh r2, [r0, #8]
	bx lr
	.thumb_func
bump:
	ldr r1, [r0, #12]
	add r1, #1
	str r1, [r0, #12]
	mov r2, #31
	and r2, r1
	lsl r2, r2, #5
	strh r2, [r0, #10]
	bx lr
	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Lscreen_on: .word 0x00010000
.Ldispstat: .word 0x04000004
.Lkeyinput: .word 0x04000130
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
.Lstate: .word ${STATE}
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

/** The cartridge's bytes and SHA-1, with where `tick` and `bump` are in memory. */
export function madeUpNdsParts({ title = 'MADE UP PART', code = 'MDPE' } = {}) {
  const arm9 = programWithNames(ARM9_PROGRAM, ARM9.address), arm7 = programWithNames(ARM7_PROGRAM, ARM7.address);
  return { ...cartridgeWith({ title, code, arm9: arm9.bytes, arm7: arm7.bytes }), tick: arm9.at.tick, bump: arm9.at.bump };
}
