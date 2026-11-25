// A game's parts as the tasks of a version made a function at a time (#1871): which of the original's functions run
// in each part, kept in games/<game>/proof/part-functions.json:
//
// {
//   "original": the copy's SHA-1,
//   "from": who writes it,
//   "parts": {
//     "The main menu": ["080001C4", "0800024C"]
//   }
// }
//
// A part's line is every function of the code map the original ran in the part's frames of its recording
// (parts.json) and in the frame after each, which a frame needs run to match the original's work memory (#1899),
// whether or not a Dreamport matched them, as it's the original's side alone. Only `prove` writes it,
// as it plays the original, on a computer with the game's copy, and a part it didn't play then keeps its line.
//
// With the file, a version that keeps its proofs (lib/proofs.mjs) has its parts for tasks, in the order parts.json
// lists them, the order a player meets them. Each part's task has the functions it runs that no part before it has,
// so a function is proven once, in the first part that needs it. A part is done when each of those has its proof and
// the part is proven by its recording, its frames the same as the original's. A part with no line yet has no
// recording of the original, and its task starts with making one. Once every part has its line, the functions no
// part runs come after, in groups that sit together in the code map (groupsOf), as in a version with no such file.
// The game's foundations get no task: what a foundation is made of is in the first part that runs it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sharedProofFolder } from './paths.mjs';
import { readParts } from './proof-files.mjs';
import { beyondProof, groupsOf } from './proofs.mjs';
import { layoutOf, playedIn, startedIn } from './played.mjs';
import { versionOf } from '../../src/lib/languages.mjs';

export const PART_FUNCTIONS = 'part-functions.json';
const FROM = 'The functions the original runs in each part\'s frames, as npm run dp -- prove found them: nothing else writes one';
const KEY = /^[0-9A-F]{8}(?:[/@~][\x21-\x7e]{1,80})?$/;

const fileOf = game => join(sharedProofFolder(game), PART_FUNCTIONS);

/** A part-functions.json's text read: { original, parts }, `parts` a Map of each part's name to its functions' keys.
 *  Throws on one that isn't as `prove` writes it. */
export function parsePartFunctions(text, where = PART_FUNCTIONS) {
  const wrong = () => new Error(`${where} isn't as npm run dp -- prove writes it: only it writes which functions a part runs, so take your change out and run it again.`);
  let found;
  try { found = JSON.parse(text); } catch { throw wrong(); }
  const lists = found?.parts;
  if (typeof found?.original !== 'string' || !lists || typeof lists !== 'object' || Array.isArray(lists)) throw wrong();
  const good = list => Array.isArray(list) && list.every((key, at) => typeof key === 'string' && KEY.test(key) && (at === 0 || list[at - 1] < key));
  if (!Object.values(lists).every(good)) throw wrong();
  return { original: found.original, parts: new Map(Object.entries(lists)) };
}

/** The game's part-functions.json, { original, parts }, or null when it has none: its tasks then aren't its parts. */
export function readPartFunctions(game) {
  const file = fileOf(game);
  return existsSync(file) ? parsePartFunctions(readFileSync(file, 'utf8'), `games/${game}/proof/${PART_FUNCTIONS}`) : null;
}

