// The game's sound engine, GAX 3, rewritten from the original's instructions: songs of patterns, whose instruments
// play a little program of their own over a volume envelope, mixed by software into one 8-bit stream that DMA feeds to
// the console once a frame. Everything it plays is read from the player's copy, at the address the original reads.
//
// The original runs a frame of it from an interrupt at scanline 53 (0x080344EC), whatever the main loop is doing, and
// the V-blank (0x080434F8) starts the buffer just made. Each function here is named by its address in the USA copy.

const CARTRIDGE = 0x08000000;
// a console's frame in cycles, and the note that means a channel has nothing to play
const FRAME_CYCLES = 280896, NO_NOTE = -30000;
// 0x08F50B3C: the mix rates and the cycles between samples, and 0x08F50FC0: the steps for a note, an octave of 384
const RATES = 0x08F50B3C, STEPS = 0x08F50FC0, VIBRATO = 0x08F515C0;
// the music's volume, which the game's main function (0x0803B8C8) gives every channel
const MUSIC_VOLUME = 200;
// 0x0803407C: the sound effects' data, and how many channels they get
const EFFECTS = 0x0820445C, EFFECT_CHANNELS = 2;

/** The engine on `bytes`, the player's copy, for an output of `sampleRate`. */
export function createGax(bytes, sampleRate) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u8 = a => bytes[a - CARTRIDGE], s8 = a => (bytes[a - CARTRIDGE] << 24) >> 24;
  const u16 = a => view.getUint16(a - CARTRIDGE, true), s16 = a => view.getInt16(a - CARTRIDGE, true);
  const u32 = a => view.getUint32(a - CARTRIDGE, true), s32 = a => view.getInt32(a - CARTRIDGE, true);
  const toS8 = v => (v << 24) >> 24, toS16 = v => (v << 16) >> 16;

  const cyclesPerOutput = 16777216 / sampleRate;
  const queue = [];
  let cycles = FRAME_CYCLES, sampleCycles = 1064;
  let song = 0, playing = false, frameNumber = 1;
  // 0x0803407C's manager: the volume as it fades in, and where it's going
  let volume = 0, volumeTarget = 0, fadingIn = false, nextEffectChannel = 0;
  // the mix: its samples a frame, its volume's shift, what it holds, and what the console plays
  let length = 264, shift = 0, stepOfRate = 0, offset = 0, line = null, linePos = 0, tap = null;
  let mixed = new Uint16Array(0), output = new Int8Array(264), playingNow = new Int8Array(264);
  // 0x08044178: where the song is
  const state = { lastFrame: 0, pattern: -1, row: 20000, speed: 6, active: false, wait: 0, stepped: false, newPattern: false, master: 255, jump: false };
  let channels = [], effects = [];

  // 0x080454BC: a channel with nothing to play
  const channel = () => ({
    muted: 0, empty: 0, rest: 0, wave: 0, direction: 1, modulating: 0, modDirection: 0, modDelay: 0, vibDelay: 0, envelope: 0,
    perfVolume: 0, chVolume: 255, perfNote: NO_NOTE, vibrato: 0, perfSpeed: 0, fixed: 0, volume: 255, perfWait: 0, perfLoop: 0,
    keyOff: 0, volSlide: 0, noteSlide: 0, perfVolSlide: 0, perfNoteSlide: 0, target: 0, porta: 0, delay: 0, perfRow: 0,
    envPos: 0, vibPos: 0, inst: 0, at: 0, seq: 0, pos: 0, modPos: 0, priority: 0, note: 0, delayedNote: 0, delayedInst: 0,
    fxVolume: 255, fxFine: 0, fxUntie: 0, fxNote: 0, fxId: 0,
  });

  // 0x0803407C with 0x08042AD4: a song from its start, its volume fading in
  function startSong(address) {
    if (playing && song === address) return;
    song = address;
    const rate = u16(song + 24);
    // 0x08042AD4: the first of the rates that's at least the song's
    let entry = RATES;
    for (let i = 0; i < 12 && u16(entry) < rate; i++) entry += 4;
    const mixRate = u16(entry);
    sampleCycles = u16(entry + 2);
    length = Math.floor((mixRate * 1000) / 59727);
    stepOfRate = Math.floor(0x100000000 / mixRate);   // 0x08046D3C
    mixed = new Uint16Array(length + 8);
    output = new Int8Array(length);
    playingNow = new Int8Array(length);
    // 0x0804269C: a louder song mixes with fewer bits of volume, so it doesn't overflow
    const level = u16(song + 8);
    shift = level > 512 ? 2 : level > 256 ? 1 : 0;
    // 0x08042798: its reverb, if it has one: the delays and volumes of up to three echoes
    const before = u32(song + 160);
    tap = null;
    line = null;
    linePos = 0;
    const echoLength = u32(song + 196) ? u32(song + 188) : u32(song + 192);
    if (echoLength) line = new Int16Array(Math.floor((mixRate * echoLength) / 1000));
    if (line && before) {
      tap = { before, delays: [], volumes: [] };
      for (let i = 0; i < 3; i++) {
        tap.delays[i] = 2 * Math.floor((mixRate * u32(song + 164 + i * 4)) / 1000);
        tap.volumes[i] = u32(song + 176 + i * 4);
      }
    }
    // 0x08042A1C: every channel at the start, and 0x08044178: the song at its first frame
    channels = Array.from({ length: u8(song) }, (_, i) => Object.assign(channel(), { seq: u32(song + 32 + i * 4), chVolume: MUSIC_VOLUME }));
    effects = Array.from({ length: EFFECT_CHANNELS }, () => channel());
    Object.assign(state, { lastFrame: 0, pattern: -1, row: 20000, speed: 6, active: false, wait: 0, stepped: false, newPattern: false, master: 255, jump: false });
    frameNumber = 1;
    volume = 0;
    volumeTarget = 256;
    fadingIn = true;
    nextEffectChannel = 0;
    playing = true;
  }

  // 0x080342A4 with 0x080438AC and 0x08044098: a sound effect, from its three words, on the next channel that's free
  function playEffect(address) {
    if (!playing) return;
    const id = u32(address), priority = s32(address + 4), level = u32(address + 8);
    if (!id) return;
    let at = nextEffectChannel;
    if (priority < effects[at].priority) {
      at ^= 1;
      if (priority < effects[at].priority) return;
    }
    const ch = effects[at];
    Object.assign(ch, { fxNote: 8, fxFine: 0, fxUntie: 0, fxId: id, priority, fxVolume: 255, chVolume: Math.min(level, 255) });
    nextEffectChannel = at ^ 1;
  }

  // 0x080441AC: the song's clock, once a frame: the next row when its wait is over, and the next pattern after the last
  function tick() {
    const s = state;
    if (s.lastFrame === frameNumber || !s.active) return;
    if ((s.speed & 0xFF) !== 0 && s.wait <= 0) {
      if (s.jump) { s.jump = false; s.row = u16(song + 2); }
      else s.row++;
      if (s.speed >> 8) s.speed = (s.speed >> 8) | ((s.speed & 0xFF) << 8);
      s.wait = toS8(s.speed - 1);
      if (s.row >= u16(song + 2)) {
        s.row = 0;
        s.newPattern = true;
        s.pattern++;
        if (s.pattern >= u16(song + 4)) s.pattern = u16(song + 6);
      } else s.newPattern = false;
      s.stepped = true;
    } else {
      s.wait = toS8(s.wait - 1);
      s.stepped = false;
    }
    s.lastFrame = frameNumber;
  }

  const silence = ch => { ch.perfNote = NO_NOTE; ch.perfNoteSlide = 0; ch.priority = -0x80000000; };

  // an instrument starting on a channel, as 0x080455B4 and 0x08045ECC both do
  function startInstrument(ch, inst) {
    Object.assign(ch, { inst, envPos: 0, vibPos: 0, vibDelay: u8(inst + 8), perfRow: 0, perfWait: 0, perfLoop: 0, volume: 255, keyOff: 0, porta: 0, target: 0, perfSpeed: u8(inst + 16) });
    if (u8(inst) !== 0) ch.inst = 0;
  }

  // 0x080455B4: a channel's next row of its pattern, or with `delayed` the note that waited for its moment
  function stepChannel(ch, delayed) {
    const s = state;
    ch.volSlide = ch.noteSlide = ch.delay = 0;
    let note, inst, fx = 0, param = 0;
    if (delayed) { note = ch.delayedNote; inst = ch.delayedInst; }
    else {
      if (s.newPattern) {
        const p = u32(song + 12) + u16(ch.seq + s.pattern * 4);
        ch.rest = 0;
        ch.empty = u8(p);
        ch.at = p + 1;
      }
      if (ch.empty) return;
      if (ch.rest) { ch.rest--; return; }
      const p = ch.at, b = u8(p);
      if (b === 255) { ch.rest = (u8(p + 1) - 1) & 0xFF; ch.at = p + 2; return; }
      if (b & 0x80) {
        const v = b & 0x7F;
        if (v === 0) { ch.at = p + 1; return; }
        if (v <= 121) { note = v; inst = u8(p + 1); ch.at = p + 2; }
        else { note = 0; inst = 0; fx = u8(p + 1); param = u8(p + 2); ch.at = p + 3; }
      } else { note = b; inst = u8(p + 1); fx = u8(p + 2); param = u8(p + 3); ch.at = p + 4; }
      if (fx === 14 && (param >> 4) === 13) {
        ch.delay = param & 15;
        ch.delayedNote = note;
        ch.delayedInst = inst;
        return;
      }
    }
    if (fx !== 3) {
      if (note === 1) {
        if (ch.inst && u8(u32(ch.inst + 12) + 1) === 255) { silence(ch); ch.inst = 0; }
        ch.keyOff = 1;
      } else if (note > 1) {
        ch.note = (note - 2) << 5;
        ch.keyOff = 0;
      }
    }
    if (inst) startInstrument(ch, u32(u32(song + 16) + inst * 4));
    if (fx === 1) ch.noteSlide = param;
    else if (fx === 2) ch.noteSlide = -param;
    else if (fx === 3) {
      if (param) {
        ch.target = (note - 2) << 5;
        ch.porta = toS16(Math.trunc((ch.target - ch.note) / param));
      }
    } else if (fx === 7) {
      s.speed = (param >> 4) | ((param << 8) & 0xF00);
      s.wait = toS8(s.speed - 1);
    } else if (fx === 10) ch.volSlide = param;
    else if (fx === 11) ch.volSlide = -param;
    else if (fx === 12) ch.volume = param;
    else if (fx === 13) s.jump = true;
    else if (fx === 15) { s.speed = param; s.wait = toS8(param - 1); }
  }

  // 0x080457EC: the next line of the instrument's own program: its note, wave and two commands
  function stepProgram(ch) {
    const inst = ch.inst;
    if (ch.perfRow >= u8(inst + 17)) {
      ch.perfSpeed = 0;
      if (ch.perfNote === NO_NOTE) ch.priority = -0x80000000;
      return;
    }
    const rec = u32(inst + 20) + ch.perfRow * 8;
    ch.perfRow++;
    if (u8(rec)) {
      ch.perfNote = (u8(rec) - 2) << 5;
      ch.fixed = u8(rec + 1);
      if (u8(rec + 2)) {
        ch.wave = u8(rec + 2) - 1;
        const w = inst + ch.wave * 24 + 24;
        ch.pos = 0;
        ch.direction = 1;
        ch.perfVolume = 255;
        ch.modulating = 0;
        if (u8(w + 2) && s32(w + 8) < s32(w + 12) && s32(w + 16) > 0 && u16(w + 22) && u16(w + 20)) {
          ch.modulating = 1;
          ch.modPos = s32(w + 4);
          ch.pos = ch.modPos << 11;
          ch.modDelay = u16(w + 22) & 0xFF;
          ch.modDirection = ch.modPos + s32(w + 16) > s32(w + 12) ? -1 : 1;
        } else ch.pos = s32(w + 4) << 11;
      }
    }
    ch.perfVolSlide = ch.perfNoteSlide = 0;
    for (let i = 0; i < 2; i++) {
      const h = u16(rec + 4 + i * 2), fx = h >> 8, p = h & 0xFF;
      if (fx === 1) ch.perfNoteSlide = p;
      else if (fx === 2) ch.perfNoteSlide = -p;
      else if (fx === 5) {
        if (ch.perfLoop) {
          ch.perfLoop--;
          if (ch.perfLoop) ch.perfRow = p;
        } else ch.perfRow = p;
      } else if (fx === 6) { if (!ch.perfLoop) ch.perfLoop = p ? p + 1 : 0; }
      else if (fx === 10) ch.perfVolSlide = p;
      else if (fx === 11) ch.perfVolSlide = -p;
      else if (fx === 12) ch.perfVolume = p;
      else if (fx === 15) ch.perfSpeed = p;
    }
  }

  // 0x08045958: the volume envelope at the channel's place in it, with its sustain and its loop
  function envelope(ch, env) {
    const pos = ch.envPos & 0xFFFF;
    ch.envPos = (pos + 1) & 0xFFFF;
    const at = i => env + i * 8;
    const sustain = u8(env + 1), loopStart = u8(env + 2), loopEnd = u8(env + 3);
    if (sustain !== 255 && !ch.keyOff && pos === u16(at(sustain) + 4)) ch.envPos = pos;
    const last = u8(env) - 1;
    if (pos >= u16(at(last) + 4)) {
      if (u8(at(last) + 8) === 0 && (loopEnd === 255 || loopEnd < last)) silence(ch);
      ch.envPos = pos;
    }
    if (!ch.keyOff && loopStart !== 255 && loopEnd !== 255 && pos === u16(at(loopEnd) + 4)) ch.envPos = u16(at(loopStart) + 4);
    let i = 0;
    while (u16(at(i) + 4) < pos) i++;
    if (u16(at(i) + 4) === pos) return u8(at(i) + 8);
    const prev = at(i - 1);
    return (((pos - u16(prev + 4)) * s16(at(i) + 6)) >> 8) + u8(prev + 8) & 0xFF;
  }

  // 0x08045A1C: what changes a channel each frame: its envelope, vibrato, the wave's moving loop and its slides
  function updateChannel(ch) {
    const inst = ch.inst;
    if (inst) {
      ch.envelope = envelope(ch, u32(inst + 12));
      let vibrato = 0;
      if (u8(inst + 9)) {
        if (toS8(ch.vibDelay) <= 0) ch.vibPos = (ch.vibPos + u8(inst + 10)) & 63;
        else ch.vibDelay--;
        vibrato = (u8(inst + 9) * s8(VIBRATO + ch.vibPos)) >> 8;
      }
      ch.vibrato = vibrato;
      if (ch.modulating && --ch.modDelay <= 0) {
        const w = inst + ch.wave * 24 + 24, before = ch.modPos, stepBy = u16(w + 20);
        ch.modDelay = u16(w + 22) & 0xFF;
        if (ch.modDirection > 0) {
          ch.modPos += stepBy;
          if (ch.modPos + s32(w + 16) > s32(w + 12)) { ch.modPos -= stepBy * 2; ch.modDirection = -1; }
        } else {
          ch.modPos -= stepBy;
          if (ch.modPos < s32(w + 8)) { ch.modPos += stepBy * 2; ch.modDirection = 1; }
        }
        ch.pos = (ch.pos - (before << 11) + (ch.modPos << 11)) | 0;
      }
    }
    ch.volume = Math.max(0, Math.min(255, ch.volume + ch.volSlide));
    ch.perfVolume = Math.max(0, Math.min(255, ch.perfVolume + ch.perfVolSlide));
    ch.note = toS16(ch.note + ch.noteSlide);
    ch.perfNote = toS16(ch.perfNote + ch.perfNoteSlide);
    if (ch.porta) {
      const was = ch.target - ch.note < 0;
      ch.note = toS16(ch.note + ch.porta);
      if (was !== ch.target - ch.note < 0) { ch.porta = 0; ch.note = ch.target; ch.target = 0; }
    }
  }

  // the high word of a 32 by 32 bit multiplication (0x08046328)
  const high = (a, b) => Math.floor((a * (b >>> 16) + Math.floor((a * (b & 0xFFFF)) / 65536)) / 65536);

  // 0x08045B98: a channel's voice, mixed in this frame: true if it played
  function voice(ch, data, isEffect) {
    const inst = ch.inst;
    if (!inst || ch.perfNote === NO_NOTE || ch.wave > 3) return false;
    const entry = u32(data + 20) + u8(inst + 1 + ch.wave) * 8, w = inst + ch.wave * 24;
    if (u32(entry) === 0) return false;
    let pitch = ch.perfNote + ch.vibrato;
    if (!ch.fixed) {
      pitch += ch.note;
      if (!isEffect) pitch += s8(ch.seq + state.pattern * 4 + 2) << 5;
    }
    pitch = Math.max(0, Math.min(0xEF1, pitch + s16(w + 24)));
    let fine;
    if (pitch > 0xD7F) fine = u32(STEPS + (pitch - 0xD80) * 4) * 2;
    else {
      let at = pitch - 0xC00, down = 0;
      while (at < 0) { at += 384; down++; }
      fine = Math.floor(u32(STEPS + at * 4) / 2 ** down);
    }
    let level = (ch.envelope * ch.perfVolume) >> 8;
    level = (level * ch.volume) >> 8;
    level = (level * ch.chVolume) >> 8;
    level = (level * state.master) >> 8;
    if (!isEffect) level = (u16(data + 8) * level) >>> 8;
    level >>>= shift;
    offset += level << shift;
    let step = high(fine >>> 0, stepOfRate) | 0;
    const loopStart = s32(w + 32), loopEnd = s32(w + 36);
    const looped = !u8(w + 26) && loopStart < loopEnd;
    let end = u32(entry + 4) << 11, loop = 0;
    if (looped) { end = loopEnd << 11; loop = (loopEnd - loopStart) << 11; }
    if (ch.modulating) { end = (ch.modPos + s32(w + 40)) << 11; loop = s32(w + 40) << 11; }
    const base = u32(entry) + (end >> 11);
    let pos = (ch.pos - end) | 0;
    if (!looped && !ch.modulating) {
      // past its end, a wave reads a stretch of silence the first wave's table gives for its part of the cartridge
      const table = u32(u32(data + 20));
      loop = (base - u32(table + (((base - u32(table)) >> 20) * 4))) << 11;
    }
    if (!ch.modulating && looped && u8(w + 27)) {
      step = Math.imul(step, ch.direction);
      const after = mixBackAndForth(base, pos, loop, level, step);
      ch.direction = after.step < 0 ? -1 : 1;
      ch.pos = (after.pos + end - (after.step < 0 ? loop : 0)) | 0;
      return true;
    }
    pos = mixVoice(base, pos, loop, level, step);
    ch.pos = (pos + end) | 0;
    if (ch.pos < 0) {
      ch.perfNote = NO_NOTE;
      ch.perfNoteSlide = 0;
      if (!ch.perfSpeed) ch.priority = -0x80000000;
    }
    return true;
  }

  // 0x0804633C: a voice into the mix, four samples at a time, moving back round its loop past the end. The odd samples
  // lose their low bits, as they're worked out in the top half of a word with the even ones
  function mixVoice(base, pos, loop, level, step) {
    const down = 3 - shift, at = base - CARTRIDGE;
    for (let i = 0; i < length; i += 4) {
      for (let j = 0; j < 4; j++) {
        const value = bytes[at + (pos >> 11)] * level;
        mixed[i + j] += (j & 1 ? value & ~7 : value) >> down;
        pos = (pos + step) | 0;
        if (pos >= 0) pos = (pos - loop) | 0;
      }
    }
    return pos;
  }

  // 0x080463B0: the same for a loop that plays back and forth, turning at each end (0x08046434)
  function mixBackAndForth(base, pos, loop, level, step) {
    const down = 3 - shift, moved = loop >> 11;
    if (step < 0) { pos = (pos + loop) | 0; base -= moved; }
    for (let i = 0; i < length; i += 4) {
      for (let j = 0; j < 4; j++) {
        const value = bytes[base - CARTRIDGE + (pos >> 11)] * level;
        mixed[i + j] += (j & 1 ? value & ~7 : value) >> down;
        pos = (pos + step) | 0;
        if (step >= 0 ? pos >= 0 : pos < 0) {
          step = -step;
          pos = (pos + step * 2) | 0;
          if (step >= 0) { pos = (pos - loop) | 0; base += moved; }
          else { pos = (pos + loop) | 0; base -= moved; }
        }
      }
    }
    return { pos, step };
  }

  // 0x0804622C: the song's echoes, taken out of the mix's middle and put back, with its offset raised to match
  function mixEchoes() {
    const size = line.length;
    const before = offset << 4;
    offset += 256;
    const after = offset << 4;
    for (let i = 0; i < length; i++) {
      if (linePos === size) linePos = 0;
      const read = delay => { let at = linePos + size - (delay >> 1); if (at >= size) at -= size; return line[at]; };
      let wet = (read(tap.delays[0]) * tap.volumes[0]) >> 4;
      if (tap.delays[1]) {
        wet += (read(tap.delays[1]) * tap.volumes[1]) >> 4;
        if (tap.delays[2]) wet += read(tap.delays[2]) >> 4;
      }
      const value = toS16(mixed[i] - before + wet);
      line[linePos++] = value;
      mixed[i] = (value + after) & 0xFFFF;
    }
  }

  // 0x08045520: a music channel's frame
  function musicChannel(ch) {
    const s = state;
    if (ch.delay && --ch.delay === 0) stepChannel(ch, true);
    if (s.speed && s.stepped) stepChannel(ch, false);
    if (ch.inst && ch.perfWait === 0) {
      if (ch.perfSpeed) {
        stepProgram(ch);
        ch.perfWait = (ch.perfSpeed - 1) & 0xFF;
      }
    } else ch.perfWait = (ch.perfWait - 1) & 0xFF;
    updateChannel(ch);
    return ch.muted ? false : voice(ch, song, false);
  }

  // 0x08045ECC: a sound effect channel's frame
  function effectChannel(ch) {
    const n = ch.fxNote;
    if (n === 1 || (n !== 0 && ch.fxId !== 0)) {
      if (n === 1) {
        if (ch.inst && u8(u32(ch.inst + 12) + 1) === 255) { silence(ch); ch.inst = 0; }
        ch.keyOff = 1;
      } else if (n > 1) {
        ch.note = (n - 2) << 5;
        ch.keyOff = 0;
      }
      if (ch.fxId) startInstrument(ch, u32(u32(EFFECTS + 16) + ch.fxId * 4));
      if (n > 1) ch.note = toS16(ch.note + ch.fxFine);
      ch.volume = ch.fxVolume;
      ch.volSlide = ch.noteSlide = 0;
      ch.fxId = ch.fxFine = ch.fxNote = 0;
    }
    if (ch.inst && ch.perfWait === 0) {
      if (ch.perfSpeed) {
        stepProgram(ch);
        ch.perfWait = (ch.perfSpeed - 1) & 0xFF;
      }
    } else ch.perfWait = (ch.perfWait - 1) & 0xFF;
    updateChannel(ch);
    if (ch.fxUntie) ch.fixed = 0;
    return ch.muted ? false : voice(ch, EFFECTS, true);
  }

  // 0x08033FC0, 0x08043618 and 0x08044478: a frame: the volume's fade, the song's clock, every channel into the mix,
  // and the mix into the console's 8 bits, centred by the offset the voices' unsigned samples add up to (0x08046040)
  function frame() {
    if (!playing) return;
    if (fadingIn) {
      if (volume >= volumeTarget) { volume = volumeTarget; fadingIn = false; }
      else volume += 16;
    }
    state.master = Math.min(volume, 255);
    state.active = true;
    tick();
    mixed.fill(0);
    offset = 0;
    let any = false;
    const before = tap ? tap.before : 0;
    for (let i = 0; i < before; i++) any = musicChannel(channels[i]) || any;
    if (tap && state.speed && state.master && channels.some(ch => ch.chVolume)) mixEchoes();
    for (let i = before; i < channels.length; i++) any = musicChannel(channels[i]) || any;
    for (const ch of effects) any = effectChannel(ch) || any;
    if (any) {
      for (let i = 0; i < length; i++) {
        const v = mixed[i] - (offset << 4);
        output[i] = Math.max(-4065, Math.min(4064, v)) >> 5;
      }
    } else output.fill(0);
    frameNumber++;
  }

  return {
    /** Queues a call of the game's for the start of the next frame of sound. */
    call(name, ...args) { queue.push([name, args]); },
    /** Fills `left` and `right` with what plays next, at the console's level, each sample held until DMA's next. */
    render(left, right, gain) {
      for (let i = 0; i < left.length; i++) {
        if (cycles >= FRAME_CYCLES) {
          cycles -= FRAME_CYCLES;
          // 0x080434F8: what the last frame made starts playing, and this frame makes the next
          [output, playingNow] = [playingNow, output];
          for (const [name, args] of queue.splice(0)) {
            if (name === 'startSong') {
              startSong(args[0]);
              // a start point opens a level some frames after its song began, while it loaded
              for (let n = args[1] ?? 0; n > 0; n--) frame();
            }
            else if (name === 'playEffect') playEffect(...args);
          }
          frame();
        }
        const value = (playingNow[Math.min(Math.floor(cycles / sampleCycles), length - 1)] / 128) * gain;
        left[i] = value;
        right[i] = value;
        cycles += cyclesPerOutput;
      }
    },
  };
}
