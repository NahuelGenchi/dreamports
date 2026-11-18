// A version's proofs, function by function (docs/STANDARD.md#twins-and-their-proof): which of the original's
// functions has a twin that was proven, and by which of the two proofs. They're kept in
// games/<version>/proof/proofs.json:
//
// {
//   "original": the copy's SHA-1,
//   "from": who writes it,
//   "functions": [
//     ["080001C4", "bytes", "1f0c…", "9a3e…"],
//     ["0800024C", "memory", "77b2…", "c41d…", 2000]
//   ]
// }
//
// A line is a function of the code map by its key, the kind of proof, "bytes" when `npm run dp -- match` found its
// twin comes out as the original's bytes and "memory" when `npm run dp -- twin` found it leaves the same memory, a
// mark of the twin as it was written then, a mark of the original's function as the copy had it, and for "memory"
// how many calls were compared. Only those two tools write a line, and only for a twin with no stop in it. A mark is
// the start of a SHA-1: the twin's of its own code, of what its file holds outside every function, and of the game's
// own headers the file includes, without their comments, and the original's of its bytes. So a proof goes stale by
// itself: once the twin's code changes, or a line of its file outside the functions, or a header of its file, or the
// code map gives the function other bytes, its line no longer counts, and the tool has to prove it again.
//
// The file is also how a version says it's made this way, a function at a time: with it, the version's tasks are
// groups of functions from its code map (groupsOf), `find` and `ready` go by each function's proof, and a Dreamport
// isn't done while a function has none. `npm run dp -- proofs <version> --start` writes an empty one, and a version
// without the file is made a part at a time, as before, and nothing here touches it.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { proofFolder } from './paths.mjs';
import { cartridgeOf, hex, readCodeMap, readOriginal } from './proof-files.mjs';
import { copyWith } from './copies.mjs';
import { versionTwins } from './twins.mjs';
import { codeOf, piecesIn } from '../gba/match.mjs';
import { contractsIn } from '../nes/twin.mjs';
import { portMap } from '../portmap.mjs';
import { stoppedFunctions } from '../../src/lib/entries.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';

export const PROOFS = 'proofs.json';
/** The two proofs, by what a line calls each, with how people say it. */
export const KINDS = { bytes: 'the same bytes', memory: 'the same memory' };
const FROM = 'Each function\'s proof, as npm run dp -- match and npm run dp -- twin found it: nothing else writes one';
const MARK = /^[0-9a-f]{16}$/;

// how a group of functions is cut from the code map: at most this many, this much code, and never over this much
// of the cartridge that isn't a function, which is the game's data
const MOST_FUNCTIONS = 12, MOST_BYTES = 2048, WIDEST_GAP = 0x400;

// where a Game Boy Advance cartridge starts, and where its code does, after its header
const GBA_CARTRIDGE = 0x08000000, GBA_AFTER_HEADER = 0x080000C0;

/**
 * Why neither proof reaches a function of a code map yet, or null for one a proof can be given of: 'memory' for one
 * the game makes in its work memory, and 'start' for a cartridge's start. On the Game Boy Advance that is the jump at
 * the cartridge's first address, which is part of its header, and the code right after the header that it goes to:
 * they run once, before any function is called, and never come back, so no call of them can be compared, and they
 * aren't C the console's compiler built. In a Dreamport that work is the kit's. Such a function is in no task, and
 * still counts as not proven.
 */
export function beyondProof(codeMap, f) {
  if (f.bytes) return 'memory';
  const starts = codeMap.console === 'gba' && codeMap.functions.some(each => each.address === GBA_CARTRIDGE && each.size === 4);
  return starts && (f.address === GBA_CARTRIDGE || f.address === GBA_AFTER_HEADER) ? 'start' : null;
}

/** A mark of some text or bytes: the first 16 digits of its SHA-1. */
export const markOf = what => createHash('sha1').update(what).digest('hex').slice(0, 16);

