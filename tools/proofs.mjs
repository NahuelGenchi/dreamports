// npm run dp -- proofs [<version>] [<function or task>] [--start] [--check] [--task <function or task>]: where each
// function of a version stands, for a version made a function at a time (lib/proofs.mjs): whether it has a twin, and
// whether the twin has its proof, by the same bytes or the same memory (docs/STANDARD.md#twins-and-their-proof). It
// reads the version's proof/proofs.json, which only `match` and `twin` write, against the code as it is now, so a
// proof of a twin that has changed since, or that has a stop in it, doesn't count.
//
// With a version alone it prints how many functions have each proof, and the version's tasks, each a group of
// functions that sit together in the code map, with how many of its functions are proven. With a function's address
// or a task's name, as 0x080001C4 or "Functions 080001C4 to 0800024C", it prints that task's functions, each with
// its twin and where it stands.
//
//   --start   starts a version's proofs, with none in it: from then on the version is made a function at a time,
//             its tasks are groups of functions, and `find` and `ready` go by each function's proof. It writes over
//             nothing. A game's lead decides this for a game that has tasks already, as it changes what they are.
//   --check   changes nothing and fails when a line of a proofs.json doesn't hold any more, which `npm run check`
//             uses for every version that keeps one: a twin that changed since its proof, a twin with a stop, or a
//             function the code map or the code no longer has. On a computer with the game's copy it also compares
//             the original's bytes. `match` and `twin` put a line right by proving its function again.
//   --task    with --check, also fails unless every function of that task has its proof, which is how `ready`
//             says a task is done.

import { hex, proofVersions, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { asksForProofs, countsOf, groupNamed, groupsOf, KINDS, PROOFS, readProofs, startProofs, stateOf, stateText } from './lib/proofs.mjs';
import { versionOf } from '../src/lib/languages.mjs';

const USAGE = 'Usage: npm run dp -- proofs [<version>] [<function or task>] [--start] [--check] [--task <function or task>]';
const count = n => n.toLocaleString('en');
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

export async function run(args) {
  const rest = [];
  let task = null;
  const start = args.includes('--start'), check = args.includes('--check');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task') {
      task = args[++i];
      if (!task) throw new Error(`--task needs a function's address or a task's name.\n${USAGE}`);
    } else if (!['--start', '--check'].includes(args[i])) {
      if (args[i].startsWith('--')) throw new Error(`proofs has no ${args[i]}.\n${USAGE}`);
      rest.push(args[i]);
    }
  }
  const [version, named] = rest;
  if (rest.length > 2 || ((start || task || named) && !version)) throw new Error(USAGE);
  if (start) return begin(version);
  if (check) return checkAll(version ? [version] : proofVersions().filter(asksForProofs), task);
  if (!version) {
    const keeping = proofVersions().filter(asksForProofs);
    if (!keeping.length) console.log('No version keeps its proofs yet: each is made a part at a time. npm run dp -- proofs <version> --start starts one\'s.');
    for (const each of keeping) console.log(`${each}: ${summary(countsOf(stateOf(each)))}`);
    return 0;
  }
  const { states, groups } = read(version);
  if (named) {
    const group = groupNamed(groups, named);
    if (!group) throw new Error(`No task of ${version} goes by "${named}": name one as npm run dp -- proofs ${version} lists them, or the address of one of its functions.`);
    show(version, group, states);
    return 0;
  }
  console.log(`${version}: ${summary(countsOf([...states.values()]))}\n`);
  const width = Math.max(...groups.map(group => group.name.length));
  for (const group of groups) {
    const proven = group.functions.filter(f => states.get(f.key).kind).length;
    console.log(`  ${group.name.padEnd(width)}  ${proven === group.functions.length ? 'proven' : `${count(proven)} of ${count(group.functions.length)} proven`}`);
  }
  const inMemory = [...states.values()].filter(state => state.inMemory).length;
  if (inMemory) console.log(`\n${plural(inMemory, 'function')} the game makes in its work memory ${inMemory === 1 ? 'is' : 'are'} in no task: neither proof reaches one yet.`);
  console.log(`\nnpm run dp -- proofs ${version} <a task's first address> lists a task's functions, each with its twin and its proof.`);
  return 0;
}

