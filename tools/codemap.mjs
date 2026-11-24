// npm run dp -- codemap <game> [--from <list> | --fill]: makes games/<game>/proof/code-map.json, every function in the
// original with its address and its size, and nothing of its code. It's what code ported is measured against.
// Without --from, it finds the functions in the contributor's copy itself, in a Game Boy Advance game
// (gba/functions.mjs), an NES game (nes/functions.mjs), a Super Nintendo game (snes/functions.mjs), with the mode each
// function starts in, a PlayStation game (ps1/functions.mjs), a Nintendo 64 game (n64/functions.mjs), where it maps the
// code its cartridge starts, or a PlayStation 2 game (ps2/functions.mjs), where it maps every program on the disc: the
// one it boots, its other programs, its modules for the second processor and the vector units' programs. With --from,
// it takes them from a list: a decompilation's
// symbols, as `nm -S` prints them from its ELF file, or a CSV with an address on each line and its size or its end, as
// a disassembler such as Ghidra exports its list of functions. A list can stop short, so what the tools find in the
// copy beyond it is added, and it can name data as a function, so those are left out. With --fill, the same is done to
// the code map there already is, keeping its names.
// A game can also run code from its work RAM: code it copies there from the cartridge, or code it makes there, such as
// a program it unpacks. In a Game Boy Advance game, --fill also plays each of the game's recordings in the original,
// lists the code that ran in the work RAM, reads it back, and finds its functions (gba/functions.mjs). A stretch of
// them that's a copy of the cartridge's code goes in the map's copies, where it runs, and its functions are the
// cartridge's, split where the copy shows one starts; the rest are functions of their own, each known by its address
// and its first 8 bytes (lib/proof-files.mjs). Where the game has the BIOS unpack them from the cartridge, as a program
// it unpacks and runs, the map's copies say so too, for what reads their code (lib/points-to.mjs): a function whose
// bytes are what an unpack put there, or are found in what one made, as code copied on from there is. One whose bytes
// it can't find in the cartridge either way is listed by its address. --memory does only that, and leaves the rest of
// the map as it is.
// In an NES game, --fill plays the recordings in the original too, and adds the functions play sends the processor to
// that following the code didn't find, as a jump through a table the tools couldn't read leads to (libretro/ran.h).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { hex, readCodeMap, readOriginal, writeCodeMap } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { readAnyCopy } from './lib/read-copy.mjs';
import { readRecordings, bytesText } from './lib/proof-files.mjs';
import { originalPlay } from './lib/recording.mjs';
import { referenceOf } from './lib/reference.mjs';
import { atOnce } from './lib/at-once.mjs';
import * as gbaFunctions from './gba/functions.mjs';
import { UNPACKED_BY, unpack } from './gba/unpack.mjs';
import * as nesFunctions from './nes/functions.mjs';
import * as ps1Functions from './ps1/functions.mjs';
import * as n64Functions from './n64/functions.mjs';
import * as ps2Functions from './ps2/functions.mjs';
import * as pspFunctions from './psp/functions.mjs';
import * as snesFunctions from './snes/functions.mjs';

// where code runs on the Game Boy Advance: the cartridge and the two work RAMs
const CODE = [[0x08000000, 0x0A000000], [0x03000000, 0x03008000], [0x02000000, 0x02040000]];
const isCode = address => CODE.some(([from, to]) => address >= from && address < to);

