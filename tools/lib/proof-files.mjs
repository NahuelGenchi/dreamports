// A game's proof files, in games/<game>/proof/, which its versions in other languages share but for their own
// progress.json and port-map.json, in games/<game>/<language>/proof/ (src/lib/languages.mjs):
// - original.json: the copy of the original the proof is measured on, { console, name, title, code, sha1 }, and for a game
//   that chooses its own screen, `screen` (lib/screens.mjs)
// - code-map.json: every function in that copy, its address and size, and nothing of its code: those in the cartridge,
//   those the game makes in its work RAM, by their address there and their first bytes, and where the game copies
//   the cartridge's code to run it, or has the BIOS unpack it there from the cartridge
// - recordings/<name>.json: recorded play (recording.mjs)
// - progress.json: what prove found, recording by recording, and the % it makes
// - parts.json: the game's parts, each with the recording and frames that prove it once there are some, and its
//   foundations, each piece with what it needs (src/lib/pieces.mjs)

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { REPO, gameFolder, proofFolder, sharedProofFolder } from './paths.mjs';
import { readRecording } from './recording.mjs';
import { nesProgram } from '../nes/functions.mjs';
import { exeReader, ps1Program, readProgram } from '../ps1/functions.mjs';
import { readCartridge } from '../snes/cartridge.mjs';
import { loadCopy, loadedCopy } from '../ps2/ledger.mjs';
import { LANGUAGES, OTHER_LANGUAGES, TRIALS, languageOf, versionName, versionOf } from '../../src/lib/languages.mjs';

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

/** A game's trials, by the tools' names for them, such as '<game>/strict': second versions kept beside its own
 *  while they're tried, which no list of its versions has (src/lib/languages.mjs). */
export const trialsOf = game => Object.keys(TRIALS).filter(trial => existsSync(join(gameFolder(game), TRIALS[trial].folder, 'index.html')))
  .map(trial => versionName(game, trial));

/** Every version whose proofs are kept, and so checked: each game's versions, and its trials. */
export const keptVersions = () => proofGames().flatMap(game => [...versionsOf(game), ...trialsOf(game)]);

// what a version asks of the proof for itself alone, in its own proof/original.json: the work memory to compare
// (lib/memory.mjs), which a version made in the console's memory asks and the game's other versions don't, and
// keysAfterVBlank, as such a version reads its buttons when the original does, a frame apart from the others
const OWN = ['workMemory', 'keysAfterVBlank'];
function ownOriginal(version) {
  const file = join(proofFolder(version), 'original.json');
  if (versionOf(version).language === 'js' || !existsSync(file)) return {};
  const own = JSON.parse(readFileSync(file, 'utf8'));
  const other = Object.keys(own).find(key => !OWN.includes(key));
  if (other) throw new Error(`games/${version}/proof/original.json says "${other}", which is the game's to say, in games/${versionOf(version).game}/proof/original.json: a version's own says only ${OWN.map(key => `"${key}"`).join(', ')}.`);
  return own;
}

