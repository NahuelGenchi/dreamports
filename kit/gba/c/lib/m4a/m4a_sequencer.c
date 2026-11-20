// The m4a sound engine's sequencer, MusicPlayer2000's, as C: what reads each track's commands and starts and stops its
// notes. The engine has it in Thumb assembly (SAT-R's m4a0.s, NOTICE.md), which no compiler gives back, so this C does
// an instruction's work at a time, and its proof is the same memory.
//
// A few of its routines take and give values in registers no C function uses (ldrb_r3_r2, chk_adr_r2,
// ld_r3_tp_adr_i, ld_r3_tp_adr_i_unchecked, ChnVolSetAsm): here they're C functions, and the comment of each that
// takes and gives in r0 to r3 says how, dp:registers, which the function check compares (tools/README.md).
//
// For the console's build, each routine is its instructions, as assembly the console's compiler passes through,
// written by hand from the console's instructions as npm run dp -- read prints them, which the tools' assembler gives
// back byte for byte: their proof by the same bytes (match). The routines are in the order the cartridge has them,
// as some load a word another keeps beside its code. That's the routines' proof, and not the C's, which a Dreamport
// runs and the function check (twin) checks on its own.
#include "m4a_internal.h"

// each routine in assembly is its instructions alone, with nothing the compiler adds before or after them
#ifdef MATCHING
void SoundMainBTM(void *at) __attribute__((naked));
void MP2KClearChain(struct MixerSource *chan) __attribute__((naked));
void MP2K_event_fine(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MPlayJumpTableCopy(void **table) __attribute__((naked));
u32 ldrb_r3_r2(const u8 *at) __attribute__((naked));
u32 ld_r3_tp_adr_i(struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_goto(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_patt(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_pend(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_rept(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_prio(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_tempo(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_keysh(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_voice(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_vol(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_pan(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_bend(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_bendr(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_lfodl(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_modt(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_tune(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_port(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void m4aSoundVSync(void) __attribute__((naked));
void MP2KPlayerMain(struct MP2KPlayerState *mplayInfo) __attribute__((naked));
void TrackStop(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void ChnVolSetAsm(struct MixerSource *chan, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_nxx(u8 clock, struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_endtie(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void clear_modM(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
u32 ld_r3_tp_adr_i_unchecked(struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_lfos(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
void MP2K_event_mod(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track) __attribute__((naked));
#endif

/** Clears the 64 bytes at `at`, as four stm store them: from the word `at` is in, when it isn't on a word. */
void SoundMainBTM(void *at)
{
#ifdef MATCHING
    asm("\tmov r12, r4\n"
        "\tmov r1, #0\n"
        "\tmov r2, #0\n"
        "\tmov r3, #0\n"
        "\tmov r4, #0\n"
        "\tstmia r0!, {r1-r4}\n"
        "\tstmia r0!, {r1-r4}\n"
        "\tstmia r0!, {r1-r4}\n"
        "\tstmia r0!, {r1-r4}\n"
        "\tmov r4, r12\n"
        "\tbx lr");
#else
    u32 *word = M4A_STM_AT(u32, at);
    u32 i;
    for (i = 0; i < 16; i++)
        word[i] = 0;
    M4A_TIME(SoundMainBTM, 0x0, 0x14, M4A_BACK, M4A_EW, M4A_EW, M4A_EW, M4A_EW);
#endif
}

/** Takes a channel out of its track's chain of channels, if it's in one. */
void MP2KClearChain(struct MixerSource *chan)
{
#ifdef MATCHING
    asm("\tldr r3, [r0, #44]\n"
        "\tcmp r3, #0\n"
        "\tbeq .LMP2KClearChain_1E\n"
        "\tldr r1, [r0, #52]\n"
        "\tldr r2, [r0, #48]\n"
        "\tcmp r2, #0\n"
        "\tbeq .LMP2KClearChain_12\n"
        "\tstr r1, [r2, #52]\n"
        "\tb .LMP2KClearChain_14\n"
        ".LMP2KClearChain_12:\n"
        "\tstr r1, [r3, #32]\n"
        ".LMP2KClearChain_14:\n"
        "\tcmp r1, #0\n"
        "\tbeq .LMP2KClearChain_1A\n"
        "\tstr r2, [r1, #48]\n"
        ".LMP2KClearChain_1A:\n"
        "\tmov r1, #0\n"
        "\tstr r1, [r0, #44]\n"
        ".LMP2KClearChain_1E:\n"
        "\tbx lr");
#else
    struct MP2KTrack *track = chan->track;
    struct MixerSource *next, *prev;
    if (track == NULL)
        return;
    next = chan->next;
    prev = chan->prev;
    if (prev != NULL)
        prev->next = next;
    else
        track->chan = next;
    if (next != NULL)
        next->prev = prev;
    chan->track = NULL;
#endif
}

/** The command that ends a track: each of its channels told to stop and taken out of its chain. */
void MP2K_event_fine(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tpush {r4-r5,lr}\n"
        "\tmov r5, r1\n"
        "\tldr r4, [r5, #32]\n"
        "\tcmp r4, #0\n"
        "\tbeq .LMP2K_event_fine_24\n"
        ".LMP2K_event_fine_A:\n"
        "\tldrb r1, [r4, #0]\n"
        "\tmov r0, #199\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2K_event_fine_18\n"
        "\tmov r0, #64\n"
        "\torr r1, r0\n"
        "\tstrb r1, [r4, #0]\n"
        ".LMP2K_event_fine_18:\n"
        "\tmov r0, r4\n"
        "\tbl MP2KClearChain\n"
        "\tldr r4, [r4, #52]\n"
        "\tcmp r4, #0\n"
        "\tbne .LMP2K_event_fine_A\n"
        ".LMP2K_event_fine_24:\n"
        "\tmov r0, #0\n"
        "\tstrb r0, [r5, #0]\n"
        "\tpop {r4-r5}\n"
        "\tpop {r0}\n"
        "\tbx r0");
#else
    struct MixerSource *chan;
    for (chan = track->chan; chan != NULL; chan = chan->next) {
        if (chan->status & SOUND_CHANNEL_SF_ON)
            chan->status |= SOUND_CHANNEL_SF_STOP;
        MP2KClearChain(chan);
    }
    track->status = 0;
#endif
}

/** The sequencer's 36 commands, each its function's address, from the cartridge's table into `table`. */
void MPlayJumpTableCopy(void **table)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tmov r1, #36\n"
        "\tldr r2, .Lchk_adr_r2_template\n"
        ".LMPlayJumpTableCopy_6:\n"
        "\tldr r3, [r2, #0]\n"
        "\tbl .Lldrb_r3_r2_2\n"
        "\tstmia r0!, {r3}\n"
        "\tadd r2, #4\n"
        "\tsub r1, #1\n"
        "\tbgt .LMPlayJumpTableCopy_6\n"
        "\tbx r12\n"
        "\tlsl r0, r0, #0");
#else
    void *const *from = gMPlayJumpTableTemplate;
    s32 i;
    M4A_TIME(MPlayJumpTableCopy, 0x0, 0xA, M4A_AT(chk_adr_r2, 0), M4A_ROM);
    // each word stored as stm stores it, and the table's address moved on by 4 from wherever it started
    for (i = 0x24; i > 0; i--, from++) {
        *M4A_STM_AT(void *, table) = chk_adr_r2(from) ? *from : NULL;
        table++;
        // the next command's load and check, or back
        if (i > 1) {
            M4A_TIME(MPlayJumpTableCopy, 0xC, 0x12, M4A_AT(MPlayJumpTableCopy, 0x6), M4A_EW);
            M4A_TIME(MPlayJumpTableCopy, 0x6, 0xA, M4A_AT(chk_adr_r2, 0), M4A_ROM);
        } else
            M4A_TIME(MPlayJumpTableCopy, 0xC, 0x14, M4A_BACK, M4A_EW);
    }
#endif
}

/**
 * The byte at `at`, if the engine reads there. The engine's routine takes the address in r2, loads the byte into r3
 * and runs on into chk_adr_r2's instructions, which are its own for the console's build, as the code map keeps them
 * as a function of their own: dp:run 28
 * dp:registers r3 = ldrb_r3_r2((const u8 *)r2)
 */
u32 ldrb_r3_r2(const u8 *at)
{
#ifdef MATCHING
    asm("\tldrb r3, [r2, #0]\n"
        ".Lldrb_r3_r2_2:\n"
        "\tpush {r0}\n"
        "\tlsr r0, r2, #25\n"
        "\tbne .Lchk_adr_r2_done\n"
        "\tldr r0, .Lchk_adr_r2_template\n"
        "\tcmp r2, r0\n"
        "\tbcc .Lchk_adr_r2_reject\n"
        "\tlsr r0, r2, #14\n"
        "\tbeq .Lchk_adr_r2_done\n"
        ".Lchk_adr_r2_reject:\n"
        "\tmov r3, #0\n"
        ".Lchk_adr_r2_done:\n"
        "\tpop {r0}\n"
        "\tbx lr\n"
        ".Lchk_adr_r2_template:\n"
        "\t.word gMPlayJumpTableTemplate");
#else
    return chk_adr_r2(at) ? *at : 0;
#endif
}

// for the console's build, ldrb_r3_r2's assembly runs on into chk_adr_r2's instructions, so they're that run's
#ifndef MATCHING
/**
 * Whether the engine reads at `at`: anywhere from the work memory on, and in the BIOS only from its own table of
 * commands up, which is never, as that table is in the cartridge. A value it won't read is 0. The engine's routine
 * takes the address in r2 and a value read from it in r3, which it gives back, or 0:
 * dp:registers r3 = chk_adr_r2((const void *)r2) ? r3 : 0
 */
u32 chk_adr_r2(const void *at)
{
    if ((u32)at >> 25) {
        M4A_TIME(chk_adr_r2, 0x0, 0x4, M4A_AT(chk_adr_r2, 0x12));
        M4A_TIME(chk_adr_r2, 0x12, 0x14, M4A_BACK);
        return TRUE;
    }
    if ((u32)at < (u32)gMPlayJumpTableTemplate)
        return FALSE;
    return ((u32)at >> 14) == 0;
}
#endif

/**
 * The track's next byte of commands, if the engine reads there. The engine's routine takes the track in r1 and gives
 * the byte back in r3, and is 10 bytes, of which the code map keeps the last 8 as a function of their own: dp:run 10
 * dp:registers r3 = ld_r3_tp_adr_i((struct MP2KTrack *)r1)
 */
u32 ld_r3_tp_adr_i(struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tldr r2, [r1, #64]\n"
        ".Lld_r3_tp_adr_i_2:\n"
        "\tadd r3, r2, #1\n"
        "\tstr r3, [r1, #64]\n"
        "\tldrb r3, [r2, #0]\n"
        "\tb .Lldrb_r3_r2_2");
#else
    u8 *at = track->cmdPtr;
    track->cmdPtr = at + 1;
    return ldrb_r3_r2(at);
#endif
}

/** Goes on from the address the next four bytes give. */
void MP2K_event_goto(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tpush {lr}\n"
        ".LMP2K_event_goto_2:\n"
        "\tldr r2, [r1, #64]\n"
        "\tldrb r0, [r2, #3]\n"
        "\tlsl r0, r0, #8\n"
        "\tldrb r3, [r2, #2]\n"
        "\torr r0, r3\n"
        "\tlsl r0, r0, #8\n"
        "\tldrb r3, [r2, #1]\n"
        "\torr r0, r3\n"
        "\tlsl r0, r0, #8\n"
        "\tbl ldrb_r3_r2\n"
        "\torr r0, r3\n"
        "\tstr r0, [r1, #64]\n"
        "\tpop {r0}\n"
        "\tbx r0");
#else
    u8 *at = track->cmdPtr;
    track->cmdPtr = (u8 *)((u32)at[3] << 24 | (u32)at[2] << 16 | (u32)at[1] << 8 | ldrb_r3_r2(at));
#endif
}

/** Calls a pattern, three deep at most, or ends the track. */
void MP2K_event_patt(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tldrb r2, [r1, #2]\n"
        "\tcmp r2, #3\n"
        "\tbcs .LMP2K_event_patt_18\n"
        "\tlsl r2, r2, #2\n"
        "\tadd r3, r1, r2\n"
        "\tldr r2, [r1, #64]\n"
        "\tadd r2, #4\n"
        "\tstr r2, [r3, #68]\n"
        "\tldrb r2, [r1, #2]\n"
        "\tadd r2, #1\n"
        "\tstrb r2, [r1, #2]\n"
        "\tb MP2K_event_goto\n"
        ".LMP2K_event_patt_18:\n"
        "\tb MP2K_event_fine");
#else
    if (track->patternLevel >= 3) {
        MP2K_event_fine(mplayInfo, track);
        return;
    }
    track->patternStack[track->patternLevel] = track->cmdPtr + 4;
    track->patternLevel++;
    MP2K_event_goto(mplayInfo, track);
#endif
}

/** Back from a pattern. */
void MP2K_event_pend(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tldrb r2, [r1, #2]\n"
        "\tcmp r2, #0\n"
        "\tbeq .LMP2K_event_pend_12\n"
        "\tsub r2, #1\n"
        "\tstrb r2, [r1, #2]\n"
        "\tlsl r2, r2, #2\n"
        "\tadd r3, r1, r2\n"
        "\tldr r2, [r3, #68]\n"
        "\tstr r2, [r1, #64]\n"
        ".LMP2K_event_pend_12:\n"
        "\tbx lr");
#else
    if (track->patternLevel == 0)
        return;
    track->patternLevel--;
    track->cmdPtr = track->patternStack[track->patternLevel];
#endif
}

/** Goes back to an address a number of times, or for ever with 0. */
void MP2K_event_rept(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tpush {lr}\n"
        "\tldr r2, [r1, #64]\n"
        "\tldrb r3, [r2, #0]\n"
        "\tcmp r3, #0\n"
        "\tbne .LMP2K_event_rept_10\n"
        "\tadd r2, #1\n"
        "\tstr r2, [r1, #64]\n"
        "\tb .LMP2K_event_goto_2\n"
        ".LMP2K_event_rept_10:\n"
        "\tldrb r3, [r1, #3]\n"
        "\tadd r3, #1\n"
        "\tstrb r3, [r1, #3]\n"
        "\tmov r12, r3\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tcmp r12, r3\n"
        "\tbcs .LMP2K_event_rept_22\n"
        "\tb .LMP2K_event_goto_2\n"
        ".LMP2K_event_rept_22:\n"
        "\tmov r3, #0\n"
        "\tstrb r3, [r1, #3]\n"
        "\tadd r2, #5\n"
        "\tstr r2, [r1, #64]\n"
        "\tpop {r0}\n"
        "\tbx r0");
#else
    u8 *at = track->cmdPtr;
    u32 times;
    if (*at == 0) {
        track->cmdPtr = at + 1;
        MP2K_event_goto(mplayInfo, track);
        return;
    }
    times = track->repeatCount + 1;
    track->repeatCount = times;
    if (times < ld_r3_tp_adr_i(track)) {
        MP2K_event_goto(mplayInfo, track);
        return;
    }
    track->repeatCount = 0;
    track->cmdPtr = at + 5;
#endif
}

/** The track's priority. */
void MP2K_event_prio(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tstrb r3, [r1, #29]\n"
        "\tbx r12");
#else
    track->priority = ld_r3_tp_adr_i(track);
#endif
}

/** The song's tempo. */
void MP2K_event_tempo(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tlsl r3, r3, #1\n"
        "\tstrh r3, [r0, #28]\n"
        "\tldrh r2, [r0, #30]\n"
        "\tmul r3, r2\n"
        "\tlsr r3, r3, #8\n"
        "\tstrh r3, [r0, #32]\n"
        "\tbx r12");
#else
    u32 tempo = ld_r3_tp_adr_i(track) << 1;
    mplayInfo->tempoRawBPM = tempo;
    mplayInfo->tempoInterval = (tempo * mplayInfo->tempoScale) >> 8;
#endif
}

/** The track's key shift. */
void MP2K_event_keysh(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tstrb r3, [r1, #10]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #12\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx r12");
#else
    track->keyShift = ld_r3_tp_adr_i(track);
    track->status |= MPT_FLG_PITCHG;
#endif
}

/** The track's instrument, from the song's voice group. */
void MP2K_event_voice(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tldr r2, [r1, #64]\n"
        "\tldrb r3, [r2, #0]\n"
        "\tadd r2, #1\n"
        "\tstr r2, [r1, #64]\n"
        "\tlsl r2, r3, #1\n"
        "\tadd r2, r2, r3\n"
        "\tlsl r2, r2, #2\n"
        "\tldr r3, [r0, #48]\n"
        "\tadd r2, r2, r3\n"
        "\tldr r3, [r2, #0]\n"
        "\tbl .Lldrb_r3_r2_2\n"
        "\tstr r3, [r1, #36]\n"
        "\tldr r3, [r2, #4]\n"
        "\tbl .Lldrb_r3_r2_2\n"
        "\tstr r3, [r1, #40]\n"
        "\tldr r3, [r2, #8]\n"
        "\tbl .Lldrb_r3_r2_2\n"
        "\tstr r3, [r1, #44]\n"
        "\tbx r12");
#else
    u8 *at = track->cmdPtr;
    u32 *voice, *own = (u32 *)&track->voicegroup;
    u32 n = *at;
    track->cmdPtr = at + 1;
    voice = (u32 *)((u8 *)mplayInfo->voicegroup + n * 12);
    own[0] = chk_adr_r2(voice) ? voice[0] : 0;
    own[1] = chk_adr_r2(voice) ? voice[1] : 0;
    own[2] = chk_adr_r2(voice) ? voice[2] : 0;
#endif
}

/** The track's volume. */
void MP2K_event_vol(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tstrb r3, [r1, #18]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #3\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx r12");
#else
    track->vol = ld_r3_tp_adr_i(track);
    track->status |= MPT_FLG_VOLCHG;
#endif
}

/** The track's pan. */
void MP2K_event_pan(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tsub r3, #64\n"
        "\tstrb r3, [r1, #20]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #3\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx r12");
#else
    track->pan = ld_r3_tp_adr_i(track) - C_V;
    track->status |= MPT_FLG_VOLCHG;
#endif
}

/** The track's pitch bend. */
void MP2K_event_bend(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tsub r3, #64\n"
        "\tstrb r3, [r1, #14]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #12\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx r12");
#else
    track->bend = ld_r3_tp_adr_i(track) - C_V;
    track->status |= MPT_FLG_PITCHG;
#endif
}

/** The track's pitch bend's range. */
void MP2K_event_bendr(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tstrb r3, [r1, #15]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #12\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx r12");
#else
    track->bendRange = ld_r3_tp_adr_i(track);
    track->status |= MPT_FLG_PITCHG;
#endif
}

/** The track's LFO's delay. */
void MP2K_event_lfodl(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tstrb r3, [r1, #27]\n"
        "\tbx r12");
#else
    track->lfoDelay = ld_r3_tp_adr_i(track);
#endif
}

/** What the track's modulation changes, pitch or volume. */
void MP2K_event_modt(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tldrb r0, [r1, #24]\n"
        "\tcmp r0, r3\n"
        "\tbeq .LMP2K_event_modt_16\n"
        "\tstrb r3, [r1, #24]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #15\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        ".LMP2K_event_modt_16:\n"
        "\tbx r12");
#else
    u32 type = ld_r3_tp_adr_i(track);
    if (track->modType == type)
        return;
    track->modType = type;
    track->status |= MPT_FLG_VOLCHG | MPT_FLG_PITCHG;
#endif
}

/** The track's tuning. */
void MP2K_event_tune(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i\n"
        "\tsub r3, #64\n"
        "\tstrb r3, [r1, #12]\n"
        "\tldrb r3, [r1, #0]\n"
        "\tmov r2, #12\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx r12");
#else
    track->tune = ld_r3_tp_adr_i(track) - C_V;
    track->status |= MPT_FLG_PITCHG;
#endif
}

/** A byte straight into a sound register, the one the next byte names from the first of them on. */
void MP2K_event_port(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tldr r2, [r1, #64]\n"
        "\tldrb r3, [r2, #0]\n"
        "\tadd r2, #1\n"
        "\tldr r0, .LMP2K_event_port_14\n"
        "\tadd r0, r0, r3\n"
        "\tbl .Lld_r3_tp_adr_i_2\n"
        "\tstrb r3, [r0, #0]\n"
        "\tbx r12\n"
        ".LMP2K_event_port_14:\n"
        "\t.word 0x04000060");
#else
    u8 *at = track->cmdPtr;
    u32 reg = *at;
    at++;
    track->cmdPtr = at + 1;
    M4A_SET(M4A_REG(8, 0x060 + reg), ldrb_r3_r2(at));
#endif
}

/** The engine's work at each V-blank: the sound DMA started again at the start of each of its periods. */
void m4aSoundVSync(void)
{
#ifdef MATCHING
    asm("\tldr r0, .LMP2KPlayerMain_sound_info_ptr\n"
        "\tldr r0, [r0, #0]\n"
        "\tldr r2, .LMP2KPlayerMain_id_number\n"
        "\tldr r3, [r0, #0]\n"
        "\tsub r3, r3, r2\n"
        "\tcmp r3, #1\n"
        "\tbhi .Lm4aSoundVSync_done\n"
        "\tldrb r1, [r0, #4]\n"
        "\tsub r1, #1\n"
        "\tstrb r1, [r0, #4]\n"
        "\tbgt .Lm4aSoundVSync_done\n"
        "\tldrb r1, [r0, #11]\n"
        "\tstrb r1, [r0, #4]\n"
        "\tldr r2, .Lm4aSoundVSync_dma1_registers\n"
        "\tldr r1, [r2, #8]\n"
        "\tlsl r1, r1, #7\n"
        "\tbcc .Lm4aSoundVSync_dma2\n"
        "\tldr r1, .Lm4aSoundVSync_dma_control\n"
        "\tstr r1, [r2, #8]\n"
        ".Lm4aSoundVSync_dma2:\n"
        "\tldr r1, [r2, #20]\n"
        "\tlsl r1, r1, #7\n"
        "\tbcc .Lm4aSoundVSync_restart\n"
        "\tldr r1, .Lm4aSoundVSync_dma_control\n"
        "\tstr r1, [r2, #20]\n"
        ".Lm4aSoundVSync_restart:\n"
        "\tmov r1, #4\n"
        "\tlsl r1, r1, #8\n"
        "\tstrh r1, [r2, #10]\n"
        "\tstrh r1, [r2, #22]\n"
        "\tmov r1, #182\n"
        "\tlsl r1, r1, #8\n"
        "\tstrh r1, [r2, #10]\n"
        "\tstrh r1, [r2, #22]\n"
        ".Lm4aSoundVSync_done:\n"
        "\tbx lr\n"
        "\t.hword 0x0000\n"
        ".Lm4aSoundVSync_dma1_registers:\n"
        "\t.word 0x040000BC\n"
        ".Lm4aSoundVSync_dma_control:\n"
        "\t.word 0x84400004");
#else
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    s32 counter;

    if (soundInfo->lockStatus - ID_NUMBER > 1) {
        M4A_TIME(m4aSoundVSync, 0x0, 0xC, M4A_AT(m4aSoundVSync, 0x40), M4A_REACH(&SOUND_INFO_PTR), M4A_REACH(soundInfo));
        M4A_TIME(m4aSoundVSync, 0x40, 0x40, M4A_BACK);
        return;
    }
    M4A_TIME(m4aSoundVSync, 0x0, 0xC, M4A_AT(m4aSoundVSync, 0xE), M4A_REACH(&SOUND_INFO_PTR), M4A_REACH(soundInfo));
    counter = soundInfo->dmaCounter - 1;
    soundInfo->dmaCounter = counter;
    if (counter > 0) {
        M4A_TIME(m4aSoundVSync, 0xE, 0x14, M4A_AT(m4aSoundVSync, 0x40), M4A_REACH(soundInfo), M4A_REACH(soundInfo));
        M4A_TIME(m4aSoundVSync, 0x40, 0x40, M4A_BACK);
        return;
    }
    M4A_TIME(m4aSoundVSync, 0xE, 0x14, M4A_AT(m4aSoundVSync, 0x16), M4A_REACH(soundInfo), M4A_REACH(soundInfo));
    soundInfo->dmaCounter = soundInfo->framesPerDmaCycle;

    // each write of a channel's control is timed as it's made, before the next write of it
    if (REG_DMA1CNT & (DMA_REPEAT << 16)) {
        M4A_TIME(m4aSoundVSync, 0x16, 0x20, M4A_AT(m4aSoundVSync, 0x22), M4A_REACH(soundInfo), M4A_REACH(soundInfo), 0x040000C4);
        M4A_SET(REG_DMA1CNT, ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4);
        M4A_TIME(m4aSoundVSync, 0x22, 0x24, M4A_AT(m4aSoundVSync, 0x26), 0x040000C4);
    } else {
        M4A_TIME(m4aSoundVSync, 0x16, 0x20, M4A_AT(m4aSoundVSync, 0x26), M4A_REACH(soundInfo), M4A_REACH(soundInfo), 0x040000C4);
    }
    if (REG_DMA2CNT & (DMA_REPEAT << 16)) {
        M4A_TIME(m4aSoundVSync, 0x26, 0x2A, M4A_AT(m4aSoundVSync, 0x2C), 0x040000D0);
        M4A_SET(REG_DMA2CNT, ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4);
        M4A_TIME(m4aSoundVSync, 0x2C, 0x2E, M4A_AT(m4aSoundVSync, 0x30), 0x040000D0);
    } else {
        M4A_TIME(m4aSoundVSync, 0x26, 0x2A, M4A_AT(m4aSoundVSync, 0x30), 0x040000D0);
    }
    M4A_SET(REG_DMA1CNT_H, DMA_32BIT);
    M4A_TIME(m4aSoundVSync, 0x30, 0x34, M4A_AT(m4aSoundVSync, 0x36), 0x040000C6);
    M4A_SET(REG_DMA2CNT_H, DMA_32BIT);
    M4A_TIME(m4aSoundVSync, 0x36, 0x36, M4A_AT(m4aSoundVSync, 0x38), 0x040000D2);
    M4A_SET(REG_DMA1CNT_H, DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT);
    M4A_TIME(m4aSoundVSync, 0x38, 0x3C, M4A_AT(m4aSoundVSync, 0x3E), 0x040000C6);
    M4A_SET(REG_DMA2CNT_H, DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT);
    M4A_TIME(m4aSoundVSync, 0x3E, 0x40, M4A_BACK, 0x040000D2);
#endif
}

/**
 * A music player's step for a frame: as many of its ticks as its tempo makes, each running every track's commands
 * up to its next wait and moving its LFO on, then each track's volume and pitch handed to its channels. Its
 * instructions run on into a step, and a call through r3 with the words after it, which the code map keeps as
 * functions of their own: dp:run 616
 */
void MP2KPlayerMain(struct MP2KPlayerState *mplayInfo)
{
#ifdef MATCHING
    asm("\t.equ m4a_sound_info_ptr, 0x03000000 + 0x7FF0\n"
        "\tldr r2, .LMP2KPlayerMain_id_number\n"
        "\tldr r3, [r0, #52]\n"
        "\tcmp r2, r3\n"
        "\tbeq .LMP2KPlayerMain_A\n"
        "\tbx lr\n"
        ".LMP2KPlayerMain_A:\n"
        "\tadd r3, #1\n"
        "\tstr r3, [r0, #52]\n"
        "\tpush {r0,lr}\n"
        "\tldr r3, [r0, #56]\n"
        "\tcmp r3, #0\n"
        "\tbeq .LMP2KPlayerMain_1C\n"
        "\tldr r0, [r0, #60]\n"
        "\tbl .LMP2KPlayerMain_call_r3\n"
        ".LMP2KPlayerMain_1C:\n"
        "\tpop {r0}\n"
        "\tpush {r4-r7}\n"
        "\tmov r4, r8\n"
        "\tmov r5, r9\n"
        "\tmov r6, r10\n"
        "\tmov r7, r11\n"
        "\tpush {r4-r7}\n"
        "\tmov r7, r0\n"
        "\tldr r0, [r7, #4]\n"
        "\tcmp r0, #0\n"
        "\tbge .LMP2KPlayerMain_34\n"
        "\tb .LMP2KPlayerMain_248\n"
        ".LMP2KPlayerMain_34:\n"
        "\tldr r0, .LMP2KPlayerMain_sound_info_ptr\n"
        "\tldr r0, [r0, #0]\n"
        "\tmov r8, r0\n"
        "\tmov r0, r7\n"
        "\tbl FadeOutBody\n"
        "\tldr r0, [r7, #4]\n"
        "\tcmp r0, #0\n"
        "\tbge .LMP2KPlayerMain_48\n"
        "\tb .LMP2KPlayerMain_248\n"
        ".LMP2KPlayerMain_48:\n"
        "\tldrh r0, [r7, #34]\n"
        "\tldrh r1, [r7, #32]\n"
        "\tadd r0, r0, r1\n"
        "\tb .LMP2KPlayerMain_198\n"
        ".LMP2KPlayerMain_50:\n"
        "\tldrb r6, [r7, #8]\n"
        "\tldr r5, [r7, #44]\n"
        "\tmov r3, #1\n"
        "\tmov r4, #0\n"
        ".LMP2KPlayerMain_58:\n"
        "\tldrb r0, [r5, #0]\n"
        "\tmov r1, #128\n"
        "\ttst r1, r0\n"
        "\tbne .LMP2KPlayerMain_62\n"
        "\tb .LMP2KPlayerMain_174\n"
        ".LMP2KPlayerMain_62:\n"
        "\tmov r10, r3\n"
        "\torr r4, r3\n"
        "\tmov r11, r4\n"
        "\tldr r4, [r5, #32]\n"
        "\tcmp r4, #0\n"
        "\tbeq .LMP2KPlayerMain_96\n"
        ".LMP2KPlayerMain_6E:\n"
        "\tldrb r1, [r4, #0]\n"
        "\tmov r0, #199\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2KPlayerMain_8A\n"
        "\tldrb r0, [r4, #16]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LMP2KPlayerMain_90\n"
        "\tsub r0, #1\n"
        "\tstrb r0, [r4, #16]\n"
        "\tbne .LMP2KPlayerMain_90\n"
        "\tmov r0, #64\n"
        "\torr r1, r0\n"
        "\tstrb r1, [r4, #0]\n"
        "\tb .LMP2KPlayerMain_90\n"
        ".LMP2KPlayerMain_8A:\n"
        "\tmov r0, r4\n"
        "\tbl ClearChain\n"
        ".LMP2KPlayerMain_90:\n"
        "\tldr r4, [r4, #52]\n"
        "\tcmp r4, #0\n"
        "\tbne .LMP2KPlayerMain_6E\n"
        ".LMP2KPlayerMain_96:\n"
        "\tldrb r3, [r5, #0]\n"
        "\tmov r0, #64\n"
        "\ttst r0, r3\n"
        "\tbeq .LMP2KPlayerMain_114\n"
        ".LMP2KPlayerMain_9E:\n"
        "\tmov r0, r5\n"
        "\tbl Clear64byte\n"
        "\tmov r0, #128\n"
        "\tstrb r0, [r5, #0]\n"
        "\tmov r0, #2\n"
        "\tstrb r0, [r5, #15]\n"
        "\tmov r0, #64\n"
        "\tstrb r0, [r5, #19]\n"
        "\tmov r0, #22\n"
        "\tstrb r0, [r5, #25]\n"
        "\tmov r0, #1\n"
        "\tadd r1, r5, #6\n"
        "\tstrb r0, [r1, #30]\n"
        "\tb .LMP2KPlayerMain_114\n"
        ".LMP2KPlayerMain_BC:\n"
        "\tldr r2, [r5, #64]\n"
        "\tldrb r1, [r2, #0]\n"
        "\tcmp r1, #128\n"
        "\tbcs .LMP2KPlayerMain_C8\n"
        "\tldrb r1, [r5, #7]\n"
        "\tb .LMP2KPlayerMain_D2\n"
        ".LMP2KPlayerMain_C8:\n"
        "\tadd r2, #1\n"
        "\tstr r2, [r5, #64]\n"
        "\tcmp r1, #189\n"
        "\tbcc .LMP2KPlayerMain_D2\n"
        "\tstrb r1, [r5, #7]\n"
        ".LMP2KPlayerMain_D2:\n"
        "\tcmp r1, #207\n"
        "\tbcc .LMP2KPlayerMain_E8\n"
        "\tmov r0, r8\n"
        "\tldr r3, [r0, #56]\n"
        "\tmov r0, r1\n"
        "\tsub r0, #207\n"
        "\tmov r1, r7\n"
        "\tmov r2, r5\n"
        "\tbl .LMP2KPlayerMain_call_r3\n"
        "\tb .LMP2KPlayerMain_114\n"
        ".LMP2KPlayerMain_E8:\n"
        "\tcmp r1, #176\n"
        "\tbls .LMP2KPlayerMain_10A\n"
        "\tmov r0, r1\n"
        "\tsub r0, #177\n"
        "\tstrb r0, [r7, #10]\n"
        "\tmov r3, r8\n"
        "\tldr r3, [r3, #52]\n"
        "\tlsl r0, r0, #2\n"
        "\tldr r3, [r3, r0]\n"
        "\tmov r0, r7\n"
        "\tmov r1, r5\n"
        "\tbl .LMP2KPlayerMain_call_r3\n"
        "\tldrb r0, [r5, #0]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LMP2KPlayerMain_170\n"
        "\tb .LMP2KPlayerMain_114\n"
        ".LMP2KPlayerMain_10A:\n"
        "\tldr r0, .LMP2KPlayerMain_clock_table\n"
        "\tsub r1, #128\n"
        "\tadd r1, r1, r0\n"
        "\tldrb r0, [r1, #0]\n"
        "\tstrb r0, [r5, #1]\n"
        ".LMP2KPlayerMain_114:\n"
        "\tldrb r0, [r5, #1]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LMP2KPlayerMain_BC\n"
        "\tsub r0, #1\n"
        "\tstrb r0, [r5, #1]\n"
        "\tldrb r1, [r5, #25]\n"
        "\tcmp r1, #0\n"
        "\tbeq .LMP2KPlayerMain_170\n"
        "\tldrb r0, [r5, #23]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LMP2KPlayerMain_170\n"
        "\tldrb r0, [r5, #28]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LMP2KPlayerMain_136\n"
        "\tsub r0, #1\n"
        "\tstrb r0, [r5, #28]\n"
        "\tb .LMP2KPlayerMain_170\n"
        ".LMP2KPlayerMain_136:\n"
        "\tldrb r0, [r5, #26]\n"
        "\tadd r0, r0, r1\n"
        "\tstrb r0, [r5, #26]\n"
        "\tmov r1, r0\n"
        "\tsub r0, #64\n"
        "\tlsl r0, r0, #24\n"
        "\tbpl .LMP2KPlayerMain_14A\n"
        "\tlsl r2, r1, #24\n"
        "\tasr r2, r2, #24\n"
        "\tb .LMP2KPlayerMain_14E\n"
        ".LMP2KPlayerMain_14A:\n"
        "\tmov r0, #128\n"
        "\tsub r2, r0, r1\n"
        ".LMP2KPlayerMain_14E:\n"
        "\tldrb r0, [r5, #23]\n"
        "\tmul r0, r2\n"
        "\tasr r2, r0, #6\n"
        "\tldrb r0, [r5, #22]\n"
        "\teor r0, r2\n"
        "\tlsl r0, r0, #24\n"
        "\tbeq .LMP2KPlayerMain_170\n"
        "\tstrb r2, [r5, #22]\n"
        "\tldrb r0, [r5, #0]\n"
        "\tldrb r1, [r5, #24]\n"
        "\tcmp r1, #0\n"
        "\tbne .LMP2KPlayerMain_16A\n"
        "\tmov r1, #12\n"
        "\tb .LMP2KPlayerMain_16C\n"
        ".LMP2KPlayerMain_16A:\n"
        "\tmov r1, #3\n"
        ".LMP2KPlayerMain_16C:\n"
        "\torr r0, r1\n"
        "\tstrb r0, [r5, #0]\n"
        ".LMP2KPlayerMain_170:\n"
        "\tmov r3, r10\n"
        "\tmov r4, r11\n"
        ".LMP2KPlayerMain_174:\n"
        "\tsub r6, #1\n"
        "\tble .LMP2KPlayerMain_180\n"
        "\tmov r0, #80\n"
        "\tadd r5, r5, r0\n"
        "\tlsl r3, r3, #1\n"
        "\tb .LMP2KPlayerMain_58\n"
        ".LMP2KPlayerMain_180:\n"
        "\tldr r0, [r7, #12]\n"
        "\tadd r0, #1\n"
        "\tstr r0, [r7, #12]\n"
        "\tcmp r4, #0\n"
        "\tbne .LMP2KPlayerMain_192\n"
        "\tmov r0, #128\n"
        "\tlsl r0, r0, #24\n"
        "\tstr r0, [r7, #4]\n"
        "\tb .LMP2KPlayerMain_248\n"
        ".LMP2KPlayerMain_192:\n"
        "\tstr r4, [r7, #4]\n"
        "\tldrh r0, [r7, #34]\n"
        "\tsub r0, #150\n"
        ".LMP2KPlayerMain_198:\n"
        "\tstrh r0, [r7, #34]\n"
        "\tcmp r0, #150\n"
        "\tbcc .LMP2KPlayerMain_1A0\n"
        "\tb .LMP2KPlayerMain_50\n"
        ".LMP2KPlayerMain_1A0:\n"
        "\tldrb r2, [r7, #8]\n"
        "\tldr r5, [r7, #44]\n"
        ".LMP2KPlayerMain_1A4:\n"
        "\tldrb r0, [r5, #0]\n"
        "\tmov r1, #128\n"
        "\ttst r1, r0\n"
        "\tbeq .LMP2KPlayerMain_23E\n"
        "\tmov r1, #15\n"
        "\ttst r1, r0\n"
        "\tbeq .LMP2KPlayerMain_23E\n"
        "\tmov r9, r2\n"
        "\tmov r0, r7\n"
        "\tmov r1, r5\n"
        "\tbl TrkVolPitSet\n"
        "\tldr r4, [r5, #32]\n"
        "\tcmp r4, #0\n"
        "\tbeq .LMP2KPlayerMain_234\n"
        ".LMP2KPlayerMain_1C2:\n"
        "\tldrb r1, [r4, #0]\n"
        "\tmov r0, #199\n"
        "\ttst r0, r1\n"
        "\tbne .LMP2KPlayerMain_1D2\n"
        "\tmov r0, r4\n"
        "\tbl ClearChain\n"
        "\tb .LMP2KPlayerMain_22E\n"
        ".LMP2KPlayerMain_1D2:\n"
        "\tldrb r0, [r4, #1]\n"
        "\tmov r6, #7\n"
        "\tand r6, r0\n"
        "\tldrb r3, [r5, #0]\n"
        "\tmov r0, #3\n"
        "\ttst r0, r3\n"
        "\tbeq .LMP2KPlayerMain_1F0\n"
        "\tbl ChnVolSetAsm\n"
        "\tcmp r6, #0\n"
        "\tbeq .LMP2KPlayerMain_1F0\n"
        "\tldrb r0, [r4, #29]\n"
        "\tmov r1, #1\n"
        "\torr r0, r1\n"
        "\tstrb r0, [r4, #29]\n"
        ".LMP2KPlayerMain_1F0:\n"
        "\tldrb r3, [r5, #0]\n"
        "\tmov r0, #12\n"
        "\ttst r0, r3\n"
        "\tbeq .LMP2KPlayerMain_22E\n"
        "\tldrb r1, [r4, #8]\n"
        "\tmov r0, #8\n"
        "\tldrsb r0, [r5, r0]\n"
        "\tadd r2, r1, r0\n"
        "\tbpl .LMP2KPlayerMain_204\n"
        "\tmov r2, #0\n"
        ".LMP2KPlayerMain_204:\n"
        "\tcmp r6, #0\n"
        "\tbeq .LMP2KPlayerMain_222\n"
        "\tmov r0, r8\n"
        "\tldr r3, [r0, #48]\n"
        "\tmov r1, r2\n"
        "\tldrb r2, [r5, #9]\n"
        "\tmov r0, r6\n"
        "\tbl .LMP2KPlayerMain_call_r3\n"
        "\tstr r0, [r4, #32]\n"
        "\tldrb r0, [r4, #29]\n"
        "\tmov r1, #2\n"
        "\torr r0, r1\n"
        "\tstrb r0, [r4, #29]\n"
        "\tb .LMP2KPlayerMain_22E\n"
        ".LMP2KPlayerMain_222:\n"
        "\tmov r1, r2\n"
        "\tldrb r2, [r5, #9]\n"
        "\tldr r0, [r4, #36]\n"
        "\tbl MidiKeyToFreq\n"
        "\tstr r0, [r4, #32]\n"
        ".LMP2KPlayerMain_22E:\n"
        "\tldr r4, [r4, #52]\n"
        "\tcmp r4, #0\n"
        "\tbne .LMP2KPlayerMain_1C2\n"
        ".LMP2KPlayerMain_234:\n"
        "\tldrb r0, [r5, #0]\n"
        "\tmov r1, #240\n"
        "\tand r0, r1\n"
        "\tstrb r0, [r5, #0]\n"
        "\tmov r2, r9\n"
        ".LMP2KPlayerMain_23E:\n"
        "\tsub r2, #1\n"
        "\tble .LMP2KPlayerMain_248\n"
        "\tmov r0, #80\n"
        "\tadd r5, r5, r0\n"
        "\tbgt .LMP2KPlayerMain_1A4\n"
        ".LMP2KPlayerMain_248:\n"
        "\tldr r0, .LMP2KPlayerMain_id_number\n"
        "\tstr r0, [r7, #52]\n"
        "\tpop {r0-r7}\n"
        "\tmov r8, r0\n"
        "\tmov r9, r1\n"
        "\tmov r10, r2\n"
        "\tmov r11, r3\n"
        "\tpop {r3}\n"
        ".LMP2KPlayerMain_call_r3:\n"
        "\tbx r3\n"
        "\t.hword 0x0000\n"
        ".LMP2KPlayerMain_clock_table:\n"
        "\t.word gClockTable\n"
        ".LMP2KPlayerMain_sound_info_ptr:\n"
        "\t.word m4a_sound_info_ptr\n"
        ".LMP2KPlayerMain_id_number:\n"
        "\t.word 0x68736D53");
#else
    struct SoundMixerState *soundInfo;
    struct MP2KTrack *track;
    u32 tempo;
    s32 i;

    if (mplayInfo->lockStatus != ID_NUMBER) {
        M4A_TIME(MP2KPlayerMain, 0x0, 0x8, M4A_BACK, M4A_REACH(mplayInfo));
        return;
    }
    M4A_TIME(MP2KPlayerMain, 0x0, 0x6, M4A_AT(MP2KPlayerMain, 0xA), M4A_REACH(mplayInfo));
    mplayInfo->lockStatus = ID_NUMBER + 1;
    // the next player's step is called through the `bx r3` this one ends with
    if (mplayInfo->nextPlayerFunc != NULL) {
        M4A_TIME(MP2KPlayerMain, 0xA, 0x1A, M4A_AT(MP2KPlayerMain, 0x258), M4A_REACH(mplayInfo), M4A_REACH(mplayInfo),
                 M4A_REACH(mplayInfo));
        M4A_TIME(MP2KPlayerMain, 0x258, 0x258, M4A_REACH(mplayInfo->nextPlayerFunc));
        mplayInfo->nextPlayerFunc(mplayInfo->nextPlayer);
    } else {
        M4A_TIME(MP2KPlayerMain, 0xA, 0x14, M4A_AT(MP2KPlayerMain, 0x1C), M4A_REACH(mplayInfo), M4A_REACH(mplayInfo));
    }

    if ((s32)mplayInfo->status < 0) {
        M4A_TIME(MP2KPlayerMain, 0x1C, 0x32, M4A_AT(MP2KPlayerMain, 0x248), M4A_REACH(mplayInfo));
        goto end;
    }
    soundInfo = SOUND_INFO_PTR;
    FadeOutBody(mplayInfo);
    if ((s32)mplayInfo->status < 0)
        goto end;

    // a tick for each 150 the tempo has counted
    tempo = (u32)mplayInfo->tempoCounter + mplayInfo->tempoInterval;
    for (;;) {
        u32 bit = 1, playing = 0;
        mplayInfo->tempoCounter = tempo;
        if (tempo < 150)
            break;
        track = mplayInfo->tracks;
        for (i = mplayInfo->trackCount; ; ) {
            struct MixerSource *chan;
            if (!(track->status & MPT_FLG_EXIST))
                goto nextTrack;
            playing |= bit;
            // each channel's gate time on, and a channel that's stopped out of the chain
            for (chan = track->chan; chan != NULL; chan = chan->next) {
                if (chan->status & SOUND_CHANNEL_SF_ON) {
                    if (chan->data.sound.gateTime != 0 && --chan->data.sound.gateTime == 0)
                        chan->status |= SOUND_CHANNEL_SF_STOP;
                } else {
                    ClearChain(chan);
                }
            }
            if (track->status & MPT_FLG_START) {
                Clear64byte(track);
                track->status = MPT_FLG_EXIST;
                track->bendRange = 2;
                track->volPublic = 64;
                track->lfoSpeed = 22;
                track->voicegroup.type = 1;
            }
            // the track's commands, up to its next wait
            while (track->wait == 0) {
                u8 *at = track->cmdPtr;
                u32 cmd = *at;
                if (cmd < 0x80) {
                    cmd = track->runningStatus;
                } else {
                    track->cmdPtr = at + 1;
                    if (cmd >= 0xBD)
                        track->runningStatus = cmd;
                }
                if (cmd >= 0xCF) {
                    soundInfo->plynote(cmd - 0xCF, mplayInfo, track);
                } else if (cmd > 0xB0) {
                    mplayInfo->cmd = cmd - 0xB1;
                    ((MP2KEventFunc)soundInfo->MPlayJumpTable[cmd - 0xB1])(mplayInfo, track);
                    if (track->status == 0)
                        goto nextTrack;
                } else {
                    track->wait = gClockTable[(s32)cmd - 0x80];
                }
            }
            track->wait--;
            // the LFO
            if (track->lfoSpeed != 0 && track->modDepth != 0) {
                if (track->lfoDelayCounter != 0) {
                    track->lfoDelayCounter--;
                } else {
                    u32 counter = track->lfoSpeedCounter + track->lfoSpeed;
                    s32 wave;
                    track->lfoSpeedCounter = counter;
                    if ((s8)(counter - 64) < 0)
                        wave = (s8)counter;
                    else
                        wave = 128 - (s32)counter;
                    wave = (track->modDepth * wave) >> 6;
                    if ((u8)(track->modCalculated ^ wave) != 0) {
                        track->modCalculated = wave;
                        track->status |= track->modType == 0 ? MPT_FLG_PITCHG : MPT_FLG_VOLCHG;
                    }
                }
            }
        nextTrack:
            if (--i <= 0)
                break;
            track++;
            bit <<= 1;
        }
        mplayInfo->clock++;
        if (playing == 0) {
            mplayInfo->status = MUSICPLAYER_STATUS_PAUSE;
            goto end;
        }
        mplayInfo->status = playing;
        tempo = (u32)mplayInfo->tempoCounter - 150;
    }

    // each track's new volume and pitch, to its channels
    track = mplayInfo->tracks;
    for (i = mplayInfo->trackCount; ; ) {
        if ((track->status & MPT_FLG_EXIST) && (track->status & (MPT_FLG_VOLCHG | MPT_FLG_PITCHG))) {
            struct MixerSource *chan;
            TrkVolPitSet(mplayInfo, track);
            for (chan = track->chan; chan != NULL; chan = chan->next) {
                u32 cgb;
                if (!(chan->status & SOUND_CHANNEL_SF_ON)) {
                    ClearChain(chan);
                    continue;
                }
                cgb = chan->type & TONEDATA_TYPE_CGB;
                if (track->status & MPT_FLG_VOLCHG) {
                    ChnVolSetAsm(chan, track);
                    if (cgb)
                        chan->data.cgb.cgbStatus |= CGB_CHANNEL_MO_VOL;
                }
                if (track->status & MPT_FLG_PITCHG) {
                    s32 key = chan->data.sound.key + track->keyShiftCalculated;
                    if (key < 0)
                        key = 0;
                    if (cgb) {
                        chan->data.cgb.freq = soundInfo->MidiKeyToCgbFreq(cgb, key, track->pitchCalculated);
                        chan->data.cgb.cgbStatus |= CGB_CHANNEL_MO_PIT;
                    } else {
                        chan->data.sound.freq = MidiKeyToFreq(chan->wav, key, track->pitchCalculated);
                    }
                }
            }
            track->status &= 0xF0;
        }
        if (--i <= 0)
            break;
        track++;
    }

end:
    mplayInfo->lockStatus = ID_NUMBER;
    M4A_TIME(MP2KPlayerMain, 0x248, 0x258, M4A_BACK, M4A_REACH(mplayInfo));
#endif
}

/** Stops a track: each of its channels off, the console's own told to stop, and out of the track. */
void TrackStop(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\t.equ m4a_sound_info_ptr, 0x03000000 + 0x7FF0\n"
        "\tpush {r4-r6,lr}\n"
        "\tmov r5, r1\n"
        "\tldrb r1, [r5, #0]\n"
        "\tmov r0, #128\n"
        "\ttst r0, r1\n"
        "\tbeq .LTrackStop_38\n"
        "\tldr r4, [r5, #32]\n"
        "\tcmp r4, #0\n"
        "\tbeq .LTrackStop_36\n"
        "\tmov r6, #0\n"
        ".LTrackStop_14:\n"
        "\tldrb r0, [r4, #0]\n"
        "\tcmp r0, #0\n"
        "\tbeq .LTrackStop_2E\n"
        "\tldrb r0, [r4, #1]\n"
        "\tmov r3, #7\n"
        "\tand r0, r3\n"
        "\tbeq .LTrackStop_2C\n"
        "\tldr r3, .LTrackStop_40\n"
        "\tldr r3, [r3, #0]\n"
        "\tldr r3, [r3, #44]\n"
        "\tbl .LMP2KPlayerMain_call_r3\n"
        ".LTrackStop_2C:\n"
        "\tstrb r6, [r4, #0]\n"
        ".LTrackStop_2E:\n"
        "\tstr r6, [r4, #44]\n"
        "\tldr r4, [r4, #52]\n"
        "\tcmp r4, #0\n"
        "\tbne .LTrackStop_14\n"
        ".LTrackStop_36:\n"
        "\tstr r4, [r5, #32]\n"
        ".LTrackStop_38:\n"
        "\tpop {r4-r6}\n"
        "\tpop {r0}\n"
        "\tbx r0\n"
        "\t.hword 0x0000\n"
        ".LTrackStop_40:\n"
        "\t.word m4a_sound_info_ptr");
#else
    struct MixerSource *chan;
    if (!(track->status & MPT_FLG_EXIST)) {
        M4A_TIME(TrackStop, 0x0, 0xA, M4A_AT(TrackStop, 0x38), M4A_REACH(track));
        M4A_TIME(TrackStop, 0x38, 0x3C, M4A_BACK);
        return;
    }
    M4A_TIME(TrackStop, 0x0, 0xA, M4A_AT(TrackStop, 0xC), M4A_REACH(track));
    M4A_TIME(TrackStop, 0xC, 0x10, M4A_AT(TrackStop, track->chan != NULL ? 0x12 : 0x36), M4A_REACH(track));
    M4A_TIME_WHEN(track->chan != NULL, TrackStop, 0x12, 0x12, M4A_AT(TrackStop, 0x14));
    for (chan = track->chan; chan != NULL; chan = chan->next) {
        if (chan->status != 0) {
            // a channel of the console's own is told to stop through the engine's `bx r3`, which isn't timed
            if (chan->type & TONEDATA_TYPE_CGB)
                SOUND_INFO_PTR->CgbOscOff(chan->type & TONEDATA_TYPE_CGB);
            else
                M4A_TIME(TrackStop, 0x14, 0x20, M4A_AT(TrackStop, 0x2C), M4A_REACH(chan), M4A_REACH(chan));
            chan->status = 0;
            M4A_TIME(TrackStop, 0x2C, 0x2C, M4A_AT(TrackStop, 0x2E), M4A_REACH(chan));
        } else {
            M4A_TIME(TrackStop, 0x14, 0x18, M4A_AT(TrackStop, 0x2E), M4A_REACH(chan));
        }
        chan->track = NULL;
        M4A_TIME(TrackStop, 0x2E, 0x34, M4A_AT(TrackStop, chan->next != NULL ? 0x14 : 0x36), M4A_REACH(chan), M4A_REACH(chan));
    }
    track->chan = NULL;
    M4A_TIME(TrackStop, 0x36, 0x3C, M4A_BACK, M4A_REACH(track));
#endif
}

/** A channel's right and left volume, from its velocity and pan and its track's volume. */
void ChnVolSetAsm(struct MixerSource *chan, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tldrb r1, [r4, #18]\n"
        "\tmov r0, #20\n"
        "\tldrsb r2, [r4, r0]\n"
        "\tmov r3, #128\n"
        "\tadd r3, r3, r2\n"
        "\tmul r3, r1\n"
        "\tldrb r0, [r5, #16]\n"
        "\tmul r0, r3\n"
        "\tasr r0, r0, #14\n"
        "\tcmp r0, #255\n"
        "\tbls .LChnVolSetAsm_right\n"
        "\tmov r0, #255\n"
        ".LChnVolSetAsm_right:\n"
        "\tstrb r0, [r4, #2]\n"
        "\tmov r3, #127\n"
        "\tsub r3, r3, r2\n"
        "\tmul r3, r1\n"
        "\tldrb r0, [r5, #17]\n"
        "\tmul r0, r3\n"
        "\tasr r0, r0, #14\n"
        "\tcmp r0, #255\n"
        "\tbls .LChnVolSetAsm_left\n"
        "\tmov r0, #255\n"
        ".LChnVolSetAsm_left:\n"
        "\tstrb r0, [r4, #3]\n"
        "\tbx lr");
#else
    u32 velocity = chan->data.sound.velocity;
    s32 pan = (s8)chan->data.sound.rhythmPan;
    u32 volume = (track->volRightCalculated * ((0x80 + pan) * velocity)) >> 14;
    if (volume > 0xFF)
        volume = 0xFF;
    chan->rightVol = volume;
    volume = (track->volLeftCalculated * ((0x7F - pan) * velocity)) >> 14;
    if (volume > 0xFF)
        volume = 0xFF;
    chan->leftVol = volume;
#endif
}

/**
 * A note, for as long as the clock table's entry `clock` says, with its key, velocity and added length if the
 * commands give them: the instrument found, a channel taken for it, one of the console's own or the quietest of the
 * mixer's, and the note started there.
 */
void MP2K_event_nxx(u8 clock, struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\t.equ m4a_sound_info_ptr, 0x03000000 + 0x7FF0\n"
        "\tpush {r4-r7,lr}\n"
        "\tmov r4, r8\n"
        "\tmov r5, r9\n"
        "\tmov r6, r10\n"
        "\tmov r7, r11\n"
        "\tpush {r4-r7}\n"
        "\tsub sp, #24\n"
        "\tstr r1, [sp, #0]\n"
        "\tmov r5, r2\n"
        "\tldr r1, .LMP2K_event_nxx_sound_info_ptr\n"
        "\tldr r1, [r1, #0]\n"
        "\tstr r1, [sp, #4]\n"
        "\tldr r1, .LMP2K_event_nxx_clock_table\n"
        "\tadd r0, r0, r1\n"
        "\tldrb r0, [r0, #0]\n"
        "\tstrb r0, [r5, #4]\n"
        "\tldr r3, [r5, #64]\n"
        "\tldrb r0, [r3, #0]\n"
        "\tcmp r0, #128\n"
        "\tbcs .LMP2K_event_nxx_46\n"
        "\tstrb r0, [r5, #5]\n"
        "\tadd r3, #1\n"
        "\tldrb r0, [r3, #0]\n"
        "\tcmp r0, #128\n"
        "\tbcs .LMP2K_event_nxx_44\n"
        "\tstrb r0, [r5, #6]\n"
        "\tadd r3, #1\n"
        "\tldrb r0, [r3, #0]\n"
        "\tcmp r0, #128\n"
        "\tbcs .LMP2K_event_nxx_44\n"
        "\tldrb r1, [r5, #4]\n"
        "\tadd r1, r1, r0\n"
        "\tstrb r1, [r5, #4]\n"
        "\tadd r3, #1\n"
        ".LMP2K_event_nxx_44:\n"
        "\tstr r3, [r5, #64]\n"
        ".LMP2K_event_nxx_46:\n"
        "\tmov r0, #0\n"
        "\tstr r0, [sp, #20]\n"
        "\tmov r4, r5\n"
        "\tadd r4, #36\n"
        "\tldrb r2, [r4, #0]\n"
        "\tmov r0, #192\n"
        "\ttst r0, r2\n"
        "\tbeq .LMP2K_event_nxx_98\n"
        "\tldrb r3, [r5, #5]\n"
        "\tmov r0, #64\n"
        "\ttst r0, r2\n"
        "\tbeq .LMP2K_event_nxx_66\n"
        "\tldr r1, [r5, #44]\n"
        "\tadd r1, r1, r3\n"
        "\tldrb r0, [r1, #0]\n"
        "\tb .LMP2K_event_nxx_68\n"
        ".LMP2K_event_nxx_66:\n"
        "\tmov r0, r3\n"
        ".LMP2K_event_nxx_68:\n"
        "\tlsl r1, r0, #1\n"
        "\tadd r1, r1, r0\n"
        "\tlsl r1, r1, #2\n"
        "\tldr r0, [r5, #40]\n"
        "\tadd r1, r1, r0\n"
        "\tmov r9, r1\n"
        "\tmov r6, r9\n"
        "\tldrb r1, [r6, #0]\n"
        "\tmov r0, #192\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2K_event_nxx_80\n"
        "\tb .LMP2K_event_nxx_1E6\n"
        ".LMP2K_event_nxx_80:\n"
        "\tmov r0, #128\n"
        "\ttst r0, r2\n"
        "\tbeq .LMP2K_event_nxx_9C\n"
        "\tldrb r1, [r6, #3]\n"
        "\tmov r0, #128\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2K_event_nxx_94\n"
        "\tsub r1, #192\n"
        "\tlsl r1, r1, #1\n"
        "\tstr r1, [sp, #20]\n"
        ".LMP2K_event_nxx_94:\n"
        "\tldrb r3, [r6, #1]\n"
        "\tb .LMP2K_event_nxx_9C\n"
        ".LMP2K_event_nxx_98:\n"
        "\tmov r9, r4\n"
        "\tldrb r3, [r5, #5]\n"
        ".LMP2K_event_nxx_9C:\n"
        "\tstr r3, [sp, #8]\n"
        "\tldr r6, [sp, #0]\n"
        "\tldrb r1, [r6, #9]\n"
        "\tldrb r0, [r5, #29]\n"
        "\tadd r0, r0, r1\n"
        "\tcmp r0, #255\n"
        "\tbls .LMP2K_event_nxx_AC\n"
        "\tmov r0, #255\n"
        ".LMP2K_event_nxx_AC:\n"
        "\tstr r0, [sp, #16]\n"
        "\tmov r6, r9\n"
        "\tldrb r0, [r6, #0]\n"
        "\tmov r6, #7\n"
        "\tand r6, r0\n"
        "\tstr r6, [sp, #12]\n"
        "\tbeq .LMP2K_event_nxx_EC\n"
        "\tldr r0, [sp, #4]\n"
        "\tldr r4, [r0, #28]\n"
        "\tcmp r4, #0\n"
        "\tbne .LMP2K_event_nxx_C4\n"
        "\tb .LMP2K_event_nxx_1E6\n"
        ".LMP2K_event_nxx_C4:\n"
        "\tsub r6, #1\n"
        "\tlsl r0, r6, #6\n"
        "\tadd r4, r4, r0\n"
        "\tldrb r1, [r4, #0]\n"
        "\tmov r0, #199\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2K_event_nxx_140\n"
        "\tmov r0, #64\n"
        "\ttst r0, r1\n"
        "\tbne .LMP2K_event_nxx_140\n"
        "\tldrb r1, [r4, #19]\n"
        "\tldr r0, [sp, #16]\n"
        "\tcmp r1, r0\n"
        "\tbcc .LMP2K_event_nxx_140\n"
        "\tbeq .LMP2K_event_nxx_E4\n"
        "\tb .LMP2K_event_nxx_1E6\n"
        ".LMP2K_event_nxx_E4:\n"
        "\tldr r0, [r4, #44]\n"
        "\tcmp r0, r5\n"
        "\tbcs .LMP2K_event_nxx_140\n"
        "\tb .LMP2K_event_nxx_1E6\n"
        ".LMP2K_event_nxx_EC:\n"
        "\tldr r6, [sp, #16]\n"
        "\tmov r7, r5\n"
        "\tmov r2, #0\n"
        "\tmov r8, r2\n"
        "\tldr r4, [sp, #4]\n"
        "\tldrb r3, [r4, #6]\n"
        "\tadd r4, #80\n"
        ".LMP2K_event_nxx_FA:\n"
        "\tldrb r1, [r4, #0]\n"
        "\tmov r0, #199\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2K_event_nxx_140\n"
        "\tmov r0, #64\n"
        "\ttst r0, r1\n"
        "\tbeq .LMP2K_event_nxx_114\n"
        "\tcmp r2, #0\n"
        "\tbne .LMP2K_event_nxx_118\n"
        "\tadd r2, #1\n"
        "\tldrb r6, [r4, #19]\n"
        "\tldr r7, [r4, #44]\n"
        "\tb .LMP2K_event_nxx_132\n"
        ".LMP2K_event_nxx_114:\n"
        "\tcmp r2, #0\n"
        "\tbne .LMP2K_event_nxx_134\n"
        ".LMP2K_event_nxx_118:\n"
        "\tldrb r0, [r4, #19]\n"
        "\tcmp r0, r6\n"
        "\tbcs .LMP2K_event_nxx_124\n"
        "\tmov r6, r0\n"
        "\tldr r7, [r4, #44]\n"
        "\tb .LMP2K_event_nxx_132\n"
        ".LMP2K_event_nxx_124:\n"
        "\tbhi .LMP2K_event_nxx_134\n"
        "\tldr r0, [r4, #44]\n"
        "\tcmp r0, r7\n"
        "\tbls .LMP2K_event_nxx_130\n"
        "\tmov r7, r0\n"
        "\tb .LMP2K_event_nxx_132\n"
        ".LMP2K_event_nxx_130:\n"
        "\tbcc .LMP2K_event_nxx_134\n"
        ".LMP2K_event_nxx_132:\n"
        "\tmov r8, r4\n"
        ".LMP2K_event_nxx_134:\n"
        "\tadd r4, #64\n"
        "\tsub r3, #1\n"
        "\tbgt .LMP2K_event_nxx_FA\n"
        "\tmov r4, r8\n"
        "\tcmp r4, #0\n"
        "\tbeq .LMP2K_event_nxx_1E6\n"
        ".LMP2K_event_nxx_140:\n"
        "\tmov r0, r4\n"
        "\tbl ClearChain\n"
        "\tmov r1, #0\n"
        "\tstr r1, [r4, #48]\n"
        "\tldr r3, [r5, #32]\n"
        "\tstr r3, [r4, #52]\n"
        "\tcmp r3, #0\n"
        "\tbeq .LMP2K_event_nxx_154\n"
        "\tstr r4, [r3, #48]\n"
        ".LMP2K_event_nxx_154:\n"
        "\tstr r4, [r5, #32]\n"
        "\tstr r5, [r4, #44]\n"
        "\tldrb r0, [r5, #27]\n"
        "\tstrb r0, [r5, #28]\n"
        "\tcmp r0, r1\n"
        "\tbeq .LMP2K_event_nxx_166\n"
        "\tmov r1, r5\n"
        "\tbl clear_modM\n"
        ".LMP2K_event_nxx_166:\n"
        "\tldr r0, [sp, #0]\n"
        "\tmov r1, r5\n"
        "\tbl TrkVolPitSet\n"
        "\tldr r0, [r5, #4]\n"
        "\tstr r0, [r4, #16]\n"
        "\tldr r0, [sp, #16]\n"
        "\tstrb r0, [r4, #19]\n"
        "\tldr r0, [sp, #8]\n"
        "\tstrb r0, [r4, #8]\n"
        "\tldr r0, [sp, #20]\n"
        "\tstrb r0, [r4, #20]\n"
        "\tmov r6, r9\n"
        "\tldrb r0, [r6, #0]\n"
        "\tstrb r0, [r4, #1]\n"
        "\tldr r7, [r6, #4]\n"
        "\tstr r7, [r4, #36]\n"
        "\tldr r0, [r6, #8]\n"
        "\tstr r0, [r4, #4]\n"
        "\tldrh r0, [r5, #30]\n"
        "\tstrh r0, [r4, #12]\n"
        "\tbl ChnVolSetAsm\n"
        "\tldrb r1, [r4, #8]\n"
        "\tmov r0, #8\n"
        "\tldrsb r0, [r5, r0]\n"
        "\tadd r3, r1, r0\n"
        "\tbpl .LMP2K_event_nxx_1A0\n"
        "\tmov r3, #0\n"
        ".LMP2K_event_nxx_1A0:\n"
        "\tldr r6, [sp, #12]\n"
        "\tcmp r6, #0\n"
        "\tbeq .LMP2K_event_nxx_1CE\n"
        "\tmov r6, r9\n"
        "\tldrb r0, [r6, #2]\n"
        "\tstrb r0, [r4, #30]\n"
        "\tldrb r1, [r6, #3]\n"
        "\tmov r0, #128\n"
        "\ttst r0, r1\n"
        "\tbne .LMP2K_event_nxx_1BA\n"
        "\tmov r0, #112\n"
        "\ttst r0, r1\n"
        "\tbne .LMP2K_event_nxx_1BC\n"
        ".LMP2K_event_nxx_1BA:\n"
        "\tmov r1, #8\n"
        ".LMP2K_event_nxx_1BC:\n"
        "\tstrb r1, [r4, #31]\n"
        "\tldrb r2, [r5, #9]\n"
        "\tmov r1, r3\n"
        "\tldr r0, [sp, #12]\n"
        "\tldr r3, [sp, #4]\n"
        "\tldr r3, [r3, #48]\n"
        "\tbl .LMP2KPlayerMain_call_r3\n"
        "\tb .LMP2K_event_nxx_1D8\n"
        ".LMP2K_event_nxx_1CE:\n"
        "\tldrb r2, [r5, #9]\n"
        "\tmov r1, r3\n"
        "\tmov r0, r7\n"
        "\tbl MidiKeyToFreq\n"
        ".LMP2K_event_nxx_1D8:\n"
        "\tstr r0, [r4, #32]\n"
        "\tmov r0, #128\n"
        "\tstrb r0, [r4, #0]\n"
        "\tldrb r1, [r5, #0]\n"
        "\tmov r0, #240\n"
        "\tand r0, r1\n"
        "\tstrb r0, [r5, #0]\n"
        ".LMP2K_event_nxx_1E6:\n"
        "\tadd sp, #24\n"
        "\tpop {r0-r7}\n"
        "\tmov r8, r0\n"
        "\tmov r9, r1\n"
        "\tmov r10, r2\n"
        "\tmov r11, r3\n"
        "\tpop {r0}\n"
        "\tbx r0\n"
        "\t.hword 0x0000\n"
        ".LMP2K_event_nxx_sound_info_ptr:\n"
        "\t.word m4a_sound_info_ptr\n"
        ".LMP2K_event_nxx_clock_table:\n"
        "\t.word gClockTable");
#else
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    struct MP2KVoiceGroup *voice;
    struct MixerSource *chan;
    u8 *at;
    u32 key, priority, cgb, pan = 0, type;
    s32 shifted;

    track->gateTime = gClockTable[clock];
    at = track->cmdPtr;
    if (*at < 0x80) {
        track->key = *at++;
        if (*at < 0x80) {
            track->velocity = *at++;
            if (*at < 0x80)
                track->gateTime += *at++;
        }
        track->cmdPtr = at;
    }

    // the instrument: the track's own, or the one its key split or drum kit gives the key
    type = track->voicegroup.type;
    if (type & (TONEDATA_TYPE_RHY | TONEDATA_TYPE_SPL)) {
        u32 n = track->key;
        if (type & TONEDATA_TYPE_SPL)
            n = track->voicegroup.data.keySplit.keySplitTable[n];
        voice = (struct MP2KVoiceGroup *)((u8 *)track->voicegroup.data.keySplit.group + n * 12);
        if (voice->type & (TONEDATA_TYPE_SPL | TONEDATA_TYPE_RHY))
            return;
        key = track->key;
        if (type & TONEDATA_TYPE_RHY) {
            if (voice->pan_sweep & 0x80)
                pan = (voice->pan_sweep - TONEDATA_P_S_PAN) << 1;
            key = voice->drumKey;
        }
    } else {
        voice = &track->voicegroup;
        key = track->key;
    }

    priority = mplayInfo->priority + track->priority;
    if (priority > 0xFF)
        priority = 0xFF;

    // the channel
    cgb = voice->type & TONEDATA_TYPE_CGB;
    if (cgb) {
        chan = soundInfo->cgbChans;
        if (chan == NULL)
            return;
        chan += cgb - 1;
        if ((chan->status & SOUND_CHANNEL_SF_ON) && !(chan->status & SOUND_CHANNEL_SF_STOP)) {
            if (chan->data.cgb.priority > priority)
                return;
            if (chan->data.cgb.priority == priority && chan->track < track)
                return;
        }
    } else {
        // a free channel, or else the stopping one, or else the playing one, of the lowest priority, and of those the
        // one of the latest track
        u32 lowest = priority, stopping = 0;
        struct MP2KTrack *latest = track;
        struct MixerSource *each = soundInfo->chans;
        s32 left = soundInfo->numChans;
        chan = NULL;
        do {
            u32 status = each->status;
            if (!(status & SOUND_CHANNEL_SF_ON)) {
                chan = each;
                goto take;
            }
            if (status & SOUND_CHANNEL_SF_STOP) {
                if (stopping == 0) {
                    stopping++;
                    lowest = each->data.sound.priority;
                    latest = each->track;
                    chan = each;
                    continue;
                }
            } else if (stopping != 0) {
                continue;
            }
            if (each->data.sound.priority < lowest) {
                lowest = each->data.sound.priority;
                latest = each->track;
                chan = each;
            } else if (each->data.sound.priority == lowest) {
                if (each->track > latest) {
                    latest = each->track;
                    chan = each;
                } else if (each->track == latest) {
                    chan = each;
                }
            }
        } while (each++, --left > 0);
        if (chan == NULL)
            return;
    }

take:
    ClearChain(chan);
    chan->prev = NULL;
    chan->next = track->chan;
    if (track->chan != NULL)
        ((struct MixerSource *)track->chan)->prev = chan;
    track->chan = chan;
    chan->track = track;
    track->lfoDelayCounter = track->lfoDelay;
    if (track->lfoDelay != 0)
        clear_modM(mplayInfo, track);
    TrkVolPitSet(mplayInfo, track);

    chan->data.sound.gateTime = track->gateTime;
    chan->data.sound.untransposedKey = track->key;
    chan->data.sound.velocity = track->velocity;
    chan->data.sound.priority = priority;
    chan->data.sound.key = key;
    chan->data.sound.rhythmPan = pan;
    chan->type = voice->type;
    chan->wav = voice->data.sound.wav;
    chan->data.sound.attack = voice->data.sound.attack;
    chan->data.sound.decay = voice->data.sound.decay;
    chan->data.sound.sustain = voice->data.sound.sustain;
    chan->data.sound.release = voice->data.sound.release;
    chan->data.sound.echoVol = track->echoVolume;
    chan->data.sound.echoLen = track->echoLength;
    ChnVolSetAsm(chan, track);

    shifted = chan->data.sound.key + track->keyShiftCalculated;
    if (shifted < 0)
        shifted = 0;
    if (cgb) {
        u32 sweep = voice->pan_sweep;
        chan->data.cgb.length = voice->cgbLength;
        if ((sweep & 0x80) || !(sweep & 0x70))
            sweep = 8;
        chan->data.cgb.sweep = sweep;
        chan->data.sound.freq = soundInfo->MidiKeyToCgbFreq(cgb, shifted, track->pitchCalculated);
    } else {
        chan->data.sound.freq = MidiKeyToFreq(voice->data.sound.wav, shifted, track->pitchCalculated);
    }
    chan->status = SOUND_CHANNEL_SF_START;
    track->status &= 0xF0;
#endif
}

/** Ends a tied note: the first channel of the track still sounding the key the commands give, or the track's. */
void MP2K_event_endtie(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tpush {r4-r5}\n"
        "\tldr r2, [r1, #64]\n"
        "\tldrb r3, [r2, #0]\n"
        "\tcmp r3, #128\n"
        "\tbcs .LMP2K_event_endtie_12\n"
        "\tstrb r3, [r1, #5]\n"
        "\tadd r2, #1\n"
        "\tstr r2, [r1, #64]\n"
        "\tb .LMP2K_event_endtie_14\n"
        ".LMP2K_event_endtie_12:\n"
        "\tldrb r3, [r1, #5]\n"
        ".LMP2K_event_endtie_14:\n"
        "\tldr r1, [r1, #32]\n"
        "\tcmp r1, #0\n"
        "\tbeq .LMP2K_event_endtie_3C\n"
        "\tmov r4, #131\n"
        "\tmov r5, #64\n"
        ".LMP2K_event_endtie_1E:\n"
        "\tldrb r2, [r1, #0]\n"
        "\ttst r2, r4\n"
        "\tbeq .LMP2K_event_endtie_36\n"
        "\ttst r2, r5\n"
        "\tbne .LMP2K_event_endtie_36\n"
        "\tldrb r0, [r1, #17]\n"
        "\tcmp r0, r3\n"
        "\tbne .LMP2K_event_endtie_36\n"
        "\tmov r0, #64\n"
        "\torr r2, r0\n"
        "\tstrb r2, [r1, #0]\n"
        "\tb .LMP2K_event_endtie_3C\n"
        ".LMP2K_event_endtie_36:\n"
        "\tldr r1, [r1, #52]\n"
        "\tcmp r1, #0\n"
        "\tbne .LMP2K_event_endtie_1E\n"
        ".LMP2K_event_endtie_3C:\n"
        "\tpop {r4-r5}\n"
        "\tbx lr");
#else
    struct MixerSource *chan;
    u8 *at = track->cmdPtr;
    u32 key = *at;
    if (key < 0x80) {
        track->key = key;
        track->cmdPtr = at + 1;
    } else {
        key = track->key;
    }
    for (chan = track->chan; chan != NULL; chan = chan->next) {
        u32 status = chan->status;
        if ((status & (SOUND_CHANNEL_SF_START | SOUND_CHANNEL_SF_ENV)) && !(status & SOUND_CHANNEL_SF_STOP) && chan->data.sound.untransposedKey == key) {
            chan->status = status | SOUND_CHANNEL_SF_STOP;
            return;
        }
    }
#endif
}

/** The track's modulation back to nothing, and its volume or pitch to set again. */
void clear_modM(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r2, #0\n"
        "\tstrb r2, [r1, #22]\n"
        "\tstrb r2, [r1, #26]\n"
        "\tldrb r2, [r1, #24]\n"
        "\tcmp r2, #0\n"
        "\tbne .Lclear_modM_10\n"
        "\tmov r2, #12\n"
        "\tb .Lclear_modM_12\n"
        ".Lclear_modM_10:\n"
        "\tmov r2, #3\n"
        ".Lclear_modM_12:\n"
        "\tldrb r3, [r1, #0]\n"
        "\torr r3, r2\n"
        "\tstrb r3, [r1, #0]\n"
        "\tbx lr");
#else
    track->modCalculated = 0;
    track->lfoSpeedCounter = 0;
    track->status |= track->modType == 0 ? MPT_FLG_PITCHG : MPT_FLG_VOLCHG;
#endif
}

/**
 * The track's next byte of commands. The engine's routine takes the track in r1 and gives the byte back in r3:
 * dp:registers r3 = ld_r3_tp_adr_i_unchecked((struct MP2KTrack *)r1)
 */
u32 ld_r3_tp_adr_i_unchecked(struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tldr r2, [r1, #64]\n"
        "\tadd r3, r2, #1\n"
        "\tstr r3, [r1, #64]\n"
        "\tldrb r3, [r2, #0]\n"
        "\tbx lr");
#else
    u8 *at = track->cmdPtr;
    track->cmdPtr = at + 1;
    return *at;
#endif
}

/** The track's LFO's speed. */
void MP2K_event_lfos(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i_unchecked\n"
        "\tstrb r3, [r1, #25]\n"
        "\tcmp r3, #0\n"
        "\tbne .LMP2K_event_lfos_10\n"
        "\tbl clear_modM\n"
        ".LMP2K_event_lfos_10:\n"
        "\tbx r12");
#else
    track->lfoSpeed = ld_r3_tp_adr_i_unchecked(track);
    if (track->lfoSpeed == 0)
        clear_modM(mplayInfo, track);
#endif
}

/** The track's modulation's depth. */
void MP2K_event_mod(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
#ifdef MATCHING
    asm("\tmov r12, lr\n"
        "\tbl ld_r3_tp_adr_i_unchecked\n"
        "\tstrb r3, [r1, #23]\n"
        "\tcmp r3, #0\n"
        "\tbne .LMP2K_event_mod_10\n"
        "\tbl clear_modM\n"
        ".LMP2K_event_mod_10:\n"
        "\tbx r12");
#else
    track->modDepth = ld_r3_tp_adr_i_unchecked(track);
    if (track->modDepth == 0)
        clear_modM(mplayInfo, track);
#endif
}
