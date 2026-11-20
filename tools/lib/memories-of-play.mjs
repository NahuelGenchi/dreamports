// The memories of play a function check can start its calls from, on a console whose emulator tells of each function's
// start in play (../libretro/starts.h): the PlayStation's (../ps1/twin.mjs) and the PlayStation 2's (../ps2/twin.mjs).
// Every call otherwise starts from the program as the console loads it, so a function that reads what only play sets
// up, a thing made when a level starts or the mode the game is in, finds nothing there, and the paths that need it are
// never taken.
//
// A memory is taken at the moment a function starts in play, and not at some frame it ran in, as on the Game Boy
// Advance (../gba/twin-memories.mjs): whatever plays the original tells of each function's 1st, 3rd, 9th start and so on,
// by threes, with the processor's registers as they were and the pages of the console's memory written since the start
// before, the first with every page that holds anything. So a call that starts from one is given what the game really
// gave the function: the memory, the arguments, the stack and where to come back to.
//
// Of all those every function keeps a few, EACH of them, chosen by a number made from the play's name and the start's
// count, so the same plays give the same memories whatever order they were played in, and no two kept for a function
// are the same bytes. They are the game's own memory, from the contributor's copy: they're kept only in
// .dreamports/twin/<version>/<console>/, on this computer, packed, with a list of what each is, and never in a file the
// repository tracks. A memory is kept as its registers and the pages that aren't zeros, so one of a game that fills a
// few megabytes takes about that much before it's packed.

import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { LOCAL, REPO } from './paths.mjs';
import { readRecordings } from './proof-files.mjs';
import { originalPlay } from './recording.mjs';
import { consoleOf } from '../consoles.mjs';
import { libretroReference } from '../libretro/reference.mjs';
import { versionOf } from '../../src/lib/languages.mjs';

/** How many memories a function keeps. */
export const EACH = 4;
// how the files are laid out: another number here takes them again
const LAYOUT = 1;
// an address as the emulator tells of it, without its top three bits (../libretro/starts.h)
const KEY = 0x1FFFFFFF;
const count = n => n.toLocaleString('en-US');

const fnv = text => {
  let hash = 0x811C9DC5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash;
};

/**
 * The memories of a console whose function check has `wordCount` registers' words and an image of `imageSize` bytes,
 * kept by pages of `pageSize` bytes: { memoriesKey, takeMemories, startsIn, hasMemories, openMemories }.
 */
