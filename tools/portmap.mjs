// npm run dp -- portmap [<game>] [--check]: writes games/<game>/proof/port-map.json, the port map: each function of
// the original that the Dreamport's code names, with the first place it names it, and every name that lands inside a
// function of the code map but not at its start, so it can be put right. It's what code ported is measured with, alone since #1452: a function
// the original only ran in matching play has no twin and doesn't count (docs/STANDARD.md#how-progress-is-measured). It also lists the Dreamport's stops: each
// path of the original its code says it hasn't ported, with the function of the original the path is in, which doesn't
// count towards code ported while it has one (docs/STANDARD.md#stops). Without a game it does every game with a
// code map. With --check it changes nothing and fails when a port map is out of date, which `npm run check` uses.
// A version in another language has a port map of its own, of its own code, as in `npm run dp -- portmap sonic-battle/c`,
// which writes games/sonic-battle/c/proof/port-map.json from the C in games/sonic-battle/c/ (src/lib/languages.mjs).
//
// A name is an address of the original's code, in the cartridge: written as a number (0x08029E78 or 0x8029E78),
// it's an address in the copy the proof uses; written as a label (sub_8029E78, Task_80397A8, or FUN_08029E78 as
// Ghidra writes them), it's one in the release the game's labels come from. An address outside every function of the
// code map is the game's data, such as a picture or a table the code reads, and isn't a name. When that's another release, the game's proof/names.json says how far each stretch of
// its code is from the copy's:
//
// {
//   "about": where the labels come from, and how the shifts were found,
//   "shifts": [{ "from": "0801C130", "to": "0803AB60", "by": 48 }, ...]: a label from `from` to `to` names the
//     function `by` bytes earlier in the copy
// }
//
// A stop is the words dp:stop in a line of the code, in a comment where the path would be, and after them the
// address in the original of what isn't ported, written as a name is: `// dp:stop 0x0800486C`. Every name after the
// words on that line is a stop, and none of them a name. The address can be anywhere in the function, such as the
// branch not taken, or its start when none of it is ported.
//
// On the PlayStation a name is an address in the console's memory, where its code is, written as a number,
// 0x800C1234, or in a label, as decompilations name functions and values, func_800C1234 and D_800D8408, or as Ghidra
// does, FUN_800c1234.
//
// On the NES, where the program is in banks the cartridge switches, a name is a label with the bank in it: sub_04_923F
// is $923F with bank 4 switched in at $8000, and sub_C39C, with no bank, is in the last bank, always at $C000. The code
// map numbers each by its offset in the program (nes/functions.mjs).
//
// A version that takes a shared library from the kit (lib/libraries.mjs) names each of its twins through its
// proof/libraries.json, which gives where its copy has each one, and the port map lists them with their place in the
// kit, as kit/gba/c/lib/<name>/<file>.c:<line>. A library's code names no address, so a stop in it is the words
// dp:stop alone, and holds back the function of the library it's in.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gameFolder, proofFolder, REPO, sharedProofFolder } from './lib/paths.mjs';
import { librariesFile, versionLibraries } from './lib/libraries.mjs';
import { twinsIn } from './gba/match.mjs';
import { proofVersions, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { LANGUAGES, OTHER_LANGUAGES, TRIALS, versionOf, writtenIn } from '../src/lib/languages.mjs';
import { nesNames } from './nes/functions.mjs';

// a label's word and its address, or a number's: in the cartridge, or in the work RAMs, where a game copies or unpacks
// code to run it
export const NAME = /\b(?:([A-Za-z][A-Za-z0-9]*)_0?|0x0?)([238][0-9A-Fa-f]{6})\b/g;
// the first addresses of the cartridge and of the work RAMs, which code uses as the base of every address in them, not
// as functions
export const BASES = new Set([0x08000000, 0x02000000, 0x03000000]);
// a PlayStation address in the console's memory, as a number or in a label
const PS1_NAME = /\b(?:([A-Za-z][A-Za-z0-9]*)_|0x)(80[0-7][0-9A-Fa-f]{5})\b/g;
// a PlayStation 2 address in the console's 32 MB, above the kernel's half megabyte, as a number or in a label, such as
// func_00123450
const PS2_NAME = /\b(?:([A-Za-z][A-Za-z0-9]*)_|0x)(00(?:[1-9A-Fa-f][0-9A-Fa-f]|0[89A-Fa-f])[0-9A-Fa-f]{4}|01[0-9A-Fa-f]{6})\b/g;

/** How a console's code names an address: `pattern`, whose first group is a label's word and second its digits,
 *  `bases`, the addresses code uses as the base of others and not as names, and `address(digits)`, the address. A
 *  Game Boy Advance address's lowest bit says Thumb code, which a function's start doesn't have. */
export function namesOf(console) {
  if (console === 'ps1') return { pattern: PS1_NAME, bases: new Set([0x80000000]), address: digits => parseInt(digits, 16) };
  if (console === 'ps2') return { pattern: PS2_NAME, bases: new Set(), address: digits => parseInt(digits, 16) };
  return { pattern: NAME, bases: BASES, address: digits => parseInt(digits, 16) & ~1 };
}
// the words that mark a stop, in any language's code
export const STOP = /\bdp:stop\b/;

// the names in a line of a game's code, as [name, address, whether it's a label] for each console's code map. A Game
// Boy Advance address is the cartridge's or the work RAM's; an NES one is the offset in the program, from a label such as sub_04_923F
// (nes/functions.mjs), in a program of as many banks as the code map reaches, as its last bank always has code.
function namer(console, codeMap) {
  if (console === 'nes') {
    const banks = Math.floor(Math.max(...codeMap.functions.map(f => f.address)) / 0x4000) + 1;
    return line => nesNames(line, banks).map(([name, offset]) => [name, offset, true]);
  }
  const { pattern, bases, address: of } = namesOf(console);
  return line => [...line.matchAll(pattern)].map(([name, label, digits]) => [name, of(digits), Boolean(label)]).filter(([, address]) => !bases.has(address));
}

/** A line's names as [those before the stop's words, those after them]: its names, and its stops. */
export function namesAndStops(line, names) {
  const at = line.search(STOP);
  return at < 0 ? [names(line), []] : [names(line.slice(0, at)), names(line.slice(at))];
}

export async function run(args) {
  const check = args.includes('--check');
  const named = args.filter(a => !a.startsWith('--'));
  const games = named.length ? named : proofVersions().filter(game => readCodeMap(game));
  const stale = [];
  for (const game of games) {
    const map = portMap(game);
    const file = join(proofFolder(game), 'port-map.json');
    const text = format(map);
    if (check) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== text) stale.push(game);
      continue;
    }
    if (existsSync(file) && readFileSync(file, 'utf8') === text) {
      console.log(`games/${game}/proof/port-map.json was already up to date.`);
      continue;
    }
    mkdirSync(proofFolder(game), { recursive: true });
    writeFileSync(file, text);
    console.log(`Written: games/${game}/proof/port-map.json, ${map.functions.length} functions named, ${map.unmatched.length} name${map.unmatched.length === 1 ? '' : 's'} inside a function but not at its start, ${map.stops.length} stop${map.stops.length === 1 ? '' : 's'}.`);
  }
  if (check) {
    if (stale.length) throw new Error(stale.map(game => `games/${game}/proof/port-map.json is out of date: npm run dp -- portmap ${game} writes it again.`).join('\n'));
    console.log(`The port map${games.length === 1 ? ' is' : 's are'} up to date.`);
    return 0;
  }
  return 0;
}

