// The m4a sound engine's part written in C, MusicPlayer2000, as SAT-R's decompilation writes it (NOTICE.md), with its
// build switches set for the Game Boy Advance. A game was given it already built, with old_agbcc -O2, as library.json
// says. The engine's own variables and tables are the game's, where its proof/libraries.json says its copy has them.
#include "m4a_internal.h"

#define BSS_CODE __attribute__((section(".bss.code")))

extern char SoundMainRAM_Buffer[0x400];

extern struct MP2KTrack gMPlayTrack_BGM[16];
extern struct MP2KTrack gMPlayTrack_SE1[16];
extern struct MP2KTrack gMPlayTrack_SE2[16];
extern struct MP2KTrack gMPlayTrack_SE3[16];

// TODO: convert sound_data to C
// const struct MusicPlayer gMPlayTable[] = {
//     { &gMPlayInfo_BGM, gMPlayTrack_BGM, 16 },
//     { &gMPlayInfo_SE1, gMPlayTrack_SE1, 16 },
//     { &gMPlayInfo_SE2, gMPlayTrack_SE2, 16 },
//     { &gMPlayInfo_SE3, gMPlayTrack_SE3, 16 },
// };

extern struct SoundMixerState gSoundInfo;
extern void *gMPlayJumpTable[36];
extern struct MixerSource gCgbChans[4];

// For some reason these were declared in this order
extern struct MP2KPlayerState gMPlayInfo_BGM;
extern struct MP2KPlayerState gMPlayInfo_SE1;
extern struct MP2KPlayerState gMPlayInfo_SE2;
extern u8 gMPlayMemAccArea[4 * sizeof(uintptr_t)];
extern struct MP2KPlayerState gMPlayInfo_SE3;

void MP2K_event_null(void); // not static as SAT-R has it, so the twin check can call it

u32 MidiKeyToFreq(struct WaveData *wav, u8 key, u8 fineAdjust)
{
    u32 val1;
    u32 val2;
    u32 fineAdjustShifted = fineAdjust << 24;

    if (key > 178) {
        key = 178;
        fineAdjustShifted = 255 << 24;
    }

    val1 = gScaleTable[key];
    val1 = gFreqTable[val1 & 0xF] >> (val1 >> 4);

    val2 = gScaleTable[key + 1];
    val2 = gFreqTable[val2 & 0xF] >> (val2 >> 4);

    return umul3232H32(wav->freq, val1 + umul3232H32(val2 - val1, fineAdjustShifted));
}

UNUSED static void UnusedFunc(void) { }

void MPlayContinue(struct MP2KPlayerState *mplayInfo)
{
    if (mplayInfo->lockStatus == ID_NUMBER) {
        mplayInfo->lockStatus++;
        mplayInfo->status &= ~MUSICPLAYER_STATUS_PAUSE;
        mplayInfo->lockStatus = ID_NUMBER;
    }
}

void MPlayFadeOut(struct MP2KPlayerState *mplayInfo, u16 speed)
{
    if (mplayInfo->lockStatus == ID_NUMBER) {
        mplayInfo->lockStatus++;
        mplayInfo->fadeCounter = speed;
        mplayInfo->fadeInterval = speed;
        mplayInfo->fadeOV = (64 << FADE_VOL_SHIFT);
        mplayInfo->lockStatus = ID_NUMBER;
    }
}

void m4aSoundInit(void)
{
    s32 i;
    M4A_TIME(m4aSoundInit, 0x0, 0x10, M4A_AT(CpuSet, 0));
    CpuCopy32((void *)((s32)SoundMainRAM & ~1), SoundMainRAM_Buffer, sizeof(SoundMainRAM_Buffer));
    M4A_TIME(CpuSet, 0x2, 0x2, M4A_BACK);

    M4A_TIME(m4aSoundInit, 0x12, 0x16, M4A_AT(SoundInit, 0));
    SoundInit(&gSoundInfo);
    M4A_TIME(m4aSoundInit, 0x18, 0x1C, M4A_AT(MPlayExtender, 0));
    MPlayExtender(gCgbChans);
    M4A_TIME(m4aSoundInit, 0x1E, 0x22, M4A_AT(m4aSoundMode, 0));
    m4aSoundMode(DEFAULT_SOUND_MODE);

    for (i = 0; i < NUM_MUSIC_PLAYERS; i++) {
        struct MP2KPlayerState *mplayInfo = gMPlayTable[i].info;
#ifdef M4A_TIMED
        // the first turn has the count's test before it
        if (i == 0)
            M4A_TIME(m4aSoundInit, 0x24, 0x3C, M4A_AT(MPlayOpen, 0), M4A_ROM, M4A_ROM, M4A_ROM);
        else
            M4A_TIME(m4aSoundInit, 0x32, 0x3C, M4A_AT(MPlayOpen, 0), M4A_ROM, M4A_ROM, M4A_ROM);
#endif
        MPlayOpen(mplayInfo, gMPlayTable[i].track, gMPlayTable[i].numTracks);
        mplayInfo->checkSongPriority = gMPlayTable[i].unk_A;
        mplayInfo->memAccArea = gMPlayMemAccArea;
#ifdef M4A_TIMED
        if (i + 1 < NUM_MUSIC_PLAYERS)
            M4A_TIME(m4aSoundInit, 0x3E, 0x4C, M4A_AT(m4aSoundInit, 0x32), M4A_ROM, M4A_EW, M4A_EW);
        else
            M4A_TIME(m4aSoundInit, 0x3E, 0x52, M4A_BACK, M4A_ROM, M4A_EW, M4A_EW);
#endif
    }
}

void m4aSoundMain(void) { SoundMain(); }

void m4aSongNumStart(u16 n)
{
    const struct MusicPlayer *mplayTable = gMPlayTable;
    const struct Song *songTable = gSongTable;
    const struct Song *song = &songTable[n];
    const struct MusicPlayer *mplay = &mplayTable[song->ms];

    MPlayStart(mplay->info, song->header);
}

void m4aSongNumStartOrChange(u16 n)
{
    const struct MusicPlayer *mplayTable = gMPlayTable;
    const struct Song *songTable = gSongTable;
    const struct Song *song = &songTable[n];
    const struct MusicPlayer *mplay = &mplayTable[song->ms];

    if (mplay->info->songHeader != song->header) {
        MPlayStart(mplay->info, song->header);
    } else {
        if ((mplay->info->status & MUSICPLAYER_STATUS_TRACK) == 0 || (mplay->info->status & MUSICPLAYER_STATUS_PAUSE)) {
            MPlayStart(mplay->info, song->header);
        }
    }
}

void m4aSongNumStartOrContinue(u16 n)
{
    const struct MusicPlayer *mplayTable = gMPlayTable;
    const struct Song *songTable = gSongTable;
    const struct Song *song = &songTable[n];
    const struct MusicPlayer *mplay = &mplayTable[song->ms];

    if (mplay->info->songHeader != song->header)
        MPlayStart(mplay->info, song->header);
    else if ((mplay->info->status & MUSICPLAYER_STATUS_TRACK) == 0)
        MPlayStart(mplay->info, song->header);
    else if (mplay->info->status & MUSICPLAYER_STATUS_PAUSE)
        MPlayContinue(mplay->info);
}