export function memoriesOf({ words: wordCount, image: imageSize, page: pageSize = 4096 }) {
  /** What a set of memories is taken from, as one word: the copy, the functions and each play, by what it says of itself. */
  function memoriesKey({ sha1, addresses, plays }) {
    return createHash('sha1').update(JSON.stringify([LAYOUT, EACH, sha1, addresses, plays])).digest('hex');
  }

  // a memory as its file has it: the registers' words, then each page that isn't zeros, its number and its bytes
  function pack({ registers, pages }) {
    const held = [...pages].filter(([, bytes]) => bytes.some(Boolean)).sort(([a], [b]) => a - b);
    const bytes = Buffer.alloc(wordCount * 4 + 4 + held.length * (4 + pageSize));
    registers.forEach((word, n) => bytes.writeUInt32LE(word >>> 0, n * 4));
    bytes.writeUInt32LE(held.length, wordCount * 4);
    held.forEach(([page, content], n) => {
      const at = wordCount * 4 + 4 + n * (4 + pageSize);
      bytes.writeUInt32LE(page, at);
      bytes.set(content, at + 4);
    });
    return deflateRawSync(bytes, { level: 1 });
  }

  function unpack(packed) {
    const bytes = inflateRawSync(packed), image = new Uint8Array(imageSize);
    const registers = Array.from({ length: wordCount }, (_, n) => bytes.readUInt32LE(n * 4));
    for (let n = 0, count = bytes.readUInt32LE(wordCount * 4); n < count; n++) {
      const at = wordCount * 4 + 4 + n * (4 + pageSize);
      image.set(bytes.subarray(at + 4, at + 4 + pageSize), bytes.readUInt32LE(at) * pageSize);
    }
    return { registers, image };
  }

  /**
   * Takes the memories of the functions at `addresses` from `plays`, each { name, starts }: `starts` the starts a play of
   * the original told of, in order, as a call's `starts` are (original.mjs), or a function that gives them, and keeps
   * them in `folder`, with `key`, what they're taken from (memoriesKey), so they're taken again only when that changes.
   * Answers { memories, functions, bytes }: how many were kept, of how many functions, and how much room they take.
   */
  async function takeMemories({ plays, addresses, folder, key }) {
    // each address as the emulator tells of it, to the function's own
    const wanted = new Map(addresses.map(address => [(address & KEY) >>> 0, address])), kept = new Map();
    for (const play of plays) {
      // the memory as the play has it so far: each page that was ever written, as it was last
      const pages = new Map();
      for (const start of typeof play.starts === 'function' ? await play.starts() : play.starts) {
        for (const { page, bytes } of start.pages) pages.set(page, bytes);
        const address = wanted.get(start.address);
        if (address === undefined) continue;
        const order = fnv(`${play.name}:${start.number}`);
        const list = kept.get(address) ?? kept.set(address, []).get(address);
        if (list.length === EACH && order >= list.at(-1).order) continue;
        const packed = pack({ registers: start.registers, pages }), digest = createHash('sha1').update(packed).digest('hex');
        // the same bytes twice say nothing more: the earlier one, by its number, stays
        const same = list.find(other => other.digest === digest);
        if (same) {
          if (order < same.order) Object.assign(same, { order, play: play.name, number: start.number });
        } else list.push({ order, digest, packed, play: play.name, number: start.number, steps: start.steps });
        list.sort((a, b) => a.order - b.order);
        list.length = Math.min(list.length, EACH);
      }
    }
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const listed = [];
    let bytes = 0;
    for (const [address, list] of [...kept].sort(([a], [b]) => a - b)) {
      list.forEach((memory, n) => {
        const file = `${address.toString(16).toUpperCase().padStart(8, '0')}-${n}.bin`;
        writeFileSync(join(folder, file), memory.packed);
        bytes += memory.packed.length;
        listed.push({ address, file, play: memory.play, number: memory.number });
      });
    }
    // the list last, and whole, so a set half written is never taken for one
    writeFileSync(join(folder, 'memories.json.part'), `${JSON.stringify({ key, memories: listed }, null, 1)}\n`);
    renameSync(join(folder, 'memories.json.part'), join(folder, 'memories.json'));
    return { memories: listed.length, functions: kept.size, bytes };
  }

  /**
   * The starts a play of the original in its emulator told of, read from the file the program that runs it wrote for
   * DP_STARTS (../libretro/starts.h), one at a time, as takeMemories takes them: { address, number, steps, registers,
   * pages }, `steps` the frame it was in.
   */
  function* startsIn(file) {
    const descriptor = openSync(file, 'r');
    try {
      const head = Buffer.alloc((3 + wordCount + 1) * 4), page = Buffer.alloc(4 + pageSize);
      for (let at = 0; readSync(descriptor, head, 0, head.length, at) === head.length;) {
        at += head.length;
        const pages = [];
        for (let n = head.readUInt32LE((3 + wordCount) * 4); n; n--, at += page.length) {
          if (readSync(descriptor, page, 0, page.length, at) !== page.length) throw new Error(`${file} ends in the middle of a start: the emulator stopped as it wrote it.`);
          pages.push({ page: page.readUInt32LE(0), bytes: Uint8Array.from(page.subarray(4)) });
        }
        yield { address: head.readUInt32LE(0), number: head.readUInt32LE(4), steps: head.readUInt32LE(8), registers: Array.from({ length: wordCount }, (_, n) => head.readUInt32LE(12 + n * 4)), pages };
      }
    } finally {
      closeSync(descriptor);
    }
  }

  const listOf = folder => (existsSync(join(folder, 'memories.json')) ? JSON.parse(readFileSync(join(folder, 'memories.json'), 'utf8')) : null);

  /** Whether the memories kept in `folder` were taken from `key`. */
  const hasMemories = (folder, key) => listOf(folder)?.key === key;

  /**
   * The memories kept in `folder`: `count`, how many, `functions`, of how many functions, and `of(address)`, a
   * function's own, each { play, number, registers, image }, `registers` the EE's as they were when it started and
   * `image` the whole image then (original.mjs), read from its file when asked for.
   */
  function openMemories(folder) {
    const listed = listOf(folder)?.memories ?? [], by = new Map();
    for (const memory of listed) (by.get(memory.address) ?? by.set(memory.address, []).get(memory.address)).push(memory);
    return {
      count: listed.length, functions: by.size,
      of: address => (by.get(address) ?? []).map(memory => ({
        play: memory.play, number: memory.number,
        get registers() { return (memory.held ??= unpack(readFileSync(join(folder, memory.file)))).registers; },
        get image() { return (memory.held ??= unpack(readFileSync(join(folder, memory.file)))).image; },
        // let go of once its calls are made, as each is the whole image
        drop() { memory.held = null; },
      })),
    };
  }

  return { memoriesKey, takeMemories, startsIn, hasMemories, openMemories };
}

