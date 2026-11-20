@ The kit's clock's test (../clock.mjs): a made-up program's power-on, with nothing from any game in it, that keeps the
@ console busy across its first frames' ends as a game's power-on does: the cartridge's wait states and prefetch set,
@ the sound's FIFO fed by DMA 1 at timer 0's rate, a long DMA fill of video memory, a loop of multiplies and stores
@ to the slow work memory, and each of the BIOS's four kinds of CpuSet, then a loop that waits for nothing, long
@ enough for the test to leave a frame of it untimed. After it come the interrupts: a handler of the program's own,
@ which the BIOS reaches through an ARM instruction or two the test puts in the cartridge (../clock.mjs); the
@ V-blank's interrupt taken out of the BIOS's VBlankIntrWait; timer 1's every 4,096 cycles, taken in the middle of a
@ loop of multiplies and stores, out of another VBlankIntrWait and out of an IntrWait for it; and both, with every
@ line's H-blank's and line 100's, for as long as the last loop goes on.
	.text
	.code 16
	.thumb_func
	.type main, function
main:
	ldr r0, .Lwaitcnt
	ldr r1, .Lwaitcnt_value
	strh r1, [r0]
	ldr r0, .Lsoundcnt_x
	mov r1, #128
	strh r1, [r0]
	ldr r0, .Lsoundcnt_h
	ldr r1, .Lsoundcnt_h_value
	strh r1, [r0]
	ldr r0, .Ldma1
	ldr r1, .Lsamples
	str r1, [r0]
	ldr r1, .Lfifo_a
	str r1, [r0, #4]
	ldr r1, .Ldma1_control
	str r1, [r0, #8]
	ldr r0, .Ltimer0
	ldr r1, .Ltimer0_value
	str r1, [r0]
	ldr r0, .Ldma3
	ldr r1, .Lfilled
	str r1, [r0]
	ldr r1, .Lvram
	str r1, [r0, #4]
	ldr r1, .Ldma3_control
	str r1, [r0, #8]
	ldr r2, .Lsquares
	mov r3, #0
	ldr r4, .Lcount
.Lsquare:
	mov r0, r3
	mul r0, r3
	strh r0, [r2]
	add r2, #2
	add r3, #1
	cmp r3, r4
	blt .Lsquare
	ldr r0, .Lfilled
	ldr r1, .Lwords
	ldr r2, .Lfill_words
	swi 11
	ldr r0, .Lfilled
	ldr r1, .Lhalfwords
	ldr r2, .Lfill_halfwords
	swi 11
	ldr r0, .Lwords
	ldr r1, .Lwords_copy
	ldr r2, .Lcopy_words
	swi 11
	ldr r0, .Lwords_copy
	ldr r1, .Lhalfwords_copy
	ldr r2, .Lcopy_halfwords
	swi 11
	ldr r0, .Lidle
.Lwait:
	sub r0, #1
	bne .Lwait
	ldr r0, .Lhandler_at
	ldr r1, .Lhandler
	str r1, [r0]
	ldr r0, .Ldispstat
	mov r1, #8
	strh r1, [r0]
	ldr r0, .Lie
	mov r1, #17
	strh r1, [r0]
	ldr r0, .Lime
	mov r1, #1
	strh r1, [r0]
	swi 5
	ldr r0, .Ltimer1
	ldr r1, .Ltimer1_value
	str r1, [r0]
	ldr r2, .Lsquares
	mov r3, #0
	ldr r4, .Lcount
.Lsquare_again:
	mov r0, r3
	mul r0, r3
	strh r0, [r2]
	add r2, #2
	add r3, #1
	cmp r3, r4
	blt .Lsquare_again
	swi 5
	mov r0, #1
	mov r1, #16
	swi 4
	ldr r0, .Ldispstat
	ldr r1, .Ldispstat_all
	strh r1, [r0]
	ldr r0, .Lie
	mov r1, #23
	strh r1, [r0]
.Lend:
	b .Lend
	.thumb_func
	.type interrupt, function
interrupt:
	ldr r0, .Lif
	ldrh r1, [r0]
	strh r1, [r0]
	ldr r0, .Lcheck
	ldrh r2, [r0]
	orr r2, r1
	strh r2, [r0]
	bx lr
	.align 2
.Lidle: .word 120000
.Lhandler_at: .word 0x03007FFC
.Lhandler: .word 0x080000CC
.Ldispstat: .word 0x04000004
.Ldispstat_all: .word 0x6438
.Lie: .word 0x04000200
.Lime: .word 0x04000208
.Ltimer1: .word 0x04000104
.Ltimer1_value: .word 0x00C0F000
.Lif: .word 0x04000202
.Lcheck: .word 0x03007FF8
.Lwaitcnt: .word 0x04000204
.Lwaitcnt_value: .word 0x4014
.Lsoundcnt_x: .word 0x04000084
.Lsoundcnt_h: .word 0x04000082
.Lsoundcnt_h_value: .word 0x0B04
.Ldma1: .word 0x040000BC
.Lsamples: .word 0x02000000
.Lfifo_a: .word 0x040000A0
.Ldma1_control: .word 0xB6000004
.Ltimer0: .word 0x04000100
.Ltimer0_value: .word 0x0080FF00
.Ldma3: .word 0x040000D4
.Lfilled: .word 0x03000000
.Lvram: .word 0x06000000
.Ldma3_control: .word 0x85006000
.Lsquares: .word 0x02020000
.Lcount: .word 3000
.Lwords: .word 0x02010000
.Lfill_words: .word 0x05006000
.Lhalfwords: .word 0x02030000
.Lfill_halfwords: .word 0x01006000
.Lwords_copy: .word 0x02028000
.Lcopy_words: .word 0x04002000
.Lhalfwords_copy: .word 0x02038000
.Lcopy_halfwords: .word 0x00002000
