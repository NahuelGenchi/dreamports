// A version's proofs, function by function (docs/STANDARD.md#twins-and-their-proof): which of the original's
// functions has a twin that was proven, and by which of the two proofs. They're kept in
// games/<version>/proof/proofs.json:
//
// {
//   "original": the copy's SHA-1,
//   "from": who writes it,
//   "functions": [
//     ["080001C4", "bytes", "1f0c…", "9a3e…"],
//     ["0800024C", "memory", "77b2…", "c41d…", 2000],
//     ["08000300", "memory", "5e0a…", "d27c…", 40000, [[1, 20000], [2, 20000]]]
//   ]
// }
//
// A line is a function of the code map by its key, the kind of proof, "bytes" when `npm run dp -- match` found its
// twin comes out as the original's bytes and "memory" when `npm run dp -- twin` found it leaves the same memory, a
// mark of the twin as it was written then, a mark of the original's function as the copy had it, and for "memory"
// how many calls were compared, and, for one whose calls took every path only over several runs of the check, each
// run's seed and calls (#1768). Only those two tools write a line, and only for a twin with no stop in it. A mark is
// the start of a SHA-1: the twin's of its own code, of what its file holds outside every function, and of the game's
// own headers the file includes, without their comments, and the original's of its bytes. So a proof goes stale by
// itself: once the twin's code changes, or a line of its file outside the functions, or a header of its file, or the
// code map gives the function other bytes, its line no longer counts, and the tool has to prove it again. The
// original's mark is taken the way the console's code is laid out. A Super Nintendo function's is of its bytes in the
// ROM with the processor's mode it starts in, as the code map says it, and the address its code runs at, bank and all
// (snes/functions.mjs, addressOf): the same bytes read in another mode are other instructions, and run from another
// bank they call and push other addresses. A Nintendo 64 function's is of its bytes in the cartridge, where the code
// the cartridge starts has them, with the address the game's boot code loads that code at (n64/functions.mjs,
// programOf): its jumps and calls are absolute, so the same bytes loaded elsewhere go elsewhere.
//
// A function `match` found different can still start as the original's does: "starts" lists each such one, its key,
// the two marks, and how many of its first bytes are the same, `["08012D4C", "1f0c…", "9a3e…", 64]`. It's no proof of
// the function, and nothing counts it as one: it says only that the function's start, where the console's compiler
// saves registers and takes its frame, is the original's, which the console's stack goes by (gba/stack.mjs). Only
// `match` writes it, and the list is left out while it's empty.
//
// The file is also how a version says it's made this way, a function at a time: with it, the version's tasks are
// groups of functions from its code map (groupsOf), `find` and `ready` go by each function's proof, and a Dreamport
// isn't done while a function has none. `npm run dp -- proofs <version> --start` writes an empty one, and a version
// without the file is made a part at a time, as before, and nothing here touches it.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { proofFolder, REPO } from './paths.mjs';
import { cartridgeOf, functionKey, hex, inBootProgram, readCodeMap, readOriginal } from './proof-files.mjs';
import { copyWith } from './copies.mjs';
import { versionTwins } from './twins.mjs';
import { codeOf, piecesIn, throughOf } from '../gba/match.mjs';
import { contractsIn } from '../nes/twin.mjs';
import { cartOfLayout, mapOf, placeIn, readCartridge, ROM } from '../snes/cartridge.mjs';
import { addressOf as snesAddressOf } from '../snes/functions.mjs';
import { contractsIn as gbContractsIn } from '../gbc/twin.mjs';
import { n64Cartridge, programOf as n64ProgramOf } from '../n64/functions.mjs';
import { portMap } from '../portmap.mjs';
import { keptPiece, keptProgram } from '../ps2/original-program.mjs';
import { exeReader, keptProgram as keptPs1Program, readProgram } from '../ps1/functions.mjs';
import { stoppedFunctions } from '../../src/lib/entries.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';

export const PROOFS = 'proofs.json';
/** The consoles whose functions' proofs the tools keep, so a version on one can be made a function at a time, and a
 *  new game on one is (tasks.mjs, #1864). */
