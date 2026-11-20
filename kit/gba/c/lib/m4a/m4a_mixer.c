// The m4a sound engine's mixer, MusicPlayer2000's, as C. The engine has it in assembly, partly ARM code it copies to
// the fast work memory and runs from there (SAT-R's m4a0.s, NOTICE.md), which no compiler gives back. Each frame it
// writes the samples of every channel into the buffer the sound DMA plays, in the work memory a Dreamport compares
// with the console's, so this C writes every byte of it as the ARM code does: its proof is the same memory.
//
// For the console's build, umul3232H32, SoundMain and the mixer are their instructions, as assembly the console's compiler passes
// through, written by hand from the console's instructions as npm run dp -- read prints them, which the tools'
// assembler gives back byte for byte: their proof by the same bytes (match). That's the routines' proof, and not the
// C's, which a Dreamport runs and the function check (twin) checks on its own.
#include "m4a_internal.h"

// each routine in assembly is its instructions alone, with nothing the compiler adds before or after them
#ifdef MATCHING
u32 umul3232H32(u32 multiplier, u32 multiplicand) __attribute__((naked));
void SoundMain(void) __attribute__((naked));
void SoundMainRAM(struct SoundMixerState *soundInfo, u32 dmaCounter, s8 *pcm, s32 samples, u32 maxLines) __attribute__((naked));
#endif

// A sample into a byte of the buffer, as the mixer adds it: the second byte of the sample times the channel's volume,
// added to what's there, kept to a byte.
#define MIX(at, volume, sample) (*(at) = (s8)(*(at) + (((s32)(volume) * (s32)(sample)) >> 8)))

/** The high 32 bits of an unsigned 64-bit product. dp:run 16: the engine's Thumb start and the ARM code it goes on
 *  into. */
u32 umul3232H32(u32 multiplier, u32 multiplicand)
{
#ifdef MATCHING
    asm("\tadd r2, pc, #0\n"
        "\tbx r2\n"
        ".arm\n"
        "\tumull r2, r3, r0, r1\n"
        "\tadd r0, r3, #0\n"
        "\tbx lr\n"
        ".thumb");
#else
    return (u32)(((u64)multiplier * multiplicand) >> 32);
#endif
}

/** The engine's work for a frame: the music players' step, the console's own channels, then the mix, which it
 *  goes on into in the copy in the fast work memory, and each step called through the mixer's `bx r3`. */
