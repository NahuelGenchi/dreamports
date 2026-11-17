@ Every form of every Thumb instruction the console's compiler can write, and the directives it writes, for the test of
@ the tools' own assembler (../match.test.mjs). forms.hex is what clang 21 made of the same lines, written the newer way,
@ with each place a linker fills in left as zeros.
	.code	16
.text
	.align	2, 0
start:
	lsl r0, r0, #0
	lsl r0, r0, #1
	lsl r0, r0, #7
	lsl r0, r0, #31
	lsr r0, r0, #1
	asr r0, r0, #0x1
	lsr r0, r0, #7
	asr r0, r0, #0x7
	lsr r0, r0, #32
	asr r0, r0, #0x20
	add r0, r0, r0
	sub r0, r0, r0
	add r0, r0, r3
	sub r0, r0, r3
	add r0, r0, r7
	sub r0, r0, r7
	mov r0, r0
	add r0, r0, #0
	and r0, r0
	and r0, r0, r0
	eor r0, r0
	eor r0, r0, r0
	adc r0, r0
	adc r0, r0, r0
	sbc r0, r0
	sbc r0, r0, r0
	ror r0, r0
	ror r0, r0, r0
	orr r0, r0
	orr r0, r0, r0
	bic r0, r0
	bic r0, r0, r0
	lsl r0, r0
	lsl r0, r0, r0
	lsr r0, r0
	lsr r0, r0, r0
	asr r0, r0
	asr r0, r0, r0
	tst r0, r0
	cmp r0, r0
	cmn r0, r0
	neg r0, r0
	mvn r0, r0
	mul r0, r0
	mul r0, r0, r0
	mul r0, r0, r0
	str r0, [r0]
	str r0, [r0, #0x0]
	str r0, [r0, #0x4]
	str r0, [r0, #0x7c]
	ldr r0, [r0]
	ldr r0, [r0, #0x0]
	ldr r0, [r0, #0x4]
	ldr r0, [r0, #0x7c]
	strb r0, [r0]
	strb r0, [r0, #0x0]
	strb r0, [r0, #0x1]
	strb r0, [r0, #0x1f]
	ldrb r0, [r0]
	ldrb r0, [r0, #0x0]
	ldrb r0, [r0, #0x1]
	ldrb r0, [r0, #0x1f]
	strh r0, [r0]
	strh r0, [r0, #0x0]
	strh r0, [r0, #0x2]
	strh r0, [r0, #0x3e]
	ldrh r0, [r0]
	ldrh r0, [r0, #0x0]
	ldrh r0, [r0, #0x2]
	ldrh r0, [r0, #0x3e]
	str r0, [r0, r0]
	strh r0, [r0, r0]
	strb r0, [r0, r0]
	ldrsb r0, [r0, r0]
	ldr r0, [r0, r0]
	ldrh r0, [r0, r0]
	ldrb r0, [r0, r0]
	ldrsh r0, [r0, r0]
	str r0, [r0, r3]
	strh r0, [r0, r3]
	strb r0, [r0, r3]
	ldrsb r0, [r0, r3]
	ldr r0, [r0, r3]
	ldrh r0, [r0, r3]
	ldrb r0, [r0, r3]
	ldrsh r0, [r0, r3]
	str r0, [r0, r7]
	strh r0, [r0, r7]
	strb r0, [r0, r7]
	ldrsb r0, [r0, r7]
	ldr r0, [r0, r7]
	ldrh r0, [r0, r7]
	ldrb r0, [r0, r7]
	ldrsh r0, [r0, r7]
	ldsb r0, [r0, r0]
	ldsh r0, [r0, r0]
	ldsb r0, [r0, r3]
	ldsh r0, [r0, r3]
	ldsb r0, [r0, r7]
	ldsh r0, [r0, r7]
	lsl r0, r3, #0
	lsl r0, r3, #1
	lsl r0, r3, #7
	lsl r0, r3, #31
	lsr r0, r3, #1
	asr r0, r3, #0x1
	lsr r0, r3, #7
	asr r0, r3, #0x7
	lsr r0, r3, #32
	asr r0, r3, #0x20
	add r0, r3, r0
	sub r0, r3, r0
	add r0, r3, r3
	sub r0, r3, r3
	add r0, r3, r7
	sub r0, r3, r7
	add r0, r3, #0
	sub r0, r3, #0
	add r0, r3, #1
	sub r0, r3, #1
	add r0, r3, #7
	sub r0, r3, #7
	mov r0, r3
	add r0, r3, #0
	and r0, r3
	and r0, r0, r3
	eor r0, r3
	eor r0, r0, r3
	adc r0, r3
	adc r0, r0, r3
	sbc r0, r3
	sbc r0, r0, r3
	ror r0, r3
	ror r0, r0, r3
	orr r0, r3
	orr r0, r0, r3
	bic r0, r3
	bic r0, r0, r3
	lsl r0, r3
	lsl r0, r0, r3
	lsr r0, r3
	lsr r0, r0, r3
	asr r0, r3
	asr r0, r0, r3
	tst r0, r3
	cmp r0, r3
	cmn r0, r3
	neg r0, r3
	mvn r0, r3
	mul r0, r3
	mul r0, r0, r3
	mul r0, r3, r0
	str r0, [r3]
	str r0, [r3, #0x0]
	str r0, [r3, #0x4]
	str r0, [r3, #0x7c]
	ldr r0, [r3]
	ldr r0, [r3, #0x0]
	ldr r0, [r3, #0x4]
	ldr r0, [r3, #0x7c]
	strb r0, [r3]
	strb r0, [r3, #0x0]
	strb r0, [r3, #0x1]
	strb r0, [r3, #0x1f]
	ldrb r0, [r3]
	ldrb r0, [r3, #0x0]
	ldrb r0, [r3, #0x1]
	ldrb r0, [r3, #0x1f]
	strh r0, [r3]
	strh r0, [r3, #0x0]
	strh r0, [r3, #0x2]
	strh r0, [r3, #0x3e]
	ldrh r0, [r3]
	ldrh r0, [r3, #0x0]
	ldrh r0, [r3, #0x2]
	ldrh r0, [r3, #0x3e]
	str r0, [r3, r0]
	strh r0, [r3, r0]
	strb r0, [r3, r0]
	ldrsb r0, [r3, r0]
	ldr r0, [r3, r0]
	ldrh r0, [r3, r0]
	ldrb r0, [r3, r0]
	ldrsh r0, [r3, r0]
	str r0, [r3, r3]
	strh r0, [r3, r3]
	strb r0, [r3, r3]
	ldrsb r0, [r3, r3]
	ldr r0, [r3, r3]
	ldrh r0, [r3, r3]
	ldrb r0, [r3, r3]
	ldrsh r0, [r3, r3]
	str r0, [r3, r7]
	strh r0, [r3, r7]
	strb r0, [r3, r7]
	ldrsb r0, [r3, r7]
	ldr r0, [r3, r7]
	ldrh r0, [r3, r7]
	ldrb r0, [r3, r7]
	ldrsh r0, [r3, r7]
	ldsb r0, [r3, r0]
	ldsh r0, [r3, r0]
	ldsb r0, [r3, r3]
	ldsh r0, [r3, r3]
	ldsb r0, [r3, r7]
	ldsh r0, [r3, r7]
	lsl r0, r7, #0
	lsl r0, r7, #1
	lsl r0, r7, #7
	lsl r0, r7, #31
	lsr r0, r7, #1
	asr r0, r7, #0x1
	lsr r0, r7, #7
	asr r0, r7, #0x7
	lsr r0, r7, #32
	asr r0, r7, #0x20
	add r0, r7, r0
	sub r0, r7, r0
	add r0, r7, r3
	sub r0, r7, r3
	add r0, r7, r7
	sub r0, r7, r7
	add r0, r7, #0
	sub r0, r7, #0
	add r0, r7, #1
	sub r0, r7, #1
	add r0, r7, #7
	sub r0, r7, #7
	mov r0, r7
	add r0, r7, #0
	and r0, r7
	and r0, r0, r7
	eor r0, r7
	eor r0, r0, r7
	adc r0, r7
	adc r0, r0, r7
	sbc r0, r7
	sbc r0, r0, r7
	ror r0, r7
	ror r0, r0, r7
	orr r0, r7
	orr r0, r0, r7
	bic r0, r7
	bic r0, r0, r7
	lsl r0, r7
	lsl r0, r0, r7
	lsr r0, r7
	lsr r0, r0, r7
	asr r0, r7
	asr r0, r0, r7
	tst r0, r7
	cmp r0, r7
	cmn r0, r7
	neg r0, r7
	mvn r0, r7
	mul r0, r7
	mul r0, r0, r7
	mul r0, r7, r0
	str r0, [r7]
	str r0, [r7, #0x0]
	str r0, [r7, #0x4]
	str r0, [r7, #0x7c]
	ldr r0, [r7]
	ldr r0, [r7, #0x0]
	ldr r0, [r7, #0x4]
	ldr r0, [r7, #0x7c]
	strb r0, [r7]
	strb r0, [r7, #0x0]
	strb r0, [r7, #0x1]
	strb r0, [r7, #0x1f]
	ldrb r0, [r7]
	ldrb r0, [r7, #0x0]
	ldrb r0, [r7, #0x1]
	ldrb r0, [r7, #0x1f]
	strh r0, [r7]
	strh r0, [r7, #0x0]
	strh r0, [r7, #0x2]
	strh r0, [r7, #0x3e]
	ldrh r0, [r7]
	ldrh r0, [r7, #0x0]
	ldrh r0, [r7, #0x2]
	ldrh r0, [r7, #0x3e]
	str r0, [r7, r0]
	strh r0, [r7, r0]
	strb r0, [r7, r0]
	ldrsb r0, [r7, r0]
	ldr r0, [r7, r0]
	ldrh r0, [r7, r0]
	ldrb r0, [r7, r0]
	ldrsh r0, [r7, r0]
	str r0, [r7, r3]
	strh r0, [r7, r3]
	strb r0, [r7, r3]
	ldrsb r0, [r7, r3]
	ldr r0, [r7, r3]
	ldrh r0, [r7, r3]
	ldrb r0, [r7, r3]
	ldrsh r0, [r7, r3]
	str r0, [r7, r7]
	strh r0, [r7, r7]
	strb r0, [r7, r7]
	ldrsb r0, [r7, r7]
	ldr r0, [r7, r7]
	ldrh r0, [r7, r7]
	ldrb r0, [r7, r7]
	ldrsh r0, [r7, r7]
	ldsb r0, [r7, r0]
	ldsh r0, [r7, r0]
	ldsb r0, [r7, r3]
	ldsh r0, [r7, r3]
	ldsb r0, [r7, r7]
	ldsh r0, [r7, r7]
	lsl r3, r0, #0
	lsl r3, r0, #1
	lsl r3, r0, #7
	lsl r3, r0, #31
	lsr r3, r0, #1
	asr r3, r0, #0x1
	lsr r3, r0, #7
	asr r3, r0, #0x7
	lsr r3, r0, #32
	asr r3, r0, #0x20
	add r3, r0, r0
	sub r3, r0, r0
	add r3, r0, r3
	sub r3, r0, r3
	add r3, r0, r7
	sub r3, r0, r7
	add r3, r0, #0
	sub r3, r0, #0
	add r3, r0, #1
	sub r3, r0, #1
	add r3, r0, #7
	sub r3, r0, #7
	mov r3, r0
	add r3, r0, #0
	and r3, r0
	and r3, r3, r0
	eor r3, r0
	eor r3, r3, r0
	adc r3, r0
	adc r3, r3, r0
	sbc r3, r0
	sbc r3, r3, r0
	ror r3, r0
	ror r3, r3, r0
	orr r3, r0
	orr r3, r3, r0
	bic r3, r0
	bic r3, r3, r0
	lsl r3, r0
	lsl r3, r3, r0
	lsr r3, r0
	lsr r3, r3, r0
	asr r3, r0
	asr r3, r3, r0
	tst r3, r0
	cmp r3, r0
	cmn r3, r0
	neg r3, r0
	mvn r3, r0
	mul r3, r0
	mul r3, r3, r0
	mul r3, r0, r3
	str r3, [r0]
	str r3, [r0, #0x0]
	str r3, [r0, #0x4]
	str r3, [r0, #0x7c]
	ldr r3, [r0]
	ldr r3, [r0, #0x0]
	ldr r3, [r0, #0x4]
	ldr r3, [r0, #0x7c]
	strb r3, [r0]
	strb r3, [r0, #0x0]
	strb r3, [r0, #0x1]
	strb r3, [r0, #0x1f]
	ldrb r3, [r0]
	ldrb r3, [r0, #0x0]
	ldrb r3, [r0, #0x1]
	ldrb r3, [r0, #0x1f]
	strh r3, [r0]
	strh r3, [r0, #0x0]
	strh r3, [r0, #0x2]
	strh r3, [r0, #0x3e]
	ldrh r3, [r0]
	ldrh r3, [r0, #0x0]
	ldrh r3, [r0, #0x2]
	ldrh r3, [r0, #0x3e]
	str r3, [r0, r0]
	strh r3, [r0, r0]
	strb r3, [r0, r0]
	ldrsb r3, [r0, r0]
	ldr r3, [r0, r0]
	ldrh r3, [r0, r0]
	ldrb r3, [r0, r0]
	ldrsh r3, [r0, r0]
	str r3, [r0, r3]
	strh r3, [r0, r3]
	strb r3, [r0, r3]
	ldrsb r3, [r0, r3]
	ldr r3, [r0, r3]
	ldrh r3, [r0, r3]
	ldrb r3, [r0, r3]
	ldrsh r3, [r0, r3]
	str r3, [r0, r7]
	strh r3, [r0, r7]
	strb r3, [r0, r7]
	ldrsb r3, [r0, r7]
	ldr r3, [r0, r7]
	ldrh r3, [r0, r7]
	ldrb r3, [r0, r7]
	ldrsh r3, [r0, r7]
	ldsb r3, [r0, r0]
	ldsh r3, [r0, r0]
	ldsb r3, [r0, r3]
	ldsh r3, [r0, r3]
	ldsb r3, [r0, r7]
	ldsh r3, [r0, r7]
	lsl r3, r3, #0
	lsl r3, r3, #1
	lsl r3, r3, #7
	lsl r3, r3, #31
	lsr r3, r3, #1
	asr r3, r3, #0x1
	lsr r3, r3, #7
	asr r3, r3, #0x7
	lsr r3, r3, #32
	asr r3, r3, #0x20
	add r3, r3, r0
	sub r3, r3, r0
	add r3, r3, r3
	sub r3, r3, r3
	add r3, r3, r7
	sub r3, r3, r7
	mov r3, r3
	add r3, r3, #0
	and r3, r3
	and r3, r3, r3
	eor r3, r3
	eor r3, r3, r3
	adc r3, r3
	adc r3, r3, r3
	sbc r3, r3
	sbc r3, r3, r3
	ror r3, r3
	ror r3, r3, r3
	orr r3, r3
	orr r3, r3, r3
	bic r3, r3
	bic r3, r3, r3
	lsl r3, r3
	lsl r3, r3, r3
	lsr r3, r3
	lsr r3, r3, r3
	asr r3, r3
	asr r3, r3, r3
	tst r3, r3
	cmp r3, r3
	cmn r3, r3
	neg r3, r3
	mvn r3, r3
	mul r3, r3
	mul r3, r3, r3
	mul r3, r3, r3
	str r3, [r3]
	str r3, [r3, #0x0]
	str r3, [r3, #0x4]
	str r3, [r3, #0x7c]
	ldr r3, [r3]
	ldr r3, [r3, #0x0]
	ldr r3, [r3, #0x4]
	ldr r3, [r3, #0x7c]
	strb r3, [r3]
	strb r3, [r3, #0x0]
	strb r3, [r3, #0x1]
	strb r3, [r3, #0x1f]
	ldrb r3, [r3]
	ldrb r3, [r3, #0x0]
	ldrb r3, [r3, #0x1]
	ldrb r3, [r3, #0x1f]
	strh r3, [r3]
	strh r3, [r3, #0x0]
	strh r3, [r3, #0x2]
	strh r3, [r3, #0x3e]
	ldrh r3, [r3]
	ldrh r3, [r3, #0x0]
	ldrh r3, [r3, #0x2]
	ldrh r3, [r3, #0x3e]
	str r3, [r3, r0]
	strh r3, [r3, r0]
	strb r3, [r3, r0]
	ldrsb r3, [r3, r0]
	ldr r3, [r3, r0]
	ldrh r3, [r3, r0]
	ldrb r3, [r3, r0]
	ldrsh r3, [r3, r0]
	str r3, [r3, r3]
	strh r3, [r3, r3]
	strb r3, [r3, r3]
	ldrsb r3, [r3, r3]
	ldr r3, [r3, r3]
	ldrh r3, [r3, r3]
	ldrb r3, [r3, r3]
	ldrsh r3, [r3, r3]
	str r3, [r3, r7]
	strh r3, [r3, r7]
	strb r3, [r3, r7]
	ldrsb r3, [r3, r7]
	ldr r3, [r3, r7]
	ldrh r3, [r3, r7]
	ldrb r3, [r3, r7]
	ldrsh r3, [r3, r7]
	ldsb r3, [r3, r0]
	ldsh r3, [r3, r0]
	ldsb r3, [r3, r3]
	ldsh r3, [r3, r3]
	ldsb r3, [r3, r7]
	ldsh r3, [r3, r7]
	lsl r3, r7, #0
	lsl r3, r7, #1
	lsl r3, r7, #7
	lsl r3, r7, #31
	lsr r3, r7, #1
	asr r3, r7, #0x1
	lsr r3, r7, #7
	asr r3, r7, #0x7
	lsr r3, r7, #32
	asr r3, r7, #0x20
	add r3, r7, r0
	sub r3, r7, r0
	add r3, r7, r3
	sub r3, r7, r3
	add r3, r7, r7
	sub r3, r7, r7
	add r3, r7, #0
	sub r3, r7, #0
	add r3, r7, #1
	sub r3, r7, #1
	add r3, r7, #7
	sub r3, r7, #7
	mov r3, r7
	add r3, r7, #0
	and r3, r7
	and r3, r3, r7
	eor r3, r7
	eor r3, r3, r7
	adc r3, r7
	adc r3, r3, r7
	sbc r3, r7
	sbc r3, r3, r7
	ror r3, r7
	ror r3, r3, r7
	orr r3, r7
	orr r3, r3, r7
	bic r3, r7
	bic r3, r3, r7
	lsl r3, r7
	lsl r3, r3, r7
	lsr r3, r7
	lsr r3, r3, r7
	asr r3, r7
	asr r3, r3, r7
	tst r3, r7
	cmp r3, r7
	cmn r3, r7
	neg r3, r7
	mvn r3, r7
	mul r3, r7
	mul r3, r3, r7
	mul r3, r7, r3
	str r3, [r7]
	str r3, [r7, #0x0]
	str r3, [r7, #0x4]
	str r3, [r7, #0x7c]
	ldr r3, [r7]
	ldr r3, [r7, #0x0]
	ldr r3, [r7, #0x4]
	ldr r3, [r7, #0x7c]
	strb r3, [r7]
	strb r3, [r7, #0x0]
	strb r3, [r7, #0x1]
	strb r3, [r7, #0x1f]
	ldrb r3, [r7]
	ldrb r3, [r7, #0x0]
	ldrb r3, [r7, #0x1]
	ldrb r3, [r7, #0x1f]
	strh r3, [r7]
	strh r3, [r7, #0x0]
	strh r3, [r7, #0x2]
	strh r3, [r7, #0x3e]
	ldrh r3, [r7]
	ldrh r3, [r7, #0x0]
	ldrh r3, [r7, #0x2]
	ldrh r3, [r7, #0x3e]
	str r3, [r7, r0]
	strh r3, [r7, r0]
	strb r3, [r7, r0]
	ldrsb r3, [r7, r0]
	ldr r3, [r7, r0]
	ldrh r3, [r7, r0]
	ldrb r3, [r7, r0]
	ldrsh r3, [r7, r0]
	str r3, [r7, r3]
	strh r3, [r7, r3]
	strb r3, [r7, r3]
	ldrsb r3, [r7, r3]
	ldr r3, [r7, r3]
	ldrh r3, [r7, r3]
	ldrb r3, [r7, r3]
	ldrsh r3, [r7, r3]
	str r3, [r7, r7]
	strh r3, [r7, r7]
	strb r3, [r7, r7]
	ldrsb r3, [r7, r7]
	ldr r3, [r7, r7]
	ldrh r3, [r7, r7]
	ldrb r3, [r7, r7]
	ldrsh r3, [r7, r7]
	ldsb r3, [r7, r0]
	ldsh r3, [r7, r0]
	ldsb r3, [r7, r3]
	ldsh r3, [r7, r3]
	ldsb r3, [r7, r7]
	ldsh r3, [r7, r7]
	lsl r7, r0, #0
	lsl r7, r0, #1
	lsl r7, r0, #7
	lsl r7, r0, #31
	lsr r7, r0, #1
	asr r7, r0, #0x1
	lsr r7, r0, #7
	asr r7, r0, #0x7
	lsr r7, r0, #32
	asr r7, r0, #0x20
	add r7, r0, r0
	sub r7, r0, r0
	add r7, r0, r3
	sub r7, r0, r3
	add r7, r0, r7
	sub r7, r0, r7
	add r7, r0, #0
	sub r7, r0, #0
	add r7, r0, #1
	sub r7, r0, #1
	add r7, r0, #7
	sub r7, r0, #7
	mov r7, r0
	add r7, r0, #0
	and r7, r0
	and r7, r7, r0
	eor r7, r0
	eor r7, r7, r0
	adc r7, r0
	adc r7, r7, r0
	sbc r7, r0
	sbc r7, r7, r0
	ror r7, r0
	ror r7, r7, r0
	orr r7, r0
	orr r7, r7, r0
	bic r7, r0
	bic r7, r7, r0
	lsl r7, r0
	lsl r7, r7, r0
	lsr r7, r0
	lsr r7, r7, r0
	asr r7, r0
	asr r7, r7, r0
	tst r7, r0
	cmp r7, r0
	cmn r7, r0
	neg r7, r0
	mvn r7, r0
	mul r7, r0
	mul r7, r7, r0
	mul r7, r0, r7
	str r7, [r0]
	str r7, [r0, #0x0]
	str r7, [r0, #0x4]
	str r7, [r0, #0x7c]
	ldr r7, [r0]
	ldr r7, [r0, #0x0]
	ldr r7, [r0, #0x4]
	ldr r7, [r0, #0x7c]
	strb r7, [r0]
	strb r7, [r0, #0x0]
	strb r7, [r0, #0x1]
	strb r7, [r0, #0x1f]
	ldrb r7, [r0]
	ldrb r7, [r0, #0x0]
	ldrb r7, [r0, #0x1]
	ldrb r7, [r0, #0x1f]
	strh r7, [r0]
	strh r7, [r0, #0x0]
	strh r7, [r0, #0x2]
	strh r7, [r0, #0x3e]
	ldrh r7, [r0]
	ldrh r7, [r0, #0x0]
	ldrh r7, [r0, #0x2]
	ldrh r7, [r0, #0x3e]
	str r7, [r0, r0]
	strh r7, [r0, r0]
	strb r7, [r0, r0]
	ldrsb r7, [r0, r0]
	ldr r7, [r0, r0]
	ldrh r7, [r0, r0]
	ldrb r7, [r0, r0]
	ldrsh r7, [r0, r0]
	str r7, [r0, r3]
	strh r7, [r0, r3]
	strb r7, [r0, r3]
	ldrsb r7, [r0, r3]
	ldr r7, [r0, r3]
	ldrh r7, [r0, r3]
	ldrb r7, [r0, r3]
	ldrsh r7, [r0, r3]
	str r7, [r0, r7]
	strh r7, [r0, r7]
	strb r7, [r0, r7]
	ldrsb r7, [r0, r7]
	ldr r7, [r0, r7]
	ldrh r7, [r0, r7]
	ldrb r7, [r0, r7]
	ldrsh r7, [r0, r7]
	ldsb r7, [r0, r0]
	ldsh r7, [r0, r0]
	ldsb r7, [r0, r3]
	ldsh r7, [r0, r3]
	ldsb r7, [r0, r7]
	ldsh r7, [r0, r7]
	lsl r7, r3, #0
	lsl r7, r3, #1
	lsl r7, r3, #7
	lsl r7, r3, #31
	lsr r7, r3, #1
	asr r7, r3, #0x1
	lsr r7, r3, #7
	asr r7, r3, #0x7
	lsr r7, r3, #32
	asr r7, r3, #0x20
	add r7, r3, r0
	sub r7, r3, r0
	add r7, r3, r3
	sub r7, r3, r3
	add r7, r3, r7
	sub r7, r3, r7
	add r7, r3, #0
	sub r7, r3, #0
	add r7, r3, #1
	sub r7, r3, #1
	add r7, r3, #7
	sub r7, r3, #7
	mov r7, r3
	add r7, r3, #0
	and r7, r3
	and r7, r7, r3
	eor r7, r3
	eor r7, r7, r3
	adc r7, r3
	adc r7, r7, r3
	sbc r7, r3
	sbc r7, r7, r3
	ror r7, r3
	ror r7, r7, r3
	orr r7, r3
	orr r7, r7, r3
	bic r7, r3
	bic r7, r7, r3
	lsl r7, r3
	lsl r7, r7, r3
	lsr r7, r3
	lsr r7, r7, r3
	asr r7, r3
	asr r7, r7, r3
	tst r7, r3
	cmp r7, r3
	cmn r7, r3
	neg r7, r3
	mvn r7, r3
	mul r7, r3
	mul r7, r7, r3
	mul r7, r3, r7
	str r7, [r3]
	str r7, [r3, #0x0]
	str r7, [r3, #0x4]
	str r7, [r3, #0x7c]
	ldr r7, [r3]
	ldr r7, [r3, #0x0]
	ldr r7, [r3, #0x4]
	ldr r7, [r3, #0x7c]
	strb r7, [r3]
	strb r7, [r3, #0x0]
	strb r7, [r3, #0x1]
	strb r7, [r3, #0x1f]
	ldrb r7, [r3]
	ldrb r7, [r3, #0x0]
	ldrb r7, [r3, #0x1]
	ldrb r7, [r3, #0x1f]
	strh r7, [r3]
	strh r7, [r3, #0x0]
	strh r7, [r3, #0x2]
	strh r7, [r3, #0x3e]
	ldrh r7, [r3]
	ldrh r7, [r3, #0x0]
	ldrh r7, [r3, #0x2]
	ldrh r7, [r3, #0x3e]
	str r7, [r3, r0]
	strh r7, [r3, r0]
	strb r7, [r3, r0]
	ldrsb r7, [r3, r0]
	ldr r7, [r3, r0]
	ldrh r7, [r3, r0]
	ldrb r7, [r3, r0]
	ldrsh r7, [r3, r0]
	str r7, [r3, r3]
	strh r7, [r3, r3]
	strb r7, [r3, r3]
	ldrsb r7, [r3, r3]
	ldr r7, [r3, r3]
	ldrh r7, [r3, r3]
	ldrb r7, [r3, r3]
	ldrsh r7, [r3, r3]
	str r7, [r3, r7]
	strh r7, [r3, r7]
	strb r7, [r3, r7]
	ldrsb r7, [r3, r7]
	ldr r7, [r3, r7]
	ldrh r7, [r3, r7]
	ldrb r7, [r3, r7]
	ldrsh r7, [r3, r7]
	ldsb r7, [r3, r0]
	ldsh r7, [r3, r0]
	ldsb r7, [r3, r3]
	ldsh r7, [r3, r3]
	ldsb r7, [r3, r7]
	ldsh r7, [r3, r7]
	lsl r7, r7, #0
	lsl r7, r7, #1
	lsl r7, r7, #7
	lsl r7, r7, #31
	lsr r7, r7, #1
	asr r7, r7, #0x1
	lsr r7, r7, #7
	asr r7, r7, #0x7
	lsr r7, r7, #32
	asr r7, r7, #0x20
	add r7, r7, r0
	sub r7, r7, r0
	add r7, r7, r3
	sub r7, r7, r3
	add r7, r7, r7
	sub r7, r7, r7
	mov r7, r7
	add r7, r7, #0
	and r7, r7
	and r7, r7, r7
	eor r7, r7
	eor r7, r7, r7
	adc r7, r7
	adc r7, r7, r7
	sbc r7, r7
	sbc r7, r7, r7
	ror r7, r7
	ror r7, r7, r7
	orr r7, r7
	orr r7, r7, r7
	bic r7, r7
	bic r7, r7, r7
	lsl r7, r7
	lsl r7, r7, r7
	lsr r7, r7
	lsr r7, r7, r7
	asr r7, r7
	asr r7, r7, r7
	tst r7, r7
	cmp r7, r7
	cmn r7, r7
	neg r7, r7
	mvn r7, r7
	mul r7, r7
	mul r7, r7, r7
	mul r7, r7, r7
	str r7, [r7]
	str r7, [r7, #0x0]
	str r7, [r7, #0x4]
	str r7, [r7, #0x7c]
	ldr r7, [r7]
	ldr r7, [r7, #0x0]
	ldr r7, [r7, #0x4]
	ldr r7, [r7, #0x7c]
	strb r7, [r7]
	strb r7, [r7, #0x0]
	strb r7, [r7, #0x1]
	strb r7, [r7, #0x1f]
	ldrb r7, [r7]
	ldrb r7, [r7, #0x0]
	ldrb r7, [r7, #0x1]
	ldrb r7, [r7, #0x1f]
	strh r7, [r7]
	strh r7, [r7, #0x0]
	strh r7, [r7, #0x2]
	strh r7, [r7, #0x3e]
	ldrh r7, [r7]
	ldrh r7, [r7, #0x0]
	ldrh r7, [r7, #0x2]
	ldrh r7, [r7, #0x3e]
	str r7, [r7, r0]
	strh r7, [r7, r0]
	strb r7, [r7, r0]
	ldrsb r7, [r7, r0]
	ldr r7, [r7, r0]
	ldrh r7, [r7, r0]
	ldrb r7, [r7, r0]
	ldrsh r7, [r7, r0]
	str r7, [r7, r3]
	strh r7, [r7, r3]
	strb r7, [r7, r3]
	ldrsb r7, [r7, r3]
	ldr r7, [r7, r3]
	ldrh r7, [r7, r3]
	ldrb r7, [r7, r3]
	ldrsh r7, [r7, r3]
	str r7, [r7, r7]
	strh r7, [r7, r7]
	strb r7, [r7, r7]
	ldrsb r7, [r7, r7]
	ldr r7, [r7, r7]
	ldrh r7, [r7, r7]
	ldrb r7, [r7, r7]
	ldrsh r7, [r7, r7]
	ldsb r7, [r7, r0]
	ldsh r7, [r7, r0]
	ldsb r7, [r7, r3]
	ldsh r7, [r7, r3]
	ldsb r7, [r7, r7]
	ldsh r7, [r7, r7]
	mov r0, #0x0
	cmp r0, #0
	add r0, r0, #0
	sub r0, r0, #0x0
	add r0, #0
	sub r0, #0
	mov r0, #0x1
	cmp r0, #1
	add r0, r0, #1
	sub r0, r0, #0x1
	add r0, #1
	sub r0, #1
	mov r0, #0x8
	cmp r0, #8
	add r0, r0, #8
	sub r0, r0, #0x8
	add r0, #8
	sub r0, #8
	mov r0, #0xff
	cmp r0, #255
	add r0, r0, #255
	sub r0, r0, #0xff
	add r0, #255
	sub r0, #255
	add r0, r0, #-3
	sub r0, r1, #-2
	ldr r0, [sp, #0]
	str r0, [sp, #0x0]
	add r0, sp, #0
	ldr r0, [pc, #0]
	ldr r0, [sp, #4]
	str r0, [sp, #0x4]
	add r0, sp, #4
	ldr r0, [pc, #4]
	ldr r0, [sp, #1020]
	str r0, [sp, #0x3fc]
	add r0, sp, #1020
	ldr r0, [pc, #1020]
	ldr r0, [sp]
	str r0, [sp]
	mov r8, r0
	mov r0, r8
	add r0, r8
	add r8, r0
	cmp r0, r8
	cmp r8, r0
	add r0, r0, r8
	mov r10, r0
	mov r0, r10
	add r0, r10
	add r10, r0
	cmp r0, r10
	cmp r10, r0
	add r0, r0, r10
	mov ip, r0
	mov r0, ip
	add r0, ip
	add ip, r0
	cmp r0, ip
	cmp ip, r0
	add r0, r0, ip
	mov sp, r0
	mov r0, sp
	add r0, sp
	add sp, r0
	cmp r0, sp
	cmp sp, r0
	mov lr, r0
	mov r0, lr
	add r0, lr
	add lr, r0
	cmp r0, lr
	cmp lr, r0
	add r0, r0, lr
	mov r0, pc
	add r0, pc
	cmp r0, pc
	cmp pc, r0
	bx r0
	mov pc, r0
	stmia r0!, {r1, r2}
	ldmia r0!, {r4, r5, r6}
	mov r3, #0x0
	cmp r3, #0
	add r3, r3, #0
	sub r3, r3, #0x0
	add r3, #0
	sub r3, #0
	mov r3, #0x1
	cmp r3, #1
	add r3, r3, #1
	sub r3, r3, #0x1
	add r3, #1
	sub r3, #1
	mov r3, #0x8
	cmp r3, #8
	add r3, r3, #8
	sub r3, r3, #0x8
	add r3, #8
	sub r3, #8
	mov r3, #0xff
	cmp r3, #255
	add r3, r3, #255
	sub r3, r3, #0xff
	add r3, #255
	sub r3, #255
	add r3, r3, #-3
	sub r3, r1, #-2
	ldr r3, [sp, #0]
	str r3, [sp, #0x0]
	add r3, sp, #0
	ldr r3, [pc, #0]
	ldr r3, [sp, #4]
	str r3, [sp, #0x4]
	add r3, sp, #4
	ldr r3, [pc, #4]
	ldr r3, [sp, #1020]
	str r3, [sp, #0x3fc]
	add r3, sp, #1020
	ldr r3, [pc, #1020]
	ldr r3, [sp]
	str r3, [sp]
	mov r8, r3
	mov r3, r8
	add r3, r8
	add r8, r3
	cmp r3, r8
	cmp r8, r3
	add r3, r3, r8
	mov r10, r3
	mov r3, r10
	add r3, r10
	add r10, r3
	cmp r3, r10
	cmp r10, r3
	add r3, r3, r10
	mov ip, r3
	mov r3, ip
	add r3, ip
	add ip, r3
	cmp r3, ip
	cmp ip, r3
	add r3, r3, ip
	mov sp, r3
	mov r3, sp
	add r3, sp
	add sp, r3
	cmp r3, sp
	cmp sp, r3
	mov lr, r3
	mov r3, lr
	add r3, lr
	add lr, r3
	cmp r3, lr
	cmp lr, r3
	add r3, r3, lr
	mov r3, pc
	add r3, pc
	cmp r3, pc
	cmp pc, r3
	bx r3
	mov pc, r3
	stmia r3!, {r1, r2}
	ldmia r3!, {r4, r5, r6}
	mov r7, #0x0
	cmp r7, #0
	add r7, r7, #0
	sub r7, r7, #0x0
	add r7, #0
	sub r7, #0
	mov r7, #0x1
	cmp r7, #1
	add r7, r7, #1
	sub r7, r7, #0x1
	add r7, #1
	sub r7, #1
	mov r7, #0x8
	cmp r7, #8
	add r7, r7, #8
	sub r7, r7, #0x8
	add r7, #8
	sub r7, #8
	mov r7, #0xff
	cmp r7, #255
	add r7, r7, #255
	sub r7, r7, #0xff
	add r7, #255
	sub r7, #255
	add r7, r7, #-3
	sub r7, r1, #-2
	ldr r7, [sp, #0]
	str r7, [sp, #0x0]
	add r7, sp, #0
	ldr r7, [pc, #0]
	ldr r7, [sp, #4]
	str r7, [sp, #0x4]
	add r7, sp, #4
	ldr r7, [pc, #4]
	ldr r7, [sp, #1020]
	str r7, [sp, #0x3fc]
	add r7, sp, #1020
	ldr r7, [pc, #1020]
	ldr r7, [sp]
	str r7, [sp]
	mov r8, r7
	mov r7, r8
	add r7, r8
	add r8, r7
	cmp r7, r8
	cmp r8, r7
	add r7, r7, r8
	mov r10, r7
	mov r7, r10
	add r7, r10
	add r10, r7
	cmp r7, r10
	cmp r10, r7
	add r7, r7, r10
	mov ip, r7
	mov r7, ip
	add r7, ip
	add ip, r7
	cmp r7, ip
	cmp ip, r7
	add r7, r7, ip
	mov sp, r7
	mov r7, sp
	add r7, sp
	add sp, r7
	cmp r7, sp
	cmp sp, r7
	mov lr, r7
	mov r7, lr
	add r7, lr
	add lr, r7
	cmp r7, lr
	cmp lr, r7
	add r7, r7, lr
	mov r7, pc
	add r7, pc
	cmp r7, pc
	cmp pc, r7
	bx r7
	mov pc, r7
	stmia r7!, {r1, r2}
	ldmia r7!, {r4, r5, r6}
	mov r8, r8
	mov r10, r9
	add r8, r9
	cmp r8, r9
	bx lr
	bx r12
	add sp, sp, #0
	sub sp, sp, #0
	add sp, #0
	sub sp, #0
	add sp, sp, #4
	add sp, sp, #-0x4
	sub sp, sp, #4
	add sp, #4
	sub sp, #4
	add sp, sp, #508
	add sp, sp, #-0x1fc
	sub sp, sp, #508
	add sp, #508
	sub sp, #508
	push {r0}
	push {r4, r5, lr}
	push {r4, r5, r6, r7, lr}
	push {lr}
	push {r0, r1, r2, r3}
	push {r0-r3}
	pop {r0}
	pop {r4, r5, pc}
	pop {pc}
	pop {r3, r4, r7}
	swi 0x6
	swi 255
back:
	beq	back
	beq	ahead	@cond_branch
	bne	back
	bne	ahead	@cond_branch
	bcs	back
	bcs	ahead	@cond_branch
	bhs	back
	bhs	ahead	@cond_branch
	bcc	back
	bcc	ahead	@cond_branch
	blo	back
	blo	ahead	@cond_branch
	bmi	back
	bmi	ahead	@cond_branch
	bpl	back
	bpl	ahead	@cond_branch
	bvs	back
	bvs	ahead	@cond_branch
	bvc	back
	bvc	ahead	@cond_branch
	bhi	back
	bhi	ahead	@cond_branch
	bls	back
	bls	ahead	@cond_branch
	bge	back
	bge	ahead	@cond_branch
	blt	back
	blt	ahead	@cond_branch
	bgt	back
	bgt	ahead	@cond_branch
	ble	back
	ble	ahead	@cond_branch
	b	back
	b	ahead
	bl	outer
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
	mov	r0, #0x1
ahead:
	ldr	r0, .L1
	mov	r1, #0
	ldr	r2, .L1+0x4
	ldr	r7, .L1+0x8
	ldr	r3, .L1+12
	bx	lr
.L2:
	.align	2, 0
.L1:
	.word	outer
	.word	outer+0x9ec
	.word	0x85000080
	.word	-4
	.word	back
	.word	.L2
	.short	0x1234
	.byte	0x7f
	.align	2, 0
	.ascii	"ab\0\n\"c\\\001"
	.space	3
	.align	1, 0