/** Where a version keeps its proofs. */
export const proofsFile = version => join(proofFolder(version), PROOFS);

/** Whether a version is made a function at a time: it keeps its proofs. */
export const asksForProofs = version => existsSync(proofsFile(version));

/** A proofs.json's JSON read: { original, functions }, `functions` a Map of each key to { kind, twin, original, calls }.
 *  Throws, saying what's wrong `where`, when it isn't one. */
export function parseProofs(found, where = PROOFS) {
  const lines = found?.functions;
  const good = line => Array.isArray(line) && /^[0-9A-F]{8}(?:\/[0-9A-F]{16})?$/.test(line[0]) && Object.hasOwn(KINDS, line[1]) && MARK.test(line[2]) && MARK.test(line[3])
    && (line[1] === 'memory' ? line.length === 5 && Number.isInteger(line[4]) && line[4] > 0 : line.length === 4);
  if (!found || typeof found.original !== 'string' || !Array.isArray(lines) || !lines.every(good)) {
    throw new Error(`${where} isn't as npm run dp -- match and npm run dp -- twin write it: only they write a function's proof, so take your changes to it back and run them again.`);
  }
  const functions = new Map(lines.map(([key, kind, twin, original, calls]) => [key, { kind, twin, original, ...(calls ? { calls } : {}) }]));
  if (functions.size !== lines.length) throw new Error(`${where} lists a function twice: only npm run dp -- match and npm run dp -- twin write it.`);
  return { original: found.original, functions };
}

/** A version's proofs as its file has them, or null for a version that keeps none. */
export function readProofs(version) {
  const file = proofsFile(version);
  if (!existsSync(file)) return null;
  const where = `games/${version}/proof/${PROOFS}`;
  let found;
  try {
    found = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${where} can't be read: ${error.message}`);
  }
  return parseProofs(found, where);
}