// the consoles whose functions the tools find themselves: how, and what a list's address is on each. A Game Boy
// Advance address has its lowest bit set for Thumb code, which a function's start doesn't; an NES one is the offset in
// the program, or a name the game's code would use (nes/functions.mjs), and a 6502 function can start anywhere.
const FINDERS = {
  gba: {
    ...gbaFunctions,
    file: 'tools/gba/functions.mjs',
    inCode: () => isCode,
    address: address => address & ~1,
    memory: true,
  },
  nes: {
    ...nesFunctions,
    file: 'tools/nes/functions.mjs',
    inCode: copy => offset => offset >= 0 && offset < nesFunctions.nesProgram(copy).prg.length,
    address: address => address,
    play: true,
    name: (value, copy) => nesFunctions.nesNames(value, nesFunctions.nesProgram(copy).banks)[0]?.[1],
  },
  // a Super Nintendo game's cartridge, its addresses the offsets in its ROM, followed from its vectors with the
  // processor's mode carried along, and from where play sent it in the mode it ran in (snes/functions.mjs)
  snes: {
    ...snesFunctions,
    file: 'tools/snes/functions.mjs',
    address: address => address,
    play: true,
    name: (value, copy) => snesFunctions.snesNames(value, snesFunctions.snesProgram(copy).map)[0]?.[1],
    fromPlay: (copy, functions, sent) => snesFunctions.fromPlay(copy, functions, sent),
  },
  // a PlayStation or PlayStation 2 game's program, read off its disc, as a disc can be far larger than its program
  ps1: {
    ...ps1Functions,
    file: 'tools/ps1/functions.mjs',
    read: ps1Functions.ps1Program,
    address: address => address,
  },
  // a Nintendo 64 game's code as its cartridge starts it, read in the console's byte order whatever order the copy's in
  n64: {
    ...n64Functions,
    file: 'tools/n64/functions.mjs',
    read: n64Functions.n64Cartridge,
    address: address => address,
  },
  // a PlayStation Portable game's program, read off its disc or out of the file a download comes as, and placed where
  // the emulator places it when it's relocatable
  psp: {
    ...pspFunctions,
    file: 'tools/psp/functions.mjs',
    read: pspFunctions.pspProgram,
    address: address => address,
  },
  // a PlayStation 2 game's every program, module and vector unit program on its disc, each found on its own; a list
  // is of the program the disc boots
  ps2: {
    file: 'tools/ps2/functions.mjs',
    read: path => ps2Functions.ps2Disc(path, { progress: (done, total) => process.stdout.write(`\rLooking for code in the disc's files: ${Math.floor(done / total * 100)}%…`) }).finally(() => process.stdout.write('\n')),
    inCode: code => ps2Functions.inCode(code.boot),
    startsInData: (code, listed) => ps2Functions.startsInData(code.boot, listed.filter(f => !f.program && !f.vu)),
    findFunctions: (code, listed) => ps2Functions.discFunctions(code, listed),
    fill: (code, listed) => ps2Functions.discFunctions(code, listed),
    address: address => address,
  },
};