void SoundMain(void)
{
#ifdef MATCHING
    asm("\t.equ m4a_sound_info_ptr, 0x03000000 + 0x7FF0\n"
        "\tldr r0, .LSoundMain_sound_info_ptr\n"
        "\tldr r0, [r0, #0]\n"
        "\tldr r2, .LSoundMain_id_number\n"
        "\tldr r3, [r0, #0]\n"
        "\tcmp r2, r3\n"
        "\tbeq .LSoundMain_locked\n"
        "\tbx lr\n"
        ".LSoundMain_locked:\n"
        "\tadd r3, #1\n"
        "\tstr r3, [r0, #0]\n"
        "\tpush {r4-r7,lr}\n"
        "\tmov r1, r8\n"
        "\tmov r2, r9\n"
        "\tmov r3, r10\n"
        "\tmov r4, r11\n"
        "\tpush {r0-r4}\n"
        "\tsub sp, #24\n"
        "\tldrb r1, [r0, #12]\n"
        "\tcmp r1, #0\n"
        "\tbeq .LSoundMain_max_lines\n"
        "\tldr r2, .LSoundMain_vcount\n"
        "\tldrb r2, [r2, #0]\n"
        "\tcmp r2, #160\n"
        "\tbcs .LSoundMain_line\n"
        "\tadd r2, #228\n"
        ".LSoundMain_line:\n"
        "\tadd r1, r1, r2\n"
        ".LSoundMain_max_lines:\n"
        "\tstr r1, [sp, #20]\n"
        "\tldr r3, [r0, #32]\n"
        "\tcmp r3, #0\n"
        "\tbeq .LSoundMain_cgb\n"
        "\tldr r0, [r0, #36]\n"
        "\tbl .LSoundMainRAM_call_r3\n"
        "\tldr r0, [sp, #24]\n"
        ".LSoundMain_cgb:\n"
        "\tldr r3, [r0, #40]\n"
        "\tbl .LSoundMainRAM_call_r3\n"
        "\tldr r0, [sp, #24]\n"
        "\tldr r3, [r0, #16]\n"
        "\tmov r8, r3\n"
        "\tldr r5, .LSoundMain_pcm_buffer\n"
        "\tadd r5, r5, r0\n"
        "\tldrb r4, [r0, #4]\n"
        "\tsub r7, r4, #1\n"
        "\tbls .LSoundMain_mix\n"
        "\tldrb r1, [r0, #11]\n"
        "\tsub r1, r1, r7\n"
        "\tmov r2, r8\n"
        "\tmul r2, r1\n"
        "\tadd r5, r5, r2\n"
        ".LSoundMain_mix:\n"
        "\tstr r5, [sp, #8]\n"
        "\tldr r6, .LSoundMain_buffer_size\n"
        "\tldr r3, .LSoundMain_mixer\n"
        "\tbx r3\n"
        "\t.hword 0x0000\n"
        ".LSoundMain_sound_info_ptr:\n"
        "\t.word m4a_sound_info_ptr\n"
        ".LSoundMain_id_number:\n"
        "\t.word 0x68736D53\n"
        ".LSoundMain_mixer:\n"
        "\t.word SoundMainRAM_Buffer+1\n"
        ".LSoundMain_vcount:\n"
        "\t.word 0x04000006\n"
        ".LSoundMain_pcm_buffer:\n"
        "\t.word 0x00000350\n"
        ".LSoundMain_buffer_size:\n"
        "\t.word 0x00000630");
#else
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    u32 maxLines, dmaCounter;
    s8 *pcm;

    if (soundInfo->lockStatus != ID_NUMBER) {
        M4A_TIME(SoundMain, 0x0, 0xC, M4A_BACK, M4A_REACH(&SOUND_INFO_PTR), M4A_REACH(soundInfo));
        return;
    }
    M4A_TIME(SoundMain, 0x0, 0xA, M4A_AT(SoundMain, 0xE), M4A_REACH(&SOUND_INFO_PTR), M4A_REACH(soundInfo));
    soundInfo->lockStatus = ID_NUMBER + 1;

    // the line the mix has to end by, if there's one: as many lines on from this one, the V-blank's counted after 227
    maxLines = soundInfo->maxScanlines;
    if (maxLines != 0) {
        u32 line;
        M4A_TIME(SoundMain, 0xE, 0x24, M4A_AT(SoundMain, 0x26), M4A_REACH(soundInfo), M4A_REACH(soundInfo));
        line = *(vu8 *)REG_ADDR_VCOUNT;
        if (line < 160) {
            M4A_TIME(SoundMain, 0x26, 0x30, M4A_AT(SoundMain, 0x32), 0x04000006);
            line += 228;
        } else {
            M4A_TIME(SoundMain, 0x26, 0x2C, M4A_AT(SoundMain, 0x30), 0x04000006);
            M4A_TIME(SoundMain, 0x30, 0x30, M4A_AT(SoundMain, 0x32));
        }
        maxLines += line;
    } else {
        M4A_TIME(SoundMain, 0xE, 0x24, M4A_AT(SoundMain, 0x32), M4A_REACH(soundInfo), M4A_REACH(soundInfo));
    }

    // each is called through the mixer's `bx r3`, which the cartridge keeps after it
    if (soundInfo->MPlayMainHead != NULL) {
        M4A_TIME(SoundMain, 0x32, 0x3E, M4A_AT(SoundMainRAM, 0x39E), M4A_REACH(soundInfo), M4A_REACH(soundInfo));
        M4A_TIME(SoundMainRAM, 0x39E, 0x39E, M4A_REACH(soundInfo->MPlayMainHead));
        soundInfo->MPlayMainHead(soundInfo->musicPlayerHead);
        M4A_TIME(SoundMain, 0x40, 0x46, M4A_AT(SoundMainRAM, 0x39E), M4A_REACH(soundInfo));
    } else {
        M4A_TIME(SoundMain, 0x32, 0x38, M4A_AT(SoundMain, 0x42), M4A_REACH(soundInfo));
        M4A_TIME(SoundMain, 0x42, 0x46, M4A_AT(SoundMainRAM, 0x39E), M4A_REACH(soundInfo));
    }
    M4A_TIME(SoundMainRAM, 0x39E, 0x39E, M4A_REACH(soundInfo->CgbSound));
    soundInfo->CgbSound();

    // the part of the buffer this frame's samples go in
    pcm = soundInfo->pcmBuffer;
    dmaCounter = soundInfo->dmaCounter;
    if (dmaCounter > 1) {
        pcm += soundInfo->samplesPerFrame * (soundInfo->framesPerDmaCycle - (dmaCounter - 1));
        M4A_TIME(SoundMain, 0x48, 0x68, M4A_AT(SoundMainRAM_Buffer, 0), M4A_REACH(soundInfo), M4A_REACH(soundInfo),
                 M4A_REACH(soundInfo), soundInfo->samplesPerFrame);
    } else {
        M4A_TIME(SoundMain, 0x48, 0x56, M4A_AT(SoundMain, 0x62), M4A_REACH(soundInfo), M4A_REACH(soundInfo));
        M4A_TIME(SoundMain, 0x62, 0x68, M4A_AT(SoundMainRAM_Buffer, 0));
    }

    SoundMainRAM(soundInfo, dmaCounter, pcm, soundInfo->samplesPerFrame, maxLines);
#endif
}

