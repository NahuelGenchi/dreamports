// Runs what plays the original, for any console: the program writes each frame's picture hash, its one colour, the
// functions that ran in it and the pictures and states asked for, and its sound to a file (gba/original.c, libretro/host.c).

import { threadId } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LOCAL } from './paths.mjs';

// how many runs this thread has started, which with its number keeps the files of two at once apart
let runs = 0;

// each frame's sound, from the file the original wrote, read as it's needed: a long recording's holds tens of
// megabytes. Once this has opened it, nothing else needs its name, so it goes as runReference ends
function soundIn(file, frames) {
  const fd = openSync(file, 'r'), lengths = new Uint32Array(frames), at = new Float64Array(frames), word = Buffer.alloc(4);
  for (let frame = 0, position = 0; frame < frames; frame++) {
    readSync(fd, word, 0, 4, position);
    lengths[frame] = word.readUInt32LE();
    at[frame] = position + 4;
    position += 4 + lengths[frame] * 4;
  }
  let samples = new Int16Array(4096);
  return {
    lengths,
    read(frame) {
      const count = lengths[frame] * 2;
      if (samples.length < count) samples = new Int16Array(count);
      readSync(fd, samples, 0, count * 2, at[frame]);
      return samples.subarray(0, count);
    },
    close: () => closeSync(fd),
  };
}

/**
 * Runs `frames` frames of the original from power-on. `buttons` holds each frame's buttons as bits, `functions` where
 * the code map's functions run ({ address, size, index, bytes }, as watchesOf in proof-files.mjs makes them: `index`
 * its place in the code map, by default its place here, and `bytes` its first 8 bytes as two words when it only counts
 * with those there), `ramCode` whether to list the code that runs in the work RAM, `pictures` the frames whose whole picture is wanted, in order, `sets` the values to write to
 * the work RAM as a frame starts ({ frame, address, bytes, value }), in the order of their frames, and `states` the
 * frames whose state is wanted, in order, and `reads` the values to read from the work RAM as a frame ends
 * ({ frame, address, bytes }), in the order of their frames. `program` and `args(files)` say what to run, and `width`, `height`,
 * `stateBytes` and `buttonBytes` what it writes and reads.
 * Resolves to { hashes, plain, ran, pictures, states, sound, outside }: each frame's picture hash, its one colour when every
 * pixel has the same (15-bit) or else -1, the places in `functions` of those that ran in it, the pictures asked for
 * (15-bit colour, width x height), the states asked for (bytes), with `sound` { lengths, read(frame), close() }, each
 * frame's sound as it's needed (an Int16Array, overwritten by the next, of left and right samples, in 10-bit units
 * around the bias) or else null, and the last line the program wrote to stderr, as JSON, with the values `reads` asked
 * for under `reads`, in its order. With `ramCode`, also `ramCode`: { frame, address, thumb, code } for each time an
 * instruction ran at an address of the work RAM with other bytes than the last time. With `saves`, also `saves`: the
 * cartridge's save memory each time a frame left other bytes in it, as { frame, bytes }. With `played`, also `played`:
 * { records, made, content }, what ran as the program writes it for DP_PLAYED, five words a record, the functions the
 * game made in memory as { index, address, bytes }, and the cartridge's data it used, as written for DP_CONTENT, three
 * words a record. With `draws`, for a console whose emulator keeps draw lists (libretro/host.c), also
 * `draws` { hashes, counts }: for each frame, the hash of what the console gave its graphics chip and how many things.
 * With `memory`, { spec } as lib/memory.mjs makes it for a program that compares work memory (gba/original.c), also
 * `memory` { hashes, bytes }: the hash of the stretches' bytes as each frame ended, and the bytes at the frame the spec
 * names, or null. With `entries`, on a console whose program says them (libretro/ran.h), also `entries`: where the
 * processor was sent in ways only play shows, each { address, way, frame }, `way` being 'called', 'jumped' through a
 * pointer or 'returned' to. With `registers`, there too, also `registers`: what the processor held as functions of
 * `functions` started, each { index, a, x, y, s, p, frame }, a few for each function.
 */