export async function run(args) {
  const game = args.find(a => !a.startsWith('--'));
  const fromAt = args.indexOf('--from');
  const list = fromAt >= 0 ? args[fromAt + 1] : null;
  const memoryOnly = args.includes('--memory'), fill = args.includes('--fill') || memoryOnly;
  if (!game || (fromAt >= 0 && !list) || (list && fill)) throw new Error('Usage: npm run dp -- codemap <game> [--from <list of functions> | --fill | --memory]');
  const original = readOriginal(game);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`The code map is of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const read = await readAnyCopy(copy.path, original.console);
  if (read?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  // the tools find functions only in some consoles' code, and take another console's from a disassembler's list
  const finder = FINDERS[original.console];
  if (!finder && !list && !fill) throw new Error(`The tools can't find the functions in ${original.console} code themselves: --from <list> takes them from a decompilation or a disassembler.`);
  const theCopy = finder ? (finder.read ? await finder.read(copy.path) : readFileSync(copy.path)) : null;
  const FOUND = `the proof tools (${finder?.file})`;
  const filled = listed => {
    if (!finder) return listed;
    const inData = finder.startsInData(theCopy, listed);
    if (inData.length) console.log(`Left out ${inData.length} of the functions listed, which start in the data of the code before them: ${inData.map(f => `0x${hex(f.address)}`).join(', ')}.`);
    const real = listed.filter(f => !inData.includes(f));
    return finder.fill ? finder.fill(theCopy, real) : gbaFunctions.fillFunctions(real, finder.findFunctions(theCopy, real));
  };
  let functions, from, copies = [];
  if (list) {
    const reading = finder ? { inCode: finder.inCode(theCopy), address: finder.address, name: finder.name && (value => finder.name(value, theCopy)) } : { inCode: () => true, address: a => a };
    functions = filled(readList(readFileSync(list, 'utf8'), reading));
    from = `The functions in ${basename(list)}, ${finder ? `with what ${FOUND} found in the copy beyond them` : 'as they are'}`;
  } else if (fill) {
    const map = readCodeMap(game);
    if (!map) throw new Error(`games/${game}/proof/ has no code map yet: npm run dp -- codemap ${game} makes one.`);
    // --memory leaves the cartridge's functions as they are, but where a copy shows one starts
    functions = memoryOnly ? map.functions.filter(f => !f.bytes).map(({ key, bytes, ...f }) => f) : filled(map.functions.filter(f => !f.bytes));
    if (!memoryOnly) from = map.from.includes(FOUND) ? map.from : `${map.from}, with what ${FOUND} found in the copy beyond them`;
    else if (!finder?.memory) throw new Error(`The tools don't see ${original.console} code run yet, so they can't find what it runs in memory.`);
    else from = map.from;
    if (finder?.memory) {
      const found = await codeInMemory(game, original, copy.path, theCopy, functions);
      if (found) {
        functions = [...splitAt(functions, found.starts), ...found.functions].sort((a, b) => a.address - b.address || (a.bytes ?? '').localeCompare(b.bytes ?? ''));
        copies = found.copies;
        const unpacked = copies.filter(c => c.packed);
        if (unpacked.length) console.log(`Unpacked: ${unpacked.length} stretch${unpacked.length === 1 ? '' : 'es'} of the work RAM hold code the game has the BIOS unpack from the cartridge, ${unpacked.map(c => `0x${hex(c.ram)} from 0x${hex(c.cartridge)}${c.from ? ` (${c.from} bytes in)` : ''}`).join(', ')}.`);
        if (found.unknown.length) console.log(`Not traced to the cartridge: ${found.unknown.length} function${found.unknown.length === 1 ? '' : 's'} the game makes in its work RAM, whose bytes no copy of the cartridge or unpack the tools follow holds: ${found.unknown.map(a => `0x${hex(a)}`).join(', ')}.`);
        from = from.replace(/, and the code (its|the game's) recordings run.*$/, '') + `, and the code the game's recordings run in the work RAM, found by playing them in the original`;
      }
    }
    if (finder?.play) {
      const sent = await sentInPlay(game, original, copy.path);
      // on the Super Nintendo the code is followed again from where play went, in the mode it went there in
      const found = sent && finder.fromPlay ? finder.fromPlay(theCopy, functions, sent) : null;
      const starts = found ? found.starts : sent && startsFromPlay(nesFunctions.nesProgram(theCopy).prg, functions, sent);
      if (starts?.length) {
        // each starts a function, cut from the one it's in if it's in one, and its code is followed from there
        const cut = splitAt(functions, starts.map(address => ({ address, size: 1 })));
        functions = found ? found.functions : gbaFunctions.fillFunctions(cut, finder.findFunctions(theCopy, cut));
        const PLAYED = ', and the functions its recordings reach that following the code doesn\'t, found by playing them in the original';
        if (!from.includes(PLAYED)) from += PLAYED;
        const hexes = starts.slice(0, 12).map(address => `0x${hex(address)}`).join(', ');
        console.log(`Found by playing: ${starts.length} function${starts.length === 1 ? '' : 's'} the recordings reach that following the code didn't, at ${hexes}${starts.length > 12 ? ` and ${starts.length - 12} more` : ''}.`);
      } else if (sent) {
        console.log('Found by playing: nothing the code map didn\'t have.');
      }
    }
  } else {
    functions = finder.findFunctions(theCopy);
    from = `Found in the copy by ${FOUND}`;
  }
  if (!functions.length) throw new Error('No functions found.');
  writeCodeMap(game, { original: original.sha1, from, functions, copies });
  const bytes = functions.reduce((sum, f) => sum + f.size, 0), inRam = functions.filter(f => f.bytes);
  console.log(`games/${game}/proof/code-map.json: ${functions.length} functions, ${bytes.toLocaleString('en')} bytes of code`
    + (inRam.length || copies.length ? `, of which ${inRam.length} the game makes in its work RAM, and ${copies.filter(c => !c.packed).length} stretch${copies.filter(c => !c.packed).length === 1 ? '' : 'es'} of the cartridge it copies there to run.` : '.'));
  // a disc's other programs and its vector units' programs
  const others = functions.filter(f => f.program && !f.vu), vu = functions.filter(f => f.vu);
  if (others.length || vu.length) {
    const sum = list => list.reduce((total, f) => total + f.size, 0).toLocaleString('en');
    console.log(`Of those, ${sum(others)} bytes are in ${new Set(others.map(f => f.program)).size} other programs and modules on the disc, and ${sum(vu)} bytes in ${vu.length} vector unit programs.`);
  }
  return 0;
}

/** Where play sent the processor in every recording of a game whose emulator says so (libretro/ran.h): each place
 *  once for each way and mode, as { address, way, mode }, `way` being 'called', 'jumped' through a pointer or
 *  'returned' to, and `mode` the processor's mode as its emulator says it. Null when the emulator doesn't say, or the
 *  game has no recordings one console plays. */
async function sentInPlay(game, original, copyPath) {
  const reference = await referenceOf(original);
  const recordings = readRecordings(game).filter(r => r.players === undefined);
  if (reference.seesEntries !== true || !recordings.length) return null;
  reference.ensureOriginal(console.log);
  const keysLate = original.keysAfterVBlank === true;
  const found = new Map();
  let next = 0, done = 0;
  const worker = async () => {
    for (let i = next++; i < recordings.length; i = next++) {
      const { originalHeld, sets } = originalPlay(recordings[i], { keysLate });
      const buttons = originalHeld.map(list => list.reduce((mask, b) => mask | (reference.KEY[b] ?? 0), 0));
      if (keysLate) buttons.unshift(0);
      const { entries } = await reference.runOriginal({ copy: copyPath, frames: buttons.length + 1, buttons, sets, entries: true });
      for (const { address, way, mode } of entries) if (!found.has(`${address} ${way} ${mode}`)) found.set(`${address} ${way} ${mode}`, { address, way, mode });
      process.stdout.write(`\rLooking for functions only play reaches: ${++done} of ${recordings.length} recordings…`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, atOnce({ wanted: recordings.length })) }, worker));
  process.stdout.write('\n');
  return [...found.values()];
}

/**
 * The places play sent an NES game's processor to that start a function the code map doesn't have, sorted: `prg` is
 * the program's bytes, `functions` the map's, and `sent` each { address, way }. A place a JSR called starts a
 * function wherever it is. One a JMP ($xxxx) jumped to, or an RTS returned to that isn't just after a JSR, as the
 * address a routine pushed is, starts one only outside every function of the map: inside one it's that function's
 * own code, as the case of a switch is, or where a call that reads the list after it comes back.
 */
export function startsFromPlay(prg, functions, sent) {
  const sorted = [...functions].sort((a, b) => a.address - b.address);
  const holder = address => {
    let low = 0, high = sorted.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, f = sorted[middle];
      if (address < f.address) high = middle - 1;
      else if (address >= f.address + f.size) low = middle + 1;
      else return f;
    }
    return null;
  };
  const afterCall = address => address >= 3 && prg[address - 3] === 0x20;
  const starts = new Set();
  for (const { address, way } of sent) {
    const f = holder(address);
    if (f?.address === address || (way === 'returned' && afterCall(address))) continue;
    if (way === 'called' || !f) starts.add(address);
  }
  return [...starts].sort((a, b) => a - b);
}

