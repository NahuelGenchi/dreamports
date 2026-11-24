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
//   --parts   makes the game's parts the version's tasks (lib/part-functions.mjs, #1871): it starts the game's
//             proof/part-functions.json, with no part in it, for a version that keeps its proofs, or with --start
//             as well. `prove` then keeps which functions the original runs in each part's frames, a part's task
//             is those no part before it runs, and it's done when each has its proof and the part is proven by its
//             recording. It writes over nothing, and it's the lead's to decide, as --start is.
//   --check   changes nothing and fails when a line of a proofs.json doesn't hold any more, which `npm run check`
//             uses for every version that keeps one: a twin that changed since its proof, a twin with a stop, or a
//             function the code map or the code no longer has. On a computer with the game's copy it also compares
//             the original's bytes. `match` and `twin` put a line right by proving its function again.
//   --task    with --check, also fails unless every function of that task has its proof, which is how `ready`
//             says a task is done.
//   --bytes   sorts every byte of the version's copy (lib/rebuild.mjs, accountOf): proven code, code without a
//             proof, data used in play, data never used, and bytes explained, with how each was told apart, and
//             lists the stretches still unexplained, the biggest first, or every one with --all.
//
// Beside each version's count it prints code ported and gameplay proven, and bytes accounted for: the share of the
// copy's bytes that are proven code, data used in play or explained, on a computer with the copy. That number is the
// tools' own: nothing writes it in a proof file, and the site doesn't show it.

import { cartridgeOf, hex, keptVersions, readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { asksForProofs, countsOf, groupNamed, KEEPS_PROOFS, KINDS, PROOFS, readProofs, startProofs, stateOf, stateText } from './lib/proofs.mjs';
import { accountOf, ACCOUNTED, KINDS as BYTES } from './lib/rebuild.mjs';
import { followsContent, readUnreachable, usedCells } from './lib/played.mjs';
import { copyWith } from './lib/copies.mjs';
import { HEADER } from './gba/header.mjs';
import { readProof } from './readme.mjs';
import { PART_FUNCTIONS, startPartFunctions, tasksOf } from './lib/part-functions.mjs';
import { readParts } from './lib/proof-files.mjs';
import { percentText } from '../src/lib/entries.mjs';
import { versionOf, writtenIn } from '../src/lib/languages.mjs';

const USAGE = 'Usage: npm run dp -- proofs [<version>] [<function or task>] [--start] [--parts] [--check] [--task <function or task>] [--bytes [--all]]';
const count = n => n.toLocaleString('en');
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

export async function run(args) {
  const rest = [];
  let task = null;
  const start = args.includes('--start'), byPart = args.includes('--parts'), check = args.includes('--check'), bytes = args.includes('--bytes'), all = args.includes('--all');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task') {
      task = args[++i];
      if (!task) throw new Error(`--task needs a function's address or a task's name.\n${USAGE}`);
    } else if (!['--start', '--parts', '--check', '--bytes', '--all'].includes(args[i])) {
      if (args[i].startsWith('--')) throw new Error(`proofs has no ${args[i]}.\n${USAGE}`);
      rest.push(args[i]);
    }
  }
  const [version, named] = rest;
  if (rest.length > 2 || ((start || byPart || task || named || bytes) && !version) || (all && !bytes) || (bytes && named)) throw new Error(USAGE);
  if (start || byPart) return (start ? begin(version) : 0) || (byPart ? beginParts(version) : 0);
  if (check) return checkAll(version ? [version] : keptVersions().filter(asksForProofs), task);
  if (!version) {
    const keeping = keptVersions().filter(asksForProofs);
    if (!keeping.length) console.log('No version keeps its proofs yet: each is made a part at a time. npm run dp -- proofs <version> --start starts one\'s.');
    for (const each of keeping) {
      const states = stateOf(each);
      console.log(`${each}: ${summary(countsOf(states))}\n  ${numbers(each, bytesAccounted(each, { states }))}`);
    }
    return 0;
  }
  const { codeMap, states, groups } = read(version);
  if (bytes) return showBytes(version, bytesAccounted(version, { codeMap, states: [...states.values()] }), all);
  if (named) {
    const group = groupNamed(groups, named);
    if (!group) throw new Error(`No task of ${version} goes by "${named}": name one as npm run dp -- proofs ${version} lists them, or the address of one of its functions.`);
    show(version, group, states);
    return 0;
  }
  console.log(`${version}: ${summary(countsOf([...states.values()]))}`);
  console.log(`${numbers(version, bytesAccounted(version, { codeMap, states: [...states.values()] }))}\n`);
  const width = Math.max(...groups.map(group => group.name.length));
  for (const group of groups) {
    const proven = group.functions.filter(f => states.get(f.key).kind).length;
    const stands = group.part && !group.recorded ? 'no recording of the original yet' : proven === group.functions.length ? (group.part ? `each of its ${count(proven)} proven` : 'proven') : `${count(proven)} of ${count(group.functions.length)} proven`;
    console.log(`  ${group.name.padEnd(width)}  ${stands}`);
  }
  const beyond = why => [...states.values()].filter(state => state.beyond === why).length;
  if (beyond('start')) console.log(`\nThe cartridge's start, ${plural(beyond('start'), 'function')}, is in no task: it runs once before any function is called and never comes back, which is the kit's to do in a Dreamport, and neither proof reaches it yet.`);
  if (beyond('reset')) console.log('\nThe function the console starts the cartridge at is in no task: it sets the game up, goes round its main loop and never comes back, so no call of it can be compared, and neither proof reaches it yet.');
  if (beyond('memory')) console.log(`\n${plural(beyond('memory'), 'function')} the game makes in its work memory ${beyond('memory') === 1 ? 'is' : 'are'} in no task: neither proof reaches one yet.`);
  console.log(`\nnpm run dp -- proofs ${version} <a task's first address${groups.some(group => group.part) ? ', or a part\'s name in quotes' : ''}> lists a task's functions, each with its twin and its proof.`);
  return 0;
}