export async function runReference({ program, args, env, width, height, stateBytes = 0, buttonBytes = 2, frames, buttons, functions = [], ramCode = false, played = false, saves = false, pictures = [], sound = false, sets = [], states = [], reads = [], draws = false, memory = null, entries = false, registers = false }) {
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const id = `${process.pid}-${threadId}-${Date.now()}-${++runs}`;
  const files = {
    buttons: join(folder, `buttons-${id}.bin`), functions: join(folder, `functions-${id}.bin`), pictures: join(folder, `pictures-${id}.bin`),
    sound: join(folder, `sound-${id}.bin`), sets: join(folder, `sets-${id}.bin`), states: join(folder, `states-${id}.bin`),
    reads: join(folder, `reads-${id}.bin`), draws: join(folder, `draws-${id}.bin`), ramCode: join(folder, `ram-code-${id}.bin`),
    played: join(folder, `played-${id}.bin`), playedCode: join(folder, `played-code-${id}.bin`), content: join(folder, `content-${id}.bin`), saves: join(folder, `saves-${id}.bin`),
    memory: join(folder, `memory-${id}.bin`), memoryOut: join(folder, `memory-${id}.bin.out`),
    entries: join(folder, `entries-${id}.bin`), registers: join(folder, `registers-${id}.bin`),
  };
  writeFileSync(files.buttons, new Uint8Array((buttonBytes === 4 ? Uint32Array : Uint16Array).from(buttons).buffer));
  const list = new Uint32Array(functions.length * 6);
  functions.forEach((f, i) => list.set([f.address, f.size, f.index ?? i, f.bytes ? 1 : 0, f.bytes?.[0] ?? 0, f.bytes?.[1] ?? 0], i * 6));
  writeFileSync(files.functions, new Uint8Array(list.buffer));
  writeFileSync(files.pictures, new Uint8Array(Uint32Array.from(pictures).buffer));
  writeFileSync(files.sets, new Uint8Array(Uint32Array.from(sets.flatMap(({ frame, address, bytes, value }) => [frame, address, bytes, value])).buffer));
  writeFileSync(files.states, new Uint8Array(Uint32Array.from(states).buffer));
  if (memory) writeFileSync(files.memory, memory.spec);
  writeFileSync(files.reads, new Uint8Array(Uint32Array.from(reads.flatMap(({ frame, address, bytes }) => [frame, address, bytes])).buffer));
  try {
    // its files by their plain names, from their folder: only the copy's path has to survive the trip whatever it's called
    const names = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, basename(file)]));
    if (!sound) names.sound = '-';
    const child = spawn(program, args(names), { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env, ...(reads.length ? { DP_READS: names.reads } : {}), ...(draws ? { DP_DRAWS: names.draws } : {}), ...(memory ? { DP_MEMORY: names.memory } : {}), ...(saves ? { DP_SAVES: names.saves } : {}), ...(played ? { DP_PLAYED: names.played, DP_PLAYED_CODE: names.playedCode, DP_CONTENT: names.content } : {}), ...(ramCode ? { DP_RAM_CODE: names.ramCode } : {}), ...(entries ? { DP_ENTRIES: names.entries } : {}), ...(registers ? { DP_REGISTERS: names.registers } : {}) } });
    // with no functions, its size is known, and it needs no second copy of itself to end up in one piece
    const size = functions.length ? 0 : frames * 12 + pictures.length * width * height * 2 + states.length * stateBytes;
    const out = [], err = [], whole = Buffer.allocUnsafeSlow(size);
    let filled = 0;
    child.stdout.on('data', chunk => {
      if (size) filled += chunk.copy(whole, filled);
      else out.push(chunk);
    });
    child.stderr.on('data', chunk => err.push(chunk));
    const { code, signal } = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    const stderr = Buffer.concat(err).toString('utf8').trim();
    if (signal) throw new Error(`The original's emulator stopped partway, with ${signal}, as one can on a copy it can't run.`);
    if (code !== 0) throw new Error(`The original didn't run: ${stderr}`);
    const data = size ? whole : Buffer.concat(out);
    out.length = 0;
    // views of what it wrote, which is all aligned, where each is the only thing that reads it
    const words = data.byteOffset % 4 ? data.buffer.slice(data.byteOffset, data.byteOffset + data.length) : data.buffer, origin = data.byteOffset % 4 ? 0 : data.byteOffset;
    const hashes = new Uint32Array(frames), plain = new Int32Array(frames), ran = new Array(frames), shown = new Map(), held = new Map();
    const wanted = new Set(pictures), wantedStates = new Set(states);
    let at = 0;
    for (let frame = 0; frame < frames; frame++) {
      hashes[frame] = data.readUInt32LE(at);
      plain[frame] = data.readInt32LE(at + 4);
      const count = data.readUInt32LE(at + 8);
      ran[frame] = new Uint32Array(words, origin + at + 12, count);
      at += 12 + count * 4;
      if (wanted.has(frame)) {
        shown.set(frame, new Uint16Array(words, origin + at, width * height));
        at += width * height * 2;
      }
      if (wantedStates.has(frame)) {
        held.set(frame, data.subarray(at, at + stateBytes));
        at += stateBytes;
      }
    }
    let drawn = null;
    if (draws) {
      const pairs = new Uint32Array(new Uint8Array(readFileSync(files.draws)).buffer);
      drawn = { hashes: pairs.filter((_, i) => i % 2 === 0), counts: pairs.filter((_, i) => i % 2 === 1) };
    }
    let codeInRam = null;
    if (ramCode) {
      const words = new Uint32Array(new Uint8Array(readFileSync(files.ramCode)).buffer);
      codeInRam = [];
      for (let i = 0; i + 3 <= words.length; i += 3) codeInRam.push({ frame: words[i], address: words[i + 1] & ~1, thumb: !!(words[i + 1] & 1), code: words[i + 2] });
    }
    // what ran, and the code of the functions the game makes in memory (gba/original.c, lib/played.mjs)
    let whatPlayed = null;
    if (played) {
      const code = new Uint32Array(new Uint8Array(readFileSync(files.playedCode)).buffer), made = [];
      for (let i = 0; i + 3 <= code.length;) {
        const [index, address, size] = code.subarray(i, i + 3), words = Math.ceil(size / 4);
        made.push({ index, address, bytes: new Uint8Array(code.buffer, (i + 3) * 4, size) });
        i += 3 + words;
      }
      whatPlayed = { records: new Uint32Array(new Uint8Array(readFileSync(files.played)).buffer), made, content: new Uint32Array(new Uint8Array(readFileSync(files.content)).buffer) };
    }
    // the save memory each time it changed: { frame, bytes }
    let saved = null;
    if (saves) {
      const all = new Uint8Array(readFileSync(files.saves)), view = new DataView(all.buffer);
      saved = [];
      for (let at = 0; at + 8 <= all.length;) {
        const frame = view.getUint32(at, true), size = view.getUint32(at + 4, true);
        saved.push({ frame, bytes: all.slice(at + 8, at + 8 + size) });
        at += 8 + Math.ceil(size / 4) * 4;
      }
    }
    // the work memory's hash as each frame ended, and its bytes at the frame asked for (lib/memory.mjs)
    let workMemory = null;
    if (memory) {
      const all = readFileSync(files.memoryOut);
      if (all.length < frames * 4) throw new Error('The program that runs the original wrote nothing of its work memory: npm run dp -- setup builds it again.');
      workMemory = { hashes: new Uint32Array(new Uint8Array(all.subarray(0, frames * 4)).buffer), bytes: all.length > frames * 4 ? all.subarray(frames * 4) : null };
    }
    // where play sent the processor, and what it held as functions started (libretro/ran.h)
    const wordsOf = file => new Uint32Array(new Uint8Array(readFileSync(file)).buffer);
    const sent = !entries ? null : Array.from({ length: Math.floor(wordsOf(files.entries).length / 3) }, (_, i) => {
      const [address, way, frame] = wordsOf(files.entries).subarray(i * 3, i * 3 + 3);
      return { address, way: [null, 'called', 'jumped', 'returned'][way], frame };
    });
    const heldAt = !registers ? null : Array.from({ length: Math.floor(wordsOf(files.registers).length / 3) }, (_, i) => {
      const [index, axys, rest] = wordsOf(files.registers).subarray(i * 3, i * 3 + 3);
      return { index, a: axys & 0xFF, x: axys >> 8 & 0xFF, y: axys >> 16 & 0xFF, s: axys >>> 24, p: rest & 0xFF, frame: rest >>> 8 };
    });
    return { ...(sent ? { entries: sent } : {}), ...(heldAt ? { registers: heldAt } : {}), ...(workMemory ? { memory: workMemory } : {}), ...(saved ? { saves: saved } : {}), ...(whatPlayed ? { played: whatPlayed } : {}), hashes, plain, ran, pictures: shown, states: held, sound: sound ? soundIn(files.sound, frames) : null, draws: drawn, ...(codeInRam ? { ramCode: codeInRam } : {}), outside: JSON.parse(stderr.split('\n').pop()) };
  } finally {
    for (const file of Object.values(files)) rmSync(file, { force: true });
  }
}