/** The functions in a list: `nm -S` lines, or a CSV with a header naming its address column, and its size or end
 *  column if it has one. `inCode` says whether an address is code's, `address` turns a list's address into a
 *  function's start, and `name`, where a console has one, reads an address written as a name. */
export function readList(text, { inCode = isCode, address: start = a => a & ~1, name: named } = {}) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  // an address is hexadecimal, with or without 0x or a memory's name before it (ram:08000204); a size is decimal
  // unless it starts with 0x
  const clean = value => String(value ?? '').trim().replace(/^.*:/, '');
  const address = value => (/^(0x)?[0-9a-f]+$/i.test(clean(value)) ? parseInt(clean(value).replace(/^0x/i, ''), 16) : named?.(String(value ?? '').trim()) ?? NaN);
  const size = value => (/^0x[0-9a-f]+$/i.test(clean(value)) ? parseInt(clean(value), 16) : /^\d+$/.test(clean(value)) ? Number(clean(value)) : NaN);
  const out = [];
  const nm = /^([0-9a-f]{8})\s+([0-9a-f]{8})\s+([tTwW])\s+(\S+)/i;
  if (lines.some(l => nm.test(l))) {
    for (const line of lines) {
      const m = line.match(nm);
      if (m) out.push({ address: start(parseInt(m[1], 16)), size: parseInt(m[2], 16), name: m[4] });
    }
  } else {
    const split = line => line.match(/("[^"]*"|[^,\t]+)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) ?? [];
    const head = split(lines[0]).map(c => c.toLowerCase());
    const column = (...patterns) => head.findIndex(h => patterns.some(p => p.test(h)));
    const at = column(/^(address|location|entry ?point|start)$/, /address|location|entry/);
    const length = column(/^(size|length|function size)$/, /size|length/);
    // the end is the address just after the function's last byte, as decompilations list their functions' extents
    const end = column(/^(end|end address)$/);
    const label = column(/^(name|label|function name|symbol)$/);
    if (at < 0) throw new Error('The list needs a column for the address, named in its first line, or nm -S lines.');
    for (const line of lines.slice(1)) {
      const cells = split(line);
      const from = address(cells[at]);
      const bytes = length >= 0 ? size(cells[length]) : end >= 0 ? address(cells[end]) - from : NaN;
      if (Number.isFinite(from)) out.push({ address: start(from), size: Number.isFinite(bytes) ? bytes : 0, name: label >= 0 ? cells[label] : undefined });
    }
  }
  // only code, each function once, and those listed without a size as long as the gap to the next
  const byAddress = new Map();
  for (const f of out) if (inCode(f.address) && !byAddress.has(f.address)) byAddress.set(f.address, f);
  const sorted = [...byAddress.values()].sort((a, b) => a.address - b.address);
  return sorted.map((f, i) => {
    const next = sorted[i + 1]?.address;
    const size = f.size || (next && next - f.address < 0x10000 ? next - f.address : 0);
    return { address: f.address, size, ...(f.name ? { name: f.name } : {}) };
  }).filter(f => f.size > 0);
}

