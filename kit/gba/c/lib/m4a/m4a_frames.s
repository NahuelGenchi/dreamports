@ The m4a sound engine's routines the original has in hand-written assembly, whose twins in m4a_mixer.c and
@ m4a_sequencer.c are C proven by the same memory, for the console's stack (tools/README.md, The console's stack). It's
@ SAT-R's src/lib/m4a/m4a0.s (NOTICE.md) with its function macros written out, the numbers its constants files give
@ each name it uses, and each label named after an address named after its routine instead. The part SAT-R leaves out
@ with .if 0, which the engine's SDK 3.0 version doesn't have, isn't here.
@
@ The stack tool assembles it with the tools' own assembler and reads each routine's pushes, stores to the stack and
@ calls (tools/gba/stack-map.mjs, routineMap), so its twin leaves the stack as the routine does, with values from the
@ Dreamport's own state as it runs. The notes that start dp: pair the routine with its twin's C. ARM code takes its
@ place without being assembled, as the tools' assembler reads Thumb only, and the stack tool lists what it stores as
@ gaps. `npm run dp -- libraries <version> --frames` compares each routine with the bytes of a version's copy.

	.syntax unified

@ dp:fixed SOUND_INFO_PTR
	.equ o_SoundInfo_ident, 0
	.equ o_SoundInfo_maxLines, 0xC
	.equ VCOUNT_VBLANK, 0xA0
	.equ TOTAL_SCANLINES, 0xE4
	.equ o_SoundInfo_MPlayMainHead, 0x20
	.equ o_SoundInfo_musicPlayerHead, 0x24
	.equ o_SoundInfo_CgbSound, 0x28
	.equ o_SoundInfo_pcmSamplesPerVBlank, 0x10
	.equ o_SoundInfo_pcmDmaCounter, 4
	.equ o_SoundInfo_pcmDmaPeriod, 0xB
	.equ SOUND_INFO_PTR, 0x3000000 + 0x7FF0
	.equ ID_NUMBER, 0x68736D53
	.equ REG_VCOUNT, 0x4000006
	.equ o_SoundInfo_pcmBuffer, 0x350
	.equ PCM_DMA_BUF_SIZE, 0x630
	.equ o_SoundInfo_reverb, 5
	.equ o_SoundInfo_divFreq, 0x18
	.equ o_SoundInfo_maxChans, 6
	.equ o_SoundInfo_chans, 0x50
	.equ o_SoundChannel_wav, 0x24
	.equ o_SoundChannel_statusFlags, 0
	.equ SOUND_CHANNEL_SF_ON, 0xC7
	.equ SOUND_CHANNEL_SF_START, 0x80
	.equ SOUND_CHANNEL_SF_STOP, 0x40
	.equ SOUND_CHANNEL_SF_ENV_ATTACK, 3
	.equ o_WaveData_data, 0x10
	.equ o_SoundChannel_currentPointer, 0x28
	.equ o_WaveData_size, 0xC
	.equ o_SoundChannel_count, 0x18
	.equ o_SoundChannel_envelopeVolume, 9
	.equ o_SoundChannel_fw, 0x1C
	.equ o_WaveData_flags, 3
	.equ WAVE_DATA_FLAG_LOOP, 0xC0
	.equ SOUND_CHANNEL_SF_LOOP, 0x10
	.equ SOUND_CHANNEL_SF_IEC, 4
	.equ o_SoundChannel_pseudoEchoLength, 0xD
	.equ o_SoundChannel_release, 7
	.equ o_SoundChannel_pseudoEchoVolume, 0xC
	.equ SOUND_CHANNEL_SF_ENV, 3
	.equ SOUND_CHANNEL_SF_ENV_DECAY, 2
	.equ o_SoundChannel_decay, 5
	.equ o_SoundChannel_sustain, 6
	.equ o_SoundChannel_attack, 4
	.equ o_SoundChannel_rightVolume, 2
	.equ o_SoundChannel_envelopeVolumeRight, 0xA
	.equ o_SoundChannel_leftVolume, 3
	.equ o_SoundChannel_envelopeVolumeLeft, 0xB
	.equ o_WaveData_loopStart, 8
	.equ o_SoundChannel_type, 1
	.equ o_SoundChannel_frequency, 0x20
	.equ SoundChannel_size, 0x40
	.equ o_SoundChannel_track, 0x2C
	.equ o_SoundChannel_nextChannelPointer, 0x34
	.equ o_SoundChannel_prevChannelPointer, 0x30
	.equ o_MusicPlayerTrack_chan, 0x20
	.equ o_MusicPlayerTrack_flags, 0
	.equ o_MusicPlayerTrack_cmdPtr, 0x40
	.equ o_MusicPlayerTrack_patternLevel, 2
	.equ o_MusicPlayerTrack_patternStack, 0x44
	.equ o_MusicPlayerTrack_repN, 3
	.equ o_MusicPlayerTrack_priority, 0x1D
	.equ o_MusicPlayerInfo_tempoD, 0x1C
	.equ o_MusicPlayerInfo_tempoU, 0x1E
	.equ o_MusicPlayerInfo_tempoI, 0x20
	.equ o_MusicPlayerTrack_keyShift, 0xA
	.equ o_MusicPlayerInfo_tone, 0x30
	.equ o_ToneData_type, 0
	.equ o_MusicPlayerTrack_ToneData_type, 0x24
	.equ o_ToneData_wav, 4
	.equ o_MusicPlayerTrack_ToneData_wav, 0x28
	.equ o_ToneData_attack, 8
	.equ o_MusicPlayerTrack_ToneData_attack, 0x2C
	.equ o_MusicPlayerTrack_vol, 0x12
	.equ MPT_FLG_VOLCHG, 3
	.equ C_V, 0x40
	.equ o_MusicPlayerTrack_pan, 0x14
	.equ o_MusicPlayerTrack_bend, 0xE
	.equ MPT_FLG_PITCHG, 0xC
	.equ o_MusicPlayerTrack_bendRange, 0xF
	.equ o_MusicPlayerTrack_lfoDelay, 0x1B
	.equ o_MusicPlayerTrack_modT, 0x18
	.equ o_MusicPlayerTrack_tune, 0xC
	.equ REG_SOUND1CNT_L, 0x4000060
	.equ REG_DMA1, 0x40000BC
	.equ DMA_ENABLE, 0x8000
	.equ DMA_START_NOW, 0
	.equ DMA_32BIT, 0x400
	.equ DMA_SRC_INC, 0
	.equ DMA_DEST_FIXED, 0x40
	.equ DMA_START_SPECIAL, 0x3000
	.equ DMA_REPEAT, 0x200
	.equ o_MusicPlayerInfo_ident, 0x34
	.equ o_MusicPlayerInfo_func, 0x38
	.equ o_MusicPlayerInfo_intp, 0x3C
	.equ o_MusicPlayerInfo_status, 4
	.equ o_MusicPlayerInfo_tempoC, 0x22
	.equ o_MusicPlayerInfo_trackCount, 8
	.equ o_MusicPlayerInfo_tracks, 0x2C
	.equ MPT_FLG_EXIST, 0x80
	.equ o_SoundChannel_gateTime, 0x10
	.equ MPT_FLG_START, 0x40
	.equ o_MusicPlayerTrack_volX, 0x13
	.equ o_MusicPlayerTrack_lfoSpeed, 0x19
	.equ o_MusicPlayerTrack_runningStatus, 7
	.equ o_SoundInfo_plynote, 0x38
	.equ o_MusicPlayerInfo_cmd, 0xA
	.equ o_SoundInfo_MPlayJumpTable, 0x34
	.equ o_MusicPlayerTrack_wait, 1
	.equ o_MusicPlayerTrack_mod, 0x17
	.equ o_MusicPlayerTrack_lfoDelayC, 0x1C
	.equ o_MusicPlayerTrack_lfoSpeedC, 0x1A
	.equ o_MusicPlayerTrack_modM, 0x16
	.equ MusicPlayerTrack_size, 0x50
	.equ o_MusicPlayerInfo_clock, 0xC
	.equ TONEDATA_TYPE_CGB, 7
	.equ o_CgbChannel_modify, 0x1D
	.equ CGB_CHANNEL_MO_VOL, 1
	.equ o_SoundChannel_key, 8
	.equ o_MusicPlayerTrack_keyM, 8
	.equ o_SoundInfo_MidiKeyToCgbFreq, 0x30
	.equ o_MusicPlayerTrack_pitM, 9
	.equ o_CgbChannel_frequency, 0x20
	.equ CGB_CHANNEL_MO_PIT, 2
	.equ o_SoundInfo_CgbOscOff, 0x2C
	.equ o_SoundChannel_velocity, 0x12
	.equ o_SoundChannel_rhythmPan, 0x14
	.equ o_MusicPlayerTrack_volMR, 0x10
	.equ o_MusicPlayerTrack_volML, 0x11
	.equ o_MusicPlayerTrack_gateTime, 4
	.equ o_MusicPlayerTrack_key, 5
	.equ o_MusicPlayerTrack_velocity, 6
	.equ TONEDATA_TYPE_RHY, 0x80
	.equ TONEDATA_TYPE_SPL, 0x40
	.equ o_MusicPlayerTrack_ToneData_keySplitTable, 0x2C
	.equ o_ToneData_pan_sweep, 3
	.equ TONEDATA_P_S_PAN, 0xC0
	.equ o_MusicPlayerInfo_priority, 9
	.equ o_SoundInfo_cgbChans, 0x1C
	.equ o_CgbChannel_statusFlags, 0
	.equ o_CgbChannel_priority, 0x13
	.equ o_CgbChannel_track, 0x2C
	.equ o_SoundChannel_priority, 0x13
	.equ o_MusicPlayerTrack_pseudoEchoVolume, 0x1E
	.equ o_ToneData_length, 2
	.equ o_CgbChannel_length, 0x1E
	.equ o_CgbChannel_sweep, 0x1F
	.equ o_SoundChannel_midiKey, 0x11

	.text


	.align 2, 0
	.global umul3232H32
	.thumb
	.thumb_func
	.type umul3232H32, function