/** A game's port map, from its code and its code map: { original, from, functions, unmatched, stops }. */
export function portMap(game) {
  const original = readOriginal(game);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${versionOf(game).game}/proof/ has no code map yet: npm run dp -- codemap ${versionOf(game).game} makes one.`);
  // the functions starting at each address: in the cartridge one, and in the work RAM any the game puts there, and
  // each cartridge function a copy holds, where the copy runs
  const starts = new Map(), spans = [];
  const at = (address, size, f) => {
    if (!starts.has(address)) starts.set(address, []);
    starts.get(address).push(f);
    spans.push({ address, size, f });
  };
  for (const f of codeMap.functions) at(f.address, f.size, f);
  for (const copy of codeMap.copies.filter(c => !c.packed)) {
    for (const f of codeMap.functions) {
      if (!f.bytes && f.address >= copy.cartridge && f.address < copy.cartridge + copy.size) at(copy.ram + f.address - copy.cartridge, f.size, f);
    }
  }
  spans.sort((a, b) => a.address - b.address);
  const inside = address => {
    let low = 0, high = spans.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, f = spans[middle];
      if (address < f.address) high = middle - 1;
      else if (address >= f.address + f.size) low = middle + 1;
      else return true;
    }
    return false;
  };
  // the functions `address` is in: those that start there, or else every one around it, as in the work RAM a game can
  // put one program's code where another's was
  const around = address => starts.get(address) ?? [...new Set(spans.filter(s => address >= s.address && address < s.address + s.size).map(s => s.f))];
  const order = new Map(codeMap.functions.map((f, i) => [f.key, i]));
  const shifts = readShifts(game);
  const names = namer(original.console, codeMap);
  const functions = new Map(), unmatched = new Map(), stops = [];
  const shifted = (address, label) => (label ? address - (shifts.find(s => address >= s.from && address <= s.to)?.by ?? 0) : address);
  for (const file of codeFiles(gameFolder(game), writtenIn(versionOf(game).language))) {
    const where = relative(gameFolder(game), file).split(sep).join('/');
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const [named, stopped] = namesAndStops(line, names);
      // a stop, in each function of the original its address is in, or in none the code map has
      for (const [name, plain, label] of stopped) {
        const found = around(shifted(plain, label));
        for (const key of found.length ? found.map(f => f.key) : [null]) stops.push([key, `${where}:${i + 1}`, name]);
      }
      for (let [name, address, label] of named) {
        address = shifted(address, label);
        const found = starts.get(address);
        if (!found && !inside(address)) continue;
        // a name in the work RAM counts each function the game puts at that address
        for (const key of found ? found.map(f => f.key) : [name]) {
          const list = found ? functions : unmatched;
          if (!list.has(key)) list.set(key, `${where}:${i + 1}`);
        }
      }
    });
  }
  // the shared libraries it takes: each twin the version gives an address to, and each stop, in the function it's in
  const libraries = existsSync(librariesFile(game)) ? versionLibraries(game, original.console) : [];
  for (const library of libraries) {
    for (const file of library.files) {
      const where = relative(REPO, file).split(sep).join('/'), text = readFileSync(file, 'utf8');
      const twins = twinsIn(text, [], library.functions).sort((a, b) => a.line - b.line);
      for (const twin of twins.filter(each => each.address !== null)) {
        const found = starts.get(twin.address);
        if (!found && !inside(twin.address)) continue;
        for (const key of found ? found.map(f => f.key) : [twin.name]) {
          const list = found ? functions : unmatched;
          if (!list.has(key)) list.set(key, `${where}:${twin.line}`);
        }
      }
      text.split('\n').forEach((line, i) => {
        if (!STOP.test(line)) return;
        // a stop in a function this version's copy doesn't have isn't one of its stops
        const twin = twins.findLast(each => each.line <= i + 1);
        if (twin && twin.address === null) return;
        const found = twin ? starts.get(twin.address) ?? [] : [];
        for (const key of found.length ? found.map(f => f.key) : [null]) stops.push([key, `${where}:${i + 1}`, twin?.name ?? 'dp:stop']);
      });
    }
  }
  return {
    original: original.sha1,
    from: `The original's functions that games/${game}/ names, found by npm run dp -- portmap${game.includes('/') ? ` ${game}` : ''}`,
    functions: [...functions].sort(([a], [b]) => order.get(a) - order.get(b)).map(([key, where]) => [key, where]),
    unmatched: [...unmatched].sort(([a], [b]) => a.localeCompare(b)).map(([name, where]) => [name, where]),
    stops,
  };
}