// the work RAMs of the Game Boy Advance, where its games copy or make code to run it
const MEMORY = [[0x03000000, 0x8000], [0x02000000, 0x40000]];
// a stretch of code in memory: one that ran, with up to this much between its instructions, and how much around it
// to read, for its literal pools and the rest of its last function
const APART = 0x800, BEFORE = 0x40, AFTER = 0x800;

/** The code a Game Boy Advance game's recordings run in its work RAM, as { functions, copies, starts }: functions of
 *  its own (with `bytes`), the stretches of the cartridge's code it copies there, and where the cartridge's functions
 *  start, as the copies show. Null when no recording runs any. */
async function codeInMemory(game, original, copyPath, cartridge, mapped) {
  const reference = await referenceOf(original);
  reference.ensureOriginal(console.log);
  const keysLate = original.keysAfterVBlank === true;
  const recordings = readRecordings(game).filter(r => r.players === undefined);
  // the recordings a few at a time, each the stretches of memory its code ran in, joined in the recordings' order
  const perRecording = new Array(recordings.length), unpacks = new Map();
  let next = 0, done = 0;
  const worker = async () => {
    for (let i = next++; i < recordings.length; i = next++) {
      const ran = await stretchesIn(recordings[i], reference, copyPath, keysLate);
      perRecording[i] = ran.stretches;
      for (const u of ran.unpacks) unpacks.set(`${u.call} ${u.source} ${u.target}`, u);
      process.stdout.write(`\rLooking for code in the work RAM: ${++done} of ${recordings.length} recordings…`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, atOnce({ wanted: recordings.length })) }, worker));
  const stretches = [];   // each { base, bytes, ran: Map address → { address, thumb, code } }
  for (const list of perRecording) for (const stretch of list) addStretch(stretches, stretch);
  process.stdout.write('\n');
  if (!stretches.length) return null;
  // the cartridge's functions by their first 4 bytes, to know a copy of one wherever the game puts it, as on the stack
  const cartridgeFunctions = map => {
    const byStart = new Map();
    for (const f of map) {
      if (f.address < 0x08000000 || f.size < 2) continue;
      const key = cartridge.subarray(f.address - 0x08000000, f.address - 0x08000000 + 4).toString('hex');
      if (!byStart.has(key)) byStart.set(key, []);
      byStart.get(key).push(f);
    }
    return byStart;
  };
  const byStart = cartridgeFunctions(mapped);
  const romAt = (address, size) => cartridge.subarray(address - 0x08000000, address - 0x08000000 + size);
  // whether the instructions that ran from `ram` on are those the cartridge has from `from` on, for `size` bytes
  const agrees = (ran, ram, from, size) => ran.length > 0 && ran.every(r => r.address < ram || r.address >= ram + size
    || (r.thumb ? romAt(from + r.address - ram, 2).readUInt16LE(0) : romAt(from + r.address - ram, 4).readUInt32LE(0)) === r.code);
  // what each unpack of the cartridge the recordings made puts in the work RAM
  const made = [...unpacks.values()].map(u => ({ ...u, packed: UNPACKED_BY[u.call], bytes: UNPACKED_BY[u.call] && unpack(UNPACKED_BY[u.call], cartridge, u.source - 0x08000000)?.bytes }))
    .filter(u => u.bytes).map(u => ({ ...u, bytes: Buffer.from(u.bytes.buffer, u.bytes.byteOffset, u.bytes.length) }));
  const sameAs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  // where a function of the game's own comes from, as the code map's copies say it: what an unpack put where it runs,
  // or a stretch of what one made, the only place it's found, that the game copied on to run where it runs
  const unpackedAs = (address, bytes, ran) => {
    const agreeing = (all, from) => ran.every(r => (r.thumb ? all[from + r.address - address] | all[from + r.address - address + 1] << 8
      : (all[from + r.address - address] | all[from + r.address - address + 1] << 8 | all[from + r.address - address + 2] << 16 | all[from + r.address - address + 3] << 24) >>> 0) === r.code);
    for (const u of made) {
      const at = address - u.target;
      if (at >= 0 && at + bytes.length <= u.bytes.length && sameAs(u.bytes.subarray(at, at + bytes.length), bytes) && agreeing(u.bytes, at)) return { ram: u.target, cartridge: u.source, size: u.bytes.length, packed: u.packed };
    }
    if (bytes.length < 8) return null;
    const places = [];
    for (const u of made) for (let at = u.bytes.indexOf(bytes); at >= 0; at = u.bytes.indexOf(bytes, at + 1)) if (agreeing(u.bytes, at)) places.push({ u, at });
    if (places.length !== 1) return null;
    const { u, at } = places[0];
    return { ram: address, cartridge: u.source, size: bytes.length, packed: u.packed, ...(at ? { from: at } : {}) };
  };
  const functions = [], copies = [], starts = [];
  for (const stretch of stretches) {
    const found = gbaFunctions.findInMemory(stretch.bytes, stretch.base, [...stretch.ran.values()]);
    const bytesOf = (address, size) => stretch.bytes.subarray(address - stretch.base, address - stretch.base + size);
    // a function whose bytes aren't what ran in it, as where a stretch read once the game had cleared that memory was
    // joined over another's, isn't there to be found, and nor is one nothing ran in whose bytes are all one value, as
    // memory the game cleared is, which the code that ran calls into only at another time
    const stillThere = f => {
      const ran = [...stretch.ran.values()].filter(r => r.address >= f.address && r.address < f.address + f.size);
      if (!ran.length && bytesOf(f.address, f.size).every((b, i, all) => b === all[0])) return false;
      return ran.every(r => (r.thumb ? stretch.bytes.readUInt16LE(r.address - stretch.base) : stretch.bytes.readUInt32LE(r.address - stretch.base)) === r.code);
    };
    // how far the bigger functions sit from where the cartridge has them, as a copy of a stretch of its code shows
    const apart = new Set();
    for (const f of found) {
      if (f.size < 32) continue;
      const at = cartridge.indexOf(bytesOf(f.address, f.size));
      if (at >= 0 && stillThere(f)) apart.add(f.address - (0x08000000 + at));
    }
    const here = [];   // this stretch's copies, { ram, cartridge, size }
    for (const f of found) {
      if (!stillThere(f)) continue;
      const within = here.find(c => f.address >= c.ram && f.address < c.ram + c.size);
      // a function inside a copy is the cartridge's: it shows where one starts, if it surely starts one
      let copy = within ? { ram: f.address, cartridge: f.address - within.ram + within.cartridge, size: 0 } : null;
      if (!copy) {
        const d = [...apart].find(d => f.address - d >= 0x08000000 && romAt(f.address - d, f.size).equals(bytesOf(f.address, f.size)));
        if (d !== undefined) copy = { ram: f.address, cartridge: f.address - d, size: f.size };
      }
      const ran = [...stretch.ran.values()].filter(r => r.address >= f.address && r.address < f.address + f.size);
      if (!copy) {
        // a function of the cartridge copied whole, as on the stack, where what ran is all that's sure to be still there
        // and nothing ran past its end
        const g = (byStart.get(bytesOf(f.address, 4).toString('hex')) ?? []).find(g => ran.every(r => r.address < f.address + g.size) && agrees(ran, f.address, g.address, g.size));
        if (g) copy = { ram: f.address, cartridge: g.address, size: g.size };
      }
      if (!copy) {
        functions.push({ address: f.address, size: f.size, bytes: bytesText(bytesOf(f.address, 8)), ran, unpacked: unpackedAs(f.address, bytesOf(f.address, f.size), ran) });
        continue;
      }
      if (f.starts || !within) starts.push({ address: copy.cartridge, size: copy.size || f.size });
      if (copy.size) here.push(copy);
    }
    copies.push(...here);
  }
  // a copy found in several recordings, or in pieces, is one stretch: those as far from the cartridge that meet
  copies.sort((a, b) => a.ram - a.cartridge - (b.ram - b.cartridge) || a.ram - b.ram);
  const joined = [];
  for (const c of copies) {
    const last = joined.at(-1);
    if (last && last.ram - last.cartridge === c.ram - c.cartridge && c.ram <= last.ram + last.size) last.size = Math.max(last.size, c.ram + c.size - last.ram);
    else joined.push({ ...c });
  }
  // what ran as part of a copy another recording shows whole is that copy's, and the same code found again, as it is
  // in several recordings, counts once
  const own = functions.filter(f => !joined.some(c => f.address >= c.ram && f.address < c.ram + c.size && agrees(f.ran, c.ram, c.cartridge, c.size)));
  const unique = new Map();
  for (const { ran, unpacked, ...f } of own) {
    const key = `${f.address}/${f.bytes}`;
    unique.set(key, { ...f, unpacked: unique.get(key)?.unpacked ?? unpacked, ran: unique.get(key)?.ran || ran.some(r => r.address === f.address) });
  }
  // and where the cartridge holds a function's bytes, other bytes at that address nothing ran from, and that nothing
  // holds, were read at another time, as memory the game had cleared or used for something else
  const traced = new Set([...unique.values()].filter(f => f.unpacked).map(f => f.address));
  for (const [key, f] of unique) if (!f.ran && !f.unpacked && traced.has(f.address)) unique.delete(key);
  // the unpacked copies, each once, those copied on joined where they meet as far into what was unpacked
  const packed = [];
  for (const c of [...unique.values()].map(f => f.unpacked).filter(Boolean).sort((a, b) => a.ram - (a.from ?? 0) - (b.ram - (b.from ?? 0)) || a.ram - b.ram)) {
    const last = packed.at(-1);
    if (last && last.cartridge === c.cartridge && last.packed === c.packed && last.ram - (last.from ?? 0) === c.ram - (c.from ?? 0) && c.ram <= last.ram + last.size) last.size = Math.max(last.size, c.ram + c.size - last.ram);
    else packed.push({ ...c });
  }
  const unknown = [...unique.values()].filter(f => !f.unpacked).map(f => f.address);
  return {
    functions: [...unique.values()].map(({ unpacked, ran, ...f }) => f),
    copies: [...joined, ...packed].sort((a, b) => a.ram - b.ram || a.cartridge - b.cartridge),
    starts: [...new Map(starts.map(s => [s.address, s])).values()].sort((a, b) => a.address - b.address),
    unknown: [...new Set(unknown)],
  };
}

