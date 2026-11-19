// The m4a sound engine's sequencer, MusicPlayer2000's, as C: what reads each track's commands and starts and stops its
// notes. The engine has it in Thumb assembly (SAT-R's m4a0.s, NOTICE.md), which no compiler gives back, so this C does
// an instruction's work at a time, and its proof is the same memory.
//
// A few of its routines take and give values in registers no C function uses (ldrb_r3_r2, chk_adr_r2,
// ld_r3_tp_adr_i, ld_r3_tp_adr_i_unchecked, ChnVolSetAsm): here they're C functions, proven through the functions
// that call them.
#include "m4a_internal.h"

/** Clears the 64 bytes at `at`. */
void SoundMainBTM(void *at)
{
    u32 *word = at;
    u32 i;
    for (i = 0; i < 16; i++)
        word[i] = 0;
}

/** Takes a channel out of its track's chain of channels, if it's in one. */
void MP2KClearChain(struct MixerSource *chan)
{
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
}

/** The command that ends a track: each of its channels told to stop and taken out of its chain. */
void MP2K_event_fine(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    struct MixerSource *chan;
    for (chan = track->chan; chan != NULL; chan = chan->next) {
        if (chan->status & SOUND_CHANNEL_SF_ON)
            chan->status |= SOUND_CHANNEL_SF_STOP;
        MP2KClearChain(chan);
    }
    track->status = 0;
}

/**
 * Whether the engine reads at `at`: anywhere from the work memory on, and in the BIOS only from its own table of
 * commands up, which is never, as that table is in the cartridge. A value it won't read is 0.
 */
u32 chk_adr_r2(const void *at)
{
    if ((u32)at >> 25)
        return TRUE;
    if ((u32)at < (u32)gMPlayJumpTableTemplate)
        return FALSE;
    return ((u32)at >> 14) == 0;
}

/** The byte at `at`, if the engine reads there. */
u32 ldrb_r3_r2(const u8 *at)
{
    return chk_adr_r2(at) ? *at : 0;
}

/** The track's next byte of commands, if the engine reads there. */
u32 ld_r3_tp_adr_i(struct MP2KTrack *track)
{
    u8 *at = track->cmdPtr;
    track->cmdPtr = at + 1;
    return ldrb_r3_r2(at);
}

/** The track's next byte of commands. */
u32 ld_r3_tp_adr_i_unchecked(struct MP2KTrack *track)
{
    u8 *at = track->cmdPtr;
    track->cmdPtr = at + 1;
    return *at;
}

/** The sequencer's 36 commands, each its function's address, from the cartridge's table into `table`. */
void MPlayJumpTableCopy(void **table)
{
    void *const *from = gMPlayJumpTableTemplate;
    s32 i;
    for (i = 0x24; i > 0; i--, from++)
        *table++ = chk_adr_r2(from) ? *from : NULL;
}

/** Goes on from the address the next four bytes give. */
void MP2K_event_goto(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u8 *at = track->cmdPtr;
    track->cmdPtr = (u8 *)((u32)at[3] << 24 | (u32)at[2] << 16 | (u32)at[1] << 8 | ldrb_r3_r2(at));
}

/** Calls a pattern, three deep at most, or ends the track. */
void MP2K_event_patt(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    if (track->patternLevel >= 3) {
        MP2K_event_fine(mplayInfo, track);
        return;
    }
    track->patternStack[track->patternLevel] = track->cmdPtr + 4;
    track->patternLevel++;
    MP2K_event_goto(mplayInfo, track);
}

/** Back from a pattern. */
void MP2K_event_pend(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    if (track->patternLevel == 0)
        return;
    track->patternLevel--;
    track->cmdPtr = track->patternStack[track->patternLevel];
}

/** Goes back to an address a number of times, or for ever with 0. */
void MP2K_event_rept(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
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
}

/** The track's priority. */
void MP2K_event_prio(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->priority = ld_r3_tp_adr_i(track);
}

/** The song's tempo. */
void MP2K_event_tempo(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u32 tempo = ld_r3_tp_adr_i(track) << 1;
    mplayInfo->tempoRawBPM = tempo;
    mplayInfo->tempoInterval = (tempo * mplayInfo->tempoScale) >> 8;
}

/** The track's key shift. */
void MP2K_event_keysh(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->keyShift = ld_r3_tp_adr_i(track);
    track->status |= MPT_FLG_PITCHG;
}

/** The track's instrument, from the song's voice group. */
void MP2K_event_voice(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u8 *at = track->cmdPtr;
    u32 *voice, *own = (u32 *)&track->voicegroup;
    u32 n = *at;
    track->cmdPtr = at + 1;
    voice = (u32 *)((u8 *)mplayInfo->voicegroup + n * 12);
    own[0] = chk_adr_r2(voice) ? voice[0] : 0;
    own[1] = chk_adr_r2(voice) ? voice[1] : 0;
    own[2] = chk_adr_r2(voice) ? voice[2] : 0;
}

/** The track's volume. */
void MP2K_event_vol(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->vol = ld_r3_tp_adr_i(track);
    track->status |= MPT_FLG_VOLCHG;
}

/** The track's pan. */
void MP2K_event_pan(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->pan = ld_r3_tp_adr_i(track) - C_V;
    track->status |= MPT_FLG_VOLCHG;
}