@ dp:args r0=multiplier r1=multiplicand
umul3232H32:
	adr r2, __umul3232H32
	bx r2
	.arm
__umul3232H32:
	umull r2, r3, r0, r1
	add r0, r3, 0
	bx lr
	.size umul3232H32, .-umul3232H32


	.align 2, 0
	.global SoundMain
	.thumb
	.thumb_func
	.type SoundMain, function
SoundMain:
	ldr r0, lt_SOUND_INFO_PTR
	ldr r0, [r0]
	ldr r2, lt_ID_NUMBER
	ldr r3, [r0, o_SoundInfo_ident]
	cmp r2, r3
	beq SoundMain_1
	bx lr @ Exit the function if ident doesn't match ID_NUMBER. @ dp:return 1
SoundMain_1:
	adds r3, 1
	str r3, [r0, o_SoundInfo_ident]
	push {r4-r7,lr}
	mov r1, r8
	mov r2, r9
	mov r3, r10
	mov r4, r11
	push {r0-r4}
	sub sp, 0x18
	ldrb r1, [r0, o_SoundInfo_maxLines]
	cmp r1, 0 @ if maxLines is 0, there is no maximum
	beq SoundMain_3
	ldr r2, lt_REG_VCOUNT
	ldrb r2, [r2]
	cmp r2, VCOUNT_VBLANK
	bhs SoundMain_2
	adds r2, TOTAL_SCANLINES
SoundMain_2:
	adds r1, r2
SoundMain_3:
	str r1, [sp, 0x14] @ dp:value maxLines
	ldr r3, [r0, o_SoundInfo_MPlayMainHead]
	cmp r3, 0
	beq SoundMain_4
	ldr r0, [r0, o_SoundInfo_musicPlayerHead]
	bl SoundMainRAM_L36 @ dp:call soundInfo->MPlayMainHead
	ldr r0, [sp, 0x18]
SoundMain_4:
	ldr r3, [r0, o_SoundInfo_CgbSound]
	bl SoundMainRAM_L36 @ dp:call soundInfo->CgbSound
	ldr r0, [sp, 0x18]
	ldr r3, [r0, o_SoundInfo_pcmSamplesPerVBlank]
	mov r8, r3
	ldr r5, lt_o_SoundInfo_pcmBuffer
	adds r5, r0
	ldrb r4, [r0, o_SoundInfo_pcmDmaCounter]
	subs r7, r4, 1
	bls SoundMain_5
	ldrb r1, [r0, o_SoundInfo_pcmDmaPeriod]
	subs r1, r7
	mov r2, r8
	muls r2, r1
	adds r5, r2
SoundMain_5:
	str r5, [sp, 0x8] @ dp:pointer pcm
	ldr r6, lt_PCM_DMA_BUF_SIZE
	ldr r3, lt_SoundMainRAM_Buffer
	bx r3 @ dp:jump SoundMainRAM

	.align 2, 0
lt_SOUND_INFO_PTR:        .word SOUND_INFO_PTR
lt_ID_NUMBER:             .word ID_NUMBER
lt_SoundMainRAM_Buffer:   .word SoundMainRAM_Buffer + 1
lt_REG_VCOUNT:            .word REG_VCOUNT
lt_o_SoundInfo_pcmBuffer: .word o_SoundInfo_pcmBuffer
lt_PCM_DMA_BUF_SIZE:      .word PCM_DMA_BUF_SIZE
	.size SoundMain, .-SoundMain


	.align 2, 0
	.global SoundMainRAM
	.thumb
	.thumb_func
	.type SoundMainRAM, function
@ dp:alias SoundMainRAM_Buffer
SoundMainRAM:
	ldrb r3, [r0, o_SoundInfo_reverb]
	cmp r3, 0
	beq SoundMainRAM_NoReverb
	adr r1, SoundMainRAM_Reverb
	bx r1
	.arm
SoundMainRAM_Reverb:
	cmp r4, 0x2
	addeq r7, r0, o_SoundInfo_pcmBuffer
	addne r7, r5, r8
	mov r4, r8
SoundMainRAM_L1:
	ldrsb r0, [r5, r6]
	ldrsb r1, [r5]
	add r0, r0, r1
	ldrsb r1, [r7, r6]
	add r0, r0, r1
	ldrsb r1, [r7], 0x1
	add r0, r0, r1
	mul r1, r0, r3
	mov r0, r1, asr 9
	tst r0, 0x80
	addne r0, r0, 0x1
	strb r0, [r5, r6]
	strb r0, [r5], 0x1
	subs r4, r4, 0x1
	bgt SoundMainRAM_L1
	adr r0, SoundMainRAM_L2 + 1 @ plus 1 because THUMB
	bx r0
	.thumb
SoundMainRAM_NoReverb:
	movs r0, 0
	mov r1, r8
	adds r6, r5
	lsrs r1, 3
	bcc SoundMainRAM_NoReverb_Ok
	stm r5!, {r0}
	stm r6!, {r0}
SoundMainRAM_NoReverb_Ok:
	lsrs r1, 1
	bcc SoundMainRAM_NoReverb_Loop
	stm r5!, {r0}
	stm r6!, {r0}
	stm r5!, {r0}
	stm r6!, {r0}
SoundMainRAM_NoReverb_Loop:
	stm r5!, {r0}
	stm r6!, {r0}
	stm r5!, {r0}
	stm r6!, {r0}
	stm r5!, {r0}
	stm r6!, {r0}
	stm r5!, {r0}
	stm r6!, {r0}
	subs r1, 1
	bgt SoundMainRAM_NoReverb_Loop
SoundMainRAM_L2:
	ldr r4, [sp, 0x18]
	ldr r0, [r4, o_SoundInfo_divFreq]
	mov r12, r0
	ldrb r0, [r4, o_SoundInfo_maxChans]
	adds r4, o_SoundInfo_chans

SoundMainRAM_ChanLoop:
	str r0, [sp, 0x4] @ dp:value chansLeft
	ldr r3, [r4, o_SoundChannel_wav]
	ldr r0, [sp, 0x14]
	cmp r0, 0
	beq SoundMainRAM_L4
	ldr r1, =REG_VCOUNT
	ldrb r1, [r1]
	cmp r1, VCOUNT_VBLANK
	bhs SoundMainRAM_L3
	adds r1, TOTAL_SCANLINES
SoundMainRAM_L3:
	cmp r1, r0
	blo SoundMainRAM_L4
	b SoundMainRAM_L35

	.pool

SoundMainRAM_L4:
	ldrb r6, [r4, o_SoundChannel_statusFlags]
	movs r0, SOUND_CHANNEL_SF_ON
	tst r0, r6
	bne SoundMainRAM_L5
	b SoundMainRAM_L34
SoundMainRAM_L5:
	movs r0, SOUND_CHANNEL_SF_START
	tst r0, r6
	beq SoundMainRAM_L6
	movs r0, SOUND_CHANNEL_SF_STOP
	tst r0, r6
	bne SoundMainRAM_L7
	movs r6, SOUND_CHANNEL_SF_ENV_ATTACK
	strb r6, [r4, o_SoundChannel_statusFlags]
	adds r0, r3, 0
	adds r0, o_WaveData_data
	str r0, [r4, o_SoundChannel_currentPointer]
	ldr r0, [r3, o_WaveData_size]
	str r0, [r4, o_SoundChannel_count]
	movs r5, 0
	strb r5, [r4, o_SoundChannel_envelopeVolume]
	str r5, [r4, o_SoundChannel_fw]
	ldrb r2, [r3, o_WaveData_flags]
	movs r0, WAVE_DATA_FLAG_LOOP
	tst r0, r2
	beq SoundMainRAM_L12
	movs r0, SOUND_CHANNEL_SF_LOOP
	orrs r6, r0
	strb r6, [r4, o_SoundChannel_statusFlags]
	b SoundMainRAM_L12
SoundMainRAM_L6:
	ldrb r5, [r4, o_SoundChannel_envelopeVolume]
	movs r0, SOUND_CHANNEL_SF_IEC
	tst r0, r6
	beq SoundMainRAM_L8
	ldrb r0, [r4, o_SoundChannel_pseudoEchoLength]
	subs r0, 1
	strb r0, [r4, o_SoundChannel_pseudoEchoLength]
	bhi SoundMainRAM_L13
SoundMainRAM_L7:
	movs r0, 0
	strb r0, [r4, o_SoundChannel_statusFlags]
	b SoundMainRAM_L34
SoundMainRAM_L8:
	movs r0, SOUND_CHANNEL_SF_STOP
	tst r0, r6
	beq SoundMainRAM_L10
	ldrb r0, [r4, o_SoundChannel_release]
	muls r5, r0
	lsrs r5, 8
	ldrb r0, [r4, o_SoundChannel_pseudoEchoVolume]
	cmp r5, r0
	bhi SoundMainRAM_L13
SoundMainRAM_L9:
	ldrb r5, [r4, o_SoundChannel_pseudoEchoVolume]
	cmp r5, 0
	beq SoundMainRAM_L7
	movs r0, SOUND_CHANNEL_SF_IEC
	orrs r6, r0
	strb r6, [r4, o_SoundChannel_statusFlags]
	b SoundMainRAM_L13
SoundMainRAM_L10:
	movs r2, SOUND_CHANNEL_SF_ENV
	ands r2, r6
	cmp r2, SOUND_CHANNEL_SF_ENV_DECAY
	bne SoundMainRAM_L11
	ldrb r0, [r4, o_SoundChannel_decay]
	muls r5, r0
	lsrs r5, 8
	ldrb r0, [r4, o_SoundChannel_sustain]
	cmp r5, r0
	bhi SoundMainRAM_L13
	adds r5, r0, 0
	beq SoundMainRAM_L9
	subs r6, 0x1
	strb r6, [r4, o_SoundChannel_statusFlags]
	b SoundMainRAM_L13