/**
 * The mix, which the engine runs from its copy in the fast work memory: the frame's part of the buffer cleared, or
 * echoed if the reverb's on, then each channel's envelope stepped and its samples added in, the right half of the
 * buffer first and the left PCM_DMA_BUF_SIZE bytes on. On the console SoundMain jumps here with its own registers and
 * stack, so it's no function another calls. Its instructions are Thumb, then ARM with Thumb stretches between, to the
 * `bx r3` SoundMain calls through and the word after it, which the code map keeps as five functions: dp:run 932
 */
void SoundMainRAM(struct SoundMixerState *soundInfo, u32 dmaCounter, s8 *pcm, s32 samples, u32 maxLines)
{
#ifdef MATCHING
    asm("\tldrb r3, [r0, #5]\n"
        "\tcmp r3, #0\n"
        "\tbeq .LSoundMainRAM_60\n"
        "\tadd r1, pc, #4\n"
        "\tbx r1\n"
        "\t.hword 0x0000\n"
        ".arm\n"
        "\tcmp r4, #2\n"
        "\taddeq r7, r0, #848\n"
        "\taddne r7, r5, r8\n"
        "\tmov r4, r8\n"
        ".LSoundMainRAM_1C:\n"
        "\tldrsb r0, [r5, r6]\n"
        "\tldrsb r1, [r5, #0]\n"
        "\tadd r0, r0, r1\n"
        "\tldrsb r1, [r7, r6]\n"
        "\tadd r0, r0, r1\n"
        "\tldrsb r1, [r7], #1\n"
        "\tadd r0, r0, r1\n"
        "\tmul r1, r0, r3\n"
        "\tmov r0, r1, asr #9\n"
        "\ttst r0, #128\n"
        "\taddne r0, r0, #1\n"
        "\tstrb r0, [r5, r6]\n"
        "\tstrb r0, [r5], #1\n"
        "\tsubs r4, r4, #1\n"
        "\tbgt .LSoundMainRAM_1C\n"
        "\tadd r0, pc, #47\n"
        "\tbx r0\n"
        ".thumb\n"
        ".LSoundMainRAM_60:\n"
        "\tmov r0, #0\n"
        "\tmov r1, r8\n"
        "\tadd r6, r6, r5\n"
        "\tlsr r1, r1, #3\n"
        "\tbcc .LSoundMainRAM_6E\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        ".LSoundMainRAM_6E:\n"
        "\tlsr r1, r1, #1\n"
        "\tbcc .LSoundMainRAM_7A\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        ".LSoundMainRAM_7A:\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        "\tstmia r5!, {r0}\n"
        "\tstmia r6!, {r0}\n"
        "\tsub r1, #1\n"
        "\tbgt .LSoundMainRAM_7A\n"
        "\tldr r4, [sp, #24]\n"
        "\tldr r0, [r4, #24]\n"
        "\tmov r12, r0\n"
        "\tldrb r0, [r4, #6]\n"
        "\tadd r4, #80\n"
        ".LSoundMainRAM_98:\n"
        "\tstr r0, [sp, #4]\n"
        "\tldr r3, [r4, #36]\n"
        "\tldr r0, [sp, #20]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LSoundMainRAM_B8\n"
        "\tldr r1, .LSoundMainRAM_B4\n"
        "\tldrb r1, [r1, #0]\n"
        "\tcmp r1, #160\n"
        "\tbcs .LSoundMainRAM_AC\n"
        "\tadd r1, #228\n"
        ".LSoundMainRAM_AC:\n"
        "\tcmp r1, r0\n"
        "\tbcc .LSoundMainRAM_B8\n"
        "\tb .LSoundMainRAM_38A\n"
        "\t.hword 0x0000\n"
        ".LSoundMainRAM_B4:\n"
        "\t.word 0x04000006\n"
        ".LSoundMainRAM_B8:\n"
        "\tldrb r6, [r4, #0]\n"
        "\tmov r0, #199\n"
        "\ttst r0, r6\n"
        "\tbne .LSoundMainRAM_C2\n"
        "\tb .LSoundMainRAM_380\n"
        ".LSoundMainRAM_C2:\n"
        "\tmov r0, #128\n"
        "\ttst r0, r6\n"
        "\tbeq .LSoundMainRAM_F2\n"
        "\tmov r0, #64\n"
        "\ttst r0, r6\n"
        "\tbne .LSoundMainRAM_102\n"
        "\tmov r6, #3\n"
        "\tstrb r6, [r4, #0]\n"
        "\tmov r0, r3\n"
        "\tadd r0, #16\n"
        "\tstr r0, [r4, #40]\n"
        "\tldr r0, [r3, #12]\n"
        "\tstr r0, [r4, #24]\n"
        "\tmov r5, #0\n"
        "\tstrb r5, [r4, #9]\n"
        "\tstr r5, [r4, #28]\n"
        "\tldrb r2, [r3, #3]\n"
        "\tmov r0, #192\n"
        "\ttst r0, r2\n"
        "\tbeq .LSoundMainRAM_14A\n"
        "\tmov r0, #16\n"
        "\torr r6, r0\n"
        "\tstrb r6, [r4, #0]\n"
        "\tb .LSoundMainRAM_14A\n"
        ".LSoundMainRAM_F2:\n"
        "\tldrb r5, [r4, #9]\n"
        "\tmov r0, #4\n"
        "\ttst r0, r6\n"
        "\tbeq .LSoundMainRAM_108\n"
        "\tldrb r0, [r4, #13]\n"
        "\tsub r0, #1\n"
        "\tstrb r0, [r4, #13]\n"
        "\tbhi .LSoundMainRAM_158\n"
        ".LSoundMainRAM_102:\n"
        "\tmov r0, #0\n"
        "\tstrb r0, [r4, #0]\n"
        "\tb .LSoundMainRAM_380\n"
        ".LSoundMainRAM_108:\n"
        "\tmov r0, #64\n"
        "\ttst r0, r6\n"
        "\tbeq .LSoundMainRAM_128\n"
        "\tldrb r0, [r4, #7]\n"
        "\tmul r5, r0\n"
        "\tlsr r5, r5, #8\n"
        "\tldrb r0, [r4, #12]\n"
        "\tcmp r5, r0\n"
        "\tbhi .LSoundMainRAM_158\n"
        ".LSoundMainRAM_11A:\n"
        "\tldrb r5, [r4, #12]\n"
        "\tcmp r5, #0\n"
        "\tbeq .LSoundMainRAM_102\n"
        "\tmov r0, #4\n"
        "\torr r6, r0\n"
        "\tstrb r6, [r4, #0]\n"
        "\tb .LSoundMainRAM_158\n"
        ".LSoundMainRAM_128:\n"
        "\tmov r2, #3\n"
        "\tand r2, r6\n"
        "\tcmp r2, #2\n"
        "\tbne .LSoundMainRAM_146\n"
        "\tldrb r0, [r4, #5]\n"
        "\tmul r5, r0\n"
        "\tlsr r5, r5, #8\n"
        "\tldrb r0, [r4, #6]\n"
        "\tcmp r5, r0\n"
        "\tbhi .LSoundMainRAM_158\n"
        "\tmov r5, r0\n"
        "\tbeq .LSoundMainRAM_11A\n"
        "\tsub r6, #1\n"
        "\tstrb r6, [r4, #0]\n"
        "\tb .LSoundMainRAM_158\n"
        ".LSoundMainRAM_146:\n"
        "\tcmp r2, #3\n"
        "\tbne .LSoundMainRAM_158\n"
        ".LSoundMainRAM_14A:\n"
        "\tldrb r0, [r4, #4]\n"
        "\tadd r5, r5, r0\n"
        "\tcmp r5, #255\n"
        "\tbcc .LSoundMainRAM_158\n"
        "\tmov r5, #255\n"
        "\tsub r6, #1\n"
        "\tstrb r6, [r4, #0]\n"
        ".LSoundMainRAM_158:\n"
        "\tstrb r5, [r4, #9]\n"
        "\tldr r0, [sp, #24]\n"
        "\tldrb r0, [r0, #7]\n"
        "\tadd r0, #1\n"
        "\tmul r0, r5\n"
        "\tlsr r5, r0, #4\n"
        "\tldrb r0, [r4, #2]\n"
        "\tmul r0, r5\n"
        "\tlsr r0, r0, #8\n"
        "\tstrb r0, [r4, #10]\n"
        "\tldrb r0, [r4, #3]\n"
        "\tmul r0, r5\n"
        "\tlsr r0, r0, #8\n"
        "\tstrb r0, [r4, #11]\n"
        "\tmov r0, #16\n"
        "\tand r0, r6\n"
        "\tstr r0, [sp, #16]\n"
        "\tbeq .LSoundMainRAM_18C\n"
        "\tmov r0, r3\n"
        "\tadd r0, #16\n"
        "\tldr r1, [r3, #8]\n"
        "\tadd r0, r0, r1\n"
        "\tstr r0, [sp, #12]\n"
        "\tldr r0, [r3, #12]\n"
        "\tsub r0, r0, r1\n"
        "\tstr r0, [sp, #16]\n"
        ".LSoundMainRAM_18C:\n"
        "\tldr r5, [sp, #8]\n"
        "\tldr r2, [r4, #24]\n"
        "\tldr r3, [r4, #40]\n"
        "\tadd r0, pc, #4\n"
        "\tbx r0\n"
        "\t.hword 0x0000\n"
        ".arm\n"
        "\tstr r8, [sp, #0]\n"
        "\tldrb r10, [r4, #10]\n"
        "\tldrb r11, [r4, #11]\n"
        "\tmov r10, r10, lsl #16\n"
        "\tmov r11, r11, lsl #16\n"
        "\tldrb r0, [r4, #1]\n"
        "\ttst r0, #8\n"
        "\tbeq .LSoundMainRAM_2D8\n"
        ".LSoundMainRAM_1B8:\n"
        "\tcmp r2, #4\n"
        "\tble .LSoundMainRAM_228\n"
        "\tsubs r2, r2, r8\n"
        "\tmovgt lr, #0\n"
        "\tbgt .LSoundMainRAM_1E4\n"
        "\tmov lr, r8\n"
        "\tadd r2, r2, r8\n"
        "\tsub r8, r2, #4\n"
        "\tsub lr, lr, r8\n"
        "\tands r2, r2, #3\n"
        "\tmoveq r2, #4\n"
        ".LSoundMainRAM_1E4:\n"
        "\tldr r6, [r5, #0]\n"
        "\tldr r7, [r5, #1584]\n"
        ".LSoundMainRAM_1EC:\n"
        "\tldrsb r0, [r3], #1\n"
        "\tmul r1, r10, r0\n"
        "\tbic r1, r1, #16711680\n"
        "\tadd r6, r1, r6, ror #8\n"
        "\tmul r1, r11, r0\n"
        "\tbic r1, r1, #16711680\n"
        "\tadd r7, r1, r7, ror #8\n"
        "\tadds r5, r5, #1073741824\n"
        "\tbcc .LSoundMainRAM_1EC\n"
        "\tstr r7, [r5, #1584]\n"
        "\tstr r6, [r5], #4\n"
        "\tsubs r8, r8, #4\n"
        "\tbgt .LSoundMainRAM_1E4\n"
        "\tadds r8, r8, lr\n"
        "\tbeq .LSoundMainRAM_36C\n"
        ".LSoundMainRAM_228:\n"
        "\tldr r6, [r5, #0]\n"
        "\tldr r7, [r5, #1584]\n"
        ".LSoundMainRAM_230:\n"
        "\tldrsb r0, [r3], #1\n"
        "\tmul r1, r10, r0\n"
        "\tbic r1, r1, #16711680\n"
        "\tadd r6, r1, r6, ror #8\n"
        "\tmul r1, r11, r0\n"
        "\tbic r1, r1, #16711680\n"
        "\tadd r7, r1, r7, ror #8\n"
        "\tsubs r2, r2, #1\n"
        "\tbeq .LSoundMainRAM_2A0\n"
        ".LSoundMainRAM_254:\n"
        "\tadds r5, r5, #1073741824\n"
        "\tbcc .LSoundMainRAM_230\n"
        "\tstr r7, [r5, #1584]\n"
        "\tstr r6, [r5], #4\n"
        "\tsubs r8, r8, #4\n"
        "\tbgt .LSoundMainRAM_1B8\n"
        "\tb .LSoundMainRAM_36C\n"
        ".LSoundMainRAM_270:\n"
        "\tldr r0, [sp, #24]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LSoundMainRAM_294\n"
        "\tldr r3, [sp, #20]\n"
        "\trsb r9, r2, #0\n"
        ".LSoundMainRAM_284:\n"
        "\tadds r2, r0, r2\n"
        "\tbgt .LSoundMainRAM_33C\n"
        "\tsub r9, r9, r0\n"
        "\tb .LSoundMainRAM_284\n"
        ".LSoundMainRAM_294:\n"
        "\tldmia sp!, {r4,r12}\n"
        "\tmov r2, #0\n"
        "\tb .LSoundMainRAM_2B0\n"
        ".LSoundMainRAM_2A0:\n"
        "\tldr r2, [sp, #16]\n"
        "\tcmp r2, #0\n"
        "\tldrne r3, [sp, #12]\n"
        "\tbne .LSoundMainRAM_254\n"
        ".LSoundMainRAM_2B0:\n"
        "\tstrb r2, [r4, #0]\n"
        "\tmov r0, r5, lsr #30\n"
        "\tbic r5, r5, #-1073741824\n"
        "\trsb r0, r0, #3\n"
        "\tmov r0, r0, lsl #3\n"
        "\tmov r6, r6, ror r0\n"
        "\tmov r7, r7, ror r0\n"
        "\tstr r7, [r5, #1584]\n"
        "\tstr r6, [r5], #4\n"
        "\tb .LSoundMainRAM_374\n"
        ".LSoundMainRAM_2D8:\n"
        "\tstmdb sp!, {r4,r12}\n"
        "\tldr lr, [r4, #28]\n"
        "\tldr r1, [r4, #32]\n"
        "\tmul r4, r12, r1\n"
        "\tldrsb r0, [r3, #0]\n"
        "\tldrsb r1, [r3, #1]!\n"
        "\tsub r1, r1, r0\n"
        ".LSoundMainRAM_2F4:\n"
        "\tldr r6, [r5, #0]\n"
        "\tldr r7, [r5, #1584]\n"
        ".LSoundMainRAM_2FC:\n"
        "\tmul r9, lr, r1\n"
        "\tadd r9, r0, r9, asr #23\n"
        "\tmul r12, r10, r9\n"
        "\tbic r12, r12, #16711680\n"
        "\tadd r6, r12, r6, ror #8\n"
        "\tmul r12, r11, r9\n"
        "\tbic r12, r12, #16711680\n"
        "\tadd r7, r12, r7, ror #8\n"
        "\tadd lr, lr, r4\n"
        "\tmovs r9, lr, lsr #23\n"
        "\tbeq .LSoundMainRAM_348\n"
        "\tbic lr, lr, #1065353216\n"
        "\tsubs r2, r2, r9\n"
        "\tble .LSoundMainRAM_270\n"
        "\tsubs r9, r9, #1\n"
        "\taddeq r0, r0, r1\n"
        ".LSoundMainRAM_33C:\n"
        "\tldrnesb r0, [r3, r9]!\n"
        "\tldrsb r1, [r3, #1]!\n"
        "\tsub r1, r1, r0\n"
        ".LSoundMainRAM_348:\n"
        "\tadds r5, r5, #1073741824\n"
        "\tbcc .LSoundMainRAM_2FC\n"
        "\tstr r7, [r5, #1584]\n"
        "\tstr r6, [r5], #4\n"
        "\tsubs r8, r8, #4\n"
        "\tbgt .LSoundMainRAM_2F4\n"
        "\tsub r3, r3, #1\n"
        "\tldmia sp!, {r4,r12}\n"
        "\tstr lr, [r4, #28]\n"
        ".LSoundMainRAM_36C:\n"
        "\tstr r2, [r4, #24]\n"
        "\tstr r3, [r4, #40]\n"
        ".LSoundMainRAM_374:\n"
        "\tldr r8, [sp, #0]\n"
        "\tadd r0, pc, #1\n"
        "\tbx r0\n"
        ".thumb\n"
        ".LSoundMainRAM_380:\n"
        "\tldr r0, [sp, #4]\n"
        "\tsub r0, #1\n"
        "\tble .LSoundMainRAM_38A\n"
        "\tadd r4, #64\n"
        "\tb .LSoundMainRAM_98\n"
        ".LSoundMainRAM_38A:\n"
        "\tldr r0, [sp, #24]\n"
        "\tldr r3, .LSoundMainRAM_3A0\n"
        "\tstr r3, [r0, #0]\n"
        "\tadd sp, #28\n"
        "\tpop {r0-r7}\n"
        "\tmov r8, r0\n"
        "\tmov r9, r1\n"
        "\tmov r10, r2\n"
        "\tmov r11, r3\n"
        "\tpop {r3}\n"
        ".LSoundMainRAM_call_r3:\n"
        "\tbx r3\n"
        ".LSoundMainRAM_3A0:\n"
        "\t.word 0x68736D53");
#else
    struct MixerSource *chan;
    s32 chansLeft;

    if (soundInfo->reverb != 0) {
        // the frame's samples, each the reverb's share of four: its own and the other half's, and the next frame's
        // or the buffer's start
        s32 reverb = soundInfo->reverb, n = samples;
        s8 *at = pcm, *other = dmaCounter == 2 ? soundInfo->pcmBuffer : pcm + samples;
        do {
            s32 sum = at[PCM_DMA_BUF_SIZE] + at[0] + other[PCM_DMA_BUF_SIZE] + other[0];
            s32 echo = (sum * reverb) >> 9;
            if (echo & 0x80)
                echo++;
            at[PCM_DMA_BUF_SIZE] = echo;
            at[0] = echo;
            at++;
            other++;
        } while (--n > 0);
    } else {
        // cleared a word at a time, sixteen bytes a turn and at least one turn
        u32 *right = (u32 *)pcm, *left = (u32 *)(pcm + PCM_DMA_BUF_SIZE);
        s32 n;
        M4A_TIME(SoundMainRAM_Buffer, 0x0, 0x4, M4A_AT(SoundMainRAM_Buffer, 0x60), M4A_REACH(soundInfo));
        M4A_TIME(SoundMainRAM_Buffer, 0x60, 0x68, M4A_AT(SoundMainRAM_Buffer, samples & 4 ? 0x6A : 0x6E));
        if (samples & 4) {
            *right++ = 0;
            *left++ = 0;
            M4A_TIME(SoundMainRAM_Buffer, 0x6A, 0x6C, M4A_AT(SoundMainRAM_Buffer, 0x6E), M4A_REACH(right), M4A_REACH(left));
        }
        M4A_TIME(SoundMainRAM_Buffer, 0x6E, 0x70, M4A_AT(SoundMainRAM_Buffer, samples & 8 ? 0x72 : 0x7A));
        if (samples & 8) {
            *right++ = 0;
            *left++ = 0;
            *right++ = 0;
            *left++ = 0;
            M4A_TIME(SoundMainRAM_Buffer, 0x72, 0x78, M4A_AT(SoundMainRAM_Buffer, 0x7A), M4A_REACH(right), M4A_REACH(left),
                     M4A_REACH(right), M4A_REACH(left));
        }
        n = (u32)samples >> 4;
        do {
            right[0] = 0; right[1] = 0; right[2] = 0; right[3] = 0;
            left[0] = 0; left[1] = 0; left[2] = 0; left[3] = 0;
            M4A_TIME(SoundMainRAM_Buffer, 0x7A, 0x8C, M4A_AT(SoundMainRAM_Buffer, n > 1 ? 0x7A : 0x8E), M4A_REACH(right),
                     M4A_REACH(left), M4A_REACH(right), M4A_REACH(left), M4A_REACH(right), M4A_REACH(left), M4A_REACH(right),
                     M4A_REACH(left));
            right += 4;
            left += 4;
        } while (--n > 0);
    }
    M4A_TIME(SoundMainRAM_Buffer, 0x8E, 0x96, M4A_AT(SoundMainRAM_Buffer, 0x98), M4A_REACH(soundInfo), M4A_REACH(soundInfo));

    chan = soundInfo->chans;
    chansLeft = soundInfo->numChans;
    do {
        struct WaveData *wav = chan->wav;
        u32 status, envelope, loopLength;
        s32 count, done, k, volumeRight, volumeLeft;
        s8 *at, *loopStart = NULL;

        // no more channels once the line the mix has to end by is reached
        M4A_TIME(SoundMainRAM_Buffer, 0x98, 0xA0, M4A_AT(SoundMainRAM_Buffer, maxLines != 0 ? 0xA2 : 0xB8), M4A_REACH(chan));
        if (maxLines != 0) {
            u32 line = *(vu8 *)REG_ADDR_VCOUNT;
            if (line < 160) {
                M4A_TIME(SoundMainRAM_Buffer, 0xA2, 0xAA, M4A_AT(SoundMainRAM_Buffer, 0xAC), 0x04000006);
                line += 228;
            } else {
                M4A_TIME(SoundMainRAM_Buffer, 0xA2, 0xA8, M4A_AT(SoundMainRAM_Buffer, 0xAC), 0x04000006);
            }
            if (line >= maxLines) {
                M4A_TIME(SoundMainRAM_Buffer, 0xAC, 0xB0, M4A_AT(SoundMainRAM_Buffer, 0x38A));
                break;
            }
            M4A_TIME(SoundMainRAM_Buffer, 0xAC, 0xAE, M4A_AT(SoundMainRAM_Buffer, 0xB8));
        }

        status = chan->status;
        if (!(status & SOUND_CHANNEL_SF_ON)) {
            M4A_TIME(SoundMainRAM_Buffer, 0xB8, 0xC0, M4A_AT(SoundMainRAM_Buffer, 0x380), M4A_REACH(chan));
            goto next;
        }

        // the envelope's step
        if (status & SOUND_CHANNEL_SF_START) {
            if (status & SOUND_CHANNEL_SF_STOP)
                goto stop;
            status = SOUND_CHANNEL_SF_ENV_ATTACK;
            chan->status = status;
            chan->current = wav->data;
            chan->data.sound.ct = wav->size;
            envelope = 0;
            chan->data.sound.envelopeVol = 0;
            chan->data.sound.fw = 0;
            if (wav->status & 0xC000) {
                status |= SOUND_CHANNEL_SF_LOOP;
                chan->status = status;
            }
            goto attack;
        }
        envelope = chan->data.sound.envelopeVol;
        if (status & SOUND_CHANNEL_SF_IEC) {
            u32 length = chan->data.sound.echoLen;
            chan->data.sound.echoLen = length - 1;
            if (length > 1)
                goto set;
            goto stop;
        }
        if (status & SOUND_CHANNEL_SF_STOP) {
            envelope = (envelope * chan->data.sound.release) >> 8;
            if (envelope > chan->data.sound.echoVol)
                goto set;
        echo:
            envelope = chan->data.sound.echoVol;
            if (envelope == 0)
                goto stop;
            status |= SOUND_CHANNEL_SF_IEC;
            chan->status = status;
            goto set;
        }
        if ((status & SOUND_CHANNEL_SF_ENV) == SOUND_CHANNEL_SF_ENV_DECAY) {
            envelope = (envelope * chan->data.sound.decay) >> 8;
            if (envelope > chan->data.sound.sustain)
                goto set;
            envelope = chan->data.sound.sustain;
            if (envelope == 0)
                goto echo;
            status--;
            chan->status = status;
            goto set;
        }
        if ((status & SOUND_CHANNEL_SF_ENV) != SOUND_CHANNEL_SF_ENV_ATTACK)
            goto set;
    attack:
        envelope += chan->data.sound.attack;
        if (envelope >= 0xFF) {
            envelope = 0xFF;
            status--;
            chan->status = status;
        }
    set:
        chan->data.sound.envelopeVol = envelope;
        envelope = ((soundInfo->masterVol + 1) * envelope) >> 4;
        chan->data.sound.envelopeVolR = (chan->rightVol * envelope) >> 8;
        chan->data.sound.envelopeVolL = (chan->leftVol * envelope) >> 8;

        loopLength = status & SOUND_CHANNEL_SF_LOOP;
        if (loopLength) {
            loopStart = wav->data + wav->loopStart;
            loopLength = wav->size - wav->loopStart;
        }

        // the samples, four bytes of each half a turn and at least one turn
        volumeRight = chan->data.sound.envelopeVolR;
        volumeLeft = chan->data.sound.envelopeVolL;
        count = chan->data.sound.ct;
        at = pcm;
        done = samples;
        if (chan->type & TONEDATA_TYPE_FIX) {
            // a sample for each of the buffer's
            s8 *from = chan->current;
            do {
                for (k = 0; k < 4; k++, at++) {
                    s32 sample = *from++;
                    MIX(at, volumeRight, sample);
                    MIX(at + PCM_DMA_BUF_SIZE, volumeLeft, sample);
                    if (--count == 0) {
                        if (loopLength == 0) {
                            chan->status = 0;
                            goto next;
                        }
                        from = loopStart;
                        count = loopLength;
                    }
                }
            } while ((done -= 4) > 0);
            chan->data.sound.ct = count;
            chan->current = from;
        } else {
            // the wave at the channel's frequency: between two samples, a step of the frequency each
            u32 place = chan->data.sound.fw, step = soundInfo->sampleRateReciprocal * chan->data.sound.freq;
            s8 *from = chan->current;
            s32 sample = from[0], rise;
            from++;
            rise = from[0] - sample;
            do {
                for (k = 0; k < 4; k++, at++) {
                    s32 value = sample + ((s32)(place * (u32)rise) >> 23), on;
                    MIX(at, volumeRight, value);
                    MIX(at + PCM_DMA_BUF_SIZE, volumeLeft, value);
                    place += step;
                    on = place >> 23;
                    if (on == 0)
                        continue;
                    place &= ~0x3F800000;
                    count -= on;
                    if (count <= 0) {
                        s32 past;
                        if (loopLength == 0) {
                            chan->status = 0;
                            goto next;
                        }
                        past = -count;
                        for (;;) {
                            count += loopLength;
                            if (count > 0)
                                break;
                            past -= loopLength;
                        }
                        from = loopStart + past;
                        sample = *from;
                    } else if (--on == 0) {
                        sample += rise;
                    } else {
                        from += on;
                        sample = *from;
                    }
                    from++;
                    rise = *from - sample;
                }
            } while ((done -= 4) > 0);
            chan->data.sound.fw = place;
            chan->data.sound.ct = count;
            chan->current = from - 1;
        }
        goto next;

    stop:
        chan->status = 0;
    next:
        chan++;
        M4A_TIME_WHEN(chansLeft > 1, SoundMainRAM_Buffer, 0x380, 0x388, M4A_AT(SoundMainRAM_Buffer, 0x98));
        M4A_TIME_WHEN(chansLeft <= 1, SoundMainRAM_Buffer, 0x380, 0x384, M4A_AT(SoundMainRAM_Buffer, 0x38A));
    } while (--chansLeft > 0);

    // back to whoever called SoundMain, whose registers and return it gives back
    soundInfo->lockStatus = ID_NUMBER;
    M4A_TIME(SoundMainRAM_Buffer, 0x38A, 0x39E, M4A_BACK, M4A_REACH(soundInfo));
#endif
}
