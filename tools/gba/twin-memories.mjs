// The memories of play the function check can start its calls from (twin.mjs, --memories). Every call otherwise starts
// from the memory the original has a few hundred frames after power-on, so a function that reads what only play sets
// up, a thing made when a level starts or the task that is running, finds nothing there and can't be checked.
//
// A memory is taken at the moment a function starts in play, and not at some frame it ran in: the program that calls
// the original (call.c) plays a recording as the proof tools play it and, when the processor reaches a function the
// version has a twin of, keeps the console's memory as it was just then, with what the registers and the stack held.
// So a call that starts from one is given what the game really gave the function: the memory, the arguments, and the
// stack, which a function given a pointer to something of its caller's needs. A memory taken at the end of a frame
// the function ran in would hold what the frame left, after the function and everything that ran after it, with
// nothing to say what it was called with.
//
// A function that runs every frame starts millions of times, so the program answers its 1st, 3rd, 9th start and so
// on, by threes, in each recording, and of all those every function keeps a few, EACH of them, chosen by a number made
// from the recording's name and the start's count: the same recordings give the same memories whatever order they
// were played in, which lets them be played several at once, and no two kept for a function are the same bytes.
//
// They are the game's own memory, from the contributor's copy: they're kept only in .dreamports/twin/<version>/, on
// this computer, packed, with a list of what each is, and never in a file the repository tracks.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { IMAGE, inImage } from './twin-memory.mjs';

// how many memories a function keeps, and how the files are laid out: another number here takes them again
export const EACH = 4;
const LAYOUT = 2;
// how many unpacked memories are held at once, 395 KB each
const HELD = 24;

const fnv = text => {
  let hash = 0x811C9DC5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
};

/** What a set of memories is taken from, as one word: the copy, the functions and each recording as it's played. */
export function memoriesKey({ sha1, addresses, plays }) {
  const hash = createHash('sha1').update(JSON.stringify([LAYOUT, EACH, sha1, addresses]));
  for (const { name, buttons, sets } of plays) hash.update(JSON.stringify([name, buttons.length, sets])).update(Buffer.from(Uint16Array.from(buttons).buffer));
  return hash.digest('hex');
}

/**
 * Plays each of `plays`, { name, buttons, sets }, in the original from power-on, the buttons as bits a frame and the
 * sets as recording.mjs's originalPlay gives them, and keeps the memories of the functions at `addresses` in `folder`.
 *   open(): starts the program that calls the original, as twin.mjs's Original
 *   key: what they're taken from (memoriesKey), kept with them so they're taken again only when that changes
 * Answers { memories, functions, bytes }: how many were kept, of how many functions, and how much room they take.
 */
