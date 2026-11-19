// A step that only proves functions has nothing to show in a clip while its game has no recording: nothing of the
// game plays yet, so there's no frame to compare and no whole proof to record (lib/clips.mjs, lib/same-proof.mjs).
// In a game made a function at a time (lib/proofs.mjs) its functions' proofs stand in for the clip
// (docs/STANDARD.md#clips). This says when they do, from the files alone, with no copy of the game: `share` asks it of
// the commit it shares, and the pull request's check asks it again of what would merge (tools/clips-check.mjs).
//
// They stand in when the game has no recording, on main or in the step, and everything the step changes of the
// version's code is covered by a proof:
//
// - every function it adds or changes is a twin whose line in proofs.json is of the code as it is, with no stop;
// - every line of proofs.json still holds, so nothing proven went stale;
// - outside its functions, it changes a file freely only when every function built with that file is such a twin, as
//   their proofs are of the file too: a .c file that holds nothing else, or a header only such files include;
// - in any other file, such as a header the game's own main.c includes, it only adds: a declaration, or a #define of
//   a name the game's code on main never uses. Neither can change what code already there does;
// - it takes nothing out but a twin that is proven in another file, and changes no file of the code that isn't C.
//
// Code that is no twin has no proof, so a step that adds or changes any is refused here and shows a clip instead,
// which takes a recording that plays it: the game's glue is shown working, never taken on trust.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REPO, gameFolder } from './paths.mjs';
import { hex, readCodeMap } from './proof-files.mjs';
import { asksForProofs, headersOf, KINDS, marksIn, originalMarks, PROOFS, readProofs, stateOf } from './proofs.mjs';
import { librariesFile } from './libraries.mjs';
import { codeOf, piecesIn } from '../gba/match.mjs';
import { codeFiles, portMap, readShifts } from '../portmap.mjs';
import { stoppedFunctions } from '../../src/lib/entries.mjs';
import { versionOf } from '../../src/lib/languages.mjs';

const C = /\.[ch]$/;
// a folder no file is in, for the version's files when they're given as texts
const ROOT = '/version';
const count = n => n.toLocaleString('en');

/** What every line for this way says, which tells a text that shows proofs in a clip's place. */
export const NOTHING_PLAYS = 'has no recording yet, so nothing of it plays';

/** A function's line for the pull request: its twin's name, its address and its kind of proof. */
export const proofLine = f => `- \`${f.name}\`, 0x${hex(f.address)}: ${KINDS[f.kind]}${f.calls ? `, over ${count(f.calls)} calls` : ''}`;

/** The lines for the pull request, under Clips, in a clip's place: each function the step adds or changes, with its proof. */
export function proofLines(title, functions) {
  if (!functions.length) return `No clip: ${title} ${NOTHING_PLAYS}, and this step adds or changes no function: only declarations its proven twins are built with.`;
  return [`No clip: ${title} ${NOTHING_PLAYS}, and this step only proves functions. ${functions.length === 1 ? 'The function it adds or changes is a twin' : `Each of the ${count(functions.length)} functions it adds or changes is a twin`}, with its proof in \`${PROOFS}\`:`, '', ...functions.map(proofLine)].join('\n');
}

/** Whether a text shows proofs in a clip's place, as proofLines writes them. */
export const showsProofs = text => String(text).includes(NOTHING_PLAYS);

// why a function that isn't proven isn't, after its name
const WHY = {
  'no twin': 'isn\'t a twin, so no proof is of it',
  stop: 'has a stop in it, a path left out, so it isn\'t proven',
  unproven: `has no line in ${PROOFS}: npm run dp -- match or npm run dp -- twin proves it`,
  'twin changed': `has a line in ${PROOFS} that is of other code: it changed after its proof, or a line of its file outside the functions or a header did, or the line wasn't written by match or twin. Prove it again`,
  'original changed': `has a line in ${PROOFS} that is of other bytes than the copy has there`,
};