export const KEEPS_PROOFS = ['gba', 'nes', 'snes', 'n64', 'gb', 'gbc', 'ps1', 'ps2', 'psp'];
/** The two proofs, by what a line calls each, with how people say it. */
export const KINDS = { bytes: 'the same bytes', memory: 'the same memory' };
const FROM = 'Each function\'s proof, as npm run dp -- match and npm run dp -- twin found it: nothing else writes one';
const MARK = /^[0-9a-f]{16}$/;

// how a group of functions is cut from the code map: at most this many, this much code, and never over this much
// of the cartridge that isn't a function, which is the game's data
const MOST_FUNCTIONS = 12, MOST_BYTES = 2048, WIDEST_GAP = 0x400;

// where the console starts a Game Boy game
const GB_START = 0x0100;
// where a Game Boy Advance cartridge starts, and where its code does, after its header
const GBA_CARTRIDGE = 0x08000000, GBA_AFTER_HEADER = 0x080000C0;

/**
 * Why neither proof reaches a function of a code map yet, or null for one a proof can be given of: 'memory' for one
 * the game makes in its work memory, and 'start' for a cartridge's start. On the Game Boy Advance that is the jump at
 * the cartridge's first address, which is part of its header, and the code right after the header that it goes to:
 * they run once, before any function is called, and never come back, so no call of them can be compared, and they
 * aren't C the console's compiler built. In a Dreamport that work is the kit's. A PlayStation 2 function of another
 * program of the disc, a module for its second processor or another for the EE, and a vector unit's program each
 * have their proof by `twin` (ps2/twin.mjs). On the Super Nintendo it's 'reset' for the function the console starts
 * the cartridge at, its reset vector's: it sets the game up and goes round its main loop, and never comes back, so no
 * call of it can be compared with a twin's, and it's the frames of play that say a Dreamport does what it does. On
 * the Nintendo 64 it's the function the cartridge's boot code jumps to, at the address the code loads at, which never
 * comes back either. The code map says where each is (`layout`), so a computer with no copy of the game knows.
 */
export function beyondProof(codeMap, f) {
  if (f.bytes) return 'memory';
  if (codeMap.console === 'snes') return codeMap.layout && f.address === snesReset(codeMap.layout) ? 'reset' : null;
  // and on the Nintendo 64, the function at the address the code loads at, where the boot code jumps to
  if (codeMap.console === 'n64') return /^[0-9A-F]{8}$/.test(codeMap.layout?.load ?? '') && f.address === parseInt(codeMap.layout.load, 16) ? 'reset' : null;
  // a Game Boy game starts at $0100 and never comes back from there
  if ((codeMap.console === 'gb' || codeMap.console === 'gbc') && f.address === GB_START) return 'start';
  const starts = codeMap.console === 'gba' && codeMap.functions.some(each => each.address === GBA_CARTRIDGE && each.size === 4);
  return starts && (f.address === GBA_CARTRIDGE || f.address === GBA_AFTER_HEADER) ? 'start' : null;
}

// where a Super Nintendo cartridge's reset vector is in its ROM, by its layout as a code map keeps it
const resets = new WeakMap();
function snesReset(layout) {
  if (!resets.has(layout)) {
    const cart = cartOfLayout(layout), { what, at } = placeIn(mapOf(cart), cart.reset);
    resets.set(layout, what === ROM ? at : null);
  }
  return resets.get(layout);
}

/** A mark of some text or bytes: the first 16 digits of its SHA-1. */
export const markOf = what => createHash('sha1').update(what).digest('hex').slice(0, 16);

/** Where a version keeps its proofs. */
export const proofsFile = version => join(proofFolder(version), PROOFS);

/** Whether a version is made a function at a time: it keeps its proofs. */
export const asksForProofs = version => existsSync(proofsFile(version));

/** A proofs.json's JSON read: { original, functions }, `functions` a Map of each key to { kind, twin, original, calls,
 *  runs }, `runs` for a proof over several runs, each [seed, calls]. Throws, saying what's wrong `where`, when it
 *  isn't one. */
