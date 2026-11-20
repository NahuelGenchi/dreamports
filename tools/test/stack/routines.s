@ A routine of the made-up program written by hand in assembly, as a library's table keeps one (tools/README.md, The
@ console's stack), for npm run test:stack: the cartridge has these bytes for Hand, at 0x08000700, and the Dreamport its
@ twin in leftovers.c. Hand saves three of its caller's registers and a high one through a low one, keeps a number and
@ its parameter on its frame, and calls Inner from there.
	.syntax unified
	.equ KEPT, 7

	.text
	.align 2, 0
	.thumb
	.thumb_func
	.type Hand, function
@ dp:args r0=out
Hand:
	push {r4-r6, lr}
	mov r4, r8
	push {r4}
	sub sp, 8
	movs r5, KEPT
	str r5, [sp]
	str r0, [sp, 4]
	bl Inner @ dp:call Inner
	ldr r1, [sp, 4]
	movs r2, KEPT
	str r2, [r1]
	add sp, 8
	pop {r4}
	mov r8, r4
	pop {r4-r6}
	pop {r0}
	bx r0 @ dp:return
	.size Hand, .-Hand