void m4aSongNumStop(u16 n)
{
    const struct MusicPlayer *mplayTable = gMPlayTable;
    const struct Song *songTable = gSongTable;
    const struct Song *song = &songTable[n];
    const struct MusicPlayer *mplay = &mplayTable[song->ms];

    if (mplay->info->songHeader == song->header)
        MPlayStop(mplay->info);
}

void m4aSongNumContinue(u16 n)
{
    const struct MusicPlayer *mplayTable = gMPlayTable;
    const struct Song *songTable = gSongTable;
    const struct Song *song = &songTable[n];
    const struct MusicPlayer *mplay = &mplayTable[song->ms];

    if (mplay->info->songHeader == song->header)
        MPlayContinue(mplay->info);
}

void m4aMPlayAllStop(void)
{
    s32 i;

    for (i = 0; i < NUM_MUSIC_PLAYERS; i++)
        MPlayStop(gMPlayTable[i].info);
}

void m4aMPlayContinue(struct MP2KPlayerState *mplayInfo) { MPlayContinue(mplayInfo); }

void m4aMPlayAllContinue(void)
{
    s32 i;

    for (i = 0; i < NUM_MUSIC_PLAYERS; i++)
        MPlayContinue(gMPlayTable[i].info);
}

void m4aMPlayFadeOut(struct MP2KPlayerState *mplayInfo, u16 speed) { MPlayFadeOut(mplayInfo, speed); }

void m4aMPlayFadeOutTemporarily(struct MP2KPlayerState *mplayInfo, u16 speed)
{
    if (mplayInfo->lockStatus == ID_NUMBER) {
        mplayInfo->lockStatus++;
        mplayInfo->fadeCounter = speed;
        mplayInfo->fadeInterval = speed;
        mplayInfo->fadeOV = (64 << FADE_VOL_SHIFT) | TEMPORARY_FADE;
        mplayInfo->lockStatus = ID_NUMBER;
    }
}

void m4aMPlayFadeIn(struct MP2KPlayerState *mplayInfo, u16 speed)
{
    if (mplayInfo->lockStatus == ID_NUMBER) {
        mplayInfo->lockStatus++;
        mplayInfo->fadeCounter = speed;
        mplayInfo->fadeInterval = speed;
        mplayInfo->fadeOV = (0 << FADE_VOL_SHIFT) | FADE_IN;
        mplayInfo->status &= ~MUSICPLAYER_STATUS_PAUSE;
        mplayInfo->lockStatus = ID_NUMBER;
    }
}

void m4aMPlayImmInit(struct MP2KPlayerState *mplayInfo)
{
    s32 trackCount = mplayInfo->trackCount;
    struct MP2KTrack *track = mplayInfo->tracks;

    while (trackCount > 0) {
        if (track->status & MPT_FLG_EXIST) {
            if (track->status & MPT_FLG_START) {
                Clear64byte(track);
                track->status = MPT_FLG_EXIST;
                track->bendRange = 2;
                track->volPublic = 64;
                track->lfoSpeed = 22;
                track->voicegroup.type = 1;
            }
        }

        trackCount--;
        track++;
    }
}

void MPlayExtender(struct MixerSource *cgbChans)
{
    struct SoundMixerState *soundInfo;
    u32 lockStatus;

    REG_SOUNDCNT_X = SOUND_MASTER_ENABLE | SOUND_4_ON | SOUND_3_ON | SOUND_2_ON | SOUND_1_ON;
    REG_SOUNDCNT_L = 0; // set master volume to zero
    REG_NR12 = 0x8;
    REG_NR22 = 0x8;
    REG_NR42 = 0x8;
    REG_NR14 = 0x80;
    REG_NR24 = 0x80;
    REG_NR44 = 0x80;
    REG_NR30 = 0;
    REG_NR50 = 0x77;


    soundInfo = SOUND_INFO_PTR;

    lockStatus = soundInfo->lockStatus;

    if (lockStatus != ID_NUMBER)
        return;

    soundInfo->lockStatus++;

    gMPlayJumpTable[8] = MP2K_event_memacc;
    gMPlayJumpTable[17] = MP2K_event_lfos;
    gMPlayJumpTable[19] = MP2K_event_mod;
    gMPlayJumpTable[28] = MP2K_event_xcmd;
    gMPlayJumpTable[29] = MP2K_event_endtie;
    gMPlayJumpTable[30] = SampleFreqSet;
    gMPlayJumpTable[31] = TrackStop;
    gMPlayJumpTable[32] = FadeOutBody;
    gMPlayJumpTable[33] = TrkVolPitSet;

    soundInfo->cgbChans = cgbChans;
    soundInfo->CgbSound = CgbSound;
    soundInfo->CgbOscOff = CgbOscOff;
    soundInfo->MidiKeyToCgbFreq = MidiKeyToCgbFreq;
    soundInfo->maxScanlines = MAX_LINES;

    M4A_TIME(MPlayExtender, 0x0, 0x90, M4A_AT(CpuSet, 0), 0x04000084, 0x04000080, 0x04000063, 0x04000069, 0x04000079,
             0x04000065, 0x0400006D, 0x0400007D, 0x04000070, 0x04000080, M4A_IW, M4A_EW, M4A_EW, M4A_EW, M4A_EW,
             M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW);
    CpuFill32(0, cgbChans, sizeof(struct MixerSource) * 4);
    M4A_TIME(CpuSet, 0x2, 0x2, M4A_BACK);

    cgbChans[0].type = 1;
    cgbChans[0].data.cgb.panMask = 0x11;
    cgbChans[1].type = 2;
    cgbChans[1].data.cgb.panMask = 0x22;
    cgbChans[2].type = 3;
    cgbChans[2].data.cgb.panMask = 0x44;
    cgbChans[3].type = 4;
    cgbChans[3].data.cgb.panMask = 0x88;

    soundInfo->lockStatus = lockStatus;
    M4A_TIME(MPlayExtender, 0x92, 0xC6, M4A_BACK, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW,
             M4A_EW);
}

// The BIOS's copy of its own table of the engine's commands. A Dreamport has no BIOS, so it stops there.
void MusicPlayerJumpTableCopy(void)
{
#ifdef MATCHING
    asm("swi 0x2A");
#else
    // dp:stop
    __builtin_trap();
#endif
}

void ClearChain(struct MixerSource *chan)
{
    void (*func)(void *) = *(&gMPlayJumpTable[34]);
    func(chan);
}

void Clear64byte(void *x)
{
    void (*func)(void *) = *(&gMPlayJumpTable[35]);
    // the call goes through the compiler's own bx to the table's 36th command, SoundMainBTM in the engine's table
    M4A_TIME(Clear64byte, 0x0, 0x8, M4A_AT(_call_via_r1, 0), M4A_EW);
    M4A_TIME(_call_via_r1, 0x0, 0x0, M4A_AT(SoundMainBTM, 0));
    func(x);
    M4A_TIME(Clear64byte, 0xA, 0xC, M4A_BACK);
}