export function parseProofs(found, where = PROOFS) {
  const lines = found?.functions;
  const good = line => Array.isArray(line) && /^[0-9A-F]{8}(?:\/[0-9A-F]{16})?(?:@[^~]+)?(?:~vu)?$/.test(line[0]) && Object.hasOwn(KINDS, line[1]) && MARK.test(line[2]) && MARK.test(line[3])
    && (line[1] === 'memory' ? (line.length === 5 || (line.length === 6 && goodRuns(line[5], line[4]))) && Number.isInteger(line[4]) && line[4] > 0 : line.length === 4);
  if (!found || typeof found.original !== 'string' || !Array.isArray(lines) || !lines.every(good)) {
    throw new Error(`${where} isn't as npm run dp -- match and npm run dp -- twin write it: only they write a function's proof, so take your changes to it back and run them again.`);
  }
  const functions = new Map(lines.map(([key, kind, twin, original, calls, runs]) => [key, { kind, twin, original, ...(calls ? { calls } : {}), ...(runs ? { runs } : {}) }]));
  if (functions.size !== lines.length) throw new Error(`${where} lists a function twice: only npm run dp -- match and npm run dp -- twin write it.`);
  const started = found.starts ?? [];
  const goodStart = line => Array.isArray(line) && line.length === 4 && /^[0-9A-F]{8}$/.test(line[0]) && MARK.test(line[1]) && MARK.test(line[2]) && Number.isInteger(line[3]) && line[3] > 0;
  if (!Array.isArray(started) || !started.every(goodStart)) throw new Error(`${where} isn't as npm run dp -- match writes it: only it writes which functions start as the original's do, so take your changes to it back and run it again.`);
  const starts = new Map(started.map(([key, twin, original, bytes]) => [key, { twin, original, bytes }]));
  return { original: found.original, functions, ...(starts.size ? { starts } : {}) };
}

// the runs a proof by the same memory over several of them says: two or more, each [seed, calls], no seed twice, as
// the same seed makes the same calls again, adding up to its calls
const goodRuns = (runs, calls) => Array.isArray(runs) && runs.length > 1
  && runs.every(run => Array.isArray(run) && run.length === 2 && Number.isInteger(run[0]) && run[0] >= 0 && Number.isInteger(run[1]) && run[1] > 0)
  && new Set(runs.map(([seed]) => seed)).size === runs.length && runs.reduce((sum, [, each]) => sum + each, 0) === calls;

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
export function formatProofs({ original, functions, starts = new Map() }) {
  const lines = [...functions].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { kind, twin, original: theirs, calls, runs }]) => `    ${JSON.stringify([key, kind, twin, theirs, ...(kind === 'memory' ? [calls, ...(runs ? [runs] : [])] : [])])}`);
  const started = [...starts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, { twin, original: theirs, bytes }]) => `    ${JSON.stringify([key, twin, theirs, bytes])}`);
  const after = started.length ? `,\n  "starts": [\n${started.join(',\n')}\n  ]` : '';
  return `{\n  "original": ${JSON.stringify(original)},\n  "from": ${JSON.stringify(FROM)},\n  "functions": [${lines.length ? `\n${lines.join(',\n')}\n  ` : ''}]${after}\n}\n`;
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
 * beside it, whose words are part of what's marked (nes/twin.mjs); on the Super Nintendo what a contract calls, the
 * contract's words and the C function's code both marked, at the place in the ROM the address in its label is, as
 * the code map says the cartridge is laid out (snes/contracts.mjs). A function the game makes in its work memory has
 * no twin here, as neither proof reaches one yet.
 */
export function twinMarks(version, codeMap = readCodeMap(version)) {
  if (!codeMap || writtenIn(versionOf(version).language) !== 'c') return new Map();
  return marksIn(codeMap, versionTwins(version));
}

/** The same, of a version's `folder`, its `files` of C and what each defines, `twinsOf`, and for a file of a shared
 *  library its twins' addresses, `givenOf`, as versionTwins gives them, with `read(path)` for a file's text, or null,
 *  when the files aren't the computer's own. A library's file is named as the repository has it, kit/... */
