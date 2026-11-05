// Runs what plays the original, for any console: the program writes each frame's picture hash, its one colour, the
// functions that ran in it and the pictures and states asked for, and its sound to a file (gba/original.c, libretro/host.c).

import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readSync, writeFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LOCAL } from './paths.mjs';

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
 * Runs `frames` frames of the original from power-on. `buttons` holds each frame's buttons as bits, `functions` the code
 * map's ({ address, size }), `pictures` the frames whose whole picture is wanted, in order, `sets` the values to write to
 * the work RAM as a frame starts ({ frame, address, bytes, value }), in the order of their frames, and `states` the
 * frames whose state is wanted, in order. `program` and `args(files)` say what to run, and `width`, `height`,
 * `stateBytes` and `buttonBytes` what it writes and reads.
 * Resolves to { hashes, plain, ran, pictures, states, sound, outside }: each frame's picture hash, its one colour when every
 * pixel has the same (15-bit) or else -1, the places in `functions` of those that ran in it, the pictures asked for
 * (15-bit colour, width x height), the states asked for (bytes), with `sound` { lengths, read(frame), close() }, each
 * frame's sound as it's needed (an Int16Array, overwritten by the next, of left and right samples, in 10-bit units
 * around the bias) or else null, and the last line the program wrote to stderr, as JSON.
 */
export async function runReference({ program, args, env, width, height, stateBytes = 0, buttonBytes = 2, frames, buttons, functions = [], pictures = [], sound = false, sets = [], states = [] }) {
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const id = `${process.pid}-${Date.now()}`;
  const files = {
    buttons: join(folder, `buttons-${id}.bin`), functions: join(folder, `functions-${id}.bin`), pictures: join(folder, `pictures-${id}.bin`),
    sound: join(folder, `sound-${id}.bin`), sets: join(folder, `sets-${id}.bin`), states: join(folder, `states-${id}.bin`),
  };
  writeFileSync(files.buttons, new Uint8Array((buttonBytes === 4 ? Uint32Array : Uint16Array).from(buttons).buffer));
  const list = new Uint32Array(functions.length * 2);
  functions.forEach((f, i) => { list[i * 2] = f.address; list[i * 2 + 1] = f.size; });
  writeFileSync(files.functions, new Uint8Array(list.buffer));
  writeFileSync(files.pictures, new Uint8Array(Uint32Array.from(pictures).buffer));
  writeFileSync(files.sets, new Uint8Array(Uint32Array.from(sets.flatMap(({ frame, address, bytes, value }) => [frame, address, bytes, value])).buffer));
  writeFileSync(files.states, new Uint8Array(Uint32Array.from(states).buffer));
  try {
    // its files by their plain names, from their folder: only the copy's path has to survive the trip whatever it's called
    const names = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, basename(file)]));
    if (!sound) names.sound = '-';
    const child = spawn(program, args(names), { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
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
    return { hashes, plain, ran, pictures: shown, states: held, sound: sound ? soundIn(files.sound, frames) : null, outside: JSON.parse(stderr.split('\n').pop()) };
  } finally {
    for (const file of Object.values(files)) rmSync(file, { force: true });
  }
}

/**
 * Runs the original along with a person, from power-on: `frame(buttons)` plays one frame with those bits held and
 * resolves to { picture, sound }, its picture as `runReference` gives one and its sound as bytes of left and right
 * samples, as `runReference` gives them too. `end()` stops it. The same buttons at the same frames give `runReference`
 * the same pictures.
 */
export function playReference({ program, args, cwd, env, width, height, buttonBytes = 2 }) {
  const child = spawn(program, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
  const PICTURE = width * height * 2;
  let data = Buffer.alloc(0), waiting = null, ended = null, stderr = '';
  const settle = () => {
    if (!waiting || data.length < PICTURE + 4) return;
    const whole = PICTURE + 4 + data.readUInt32LE(PICTURE) * 4;
    if (data.length < whole) return;
    const { resolve } = waiting;
    waiting = null;
    resolve({
      picture: new Uint16Array(data.buffer.slice(data.byteOffset, data.byteOffset + PICTURE)),
      sound: data.subarray(PICTURE + 4, whole),
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