// a version's functions by key, and its tasks
function read(version) {
  const { game } = versionOf(version), codeMap = readCodeMap(version);
  if (!codeMap) throw new Error(`games/${game}/proof/ has no code map yet: npm run dp -- codemap ${game} makes one.`);
  if (!asksForProofs(version)) throw new Error(`${version} keeps no proofs: it's made a part at a time, and its tasks are its parts (npm run dp -- find ${game}). npm run dp -- proofs ${version} --start makes it a version made a function at a time, which is its lead's to decide.`);
  return { codeMap, states: new Map(stateOf(version, { codeMap }).map(state => [state.key, state])), groups: groupsOf(codeMap) };
}

const summary = counts => `${count(counts.bytes + counts.memory)} of ${plural(counts.functions, 'function')} proven, ${count(counts.bytes)} by ${KINDS.bytes} and ${count(counts.memory)} by ${KINDS.memory}`;

/** A task's functions as lines, each with its size, its twin and where it stands. */
export function groupLines(group, states) {
  return group.functions.map(f => {
    const state = states.get(f.key), twin = state.twin ? `${state.twin.name}, ${state.twin.file}:${state.twin.line}: ` : '';
    return `  0x${hex(f.address)}  ${String(f.size).padStart(5)} bytes  ${f.name ? `${f.name}, ` : ''}${twin}${stateText(state)}`;
  });
}

function show(version, group, states) {
  const proven = group.functions.filter(f => states.get(f.key).kind).length;
  console.log(`${group.name} of ${version}, ${plural(group.functions.length, 'function')}, ${count(proven)} proven:`);
  for (const line of groupLines(group, states)) console.log(line);
}

function begin(version) {
  const { game, language } = versionOf(version), original = readOriginal(version);
  if (language !== 'c') throw new Error(`A function's proof is of a twin in C: name the game's version in C, such as ${game}/c.`);
  if (!['gba', 'nes'].includes(original.console)) throw new Error('The tools prove a function on the Game Boy Advance and the NES, and on no other console yet (docs/CONSOLES.md).');
  if (!readCodeMap(version)) throw new Error(`games/${game}/proof/ has no code map yet, and its functions are the tasks: npm run dp -- codemap ${game} makes one.`);
  console.log(startProofs(version)
    ? `Written: games/${version}/proof/${PROOFS}, with no proof in it yet. ${version} is made a function at a time from here on: npm run dp -- tasks ${version} opens its tasks from its code map, and npm run dp -- match and npm run dp -- twin keep each proof they find.`
    : `games/${version}/proof/${PROOFS} is there already, and was left as it is.`);
  return 0;
}

// --check: every line of each version's proofs.json still holds, and with a task, each of its functions is proven
function checkAll(versions, task) {
  const wrong = [];
  for (const version of versions) {
    if (!asksForProofs(version)) throw new Error(`${version} keeps no proofs: it's made a part at a time.`);
    const { states, groups } = read(version), kept = readProofs(version);
    if (kept.original !== readOriginal(version).sha1) wrong.push(`games/${version}/proof/${PROOFS} is of another copy than original.json names.`);
    for (const key of kept.functions.keys()) {
      const state = states.get(key);
      if (!state) wrong.push(`${version}: ${key} has a proof and isn't a function of the code map.`);
      else if (state.why) wrong.push(`${version}: ${key}${state.twin ? `, ${state.twin.name} in ${state.twin.file},` : ''} is kept as proven and ${state.why === 'no twin' ? 'has no twin any more' : state.why === 'stop' ? 'has a stop in its twin' : state.why === 'twin changed' ? 'its twin, or a header of its file, changed since' : 'the copy has other bytes there'}.`);
    }
    if (task) {
      const group = groupNamed(groups, task);
      if (!group) throw new Error(`No task of ${version} goes by "${task}".`);
      const left = group.functions.filter(f => !states.get(f.key).kind);
      console.log(`${group.name}: ${left.length ? `${count(left.length)} of its ${plural(group.functions.length, 'function')} ${left.length === 1 ? 'has' : 'have'} no proof yet` : `each of its ${plural(group.functions.length, 'function')} has its proof`}.`);
      for (const line of groupLines({ functions: left }, states)) console.log(line);
      if (left.length) wrong.push(`${version}: ${group.name} isn't done until each of its functions has its proof.`);
    }
  }
  if (wrong.length) {
    throw new Error(`${wrong.join('\n')}\nOnly npm run dp -- match <version> <function> and npm run dp -- twin <version> <function> write a proof: run them again on what changed.`);
  }
  if (!task) console.log(versions.length ? `Every proof kept still holds, in ${plural(versions.length, 'version')}.` : 'No version keeps its proofs yet.');
  return 0;
}