export function marksIn(codeMap, { folder, files, twinsOf, givenOf = () => null, read = onDisk }) {
  const marks = new Map();
  const folders = [join(folder, 'src'), folder].filter(path => read !== onDisk || existsSync(path));
  // a function by where it is: its address in the program the game boots, and its whole key in another program or a
  // vector unit's (../gba/match.mjs, keyIn)
  const keyAt = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [inBootProgram(f) ? f.address : f.key, f.key]));
  const inFolder = file => (givenOf(file) ? relative(REPO, file) : relative(folder, file)).split(sep).join('/');
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
  if (codeMap.console === 'nes' || codeMap.console === 'gb' || codeMap.console === 'gbc') {
    const banks = Math.floor(Math.max(...codeMap.functions.map(f => f.address)) / 0x4000) + 1;
    // a twin with a contract beside it, as each of these consoles' check reads them (nes/twin.mjs, gbc/twin.mjs)
    const read_ = codeMap.console === 'nes' ? (text, file) => contractsIn(text, banks, givenOf(file)) : text => gbContractsIn(text, banks);
    for (const file of files) {
      const defined = new Map(twinsOf.get(file).map(twin => [twin.name, twin]));
      for (const contract of read_(read(file) ?? '', file).contracts) {
        const twin = defined.get(/^[A-Za-z_]\w*/.exec(contract.call)?.[0]);
        if (twin) keep(contract.offset, twin, file, `${contract.text}\n`);
      }
    }
    return marks;
  }
  if (codeMap.console === 'snes') {
    const map = mapOf(cartOfLayout(codeMap.layout));
    for (const file of files) {
      const defined = new Map(piecesIn(read(file) ?? '', [], null, 'snes').functions.map(written => [written.name, written]));
      for (const twin of twinsOf.get(file)) {
        const { what, at } = placeIn(map, twin.address), written = defined.get(twin.name);
        if (what === ROM && written) keep(at, { name: twin.name, line: written.line, code: written.code }, file, `${twin.code}\n`);
      }
    }
    return marks;
  }
  for (const file of files) {
    for (const twin of twinsOf.get(file)) {
      if (twin.keyed) keep(functionKey(twin.keyed), twin, file);
      if (twin.address === null) continue;
      // how a hand-written routine takes and gives is part of what its twin is, as an NES twin's contract is (#1710)
      const more = twin.registers ? `${twin.registers.text}\n` : '';
      keep(twin.address, twin, file, more);
      // a twin of a run (gba/match.mjs, throughOf) is the twin of each function of it
      const through = throughOf(twin, codeMap.functions);
      if (through) for (const f of codeMap.functions) if (inBootProgram(f) && f.address > twin.address && f.address <= through) keep(f.address, twin, file, more);
    }
  }
  return marks;
}

/** What reads the original's functions for their marks, from the copy this computer knows, or null without one:
 *  `mark(f)` of a function of the code map. A PlayStation 2 game's are read from the program its disc boots, as a
 *  tool that read it off the disc kept it on this computer (../ps2/original-program.mjs). */
