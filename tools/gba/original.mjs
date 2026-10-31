// Plays the original in the reference emulator (original.c): the buttons held at each frame in, and out what
// each frame shows and which of the code map's functions ran in it.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { ORIGINAL, isBuilt, build } from './build.mjs';

/** The Game Boy Advance's buttons, a bit each, as its KEYINPUT register and kit/gba/input.js have them. */
export const KEY = { A: 0x1, B: 0x2, SELECT: 0x4, START: 0x8, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80, R: 0x100, L: 0x200 };

export const WIDTH = 240, HEIGHT = 160;

/** Builds the reference emulator if it isn't built yet. */
export function ensureOriginal(log) {
  if (!isBuilt()) build(log);
}

/**
 * Runs `frames` frames of the original from power-on. `buttons` holds each frame's buttons as KEY bits,
 * `functions` the code map's ({ address, size }), and `pictures` the frames whose whole picture is wanted, in order.
 * Resolves to { hashes, plain, ran, pictures, outside }: each frame's picture hash, its one colour when every pixel
 * has the same (15-bit) or else -1, the places in `functions` of those that ran in it, the pictures asked for
 * (15-bit colour, 240 x 160) and how many instructions ran outside every function ({ cartridge, memory }).
 */
export async function runOriginal({ copy, frames, buttons, functions = [], pictures = [] }) {
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const id = `${process.pid}-${Date.now()}`;
  const files = { buttons: join(folder, `buttons-${id}.bin`), functions: join(folder, `functions-${id}.bin`), pictures: join(folder, `pictures-${id}.bin`) };
  writeFileSync(files.buttons, new Uint8Array(Uint16Array.from(buttons).buffer));
  const list = new Uint32Array(functions.length * 2);
  functions.forEach((f, i) => { list[i * 2] = f.address; list[i * 2 + 1] = f.size; });
  writeFileSync(files.functions, new Uint8Array(list.buffer));
  writeFileSync(files.pictures, new Uint8Array(Uint32Array.from(pictures).buffer));
  try {
    const child = spawn(ORIGINAL, [copy, String(frames), files.buttons, files.functions, files.pictures], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    const stderr = Buffer.concat(err).toString('utf8').trim();
    if (code !== 0) throw new Error(`The original didn't run: ${stderr}`);
    const data = Buffer.concat(out);
    const hashes = new Uint32Array(frames), plain = new Int32Array(frames), ran = new Array(frames), shown = new Map();
    const wanted = new Set(pictures);
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
    }
    return { hashes, plain, ran, pictures: shown, outside: JSON.parse(stderr.split('\n').pop()) };
  } finally {
    for (const file of Object.values(files)) rmSync(file, { force: true });
  }
}