// a version's functions by key, and its tasks
function read(version) {
  const { game } = versionOf(version), codeMap = readCodeMap(version);
  if (!codeMap) throw new Error(`games/${game}/proof/ has no code map yet: npm run dp -- codemap ${game} makes one.`);
  if (!asksForProofs(version)) throw new Error(`${version} keeps no proofs: it's made a part at a time, and its tasks are its parts (npm run dp -- find ${game}). npm run dp -- proofs ${version} --start makes it a version made a function at a time, which is its lead's to decide.`);
  return { codeMap, states: new Map(stateOf(version, { codeMap }).map(state => [state.key, state])), groups: tasksOf(version, codeMap) };
}

/**
 * Every byte of a version's copy accounted for, as accountOf gives it (lib/rebuild.mjs), from its code map, its
 * functions' proofs (`states`, as stateOf gives them), the data its played.json says was used in frames that matched
 * and the game's unreachable.json; or { why } when it can't be: without the copy on this computer, or on a console
 * whose data the tools don't follow in play yet.
 */
export function bytesAccounted(version, { codeMap = readCodeMap(version), states = stateOf(version, { codeMap }) } = {}) {
  const original = readOriginal(version), copy = copyWith(original.sha1);
  if (!followsContent(codeMap)) return { why: 'not measured on this console yet, as the tools don\'t follow its data in play' };
  if (!copy) return { why: 'needs your copy: npm run dp -- rom <file>' };
  const rom = cartridgeOf(copy.path, original.console).copy();
  return accountOf({
    rom, functions: codeMap.functions, proven: new Set(states.filter(state => state.kind).map(state => state.key)),
    used: usedCells(version, codeMap, rom.length), unreachable: readUnreachable(version).content, header: original.console === 'gba' ? HEADER : null,
  });
}

// a version's three numbers: the two the site shows, from its proof files, and bytes accounted for, the tools' own
function numbers(version, account) {
  const accounted = `bytes accounted for ${account.why ?? percentText(account.percent)}`;
  let proof;
  try {
    proof = readProof(version);
  } catch {
    return `Code ported and gameplay proven don't add up (npm run check says why), ${accounted}`;
  }
  const measured = percent => percentText(percent) ?? 'not measured yet';
  return `Code ported ${measured(proof?.ported?.percent)}, gameplay proven ${measured(proof?.gameplay?.percent)}, ${accounted}`;
}

const sentence = text => text[0].toUpperCase() + text.slice(1);

