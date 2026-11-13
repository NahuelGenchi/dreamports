// Made-up songs for the C kit's sound test (c-kit.mjs), with nothing from any game: a cartridge with the sound engine's
// tables, four music players and songs of random notes on every kind of voice the engine plays (DirectSound samples,
// resampled and at a fixed rate, looped or not, the two squares with their sweep, the wave and the noise, a key split and
// a drum kit), with the commands that change them as they play, and the calls a game makes on them; and how to play the
// same through the JavaScript engine (kit/gba/sound/synth.js) and the C one (kit/gba/c/sound.c), a frame at a time,
// so the test can compare every sample.

import { createSynth } from '../../../kit/gba/sound/synth.js';
import { madeUpGame } from '../made-up-game.mjs';

const ROM_BASE = 0x08000000;
const PLAYERS = [{ tracks: 8 }, { tracks: 4, guarded: true }, { tracks: 2 }, { tracks: 2 }];
export const MADE_UP_MODE = { channels: 5, volume: 15, rate: 10512 };

/** The cartridge, `songs` songs of it made from `seed`, and its sound layout as tables.js gives it. */
export function madeUpSongs(random, { songs = 12 } = {}) {
  const { rom } = madeUpGame({ title: 'MADE UP SONG', size: 1 << 20 });
  let free = 0x4000;
  const put = bytes => { const at = free; rom.set(bytes, at); free = (free + bytes.length + 3) & ~3; return ROM_BASE + at; };
  const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  const pick = list => list[random.int(list.length)];
  const between = (lo, hi) => lo + random.int(hi - lo + 1);

  // the samples: a header (loop flag in the fourth byte, the rate times 1024, the loop's start, the length), then the
  // signed 8-bit samples and one past the end, as the mixer reads it
  const sample = (length, loop) => {
    const data = Array.from({ length: length + 1 }, (_, i) => (Math.round(Math.sin(i / between(2, 9)) * between(20, 120)) + random.int(9) - 4) & 0xFF);
    return put([0, 0, 0, loop ? 0x40 : 0, ...u32(between(8000, 22000) * 1024), ...u32(loop ? random.int(length >> 1) : 0), ...u32(length), ...data]);
  };
  const samples = [sample(between(200, 900), true), sample(between(300, 3000), false), sample(between(100, 600), true)];
  const wave = put(Array.from({ length: 16 }, () => random.int(256)));
  const voice = (type, key, length, panSweep, wav, attack, decay, sustain, release) => [type, key, length, panSweep, ...u32(wav), attack, decay, sustain, release];
  const adsr = () => [pick([255, 255, between(1, 254)]), between(0, 255), between(0, 255), between(0, 255)];
  const psgAdsr = () => [between(0, 7), between(0, 7), between(0, 15), between(0, 7)];
  // twelve plain voices
  const plain = [
    voice(0, 60, 0, 0, samples[0], ...adsr()),
    voice(0, 60, 0, 0, samples[1], ...adsr()),
    voice(8, 60, 0, 0, samples[2], ...adsr()),
    voice(1, 60, between(0, 63), pick([0, 0x15, 0x26, 0x7F]), between(0, 3), ...psgAdsr()),
    voice(2, 60, pick([0, between(1, 63)]), 0, between(0, 3), ...psgAdsr()),
    voice(3, 60, pick([0, between(1, 255)]), 0, wave, ...psgAdsr()),
    voice(4, 60, pick([0, between(1, 63)]), 0, between(0, 1), ...psgAdsr()),
    voice(9, 60, 0, 0, between(0, 3), ...psgAdsr()),
    voice(0x0B, 60, 0, 0, wave, ...psgAdsr()),
    voice(0, 60, 0, 0, samples[2], ...adsr()),
    voice(8, 60, 0, 0, samples[0], ...adsr()),
    voice(0, 60, 0, 0, samples[1], ...adsr()),
  ];
  const plainGroup = put(plain.flat());
  // a key split: a table of 128 keys picks a plain voice; and a drum kit of 128, each with its own key and pan
  const table = put(Array.from({ length: 128 }, () => random.int(plain.length)));
  const drums = put(Array.from({ length: 128 }, () => {
    const v = [...pick(plain)];
    v[1] = between(30, 90);
    v[3] = v[0] & 7 ? v[3] : pick([0, 0x80 | between(0x80, 0xFF) & 0x7F, 0xC0 | random.int(64)]);
    return v;
  }).flat());
  const group = put([...plain.flat(), ...voice(0x40, 60, 0, 0, plainGroup, ...u32(table)), ...voice(0x80, 60, 0, 0, drums, 0, 0, 0, 0)]);
  const VOICES = plain.length + 2;

  // a track: its voice and settings, a loop of notes, waits and changes, then a jump back or its end
  const track = first => {
    const body = [], pattern = [];
    const note = () => {
      const out = [0xCF + between(1, 48), between(24, 108)];
      if (random.chance(0.8)) { out.push(between(1, 127)); if (random.chance(0.3)) out.push(between(0, 30)); }
      return out;
    };
    const wait = () => [0x80 + between(1, 48)];
    const change = () => pick([
      () => [0xBD, random.int(VOICES)], () => [0xBE, random.int(128)], () => [0xBF, random.int(128)],
      () => [0xC0, random.int(128)], () => [0xC1, between(1, 12)], () => [0xC2, pick([0, between(1, 60)])],
      () => [0xC3, between(0, 20)], () => [0xC4, pick([0, between(1, 100)])], () => [0xC5, random.int(3)],
      () => [0xC8, random.int(128)], () => [0xBC, between(0, 24) - 12 & 0xFF], () => [0xBA, random.int(128)],
      () => [0xCD, 8, random.int(256)], () => [0xCD, 9, random.int(256)],
      () => (first ? [0xBB, between(40, 120)] : [0x80 + 1]),
    ])();
    for (let i = 0; i < 6; i++) pattern.push(...(random.chance(0.6) ? note() : change()), ...wait());
    pattern.push(0xB4);
    const sub = put(pattern);
    const tie = between(24, 108);
    for (let i = between(6, 30); i > 0; i--) {
      const r = random.next();
      if (r < 0.5) body.push(...note());
      else if (r < 0.62) body.push(...change());
      else if (r < 0.66) body.push(0xCF, tie, between(1, 127));
      else if (r < 0.7) body.push(0xCE, tie);
      else if (r < 0.74) body.push(0xB3, ...u32(sub));
      body.push(...wait());
    }
    const head = [0xBD, random.int(VOICES), 0xBE, between(40, 127), 0xBF, random.int(128), ...(first ? [0xBB, between(40, 120)] : [])];
    const at = ROM_BASE + free, loop = at + head.length;
    const end = random.chance(0.75) ? [0xB2, ...u32(loop)] : [0xB1];
    return put([...head, ...body, ...end]);
  };

  // the music players, the songs on them, and their headers
  const PLAYER_TABLE = 0x1000, SONG_TABLE = PLAYER_TABLE + PLAYERS.length * 12;
  PLAYERS.forEach((p, i) => rom.set([...u32(0x02000100 + i * 0x100), ...u32(0x02001000 + i * 0x1000), p.tracks, 0, p.guarded ? 1 : 0, 0], PLAYER_TABLE + i * 12));
  for (let n = 0; n < songs; n++) {
    const player = n < PLAYERS.length ? n : random.int(PLAYERS.length), count = between(1, PLAYERS[player].tracks);
    const tracks = Array.from({ length: count }, (_, i) => track(i === 0));
    const reverb = random.chance(0.15) ? 0x80 | between(1, 127) : 0;
    const header = put([count, 0, random.int(128), reverb, ...u32(group), ...tracks.flatMap(u32)]);
    rom.set([...u32(header), player, 0, player, 0], SONG_TABLE + n * 8);
  }
  const layout = { playerTable: PLAYER_TABLE, songTable: SONG_TABLE, players: PLAYERS.length, songs, mode: MADE_UP_MODE, voicesEndOnChip: false, soundMainAt: 0 };
  return { rom, layout };
}

