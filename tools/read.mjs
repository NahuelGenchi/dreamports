// npm run dp -- read <game> <function> [--arm | --thumb] [--bytes <n>] [--frame <n>]: prints one of the original's
// functions, its ARM or Thumb instructions, from the contributor's own copy, for a function its decompilation has no
// C for, so it can be rewritten as readable JavaScript from how the original does it. <function> is an address, such
// as 0x08016078, a name in the game's code map, such as FUN_08016078, or a label of the release the game's labels
// come from, such as sub_8029ED8, as portmap reads them. It reads the whole function the address is in, as the code
// map has it. mGBA's own decoder reads each instruction (gba/read.c), so each line is what mGBA's debugger shows for
// it, and this adds the code map's names of the functions it calls or loads. --arm and --thumb say which
// instructions it is when the tools guess wrong, --bytes reads that many bytes from the address instead, and --frame
// reads code the game copies into the console's memory as it is that many frames after power-on. What it prints
// comes from the copy, so it goes only to the terminal, and to .dreamports/read/, which the ignore rules keep out of
// commits. A coding agent that reads it sends it to the company that runs the agent's model, as it does anything it
// reads.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { LOCAL } from './lib/paths.mjs';
import { hex, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { readCopy } from './gba/header.mjs';
import { findFunctions, looksLikeArm } from './gba/functions.mjs';
import { MGBA_VERSION, READER } from './gba/build.mjs';
import { ensureOriginal } from './gba/original.mjs';
import { readShifts } from './portmap.mjs';

const USAGE = 'Usage: npm run dp -- read <game> <address or name> [--arm | --thumb] [--bytes <n>] [--frame <n>]';
const CARTRIDGE = 0x08000000;
// the work RAMs, where games copy code to run it faster
const MEMORY = [[0x02000000, 0x02040000], [0x03000000, 0x03008000]];
// how much is read when the code map doesn't say how long the function is, and how many frames the game runs before
// code in its memory is read, unless --bytes and --frame say
const SOME_BYTES = 256, FRAMES = 60;
// a line of an instruction or of data, not the line that says the mode changes
const LINE = /^[0-9A-F]{8}:/;

export async function run(args) {
  const { rest, flags } = options(args);
  const [game, what] = rest;
  if (!game || !what || rest.length > 2) throw new Error(USAGE);
  const original = readOriginal(game);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${game}/proof/ has no code map yet: npm run dp -- codemap ${game} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`read reads ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readCopy(copy.path))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const bytes = readFileSync(copy.path);

  const { address, label, kind } = resolve(game, codeMap, what);
  const inMemory = MEMORY.some(([from, to]) => address >= from && address < to);
  if (!inMemory && (address < CARTRIDGE || address >= CARTRIDGE + bytes.length)) {
    throw new Error(`0x${hex(address)} isn't in ${original.name}'s cartridge, or in the work RAM games copy code into.`);
  }
  const mapped = codeMap.functions.find(f => address >= f.address && address < f.address + f.size);
  // the function it's in, and the one the tools find there by following the game's code, which knows whether it's
  // ARM or Thumb
  const owner = mapped?.address ?? address;
  const found = inMemory ? [] : findFunctions(bytes);
  const traced = found.find(f => owner >= f.address && owner < f.address + f.size);

  let start = address, length, extent;
  if (flags.bytes) {
    length = flags.bytes;
    extent = `${length} bytes from there, as --bytes asks`;
  } else if (mapped) {
    [start, length] = [mapped.address, mapped.size];
    extent = `the whole function, ${length} bytes, as the code map has it`;
  } else if (traced) {
    [start, length] = [traced.address, traced.size];
    extent = `${length} bytes, as far as the tools can follow its code, since the code map doesn't list it`;
  } else {
    length = SOME_BYTES;
    extent = `its first ${length} bytes, since the code map doesn't list it: --bytes <n> reads more`;
  }
  const frames = flags.frame ?? (inMemory ? FRAMES : 0);
  ensureOriginal(console.log);
  const read = (mode, from, count, functions) => {
    const result = spawnSync(READER, [copy.path, String(frames), mode, hex(from), String(count)], { input: functions, encoding: 'utf8', maxBuffer: 256 << 20 });
    if (result.error || result.status !== 0) throw new Error(`mGBA's decoder didn't run: ${result.error?.message ?? result.stderr.trim()}`);
    return result.stdout.trimEnd().split('\n');
  };

  // ARM or Thumb: as --arm or --thumb says, or as the tools found the function by following the game's code, or else
  // as its first words look
  let arm = !!flags.arm, why = `as --${arm ? 'arm' : 'thumb'} asks`;
  if (!flags.arm && !flags.thumb) {
    if (traced?.address === owner) {
      arm = !traced.thumb;
      why = 'as the tools found them by following the game\'s code';
    } else {
      const words = owner % 4 ? [] : read('arm', owner, 16).filter(line => LINE.test(line)).map(line => parseInt(line.split(/\s+/)[1], 16));
      arm = looksLikeArm(words);
      why = 'from how the first ones look';
    }
    why += `: --${arm ? 'thumb' : 'arm'} reads them as ${arm ? 'Thumb' : 'ARM'}`;
  }

  const names = new Map(codeMap.functions.filter(f => f.name).map(f => [f.address, f.name]));
  // from the whole code map, so that what another entry's code loads shows as data, unless --arm or --thumb asks for
  // these bytes as one thing or the other
  const functions = inMemory || flags.arm || flags.thumb ? '' : functionsFor(codeMap, bytes, found);
  const lines = read(arm ? 'arm' : 'thumb', start, length, functions).map(line => {
    // a branch's or a call's address, a value loaded from the pool, or a word of it
    const text = line.split('\t')[1] ?? '';
    const value = text.match(/^b\S* 0x([0-9A-F]{8})$/)?.[1] ?? text.match(/=0x([0-9A-F]{8})/)?.[1] ?? text.match(/^\.word 0x([0-9A-F]{8})$/)?.[1];
    const name = value && names.get(parseInt(value, 16) & ~1);
    return name ? `${line}  @ ${name}` : line;
  });

  const name = !mapped?.name ? `0x${hex(start)}` : mapped.address === start ? `${mapped.name}, at 0x${hex(start)}` : `0x${hex(start)}, inside ${mapped.name},`;
  const inDoubt = kind === 'label' && !codeMap.functions.some(f => f.address === address) && traced?.address !== address;
  const head = [
    ...(inDoubt ? [`Careful: ${what} isn't where a function starts in this copy, so this may be the wrong function. A label comes from another release of the game, and games/${game}/proof/names.json may not say how far this one moved it. Check it against the label's code, or name the function by its address.`] : []),
    `${name} in ${original.name}: ${extent}.`,
    ...(label ? [label] : []),
    ...(address !== start ? [`0x${hex(address)} is inside it.`] : []),
    `${arm ? 'ARM' : 'Thumb'} instructions, ${why}.`,
    ...(lines.some(line => line.startsWith('@ ')) ? ['The code changes between ARM and Thumb partway, and a line starting with @ says where.'] : []),
    ...(inMemory ? [`Read from the console's memory ${frames} frames after power-on, as the game left it then: --frame <n> reads it at another.`] : []),
    `Each line is an address, the bytes there and the instruction they make, as mGBA ${MGBA_VERSION}'s debugger shows it. tools/README.md, Reading the original's instructions, explains them.`,
  ];
  const text = [...head, '', ...lines, ''].join('\n');
  const folder = join(LOCAL, 'read', game);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${hex(start)}.txt`), text);
  console.log(text);
  console.log(`Also kept in .dreamports/read/${game}/${hex(start)}.txt. It comes from your copy of the game: never put it in a commit, an issue or a pull request. A coding agent that reads it sends it to the company that runs the agent's model.`);
  return 0;
}