void SoundInit(struct SoundMixerState *soundInfo)
{
    soundInfo->lockStatus = 0;
    if (REG_DMA1CNT & (DMA_REPEAT << 16))
        REG_DMA1CNT = ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4;
    else
        M4A_TIME(SoundInit, 0x0, 0x16, M4A_AT(SoundInit, 0x1C), M4A_EW, 0x040000C4);
    if (REG_DMA2CNT & (DMA_REPEAT << 16))
        REG_DMA2CNT = ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4;
    else
        M4A_TIME(SoundInit, 0x1C, 0x24, M4A_AT(SoundInit, 0x2A), 0x040000D0);
    REG_DMA1CNT_H = DMA_32BIT;
    REG_DMA2CNT_H = DMA_32BIT;
    REG_SOUNDCNT_X = SOUND_MASTER_ENABLE | SOUND_4_ON | SOUND_3_ON | SOUND_2_ON | SOUND_1_ON;
    REG_SOUNDCNT_H = SOUND_B_FIFO_RESET | SOUND_B_TIMER_0 | SOUND_B_LEFT_OUTPUT | SOUND_A_FIFO_RESET | SOUND_A_TIMER_0
        | SOUND_A_RIGHT_OUTPUT | SOUND_ALL_MIX_FULL;
    REG_SOUNDBIAS_H = (REG_SOUNDBIAS_H & 0x3F) | 0x40;
    REG_DMA1SAD = (intptr_t)soundInfo->pcmBuffer;
    REG_DMA1DAD = (intptr_t)&REG_FIFO_A;
    REG_DMA2SAD = (intptr_t)soundInfo->pcmBuffer + PCM_DMA_BUF_SIZE;
    REG_DMA2DAD = (intptr_t)&REG_FIFO_B;

    SOUND_INFO_PTR = soundInfo;
    M4A_TIME(SoundInit, 0x2A, 0x82, M4A_AT(CpuSet, 0), 0x040000C6, 0x040000D2, 0x04000084, 0x04000082, 0x04000089,
             0x04000089, 0x040000BC, 0x040000C0, 0x040000C8, 0x040000CC, M4A_IW);
    CpuFill32(0, soundInfo, sizeof(struct SoundMixerState));
    M4A_TIME(CpuSet, 0x2, 0x2, M4A_BACK);

    soundInfo->numChans = 8;
    soundInfo->masterVol = 15;
    soundInfo->plynote = MP2K_event_nxx;
    soundInfo->CgbSound = MP2K_event_null;
    soundInfo->CgbOscOff = (CgbOscOffFunc)MP2K_event_null;
    soundInfo->MidiKeyToCgbFreq = (MidiKeyToCgbFreqFunc)MP2K_event_null;
    soundInfo->ExtVolPit = (ExtVolPitFunc)MP2K_event_null;

    M4A_TIME(SoundInit, 0x84, 0xA0, M4A_AT(MPlayJumpTableCopy, 0), M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW,
             M4A_EW);
    MPlayJumpTableCopy((void **)gMPlayJumpTable);

    soundInfo->MPlayJumpTable = gMPlayJumpTable;

    M4A_TIME(SoundInit, 0xA2, 0xAA, M4A_AT(SampleFreqSet, 0), M4A_EW);
    SampleFreqSet(SOUND_MODE_FREQ_13379);

    soundInfo->lockStatus = ID_NUMBER;
    M4A_TIME(SoundInit, 0xAC, 0xB6, M4A_BACK, M4A_EW);
}

void SampleFreqSet(u32 freq)
{
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;

    freq = (freq & 0xF0000) >> 16;
    soundInfo->freqOption = freq;

    soundInfo->samplesPerFrame = gPcmSamplesPerVBlankTable[freq - 1];
    M4A_TIME(SampleFreqSet, 0x0, 0x28, M4A_AT(__divsi3, 0), M4A_IW, M4A_EW, M4A_ROM, M4A_EW);
    M4A_DIVIDE(PCM_DMA_BUF_SIZE, soundInfo->samplesPerFrame);
    soundInfo->framesPerDmaCycle = PCM_DMA_BUF_SIZE / soundInfo->samplesPerFrame;

    // LCD refresh rate 59.7275Hz
    M4A_TIME(SampleFreqSet, 0x2A, 0x38, M4A_AT(__divsi3, 0), M4A_EW, 597275);
    M4A_DIVIDE(597275 * soundInfo->samplesPerFrame + 5000, 10000);
    soundInfo->sampleRate = (597275 * soundInfo->samplesPerFrame + 5000) / 10000;

    // CPU freq 16.78Mhz
    M4A_TIME(SampleFreqSet, 0x3A, 0x44, M4A_AT(__divsi3, 0), M4A_EW);
    M4A_DIVIDE(0x1000000, soundInfo->sampleRate);
    soundInfo->sampleRateReciprocal = (0x1000000 / soundInfo->sampleRate + 1) >> 1;

    // Turn off timer 0.
    REG_TM0CNT_H = 0;

    // cycles per LCD fresh 280896
    M4A_TIME(SampleFreqSet, 0x46, 0x58, M4A_AT(__divsi3, 0), M4A_EW, 0x04000102);
    M4A_DIVIDE(280896, soundInfo->samplesPerFrame);
    REG_TM0CNT_L = -(280896 / soundInfo->samplesPerFrame);

    M4A_TIME(SampleFreqSet, 0x5A, 0x60, M4A_AT(m4aSoundVSyncOn, 0), 0x04000100);
    m4aSoundVSyncOn();
    // each look at the line count is at its load's time: the runs before it come first
    M4A_TIME(SampleFreqSet, 0x62, 0x62, M4A_AT(SampleFreqSet, 0x64));
    while (*(vu8 *)REG_ADDR_VCOUNT == 159)
        M4A_TIME(SampleFreqSet, 0x64, 0x68, M4A_AT(SampleFreqSet, 0x64), 0x04000006);
    M4A_TIME(SampleFreqSet, 0x64, 0x6A, M4A_AT(SampleFreqSet, 0x6C), 0x04000006);

    while (*(vu8 *)REG_ADDR_VCOUNT != 159)
        M4A_TIME(SampleFreqSet, 0x6C, 0x70, M4A_AT(SampleFreqSet, 0x6C), 0x04000006);
    REG_TM0CNT_H = TIMER_ENABLE | TIMER_1CLK;
    M4A_TIME(SampleFreqSet, 0x6C, 0x7C, M4A_BACK, 0x04000006, 0x04000102);
}