/** The copy of the original a game's proof uses, with what the version asks for itself alone. */
export function readOriginal(game) {
  const { game: base, language } = versionOf(game);
  const file = join(sharedProofFolder(game), 'original.json');
  if (!existsSync(join(REPO, 'games', base))) throw new Error(`There's no game called "${base}" in games/.`);
  if (language !== 'js' && !existsSync(join(gameFolder(game), 'index.html'))) {
    throw new Error(`${base} has no version in ${languageOf(language).name} yet: npm run dp -- new ${game} starts one.`);
  }
  if (!existsSync(file)) throw new Error(`games/${base}/proof/original.json is missing: it names the copy of the original the proof uses (tools/README.md).`);
  const original = { ...JSON.parse(readFileSync(file, 'utf8')), ...ownOriginal(game) };
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
    const recording = readRecording(file);
    // a save is a player's own, and nothing of one goes in a commit (docs/REPORTS.md)
    if (recording.saves) throw new Error(`${file} starts from a save, which only a player's report does: it stays in .dreamports/reports/, where npm run dp -- reports plays it.`);
    return { name, file, ...recording };
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
 *  cartridge, size, packed, from }]; or null when there's none yet. A function's key is how the proof files count it: its address,
 *  as eight hexadecimal digits, and for one the game makes in its work RAM, a slash and its first 8 bytes, as 16 more,
 *  `bytes`, since a game can put other code at the same address at another time. A copy is a stretch of the
 *  cartridge's code the game copies into its work RAM to run there, which counts as the cartridge's functions. One
 *  with `packed` is code the game has the BIOS unpack from the cartridge, 'lz77' or 'rl' (gba/unpack.mjs): the bytes
 *  it makes from `cartridge`, `from` bytes in (0 when it's left out), which the game may copy on to run elsewhere. Its
 *  functions are the game's own, made in its work RAM, and the copy says where their bytes come from. */
export function readCodeMap(game) {
  const file = join(sharedProofFolder(game), 'code-map.json');
  if (!existsSync(file)) return null;
  // with the console it's a map of, which says how its instructions are counted (lib/played.mjs)
  const original = join(sharedProofFolder(game), 'original.json');
  return { ...parseCodeMap(JSON.parse(readFileSync(file, 'utf8'))), ...(existsSync(original) ? { console: JSON.parse(readFileSync(original, 'utf8')).console } : {}) };
}

// a key's parts: the address, the first bytes of a function made in RAM, the program it's in when a game has several,
// as a PlayStation 2 disc does, and ~vu for a vector unit's program (ps2/functions.mjs)
const KEY = /^([0-9A-F]{8})(?:\/([0-9A-F]{16}))?(?:@(.+?))?(~vu)?$/;

/** A code map's JSON, read as readCodeMap gives it. A function in another program than the one the game boots has its
 *  `program`, and a vector unit's program `vu`. */
export function parseCodeMap(map) {
  const functions = map.functions.map(([key, size, name]) => {
    const [, , bytes, program, vu] = KEY.exec(key) ?? [];
    return { key, address: parseInt(key, 16), size, name, ...(bytes ? { bytes } : {}), ...(program ? { program } : {}), ...(vu ? { vu: true } : {}) };
  });
  functions.sort((a, b) => a.address - b.address || a.key.localeCompare(b.key));
  // the processor's mode each function starts in, on a console whose instructions' lengths depend on it, the Super
  // Nintendo's (snes/65816.mjs)
  if (map.modes) for (const f of functions) if (map.modes[f.key]) f.mode = map.modes[f.key];
  const copies = (map.copies ?? []).map(([ram, cartridge, size, packed, from]) => ({ ram: parseInt(ram, 16), cartridge: parseInt(cartridge, 16), size, ...(packed ? { packed } : {}), ...(from ? { from } : {}) }));
  return { ...map, functions, copies };
}

/** A function's key in the proof files: its address, and for one the game makes in its work RAM, its first bytes, for
 *  one in another program, @ and the program, and for a vector unit's, ~vu. */
export const functionKey = f => hex(f.address) + (f.bytes ? `/${f.bytes}` : '') + (f.program ? `@${f.program}` : '') + (f.vu ? '~vu' : '');

/** Whether a function is one of the code the game boots runs where its address says: not one it makes in RAM, nor
 *  another program's, nor a vector unit's. */
export const inBootProgram = f => !f.bytes && !f.program && !f.vu;

/** Writes a code map, a function to a line, and the copies after. */
export function writeCodeMap(game, map) {
  mkdirSync(sharedProofFolder(game), { recursive: true });
  writeFileSync(join(sharedProofFolder(game), 'code-map.json'), formatCodeMap(map));
}

/** A code map's text, as writeCodeMap writes it, with the mode each function starts in where the finder knows it, after
 *  the functions, as `modes`, a function's key to its mode, and for a Super Nintendo game how its cartridge is laid
 *  out, `layout` (snes/cartridge.mjs, layoutOf), which says where an address a game's code names is in the ROM, and
 *  for a Nintendo 64 game where its code loads, `layout.load`, eight hexadecimal digits (n64/functions.mjs). */
export function formatCodeMap({ original, from, functions, copies = [], layout = null }) {
  const lines = functions.map(f => '    ' + JSON.stringify([functionKey(f), f.size, ...(f.name ? [f.name] : [])]));
  const copied = copies.map(c => '    ' + JSON.stringify([hex(c.ram), hex(c.cartridge), c.size, ...(c.packed ? [c.packed, ...(c.from ? [c.from] : [])] : [])]));
  const modes = functions.filter(f => f.mode).map(f => `    ${JSON.stringify(functionKey(f))}: ${JSON.stringify(f.mode)}`);
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(from)},\n  "functions": [\n${lines.join(',\n')}\n  ]${copies.length ? `,\n  "copies": [\n${copied.join(',\n')}\n  ]` : ''}${modes.length ? `,\n  "modes": {\n${modes.join(',\n')}\n  }` : ''}${layout ? `,\n  "layout": ${JSON.stringify(layout)}` : ''}\n}\n`;
}

// 16 hexadecimal digits, the bytes in order, as two little-endian words
const wordsOf = text => [0, 8].map(at => [0, 2, 4, 6].reduce((word, i) => word | parseInt(text.slice(at + i, at + i + 2), 16) << (i * 4), 0) >>> 0);
/** 8 bytes as a key writes them. */
export const bytesText = bytes => Array.from(bytes.subarray(0, 8), b => b.toString(16).toUpperCase().padStart(2, '0')).join('');

/** A copy's bytes at an address of a code map, read from the file only when asked: a Game Boy Advance's cartridge
 *  starts at 0x08000000, and with `console` 'nes' the address is a place in the NES program, past the file's header
 *  (nes/functions.mjs), and with 'snes' a place in the Super Nintendo cartridge's ROM (snes/cartridge.mjs). Its `copy()`
 *  gives the whole file. With 'ps2' the address is where the EE runs the program the
 *  disc boots, `disc` is the copy's path, whose sectors are its content, and `code(f)` what a function of the code map
 *  is made of, on whichever processor and in whichever program of the disc, once prepareCopy has read it (ps2/ledger.mjs).
 *  With 'ps1' the address is where the program the disc boots is loaded, and `copy()` gives that program, a PS-X EXE,
 *  once prepareCopy has read it, or at once for a copy that is one. */
export function cartridgeOf(path, console = 'gba') {
  let bytes = null, program = null;
  const copy = () => (bytes ??= readFileSync(path));
  if (console === 'ps2') return Object.assign((address, count) => (program ??= loadedCopy(path).read)(address, count), { copy, disc: path, code: f => loadedCopy(path).codeOf(f), modules: () => loadedCopy(path).modules });
  if (console === 'ps1') {
    const exe = () => readProgram(path) ?? (() => { throw new Error(`The tools haven't read the program ${path} boots yet: lib/proof-files.mjs's prepareCopy reads it first.`); })();
    return Object.assign((address, count) => (program ??= exeReader(exe()))(address, count), { copy: exe });
  }
  const read = console === 'nes'
    ? (address, count) => (program ??= nesProgram(copy()).prg).subarray(address, address + count)
    : console === 'snes'
      ? (address, count) => (program ??= readCartridge(copy()).rom).subarray(address, address + count)
      : (address, count) => copy().subarray(address - 0x08000000, address - 0x08000000 + count);
  return Object.assign(read, { copy });
}

/** Reads what a copy's console needs read at once before cartridgeOf can give its bytes: a PlayStation 2's program
 *  and its disc's sectors, read from the disc a few sectors at a time (ps2/ledger.mjs), and the program a PlayStation
 *  disc boots. Nothing for another console. */
export async function prepareCopy(path, console) {
  if (console === 'ps2') await loadCopy(path);
  if (console === 'ps1') await ps1Program(path);
}

/** Where the code map's functions run, for the program that plays the original (lib/run-reference.mjs): each at its
 *  address, those the game makes in RAM only with their bytes there, and each cartridge function a copy holds where the
 *  copy runs, with its bytes, so it counts when the copy is there. `cartridge(address, bytes)` reads the copy's bytes. */
export function watchesOf(codeMap, cartridge) {
  // on the PlayStation 2, the functions of the program the disc boots alone: another program's, a module's and a vector
  // unit's are at addresses of their own, and count from what ran where their bytes are (lib/played.mjs)
  const watches = codeMap.functions.map((f, index) => ({ address: f.address, size: f.size, index, ...(f.bytes ? { bytes: wordsOf(f.bytes) } : {}) })).filter((_, index) => !codeMap.functions[index].program && !codeMap.functions[index].vu);
  for (const copy of codeMap.copies ?? []) {
    if (copy.packed) continue;
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
