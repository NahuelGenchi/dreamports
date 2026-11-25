// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// cartridge slot (nds-kit.mjs): the ARM9 reads its own cartridge.
//
// The ARM9 takes the slot from the ARM7, which melonDS's direct start gives it, and turns it on. Each frame, as the
// V-blank starts, it reads the cartridge one of four ways in turn: 0x200 bytes with the command B7 from a place that
// moves each frame and sometimes runs past the end of a page of 0x1000 bytes, which the cartridge reads round again; 4
// bytes from a place that isn't a word's; the chip's number with B8; and 0x200 bytes from below 0x8000, which a
// cartridge gives from 0x8000 instead, at the slot's slower speed every other pair of frames. It waits for each word,
// adds them up and mixes them, and counts the transfers' end with the flag of its interrupt, which it clears. Engine
// A's backdrop shows the sum, and engine B's on even frames the mix and on odd ones the sum's high bits and the count.
//
// The cartridge has a pattern of bytes of its own everywhere its programs aren't, so every read has something to read.

import { createHash } from 'node:crypto';
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
	@ the slot, from the ARM7, and on, with its interrupt
	ldr r0, .Lexmemcnt
	ldrh r1, [r0]
	ldr r2, .Lslot_bit
	bic r1, r2
	strh r1, [r0]
	ldr r0, .Lauxspicnt
	ldr r1, .Lslot_on
	strh r1, [r0]
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
	@ which way: its place, its command and its size
	mov r0, #3
	and r0, r7
	lsl r0, r0, #3
	ldr r1, .Lways_at
	add r1, r0
	ldr r2, [r1]
	ldr r3, .Lplace_mask
	mov r0, r7
	mul r0, r2
	and r0, r3
	ldr r3, [r1, #4]
	lsr r2, r3, #8
	add r0, r2
	@ the command: its first byte, then the place, highest byte first
	mov r2, #0xFF
	and r3, r2
	lsr r2, r0, #24
	lsl r2, r2, #8
	orr r3, r2
	lsr r2, r0, #16
	mov r4, #0xFF
	and r2, r4
	lsl r2, r2, #16
	orr r3, r2
	lsr r2, r0, #8
	and r2, r4
	lsl r2, r2, #24
	orr r3, r2
	and r0, r4
	ldr r5, .Lslot
	str r3, [r5, #8]
	str r0, [r5, #12]
	@ the control: start, the size, the slower speed every other pair of frames, and the gaps
	ldr r3, [r1]
	lsr r3, r3, #24
	lsl r3, r3, #24
	ldr r0, .Lcontrol
	orr r3, r0
	mov r0, #4
	tst r7, r0
	beq .Lfast
	ldr r0, .Lslow
	orr r3, r0
.Lfast:
	ldr r6, .Ldata
	ldr r0, .Lready
	mov r4, #0
	mov r1, #0
	mov r8, r1
	str r3, [r5, #4]
.Lpoll:
	ldr r3, [r5, #4]
	tst r3, r0
	beq .Lnot_ready
	ldr r1, [r6]
	add r4, r1
	mov r2, r8
	lsl r2, r2, #3
	eor r2, r1
	mov r8, r2
.Lnot_ready:
	cmp r3, #0
	blt .Lpoll
	@ the transfer's end, counted by its interrupt's flag
	ldr r0, .Lif
	ldr r1, [r0]
	ldr r2, .Lcart_flag
	and r1, r2
	str r1, [r0]
	lsr r1, r1, #19
	ldr r0, .Lcount
	ldr r2, [r0]
	add r2, r1
	str r2, [r0]
	lsl r2, r2, #10
	lsr r3, r4, #15
	eor r2, r3
	@ the backdrops
	ldr r1, .Lcolour_mask
	mov r3, r4
	and r3, r1
	ldr r0, .Lpalette_a
	strh r3, [r0]
	mov r0, #1
	tst r7, r0
	bne .Lodd
	mov r2, r8
.Lodd:
	and r2, r1
	ldr r0, .Lpalette_b
	strh r2, [r0]
	b .Lframe
	.align 2
.Lpowcnt: .word 0x04000304
.Lpowcnt_value: .word 0x8203
.Ldispcnt_a: .word 0x04000000
.Ldispcnt_b: .word 0x04001000
.Lscreen_on: .word 0x00010000
.Lif: .word 0x04000214
.Lcart_flag: .word 0x00080000
.Lcount: .word 0x02200100
.Lexmemcnt: .word 0x04000204
.Lslot_bit: .word 0x0800
.Lauxspicnt: .word 0x040001A0
.Lslot_on: .word 0xC000
.Ldispstat: .word 0x04000004
.Lslot: .word 0x040001A0
.Ldata: .word 0x04100010
.Lready: .word 0x00800000
.Lcontrol: .word 0xA0180018
.Lslow: .word 0x08000000
.Lplace_mask: .word 0x7FFF
.Lcolour_mask: .word 0x7FFF
.Lpalette_a: .word 0x05000000
.Lpalette_b: .word 0x05000400
.Lways_at: .word ways
	@ each way: how far its place moves each frame, with the size's bits on top; where it starts, above its command
ways:
	.word 0x01000264, 0x008000B7
	.word 0x07000135, 0x008000B7
	.word 0x07000000, 0x000000B8
	.word 0x01000044, 0x000000B7
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

/** The cartridge's bytes and SHA-1, with the pattern everywhere its programs and header aren't. */
export function madeUpNdsCart({ title = 'MADE UP CART', code = 'MDCE' } = {}) {
  const arm9 = programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7 = programWithNames(ARM7_PROGRAM, ARM7.address).bytes;
  const { rom } = cartridgeWith({ title, code, arm9, arm7 });
  const used = [[0, 0x200], [ARM9.offset, ARM9.offset + arm9.length], [ARM7.offset, ARM7.offset + arm7.length]];
  for (let at = 0; at < rom.length; at++) if (!used.some(([from, to]) => at >= from && at < to)) rom[at] = (at * 7 + (at >> 8) * 13) & 0xFF;
  return { rom, sha1: createHash('sha1').update(rom).digest('hex') };
}