/**
 * Runs the original along with a person, from power-on: `frame(buttons)` plays one frame with those bits held and
 * resolves to { picture, sound }, its picture as `runReference` gives one and its sound as bytes of left and right
 * samples, as `runReference` gives them too, and with `sized`, for a program that writes each picture's own width and
 * height after it, `size`. `end()` stops it. The same buttons at the same frames give `runReference` the same pictures.
 */
export function playReference({ program, args, cwd, env, width, height, buttonBytes = 2, sized = false }) {
  const child = spawn(program, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const PICTURE = width * height * 2, COUNT = PICTURE + (sized ? 8 : 0);
  let data = Buffer.alloc(0), waiting = null, ended = null, stderr = '';
  const settle = () => {
    if (!waiting || data.length < COUNT + 4) return;
    const whole = COUNT + 4 + data.readUInt32LE(COUNT) * 4;
    if (data.length < whole) return;
    const { resolve } = waiting;
    waiting = null;
    resolve({
      picture: new Uint16Array(data.buffer.slice(data.byteOffset, data.byteOffset + PICTURE)),
      sound: data.subarray(COUNT + 4, whole),
      ...(sized ? { size: [data.readUInt32LE(PICTURE), data.readUInt32LE(PICTURE + 4)] } : {}),
    });
    data = data.subarray(whole);
  };
  child.stdout.on('data', chunk => {
    data = Buffer.concat([data, chunk]);
    settle();
  });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});   // it has gone, which the next line says
  child.once('close', () => {
    ended = new Error(`The original stopped running. ${stderr.trim()}`.trim());
    waiting?.reject(ended);
    waiting = null;
  });
  child.once('error', error => { ended = error; waiting?.reject(error); waiting = null; });
  const pack = buttonBytes === 4 ? Uint32Array : Uint16Array;
  return {
    frame: buttons => new Promise((resolve, reject) => {
      if (ended) return reject(ended);
      waiting = { resolve, reject };
      child.stdin.write(Buffer.from(pack.of(buttons).buffer));
    }),
    end: () => {
      child.stdin.end();
      child.kill();
    },
  };
}
