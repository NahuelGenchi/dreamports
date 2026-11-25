// A small Nintendo DS program with nothing from any game in it, written here, for the test of the Nintendo DS kit in C's
// shared memory, message queue and sync register (nds-kit.mjs): its two processors talk.
//
// Once a frame, as the V-blank starts, the ARM9 takes the ARM7's last reply from the queue, if one came, and shows it on
// the upper screen; shows the four bits the ARM7 left in the sync register, with its own count of frames, on the lower;
// sends its count through the queue; puts the buttons A, B, Select and Start in the sync register's bits for the ARM7;
// and takes the shared memory, all of it, to leave three times its count at 0x03007000, before giving it all back to
// the ARM7. It leaves the same at 0x03000000, which is its own fast data memory (DTCM) as the console's firmware leaves
// it for a game, so that write never reaches the shared memory under it.
// The ARM7 waits a while after the V-blank starts, so the ARM9 is done, then adds up every word in the queue and the
// four bits the ARM9 left, reads the shared memory at 0x03000000 and at 0x03007000, sends the sum and the word back, and leaves the sum's lowest four
// bits in the sync register.

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
	ldr r0, .Lfifocnt
	ldr r1, .Lfifo_on
	strh r1, [r0]
	mov r7, #0
	mov r5, #0
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
	ldr r0, .Lfifocnt
	ldrh r1, [r0]
	ldr r2, .Lreceive_empty
	tst r1, r2
	bne .Lnone
	ldr r0, .Lreceive
	ldr r5, [r0]
.Lnone:
	mov r1, r5
	ldr r2, .Lcolour_mask
	and r1, r2
	ldr r0, .Lpalette_a
	strh r1, [r0]
	ldr r0, .Lsync
	ldrh r1, [r0]
	mov r2, #15
	and r1, r2
	lsl r1, r1, #10
	mov r2, #31
	mov r3, r7
	and r3, r2
	orr r1, r3
	ldr r0, .Lpalette_b
	strh r1, [r0]
	ldr r0, .Lsend
	str r7, [r0]
	ldr r0, .Lkeyinput
	ldrh r1, [r0]
	mvn r1, r1
	mov r2, #15
	and r1, r2
	lsl r1, r1, #8
	ldr r0, .Lsync
	strh r1, [r0]
	ldr r0, .Lwramcnt
	mov r1, #0
	strb r1, [r0]
	mov r1, r7
	lsl r2, r1, #1
	add r1, r2
	ldr r0, .Ldtcm
	str r1, [r0]
	ldr r0, .Lshared
	str r1, [r0]
	ldr r0, .Lwramcnt
	mov r1, #3
	strb r1, [r0]
	b .Lframe
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
.Lcolour_mask: .word 0x7FFF
.Lsync: .word 0x04000180
.Lfifocnt: .word 0x04000184
.Lfifo_on: .word 0x8008
.Lreceive_empty: .word 0x0100
.Lsend: .word 0x04000188
.Lreceive: .word 0x04100000
.Lwramcnt: .word 0x04000247
.Ldtcm: .word 0x03000000
.Lshared: .word 0x03007000
`;

const ARM7_PROGRAM = `
	.text
	.code 16
	.thumb_func
main:
	ldr r0, .Lfifocnt
	ldr r1, .Lfifo_on
	strh r1, [r0]
	mov r4, #0
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
	ldr r0, .Lfifocnt
	ldr r2, .Lreceive_empty
.Ldrain:
	ldrh r1, [r0]
	tst r1, r2
	bne .Ldrained
	ldr r3, .Lreceive
	ldr r3, [r3]
	add r4, r3
	b .Ldrain
.Ldrained:
	ldr r0, .Lsync
	ldrh r1, [r0]
	mov r2, #15
	and r1, r2
	add r4, r1
	ldr r0, .Lshared
	ldr r6, [r0]
	ldr r0, .Lunder_dtcm
	ldr r3, [r0]
	add r6, r3
	add r1, r4, r6
	ldr r0, .Lsend
	str r1, [r0]
	mov r1, r4
	mov r2, #15
	and r1, r2
	lsl r1, r1, #8
	ldr r0, .Lsync
	strh r1, [r0]
	b .Lframe
	.align 2
.Ldispstat: .word 0x04000004
.Lwait: .word 1000
.Lsync: .word 0x04000180
.Lfifocnt: .word 0x04000184
.Lfifo_on: .word 0x8008
.Lreceive_empty: .word 0x0100
.Lsend: .word 0x04000188
.Lreceive: .word 0x04100000
.Lunder_dtcm: .word 0x03000000
.Lshared: .word 0x03007000
`;

/** The cartridge's bytes and SHA-1. */
export function madeUpNdsIpc({ title = 'MADE UP IPC', code = 'MDIE' } = {}) {
  return cartridgeWith({ title, code, arm9: programWithNames(ARM9_PROGRAM, ARM9.address).bytes, arm7: programWithNames(ARM7_PROGRAM, ARM7.address).bytes });
}