/**
 * What a step proves of a version, and what of it no proof covers, from texts alone:
 *   codeMap  the game's code map
 *   before   the version's files of C on main, a Map of each path in its folder, as src/act.c, to its text
 *   after    the same as the step leaves them
 *   others   the paths of the code it changes that aren't C
 *   proofs   its proofs.json as the step leaves it, read (parseProofs), or null
 *   stopped  the keys of the functions with a stop, shifts as the game's labels have them
 *   mark     what marks the original's functions, on a computer with the copy, or null
 *   usedBefore(name)  whether the version's code on main uses a name
 * Answers { functions, problems }: each function the step adds or changes that is a proven twin,
 * { key, address, name, file, kind, calls }, and why its proofs can't stand in for a clip, as sentences, or none.
 */
export function provenStep({ codeMap, before, after, others = [], proofs, stopped = new Set(), shifts = [], mark = null, usedBefore = wordsOf(before) }) {
  if (!proofs) return { functions: [], problems: [`It keeps no ${PROOFS}, so none of its functions has a proof.`] };
  const read = path => after.get(relative(ROOT, path).split(sep).join('/')) ?? null;
  const pieces = new Map([...after].map(([path, text]) => [path, piecesIn(text, shifts)]));
  const sources = [...after.keys()].filter(path => path.endsWith('.c')).sort();
  const marks = marksIn(codeMap, { folder: ROOT, files: sources.map(path => join(ROOT, path)), twinsOf: new Map(sources.map(path => [join(ROOT, path), pieces.get(path).functions])), read });
  const states = new Map(stateOf(null, { codeMap, proofs, marks, stopped, mark }).map(state => [state.key, state]));
  const keyOf = new Map([...marks].map(([key, twin]) => [`${twin.file}\n${twin.name}`, key]));
  const stateIn = (path, name) => states.get(keyOf.get(`${path}\n${name}`)) ?? { why: 'no twin' };
  // the names of the twins that are proven, wherever they are
  const provenNames = new Set([...marks].filter(([key]) => states.get(key)?.kind).map(([, twin]) => twin.name));

  // the headers each file of C is built with, and so which files a proof is of
  const headers = new Map(sources.map(path => [path, [...headersOf(join(ROOT, path), [join(ROOT, 'src'), ROOT], read).keys()].map(header => relative(ROOT, header).split(sep).join('/'))]));
  const allProven = path => {
    const own = pieces.get(path).functions;
    return own.length > 0 && own.every(f => stateIn(path, f.name).kind) && headers.get(path).every(header => !pieces.get(header).functions.length);
  };
  const covered = path => {
    if (path.endsWith('.c')) return allProven(path);
    const built = sources.filter(source => headers.get(source).includes(path));
    return built.length > 0 && !pieces.get(path).functions.length && built.every(allProven);
  };

  const problems = [], functions = [], said = new Set();
  // the functions already said not to be proven, as path and name: what keeps a file from being covered
  const named = new Set();
  const short = text => (text.length > 60 ? `${text.slice(0, 57)}…` : text);
  for (const path of others) problems.push(`${path} isn't C, and a proof is of a twin in C.`);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort().filter(path => (before.get(path) ?? null) !== (after.get(path) ?? null));
  const none = { functions: [], rest: [] };
  const piecesBefore = new Map(paths.map(path => [path, before.has(path) ? piecesIn(before.get(path), shifts) : none]));
  // first the functions: each one added or changed is a proven twin, and none goes but a twin proven elsewhere
  for (const path of paths) {
    const old = piecesBefore.get(path), made = pieces.get(path) ?? none;
    const codeBefore = new Map(old.functions.map(f => [f.name, `${f.address} ${f.code}`]));
    for (const f of made.functions) {
      if (codeBefore.get(f.name) === `${f.address} ${f.code}`) continue;
      const state = stateIn(path, f.name);
      if (state.key) said.add(state.key);
      if (state.kind) functions.push({ key: state.key, address: state.address, name: f.name, file: path, kind: state.kind, ...(state.calls ? { calls: state.calls } : {}) });
      else {
        problems.push(`${f.name}, in ${path}, ${WHY[state.why]}.`);
        named.add(`${path}\n${f.name}`);
      }
    }
    for (const f of old.functions.filter(f => !made.functions.some(each => each.name === f.name) && !provenNames.has(f.name))) problems.push(`${f.name} is taken out of ${path}, and no proof shows the game without it.`);
    // a file that held only functions proven elsewhere now goes with them; one that held anything else isn't covered
    if (!after.has(path) && !old.functions.length) problems.push(`${path} is taken out, and no proof is of what was built with it.`);
  }
  // then every line of proofs.json: nothing that was proven went stale, and none is there that no tool could have written
  for (const key of proofs.functions.keys()) {
    const state = states.get(key);
    if (said.has(key)) continue;
    if (!state) problems.push(`${PROOFS} has a line for ${key}, which isn't a function of the code map.`);
    else if (state.why) {
      problems.push(`${state.twin?.name ?? key}${state.twin ? `, in ${state.twin.file},` : ''} ${WHY[state.why]}.`);
      if (state.twin) named.add(`${state.twin.file}\n${state.twin.name}`);
    }
  }
  // then what the files hold outside their functions
  const unproven = path => [...pieces.get(path).functions.filter(f => !stateIn(path, f.name).kind).map(f => `${path}\n${f.name}`), ...headers.get(path).flatMap(header => pieces.get(header).functions.map(f => `${header}\n${f.name}`))];
  for (const path of paths.filter(each => after.has(each))) {
    if (covered(path)) continue;
    // a file kept from being covered only by functions said above is covered once they're proven: saying so again,
    // line by line, would bury what there is to do
    const built = path.endsWith('.c') ? [path] : sources.filter(source => headers.get(source).includes(path));
    const inWay = [...built.flatMap(unproven), ...(path.endsWith('.c') ? [] : pieces.get(path).functions.map(f => `${path}\n${f.name}`))];
    if (inWay.length && inWay.every(each => named.has(each))) continue;
    // a file that other code is built with too: nothing of it changes or goes, and what's added can't reach that code
    const left = piecesBefore.get(path).rest.map(piece => piece.text);
    const added = [];
    for (const piece of pieces.get(path).rest) {
      const at = left.indexOf(piece.text);
      if (at >= 0) left.splice(at, 1);
      else added.push(piece);
    }
    const whose = path.endsWith('.c') ? 'holds code with no proof' : built.length ? 'is also built into code with no proof' : 'is built into no file of proven twins';
    for (const text of left) problems.push(`${path} ${whose}, and the step changes or takes out a line of it outside its functions: ${short(text)}`);
    for (const piece of added) {
      const name = /^#\s*define\s+([A-Za-z_]\w*)/.exec(piece.text)?.[1];
      if (piece.pre && !name) problems.push(`${path} ${whose}, and the step adds a line for the preprocessor to it, which can change that code: ${short(piece.text)}`);
      else if (piece.pre && usedBefore(name)) problems.push(`${path} ${whose}, and the step defines ${name} in it, a name the game's code on main already uses, so it can change that code.`);
      else if (!piece.pre && /\b(?:__attribute__|__asm__|__asm|asm)\b/.test(piece.text)) problems.push(`${path} ${whose}, and the step adds a declaration that says how something is built: ${short(piece.text)}`);
    }
  }
  return { functions: functions.sort((a, b) => a.address - b.address), problems };
}