/** The track's pitch bend. */
void MP2K_event_bend(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->bend = ld_r3_tp_adr_i(track) - C_V;
    track->status |= MPT_FLG_PITCHG;
}

/** The track's pitch bend's range. */
void MP2K_event_bendr(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->bendRange = ld_r3_tp_adr_i(track);
    track->status |= MPT_FLG_PITCHG;
}

/** The track's LFO's delay. */
void MP2K_event_lfodl(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->lfoDelay = ld_r3_tp_adr_i(track);
}

/** What the track's modulation changes, pitch or volume. */
void MP2K_event_modt(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u32 type = ld_r3_tp_adr_i(track);
    if (track->modType == type)
        return;
    track->modType = type;
    track->status |= MPT_FLG_VOLCHG | MPT_FLG_PITCHG;
}

/** The track's tuning. */
void MP2K_event_tune(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->tune = ld_r3_tp_adr_i(track) - C_V;
    track->status |= MPT_FLG_PITCHG;
}

/** A byte straight into a sound register, the one the next byte names from the first of them on. */
void MP2K_event_port(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    u8 *at = track->cmdPtr;
    u32 reg = *at;
    at++;
    track->cmdPtr = at + 1;
    M4A_REG(8, 0x060 + reg) = ldrb_r3_r2(at);
}

/** The engine's work at each V-blank: the sound DMA started again at the start of each of its periods. */
void m4aSoundVSync(void)
{
    struct SoundMixerState *soundInfo = SOUND_INFO_PTR;
    s32 counter;

    if (soundInfo->lockStatus - ID_NUMBER > 1)
        return;
    counter = soundInfo->dmaCounter - 1;
    soundInfo->dmaCounter = counter;
    if (counter > 0)
        return;
    soundInfo->dmaCounter = soundInfo->framesPerDmaCycle;

    if (REG_DMA1CNT & (DMA_REPEAT << 16))
        REG_DMA1CNT = ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4;
    if (REG_DMA2CNT & (DMA_REPEAT << 16))
        REG_DMA2CNT = ((DMA_ENABLE | DMA_START_NOW | DMA_32BIT | DMA_SRC_INC | DMA_DEST_FIXED) << 16) | 4;
    REG_DMA1CNT_H = DMA_32BIT;
    REG_DMA2CNT_H = DMA_32BIT;
    REG_DMA1CNT_H = DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT;
    REG_DMA2CNT_H = DMA_ENABLE | DMA_START_SPECIAL | DMA_32BIT | DMA_REPEAT;
}

void ChnVolSetAsm(struct MixerSource *chan, struct MP2KTrack *track);

/**
 * A music player's step for a frame: as many of its ticks as its tempo makes, each running every track's commands
 * up to its next wait and moving its LFO on, then each track's volume and pitch handed to its channels.
 */
void MP2KPlayerMain(struct MP2KPlayerState *mplayInfo)
{
    struct SoundMixerState *soundInfo;
    struct MP2KTrack *track;
    u32 tempo;
    s32 i;

    if (mplayInfo->lockStatus != ID_NUMBER)
        return;
    mplayInfo->lockStatus = ID_NUMBER + 1;
    if (mplayInfo->nextPlayerFunc != NULL)
        mplayInfo->nextPlayerFunc(mplayInfo->nextPlayer);

    if ((s32)mplayInfo->status < 0)
        goto end;
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
}

/** Stops a track: each of its channels off, the console's own told to stop, and out of the track. */
void TrackStop(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    struct MixerSource *chan;
    if (!(track->status & MPT_FLG_EXIST))
        return;
    for (chan = track->chan; chan != NULL; chan = chan->next) {
        if (chan->status != 0) {
            if (chan->type & TONEDATA_TYPE_CGB)
                SOUND_INFO_PTR->CgbOscOff(chan->type & TONEDATA_TYPE_CGB);
            chan->status = 0;
        }
        chan->track = NULL;
    }
    track->chan = NULL;
}

/** A channel's right and left volume, from its velocity and pan and its track's volume. */
void ChnVolSetAsm(struct MixerSource *chan, struct MP2KTrack *track)
{
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
}

void clear_modM(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track);

/**
 * A note, for as long as the clock table's entry `clock` says, with its key, velocity and added length if the
 * commands give them: the instrument found, a channel taken for it, one of the console's own or the quietest of the
 * mixer's, and the note started there.
 */
void MP2K_event_nxx(u8 clock, struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
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
}

/** Ends a tied note: the first channel of the track still sounding the key the commands give, or the track's. */
void MP2K_event_endtie(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
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
}

/** The track's modulation back to nothing, and its volume or pitch to set again. */
void clear_modM(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->modCalculated = 0;
    track->lfoSpeedCounter = 0;
    track->status |= track->modType == 0 ? MPT_FLG_PITCHG : MPT_FLG_VOLCHG;
}

/** The track's LFO's speed. */
void MP2K_event_lfos(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->lfoSpeed = ld_r3_tp_adr_i_unchecked(track);
    if (track->lfoSpeed == 0)
        clear_modM(mplayInfo, track);
}

/** The track's modulation's depth. */
void MP2K_event_mod(struct MP2KPlayerState *mplayInfo, struct MP2KTrack *track)
{
    track->modDepth = ld_r3_tp_adr_i_unchecked(track);
    if (track->modDepth == 0)
        clear_modM(mplayInfo, track);
}