/** The stretches of the work RAM a recording runs code in, each as the last of its code ran: what ran, a load at a
 *  time, as a load ends where an address runs other code than it did before in it; and the BIOS's unpacks from the
 *  cartridge into the work RAM, { frame, call, source, target }. */
async function stretchesIn(recording, reference, copyPath, keysLate) {
  const { originalHeld, sets } = originalPlay(recording, { keysLate });
  const buttons = originalHeld.map(list => list.reduce((mask, b) => mask | (reference.KEY[b] ?? 0), 0));
  if (keysLate) buttons.unshift(0);
  const run = { copy: copyPath, frames: buttons.length + 1, buttons, sets };
  const { ramCode, unpacks } = await reference.runOriginal({ ...run, ramCode: true });
  if (!ramCode.length) return { stretches: [], unpacks };
  const loads = [];
  for (const [base, length] of MEMORY) {
    let load = null;
    for (const r of ramCode) {
      if (r.address < base || r.address >= base + length) continue;
      if (!load || (load.ran.has(r.address) && load.ran.get(r.address).code !== r.code)) loads.push(load = { base, length, ran: new Map(), frame: 0 });
      load.ran.set(r.address, r);
      load.frame = r.frame;
    }
  }
  const reads = [], wanted = [];
  for (const load of loads) {
    const addresses = [...load.ran.keys()].sort((a, b) => a - b);
    for (let i = 0; i < addresses.length;) {
      let j = i;
      while (j + 1 < addresses.length && addresses[j + 1] - addresses[j] <= APART) j++;
      const from = Math.max(load.base, (addresses[i] & ~3) - BEFORE), to = Math.min(load.base + load.length, (addresses[j] & ~3) + AFTER);
      wanted.push({ from, to, ran: addresses.slice(i, j + 1).map(a => load.ran.get(a)), at: reads.length });
      for (let at = from; at < to; at += 4) reads.push({ frame: load.frame, address: at, bytes: 4 });
      i = j + 1;
    }
  }
  const order = reads.map((r, i) => i).sort((a, b) => reads[a].frame - reads[b].frame || a - b);
  const { outside } = await reference.runOriginal({ ...run, reads: order.map(i => reads[i]) });
  const values = new Uint32Array(reads.length);
  order.forEach((i, k) => { values[i] = outside.reads[k]; });
  // only what's still there as it's read: code a later load put elsewhere comes in its own load, and a stretch none of
  // whose code is there any more, as the game cleared it, holds none of it
  const stretches = wanted.map(w => {
    const bytes = Buffer.from(new Uint32Array(values.subarray(w.at, w.at + (w.to - w.from) / 4)).buffer);
    const ran = w.ran.filter(r => (r.thumb ? bytes.readUInt16LE(r.address - w.from) : bytes.readUInt32LE(r.address - w.from)) === r.code);
    return { base: w.from, bytes, ran: new Map(ran.map(r => [r.address, r])) };
  }).filter(s => s.ran.size);
  return { stretches, unpacks };
}