// what each language's code is written in
const SOURCES = { js: /\.m?js$/, c: /\.[ch]$/ };
// the version's code: every file of its language in its folder, but its proof, and for the JavaScript one, the
// folders of the versions in other languages, and of the trials
export function codeFiles(folder, language, top = true) {
  const files = [];
  const others = new Set(top && language === 'js' ? [...OTHER_LANGUAGES.map(key => LANGUAGES[key].folder), ...Object.values(TRIALS).map(trial => trial.folder)] : []);
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'proof' && entry.name !== 'node_modules' && !others.has(entry.name)) files.push(...codeFiles(path, language, false));
    } else if (SOURCES[language].test(entry.name)) files.push(path);
  }
  return files.sort();
}

export function readShifts(game) {
  const file = join(sharedProofFolder(game), 'names.json');
  if (!existsSync(file)) return [];
  const { shifts } = JSON.parse(readFileSync(file, 'utf8'));
  const address = /^[0-9A-F]{8}$/;
  if (!Array.isArray(shifts) || !shifts.every(s => address.test(s?.from) && address.test(s?.to) && Number.isInteger(s?.by))) {
    throw new Error(`games/${game}/proof/names.json needs "shifts": [{ "from", "to", "by" }], with addresses as eight capital hexadecimal digits.`);
  }
  return shifts.map(s => ({ from: parseInt(s.from, 16), to: parseInt(s.to, 16), by: s.by }));
}

// a function or a name to a line
function format({ original, from, functions, unmatched, stops }) {
  const lines = list => list.map(item => '    ' + JSON.stringify(item)).join(',\n');
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(from)},\n  "functions": [\n${lines(functions)}\n  ],\n  "unmatched": [\n${lines(unmatched)}\n  ],\n  "stops": [\n${lines(stops)}\n  ]\n}\n`;
}