void m4aSoundMode(u32 mode)
{
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    u32 temp;

    if (soundInfo->lockStatus != ID_NUMBER)
        return;

    soundInfo->lockStatus++;

    temp = mode & (SOUND_MODE_REVERB_SET | SOUND_MODE_REVERB_VAL);

    if (temp)
        soundInfo->reverb = temp & SOUND_MODE_REVERB_VAL;
    else
        M4A_TIME(m4aSoundMode, 0x0, 0x1A, M4A_AT(m4aSoundMode, 0x22), M4A_IW, M4A_EW, M4A_EW);

    temp = mode & SOUND_MODE_MAXCHN;

    if (temp) {
        struct MixerSource *chan;

        soundInfo->numChans = temp >> SOUND_MODE_MAXCHN_SHIFT;

        temp = MAX_DIRECTSOUND_CHANNELS;
        chan = &soundInfo->chans[0];

        while (temp != 0) {
            chan->status = 0;
            temp--;
            chan++;
            // each turn but the last, which goes on below: the first has the count's store before it
#ifdef M4A_TIMED
            if (temp == MAX_DIRECTSOUND_CHANNELS - 1)
                M4A_TIME(m4aSoundMode, 0x22, 0x40, M4A_AT(m4aSoundMode, 0x38), M4A_EW, M4A_EW);
            else if (temp != 0)
                M4A_TIME(m4aSoundMode, 0x38, 0x40, M4A_AT(m4aSoundMode, 0x38), M4A_EW);
#endif
        }
    }

    temp = mode & SOUND_MODE_MASVOL;

    if (temp)
        soundInfo->masterVol = temp >> SOUND_MODE_MASVOL_SHIFT;

    temp = mode & SOUND_MODE_DA_BIT;

    if (temp) {
        temp = (temp & 0x300000) >> 14;
        REG_SOUNDBIAS_H = (REG_SOUNDBIAS_H & 0x3F) | temp;
    }

    temp = mode & SOUND_MODE_FREQ;

    if (temp) {
        // on power-on's path, where the mode sets every part of the sound: from the channels' last turn
        M4A_TIME(m4aSoundMode, 0x38, 0x7A, M4A_AT(m4aSoundVSyncOff, 0), M4A_EW, M4A_EW, 0x04000089, 0x04000089);
        m4aSoundVSyncOff();
        M4A_TIME(m4aSoundMode, 0x7C, 0x80, M4A_AT(SampleFreqSet, 0));
        SampleFreqSet(temp);
    }

    soundInfo->lockStatus = ID_NUMBER;
    M4A_TIME(m4aSoundMode, 0x82, 0x8A, M4A_BACK, M4A_EW);
}

void SoundClear(void)
{
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    s32 i;
    struct MixerSource *chan;

    if (soundInfo->lockStatus != ID_NUMBER)
        return;

    soundInfo->lockStatus++;

    i = MAX_DIRECTSOUND_CHANNELS;
    chan = &soundInfo->chans[0];

    while (i > 0) {
        chan->status = 0;
        i--;
        chan = (void *)((intptr_t)chan + sizeof(struct MixerSource));
    }

    chan = soundInfo->cgbChans;

    if (chan) {
        i = 1;

        while (i <= 4) {
            soundInfo->CgbOscOff(i);
            chan->status = 0;
            i++;
            chan = (void *)((intptr_t)chan + sizeof(struct MixerSource));
        }
    }

    soundInfo->lockStatus = ID_NUMBER;
}

void m4aSoundVSyncOff(void)
{
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;

    if (soundInfo->lockStatus >= ID_NUMBER && soundInfo->lockStatus <= ID_NUMBER + 1) {
        soundInfo->lockStatus += 10;

        // each channel's control is timed as it's written, before the write of its top half below
        if (REG_DMA1CNT & (DMA_REPEAT << 16)) {
            M4A_TIME(m4aSoundVSyncOff, 0x0, 0x24, M4A_AT(m4aSoundVSyncOff, 0x26), M4A_IW, M4A_EW, M4A_EW, 0x040000C4);
            REG_DMA1CNT = ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4;
            M4A_TIME(m4aSoundVSyncOff, 0x26, 0x28, M4A_AT(m4aSoundVSyncOff, 0x2A), 0x040000C4);
        } else
            M4A_TIME(m4aSoundVSyncOff, 0x0, 0x24, M4A_AT(m4aSoundVSyncOff, 0x2A), M4A_IW, M4A_EW, M4A_EW, 0x040000C4);

        if (REG_DMA2CNT & (DMA_REPEAT << 16)) {
            M4A_TIME(m4aSoundVSyncOff, 0x2A, 0x32, M4A_AT(m4aSoundVSyncOff, 0x34), 0x040000D0);
            REG_DMA2CNT = ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4;
            M4A_TIME(m4aSoundVSyncOff, 0x34, 0x36, M4A_AT(m4aSoundVSyncOff, 0x38), 0x040000D0);
        } else
            M4A_TIME(m4aSoundVSyncOff, 0x2A, 0x32, M4A_AT(m4aSoundVSyncOff, 0x38), 0x040000D0);

        REG_DMA1CNT_H = DMA_32BIT;
        REG_DMA2CNT_H = DMA_32BIT;

        M4A_TIME(m4aSoundVSyncOff, 0x38, 0x56, M4A_AT(CpuSet, 0), 0x040000C6, 0x040000D2);
        CpuFill32(0, soundInfo->pcmBuffer, sizeof(soundInfo->pcmBuffer));
        M4A_TIME(CpuSet, 0x2, 0x2, M4A_BACK);
    }
    M4A_TIME(m4aSoundVSyncOff, 0x58, 0x5C, M4A_BACK);
}

void m4aSoundVSyncOn(void)
{
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    u32 lockStatus = soundInfo->lockStatus;

    if (lockStatus == ID_NUMBER)
        return;

    REG_DMA1CNT_H = DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT;
    REG_DMA2CNT_H = DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT;

    soundInfo->dmaCounter = 0;
    soundInfo->lockStatus = lockStatus - 10;
    M4A_TIME(m4aSoundVSyncOn, 0x0, 0x2C, M4A_BACK, M4A_IW, M4A_EW, 0x040000C6, 0x040000D2, M4A_EW, M4A_EW, M4A_EW);
}