SoundMainRAM_L11:
	cmp r2, SOUND_CHANNEL_SF_ENV_ATTACK
	bne SoundMainRAM_L13
SoundMainRAM_L12:
	ldrb r0, [r4, o_SoundChannel_attack]
	adds r5, r0
	cmp r5, 0xFF
	bcc SoundMainRAM_L13
	movs r5, 0xFF
	subs r6, 0x1
	strb r6, [r4, o_SoundChannel_statusFlags]
SoundMainRAM_L13:
	strb r5, [r4, o_SoundChannel_envelopeVolume]
	ldr r0, [sp, 0x18]
	ldrb r0, [r0, o_SoundChannel_release]
	adds r0, 0x1
	muls r0, r5
	lsrs r5, r0, 4
	ldrb r0, [r4, o_SoundChannel_rightVolume]
	muls r0, r5
	lsrs r0, 8
	strb r0, [r4, o_SoundChannel_envelopeVolumeRight]
	ldrb r0, [r4, o_SoundChannel_leftVolume]
	muls r0, r5
	lsrs r0, 8
	strb r0, [r4, o_SoundChannel_envelopeVolumeLeft]
	movs r0, SOUND_CHANNEL_SF_LOOP
	ands r0, r6
	str r0, [sp, 0x10]
	beq SoundMainRAM_L14
	adds r0, r3, 0
	adds r0, o_WaveData_data
	ldr r1, [r3, o_WaveData_loopStart]
	adds r0, r1
	str r0, [sp, 0xC]
	ldr r0, [r3, o_WaveData_size]
	subs r0, r1
	str r0, [sp, 0x10]
SoundMainRAM_L14:
	ldr r5, [sp, 0x8]
	ldr r2, [r4, o_SoundChannel_count]
	ldr r3, [r4, o_SoundChannel_currentPointer]
	adr r0, SoundMainRAM_L15
	bx r0
	.arm
SoundMainRAM_L15:
	str r8, [sp]
	ldrb r10, [r4, o_SoundChannel_envelopeVolumeRight]
	ldrb r11, [r4, o_SoundChannel_envelopeVolumeLeft]
	lsl sl, sl, #0x10
	lsl fp, fp, #0x10
	ldrb r0, [r4, o_SoundChannel_type]
	tst r0, 0x8
	beq SoundMainRAM_L27
SoundMainRAM_L16:
	cmp r2, 0x4
	ble SoundMainRAM_L19
	subs r2, r2, r8
	movgt lr, 0
	bgt SoundMainRAM_L17
	mov lr, r8
	add r2, r2, r8
	sub r8, r2, 0x4
	sub lr, lr, r8
	ands r2, r2, 0x3
	moveq r2, 0x4
SoundMainRAM_L17:
	ldr r6, [r5]
	ldr r7, [r5, PCM_DMA_BUF_SIZE]
SoundMainRAM_L18:
	ldrsb r0, [r3], 0x1
	mul r1, r10, r0
	bic r1, r1, 0xFF0000
	add r6, r1, r6, ror 8
	mul r1, r11, r0
	bic r1, r1, 0xFF0000
	add r7, r1, r7, ror 8
	adds r5, r5, 0x40000000
	bcc SoundMainRAM_L18
	str r7, [r5, PCM_DMA_BUF_SIZE]
	str r6, [r5], 0x4
	subs r8, r8, 0x4
	bgt SoundMainRAM_L17
	adds r8, r8, lr
	beq SoundMainRAM_L32
SoundMainRAM_L19:
	ldr r6, [r5]
	ldr r7, [r5, PCM_DMA_BUF_SIZE]
SoundMainRAM_L20:
	ldrsb r0, [r3], 0x1
	mul r1, r10, r0
	bic r1, r1, 0xFF0000
	add r6, r1, r6, ror 8
	mul r1, r11, r0
	bic r1, r1, 0xFF0000
	add r7, r1, r7, ror 8
	subs r2, r2, 0x1
	beq SoundMainRAM_L25
SoundMainRAM_L21:
	adds r5, r5, 0x40000000
	bcc SoundMainRAM_L20
	str r7, [r5, PCM_DMA_BUF_SIZE]
	str r6, [r5], 0x4
	subs r8, r8, 0x4
	bgt SoundMainRAM_L16
	b SoundMainRAM_L32
SoundMainRAM_L22:
	ldr r0, [sp, 0x18]
	cmp r0, 0
	beq SoundMainRAM_L24
	ldr r3, [sp, 0x14]
	rsb sb, r2, 0
SoundMainRAM_L23:
	adds r2, r0, r2
	bgt SoundMainRAM_L30
	sub sb, sb, r0
	b SoundMainRAM_L23
SoundMainRAM_L24:
	pop {r4,r12}
	mov r2, 0
	b SoundMainRAM_L26
SoundMainRAM_L25:
	ldr r2, [sp, 0x10]
	cmp r2, 0
	ldrne r3, [sp, 0xC]
	bne SoundMainRAM_L21
SoundMainRAM_L26:
	strb r2, [r4, o_SoundChannel_statusFlags]
	mov r0, r5, lsr 30
	bic r5, r5, 0xC0000000
	rsb r0, r0, 0x3
	mov r0, r0, lsl 3
	mov r6, r6, ror r0
	mov r7, r7, ror r0
	str r7, [r5, PCM_DMA_BUF_SIZE]
	str r6, [r5], 0x4
	b SoundMainRAM_L33