export async function takeMemories({ open, addresses, plays, folder, key, log = () => {} }) {
  // each function's few, by its place in `addresses`: { order, digest, packed, ...what it is }
  const kept = addresses.map(() => []);
  const offer = (which, memory) => {
    const list = kept[which], same = list.find(other => other.digest === memory.digest);
    if (same) {
      if (memory.order < same.order) Object.assign(same, memory);
    } else if (list.length < EACH) list.push(memory);
    else {
      const last = list.reduce((worst, other) => (other.order > worst.order ? other : worst));
      if (memory.order < last.order) Object.assign(last, memory);
    }
  };
  const playOne = async play => {
    const original = open();
    try {
      await original.watch(addresses);
      let taken = 0;
      await original.playFor(play, ({ which, frame, time, registers, stack, image }) => {
        taken++;
        // the smaller this is, the sooner it's kept: a number from what the memory is, and nothing else
        const order = fnv(`${play.name} ${time} ${addresses[which]}`) * 0x10000 + (time & 0xFFFF);
        const list = kept[which];
        if (list.length === EACH && list.every(other => other.order < order)) return;
        const digest = createHash('sha1').update(image).update(Buffer.from(Uint32Array.from([...registers, stack]).buffer)).digest('hex');
        offer(which, { order, digest, packed: deflateRawSync(image, { level: 1 }), recording: play.name, frame, time, registers, stack });
      });
      log(`  ${play.name}: ${play.buttons.length.toLocaleString('en-US')} frames, ${taken.toLocaleString('en-US')} starts looked at`);
    } finally {
      original.close();
    }
  };
  // several at once: a recording's memories don't depend on the others'
  const waiting = [...plays];
  const worker = async () => { while (waiting.length) await playOne(waiting.shift()); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(8, availableParallelism() - 1, plays.length)) }, worker));

  mkdirSync(folder, { recursive: true });
  const parts = [], list = [];
  let at = 0;
  kept.forEach((memories, which) => {
    for (const memory of memories.sort((a, b) => a.order - b.order)) {
      list.push([addresses[which], memory.recording, memory.frame, memory.time, ...memory.registers, memory.stack, at, memory.packed.length]);
      parts.push(memory.packed);
      at += memory.packed.length;
    }
  });
  // the list last, and only once the bytes are whole: a run that was stopped leaves nothing that reads as kept
  rmSync(join(folder, 'memories.json'), { force: true });
  writeFileSync(join(folder, 'memories.bin.part'), Buffer.concat(parts));
  renameSync(join(folder, 'memories.bin.part'), join(folder, 'memories.bin'));
  writeFileSync(join(folder, 'memories.json'), `${JSON.stringify({ key, recordings: plays.map(play => play.name), memories: list })}\n`);
  return { memories: list.length, functions: kept.filter(memories => memories.length).length, bytes: at };
}

/** Whether `folder` holds the memories taken from `key`. */
export function hasMemories(folder, key) {
  try {
    return JSON.parse(readFileSync(join(folder, 'memories.json'), 'utf8')).key === key && existsSync(join(folder, 'memories.bin'));
  } catch {
    return false;
  }
}

/**
 * The memories kept in `folder`, for the check to start calls from. Answers { count, functions, of(address), any(choose) }:
 * `of` gives the memories taken as the function at that address started, and `any` one of them all, chosen by
 * `choose.below`. A memory is { recording, frame, top, own, image(), arg(i), register(i) }: where it's from, the stack
 * the function started on, whether it's the function's own (from `of`), the console's memory as an image, the
 * function's i-th argument as play gave it, from the registers and then the stack, and what register ri held, r0 to r7,
 * for a routine written by hand that takes its values in them (#1728).
 */
export function openMemories(folder) {
  const { memories } = JSON.parse(readFileSync(join(folder, 'memories.json'), 'utf8'));
  const file = join(folder, 'memories.bin'), held = new Map(), by = new Map();
  const image = (at, length) => {
    const key = at;
    if (held.has(key)) return held.get(key);
    const packed = Buffer.alloc(length), fd = openSync(file, 'r');
    try {
      readSync(fd, packed, 0, length, at);
    } finally {
      closeSync(fd);
    }
    const whole = inflateRawSync(packed);
    if (whole.length !== IMAGE) throw new Error(`${file} isn't the memories its list says: npm run dp -- twin with --memories takes them again once it's deleted.`);
    if (held.size >= HELD) held.delete(held.keys().next().value);
    held.set(key, whole);
    return whole;
  };
  const all = memories.map(([address, recording, frame, time, r0, r1, r2, r3, r4, r5, r6, r7, stack, at, length]) => {
    const memory = {
      address, recording, frame, time, top: stack & ~3, own: false,
      image: () => image(at, length),
      // r0 to r7 as the function started, for a hand-written routine that takes them (#1728)
      register: i => [r0, r1, r2, r3, r4, r5, r6, r7][i] ?? 0,
      arg(i) {
        if (i < 4) return [r0, r1, r2, r3][i];
        const where = inImage(stack + 4 * (i - 4));
        return where < 0 || where + 4 > IMAGE ? 0 : image(at, length).readUInt32LE(where);
      },
    };
    if (!by.has(address)) by.set(address, []);
    by.get(address).push({ ...memory, own: true });
    return memory;
  });
  return {
    count: all.length, functions: by.size,
    of: address => by.get(address) ?? [],
    any: choose => (all.length ? all[choose.below(all.length)] : null),
  };
}
