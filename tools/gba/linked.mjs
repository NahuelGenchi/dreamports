// Runs two to four copies of the original linked by cable, from power-on, in the reference emulator (linked.c), each
// with its own player's buttons, and gives back what each one's screen showed at every frame.

import { threadId } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { LOCAL } from '../lib/paths.mjs';
import { LINKED } from './build.mjs';

const WIDTH = 240, HEIGHT = 160;

// how many runs this thread has started, which with its number keeps the files of two at once apart
let runs = 0;

/**
 * Runs `players` GBAs for `frames` frames. `buttons[player][frame]` is a player's buttons as bits (KEY), `pictures` the
 * frames whose pictures (of every player) are wanted and `states` those whose console state is wanted. Resolves to
 * { hashes, plain, pictures, states }: `hashes[frame * players + player]` is the picture's hash (as original.c
 * hashes), `plain` its one colour or -1, `pictures` a map from `frame:player` to 15-bit pixels (WIDTH x HEIGHT) and `states`
 * the same to the player's state, as original.c writes it.
 */
export async function runLinked({ copy, players, frames, buttons, pictures = [], states = [], stateBytes = 0x58 + 0x400 + 0x400 + 0x18000 }) {
  const folder = join(LOCAL, 'tmp');
  mkdirSync(folder, { recursive: true });
  const id = `linked-${process.pid}-${threadId}-${Date.now()}-${++runs}`;
  const files = { buttons: join(folder, `buttons-${id}.bin`), pictures: join(folder, `pictures-${id}.bin`), states: join(folder, `states-${id}.bin`) };
  const all = new Uint16Array(frames * players);
  for (let f = 0; f < frames; f++) for (let p = 0; p < players; p++) all[f * players + p] = buttons[p][f] ?? 0;
  writeFileSync(files.buttons, new Uint8Array(all.buffer));
  writeFileSync(files.pictures, new Uint8Array(Uint32Array.from(pictures).buffer));
  writeFileSync(files.states, new Uint8Array(Uint32Array.from(states).buffer));
  try {
    const child = spawn(LINKED, [copy, String(players), String(frames), basename(files.buttons), basename(files.pictures), basename(files.states)], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    const { code, signal } = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
    const stderr = Buffer.concat(err).toString('utf8').trim();
    if (signal) throw new Error(`The linked copies of the original stopped partway, with ${signal}.`);
    if (code !== 0) throw new Error(`The linked copies of the original didn't run: ${stderr}`);
    const data = Buffer.concat(out);
    const hashes = new Uint32Array(frames * players), plain = new Int32Array(frames * players), shown = new Map(), held = new Map();
    const wanted = new Set(pictures), wantedStates = new Set(states);
    let at = 0;
    for (let frame = 0; frame < frames; frame++) {
      // for each GBA in turn: its hash and its one colour, then its picture and its state if they are wanted
      for (let p = 0; p < players; p++) {
        hashes[frame * players + p] = data.readUInt32LE(at);
        plain[frame * players + p] = data.readInt32LE(at + 4);
        at += 8;
        if (wanted.has(frame)) {
          shown.set(`${frame}:${p}`, new Uint16Array(data.buffer.slice(data.byteOffset + at, data.byteOffset + at + WIDTH * HEIGHT * 2)));
          at += WIDTH * HEIGHT * 2;
        }
        if (wantedStates.has(frame)) {
          held.set(`${frame}:${p}`, data.subarray(at, at + stateBytes));
          at += stateBytes;
        }
      }
    }
    return { hashes, plain, pictures: shown, states: held, message: stderr };
  } finally {
    for (const file of Object.values(files)) rmSync(file, { force: true });
  }
}