void MPlayOpen(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *tracks, u8 trackCount)
{
    struct SoundMixerState *soundInfo;

    if (trackCount == 0)
        return;

    if (trackCount > MAX_MUSICPLAYER_TRACKS) {
        trackCount = MAX_MUSICPLAYER_TRACKS;
        M4A_TIME(MPlayOpen, 0x0, 0x12, M4A_AT(MPlayOpen, 0x14));
    } else
        M4A_TIME(MPlayOpen, 0x0, 0x10, M4A_AT(MPlayOpen, 0x14));

    soundInfo = SOUND_INFO_PTR;

    if (soundInfo->lockStatus != ID_NUMBER)
        return;

    soundInfo->lockStatus++;

    M4A_TIME(MPlayOpen, 0x14, 0x28, M4A_AT(Clear64byte, 0), M4A_IW, M4A_EW, M4A_EW);
    Clear64byte(mplayInfo);

    mplayInfo->tracks = tracks;
    mplayInfo->trackCount = trackCount;
    mplayInfo->status = MUSICPLAYER_STATUS_PAUSE;
    M4A_TIME(MPlayOpen, 0x2A, 0x38, M4A_AT(MPlayOpen, 0x3A), M4A_EW, M4A_EW, M4A_EW);

    while (trackCount != 0) {
        tracks->status = 0;
        trackCount--;
        tracks++;
        // each turn but the last, which goes on below
#ifdef M4A_TIMED
        if (trackCount != 0)
            M4A_TIME(MPlayOpen, 0x3A, 0x46, M4A_AT(MPlayOpen, 0x3A), M4A_EW);
#endif
    }

    // append music player and MP2KPlayerMain to linked list

    if (soundInfo->MPlayMainHead != NULL) {
        mplayInfo->nextPlayerFunc = soundInfo->MPlayMainHead;
        mplayInfo->nextPlayer = soundInfo->musicPlayerHead;
        // NULL assignment semantically useless, but required for match
        soundInfo->MPlayMainHead = NULL;
    }

    soundInfo->musicPlayerHead = mplayInfo;
    soundInfo->MPlayMainHead = MP2KPlayerMain;

    soundInfo->lockStatus = ID_NUMBER;
    mplayInfo->lockStatus = ID_NUMBER;
#ifdef M4A_TIMED
    // the chain had a player before, which this one now leads to, or none
    if (mplayInfo->nextPlayerFunc != NULL)
        M4A_TIME(MPlayOpen, 0x3A, 0x68, M4A_BACK, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW, M4A_EW,
                 M4A_EW);
    else {
        M4A_TIME(MPlayOpen, 0x3A, 0x4C, M4A_AT(MPlayOpen, 0x58), M4A_EW, M4A_EW);
        M4A_TIME(MPlayOpen, 0x58, 0x68, M4A_BACK, M4A_EW, M4A_EW, M4A_EW, M4A_EW);
    }
#endif
}

void MPlayStart(struct MP2KPlayerState *mplayInfo, struct MP2KSongHeader *songHeader)
{
    s32 i;
    u8 checkSongPriority;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    checkSongPriority = mplayInfo->checkSongPriority;

    if (!checkSongPriority
        || ((!mplayInfo->songHeader || !(mplayInfo->tracks[0].status & MPT_FLG_START))
            && ((mplayInfo->status & MUSICPLAYER_STATUS_TRACK) == 0 || (mplayInfo->status & MUSICPLAYER_STATUS_PAUSE)))
        || (mplayInfo->priority <= songHeader->priority)) {
        mplayInfo->lockStatus++;
        mplayInfo->status = 0;
        mplayInfo->songHeader = songHeader;
        mplayInfo->voicegroup = songHeader->voicegroup;
        mplayInfo->priority = songHeader->priority;
        mplayInfo->clock = 0;
        mplayInfo->tempoRawBPM = 150;
        mplayInfo->tempoInterval = 150;
        mplayInfo->tempoScale = 0x100;
        mplayInfo->tempoCounter = 0;
        mplayInfo->fadeInterval = 0;

        i = 0;
        track = mplayInfo->tracks;

        while (i < songHeader->trackCount && i < mplayInfo->trackCount) {
            TrackStop(mplayInfo, track);
            track->status = MPT_FLG_EXIST | MPT_FLG_START;
            track->chan = 0;
            track->cmdPtr = songHeader->part[i];
            i++;
            track++;
        }

        while (i < mplayInfo->trackCount) {
            TrackStop(mplayInfo, track);
            track->status = 0;
            i++;
            track++;
        }

        if (songHeader->reverb & SOUND_MODE_REVERB_SET)
            m4aSoundMode(songHeader->reverb);

        mplayInfo->lockStatus = ID_NUMBER;
    }
}

void MPlayStop(struct MP2KPlayerState *mplayInfo)
{
    s32 i;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    mplayInfo->lockStatus++;
    mplayInfo->status |= MUSICPLAYER_STATUS_PAUSE;

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;

    while (i > 0) {
        TrackStop(mplayInfo, track);
        i--;
        track++;
    }

    mplayInfo->lockStatus = ID_NUMBER;
}

void FadeOutBody(struct MP2KPlayerState *mplayInfo)
{
    s32 i;
    struct MP2KTrack *track;
    u16 fadeOV;

    if (mplayInfo->fadeInterval == 0)
        return;
    if (--mplayInfo->fadeCounter != 0)
        return;

    mplayInfo->fadeCounter = mplayInfo->fadeInterval;

    if (mplayInfo->fadeOV & FADE_IN) {
        if ((u16)(mplayInfo->fadeOV += (4 << FADE_VOL_SHIFT)) >= (64 << FADE_VOL_SHIFT)) {
            mplayInfo->fadeOV = (64 << FADE_VOL_SHIFT);
            mplayInfo->fadeInterval = 0;
        }
    } else {
        if ((s16)(mplayInfo->fadeOV -= (4 << FADE_VOL_SHIFT)) <= 0) {
            i = mplayInfo->trackCount;
            track = mplayInfo->tracks;

            while (i > 0) {
                u32 val;

                TrackStop(mplayInfo, track);

                val = TEMPORARY_FADE;
                fadeOV = mplayInfo->fadeOV;
                val &= fadeOV;

                if (!val)
                    track->status = 0;

                i--;
                track++;
            }

            if (mplayInfo->fadeOV & TEMPORARY_FADE)
                mplayInfo->status |= MUSICPLAYER_STATUS_PAUSE;
            else
                mplayInfo->status = MUSICPLAYER_STATUS_PAUSE;

            mplayInfo->fadeInterval = 0;
            return;
        }
    }

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;

    while (i > 0) {
        if (track->status & MPT_FLG_EXIST) {
            fadeOV = mplayInfo->fadeOV;

            track->volPublic = (fadeOV >> FADE_VOL_SHIFT);
            track->status |= MPT_FLG_VOLCHG;
        }

        i--;
        track++;
    }
}

void TrkVolPitSet(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    if (track->status & MPT_FLG_VOLSET) {
        s32 x;
        s32 y;

        x = (u32)(track->vol * track->volPublic) >> 5;

        if (track->modType == 1)
            x = (u32)(x * (track->modCalculated + 128)) >> 7;

        y = 2 * track->pan + track->panPublic;

        if (track->modType == 2)
            y += track->modCalculated;

        if (y < -128)
            y = -128;
        else if (y > 127)
            y = 127;

        track->volRightCalculated = (u32)((y + 128) * x) >> 8;
        track->volLeftCalculated = (u32)((127 - y) * x) >> 8;
    }

    if (track->status & MPT_FLG_PITSET) {
        s32 bend = track->bend * track->bendRange;
        s32 x = (track->tune + bend) * 4 + (track->keyShift << 8) + (track->keyShiftPublic << 8) + track->pitchPublic;

        if (track->modType == 0)
            x += 16 * track->modCalculated;

        track->keyShiftCalculated = x >> 8;
        track->pitchCalculated = x;
    }

    track->status &= ~(MPT_FLG_PITSET | MPT_FLG_VOLSET);
}