function options(args) {
  const rest = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--arm' || arg === '--thumb') flags[arg.slice(2)] = true;
    else if (arg === '--bytes' || arg === '--frame') {
      const value = Number(args[++i]);
      if (!Number.isInteger(value) || value < (arg === '--bytes' ? 1 : 0)) throw new Error(`${arg} needs a whole number. ${USAGE}`);
      flags[arg.slice(2)] = value;
    } else if (arg.startsWith('--')) throw new Error(`read has no ${arg}. ${USAGE}`);
    else rest.push(arg);
  }
  if (flags.arm && flags.thumb) throw new Error('--arm or --thumb, not both.');
  return { rest, flags };
}

/** The address a function is given by: an address, a name in the code map, or a label of the release the game's
 *  labels come from, moved by the game's proof/names.json as portmap moves it. */
export function resolve(game, codeMap, what) {
  const number = what.match(/^(?:0x)?([0-9a-f]{7,8})$/i);
  if (number) return { address: parseInt(number[1], 16) & ~1 };
  const named = codeMap.functions.find(f => f.name === what) ?? codeMap.functions.find(f => f.name?.toLowerCase() === what.toLowerCase());
  if (named) return { address: named.address };
  const label = what.match(/^[A-Za-z][A-Za-z0-9]*_0?(8[0-9a-f]{6})$/i);
  if (label) {
    const address = (parseInt(label[1], 16) | CARTRIDGE) & ~1;
    const by = readShifts(game).find(s => address >= s.from && address <= s.to)?.by ?? 0;
    return { address: address - by, kind: 'label', label: by ? `${what} is 0x${hex(address - by)} in this copy, ${by} bytes before its label, as games/${game}/proof/names.json says.` : null };
  }
  throw new Error(`"${what}" isn't an address, such as 0x08016078, a name in games/${game}/proof/code-map.json, or a label, such as sub_8016078.`);
}

/** The code map's functions as the reader takes them, a line each: its address, its size and 1 if it's ARM or else 0.
 *  Those the tools find by following the game's code they know the mode of, and the rest it goes by how they look. */
export function functionsFor(codeMap, bytes, found) {
  const traced = new Map(found.map(f => [f.address, f]));
  const end = CARTRIDGE + bytes.length;
  return codeMap.functions.filter(f => f.address >= CARTRIDGE && f.address < end).map(f => {
    const words = f.address % 4 || f.address + 16 > end ? [] : [0, 4, 8, 12].map(at => bytes.readUInt32LE(f.address - CARTRIDGE + at));
    const arm = traced.has(f.address) ? !traced.get(f.address).thumb : looksLikeArm(words);
    return `${hex(f.address)} ${f.size} ${arm ? 1 : 0}\n`;
  }).join('');
}