export function originalMarks(version, codeMap = readCodeMap(version)) {
  const original = readOriginal(version), copy = copyWith(original.sha1);
  if (!copy || !existsSync(copy.path)) return null;
  if ((codeMap?.console ?? original.console) === 'ps2') {
    const read = keptProgram(original.sha1);
    // another program's, or a vector unit's, is somewhere else on the disc: its bytes are kept by its key once the
    // function check has read it, and until then nothing is known of it, which is null
    return read && (f => (f.program || f.vu ? (keptPiece(original.sha1, f.key) ? markOf(keptPiece(original.sha1, f.key)) : null) : markOf(read(f.address, f.size))));
  }
  // a PlayStation game's, from the program its disc boots, as match and twin keep it on this computer as they read it,
  // and until one has nothing is known of it
  if ((codeMap?.console ?? original.console) === 'ps1') {
    const exe = readProgram(copy.path) ?? keptPs1Program(original.sha1);
    return exe && (read => f => markOf(read(f.address, f.size)))(exeReader(exe));
  }
  // a Nintendo 64 function's, from the code the cartridge starts, in the console's byte order whatever order the
  // copy's in, with where it loads; null for one outside that code, of which nothing is known
  if ((codeMap?.console ?? original.console) === 'n64') {
    let program = null;
    return f => {
      const { load, text } = program ??= n64ProgramOf(n64Cartridge(copy.path)), at = f.address - load;
      return at < 0 || at + f.size > text.length ? null : markOf(Buffer.concat([Buffer.from(`${load.toString(16).toUpperCase().padStart(8, '0')}\n`), text.subarray(at, at + f.size)]));
    };
  }
  const cartridge = cartridgeOf(copy.path, codeMap?.console ?? original.console);
  // a Super Nintendo function's, with the mode it starts in and the address its code runs at, as the top of this
  // file says
  if ((codeMap?.console ?? original.console) === 'snes') {
    let cart = null;
    const runsAt = f => snesAddressOf(f.address, cart ??= readCartridge(cartridge.copy())).toString(16).toUpperCase().padStart(6, '0');
    return f => markOf(Buffer.concat([Buffer.from(`${f.mode ?? ''} ${runsAt(f)}\n`), cartridge(f.address, f.size)]));
  }
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
    const why = !twin ? 'no twin' : stopped.has(f.key) ? 'stop' : !line ? 'unproven' : line.twin !== twin.mark ? 'twin changed' : mark && mark(f) !== null && line.original !== mark(f) ? 'original changed' : null;
    return {
      key: f.key, address: f.address, size: f.size, ...(beyondProof(codeMap, f) ? { beyond: beyondProof(codeMap, f) } : {}),
      twin: twin && { name: twin.name, file: twin.file, line: twin.line },
      kind: why ? null : line.kind, why, ...(why || !line.calls ? {} : { calls: line.calls }), ...(why || !line.runs ? {} : { runs: line.runs }),
    };
  });
}

/** How many of a version's functions have each proof and how many have none: { functions, bytes, memory, unproven }. */
export function countsOf(states) {
  const counts = { functions: states.length, bytes: 0, memory: 0, unproven: 0 };
  for (const state of states) counts[state.kind ?? 'unproven']++;
  return counts;
}