u32 MidiKeyToCgbFreq(u8 chanNum, u8 key, u8 fineAdjust)
{
    if (chanNum == 4) {
        if (key <= 20) {
            key = 0;
        } else {
            key -= 21;
            if (key > 59)
                key = 59;
        }

        return gNoiseTable[key];
    } else {
        s32 val1;
        s32 val2;

        if (key <= 35) {
            fineAdjust = 0;
            key = 0;
        } else {
            key -= 36;
            if (key > 130) {
                key = 130;
                fineAdjust = 255;
            }
        }

        val1 = gCgbScaleTable[key];
        val1 = gCgbFreqTable[val1 & 0xF] >> (val1 >> 4);

        val2 = gCgbScaleTable[key + 1];
        val2 = gCgbFreqTable[val2 & 0xF] >> (val2 >> 4);

        return val1 + ((fineAdjust * (val2 - val1)) >> 8) + 2048;
    }
}

void CgbOscOff(u8 chanNum)
{
    switch (chanNum) {
        case 1:
            REG_NR12 = 8;
            REG_NR14 = 0x80;
            break;
        case 2:
            REG_NR22 = 8;
            REG_NR24 = 0x80;
            break;
        case 3:
            REG_NR30 = 0;
            break;
        default:
            REG_NR42 = 8;
            REG_NR44 = 0x80;
    }
}

void CgbModVol(struct MixerSource *chan)
{
    // the decompilation's CgbPan, which the engine has inline: whether the pan is all to one side, set there if it is
    u32 rightVol = chan->rightVol;
    u32 leftVol = chan->leftVol;

    if ((rightVol = (u8)rightVol) >= (leftVol = (u8)leftVol)) {
        if (rightVol / 2 >= leftVol) {
            chan->data.cgb.pan = 0x0F;
            goto panned;
        }
    } else {
        if (leftVol / 2 >= rightVol) {
            chan->data.cgb.pan = 0xF0;
            goto panned;
        }
    }

    chan->data.cgb.pan = 0xFF;
    chan->data.cgb.envelopeGoal = (u32)(chan->rightVol + chan->leftVol) / 16;
    goto goal;

panned:
    chan->data.cgb.envelopeGoal = (u32)(chan->rightVol + chan->leftVol) / 16;

    if (chan->data.cgb.envelopeGoal > 15)
        chan->data.cgb.envelopeGoal = 15;

goal:
    chan->data.cgb.sustainGoal = (chan->data.cgb.envelopeGoal * chan->data.cgb.sustain + 15) >> 4;
    chan->data.cgb.pan &= chan->data.cgb.panMask;
}