/** A part-functions.json's text, a part to a line, in the order `names` gives, each part's functions in order. */
export function formatPartFunctions({ original, parts }, names = [...parts.keys()]) {
  const lines = names.filter(name => parts.has(name)).map(name => `    ${JSON.stringify(name)}: ${JSON.stringify([...new Set(parts.get(name))].sort())}`);
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(FROM)},\n  "parts": {${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}}\n}\n`;
}

/** Starts a game's part-functions.json, with no part in it: from then on the tasks of its version that keeps its
 *  proofs are its parts. Answers whether it wrote the file, which it never writes over. */
export function startPartFunctions(game, original) {
  const file = fileOf(game);
  if (existsSync(file)) return false;
  writeFileSync(file, formatPartFunctions({ original, parts: new Map() }));
  return true;
}

/**
 * Keeps what `prove` found each part runs: `found` a Map of a part's name to its functions' keys, for the parts it
 * played now. A part it didn't play keeps its line, one parts.json no longer lists loses it, and a file of another
 * copy starts again. Writes nothing when the text would be the same. Answers whether it wrote. `prove` calls it only
 * for a game that has the file, which `npm run dp -- proofs <version> --parts` starts.
 */
export function keepPartFunctions(game, original, found, names = readParts(game).map(part => part.name)) {
  const file = fileOf(game), before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const kept = before === null ? null : parsePartFunctions(before, `games/${game}/proof/${PART_FUNCTIONS}`);
  const parts = new Map(kept?.original === original ? kept.parts : []);
  for (const [name, keys] of found) parts.set(name, keys);
  const text = formatPartFunctions({ original, parts }, names);
  if (text === before) return false;
  writeFileSync(file, text);
  return true;
}

/**
 * What the original ran in each part of a recording whose program says what ran and in which frames, and not which
 * functions started in each frame, as the one that links several consoles does (gba/linked.mjs, #1919): for each of
 * `parts`, those of the game that name the recording, with their `frames`, [its name, the keys of the code map's
 * functions whose first instruction ran, on any console, in one of the part's frames or in the frame after one], as
 * `prove` keeps it for a recording one console plays (#1899). `records` is what ran, as lib/played.mjs reads it, with
 * the page's frame f the original's own frame f, `frames` how many the recording has, and `find` finderOf's.
 */
export function partsRanIn(parts, frames, codeMap, records, find) {
  const layout = layoutOf(codeMap);
  return parts.map(({ name, frames: [a, b] }) => {
    const inPart = new Uint8Array(frames + 1);
    for (let frame = Math.max(0, a); frame <= b && frame < frames; frame++) inPart[frame] = inPart[frame + 1] = 1;
    return [name, startedIn(playedIn(records, inPart, layout, find), codeMap).sort()];
  });
}

/**
 * The tasks that are a game's parts, from its `parts` (parts.json's), what each runs (`ran`, a Map by name, as
 * readPartFunctions gives) and its code map: [{ name, part: true, recorded, first, functions }] in the parts' order,
 * `functions` those of the code map a proof can be given of that the part runs and no part before it does, `first`
 * the first one's key, or null with none, and `recorded` whether the part has its line. After them, once every
 * part has its line, the groups of the functions no part runs, as groupsOf gives them.
 */
export function partGroups(parts, ran, codeMap) {
  const byKey = new Map(codeMap.functions.map(f => [f.key, f]));
  const taken = new Set();
  const groups = parts.map(({ name }) => {
    const keys = ran.get(name);
    const functions = (keys ?? []).map(key => byKey.get(key)).filter(f => f && !beyondProof(codeMap, f) && !taken.has(f.key));
    for (const f of functions) taken.add(f.key);
    return { name, part: true, recorded: Boolean(keys), first: functions[0]?.key ?? null, functions };
  });
  if (!groups.every(group => group.recorded)) return groups;
  return [...groups, ...groupsOf({ ...codeMap, functions: codeMap.functions.filter(f => !taken.has(f.key)) })];
}

/**
 * A version's tasks, for one that keeps its proofs: its game's parts, each with the functions it runs, where the game
 * keeps them (partGroups), and otherwise the groups of its code map's functions (groupsOf). `proven` says whether a
 * part of that name is proven by its recording in this version, for `left`.
 */
export function tasksOf(version, codeMap, { parts = readParts(versionOf(version).game), kept = readPartFunctions(versionOf(version).game) } = {}) {
  return kept && parts.length ? partGroups(parts, kept.parts, codeMap) : groupsOf(codeMap);
}

/**
 * What a task still needs, as a word, or null when it's done: for a part, 'recording' while the original's play of
 * it isn't kept, 'functions' while one of its functions has no proof, and 'frames' while its recording doesn't match
 * the original on every frame of the part (`played`, the names of the parts this version has proven, or null where
 * nobody asked, which then isn't looked at). For a group of functions, 'functions' or null. `states` is each
 * function's state by its key (stateOf).
 */
export function leftOf(group, states, played = null) {
  if (group.part && !group.recorded) return 'recording';
  if (group.functions.some(f => !states.get(f.key)?.kind)) return 'functions';
  return group.part && played && !played.has(group.name) ? 'frames' : null;
}