// the C kit's calls by the number sound.c gives each (its OP_ enum), and the JavaScript engine's name for the same
const OPS = {
  songStart: 3, songStartOrChange: 4, songStartOrContinue: 5, songStop: 6, playerStart: 7, playerStop: 8, playerContinue: 9,
  immInit: 10, pitchControl: 11, volumeControl: 12, panpotControl: 13, fadeIn: 14, fadeOut: 15, tempoControl: 16,
  allStop: 17, allContinue: 18, vsyncOff: 19, vsyncOn: 20, psgAt: 23, chipClock: 24, dmaAt: 25, hblankDma: 26, late: 27,
};
/** Sonic Advance's way of timing its squares' writes (games/sonic-advance/c/src/main.c), for a test of the engines in it */
export const SONIC_ADVANCE_TIMING = { library: 1, psgAt: 52558, fifoAt: 54918, fifoCost: 58, hblankAt: 54727, powerOnBefore: 71058 };
const OP_SETUP = 1;

/** A random call a game makes between frames, as [name, ...args] the JavaScript engine takes. */
export function randomCall(random, layout) {
  return randomCallOf(random, layout, false);
}
/** The same, with the timing calls of a game whose squares' writes land on the original's cycles among them */
export function randomTimedCall(random, layout) { return randomCallOf(random, layout, true); }
function randomCallOf(random, layout, timed) {
  const song = () => random.int(layout.songs), player = () => random.int(layout.players);
  const calls = [
    () => ['songStart', song()], () => ['songStart', song()], () => ['songStop', song()],
    () => ['songStartOrContinue', song()], () => ['songStartOrChange', song()], () => ['playerStart', player(), song()],
    () => ['playerStop', player()], () => ['playerContinue', player()], () => ['immInit', player()],
    () => ['pitchControl', player(), 0xFFFF, random.int(0x1000) - 0x800], () => ['volumeControl', player(), 0xFFFF, random.int(257)],
    () => ['panpotControl', player(), 0xFFFF, random.int(128) - 64], () => ['fadeIn', player(), 1 + random.int(8)],
    () => ['fadeOut', player(), 1 + random.int(8)], () => ['tempoControl', 0, 0x80 + random.int(0x180)],
    () => ['allStop'], () => ['allContinue'], () => ['vsyncOff'], () => ['vsyncOn'],
    ...(timed ? [() => ['hblankDma', random.chance(0.5) ? 0 : 2 + random.int(5)], () => ['late', random.int(25000)], () => ['late', random.int(800)]] : []),
  ];
  return calls[random.int(calls.length)]();
}