/** A proofs.json's text, a function to a line, in the code map's order. */
export function formatProofs({ original, functions }) {
  const lines = [...functions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { kind, twin, original: theirs, calls }]) => `    ${JSON.stringify([key, kind, twin, theirs, ...(kind === 'memory' ? [calls] : [])])}`);
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(FROM)},\n  "functions": [${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}]\n}\n`;
}

/** Starts a version's proofs, with none in it: from then on it's made a function at a time. Answers whether it wrote
 *  the file, which it never writes over. */
export function startProofs(version) {
  const file = proofsFile(version);
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, formatProofs({ original: readOriginal(version).sha1, functions: new Map() }));
  return true;
}

// the game's own headers a file of C includes, and those they include, each once, in the order they're met: a name in
// quotes that is beside the file or in one of the version's `folders`. The kit's and the build's aren't the game's
// (`read(path)` gives a file's text, or null when it isn't there: the computer's own files unless something else is given)
export function headersOf(file, folders, read = onDisk, found = new Map()) {
  for (const [, name] of (read(file) ?? '').matchAll(/^[ \t]*#[ \t]*include[ \t]*"([^"\n]+)"/gm)) {
    const header = [dirname(file), ...folders].map(folder => join(folder, name)).find(path => read(path) !== null);
    if (!header || found.has(header)) continue;
    found.set(header, codeOf(read(header)));
    headersOf(header, folders, read, found);
  }
  return found;
}

const onDisk = path => (existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null);

/**
 * Every twin a version in C has, as it's written now: a Map of each function's key in the code map to
 * { name, file, line, mark }, the twin's name, its file in the version's folder, its line and its mark. On the Game
 * Boy Advance a twin is a function whose comment names the original's (lib/twins.mjs); on the NES one with a contract
 * beside it, whose words are part of what's marked (nes/twin.mjs). A function the game makes in its work memory has
 * no twin here, as neither proof reaches one yet.
 */
export function twinMarks(version, codeMap = readCodeMap(version)) {
  if (!codeMap || writtenIn(versionOf(version).language) !== 'c') return new Map();
  return marksIn(codeMap, versionTwins(version));
}

/** The same, of a version's `folder`, its `files` of C and what each defines, `twinsOf`, as versionTwins gives them,
 *  with `read(path)` for a file's text, or null, when the files aren't the computer's own. */
export function marksIn(codeMap, { folder, files, twinsOf, read = onDisk }) {
  const marks = new Map();
  const folders = [join(folder, 'src'), folder].filter(path => read !== onDisk || existsSync(path));
  const keyAt = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [f.address, f.key]));
  const inFolder = file => relative(folder, file).split(sep).join('/');
  // what a twin is built with beside its own code: what its file holds outside every function, and the game's own
  // headers the file includes
  const around = new Map();
  const built = file => {
    if (!around.has(file)) around.set(file, [piecesIn(read(file) ?? '').rest.map(piece => piece.text).join('\n'), ...headersOf(file, folders, read).values()].join('\n'));
    return around.get(file);
  };
  const keep = (address, twin, file, more = '') => {
    const key = keyAt.get(address);
    if (key === undefined || marks.has(key) || !twin.code) return;
    marks.set(key, { name: twin.name, file: inFolder(file), line: twin.line, mark: markOf(`${more}${twin.code}\n${built(file)}`) });
  };
  if (codeMap.console === 'nes') {
    const banks = Math.floor(Math.max(...codeMap.functions.map(f => f.address)) / 0x4000) + 1;
    for (const file of files) {
      const defined = new Map(twinsOf.get(file).map(twin => [twin.name, twin]));
      for (const contract of contractsIn(read(file) ?? '', banks).contracts) {
        const twin = defined.get(/^[A-Za-z_]\w*/.exec(contract.call)?.[0]);
        if (twin) keep(contract.offset, twin, file, `${contract.text}\n`);
      }
    }
    return marks;
  }
  for (const file of files) for (const twin of twinsOf.get(file)) if (twin.address !== null) keep(twin.address, twin, file);
  return marks;
}

/** What reads the original's functions for their marks, from the copy this computer knows, or null without one:
 *  `mark(f)` of a function of the code map. */
export function originalMarks(version, codeMap = readCodeMap(version)) {
  const original = readOriginal(version), copy = copyWith(original.sha1);
  if (!copy || !existsSync(copy.path)) return null;
  const cartridge = cartridgeOf(copy.path, codeMap?.console ?? original.console);
  return f => markOf(cartridge(f.address, f.size));
}

/**
 * Where each function of a version stands, in the code map's order: [{ key, address, size, twin, kind, why, calls }].
 * `twin` is { name, file, line } or null, `kind` 'bytes' or 'memory' for one whose proof holds, and `why` what keeps
 * the others from one: 'no twin', 'stop', its twin has a path marked as left out, 'unproven', 'twin changed' or
 * 'original changed', its proof is of other code than is there now. `beyond` says why no proof reaches a function
 * yet, as beyondProof gives it, for one that none does. With `mark`, what originalMarks gives, the original's side is
 * looked at too, and without it only the twin's, as on a computer with no copy of the game.
 */
export function stateOf(version, { codeMap = readCodeMap(version), proofs = readProofs(version), marks = twinMarks(version, codeMap), stopped = stoppedFunctions(portMap(version)), mark = originalMarks(version, codeMap) } = {}) {
  const kept = proofs?.functions ?? new Map();
  return codeMap.functions.map(f => {
    const twin = marks.get(f.key) ?? null, line = kept.get(f.key);
    const why = !twin ? 'no twin' : stopped.has(f.key) ? 'stop' : !line ? 'unproven' : line.twin !== twin.mark ? 'twin changed' : mark && line.original !== mark(f) ? 'original changed' : null;
    return {
      key: f.key, address: f.address, size: f.size, ...(beyondProof(codeMap, f) ? { beyond: beyondProof(codeMap, f) } : {}),
      twin: twin && { name: twin.name, file: twin.file, line: twin.line },
      kind: why ? null : line.kind, why, ...(why || !line.calls ? {} : { calls: line.calls }),
    };
  });
}

/** How many of a version's functions have each proof and how many have none: { functions, bytes, memory, unproven }. */
export function countsOf(states) {
  const counts = { functions: states.length, bytes: 0, memory: 0, unproven: 0 };
  for (const state of states) counts[state.kind ?? 'unproven']++;
  return counts;
}

/** A function's state in a few words, as the tools and a task say it. */
export function stateText(state) {
  if (state.kind) return `proven by ${KINDS[state.kind]}${state.calls ? `, over ${state.calls.toLocaleString('en')} calls` : ''}`;
  return {
    'no twin': state.beyond === 'memory' ? 'no twin yet, and the game makes it in its work memory, which no proof reaches yet'
      : state.beyond === 'start' ? 'the cartridge\'s start, which is the kit\'s to do and no proof reaches yet' : 'no twin yet',
    stop: 'not proven: its twin has a stop, a path marked as left out',
    unproven: 'not proven yet',
    'twin changed': 'not proven: its twin changed since its proof',
    'original changed': 'not proven: its proof is of other bytes than the copy has there',
  }[state.why];
}

/**
 * Keeps what `match` or `twin` found in a version's proofs, for a version that keeps them: `kind` is the tool's
 * proof, `proven` the keys of the functions it found the same, each with `calls` for 'memory', and `failed` the
 * keys of those it tried and didn't. A twin with a stop is never kept as proven, whatever the tool found. The same
 * bytes are the stronger proof, so a line that says them stays when `twin` finds the same memory too, and a line of
 * the other kind stays when this tool's own proof fails, as it's still what it says. A line whose twin has gone,
 * or isn't in the code map, goes. Answers null for a version that keeps none, or
 * { kept, stopped, already, changed }: the keys newly kept, those left out for a stop, those the stronger proof has
 * already, and whether the file was written.
 */
export function keepProofs(version, { kind, proven = [], failed = [] }) {
  const proofs = readProofs(version);
  if (!proofs) return null;
  const codeMap = readCodeMap(version), original = readOriginal(version);
  const mark = originalMarks(version, codeMap);
  if (!mark) throw new Error(`A proof is of ${original.name} as your copy has it. Show the tools your copy first: npm run dp -- rom <file>.`);
  const { functions, result } = withProofs(proofs.functions, {
    kind, proven, failed, functions: codeMap.functions, marks: twinMarks(version, codeMap), stopped: stoppedFunctions(portMap(version)), mark,
  });
  const text = formatProofs({ original: original.sha1, functions });
  const changed = readFileSync(proofsFile(version), 'utf8') !== text;
  if (changed) writeFileSync(proofsFile(version), text);
  return { ...result, changed };
}

/**
 * What keepProofs keeps, with nothing read or written: `kept` is the lines there are, a Map as readProofs gives,
 * `functions` the code map's, `marks` each twin's as twinMarks gives them, `stopped` the keys of the functions with a
 * stop, and `mark(f)` the original's. Answers { functions, result }, the lines to keep and what was done.
 */
export function withProofs(kept, { kind, proven = [], failed = [], functions: all, marks, stopped, mark }) {
  const byKey = new Map(all.map(f => [f.key, f]));
  const functions = new Map([...kept].filter(([key]) => byKey.has(key) && marks.has(key)));
  const holds = key => functions.has(key) && functions.get(key).twin === marks.get(key).mark && functions.get(key).original === mark(byKey.get(key));
  const result = { kept: [], stopped: [], already: [] };
  for (const { key, calls } of proven) {
    if (!byKey.has(key) || !marks.has(key)) continue;
    if (stopped.has(key)) {
      result.stopped.push(key);
      functions.delete(key);
    } else if (kind === 'memory' && functions.get(key)?.kind === 'bytes' && holds(key)) result.already.push(key);
    else {
      functions.set(key, { kind, twin: marks.get(key).mark, original: mark(byKey.get(key)), ...(kind === 'memory' ? { calls } : {}) });
      result.kept.push(key);
    }
  }
  for (const key of failed) if (functions.has(key) && (functions.get(key).kind === kind || !holds(key))) functions.delete(key);
  return { functions, result };
}

/** What `match` and `twin` say after their totals of what keepProofs did, as lines. */
export function keptText(version, result, kind) {
  if (!result) return [];
  const count = (keys, words) => `${keys.length.toLocaleString('en')} function${keys.length === 1 ? '' : 's'} ${words}`;
  return [
    ...(result.kept.length ? [`${count(result.kept, `kept as proven by ${KINDS[kind]}`)} in games/${version}/proof/${PROOFS}.`] : []),
    ...(result.already.length ? [`${count(result.already, `already proven by ${KINDS.bytes}, the stronger proof, which stays`)}.`] : []),
    ...(result.stopped.length ? [`${count(result.stopped, 'not kept as proven')}: ${result.stopped.join(', ')} ${result.stopped.length === 1 ? 'has a stop in its twin' : 'have a stop in their twins'}, a path marked as left out, and a function isn't proven until every path of it is written (docs/STANDARD.md#stops).`] : []),
  ];
}