void CgbSound(void)
{
    s32 ch;
    struct MixerSource *channels;
    s32 prevC15;
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    vu8 *nrx0ptr;
    vu8 *nrx1ptr;
    vu8 *nrx2ptr;
    vu8 *nrx3ptr;
    vu8 *nrx4ptr;
    s32 envelopeStepTimeAndDir;

    // Most comparision operations that cast to s8 perform 'and' by 0xFF.
    int mask = 0xff;

    if (soundInfo->cgbCounter15)
        soundInfo->cgbCounter15--;
    else
        soundInfo->cgbCounter15 = 14;

    for (ch = 1, channels = soundInfo->cgbChans; ch <= 4; ch++, channels++) {
        if (!(channels->status & SOUND_CHANNEL_SF_ON))
            continue;

        /* 1. determine hardware channel registers */
        switch (ch) {
            case 1:
                nrx0ptr = &REG_NR10;
                nrx1ptr = &REG_NR11;
                nrx2ptr = &REG_NR12;
                nrx3ptr = &REG_NR13;
                nrx4ptr = &REG_NR14;
                break;
            case 2:
                nrx0ptr = (vu8 *)(REG_ADDR_NR10 + 1);
                nrx1ptr = &REG_NR21;
                nrx2ptr = &REG_NR22;
                nrx3ptr = &REG_NR23;
                nrx4ptr = &REG_NR24;
                break;
            case 3:
                nrx0ptr = &REG_NR30;
                nrx1ptr = &REG_NR31;
                nrx2ptr = &REG_NR32;
                nrx3ptr = &REG_NR33;
                nrx4ptr = &REG_NR34;
                break;
            default:
                nrx0ptr = (vu8 *)(REG_ADDR_NR30 + 1);
                nrx1ptr = &REG_NR41;
                nrx2ptr = &REG_NR42;
                nrx3ptr = &REG_NR43;
                nrx4ptr = &REG_NR44;
                break;
        }

        prevC15 = soundInfo->cgbCounter15;
        envelopeStepTimeAndDir = *nrx2ptr;

        /* 2. calculate envelope volume */
        if (channels->status & SOUND_CHANNEL_SF_START) {
            if (!(channels->status & SOUND_CHANNEL_SF_STOP)) {
                channels->status = SOUND_CHANNEL_SF_ENV_ATTACK;
                channels->data.cgb.cgbStatus = CGB_CHANNEL_MO_PIT | CGB_CHANNEL_MO_VOL;
                CgbModVol(channels);
                switch (ch) {
                    case 1:
                        *nrx0ptr = channels->data.cgb.sweep;
                        // fallthrough
                    case 2:
                        *nrx1ptr = ((intptr_t)channels->wav << 6) + channels->data.cgb.length;
                        goto init_env_step_time_dir;
                    case 3:
                        if (channels->wav != channels->current) {
                            *nrx0ptr = 0x40;
                            REG_WAVE_RAM0 = ((u32 *)channels->wav)[0];
                            REG_WAVE_RAM1 = ((u32 *)channels->wav)[1];
                            REG_WAVE_RAM2 = ((u32 *)channels->wav)[2];
                            REG_WAVE_RAM3 = ((u32 *)channels->wav)[3];
                            channels->current = channels->wav;
                        }
                        *nrx0ptr = 0;
                        *nrx1ptr = channels->data.cgb.length;
                        if (channels->data.cgb.length)
                            channels->data.cgb.nrx4 = 0xC0;
                        else
                            channels->data.cgb.nrx4 = 0x80;
                        break;
                    default:
                        *nrx1ptr = channels->data.cgb.length;
                        *nrx3ptr = (intptr_t)channels->wav << 3;
                    init_env_step_time_dir:
                        envelopeStepTimeAndDir = channels->data.cgb.attack + CGB_NRx2_ENV_DIR_INC;
                        if (channels->data.cgb.length)
                            channels->data.cgb.nrx4 = 0x40;
                        else
                            channels->data.cgb.nrx4 = 0x00;
                        break;
                }
                channels->data.cgb.envelopeCtr = channels->data.cgb.attack;
                if ((s8)(channels->data.cgb.attack & mask)) {
                    channels->data.cgb.envelopeVol = 0;
                    goto envelope_step_complete;
                } else {
                    // skip attack phase if attack is instantaneous (=0)
                    goto envelope_decay_start;
                }
            } else {
                goto oscillator_off;
            }
        } else if (channels->status & SOUND_CHANNEL_SF_IEC) {
            channels->data.cgb.echoLen--;
            if ((s8)(channels->data.cgb.echoLen & mask) <= 0) {
            oscillator_off:
                CgbOscOff(ch);
                channels->status = 0;
                goto channel_complete;
            }
            goto envelope_complete;
        } else if ((channels->status & SOUND_CHANNEL_SF_STOP) && (channels->status & SOUND_CHANNEL_SF_ENV)) {
            channels->status &= ~SOUND_CHANNEL_SF_ENV;
            channels->data.cgb.envelopeCtr = channels->data.cgb.release;
            if ((s8)(channels->data.cgb.release & mask)) {
                channels->data.cgb.cgbStatus |= CGB_CHANNEL_MO_VOL;
                if (ch != 3)
                    envelopeStepTimeAndDir = channels->data.cgb.release | CGB_NRx2_ENV_DIR_DEC;
                goto envelope_step_complete;
            } else {
                goto envelope_pseudoecho_start;
            }
        } else {
        envelope_step_repeat:
            if (channels->data.cgb.envelopeCtr == 0) {
                if (ch == 3)
                    channels->data.cgb.cgbStatus |= CGB_CHANNEL_MO_VOL;

                CgbModVol(channels);
                if ((channels->status & SOUND_CHANNEL_SF_ENV) == SOUND_CHANNEL_SF_ENV_RELEASE) {
                    channels->data.cgb.envelopeVol--;
                    if ((s8)(channels->data.cgb.envelopeVol & mask) <= 0) {
                    envelope_pseudoecho_start:
                        channels->data.cgb.envelopeVol = ((channels->data.cgb.envelopeGoal * channels->data.cgb.echoVol) + 0xFF) >> 8;
                        if (channels->data.cgb.envelopeVol) {
                            channels->status |= SOUND_CHANNEL_SF_IEC;
                            channels->data.cgb.cgbStatus |= CGB_CHANNEL_MO_VOL;
                            if (ch != 3)
                                envelopeStepTimeAndDir = 0 | CGB_NRx2_ENV_DIR_INC;
                            goto envelope_complete;
                        } else {
                            goto oscillator_off;
                        }
                    } else {
                        channels->data.cgb.envelopeCtr = channels->data.cgb.release;
                    }
                } else if ((channels->status & SOUND_CHANNEL_SF_ENV) == SOUND_CHANNEL_SF_ENV_SUSTAIN) {
                envelope_sustain:
                    channels->data.cgb.envelopeVol = channels->data.cgb.sustainGoal;
                    channels->data.cgb.envelopeCtr = 7;
                } else if ((channels->status & SOUND_CHANNEL_SF_ENV) == SOUND_CHANNEL_SF_ENV_DECAY) {
                    int envelopeVol, sustainGoal;

                    channels->data.cgb.envelopeVol--;
                    envelopeVol = (s8)(channels->data.cgb.envelopeVol & mask);
                    sustainGoal = (s8)(channels->data.cgb.sustainGoal);
                    if (envelopeVol <= sustainGoal) {
                    envelope_sustain_start:
                        if (channels->data.cgb.sustain == 0) {
                            channels->status &= ~SOUND_CHANNEL_SF_ENV;
                            goto envelope_pseudoecho_start;
                        } else {
                            channels->status--;
                            channels->data.cgb.cgbStatus |= CGB_CHANNEL_MO_VOL;
                            if (ch != 3)
                                envelopeStepTimeAndDir = 0 | CGB_NRx2_ENV_DIR_INC;
                            goto envelope_sustain;
                        }
                    } else {
                        channels->data.cgb.envelopeCtr = channels->data.cgb.decay;
                    }
                } else {
                    channels->data.cgb.envelopeVol++;
                    if ((u8)(channels->data.cgb.envelopeVol & mask) >= channels->data.cgb.envelopeGoal) {
                    envelope_decay_start:
                        channels->status--;
                        channels->data.cgb.envelopeCtr = channels->data.cgb.decay;
                        if ((u8)(channels->data.cgb.envelopeCtr & mask)) {
                            channels->data.cgb.cgbStatus |= CGB_CHANNEL_MO_VOL;
                            channels->data.cgb.envelopeVol = channels->data.cgb.envelopeGoal;
                            if (ch != 3)
                                envelopeStepTimeAndDir = channels->data.cgb.decay | CGB_NRx2_ENV_DIR_DEC;
                        } else {
                            goto envelope_sustain_start;
                        }
                    } else {
                        channels->data.cgb.envelopeCtr = channels->data.cgb.attack;
                    }
                }
            }
        }

    envelope_step_complete:
        // every 15 frames, envelope calculation has to be done twice
        // to keep up with the hardware envelope rate (1/64 s)
        channels->data.cgb.envelopeCtr--;
        if (prevC15 == 0) {
            prevC15--;
            goto envelope_step_repeat;
        }

    envelope_complete:
        /* 3. apply pitch to HW registers */
        if (channels->data.cgb.cgbStatus & CGB_CHANNEL_MO_PIT) {
            if (ch < 4 && (channels->type & TONEDATA_TYPE_FIX)) {
                int dac_pwm_rate = REG_SOUNDBIAS_H;

                if (dac_pwm_rate < 0x40) // if PWM rate = 32768 Hz
                    channels->data.cgb.freq = (channels->data.cgb.freq + 2) & 0x7fc;
                else if (dac_pwm_rate < 0x80) // if PWM rate = 65536 Hz
                    channels->data.cgb.freq = (channels->data.cgb.freq + 1) & 0x7fe;
            }

            if (ch != 4)
                *nrx3ptr = channels->data.cgb.freq;
            else
                *nrx3ptr = (*nrx3ptr & 0x08) | channels->data.cgb.freq;
            channels->data.cgb.nrx4 = (channels->data.cgb.nrx4 & 0xC0) + (*((u8 *)(&channels->data.cgb.freq) + 1));
            *nrx4ptr = (s8)(channels->data.cgb.nrx4 & mask);
        }

        /* 4. apply envelope & volume to HW registers */
        if (channels->data.cgb.cgbStatus & CGB_CHANNEL_MO_VOL) {
            REG_NR51 = (REG_NR51 & ~channels->data.cgb.panMask) | channels->data.cgb.pan;
            if (ch == 3) {
                *nrx2ptr = gCgb3Vol[channels->data.cgb.envelopeVol];
                if (channels->data.cgb.nrx4 & 0x80) {
                    *nrx0ptr = 0x80;
                    *nrx4ptr = channels->data.cgb.nrx4;
                    channels->data.cgb.nrx4 &= 0x7f;
                }
            } else {
                u32 envMask = 0xF;
                *nrx2ptr = (envelopeStepTimeAndDir & envMask) + (channels->data.cgb.envelopeVol << 4);
                *nrx4ptr = channels->data.cgb.nrx4 | 0x80;
                if (ch == 1 && !(*nrx0ptr & 0x08))
                    *nrx4ptr = channels->data.cgb.nrx4 | 0x80;
            }
        }

    channel_complete:
        channels->data.cgb.cgbStatus = 0;
    }
}

void m4aMPlayTempoControl(struct MP2KPlayerState *mplayInfo, u16 tempo)
{
    if (mplayInfo->lockStatus == ID_NUMBER) {
        mplayInfo->lockStatus++;
        mplayInfo->tempoScale = tempo;
        mplayInfo->tempoInterval = (mplayInfo->tempoRawBPM * mplayInfo->tempoScale) >> 8;
        mplayInfo->lockStatus = ID_NUMBER;
    }
}