/**
 * Plays the same on both engines, a frame of the console's at a time, `frames` frames, with `calls(frame)` giving the
 * calls made before each frame, and returns the first frame whose samples differ, or -1. `c` is the C kit's sound as
 * WebAssembly, with the copy in its memory. With `timing` (SONIC_ADVANCE_TIMING), both play as that game's version of
 * the library, with the squares' writes on its cycles, the chip's time kept from power-on, and the calls that move
 * SoundMain and its DMA as the game makes them.
 */
export function playBoth(rom, layout, c, frames, calls, timing = null) {
  const library = timing?.library ?? 0;
  const js = createSynth(rom, { ...layout, library }, 65536);
  const m = layout.mode;
  c.dp_sound_output(65536, 1);
  c.dp_sound_call(OP_SETUP, layout.playerTable, layout.players | m.channels << 8 | m.volume << 16 | (m.reverb ?? 0) << 24,
    m.rate | (layout.voicesEndOnChip ? 1 << 16 : 0) | library << 17, layout.soundMainAt ?? 0);
  const max = c.dp_sound_render_max();
  const first = timing ? [['psgAt', timing.psgAt], ['dmaAt', timing.fifoAt, timing.fifoCost, timing.hblankAt], ['chipClock', timing.powerOnBefore]] : [];
  for (let f = 0, played = 0; f < frames; f++) {
    for (const [name, ...args] of [...(f === 0 ? first : []), ...calls(f)]) {
      js.call(name, ...args);
      c.dp_sound_call(OPS[name], args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, 0);
    }
    const count = Math.floor((played + 1) * 1097.25) - Math.floor(played * 1097.25);
    played++;
    const left = new Float32Array(count), right = new Float32Array(count);
    js.render(left, right, 1, false);
    const at = c.dp_sound_render(count) >> 2, out = new Float32Array(c.memory.buffer);
    for (let i = 0; i < count; i++) if (out[at + i] !== left[i] || out[at + max + i] !== right[i]) return f;
  }
  return -1;
}