/**
 * A version's tasks: the code map's functions that a proof can be given of (beyondProof), in groups that sit together,
 * [{ name, first, functions }], each `functions` those of the map. A group ends after 12 functions or two
 * kilobytes of code, and where more than a kilobyte of the cartridge that isn't a function comes before the next,
 * or, on the NES, another bank. Its name is its first and last function: "Functions 080001C4 to 0800024C".
 */
export function groupsOf(codeMap) {
  const groups = [];
  let group = null, bytes = 0;
  const bank = f => (codeMap.console === 'nes' ? Math.floor(f.address / 0x4000) : 0);
  for (const f of codeMap.functions.filter(f => !beyondProof(codeMap, f))) {
    const last = group?.at(-1);
    if (!group || group.length >= MOST_FUNCTIONS || bytes + f.size > MOST_BYTES || f.address - (last.address + last.size) > WIDEST_GAP || bank(f) !== bank(last)) {
      group = [];
      bytes = 0;
      groups.push(group);
    }
    group.push(f);
    bytes += f.size;
  }
  return groups.map(functions => ({ name: groupName(functions), first: functions[0].key, functions }));
}

const groupName = functions => (functions.length === 1 ? `Function ${functions[0].key}` : `Functions ${functions[0].key} to ${functions.at(-1).key}`);

/** The group someone means by `named`: a task's name or title, as "Functions 080001C4 to 0800024C in C", or the
 *  address of any function in it, as 0x080001C8. A task's name that no group goes by any more, as the code map found
 *  more functions since it was opened and its group ends elsewhere now, means the group its first function is in.
 *  null when none goes by it. */
export function groupNamed(groups, named) {
  const said = String(named).trim().replace(/^Task:\s*/i, '').replace(/\s+in\s+\w+$/i, '').toLowerCase();
  const byName = groups.find(group => group.name.toLowerCase() === said);
  if (byName) return byName;
  const digits = /^(?:0x|\$)?([0-9a-f]{4,8})$/i.exec(String(named).trim())?.[1] ?? /^functions? ([0-9a-f]{8})(?: to [0-9a-f]{8})?$/.exec(said)?.[1];
  if (!digits) return null;
  const address = parseInt(digits, 16);
  return groups.find(group => group.functions.some(f => address >= f.address && address < f.address + f.size)) ?? null;
}

/** A function's address as people read it: 0x080001C4. */
export const addressText = f => `0x${hex(f.address)}`;

/** Whether every function of a version's group has its proof, from its states by key. */
export const groupProven = (group, states) => group.functions.every(f => states.get(f.key)?.kind);
