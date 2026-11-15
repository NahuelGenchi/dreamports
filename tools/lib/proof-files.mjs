// A game's proof files, in games/<game>/proof/, which its versions in other languages share but for their own
// progress.json and port-map.json, in games/<game>/<language>/proof/ (src/lib/languages.mjs):
// - original.json: the copy of the original the proof is measured on, { console, name, title, code, sha1 }, and for a game
//   that chooses its own screen, `screen` (lib/screens.mjs)
// - code-map.json: every function in that copy, its address and size, and nothing of its code: those in the cartridge,
//   those the game makes in its work RAM, by their address there and their first bytes, and where the game copies
//   the cartridge's code to run it
// - recordings/<name>.json: recorded play (recording.mjs)
// - progress.json: what prove found, recording by recording, and the % it makes
// - parts.json: the game's parts, each with the recording and frames that prove it once there are some, and its
//   foundations, each piece with what it needs (src/lib/pieces.mjs)

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { REPO, gameFolder, proofFolder, sharedProofFolder } from './paths.mjs';
import { readRecording } from './recording.mjs';
import { LANGUAGES, OTHER_LANGUAGES, versionName, versionOf } from '../../src/lib/languages.mjs';

/** The games that have proof files. */
export function proofGames() {
  const games = join(REPO, 'games');
  if (!existsSync(games)) return [];
  return readdirSync(games, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(games, d.name, 'proof', 'original.json')))
    .map(d => d.name);
}

/** A game's versions in other languages than JavaScript, by the tools' names for them, such as 'sonic-battle/c':
 *  those whose folder has a page. */
export const otherVersions = game => OTHER_LANGUAGES.filter(language => existsSync(join(gameFolder(game), LANGUAGES[language].folder, 'index.html')))
  .map(language => versionName(game, language));

/** Every version of a game, by the tools' names for them, its main one first (src/lib/languages.mjs): its JavaScript
 *  one, games/<game>/, when that has a page, or when nothing has one yet, as in a game that's only mapped, and each
 *  in another language whose folder has a page, so a game that started in C is only 'game/c'. */
export function versionsOf(game) {
  const others = otherVersions(game);
  return existsSync(join(gameFolder(game), 'index.html')) || !others.length ? [game, ...others] : others;
}

/** A game's main version: its JavaScript one, or the first in another language when it has none, as 'game/c'. */
export const mainVersion = game => versionsOf(game)[0];

/** Every game with proof files and each of its versions. */
export const proofVersions = () => proofGames().flatMap(versionsOf);

/** The copy of the original a game's proof uses. */
export function readOriginal(game) {
  const { game: base, language } = versionOf(game);
  const file = join(sharedProofFolder(game), 'original.json');
  if (!existsSync(join(REPO, 'games', base))) throw new Error(`There's no game called "${base}" in games/.`);
  if (language !== 'js' && !existsSync(join(gameFolder(game), 'index.html'))) {
    throw new Error(`${base} has no version in ${LANGUAGES[language].name} yet: npm run dp -- new ${game} starts one.`);
  }
  if (!existsSync(file)) throw new Error(`games/${base}/proof/original.json is missing: it names the copy of the original the proof uses (tools/README.md).`);
  const original = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['console', 'name', 'title', 'code', 'sha1']) {
    if (typeof original[key] !== 'string') throw new Error(`games/${base}/proof/original.json needs "${key}".`);
  }
  return original;
}

/** A game's recordings, all of them or those named, each { name, file, ...recording }. */
export function readRecordings(game, names = []) {
  const folder = join(sharedProofFolder(game), 'recordings');
  const all = existsSync(folder) ? readdirSync(folder).filter(f => f.endsWith('.json')).map(f => basename(f, '.json')).sort() : [];
  for (const name of names) {
    if (!all.includes(name)) throw new Error(`games/${versionOf(game).game}/proof/recordings/ has no recording called "${name}"${all.length ? `: it has ${all.join(', ')}` : ''}.`);
  }
  return (names.length ? names : all).map(name => {
    const file = join(folder, `${name}.json`);
    return { name, file, ...readRecording(file) };
  });
}

