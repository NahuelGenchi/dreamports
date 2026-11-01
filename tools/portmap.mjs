// npm run dp -- portmap [<game>] [--check]: writes games/<game>/proof/port-map.json, the port map: each function of
// the original that the Dreamport's code names, with the first place it names it, and every name that lands inside a
// function of the code map but not at its start, so it can be put right. It's what code ported is measured with, beside the functions
// that ran in matching play (docs/STANDARD.md#how-progress-is-measured). Without a game it does every game with a
// code map. With --check it changes nothing and fails when a port map is out of date, which `npm run check` uses.
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

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gameFolder, proofFolder } from './lib/paths.mjs';
import { hex, proofGames, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { writeReadme } from './readme.mjs';

// a label's word and its address, or a number's
const NAME = /\b(?:([A-Za-z][A-Za-z0-9]*)_0?|0x0?)(8[0-9A-Fa-f]{6})\b/g;
// the cartridge's first address, which code uses as the base of every address in it, not as a function
const BASE = 0x08000000;

export async function run(args) {
  const check = args.includes('--check');
  const named = args.filter(a => !a.startsWith('--'));
  const games = named.length ? named : proofGames().filter(game => readCodeMap(game));
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
    writeFileSync(file, text);
    console.log(`Written: games/${game}/proof/port-map.json, ${map.functions.length} functions named, ${map.unmatched.length} name${map.unmatched.length === 1 ? '' : 's'} inside a function but not at its start.`);
  }
  if (check) {
    if (stale.length) throw new Error(stale.map(game => `games/${game}/proof/port-map.json is out of date: npm run dp -- portmap ${game} writes it again.`).join('\n'));
    console.log(`The port map${games.length === 1 ? ' is' : 's are'} up to date.`);
    return 0;
  }
  try {
    if (writeReadme().changed) console.log('Written: README.md\'s table of Dreamports and the progress maps, with the new numbers.');
  } catch (error) {
    console.log(`README.md's table of Dreamports wasn't written: ${error.message}`);
  }
  return 0;
}

/** A game's port map, from its code and its code map: { original, from, functions, unmatched }. */
export function portMap(game) {
  const original = readOriginal(game);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${game}/proof/ has no code map yet: npm run dp -- codemap ${game} makes one.`);
  const starts = new Set(codeMap.functions.map(f => f.address));
  const spans = [...codeMap.functions].sort((a, b) => a.address - b.address);
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
  const shifts = readShifts(game);
  const functions = new Map(), unmatched = new Map();
  for (const file of codeFiles(gameFolder(game))) {
    const where = relative(gameFolder(game), file).split(sep).join('/');
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const [name, label, digits] of line.matchAll(NAME)) {
        let address = (parseInt(digits, 16) | BASE) & ~1;
        if (address === BASE) continue;
        if (label) address -= shifts.find(s => address >= s.from && address <= s.to)?.by ?? 0;
        const found = starts.has(address);
        if (!found && !inside(address)) continue;
        const list = found ? functions : unmatched, key = found ? address : name;
        if (!list.has(key)) list.set(key, `${where}:${i + 1}`);
      }
    });
  }
  return {
    original: original.sha1,
    from: `The original's functions that games/${game}/ names, found by npm run dp -- portmap`,
    functions: [...functions].sort(([a], [b]) => a - b).map(([address, where]) => [hex(address), where]),
    unmatched: [...unmatched].sort(([a], [b]) => a.localeCompare(b)).map(([name, where]) => [name, where]),
  };
}

// the game's code: every JavaScript file in its folder, but its proof
function codeFiles(folder) {
  const files = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'proof' && entry.name !== 'node_modules') files.push(...codeFiles(path));
    } else if (/\.m?js$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

export function readShifts(game) {
  const file = join(proofFolder(game), 'names.json');
  if (!existsSync(file)) return [];
  const { shifts } = JSON.parse(readFileSync(file, 'utf8'));
  const address = /^[0-9A-F]{8}$/;
  if (!Array.isArray(shifts) || !shifts.every(s => address.test(s?.from) && address.test(s?.to) && Number.isInteger(s?.by))) {
    throw new Error(`games/${game}/proof/names.json needs "shifts": [{ "from", "to", "by" }], with addresses as eight capital hexadecimal digits.`);
  }
  return shifts.map(s => ({ from: parseInt(s.from, 16), to: parseInt(s.to, 16), by: s.by }));
}

// a function or a name to a line
function format({ original, from, functions, unmatched }) {
  const lines = list => list.map(item => '    ' + JSON.stringify(item)).join(',\n');
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(from)},\n  "functions": [\n${lines(functions)}\n  ],\n  "unmatched": [\n${lines(unmatched)}\n  ]\n}\n`;
}
