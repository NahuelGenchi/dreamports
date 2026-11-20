// The m4a sound engine's mixer, MusicPlayer2000's, as C. The engine has it in assembly, partly ARM code it copies to
// the fast work memory and runs from there (SAT-R's m4a0.s, NOTICE.md), which no compiler gives back. Each frame it
// writes the samples of every channel into the buffer the sound DMA plays, in the work memory a Dreamport compares
// with the console's, so this C writes every byte of it as the ARM code does: its proof is the same memory.
#include "m4a_internal.h"

// A sample into a byte of the buffer, as the mixer adds it: the second byte of the sample times the channel's volume,
// added to what's there, kept to a byte.
#define MIX(at, volume, sample) (*(at) = (s8)(*(at) + (((s32)(volume) * (s32)(sample)) >> 8)))

/** The high 32 bits of an unsigned 64-bit product. */
u32 umul3232H32(u32 multiplier, u32 multiplicand)
{
    return (u32)(((u64)multiplier * multiplicand) >> 32);
}

/** The engine's work for a frame: the music players' step, the console's own channels, then the mix. */
void SoundMain(void)
{
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
}

/**
 * The mix, which the engine runs from its copy in the fast work memory: the frame's part of the buffer cleared, or
 * echoed if the reverb's on, then each channel's envelope stepped and its samples added in, the right half of the
 * buffer first and the left PCM_DMA_BUF_SIZE bytes on. On the console SoundMain jumps here with its own registers and
 * stack, so it's no function another calls, and it's proven through SoundMain.
 */
void SoundMainRAM(struct SoundMixerState *soundInfo, u32 dmaCounter, s8 *pcm, s32 samples, u32 maxLines)
{
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
}