// what says whether a version's code uses a name, from its files' texts
function wordsOf(files) {
  const words = new Set([...files.values()].flatMap(text => codeOf(text).match(/[A-Za-z_]\w*/g) ?? []));
  return name => words.has(name);
}

const git = args => {
  const run = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 28 });
  return run.status === 0 ? run.stdout : null;
};

/** How many recordings a commit has of a version's game, the game's own and the version's. */
export function recordingsAt(version, commit) {
  const folders = [...new Set([versionOf(version).game, version])].map(each => `games/${each}/proof/recordings/`);
  return folders.reduce((sum, folder) => sum + (git(['ls-tree', '--name-only', `${commit}:${folder}`]) ?? '').split('\n').filter(name => name.endsWith('.json')).length, 0);
}

/**
 * What the files here prove of a version since the commit `base` of main: { keeps, functions, problems }, as
 * provenStep gives them, with `keeps` whether the version keeps its proofs at all. The step's side is read from the
 * files as they are, which the pull request's check has as what would merge, and `committed` asks that they're the
 * last commit's, as `share` shares a commit.
 */
export function stepProofs(version, base, { committed = false } = {}) {
  if (!asksForProofs(version)) return { keeps: false, functions: [], problems: [] };
  const folder = gameFolder(version), inRepo = `games/${version}/`;
  const problems = [];
  if (committed && (git(['status', '--porcelain', '--', `games/${versionOf(version).game}`]) ?? '').trim()) problems.push(`games/${versionOf(version).game}/ has changes that aren't committed, and its proofs are held to the commit: commit them first.`);
  const codeMap = readCodeMap(version);
  if (!codeMap) return { keeps: true, functions: [], problems: [...problems, `games/${versionOf(version).game}/proof/ has no code map.`] };
  // the twins of a shared library are in the kit, which this reads nothing of yet (lib/libraries.mjs)
  if (existsSync(librariesFile(version))) return { keeps: true, functions: [], problems: [...problems, `${version} takes shared libraries from the kit, and a step's proofs stand in for a clip only for twins in its own folder so far.`] };
  let proofs = null;
  try {
    proofs = readProofs(version);
  } catch (error) {
    return { keeps: true, functions: [], problems: [...problems, error.message] };
  }
  const after = new Map(codeFiles(folder, 'c').map(file => [relative(folder, file).split(sep).join('/'), readFileSync(file, 'utf8')]));
  // main's side: each file of C it has of the version, from git where it isn't the file here
  const onMain = (git(['ls-tree', '-r', '--name-only', base, '--', inRepo]) ?? '').split('\n').filter(path => C.test(path) && !/\/(?:proof|node_modules)\//.test(path));
  const changed = (git(['diff', '--name-only', '--no-renames', base, '--', inRepo]) ?? '').split('\n').filter(Boolean);
  const before = new Map(onMain.map(path => {
    const here = path.slice(inRepo.length);
    return [here, changed.includes(path) || !after.has(here) ? git(['show', `${base}:${path}`]) ?? '' : after.get(here)];
  }));
  const others = changed.filter(path => path.startsWith(`${inRepo}src/`) && !C.test(path));
  try {
    const step = provenStep({ codeMap, before, after, others, proofs, stopped: stoppedFunctions(portMap(version)), shifts: readShifts(version), mark: originalMarks(version, codeMap) });
    return { keeps: true, functions: step.functions, problems: [...problems, ...step.problems] };
  } catch (error) {
    // a version whose files can't be read as the tools read them is covered by nothing, and says why
    return { keeps: true, functions: [], problems: [...problems, error.message] };
  }
}

/**
 * Why a version's proofs can't stand in for a clip of a step, as sentences, or none when they can. `step` is what
 * stepProofs found of it, and `recordings` how many the game has on main and in the step, { main, now }: a game with
 * any shows a clip, or the record of a whole proof (lib/same-proof.mjs). With `text`, the pull request's, each
 * function's line has to be in it, as share wrote it.
 */
export function standProblems(version, step, recordings, text = null) {
  const game = versionOf(version).game;
  if (!step.keeps) return [`${version} keeps no ${PROOFS}: it's made a part at a time, and a function's proof stands in for a clip only in a game made a function at a time.`];
  if (recordings.main || recordings.now) return [`${game} has recordings, so its functions' proofs don't stand in for a clip by themselves: a step that changes no frame shows the record of a whole proof, and one that changes a frame or a recording shows a clip.`];
  if (step.problems.length) return [`Not everything it changes of ${version}'s code is covered by a proof, and code with no proof is shown in a clip, which takes a recording that plays it: ${step.problems.join(' ')}`];
  if (text === null) return [];
  const lines = new Set(String(text).split('\n').map(line => line.trim()));
  const missing = step.functions.map(proofLine).filter(line => !lines.has(line));
  if (!showsProofs(text) || missing.length) return [`The text doesn't name ${missing.length ? `${count(missing.length)} of the functions` : 'what'} the step proves of ${version}, each with its proof: run npm run dp -- share again and paste .dreamports/share/clips.md under Clips as it is.`];
  return [];
}
