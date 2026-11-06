// A game's proof files, in games/<game>/proof/, which its versions in other languages share but for their own
// progress.json and port-map.json, in games/<game>/<language>/proof/ (src/lib/languages.mjs):
// - original.json: the copy of the original the proof is measured on, { console, name, title, code, sha1 }, and for a game
//   that chooses its own screen, `screen` (lib/screens.mjs)
// - code-map.json: every function in that copy, its address and size, and nothing of its code
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

/** Every game with proof files and each of its versions in other languages. */
export const proofVersions = () => proofGames().flatMap(game => [game, ...otherVersions(game)]);

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

/** The code map, with each function as { address, size, name }, sorted by address; or null when there's none yet. */
export function readCodeMap(game) {
  const file = join(sharedProofFolder(game), 'code-map.json');
  if (!existsSync(file)) return null;
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const functions = map.functions.map(([address, size, name]) => ({ address: parseInt(address, 16), size, name }));
  functions.sort((a, b) => a.address - b.address);
  return { ...map, functions };
}

/** Writes a code map, a function to a line. */
export function writeCodeMap(game, { original, from, functions }) {
  mkdirSync(sharedProofFolder(game), { recursive: true });
  const lines = functions.map(f => '    ' + JSON.stringify([hex(f.address), f.size, ...(f.name ? [f.name] : [])]));
  writeFileSync(join(sharedProofFolder(game), 'code-map.json'),
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
  mkdirSync(proofFolder(game), { recursive: true });
  writeFileSync(join(proofFolder(game), 'progress.json'), `{\n${[...top, `  "recordings": {\n${entries.join(',\n')}\n  }`].join(',\n')}\n}\n`);
}

/** An address as the code map writes it: eight hexadecimal digits. */
export const hex = address => address.toString(16).toUpperCase().padStart(8, '0');