/** The game's parts.json as it is, with its parts and its foundations, or {} when there's none yet. */
export function readPartsFile(game) {
  const file = join(sharedProofFolder(game), 'parts.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** The game's parts, as parts.json lists them, or none when there's no parts.json yet. */
export const readParts = game => readPartsFile(game).parts ?? [];

/** The code map, with each function as { key, address, size, name, bytes }, sorted by address, and `copies` [{ ram,
 *  cartridge, size }]; or null when there's none yet. A function's key is how the proof files count it: its address,
 *  as eight hexadecimal digits, and for one the game makes in its work RAM, a slash and its first 8 bytes, as 16 more,
 *  `bytes`, since a game can put other code at the same address at another time. A copy is a stretch of the
 *  cartridge's code the game copies into its work RAM to run there, which counts as the cartridge's functions. */
export function readCodeMap(game) {
  const file = join(sharedProofFolder(game), 'code-map.json');
  return existsSync(file) ? parseCodeMap(JSON.parse(readFileSync(file, 'utf8'))) : null;
}

/** A code map's JSON, read as readCodeMap gives it. */
export function parseCodeMap(map) {
  const functions = map.functions.map(([key, size, name]) => ({ key, address: parseInt(key, 16), size, name, ...(key.includes('/') ? { bytes: key.split('/')[1] } : {}) }));
  functions.sort((a, b) => a.address - b.address || a.key.localeCompare(b.key));
  const copies = (map.copies ?? []).map(([ram, cartridge, size]) => ({ ram: parseInt(ram, 16), cartridge: parseInt(cartridge, 16), size }));
  return { ...map, functions, copies };
}

/** A function's key in the proof files: its address, and for one the game makes in its work RAM, its first bytes. */
export const functionKey = f => hex(f.address) + (f.bytes ? `/${f.bytes}` : '');

/** Writes a code map, a function to a line, and the copies after. */
export function writeCodeMap(game, map) {
  mkdirSync(sharedProofFolder(game), { recursive: true });
  writeFileSync(join(sharedProofFolder(game), 'code-map.json'), formatCodeMap(map));
}

/** A code map's text, as writeCodeMap writes it. */
export function formatCodeMap({ original, from, functions, copies = [] }) {
  const lines = functions.map(f => '    ' + JSON.stringify([functionKey(f), f.size, ...(f.name ? [f.name] : [])]));
  const copied = copies.map(c => '    ' + JSON.stringify([hex(c.ram), hex(c.cartridge), c.size]));
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(from)},\n  "functions": [\n${lines.join(',\n')}\n  ]${copies.length ? `,\n  "copies": [\n${copied.join(',\n')}\n  ]` : ''}\n}\n`;
}

// 16 hexadecimal digits, the bytes in order, as two little-endian words
const wordsOf = text => [0, 8].map(at => [0, 2, 4, 6].reduce((word, i) => word | parseInt(text.slice(at + i, at + i + 2), 16) << (i * 4), 0) >>> 0);
/** 8 bytes as a key writes them. */
export const bytesText = bytes => Array.from(bytes.subarray(0, 8), b => b.toString(16).toUpperCase().padStart(2, '0')).join('');

/** A copy's bytes at a cartridge address, read from the file only when asked: the code map's copies are a Game Boy
 *  Advance's, whose cartridge starts at 0x08000000, the only console whose code that runs the tools see yet. */
export function cartridgeOf(path) {
  let bytes = null;
  return (address, count) => {
    bytes ??= readFileSync(path);
    return bytes.subarray(address - 0x08000000, address - 0x08000000 + count);
  };
}

/** Where the code map's functions run, for the program that plays the original (lib/run-reference.mjs): each at its
 *  address, those the game makes in RAM only with their bytes there, and each cartridge function a copy holds where the
 *  copy runs, with its bytes, so it counts when the copy is there. `cartridge(address, bytes)` reads the copy's bytes. */
export function watchesOf(codeMap, cartridge) {
  const watches = codeMap.functions.map((f, index) => ({ address: f.address, size: f.size, index, ...(f.bytes ? { bytes: wordsOf(f.bytes) } : {}) }));
  for (const copy of codeMap.copies ?? []) {
    codeMap.functions.forEach((f, index) => {
      if (f.bytes || f.address < copy.cartridge || f.address >= copy.cartridge + copy.size) return;
      const at = f.address - copy.cartridge;
      watches.push({ address: copy.ram + at, size: Math.min(f.size, copy.size - at), index, bytes: wordsOf(bytesText(cartridge(f.address, 8))) });
    });
  }
  return watches;
}

/** What prove found so far, or a new record. */
export function readProgress(game) {
  const file = join(proofFolder(game), 'progress.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { recordings: {} };
}

/** Writes what prove found: each recording's results on a few lines, its functions on one. */
export function writeProgress(game, progress) {
  const { recordings, ...totals } = progress;
  const entries = Object.entries(recordings).sort(([a], [b]) => a.localeCompare(b)).map(([name, r]) => {
    const fields = Object.entries(r).map(([key, value]) => `      ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
    return `    ${JSON.stringify(name)}: {\n${fields.join(',\n')}\n    }`;
  });
  const top = Object.entries(totals).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  mkdirSync(proofFolder(game), { recursive: true });
  writeFileSync(join(proofFolder(game), 'progress.json'), `{\n${[...top, `  "recordings": {\n${entries.join(',\n')}\n  }`].join(',\n')}\n}\n`);
}

/** An address as the code map writes it: eight hexadecimal digits. */
export const hex = address => address.toString(16).toUpperCase().padStart(8, '0');