void m4aMPlayVolumeControl(struct MP2KPlayerState *mplayInfo, u16 trackBits, u16 volume)
{
    s32 i;
    u32 bit;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    mplayInfo->lockStatus++;

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;
    bit = 1;

    while (i > 0) {
        if (trackBits & bit) {
            if (track->status & MPT_FLG_EXIST) {
                track->volPublic = volume / 4;
                track->status |= MPT_FLG_VOLCHG;
            }
        }

        i--;
        track++;
        bit <<= 1;
    }

    mplayInfo->lockStatus = ID_NUMBER;
}

void m4aMPlayPitchControl(struct MP2KPlayerState *mplayInfo, u16 trackBits, s16 pitch)
{
    s32 i;
    u32 bit;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    mplayInfo->lockStatus++;

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;
    bit = 1;

    while (i > 0) {
        if (trackBits & bit) {
            if (track->status & MPT_FLG_EXIST) {
                track->keyShiftPublic = pitch >> 8;
                track->pitchPublic = pitch;
                track->status |= MPT_FLG_PITCHG;
            }
        }

        i--;
        track++;
        bit <<= 1;
    }

    mplayInfo->lockStatus = ID_NUMBER;
}

void m4aMPlayPanpotControl(struct MP2KPlayerState *mplayInfo, u16 trackBits, s8 pan)
{
    s32 i;
    u32 bit;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    mplayInfo->lockStatus++;

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;
    bit = 1;

    while (i > 0) {
        if (trackBits & bit) {
            if (track->status & MPT_FLG_EXIST) {
                track->panPublic = pan;
                track->status |= MPT_FLG_VOLCHG;
            }
        }

        i--;
        track++;
        bit <<= 1;
    }

    mplayInfo->lockStatus = ID_NUMBER;
}

void ClearModM(struct MP2KTrack *track)
{
    track->lfoSpeedCounter = 0;
    track->modCalculated = 0;

    if (track->modType == 0)
        track->status |= MPT_FLG_PITCHG;
    else
        track->status |= MPT_FLG_VOLCHG;
}

void m4aMPlayModDepthSet(struct MP2KPlayerState *mplayInfo, u16 trackBits, u8 modDepth)
{
    s32 i;
    u32 bit;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    mplayInfo->lockStatus++;

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;
    bit = 1;

    while (i > 0) {
        if (trackBits & bit) {
            if (track->status & MPT_FLG_EXIST) {
                track->modDepth = modDepth;

                if (!track->modDepth)
                    ClearModM(track);
            }
        }

        i--;
        track++;
        bit <<= 1;
    }

    mplayInfo->lockStatus = ID_NUMBER;
}

void m4aMPlayLFOSpeedSet(struct MP2KPlayerState *mplayInfo, u16 trackBits, u8 lfoSpeed)
{
    s32 i;
    u32 bit;
    struct MP2KTrack *track;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;

    mplayInfo->lockStatus++;

    i = mplayInfo->trackCount;
    track = mplayInfo->tracks;
    bit = 1;

    while (i > 0) {
        if (trackBits & bit) {
            if (track->status & MPT_FLG_EXIST) {
                track->lfoSpeed = lfoSpeed;

                if (!track->lfoSpeed)
                    ClearModM(track);
            }
        }

        i--;
        track++;
        bit <<= 1;
    }

    mplayInfo->lockStatus = ID_NUMBER;
}

#define MEMACC_COND_JUMP(cond)                                                                                                             \
    if (cond)                                                                                                                              \
        goto cond_true;                                                                                                                    \
    else                                                                                                                                   \
        goto cond_false;

void MP2K_event_memacc(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u32 op;
    u8 *addr;
    u8 data;

    op = *track->cmdPtr;
    track->cmdPtr++;

    addr = mplayInfo->memAccArea + *track->cmdPtr;
    track->cmdPtr++;

    data = *track->cmdPtr;
    track->cmdPtr++;

    switch (op) {
        case 0:
            *addr = data;
            return;
        case 1:
            *addr += data;
            return;
        case 2:
            *addr -= data;
            return;
        case 3:
            *addr = mplayInfo->memAccArea[data];
            return;
        case 4:
            *addr += mplayInfo->memAccArea[data];
            return;
        case 5:
            *addr -= mplayInfo->memAccArea[data];
            return;
        case 6:
            MEMACC_COND_JUMP(*addr == data)
            return;
        case 7:
            MEMACC_COND_JUMP(*addr != data)
            return;
        case 8:
            MEMACC_COND_JUMP(*addr > data)
            return;
        case 9:
            MEMACC_COND_JUMP(*addr >= data)
            return;
        case 10:
            MEMACC_COND_JUMP(*addr <= data)
            return;
        case 11:
            MEMACC_COND_JUMP(*addr < data)
            return;
        case 12:
            MEMACC_COND_JUMP(*addr == mplayInfo->memAccArea[data])
            return;
        case 13:
            MEMACC_COND_JUMP(*addr != mplayInfo->memAccArea[data])
            return;
        case 14:
            MEMACC_COND_JUMP(*addr > mplayInfo->memAccArea[data])
            return;
        case 15:
            MEMACC_COND_JUMP(*addr >= mplayInfo->memAccArea[data])
            return;
        case 16:
            MEMACC_COND_JUMP(*addr <= mplayInfo->memAccArea[data])
            return;
        case 17:
            MEMACC_COND_JUMP(*addr < mplayInfo->memAccArea[data])
            return;
        default:
            return;
    }

cond_true : {
    {
        void (*func)(struct MP2KPlayerState *, struct MP2KTrack *) = *(&gMPlayJumpTable[1]);
        func(mplayInfo, track);
    }
    return;
}

cond_false:
    track->cmdPtr += sizeof(uintptr_t);
}

void MP2K_event_xcmd(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u32 n = *track->cmdPtr;
    track->cmdPtr++;

    gXcmdTable[n](mplayInfo, track);
}

void MP2K_event_xxx(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    void (*func)(struct MP2KPlayerState *, struct MP2KTrack *) = *(&gMPlayJumpTable[0]);
    func(mplayInfo, track);
}

void MP2K_event_xwave(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    union {
        u8 *a;
        u8 d[sizeof(uintptr_t)];
    } u;

    u.d[0] = *(track->cmdPtr + 0);
    u.d[1] = *(track->cmdPtr + 1);
    u.d[2] = *(track->cmdPtr + 2);
    u.d[3] = *(track->cmdPtr + 3);
    track->voicegroup.data.sound.wav = (struct WaveData *)u.a;
    track->cmdPtr += sizeof(uintptr_t);
}

void MP2K_event_xtype(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.type = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xatta(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.data.sound.attack = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xdeca(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.data.sound.decay = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xsust(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.data.sound.sustain = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xrele(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.data.sound.release = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xiecv(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->echoVolume = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xiecl(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->echoLength = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xleng(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.cgbLength = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_xswee(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->voicegroup.pan_sweep = *track->cmdPtr;
    track->cmdPtr++;
}

void MP2K_event_null(void) { }
