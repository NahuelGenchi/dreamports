// Plays the original in the reference emulator (original.c): the buttons held at each frame in, and out what
// each frame shows, what it sounds like and which of the code map's functions ran in it.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { ORIGINAL, isBuilt, build } from './build.mjs';
import { STATE_BYTES } from '../lib/state.mjs';

/** The Game Boy Advance's buttons, a bit each, as its KEYINPUT register and kit/gba/input.js have them. */
export const KEY = { A: 0x1, B: 0x2, SELECT: 0x4, START: 0x8, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80, R: 0x100, L: 0x200 };

export const WIDTH = 240, HEIGHT = 160;

/** Builds the reference emulator if it isn't built yet. */
export function ensureOriginal(log) {
  if (!isBuilt()) build(log);
}

/**
 * Runs the original along with a person, from power-on: `frame(buttons)` plays one frame with those KEY bits held and
 * resolves to { picture, sound }, its picture as `runOriginal` gives one and its sound as bytes of left and right
 * samples, as `runOriginal` gives them too. `end()` stops it. The same buttons at the same frames give `runOriginal`
 * the same pictures.
 */
export function playOriginal(copy) {
  const child = spawn(ORIGINAL, [copy, 'live'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const PICTURE = WIDTH * HEIGHT * 2;
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
  return {
    frame: buttons => new Promise((resolve, reject) => {
      if (ended) return reject(ended);
      waiting = { resolve, reject };
      child.stdin.write(Buffer.from(Uint16Array.of(buttons).buffer));
    }),
    end: () => {
      child.stdin.end();
      child.kill();
    },
  };
}

/**
 * Runs `frames` frames of the original from power-on. `buttons` holds each frame's buttons as KEY bits,
 * `functions` the code map's ({ address, size }), `pictures` the frames whose whole picture is wanted, in order,
 * `sets` the values to write to the work RAM as a frame starts ({ frame, address, bytes, value }), in the order of their
 * frames, and `states` the frames whose state is wanted, in order.
 * Resolves to { hashes, plain, ran, pictures, states, sound, outside }: each frame's picture hash, its one colour when every
 * pixel has the same (15-bit) or else -1, the places in `functions` of those that ran in it, the pictures asked for
 * (15-bit colour, 240 x 160), the states asked for (bytes, as lib/state.mjs reads them), with `sound` each frame's sound
 * (an Int16Array of left and right samples, 65536 a second, in the console's 10-bit units around the bias) or else null,
 * and how many instructions ran outside every function ({ cartridge, memory }).
 */
export async function runOriginal({ copy, frames, buttons, functions = [], pictures = [], sound = false, sets = [], states = [] }) {
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const id = `${process.pid}-${Date.now()}`;
  const files = {
    buttons: join(folder, `buttons-${id}.bin`), functions: join(folder, `functions-${id}.bin`), pictures: join(folder, `pictures-${id}.bin`),
    sound: join(folder, `sound-${id}.bin`), sets: join(folder, `sets-${id}.bin`), states: join(folder, `states-${id}.bin`),
  };
  writeFileSync(files.buttons, new Uint8Array(Uint16Array.from(buttons).buffer));
  const list = new Uint32Array(functions.length * 2);
  functions.forEach((f, i) => { list[i * 2] = f.address; list[i * 2 + 1] = f.size; });
  writeFileSync(files.functions, new Uint8Array(list.buffer));
  writeFileSync(files.pictures, new Uint8Array(Uint32Array.from(pictures).buffer));
  writeFileSync(files.sets, new Uint8Array(Uint32Array.from(sets.flatMap(({ frame, address, bytes, value }) => [frame, address, bytes, value])).buffer));
  writeFileSync(files.states, new Uint8Array(Uint32Array.from(states).buffer));
  try {
    // its files by their plain names, from their folder: only the copy's path has to survive the trip whatever it's called
    const child = spawn(ORIGINAL, [copy, String(frames), basename(files.buttons), basename(files.functions), basename(files.pictures), sound ? basename(files.sound) : '-', basename(files.sets), basename(files.states)], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const stderr = Buffer.concat(err).toString('utf8').trim();
    if (code !== 0) throw new Error(`The original didn't run: ${stderr}`);
    const data = Buffer.concat(out);
    const hashes = new Uint32Array(frames), plain = new Int32Array(frames), ran = new Array(frames), shown = new Map(), held = new Map();
    const wanted = new Set(pictures), wantedStates = new Set(states);
    let at = 0;
    for (let frame = 0; frame < frames; frame++) {
      hashes[frame] = data.readUInt32LE(at);
      plain[frame] = data.readInt32LE(at + 4);
      const count = data.readUInt32LE(at + 8);
      ran[frame] = new Uint32Array(data.buffer.slice(data.byteOffset + at + 12, data.byteOffset + at + 12 + count * 4));
      at += 12 + count * 4;
      if (wanted.has(frame)) {
        shown.set(frame, new Uint16Array(data.buffer.slice(data.byteOffset + at, data.byteOffset + at + WIDTH * HEIGHT * 2)));
        at += WIDTH * HEIGHT * 2;
      }
      if (wantedStates.has(frame)) {
        held.set(frame, data.subarray(at, at + STATE_BYTES));
        at += STATE_BYTES;
      }
    }
    let heard = null;
    if (sound) {
      const bytes = readFileSync(files.sound);
      heard = new Array(frames);
      for (let frame = 0, at = 0; frame < frames; frame++) {
        const count = bytes.readUInt32LE(at);
        heard[frame] = new Int16Array(bytes.buffer.slice(bytes.byteOffset + at + 4, bytes.byteOffset + at + 4 + count * 4));
        at += 4 + count * 4;
      }
    }
    return { hashes, plain, ran, pictures: shown, states: held, sound: heard, outside: JSON.parse(stderr.split('\n').pop()) };
  } finally {
    for (const file of Object.values(files)) rmSync(file, { force: true });
  }
}