SoundMainRAM_L27:
	push {r4,r12}
	ldr lr, [r4, #0x1c]
	ldr r1, [r4, o_SoundChannel_frequency]
	mul r4, r12, r1
	ldrsb r0, [r3]
	ldrsb r1, [r3, 0x1]!
	sub r1, r1, r0
SoundMainRAM_L28:
	ldr r6, [r5]
	ldr r7, [r5, PCM_DMA_BUF_SIZE]
SoundMainRAM_L29:
	mul sb, lr, r1
	add sb, r0, sb, asr 23
	mul r12, r10, sb
	bic r12, r12, 0xFF0000
	add r6, r12, r6, ror 8
	mul r12, r11, sb
	bic r12, r12, 0xFF0000
	add r7, r12, r7, ror 8
	add lr, lr, r4
	lsrs sb, lr, 23
	beq SoundMainRAM_L31
	bic lr, lr, 0x3F800000
	subs r2, r2, sb
	ble SoundMainRAM_L22
	subs sb, sb, 0x1
	addeq r0, r0, r1
SoundMainRAM_L30:
	ldrsbne r0, [r3, sb]!
	ldrsb r1, [r3, 0x1]!
	sub r1, r1, r0
SoundMainRAM_L31:
	adds r5, r5, 0x40000000
	bcc SoundMainRAM_L29
	str r7, [r5, PCM_DMA_BUF_SIZE]
	str r6, [r5], 0x4
	subs r8, r8, 0x4
	bgt SoundMainRAM_L28
	sub r3, r3, 0x1
	pop {r4,r12}
	str lr, [r4, o_SoundChannel_fw]
SoundMainRAM_L32:
	str r2, [r4, o_SoundChannel_count]
	str r3, [r4, o_SoundChannel_currentPointer]
SoundMainRAM_L33:
	ldr r8, [sp]
	add r0, pc, 0x1
	bx r0
	.thumb
SoundMainRAM_L34:
	ldr r0, [sp, 0x4]
	subs r0, 1
	ble SoundMainRAM_L35
	adds r4, SoundChannel_size
	b SoundMainRAM_ChanLoop
SoundMainRAM_L35:
	ldr r0, [sp, 0x18]
	ldr r3, =ID_NUMBER
	str r3, [r0]
	add sp, 0x1C
	pop {r0-r7}
	mov r8, r0
	mov r9, r1
	mov r10, r2
	mov r11, r3
	pop {r3}
SoundMainRAM_L36:
	bx r3 @ dp:end
	.pool
	.size SoundMainRAM, .-SoundMainRAM

@ Not present in GBA SDK 3.0

	.align 2, 0
	.global SoundMainBTM
	.thumb
	.thumb_func
	.type SoundMainBTM, function
@ dp:args r0=at
SoundMainBTM:
	mov r12, r4
	movs r1, 0
	movs r2, 0
	movs r3, 0
	movs r4, 0
	stm r0!, {r1-r4}
	stm r0!, {r1-r4}
	stm r0!, {r1-r4}
	stm r0!, {r1-r4}
	mov r4, r12
	bx lr
	.size SoundMainBTM, .-SoundMainBTM


	.align 2, 0
	.global MP2KClearChain
	.thumb
	.thumb_func
	.type MP2KClearChain, function
@ dp:args r0=chan
MP2KClearChain:
	ldr r3, [r0, o_SoundChannel_track]
	cmp r3, 0
	beq MP2KClearChain_L40
	ldr r1, [r0, o_SoundChannel_nextChannelPointer]
	ldr r2, [r0, o_SoundChannel_prevChannelPointer]
	cmp r2, 0
	beq MP2KClearChain_L37
	str r1, [r2, o_SoundChannel_nextChannelPointer]
	b MP2KClearChain_L38
MP2KClearChain_L37:
	str r1, [r3, o_MusicPlayerTrack_chan]
MP2KClearChain_L38:
	cmp r1, 0
	beq MP2KClearChain_L39
	str r2, [r1, o_SoundChannel_prevChannelPointer]
MP2KClearChain_L39:
	movs r1, 0
	str r1, [r0, o_SoundChannel_track]
MP2KClearChain_L40:
	bx lr
	.size MP2KClearChain, .-MP2KClearChain


	.align 2, 0
	.global MP2K_event_fine
	.thumb
	.thumb_func
	.type MP2K_event_fine, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_fine:
	push {r4,r5,lr}
	adds r5, r1, 0
	ldr r4, [r5, o_MusicPlayerTrack_chan]
	cmp r4, 0
	beq MP2K_event_fine_done
MP2K_event_fine_loop:
	ldrb r1, [r4, o_SoundChannel_statusFlags]
	movs r0, SOUND_CHANNEL_SF_ON
	tst r0, r1
	beq MP2K_event_fine_ok
	movs r0, SOUND_CHANNEL_SF_STOP
	orrs r1, r0
	strb r1, [r4, o_SoundChannel_statusFlags]
MP2K_event_fine_ok:
	adds r0, r4, 0
	bl MP2KClearChain @ dp:call MP2KClearChain
	ldr r4, [r4, o_SoundChannel_nextChannelPointer]
	cmp r4, 0
	bne MP2K_event_fine_loop
MP2K_event_fine_done:
	movs r0, 0
	strb r0, [r5, o_MusicPlayerTrack_flags]
	pop {r4,r5}
	pop {r0}
	bx r0 @ dp:end
	.size MP2K_event_fine, .-MP2K_event_fine


	.align 2, 0
	.global MPlayJumpTableCopy
	.thumb
	.thumb_func
	.type MPlayJumpTableCopy, function
@ dp:args r0=table
MPlayJumpTableCopy:
	mov r12, lr
	movs r1, 0x24
	ldr r2, lt_MPlayJumpTableTemplate
MPlayJumpTableCopy_Loop:
	ldr r3, [r2]
	bl chk_adr_r2 @ dp:call chk_adr_r2
	stm r0!, {r3}
	adds r2, 0x4
	subs r1, 0x1
	bgt MPlayJumpTableCopy_Loop
	bx r12 @ dp:end
	.size MPlayJumpTableCopy, .-MPlayJumpTableCopy

	.align 2, 0
	.thumb_func
	.type ldrb_r3_r2, function
@ dp:args r2=at
ldrb_r3_r2:
	ldrb r3, [r2] @ dp:jump chk_adr_r2
	.size ldrb_r3_r2, .-ldrb_r3_r2

@ This attempts to protect against reading anything from the BIOS ROM
@ besides the jump table template.
@ It assumes that the jump table template is located at the end of the ROM.
	.thumb_func
	.type chk_adr_r2, function
@ dp:args r2=at
chk_adr_r2:
	push {r0}
	lsrs r0, r2, 25
	bne chk_adr_r2_done @ if adr >= 0x2000000 (i.e. not in BIOS ROM), accept it
	ldr r0, lt_MPlayJumpTableTemplate
	cmp r2, r0
	blo chk_adr_r2_reject @ if adr < gMPlayJumpTableTemplate, reject it
	lsrs r0, r2, 14
	beq chk_adr_r2_done @ if adr < 0x40000 (i.e. in BIOS ROM), accept it
chk_adr_r2_reject:
	movs r3, 0
chk_adr_r2_done:
	pop {r0}
	bx lr @ dp:return

	.align 2, 0
lt_MPlayJumpTableTemplate: .word gMPlayJumpTableTemplate
	.size chk_adr_r2, .-chk_adr_r2


	.align 2, 0
	.global ld_r3_tp_adr_i
	.thumb
	.thumb_func
	.type ld_r3_tp_adr_i, function
@ dp:args r1=track
ld_r3_tp_adr_i:
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
ld_r3_tp_adr_i_L41:
	adds r3, r2, 0x1
	str r3, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r3, [r2]
	b chk_adr_r2 @ dp:jump ldrb_r3_r2
	.size ld_r3_tp_adr_i, .-ld_r3_tp_adr_i


	.align 2, 0
	.global MP2K_event_goto
	.thumb
	.thumb_func
	.type MP2K_event_goto, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_goto:
	push {lr}
MP2K_event_goto_1:
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r0, [r2, 0x3]
	lsls r0, 8
	ldrb r3, [r2, 0x2]
	orrs r0, r3
	lsls r0, 8
	ldrb r3, [r2, 0x1]
	orrs r0, r3
	lsls r0, 8
	bl ldrb_r3_r2 @ dp:call ldrb_r3_r2
	orrs r0, r3
	str r0, [r1, o_MusicPlayerTrack_cmdPtr]
	pop {r0}
	bx r0 @ dp:end
	.size MP2K_event_goto, .-MP2K_event_goto


	.align 2, 0
	.global MP2K_event_patt
	.thumb
	.thumb_func
	.type MP2K_event_patt, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_patt:
	ldrb r2, [r1, o_MusicPlayerTrack_patternLevel]
	cmp r2, 3
	bhs MP2K_event_patt_done
	lsls r2, 2
	adds r3, r1, r2
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	adds r2, 0x4
	str r2, [r3, o_MusicPlayerTrack_patternStack]
	ldrb r2, [r1, o_MusicPlayerTrack_patternLevel]
	adds r2, 1
	strb r2, [r1, o_MusicPlayerTrack_patternLevel]
	b MP2K_event_goto @ dp:jump MP2K_event_goto
MP2K_event_patt_done:
	b MP2K_event_fine @ dp:jump MP2K_event_fine
	.size MP2K_event_patt, .-MP2K_event_patt


	.align 2, 0
	.global MP2K_event_pend
	.thumb
	.thumb_func
	.type MP2K_event_pend, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_pend:
	ldrb r2, [r1, o_MusicPlayerTrack_patternLevel]
	cmp r2, 0
	beq MP2K_event_pend_done
	subs r2, 1
	strb r2, [r1, o_MusicPlayerTrack_patternLevel]
	lsls r2, 2
	adds r3, r1, r2
	ldr r2, [r3, o_MusicPlayerTrack_patternStack]
	str r2, [r1, o_MusicPlayerTrack_cmdPtr]
MP2K_event_pend_done:
	bx lr
	.size MP2K_event_pend, .-MP2K_event_pend


	.align 2, 0
	.global MP2K_event_rept
	.thumb
	.thumb_func
	.type MP2K_event_rept, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_rept:
	push {lr}
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r3, [r2]
	cmp r3, 0
	bne MP2K_event_rept_1
	adds r2, 1
	str r2, [r1, o_MusicPlayerTrack_cmdPtr]
	b MP2K_event_goto_1
MP2K_event_rept_1:
	ldrb r3, [r1, o_MusicPlayerTrack_repN]
	adds r3, 1
	strb r3, [r1, o_MusicPlayerTrack_repN]
	mov r12, r3
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	cmp r12, r3
	bhs MP2K_event_rept_2
	b MP2K_event_goto_1
MP2K_event_rept_2:
	movs r3, 0
	strb r3, [r1, o_MusicPlayerTrack_repN]
	adds r2, 5
	str r2, [r1, o_MusicPlayerTrack_cmdPtr]
	pop {r0}
	bx r0 @ dp:end
	.size MP2K_event_rept, .-MP2K_event_rept


	.align 2, 0
	.global MP2K_event_prio
	.thumb
	.thumb_func
	.type MP2K_event_prio, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_prio:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	strb r3, [r1, o_MusicPlayerTrack_priority]
	bx r12 @ dp:return
	.size MP2K_event_prio, .-MP2K_event_prio


	.align 2, 0
	.global MP2K_event_tempo
	.thumb
	.thumb_func
	.type MP2K_event_tempo, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_tempo:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	lsls r3, 1
	strh r3, [r0, o_MusicPlayerInfo_tempoD]
	ldrh r2, [r0, o_MusicPlayerInfo_tempoU]
	muls r3, r2
	lsrs r3, 8
	strh r3, [r0, o_MusicPlayerInfo_tempoI]
	bx r12 @ dp:return
	.size MP2K_event_tempo, .-MP2K_event_tempo


	.align 2, 0
	.global MP2K_event_keysh
	.thumb
	.thumb_func
	.type MP2K_event_keysh, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_keysh:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	strb r3, [r1, o_MusicPlayerTrack_keyShift]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, 0xC
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx r12 @ dp:return
	.size MP2K_event_keysh, .-MP2K_event_keysh


	.align 2, 0
	.global MP2K_event_voice
	.thumb
	.thumb_func
	.type MP2K_event_voice, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_voice:
	mov r12, lr
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r3, [r2]
	adds r2, 1
	str r2, [r1, o_MusicPlayerTrack_cmdPtr]
	lsls r2, r3, 1
	adds r2, r3
	lsls r2, 2
	ldr r3, [r0, o_MusicPlayerInfo_tone]
	adds r2, r3
	ldr r3, [r2, o_ToneData_type]
	bl chk_adr_r2 @ dp:call chk_adr_r2 #1
	str r3, [r1, o_MusicPlayerTrack_ToneData_type]
	ldr r3, [r2, o_ToneData_wav]
	bl chk_adr_r2 @ dp:call chk_adr_r2 #2
	str r3, [r1, o_MusicPlayerTrack_ToneData_wav]
	ldr r3, [r2, o_ToneData_attack]
	bl chk_adr_r2 @ dp:call chk_adr_r2 #3
	str r3, [r1, o_MusicPlayerTrack_ToneData_attack]
	bx r12 @ dp:end
	.size MP2K_event_voice, .-MP2K_event_voice


	.align 2, 0
	.global MP2K_event_vol
	.thumb
	.thumb_func
	.type MP2K_event_vol, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_vol:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	strb r3, [r1, o_MusicPlayerTrack_vol]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, MPT_FLG_VOLCHG
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx r12 @ dp:return
	.size MP2K_event_vol, .-MP2K_event_vol


	.align 2, 0
	.global MP2K_event_pan
	.thumb
	.thumb_func
	.type MP2K_event_pan, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_pan:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	subs r3, C_V
	strb r3, [r1, o_MusicPlayerTrack_pan]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, MPT_FLG_VOLCHG
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx r12 @ dp:return
	.size MP2K_event_pan, .-MP2K_event_pan


	.align 2, 0
	.global MP2K_event_bend
	.thumb
	.thumb_func
	.type MP2K_event_bend, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_bend:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	subs r3, C_V
	strb r3, [r1, o_MusicPlayerTrack_bend]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, MPT_FLG_PITCHG
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx r12 @ dp:return
	.size MP2K_event_bend, .-MP2K_event_bend


	.align 2, 0
	.global MP2K_event_bendr
	.thumb
	.thumb_func
	.type MP2K_event_bendr, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_bendr:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	strb r3, [r1, o_MusicPlayerTrack_bendRange]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, MPT_FLG_PITCHG
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx r12 @ dp:return
	.size MP2K_event_bendr, .-MP2K_event_bendr


	.align 2, 0
	.global MP2K_event_lfodl
	.thumb
	.thumb_func
	.type MP2K_event_lfodl, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_lfodl:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	strb r3, [r1, o_MusicPlayerTrack_lfoDelay]
	bx r12 @ dp:return
	.size MP2K_event_lfodl, .-MP2K_event_lfodl


	.align 2, 0
	.global MP2K_event_modt
	.thumb
	.thumb_func
	.type MP2K_event_modt, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_modt:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	ldrb r0, [r1, o_MusicPlayerTrack_modT]
	cmp r0, r3
	beq MP2K_event_modt_L42
	strb r3, [r1, o_MusicPlayerTrack_modT]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, MPT_FLG_VOLCHG | MPT_FLG_PITCHG
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
MP2K_event_modt_L42:
	bx r12 @ dp:return
	.size MP2K_event_modt, .-MP2K_event_modt


	.align 2, 0
	.global MP2K_event_tune
	.thumb
	.thumb_func
	.type MP2K_event_tune, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_tune:
	mov r12, lr
	bl ld_r3_tp_adr_i @ dp:call ld_r3_tp_adr_i
	subs r3, C_V
	strb r3, [r1, o_MusicPlayerTrack_tune]
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	movs r2, MPT_FLG_PITCHG
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx r12 @ dp:return
	.size MP2K_event_tune, .-MP2K_event_tune


	.align 2, 0
	.global MP2K_event_port
	.thumb
	.thumb_func
	.type MP2K_event_port, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_port:
	mov r12, lr
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r3, [r2]
	adds r2, 1
	ldr r0, =REG_SOUND1CNT_L @ sound register base address
	adds r0, r3
	bl ld_r3_tp_adr_i_L41 @ dp:call ldrb_r3_r2
	strb r3, [r0]
	bx r12 @ dp:end
	.pool
	.size MP2K_event_port, .-MP2K_event_port


	.align 2, 0
	.global m4aSoundVSync
	.thumb
	.thumb_func
	.type m4aSoundVSync, function
m4aSoundVSync:
	ldr r0, lt2_SOUND_INFO_PTR
	ldr r0, [r0]

	@ Exit the function if ident is not ID_NUMBER or ID_NUMBER+1.
	ldr r2, lt2_ID_NUMBER
	ldr r3, [r0, o_SoundInfo_ident]
	subs r3, r2
	cmp r3, 1
	bhi m4aSoundVSync_Done

	@ Decrement the PCM DMA counter. If it reaches 0, we need to do a DMA.
	ldrb r1, [r0, o_SoundInfo_pcmDmaCounter]
	subs r1, 1
	strb r1, [r0, o_SoundInfo_pcmDmaCounter]
	bgt m4aSoundVSync_Done

	@ Reload the PCM DMA counter.
	ldrb r1, [r0, o_SoundInfo_pcmDmaPeriod]
	strb r1, [r0, o_SoundInfo_pcmDmaCounter]

	ldr r2, =REG_DMA1

	ldr r1, [r2, 0x8] @ DMA1CNT
	lsls r1, 7
	bcc m4aSoundVSync_SkipDMA1 @ branch if repeat bit isn't set

	ldr r1, =((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4
	str r1, [r2, 0x8] @ DMA1CNT

m4aSoundVSync_SkipDMA1:
	ldr r1, [r2, 0xC + 0x8] @ DMA2CNT
	lsls r1, 7
	bcc m4aSoundVSync_SkipDMA2 @ branch if repeat bit isn't set

	ldr r1, =((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4
	str r1, [r2, 0xC + 0x8] @ DMA2CNT

m4aSoundVSync_SkipDMA2:

	@ turn off DMA1/DMA2
	movs r1, DMA_32BIT >> 8
	lsls r1, 8
	strh r1, [r2, 0xA]       @ DMA1CNT_H
	strh r1, [r2, 0xC + 0xA] @ DMA2CNT_H

	@ turn on DMA1/DMA2 direct-sound FIFO mode
	movs r1, (DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT) >> 8
	lsls r1, 8 @ LSB is 0, so DMA_SRC_INC is used (destination is always fixed in FIFO mode)
	strh r1, [r2, 0xA]       @ DMA1CNT_H
	strh r1, [r2, 0xC + 0xA] @ DMA2CNT_H

m4aSoundVSync_Done:
	bx lr

	.pool
	.size m4aSoundVSync, .-m4aSoundVSync


	.align 2, 0
	.global MP2KPlayerMain
	.thumb
	.thumb_func
	.type MP2KPlayerMain, function
@ dp:args r0=mplayInfo
MP2KPlayerMain:
	ldr r2, lt2_ID_NUMBER
	ldr r3, [r0, o_MusicPlayerInfo_ident]
	cmp r2, r3
	beq MP2KPlayerMain_L43
	bx lr @ dp:return 1
MP2KPlayerMain_L43:
	adds r3, 0x1
	str r3, [r0, o_MusicPlayerInfo_ident]
	push {r0,lr}
	ldr r3, [r0, o_MusicPlayerInfo_func]
	cmp r3, 0
	beq MP2KPlayerMain_L44
	ldr r0, [r0, o_MusicPlayerInfo_intp]
	bl call_r3 @ dp:call mplayInfo->nextPlayerFunc
MP2KPlayerMain_L44:
	pop {r0}
	push {r4-r7}
	mov r4, r8
	mov r5, r9
	mov r6, r10
	mov r7, r11
	push {r4-r7}
	adds r7, r0, 0
	ldr r0, [r7, o_MusicPlayerInfo_status]
	cmp r0, 0
	bge MP2KPlayerMain_L45
	b MP2KPlayerMain_L80
MP2KPlayerMain_L45:
	ldr r0, lt2_SOUND_INFO_PTR
	ldr r0, [r0]
	mov r8, r0
	adds r0, r7, 0
	bl FadeOutBody @ dp:call FadeOutBody
	ldr r0, [r7, o_MusicPlayerInfo_status]
	cmp r0, 0
	bge MP2KPlayerMain_L46
	b MP2KPlayerMain_L80
MP2KPlayerMain_L46:
	ldrh r0, [r7, o_MusicPlayerInfo_tempoC]
	ldrh r1, [r7, o_MusicPlayerInfo_tempoI]
	adds r0, r1
	b MP2KPlayerMain_L69
MP2KPlayerMain_L47:
	ldrb r6, [r7, o_MusicPlayerInfo_trackCount]
	ldr r5, [r7, o_MusicPlayerInfo_tracks]
	movs r3, 0x1
	movs r4, 0
MP2KPlayerMain_L48:
	ldrb r0, [r5, o_MusicPlayerTrack_flags]
	movs r1, MPT_FLG_EXIST
	tst r1, r0
	bne MP2KPlayerMain_L49
	b MP2KPlayerMain_L66
MP2KPlayerMain_L49:
	mov r10, r3
	orrs r4, r3
	mov r11, r4
	ldr r4, [r5, o_MusicPlayerTrack_chan]
	cmp r4, 0
	beq MP2KPlayerMain_L53
MP2KPlayerMain_L50:
	ldrb r1, [r4, o_SoundChannel_statusFlags]
	movs r0, SOUND_CHANNEL_SF_ON
	tst r0, r1
	beq MP2KPlayerMain_L51
	ldrb r0, [r4, o_SoundChannel_gateTime]
	cmp r0, 0
	beq MP2KPlayerMain_L52
	subs r0, 0x1
	strb r0, [r4, o_SoundChannel_gateTime]
	bne MP2KPlayerMain_L52
	movs r0, SOUND_CHANNEL_SF_STOP
	orrs r1, r0
	strb r1, [r4, o_SoundChannel_statusFlags]
	b MP2KPlayerMain_L52
MP2KPlayerMain_L51:
	adds r0, r4, 0
	bl ClearChain @ dp:call ClearChain #1 @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=i @ dp:value r10=bit @ dp:value r11=playing
MP2KPlayerMain_L52:
	ldr r4, [r4, o_SoundChannel_nextChannelPointer]
	cmp r4, 0
	bne MP2KPlayerMain_L50
MP2KPlayerMain_L53:
	ldrb r3, [r5, o_MusicPlayerTrack_flags]
	movs r0, MPT_FLG_START
	tst r0, r3
	beq MP2KPlayerMain_L59
	adds r0, r5, 0
	bl Clear64byte @ dp:call Clear64byte @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=i @ dp:value r10=bit @ dp:value r11=playing
	movs r0, MPT_FLG_EXIST
	strb r0, [r5, o_MusicPlayerTrack_flags]
	movs r0, 0x2
	strb r0, [r5, o_MusicPlayerTrack_bendRange]
	movs r0, 0x40
	strb r0, [r5, o_MusicPlayerTrack_volX]
	movs r0, 0x16
	strb r0, [r5, o_MusicPlayerTrack_lfoSpeed]
	movs r0, 0x1
	adds r1, r5, 0x6
	strb r0, [r1, o_MusicPlayerTrack_ToneData_type - 0x6]
	b MP2KPlayerMain_L59
MP2KPlayerMain_L54:
	ldr r2, [r5, o_MusicPlayerTrack_cmdPtr]
	ldrb r1, [r2]
	cmp r1, 0x80
	bhs MP2KPlayerMain_L55
	ldrb r1, [r5, o_MusicPlayerTrack_runningStatus]
	b MP2KPlayerMain_L56
MP2KPlayerMain_L55:
	adds r2, 0x1
	str r2, [r5, o_MusicPlayerTrack_cmdPtr]
	cmp r1, 0xBD
	bcc MP2KPlayerMain_L56
	strb r1, [r5, o_MusicPlayerTrack_runningStatus]
MP2KPlayerMain_L56:
	cmp r1, 0xCF
	bcc MP2KPlayerMain_L57
	mov r0, r8
	ldr r3, [r0, o_SoundInfo_plynote]
	adds r0, r1, 0
	subs r0, 0xCF
	adds r1, r7, 0
	adds r2, r5, 0
	bl call_r3 @ dp:call soundInfo->plynote @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=i @ dp:value r10=bit @ dp:value r11=playing
	b MP2KPlayerMain_L59
MP2KPlayerMain_L57:
	cmp r1, 0xB0
	bls MP2KPlayerMain_L58
	adds r0, r1, 0
	subs r0, 0xB1
	strb r0, [r7, o_MusicPlayerInfo_cmd]
	mov r3, r8
	ldr r3, [r3, o_SoundInfo_MPlayJumpTable]
	lsls r0, 2
	ldr r3, [r3, r0]
	adds r0, r7, 0
	adds r1, r5, 0
	bl call_r3 @ dp:call ((MP2KEventFunc)soundInfo->MPlayJumpTable[cmd - 0xB1]) @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=i @ dp:value r10=bit @ dp:value r11=playing
	ldrb r0, [r5, o_MusicPlayerTrack_flags]
	cmp r0, 0
	beq MP2KPlayerMain_L65
	b MP2KPlayerMain_L59
MP2KPlayerMain_L58:
	ldr r0, lt_gClockTable
	subs r1, 0x80
	adds r1, r0
	ldrb r0, [r1]
	strb r0, [r5, o_MusicPlayerTrack_wait]
MP2KPlayerMain_L59:
	ldrb r0, [r5, o_MusicPlayerTrack_wait]
	cmp r0, 0
	beq MP2KPlayerMain_L54
	subs r0, 0x1
	strb r0, [r5, o_MusicPlayerTrack_wait]
	ldrb r1, [r5, o_MusicPlayerTrack_lfoSpeed]
	cmp r1, 0
	beq MP2KPlayerMain_L65
	ldrb r0, [r5, o_MusicPlayerTrack_mod]
	cmp r0, 0
	beq MP2KPlayerMain_L65
	ldrb r0, [r5, o_MusicPlayerTrack_lfoDelayC]
	cmp r0, 0
	beq MP2KPlayerMain_L60
	subs r0, 0x1
	strb r0, [r5, o_MusicPlayerTrack_lfoDelayC]
	b MP2KPlayerMain_L65
MP2KPlayerMain_L60:
	ldrb r0, [r5, o_MusicPlayerTrack_lfoSpeedC]
	adds r0, r1
	strb r0, [r5, o_MusicPlayerTrack_lfoSpeedC]
	adds r1, r0, 0
	subs r0, 0x40
	lsls r0, 24
	bpl MP2KPlayerMain_L61
	lsls r2, r1, 24
	asrs r2, 24
	b MP2KPlayerMain_L62
MP2KPlayerMain_L61:
	movs r0, 0x80
	subs r2, r0, r1
MP2KPlayerMain_L62:
	ldrb r0, [r5, o_MusicPlayerTrack_mod]
	muls r0, r2
	asrs r2, r0, 6
	ldrb r0, [r5, o_MusicPlayerTrack_modM]
	eors r0, r2
	lsls r0, 24
	beq MP2KPlayerMain_L65
	strb r2, [r5, o_MusicPlayerTrack_modM]
	ldrb r0, [r5]
	ldrb r1, [r5, o_MusicPlayerTrack_modT]
	cmp r1, 0
	bne MP2KPlayerMain_L63
	movs r1, MPT_FLG_PITCHG
	b MP2KPlayerMain_L64
MP2KPlayerMain_L63:
	movs r1, MPT_FLG_VOLCHG
MP2KPlayerMain_L64:
	orrs r0, r1
	strb r0, [r5, o_MusicPlayerTrack_flags]
MP2KPlayerMain_L65:
	mov r3, r10
	mov r4, r11
MP2KPlayerMain_L66:
	subs r6, 0x1
	ble MP2KPlayerMain_L67
	movs r0, MusicPlayerTrack_size
	adds r5, r0
	lsls r3, 1
	b MP2KPlayerMain_L48
MP2KPlayerMain_L67:
	ldr r0, [r7, o_MusicPlayerInfo_clock]
	adds r0, 0x1
	str r0, [r7, o_MusicPlayerInfo_clock]
	cmp r4, 0
	bne MP2KPlayerMain_L68
	movs r0, 0x80
	lsls r0, 24
	str r0, [r7, o_MusicPlayerInfo_status]
	b MP2KPlayerMain_L80
MP2KPlayerMain_L68:
	str r4, [r7, o_MusicPlayerInfo_status]
	ldrh r0, [r7, o_MusicPlayerInfo_tempoC]
	subs r0, 150
MP2KPlayerMain_L69:
	strh r0, [r7, o_MusicPlayerInfo_tempoC]
	cmp r0, 150
	bcc MP2KPlayerMain_L70
	b MP2KPlayerMain_L47
MP2KPlayerMain_L70:
	ldrb r2, [r7, o_MusicPlayerInfo_trackCount]
	ldr r5, [r7, o_MusicPlayerInfo_tracks]
MP2KPlayerMain_L71:
	ldrb r0, [r5, o_MusicPlayerTrack_flags]
	movs r1, 0x80
	tst r1, r0
	beq MP2KPlayerMain_L79
	movs r1, MPT_FLG_VOLCHG | MPT_FLG_PITCHG
	tst r1, r0
	beq MP2KPlayerMain_L79
	mov r9, r2
	adds r0, r7, 0
	adds r1, r5, 0
	bl TrkVolPitSet @ dp:call TrkVolPitSet @ dp:pointer r5=track @ dp:value r9=i
	ldr r4, [r5, o_MusicPlayerTrack_chan]
	cmp r4, 0
	beq MP2KPlayerMain_L78
MP2KPlayerMain_L72:
	ldrb r1, [r4, o_SoundChannel_statusFlags]
	movs r0, SOUND_CHANNEL_SF_ON
	tst r0, r1
	bne MP2KPlayerMain_L73
	adds r0, r4, 0
	bl ClearChain @ dp:call ClearChain #2 @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r9=i
	b MP2KPlayerMain_L77
MP2KPlayerMain_L73:
	ldrb r0, [r4, o_SoundChannel_type]
	movs r6, TONEDATA_TYPE_CGB
	ands r6, r0
	ldrb r3, [r5, o_MusicPlayerTrack_flags]
	movs r0, MPT_FLG_VOLCHG
	tst r0, r3
	beq MP2KPlayerMain_L74
	bl ChnVolSetAsm @ dp:call ChnVolSetAsm @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=cgb @ dp:value r9=i
	cmp r6, 0
	beq MP2KPlayerMain_L74
	ldrb r0, [r4, o_CgbChannel_modify]
	movs r1, CGB_CHANNEL_MO_VOL
	orrs r0, r1
	strb r0, [r4, o_CgbChannel_modify]
MP2KPlayerMain_L74:
	ldrb r3, [r5, o_MusicPlayerTrack_flags]
	movs r0, MPT_FLG_PITCHG
	tst r0, r3
	beq MP2KPlayerMain_L77
	ldrb r1, [r4, o_SoundChannel_key]
	movs r0, o_MusicPlayerTrack_keyM
	ldrsb r0, [r5, r0]
	adds r2, r1, r0
	bpl MP2KPlayerMain_L75
	movs r2, 0
MP2KPlayerMain_L75:
	cmp r6, 0
	beq MP2KPlayerMain_L76
	mov r0, r8
	ldr r3, [r0, o_SoundInfo_MidiKeyToCgbFreq]
	adds r1, r2, 0
	ldrb r2, [r5, o_MusicPlayerTrack_pitM]
	adds r0, r6, 0
	bl call_r3 @ dp:call soundInfo->MidiKeyToCgbFreq @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=cgb @ dp:value r9=i
	str r0, [r4, o_CgbChannel_frequency]
	ldrb r0, [r4, o_CgbChannel_modify]
	movs r1, CGB_CHANNEL_MO_PIT
	orrs r0, r1
	strb r0, [r4, o_CgbChannel_modify]
	b MP2KPlayerMain_L77
MP2KPlayerMain_L76:
	adds r1, r2, 0
	ldrb r2, [r5, o_MusicPlayerTrack_pitM]
	ldr r0, [r4, o_SoundChannel_wav]
	bl MidiKeyToFreq @ dp:call MidiKeyToFreq @ dp:pointer r4=chan @ dp:pointer r5=track @ dp:value r6=cgb @ dp:value r9=i
	str r0, [r4, o_SoundChannel_frequency]
MP2KPlayerMain_L77:
	ldr r4, [r4, o_SoundChannel_nextChannelPointer]
	cmp r4, 0
	bne MP2KPlayerMain_L72
MP2KPlayerMain_L78:
	ldrb r0, [r5, o_MusicPlayerTrack_flags]
	movs r1, 0xF0
	ands r0, r1
	strb r0, [r5, o_MusicPlayerTrack_flags]
	mov r2, r9
MP2KPlayerMain_L79:
	subs r2, 0x1
	ble MP2KPlayerMain_L80
	movs r0, MusicPlayerTrack_size
	adds r5, r0
	bgt MP2KPlayerMain_L71
MP2KPlayerMain_L80:
	ldr r0, lt2_ID_NUMBER
	str r0, [r7, o_MusicPlayerInfo_ident]
	pop {r0-r7}
	mov r8, r0
	mov r9, r1
	mov r10, r2
	mov r11, r3
	pop {r3}

call_r3:
	bx r3 @ dp:end

	.align 2, 0
lt_gClockTable:     .word gClockTable
lt2_SOUND_INFO_PTR: .word SOUND_INFO_PTR
lt2_ID_NUMBER:      .word ID_NUMBER
	.size MP2KPlayerMain, .-MP2KPlayerMain


	.align 2, 0
	.global TrackStop
	.thumb
	.thumb_func
	.type TrackStop, function
@ dp:args r0=mplayInfo r1=track
TrackStop:
	push {r4-r6,lr}
	adds r5, r1, 0
	ldrb r1, [r5, o_MusicPlayerTrack_flags]
	movs r0, MPT_FLG_EXIST
	tst r0, r1
	beq TrackStop_Done
	ldr r4, [r5, o_MusicPlayerTrack_chan]
	cmp r4, 0
	beq TrackStop_3
	movs r6, 0
TrackStop_Loop:
	ldrb r0, [r4, o_SoundChannel_statusFlags]
	cmp r0, 0
	beq TrackStop_2
	ldrb r0, [r4, o_SoundChannel_type]
	movs r3, TONEDATA_TYPE_CGB
	ands r0, r3
	beq TrackStop_1
	ldr r3, =SOUND_INFO_PTR
	ldr r3, [r3]
	ldr r3, [r3, o_SoundInfo_CgbOscOff]
	bl call_r3 @ dp:call SOUND_INFO_PTR->CgbOscOff
TrackStop_1:
	strb r6, [r4, o_SoundChannel_statusFlags]
TrackStop_2:
	str r6, [r4, o_SoundChannel_track]
	ldr r4, [r4, o_SoundChannel_nextChannelPointer]
	cmp r4, 0
	bne TrackStop_Loop
TrackStop_3:
	str r4, [r5, o_MusicPlayerTrack_chan]
TrackStop_Done:
	pop {r4-r6}
	pop {r0}
	bx r0 @ dp:return
	.pool
	.size TrackStop, .-TrackStop


	.align 2, 0
	.global ChnVolSetAsm
	.thumb
	.thumb_func
	.type ChnVolSetAsm, function
ChnVolSetAsm:
	ldrb r1, [r4, o_SoundChannel_velocity]
	movs r0, o_SoundChannel_rhythmPan
	ldrsb r2, [r4, r0]
	movs r3, 0x80
	adds r3, r2
	muls r3, r1
	ldrb r0, [r5, o_MusicPlayerTrack_volMR]
	muls r0, r3
	asrs r0, 14
	cmp r0, 0xFF
	bls ChnVolSetAsm_L81
	movs r0, 0xFF
ChnVolSetAsm_L81:
	strb r0, [r4, o_SoundChannel_rightVolume]
	movs r3, 0x7F
	subs r3, r2
	muls r3, r1
	ldrb r0, [r5, o_MusicPlayerTrack_volML]
	muls r0, r3
	asrs r0, 14
	cmp r0, 0xFF
	bls ChnVolSetAsm_L82
	movs r0, 0xFF
ChnVolSetAsm_L82:
	strb r0, [r4, o_SoundChannel_leftVolume]
	bx lr
	.size ChnVolSetAsm, .-ChnVolSetAsm


	.align 2, 0
	.global MP2K_event_nxx
	.thumb
	.thumb_func
	.type MP2K_event_nxx, function
@ dp:args r0=clock r1=mplayInfo r2=track
MP2K_event_nxx:
	push {r4-r7,lr}
	mov r4, r8
	mov r5, r9
	mov r6, r10
	mov r7, r11
	push {r4-r7}
	sub sp, 0x18
	str r1, [sp]
	adds r5, r2, 0
	ldr r1, =SOUND_INFO_PTR
	ldr r1, [r1]
	str r1, [sp, 0x4]
	ldr r1, =gClockTable
	adds r0, r1
	ldrb r0, [r0]
	strb r0, [r5, o_MusicPlayerTrack_gateTime]
	ldr r3, [r5, o_MusicPlayerTrack_cmdPtr]
	ldrb r0, [r3]
	cmp r0, 0x80
	bhs MP2K_event_nxx_L84
	strb r0, [r5, o_MusicPlayerTrack_key]
	adds r3, 0x1
	ldrb r0, [r3]
	cmp r0, 0x80
	bhs MP2K_event_nxx_L83
	strb r0, [r5, o_MusicPlayerTrack_velocity]
	adds r3, 0x1
	ldrb r0, [r3]
	cmp r0, 0x80
	bhs MP2K_event_nxx_L83
	ldrb r1, [r5, o_MusicPlayerTrack_gateTime]
	adds r1, r0
	strb r1, [r5, o_MusicPlayerTrack_gateTime]
	adds r3, 0x1
MP2K_event_nxx_L83:
	str r3, [r5, o_MusicPlayerTrack_cmdPtr]
MP2K_event_nxx_L84:
	movs r0, 0
	str r0, [sp, 0x14] @ dp:value pan
	adds r4, r5, 0
	adds r4, o_MusicPlayerTrack_ToneData_type
	ldrb r2, [r4]
	movs r0, TONEDATA_TYPE_RHY | TONEDATA_TYPE_SPL
	tst r0, r2
	beq MP2K_event_nxx_L89
	ldrb r3, [r5, o_MusicPlayerTrack_key]
	movs r0, TONEDATA_TYPE_SPL
	tst r0, r2
	beq MP2K_event_nxx_L85
	ldr r1, [r5, o_MusicPlayerTrack_ToneData_keySplitTable]
	adds r1, r3
	ldrb r0, [r1]
	b MP2K_event_nxx_L86
MP2K_event_nxx_L85:
	adds r0, r3, 0
MP2K_event_nxx_L86:
	lsls r1, r0, 1
	adds r1, r0
	lsls r1, 2
	ldr r0, [r5, o_MusicPlayerTrack_ToneData_wav]
	adds r1, r0
	mov r9, r1
	mov r6, r9
	ldrb r1, [r6]
	movs r0, TONEDATA_TYPE_SPL | TONEDATA_TYPE_RHY
	tst r0, r1
	beq MP2K_event_nxx_L87
	b MP2K_event_nxx_L110
MP2K_event_nxx_L87:
	movs r0, TONEDATA_TYPE_RHY
	tst r0, r2
	beq MP2K_event_nxx_L90
	ldrb r1, [r6, o_ToneData_pan_sweep]
	movs r0, 0x80
	tst r0, r1
	beq MP2K_event_nxx_L88
	subs r1, TONEDATA_P_S_PAN
	lsls r1, 1
	str r1, [sp, 0x14] @ dp:value pan
MP2K_event_nxx_L88:
	ldrb r3, [r6, o_SoundChannel_type]
	b MP2K_event_nxx_L90
MP2K_event_nxx_L89:
	mov r9, r4
	ldrb r3, [r5, o_MusicPlayerTrack_key]
MP2K_event_nxx_L90:
	str r3, [sp, 0x8] @ dp:value key
	ldr r6, [sp]
	ldrb r1, [r6, o_MusicPlayerInfo_priority]
	ldrb r0, [r5, o_MusicPlayerTrack_priority]
	adds r0, r1
	cmp r0, 0xFF
	bls MP2K_event_nxx_L91
	movs r0, 0xFF
MP2K_event_nxx_L91:
	str r0, [sp, 0x10] @ dp:value priority
	mov r6, r9
	ldrb r0, [r6, o_ToneData_type]
	movs r6, TONEDATA_TYPE_CGB
	ands r6, r0
	str r6, [sp, 0xC] @ dp:value cgb
	beq MP2K_event_nxx_L94
	ldr r0, [sp, 0x4]
	ldr r4, [r0, o_SoundInfo_cgbChans]
	cmp r4, 0
	bne MP2K_event_nxx_L92
	b MP2K_event_nxx_L110
MP2K_event_nxx_L92:
	subs r6, 0x1
	lsls r0, r6, 6
	adds r4, r0
	ldrb r1, [r4, o_CgbChannel_statusFlags]
	movs r0, SOUND_CHANNEL_SF_ON
	tst r0, r1
	beq MP2K_event_nxx_L102
	movs r0, SOUND_CHANNEL_SF_STOP
	tst r0, r1
	bne MP2K_event_nxx_L102
	ldrb r1, [r4, o_CgbChannel_priority]
	ldr r0, [sp, 0x10]
	cmp r1, r0
	bcc MP2K_event_nxx_L102
	beq MP2K_event_nxx_L93
	b MP2K_event_nxx_L110
MP2K_event_nxx_L93:
	ldr r0, [r4, o_CgbChannel_track]
	cmp r0, r5
	bcs MP2K_event_nxx_L102
	b MP2K_event_nxx_L110
MP2K_event_nxx_L94:
	ldr r6, [sp, 0x10]
	adds r7, r5, 0
	movs r2, 0
	mov r8, r2
	ldr r4, [sp, 0x4]
	ldrb r3, [r4, o_SoundInfo_maxChans]
	adds r4, o_SoundInfo_chans
MP2K_event_nxx_L95:
	ldrb r1, [r4, o_SoundChannel_statusFlags]
	movs r0, SOUND_CHANNEL_SF_ON
	tst r0, r1
	beq MP2K_event_nxx_L102
	movs r0, SOUND_CHANNEL_SF_STOP
	tst r0, r1
	beq MP2K_event_nxx_L96
	cmp r2, 0
	bne MP2K_event_nxx_L97
	adds r2, 0x1
	ldrb r6, [r4, o_SoundChannel_priority]
	ldr r7, [r4, o_SoundChannel_track]
	b MP2K_event_nxx_L100
MP2K_event_nxx_L96:
	cmp r2, 0
	bne MP2K_event_nxx_L101
MP2K_event_nxx_L97:
	ldrb r0, [r4, o_SoundChannel_priority]
	cmp r0, r6
	bcs MP2K_event_nxx_L98
	adds r6, r0, 0
	ldr r7, [r4, o_SoundChannel_track]
	b MP2K_event_nxx_L100
MP2K_event_nxx_L98:
	bhi MP2K_event_nxx_L101
	ldr r0, [r4, o_SoundChannel_track]
	cmp r0, r7
	bls MP2K_event_nxx_L99
	adds r7, r0, 0
	b MP2K_event_nxx_L100
MP2K_event_nxx_L99:
	bcc MP2K_event_nxx_L101
MP2K_event_nxx_L100:
	mov r8, r4
MP2K_event_nxx_L101:
	adds r4, SoundChannel_size
	subs r3, 0x1
	bgt MP2K_event_nxx_L95
	mov r4, r8
	cmp r4, 0
	beq MP2K_event_nxx_L110
MP2K_event_nxx_L102:
	adds r0, r4, 0
	bl ClearChain @ dp:call ClearChain @ dp:pointer r4=chan @ dp:pointer r9=voice
	movs r1, 0
	str r1, [r4, o_SoundChannel_prevChannelPointer]
	ldr r3, [r5, o_MusicPlayerTrack_chan]
	str r3, [r4, o_SoundChannel_nextChannelPointer]
	cmp r3, 0
	beq MP2K_event_nxx_L103
	str r4, [r3, o_SoundChannel_prevChannelPointer]
MP2K_event_nxx_L103:
	str r4, [r5, o_MusicPlayerTrack_chan]
	str r5, [r4, o_SoundChannel_track]
	ldrb r0, [r5, o_MusicPlayerTrack_lfoDelay]
	strb r0, [r5, o_MusicPlayerTrack_lfoDelayC]
	cmp r0, r1
	beq MP2K_event_nxx_L104
	adds r1, r5, 0
	bl clear_modM @ dp:call clear_modM @ dp:pointer r4=chan @ dp:pointer r9=voice
MP2K_event_nxx_L104:
	ldr r0, [sp]
	adds r1, r5, 0
	bl TrkVolPitSet @ dp:call TrkVolPitSet @ dp:pointer r4=chan @ dp:pointer r9=voice
	ldr r0, [r5, o_MusicPlayerTrack_gateTime]
	str r0, [r4, o_SoundChannel_gateTime]
	ldr r0, [sp, 0x10]
	strb r0, [r4, o_SoundChannel_priority]
	ldr r0, [sp, 0x8]
	strb r0, [r4, o_SoundChannel_key]
	ldr r0, [sp, 0x14]
	strb r0, [r4, o_SoundChannel_rhythmPan]
	mov r6, r9
	ldrb r0, [r6, o_ToneData_type]
	strb r0, [r4, o_SoundChannel_type]
	ldr r7, [r6, o_ToneData_wav]
	str r7, [r4, o_SoundChannel_wav]
	ldr r0, [r6, o_ToneData_attack]
	str r0, [r4, o_SoundChannel_attack]
	ldrh r0, [r5, o_MusicPlayerTrack_pseudoEchoVolume]
	strh r0, [r4, o_SoundChannel_pseudoEchoVolume]
	bl ChnVolSetAsm @ dp:call ChnVolSetAsm @ dp:pointer r4=chan @ dp:pointer r6=voice @ dp:pointer r7=voice->data.sound.wav @ dp:pointer r9=voice
	ldrb r1, [r4, o_SoundChannel_key]
	movs r0, o_MusicPlayerTrack_keyM
	ldrsb r0, [r5, r0]
	adds r3, r1, r0
	bpl MP2K_event_nxx_L105
	movs r3, 0
MP2K_event_nxx_L105:
	ldr r6, [sp, 0xC]
	cmp r6, 0
	beq MP2K_event_nxx_L108
	mov r6, r9
	ldrb r0, [r6, o_ToneData_length]
	strb r0, [r4, o_CgbChannel_length]
	ldrb r1, [r6, o_ToneData_pan_sweep]
	movs r0, 0x80
	tst r0, r1
	bne MP2K_event_nxx_L106
	movs r0, 0x70
	tst r0, r1
	bne MP2K_event_nxx_L107
MP2K_event_nxx_L106:
	movs r1, 0x8
MP2K_event_nxx_L107:
	strb r1, [r4, o_CgbChannel_sweep]
	ldrb r2, [r5, o_MusicPlayerTrack_pitM]
	adds r1, r3, 0
	ldr r0, [sp, 0xC]
	ldr r3, [sp, 0x4]
	ldr r3, [r3, o_SoundInfo_MidiKeyToCgbFreq]
	bl call_r3 @ dp:call soundInfo->MidiKeyToCgbFreq @ dp:pointer r4=chan @ dp:pointer r6=voice @ dp:pointer r7=voice->data.sound.wav @ dp:pointer r9=voice
	b MP2K_event_nxx_L109
MP2K_event_nxx_L108:
	ldrb r2, [r5, o_MusicPlayerTrack_pitM]
	adds r1, r3, 0
	adds r0, r7, 0
	bl MidiKeyToFreq @ dp:call MidiKeyToFreq @ dp:pointer r4=chan @ dp:value r6=cgb @ dp:pointer r7=voice->data.sound.wav @ dp:pointer r9=voice
MP2K_event_nxx_L109:
	str r0, [r4, o_SoundChannel_frequency]
	movs r0, SOUND_CHANNEL_SF_START
	strb r0, [r4, o_SoundChannel_statusFlags]
	ldrb r1, [r5, o_MusicPlayerTrack_flags]
	movs r0, 0xF0
	ands r0, r1
	strb r0, [r5, o_MusicPlayerTrack_flags]
MP2K_event_nxx_L110:
	add sp, 0x18
	pop {r0-r7}
	mov r8, r0
	mov r9, r1
	mov r10, r2
	mov r11, r3
	pop {r0}
	bx r0 @ dp:return
	.pool
	.size MP2K_event_nxx, .-MP2K_event_nxx


	.align 2, 0
	.global MP2K_event_endtie
	.thumb
	.thumb_func
	.type MP2K_event_endtie, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_endtie:
	push {r4,r5}
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r3, [r2]
	cmp r3, 0x80
	bhs MP2K_event_endtie_L111
	strb r3, [r1, o_MusicPlayerTrack_key]
	adds r2, 0x1
	str r2, [r1, o_MusicPlayerTrack_cmdPtr]
	b MP2K_event_endtie_L112
MP2K_event_endtie_L111:
	ldrb r3, [r1, o_MusicPlayerTrack_key]
MP2K_event_endtie_L112:
	ldr r1, [r1, o_MusicPlayerTrack_chan]
	cmp r1, 0
	beq MP2K_event_endtie_L115
	movs r4, SOUND_CHANNEL_SF_START | SOUND_CHANNEL_SF_ENV
	movs r5, SOUND_CHANNEL_SF_STOP
MP2K_event_endtie_L113:
	ldrb r2, [r1, o_SoundChannel_statusFlags]
	tst r2, r4
	beq MP2K_event_endtie_L114
	tst r2, r5
	bne MP2K_event_endtie_L114
	ldrb r0, [r1, o_SoundChannel_midiKey]
	cmp r0, r3
	bne MP2K_event_endtie_L114
	movs r0, SOUND_CHANNEL_SF_STOP
	orrs r2, r0
	strb r2, [r1, o_SoundChannel_statusFlags]
	b MP2K_event_endtie_L115
MP2K_event_endtie_L114:
	ldr r1, [r1, o_SoundChannel_nextChannelPointer]
	cmp r1, 0
	bne MP2K_event_endtie_L113
MP2K_event_endtie_L115:
	pop {r4,r5}
	bx lr @ dp:return
	.size MP2K_event_endtie, .-MP2K_event_endtie


	.align 2, 0
	.global clear_modM
	.thumb
	.thumb_func
	.type clear_modM, function
@ dp:args r0=mplayInfo r1=track
clear_modM:
	movs r2, 0
	strb r2, [r1, o_MusicPlayerTrack_modM]
	strb r2, [r1, o_MusicPlayerTrack_lfoSpeedC]
	ldrb r2, [r1, o_MusicPlayerTrack_modT]
	cmp r2, 0
	bne clear_modM_L116
	movs r2, MPT_FLG_PITCHG
	b clear_modM_L117
clear_modM_L116:
	movs r2, MPT_FLG_VOLCHG
clear_modM_L117:
	ldrb r3, [r1, o_MusicPlayerTrack_flags]
	orrs r3, r2
	strb r3, [r1, o_MusicPlayerTrack_flags]
	bx lr
	.size clear_modM, .-clear_modM


	.align 2, 0
	.global ld_r3_tp_adr_i_unchecked
	.thumb
	.thumb_func
	.type ld_r3_tp_adr_i_unchecked, function
@ dp:args r1=track
ld_r3_tp_adr_i_unchecked:
	ldr r2, [r1, o_MusicPlayerTrack_cmdPtr]
	adds r3, r2, 1
	str r3, [r1, o_MusicPlayerTrack_cmdPtr]
	ldrb r3, [r2]
	bx lr
	.size ld_r3_tp_adr_i_unchecked, .-ld_r3_tp_adr_i_unchecked


	.align 2, 0
	.global MP2K_event_lfos
	.thumb
	.thumb_func
	.type MP2K_event_lfos, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_lfos:
	mov r12, lr
	bl ld_r3_tp_adr_i_unchecked @ dp:call ld_r3_tp_adr_i_unchecked
	strb r3, [r1, o_MusicPlayerTrack_lfoSpeed]
	cmp r3, 0
	bne MP2K_event_lfos_L118
	bl clear_modM @ dp:call clear_modM
MP2K_event_lfos_L118:
	bx r12 @ dp:end
	.size MP2K_event_lfos, .-MP2K_event_lfos


	.align 2, 0
	.global MP2K_event_mod
	.thumb
	.thumb_func
	.type MP2K_event_mod, function
@ dp:args r0=mplayInfo r1=track
MP2K_event_mod:
	mov r12, lr
	bl ld_r3_tp_adr_i_unchecked @ dp:call ld_r3_tp_adr_i_unchecked
	strb r3, [r1, o_MusicPlayerTrack_mod]
	cmp r3, 0
	bne MP2K_event_mod_L119
	bl clear_modM @ dp:call clear_modM
MP2K_event_mod_L119:
	bx r12 @ dp:end
	.size MP2K_event_mod, .-MP2K_event_mod

	.align 2, 0 @ Don't pad with nop.

	.bss
sDecodingBuffer: @ Used as a buffer for audio decoded from compressed DPCM
	.space 0x40
	.size sDecodingBuffer, .-sDecodingBuffer