// --bytes: every byte of the copy, by kind, and the stretches still unexplained
function showBytes(version, account, all) {
  if (account.why) throw new Error(`${version}'s bytes can't be accounted for: ${account.why}.`);
  const { counts, total } = account, width = count(total).length;
  const line = (name, words) => `${count(counts[name]).padStart(width)} bytes  ${words}`;
  console.log(`${version}: every byte of ${readOriginal(version).name}, ${plural(total, 'byte')}.`);
  for (const name of ['proven', 'unproven', 'used', 'never']) console.log(`  ${line(name, sentence(BYTES[name]))}`);
  console.log('  Explained:');
  for (const name of ACCOUNTED.filter(name => !['proven', 'used'].includes(name))) console.log(`    ${line(name, sentence(BYTES[name]))}`);
  console.log(`Bytes accounted for: ${percentText(account.percent)}, ${count(account.accounted)} of ${plural(total, 'byte')}.`);
  if (!account.unexplained.length) {
    console.log('\nEvery byte is proven code, data used in play or explained.');
    return 0;
  }
  const shown = all ? account.unexplained : account.unexplained.slice(0, 20);
  const stretches = account.unexplained.length;
  console.log(`\nStill unexplained, ${count(stretches)} stretch${stretches === 1 ? '' : 'es'}, the biggest first:`);
  for (const s of shown) {
    const size = s.to - s.from + 1;
    const what = s.kind === 'unproven' ? `code without a proof, ${s.functions.length === 1 ? `function 0x${hex(s.functions[0])}` : `${count(s.functions.length)} functions from 0x${hex(s.functions[0])}`}` : 'data never used';
    console.log(`  0x${hex(s.from)}${size > 1 ? ` to 0x${hex(s.to)}` : ''}  ${plural(size, 'byte')}, ${what}`);
  }
  if (shown.length < account.unexplained.length) console.log(`  and ${count(account.unexplained.length - shown.length)} more: --all lists them.`);
  return 0;
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
  if (group.part && !group.recorded) return console.log(`${group.name} of ${version} is a part of the game with no recording of the original yet, so nothing says which functions it runs: tools/README.md#proving-a-part, then npm run dp -- prove ${version}.`);
  console.log(`${group.name} of ${version}, ${plural(group.functions.length, 'function')}${group.part ? ' the original runs in it that no part before it does' : ''}, ${count(proven)} proven:`);
  for (const line of groupLines(group, states)) console.log(line);
}

function begin(version) {
  const { game, language } = versionOf(version), original = readOriginal(version);
  if (writtenIn(language) !== 'c') throw new Error(`A function's proof is of a twin in C: name the game's version in C, such as ${game}/c.`);
  if (!KEEPS_PROOFS.includes(original.console)) throw new Error('The tools prove a function on the Game Boy Advance, the NES, the Super Nintendo, the PlayStation and the PlayStation 2, and on no other console yet (docs/CONSOLES.md).');
  if (!readCodeMap(version)) throw new Error(`games/${game}/proof/ has no code map yet, and its functions are the tasks: npm run dp -- codemap ${game} makes one.`);
  console.log(startProofs(version)
    ? `Written: games/${version}/proof/${PROOFS}, with no proof in it yet. ${version} is made a function at a time from here on: npm run dp -- tasks ${version} opens its tasks from its code map, and npm run dp -- match and npm run dp -- twin keep each proof they find.`
    : `games/${version}/proof/${PROOFS} is there already, and was left as it is.`);
  return 0;
}

// --parts: the game's parts become the tasks of its version that keeps its proofs
function beginParts(version) {
  const { game } = versionOf(version);
  if (!asksForProofs(version)) throw new Error(`${version} keeps no proofs, and a part's task is the functions it runs, each with its proof: npm run dp -- proofs ${version} --start --parts starts both.`);
  if (!readParts(game).length) throw new Error(`games/${game}/proof/parts.json lists no parts yet, and each would be a task.`);
  console.log(startPartFunctions(game, readOriginal(version).sha1)
    ? `Written: games/${game}/proof/${PART_FUNCTIONS}, with no part in it yet. ${version}'s tasks are its game's parts from here on: npm run dp -- prove ${version} keeps the functions the original runs in each part that names its recording and frames, and npm run dp -- tasks ${version} opens the parts' tasks.`
    : `games/${game}/proof/${PART_FUNCTIONS} is there already, and was left as it is.`);
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
      else if (state.why) wrong.push(`${version}: ${key}${state.twin ? `, ${state.twin.name} in ${state.twin.file},` : ''} is kept as proven and ${state.why === 'no twin' ? 'has no twin any more' : state.why === 'stop' ? 'has a stop in its twin' : state.why === 'twin changed' ? 'its twin, or a header or another line of its file, changed since' : 'the copy has other bytes there'}.`);
    }
    if (task) {
      const group = groupNamed(groups, task);
      if (!group) throw new Error(`No task of ${version} goes by "${task}".`);
      const left = group.functions.filter(f => !states.get(f.key).kind);
      if (!(group.part && !group.recorded)) console.log(`${group.name}: ${left.length ? `${count(left.length)} of its ${plural(group.functions.length, 'function')} ${left.length === 1 ? 'has' : 'have'} no proof yet` : `each of its ${plural(group.functions.length, 'function')} has its proof`}.`);
      for (const line of groupLines({ functions: left }, states)) console.log(line);
      if (left.length) wrong.push(`${version}: ${group.name} isn't done until each of its functions has its proof.`);
      if (group.part && !group.recorded) wrong.push(`${version}: ${group.name} has no recording of the original yet, so nothing says which functions it runs.`);
    }
  }
  if (wrong.length) {
    throw new Error(`${wrong.join('\n')}\nOnly npm run dp -- match <version> <function> and npm run dp -- twin <version> <function> write a proof: run them again on what changed.`);
  }
  if (!task) console.log(versions.length ? `Every proof kept still holds, in ${plural(versions.length, 'version')}.` : 'No version keeps its proofs yet.');
  return 0;
}