/** A stretch of memory joins one it overlaps or meets whose code that ran is the same in both, as the same code read
 *  at another time, with other data beside it, or else is one of its own, as other code at the same addresses is. */
function addStretch(stretches, stretch) {
  const codeAt = (s, r) => (r.thumb ? s.bytes.readUInt16LE(r.address - s.base) : s.bytes.readUInt32LE(r.address - s.base));
  const inStretch = (s, r) => r.address >= s.base && r.address + (r.thumb ? 2 : 4) <= s.base + s.bytes.length;
  const i = stretches.findIndex(other => {
    if (Math.max(other.base, stretch.base) > Math.min(other.base + other.bytes.length, stretch.base + stretch.bytes.length)) return false;
    return [[stretch, other], [other, stretch]].every(([a, b]) => [...a.ran.values()].every(r => !inStretch(b, r) || codeAt(b, r) === r.code));
  });
  if (i < 0) {
    stretches.push(stretch);
    return;
  }
  const [other] = stretches.splice(i, 1);
  const base = Math.min(other.base, stretch.base), end = Math.max(other.base + other.bytes.length, stretch.base + stretch.bytes.length);
  const bytes = Buffer.alloc(end - base);
  stretch.bytes.copy(bytes, stretch.base - base);
  other.bytes.copy(bytes, other.base - base);
  addStretch(stretches, { base, bytes, ran: new Map([...other.ran, ...stretch.ran]) });
}

/** The cartridge's functions split where `starts` ({ address, size }) says one starts: the one a start falls in ends
 *  there, and a start in no function begins one, as long as its copy's, up to the next. */
export function splitAt(functions, starts) {
  const out = functions.map(f => ({ ...f }));
  for (const start of starts) {
    if (out.some(f => f.address === start.address)) continue;
    const i = out.findIndex(f => start.address > f.address && start.address < f.address + f.size);
    if (i >= 0) {
      const f = out[i];
      out.splice(i + 1, 0, { address: start.address, size: f.address + f.size - start.address });
      f.size = start.address - f.address;
      continue;
    }
    const next = out.find(f => f.address > start.address);
    out.push({ address: start.address, size: Math.min(start.size, (next?.address ?? Infinity) - start.address) });
    out.sort((a, b) => a.address - b.address);
  }
  return out;
}