// numbers as a sentence lists them: 1, 2 and 3
const listed = numbers => (numbers.length < 2 ? String(numbers[0]) : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`);

/** A function's state in a few words, as the tools and a task say it. */
export function stateText(state) {
  if (state.kind) return `proven by ${KINDS[state.kind]}${state.calls ? `, over ${state.calls.toLocaleString('en')} calls${state.runs ? ` in ${state.runs.length} runs, seeds ${listed(state.runs.map(([seed]) => seed))}` : ''}` : ''}`;
  return {
    'no twin': state.beyond === 'memory' ? 'no twin yet, and the game makes it in its work memory, which no proof reaches yet'
      : state.beyond === 'start' ? 'the cartridge\'s start, which is the kit\'s to do and no proof reaches yet'
        : state.beyond === 'reset' ? 'where the console starts the cartridge, which never comes back, so no proof reaches it yet' : 'no twin yet',
    stop: 'not proven: its twin has a stop, a path marked as left out',
    unproven: 'not proven yet',
    'twin changed': 'not proven: its twin changed since its proof',
    'original changed': 'not proven: its proof is of other bytes than the copy has there',
  }[state.why];
}

/**
 * Keeps what `match` or `twin` found in a version's proofs, for a version that keeps them: `kind` is the tool's
 * proof, `proven` the keys of the functions it found the same, each with `calls` for 'memory', and `runs` for one
 * proven over several runs (each [seed, calls]), and `failed` the
 * keys of those it tried and didn't. A twin with a stop is never kept as proven, whatever the tool found. The same
 * bytes are the stronger proof, so a line that says them stays when `twin` finds the same memory too, and a line of
 * the other kind stays when this tool's own proof fails, as it's still what it says. A line whose twin has gone,
 * or isn't in the code map, goes. Answers null for a version that keeps none, or
 * { kept, stopped, already, changed }: the keys newly kept, those left out for a stop, those the stronger proof has
 * already, and whether the file was written.
 */
export function keepProofs(version, { kind, proven = [], failed = [], starts = null }) {
  const proofs = readProofs(version);
  if (!proofs) return null;
  const codeMap = readCodeMap(version), original = readOriginal(version);
  const mark = originalMarks(version, codeMap);
  if (!mark) throw new Error(`A proof is of ${original.name} as your copy has it. Show the tools your copy first: npm run dp -- rom <file>.`);
  const { functions, result } = withProofs(proofs.functions, {
    kind, proven, failed, functions: codeMap.functions, marks: twinMarks(version, codeMap), stopped: stoppedFunctions(portMap(version)), mark,
  });
  // which functions start as the original's do: `match` says so of each one it found different (`starts`, each
  // { key, bytes }), and one lasts while its twin and the original are as they were and no proof by bytes has it
  const marks = twinMarks(version, codeMap), byKey = new Map(codeMap.functions.map(f => [f.key, f]));
  const started = new Map(proofs.starts ?? []);
  if (kind === 'bytes') for (const key of [...proven.map(f => f.key), ...failed]) started.delete(key);
  for (const { key, bytes } of starts ?? []) if (bytes > 0 && byKey.has(key) && marks.has(key)) started.set(key, { twin: marks.get(key).mark, original: mark(byKey.get(key)), bytes });
  for (const [key, line] of started) {
    if (!byKey.has(key) || marks.get(key)?.mark !== line.twin || mark(byKey.get(key)) !== line.original || functions.get(key)?.kind === 'bytes') started.delete(key);
  }
  const text = formatProofs({ original: original.sha1, functions, starts: started });
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
  const holds = key => functions.has(key) && functions.get(key).twin === marks.get(key).mark && [null, functions.get(key).original].includes(mark(byKey.get(key)));
  const result = { kept: [], stopped: [], already: [] };
  for (const { key, calls, runs } of proven) {
    if (!byKey.has(key) || !marks.has(key) || mark(byKey.get(key)) === null) continue;
    if (stopped.has(key)) {
      result.stopped.push(key);
      functions.delete(key);
    } else if (kind === 'memory' && functions.get(key)?.kind === 'bytes' && holds(key)) result.already.push(key);
    else {
      functions.set(key, { kind, twin: marks.get(key).mark, original: mark(byKey.get(key)), ...(kind === 'memory' ? { calls, ...(runs ? { runs } : {}) } : {}) });
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

// the program of a PlayStation 2 disc a function is in, the one the disc boots being none, and a vector unit's apart
const program = f => `${f.program ?? ''}${f.vu ? '~vu' : ''}`;

/** Some of a code map's functions in the order a task lists them: a PlayStation 2 disc's programs one after another,
 *  the one it boots first, as each one's addresses are its own, and each program's in the code map's order. */
export function inProgramOrder(codeMap, functions) {
  const place = new Map(codeMap.functions.map((f, n) => [f.key, n]));
  return [...functions].sort((a, b) => (program(a) < program(b) ? -1 : program(a) > program(b) ? 1 : place.get(a.key) - place.get(b.key)));
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
  const bank = f => (['nes', 'gb', 'gbc'].includes(codeMap.console) ? Math.floor(f.address / 0x4000) : 0);
  for (const f of inProgramOrder(codeMap, codeMap.functions.filter(f => !beyondProof(codeMap, f)))) {
    const last = group?.at(-1);
    if (!group || group.length >= MOST_FUNCTIONS || bytes + f.size > MOST_BYTES || f.address - (last.address + last.size) > WIDEST_GAP || bank(f) !== bank(last) || program(f) !== program(last)) {
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
  const whole = String(named).trim().replace(/^Task:\s*/i, '').toLowerCase(), said = whole.replace(/\s+in\s+\w+$/i, '');
  const byName = groups.find(group => group.name.toLowerCase() === whole) ?? groups.find(group => group.name.toLowerCase() === said);
  if (byName) return byName;
  const digits = /^(?:0x|\$)?([0-9a-f]{4,8})$/i.exec(String(named).trim())?.[1] ?? /^functions? ([0-9a-f]{8})(?: to [0-9a-f]{8})?$/.exec(said)?.[1];
  if (!digits) return null;
  const address = parseInt(digits, 16);
  return groups.find(group => group.functions.some(f => inBootProgram(f) && address >= f.address && address < f.address + f.size)) ?? null;
}

/** A function's address as people read it: 0x080001C4. */
export const addressText = f => `0x${hex(f.address)}`;

/** Whether every function of a version's group has its proof, from its states by key. */
export const groupProven = (group, states) => group.functions.every(f => states.get(f.key)?.kind);
