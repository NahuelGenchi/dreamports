// A game's proof files, in games/<game>/proof/:
// - original.json: the copy of the original the proof is measured on, { console, name, title, code, sha1 }
// - code-map.json: every function in that copy, its address and size, and nothing of its code
// - recordings/<name>.json: recorded play (recording.mjs)
// - progress.json: what prove found, recording by recording, and the % it makes
// - parts.json: the game's parts, each with the recording and frames that prove it once there are some

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { REPO, proofFolder } from './paths.mjs';
import { readRecording } from './recording.mjs';

/** The games that have proof files. */
export function proofGames() {
  const games = join(REPO, 'games');
  if (!existsSync(games)) return [];
  return readdirSync(games, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(games, d.name, 'proof', 'original.json')))
    .map(d => d.name);
}

/** The copy of the original a game's proof uses. */
export function readOriginal(game) {
  const file = join(proofFolder(game), 'original.json');
  if (!existsSync(join(REPO, 'games', game))) throw new Error(`There's no game called "${game}" in games/.`);
  if (!existsSync(file)) throw new Error(`games/${game}/proof/original.json is missing: it names the copy of the original the proof uses (tools/README.md).`);
  const original = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['console', 'name', 'title', 'code', 'sha1']) {
    if (typeof original[key] !== 'string') throw new Error(`games/${game}/proof/original.json needs "${key}".`);
  }
  return original;
}

/** A game's recordings, all of them or those named, each { name, file, ...recording }. */
export function readRecordings(game, names = []) {
  const folder = join(proofFolder(game), 'recordings');
  const all = existsSync(folder) ? readdirSync(folder).filter(f => f.endsWith('.json')).map(f => basename(f, '.json')).sort() : [];
  for (const name of names) {
    if (!all.includes(name)) throw new Error(`games/${game}/proof/recordings/ has no recording called "${name}"${all.length ? `: it has ${all.join(', ')}` : ''}.`);
  }
  return (names.length ? names : all).map(name => {
    const file = join(folder, `${name}.json`);
    return { name, file, ...readRecording(file) };
  });
}

/** The game's parts, as parts.json lists them, or none when there's no parts.json yet. */
export function readParts(game) {
  const file = join(proofFolder(game), 'parts.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).parts ?? [] : [];
}

/** The code map, with each function as { address, size, name }, sorted by address; or null when there's none yet. */
export function readCodeMap(game) {
  const file = join(proofFolder(game), 'code-map.json');
  if (!existsSync(file)) return null;
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const functions = map.functions.map(([address, size, name]) => ({ address: parseInt(address, 16), size, name }));
  functions.sort((a, b) => a.address - b.address);
  return { ...map, functions };
}

/** Writes a code map, a function to a line. */
export function writeCodeMap(game, { original, from, functions }) {
  mkdirSync(proofFolder(game), { recursive: true });
  const lines = functions.map(f => '    ' + JSON.stringify([hex(f.address), f.size, ...(f.name ? [f.name] : [])]));
  writeFileSync(join(proofFolder(game), 'code-map.json'),
    `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(from)},\n  "functions": [\n${lines.join(',\n')}\n  ]\n}\n`);
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
  writeFileSync(join(proofFolder(game), 'progress.json'), `{\n${[...top, `  "recordings": {\n${entries.join(',\n')}\n  }`].join(',\n')}\n}\n`);
}

/** An address as the code map writes it: eight hexadecimal digits. */
export const hex = address => address.toString(16).toUpperCase().padStart(8, '0');