/**
 * Takes the memories of play for a version's twins, unless the ones kept are from the same copy, functions and
 * recordings: plays the game's recordings, or those of `names`, in the console's emulator, which tells of each time the
 * processor reaches one of `addresses`, with its registers and the memory then (../libretro/starts.h), and keeps a few
 * for each function, with `memories`, as memoriesOf gives them. Answers them, as openMemories does.
 */
export async function memoriesOfPlay({ console: name, memories, game, original, copy, addresses, names = [], folder = join(LOCAL, 'twin', game, name), log = console.log }) {
  const reference = libretroReference(consoleOf(name)), keysLate = original.keysAfterVBlank === true;
  // one console plays them: a recording of several on a link isn't one's play
  const alone = readRecordings(game, names).filter(recording => !recording.players);
  if (!alone.length) throw new Error(`games/${versionOf(game).game}/proof/recordings/ has no recording one console plays${names.length ? ' among those named' : ''}, so there's no play to take memories from.`);
  const plays = alone.map(recording => {
    const way = originalPlay(recording, { keysLate });
    const buttons = way.originalHeld.map(list => list.reduce((mask, button) => mask | (reference.KEY[button] ?? 0), 0));
    if (keysLate) buttons.unshift(0);
    return { name: recording.name, buttons, sets: way.sets.map(({ frame, address, bytes, value }) => ({ frame, address, bytes, value })) };
  });
  const key = memories.memoriesKey({ sha1: original.sha1, addresses, plays: plays.map(({ name: played, buttons, sets }) => [played, createHash('sha1').update(Buffer.from(Uint32Array.from(buttons).buffer)).digest('hex'), sets]) });
  const where = relative(REPO, folder).split(sep).join('/');
  if (memories.hasMemories(folder, key)) log(`The memories of play in ${where}/ are from these recordings and this copy already.`);
  else {
    reference.ensureOriginal(log);
    const frames = plays.reduce((sum, play) => sum + play.buttons.length, 0);
    log(`Playing ${plays.length === 1 ? plays[0].name : `${count(plays.length)} recordings`} in the original, ${count(frames)} frames, for the memory each function starts from…`);
    const began = Date.now(), work = join(LOCAL, 'tmp', `${name}-starts-${process.pid}`);
    mkdirSync(work, { recursive: true });
    try {
      const taken = await memories.takeMemories({
        addresses, folder, key,
        plays: plays.map((play, n) => ({
          name: play.name,
          // played when its starts are wanted, and its file read a start at a time, as one can hold the console's memory many times over
          starts: async () => {
            const watched = join(work, `starts-${n}.bin`);
            writeFileSync(watched, new Uint8Array(Uint32Array.from(addresses).buffer));
            await reference.runOriginal({ copy, frames: play.buttons.length, buttons: play.buttons, sets: play.sets, env: { DP_STARTS: watched } });
            return memories.startsIn(`${watched}.out`);
          },
        })),
      });
      log(`${count(taken.memories)} memories of ${count(taken.functions)} of the ${count(addresses.length)} functions kept in ${where}/, ${(taken.bytes / 1048576).toFixed(1)} MB, in ${count(Math.round((Date.now() - began) / 1000))} seconds. They come from your copy of the game: never put them in a commit, an issue or a pull request.`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  return memories.openMemories(folder);
}
