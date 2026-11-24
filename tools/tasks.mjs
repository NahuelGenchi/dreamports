// npm run dp -- tasks <game> [--repo <owner/name>] [--yes]: opens a Task issue for each of a game's foundations and
// parts that has no piece yet: its foundations first, then its parts in the order parts.json lists them, the order a
// player meets them (docs/TEAMS.md). Each waits for the claims workflow to put it under the game's issue before the next,
// which keeps them in that order. A part that names its recording, or whose name a piece has already, is left out, so
// running it again opens only what's new. It only lists them, unless --yes says the person has said yes. --repo reads
// and opens them in another copy of the repository, such as a fork that tries the claims workflow. With a version's
// name, such as sonic-battle/c, it opens the tasks of the game's version in that language, "Task: Title screen in C",
// one for every foundation and part the version hasn't proven, as a version proves each part again (src/lib/pieces.mjs).
// Every version is written from the original, so its tasks wait on nothing in another language (#965). One run opens a game's
// tasks at a time on this computer, as a run takes minutes and a second one started meanwhile would open each again, and
// a task already open under its title is used as it is (#679). With a game's name alone, it opens the tasks of every
// version the game has, C's first, as it's the default language, so no part gets a task in one language and not the
// other (#757).
//
// Once every part of a version is played through, its tasks come from what gameplay proven still leaves untouched
// (lib/played.mjs, docs/STANDARD.md#done): a task for what's left of each part, the functions its recording ran with
// instructions or branch ways never played, one for the code most parts share, by where it is, and one for each stretch
// of code that never ran. Each lists its functions and says how to reach them. One whose task is open already is left.
// Where `npm run dp -- untouched <version> --sort` has been run on the computer, each branch a task lists says what it
// tests, and the task how many of its branches are of each kind. --update writes the leftover tasks already open again
// from what's left now, with --yes, each keeping what it says of who took it.
//
// A version that keeps its proofs (lib/proofs.mjs) is made a function at a time, and its tasks come from its code map
// from the first day: each a group of functions that sit together, "Task: Functions 080001C4 to 0800024C in C", which
// lists every function with its name where the code map has one, its twin where the code has one, and whether it's
// proven and by which proof. A group whose functions are all proven needs no task, and one whose task is open is
// left. So many are open at once and no more, the first in the map's order, and running it again opens the next as
// those close. --update writes the open ones again from where their functions stand now, with its title when its group
// ends elsewhere since the code map found more functions. Its parts stay as names for people and as what its
// recordings are for, and get no tasks. A game has hundreds of such tasks and GitHub holds 100 issues under one, so
// the claims workflow puts each under the issue of the stretch of the game's code its first function is in, which is
// under the version's issue (src/lib/pieces.mjs, #1473), and no run of this fills an issue.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { readCodeMap, readPartsFile, readProgress, hex } from './lib/proof-files.mjs';
import { leftoverPieces, readPlayed, untouchedOf } from './lib/played.mjs';
import { LOCAL } from './lib/paths.mjs';
import { nameKey, pieceOf, planOf, stretchName, stretchOf, taskTitle } from '../src/lib/pieces.mjs';
import { LANGUAGES, playOrder, versionName, versionOf } from '../src/lib/languages.mjs';
import { UPSTREAM, api } from './lib/github.mjs';
import { field, readClaims } from './lib/claims.mjs';
import { kindText, readSorted } from './untouched.mjs';
import { readOriginal } from './lib/proof-files.mjs';
import { asksForProofs, groupNamed, groupsOf, KEEPS_PROOFS, stateOf, stateText } from './lib/proofs.mjs';
import { dreamports } from './readme.mjs';

const USAGE = 'Usage: npm run dp -- tasks <game>[/c] [--repo <owner/name>] [--yes] [--update]';
const WAIT_MS = 90_000, EVERY_MS = 5_000;
// how many tasks of functions a version has open at once: enough for many people, and few enough to look through
export const OPEN_AT_ONCE = 20;

export async function run(args) {
  const { game: name, repo = UPSTREAM, yes = false, update = false } = options(args);
  if (name.includes('/')) return openTasks(name, repo, yes, update);
  // a game alone: each of its versions, C's first (src/lib/languages.mjs)
  const { game } = versionOf(name);
  const dreamport = dreamports().find(d => d.game === game);
  const languages = dreamport ? playOrder([dreamport.language ?? 'js', ...dreamport.versions.map(v => v.language)]) : ['js'];
  for (const [index, language] of languages.entries()) {
    if (index) console.log('');
    await openTasks(versionName(game, language), repo, yes, update);
  }
  return 0;
}

// the tasks of one version, as the start of this file says
async function openTasks(version, repo, yes, update = false) {
  const { game, language } = versionOf(version);
  // a version made a function at a time has its code map's functions for tasks, and needs no list of parts for them
  if (asksForProofs(version)) return openFunctionTasks(version, repo, yes, update);
  const file = readPartsFile(game), parts = file.parts ?? [];
  if (!parts.length) throw new Error(`games/${game}/proof/parts.json lists no parts yet, and each task is one of them.`);
  const claims = readClaims(repo);
  const dreamport = dreamports().find(d => d.game === game), entry = dreamport?.entry;
  const home = claims.gameIssueOf(game, entry);
  if (!home) throw new Error(`Nobody has claimed ${game} with a New Dreamport issue in ${repo} yet, and its tasks go under that issue.`);
  // the game's main version, its JavaScript one, or its version in C in a game that started in C (src/lib/languages.mjs)
  const main = dreamport?.language ?? 'js';
  const inVersion = language === main ? null : dreamport?.versions.find(v => v.language === language);
  if (language !== main && !inVersion) throw new Error(`${game} has no version in ${LANGUAGES[language].name} yet: npm run dp -- new ${version} starts one.`);

  const pieces = claims.piecesOf(game, entry);
  if (startsByFunction(readOriginal(game).console, language, pieces)) {
    throw new Error(`${version} has no task yet, and the tools keep a function's proof on its console, so it's made a function at a time (docs/STANDARD.md, Twins and their proof): run npm run dp -- proofs ${version} --start, commit the file it writes, and run this again, which then opens its tasks of functions.`);
  }
  const proven = new Set((inVersion?.proof?.gameplay?.parts ?? []).filter(p => p.proven).map(p => nameKey(p.name)));
  const wanted = missingParts(planOf(file), pieces, language, proven, main);
  // a version in another language than the game's main one keeps its tasks under an issue of its own (#905)
  const where = language === main ? `#${home.number}` : `its issue for ${LANGUAGES[language].name}, under #${home.number}`;
  if (!wanted.length) {
    console.log(`Every foundation and part of ${version} has its task already, under ${where}.`);
    const versionProof = language === main ? dreamport?.proof : inVersion?.proof;
    const through = versionProof?.gameplay && versionProof.gameplay.proven === versionProof.gameplay.total;
    return through && readPlayed(version).places ? openLeftovers({ version, repo, yes, update, parts, where, game, language }) : 0;
  }
  if (!yes) {
    console.log(`A task for each of these ${wanted.length} would go under ${where} in ${repo}, public and in your name:\n${wanted.map(p => `  ${p.name}`).join('\n')}`);
    console.log('\nNothing was opened: --yes opens them, once you have said yes.');
    return 0;
  }
  // the pieces in this language by their parts' names, as each task names what comes before it and what it needs
  const numbers = new Map(pieces.filter(p => pieceOf(p).language === language).map(p => [nameKey(pieceOf(p).name), p.number]));
  const named = name => ({ name: language === 'js' ? name : `${name} in ${LANGUAGES[language].name}`, number: numbers.get(nameKey(name)) });
  const release = holdGame(game);
  let opened = 0;
  try {
    for (const part of wanted) {
      const before = part.foundation ? null : parts[parts.findIndex(p => p.name === part.name) - 1];
      const title = taskTitle(part.name, language);
      const already = taskTitled(api(`repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100`) ?? [], title, game);
      if (already) {
        numbers.set(nameKey(part.name), already.number);
        console.log(`#${already.number} ${part.name}: open already, so it wasn't opened again`);
        continue;
      }
      const issue = api(`repos/${repo}/issues`, { method: 'POST', body: { title, body: taskText(version, part, before && named(before.name), part.needs.map(named), main) } });
      numbers.set(nameKey(part.name), issue.number);
      opened++;
      console.log(`#${issue.number} ${part.name}${await underItsGame(repo, issue.number) ? '' : `: the bot hasn't put it under ${where} yet, and will`}`);
    }
  } finally {
    release();
  }
  console.log(`\nOpened ${opened} task${opened === 1 ? '' : 's'} under ${where}.`);
  return 0;
}

/** Whether a version that keeps no proofs has to start them before its first task: one in C with no task yet, open or
 *  closed, on a console whose functions' proofs the tools keep (KEEPS_PROOFS). One that has tasks of parts already stays made a
 *  part at a time, as its lead decides when that changes (proofs --start, #1864). */
export function startsByFunction(console, language, pieces) {
  return language === 'c' && KEEPS_PROOFS.includes(console) && !pieces.some(piece => pieceOf(piece).language === language);
}

/**
 * The tasks of functions a version still needs, from its `groups` (lib/proofs.mjs), its functions' `states` by key
 * and the game's `pieces`, open and closed: { open, wanted, waiting }. `open` are the groups whose task is open,
 * `wanted` those with a function not proven and no open task, up to as many as keeps `most` open at once, and
 * `waiting` how many more come after them. A closed task whose group isn't proven any more gets a new one.
 */
export function functionTasks(groups, states, pieces, language = 'c', most = OPEN_AT_ONCE) {
  // the group each open task is for: the one of its name, or the one its first function is in now (groupNamed)
  const taken = new Set(pieces.filter(piece => piece.state === 'open' && pieceOf(piece).language === language).map(piece => groupNamed(groups, pieceOf(piece).name)));
  const has = group => taken.has(group);
  const unproven = groups.filter(group => group.functions.some(f => !states.get(f.key)?.kind));
  const open = groups.filter(has), missing = unproven.filter(group => !has(group));
  const wanted = missing.slice(0, Math.max(0, most - open.length));
  return { open, wanted, waiting: missing.length - wanted.length };
}

/**
 * The Task issue for a group of functions, under the headings of the Task form: each function with its address and
 * size, the name the code map gives it, its twin, and where it stands, then the tools that prove one.
 */
export function functionTaskText(version, group, states) {
  const { game } = versionOf(version);
  const line = f => {
    const state = states.get(f.key), twin = state?.twin ? `\`${state.twin.name}\` in \`${state.twin.file}\`, ` : '';
    return `- \`${f.key}\`${f.name ? ` \`${f.name}\`` : ''}, ${f.size.toLocaleString('en')} bytes: ${twin}${state ? stateText(state) : 'no twin yet'}`;
  };
  const many = group.functions.length !== 1;
  return [
    '### Game folder', '', game, '',
    '### Kind', '', 'Something else', '',
    '### What it is', '',
    `${group.name}: ${many ? `${group.functions.length} functions of the original that sit together in its code` : 'a function of the original'}, from the game's code map. ${many ? 'Each' : 'It'} needs its twin in \`games/${version}/\`, written by hand with every path of the original's, and its proof (\`docs/STANDARD.md#twins-and-their-proof\`):`,
    '', ...group.functions.map(line), '',
    `\`npm run dp -- read ${game} <address>\` prints a function from your own copy. \`npm run dp -- match ${version} <address>\` says whether its twin comes out as the original's bytes, and \`npm run dp -- twin ${version} <address>\` whether it leaves the same memory as the original's over thousands of calls that take every path of it. Each keeps what it proves, and nothing else does. \`npm run dp -- proofs ${version} ${group.first}\` lists these functions as they stand now.`,
    '',
    '### Done when', '',
    `\`npm run dp -- ready ${version} --task ${group.first}\` says each of these functions has its proof, by the same bytes or the same memory, with no stop in its twin, and no recording that matched before differs.`,
    '',
    '### Taking it', '', '- [ ] I\'m taking this task myself.',
  ].join('\n');
}

// the tasks of a version made a function at a time, as the start of this file says
async function openFunctionTasks(version, repo, yes, update) {
  const { game, language } = versionOf(version);
  const codeMap = readCodeMap(version);
  if (!codeMap) throw new Error(`games/${game}/proof/ has no code map yet, and its functions are the tasks: npm run dp -- codemap ${game} makes one.`);
  const claims = readClaims(repo);
  const dreamport = dreamports().find(d => d.game === game), entry = dreamport?.entry;
  const home = claims.gameIssueOf(game, entry);
  if (!home) throw new Error(`Nobody has claimed ${game} with a New Dreamport issue in ${repo} yet, and its tasks go under that issue.`);
  // each under the issue of its stretch of the game's code, which is under the version's issue (#1473)
  const where = `the issues of its code's stretches, in its issue for ${LANGUAGES[language].name}, under #${home.number}`;
  const states = new Map(stateOf(version, { codeMap }).map(state => [state.key, state]));
  const pieces = claims.piecesOf(game, entry);
  const groups = groupsOf(codeMap);
  const { open, wanted, waiting } = functionTasks(groups, states, pieces, language);
  if (update) {
    // each open task with the group it's for now, which its title names again when the group ends elsewhere
    const changed = pieces.filter(piece => piece.state === 'open' && pieceOf(piece).language === language).map(issue => ({ issue, group: groupNamed(groups, pieceOf(issue).name) })).filter(({ group }) => group)
      .map(({ group, issue }) => ({ group, issue, title: taskTitle(group.name, language), body: keepTaking(functionTaskText(version, group, states), issue.body ?? '') }))
      .filter(({ issue, title, body }) => body !== (issue.body ?? '').replace(/\r\n/g, '\n') || title !== issue.title);
    if (!changed.length) {
      console.log(`Every open task of ${version}'s functions says where they stand now already.`);
      return 0;
    }
    if (!yes) {
      console.log(`The text of these ${changed.length} open tasks would be written again in ${repo}, public and in your name, each keeping what it says of who took it:\n${changed.map(({ group, issue }) => `  #${issue.number} ${group.name}`).join('\n')}`);
      console.log('\nNothing was changed: --yes changes them, once you have said yes.');
      return 0;
    }
    for (const { group, issue, title, body } of changed) {
      api(`repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: { title, body } });
      console.log(`#${issue.number} ${group.name}: written again`);
    }
    return 0;
  }
  const later = waiting ? ` ${waiting.toLocaleString('en')} more group${waiting === 1 ? '' : 's'} of its functions come after, ${OPEN_AT_ONCE} open at once: run this again as tasks close.` : '';
  if (!wanted.length) {
    console.log(open.length || waiting ? `${version} has ${open.length} task${open.length === 1 ? '' : 's'} of functions open already, under ${where}.${later}` : `Every function of ${version} in the cartridge has its proof, so it needs no task.`);
    return 0;
  }
  const left = group => group.functions.filter(f => !states.get(f.key)?.kind).length;
  if (!yes) {
    console.log(`${version} is made a function at a time, so its tasks are groups of functions from its code map. A task for each of these ${wanted.length} would go under ${where} in ${repo}, public and in your name:\n${wanted.map(group => `  ${group.name}: ${left(group)} of ${group.functions.length} to prove, in ${stretchName(stretchOf(group.functions[0].address))}`).join('\n')}`);
    console.log(`\nNothing was opened: --yes opens them, once you have said yes.${later}`);
    return 0;
  }
  const release = holdGame(game);
  let opened = 0;
  try {
    for (const group of wanted) {
      const title = taskTitle(group.name, language);
      const already = taskTitled(api(`repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100`) ?? [], title, game);
      if (already) {
        console.log(`#${already.number} ${group.name}: open already, so it wasn't opened again`);
        continue;
      }
      const issue = api(`repos/${repo}/issues`, { method: 'POST', body: { title, body: functionTaskText(version, group, states) } });
      opened++;
      console.log(`#${issue.number} ${group.name}${await underItsGame(repo, issue.number) ? '' : `: the bot hasn't put it under ${where} yet, and will`}`);
    }
  } finally {
    release();
  }
  console.log(`\nOpened ${opened} task${opened === 1 ? '' : 's'} under ${where}.${later}`);
  return 0;
}

// the tasks for what's left of a version whose parts are all played through, as the start of this file says
async function openLeftovers({ version, repo, yes, update, parts, where, game, language }) {
  const ran = Object.fromEntries(Object.entries(readProgress(version).recordings).map(([name, r]) => [name, r.functions ?? []]));
  const pieces = leftoverPieces(untouchedOf(version, readCodeMap(version)).functions, parts.filter(part => part.recording), ran);
  // what each branch tests, when untouched --sort has been run here: the tasks say it
  const sorted = readSorted(version, readOriginal(version).sha1);
  if (!sorted) console.log(`npm run dp -- untouched ${version} --sort hasn't been run on this computer, so the tasks won't say what each branch tests.`);
  const open = api(`repos/${repo}/issues?state=open&sort=created&direction=desc&per_page=100`) ?? [];
  if (update) return updateLeftovers({ version, repo, yes, pieces, sorted, open, game, language });
  const wanted = pieces.filter(piece => !taskTitled(open, taskTitle(piece.name, language), game));
  if (!wanted.length) {
    console.log(pieces.length ? `Every piece of what's left of ${version} has its task open already.` : `Nothing is left to play of ${version}'s code.`);
    return 0;
  }
  const left = piece => piece.functions.reduce((sum, f) => sum + f.total - f.played, 0);
  if (!yes) {
    console.log(`\nIts parts are all played through, so its tasks come from what's left to play. A task for each of these ${wanted.length} would go under ${where} in ${repo}, public and in your name:\n${wanted.map(p => `  ${p.name}: ${p.functions.length} function${p.functions.length === 1 ? '' : 's'}, ${left(p).toLocaleString('en')} instructions and branch ways`).join('\n')}`);
    console.log('\nNothing was opened: --yes opens them, once you have said yes.');
    return 0;
  }
  const release = holdGame(game);
  let opened = 0;
  try {
    for (const piece of wanted) {
      const issue = api(`repos/${repo}/issues`, { method: 'POST', body: { title: taskTitle(piece.name, language), body: leftoverText(version, piece, sorted) } });
      opened++;
      console.log(`#${issue.number} ${piece.name}${await underItsGame(repo, issue.number) ? '' : `: the bot hasn't put it under ${where} yet, and will`}`);
    }
  } finally {
    release();
  }
  console.log(`\nOpened ${opened} task${opened === 1 ? '' : 's'} under ${where}.`);
  return 0;
}

// --update: the leftover tasks already open, written again from what's left now and what its branches test
async function updateLeftovers({ version, repo, yes, pieces, sorted, open, game, language }) {
  const changed = pieces.map(piece => ({ piece, issue: taskTitled(open, taskTitle(piece.name, language), game) })).filter(({ issue }) => issue)
    .map(({ piece, issue }) => ({ piece, issue, body: keepTaking(leftoverText(version, piece, sorted), issue.body ?? '') })).filter(({ issue, body }) => body !== (issue.body ?? '').replace(/\r\n/g, '\n'));
  if (!changed.length) {
    console.log(`Every open task for what's left of ${version} says what's left now already.`);
    return 0;
  }
  if (!yes) {
    console.log(`\nThe text of these ${changed.length} open tasks would be written again in ${repo}, public and in your name, each keeping what it says of who took it:\n${changed.map(({ piece, issue }) => `  #${issue.number} ${piece.name}`).join('\n')}`);
    console.log('\nNothing was changed: --yes changes them, once you have said yes.');
    return 0;
  }
  for (const { piece, issue, body } of changed) {
    api(`repos/${repo}/issues/${issue.number}`, { method: 'PATCH', body: { body } });
    console.log(`#${issue.number} ${piece.name}: written again`);
  }
  console.log(`\nWrote ${changed.length} task${changed.length === 1 ? '' : 's'} again.`);
  return 0;
}

/** A task's new text with the old text's last part, Taking it, as it was: who took it stays. */
export function keepTaking(text, old) {
  const heading = '### Taking it', at = old.replace(/\r\n/g, '\n').indexOf(heading);
  return at < 0 ? text : `${text.slice(0, text.indexOf(heading))}${old.replace(/\r\n/g, '\n').slice(at)}`;
}

/**
 * The Task issue for a piece of what's left (leftoverPieces), under the headings of the Task form: its functions with
 * most left, each with the branches gone one way only and the way to play, and how to reach them. With `sorted`, what
 * untouched --sort found of each branch (untouched.mjs's readSorted), each branch says its kind and the value it
 * tests, and the piece how many of its branches are of each kind.
 */
export function leftoverText(version, piece, sorted = null) {
  const { game } = versionOf(version), most = piece.functions.slice(0, 12);
  const way = ([at, word]) => `\`${hex(at)}\` ${word}${sorted?.has(at) ? ` (${kindText(sorted.get(at))})` : ''}`;
  const line = f => `- \`${f.key}\`: ${f.never ? `never played, ${f.total.toLocaleString('en')} instructions and branch ways` : `${(f.total - f.played).toLocaleString('en')} of ${f.total.toLocaleString('en')} to play`}${f.ways.length ? `; to play: ${f.ways.slice(0, 4).map(way).join(', ')}${f.ways.length > 4 ? ` and ${f.ways.length - 4} more` : ''}` : ''}`;
  const from = piece.recording ? `--from ${piece.recording}` : '--from <a recording that gets near it>';
  // how many of the piece's branches are of each kind, the plainest to reach first
  const kinds = {};
  for (const f of piece.functions) for (const [at] of f.ways) if (sorted?.has(at)) kinds[sorted.get(at).kind] = (kinds[sorted.get(at).kind] ?? 0) + 1;
  const count = (kind, words) => (kinds[kind] ? [`${kinds[kind].toLocaleString('en')} ${words}`] : []);
  const sums = [
    ...count('moves', 'compare something that changes in play, so playing differently or `route --goal untouched:<address>` reaches the other way'),
    ...count('differs', 'compare something that differs by recording, such as the character, or a count tested once'),
    ...count('same', "compare something that never differed in any recording, often the game's mode or a setting, which needs a recording that starts differently"),
    ...count('path', 'go by the path: a flag set earlier or what a function gave back, so another path has to be played first'),
  ];
  const sorting = sums.length ? ['', `Of its branches gone one way only, as \`npm run dp -- untouched ${version} --sort\` found them: ${sums.join('; ')}.`] : [];
  return [
    '### Game folder', '', game, '',
    '### Kind', '', 'Something else', '',
    '### What it is', '',
    `${piece.name}: code of the original that has never been played next to the Dreamport, though ${piece.recording ? 'its part is played through' : 'every part is played through'}. Gameplay proven counts every instruction and each way of every branch (\`docs/STANDARD.md#done\`), and these ${piece.functions.length === 1 ? 'is the function' : `are the ${piece.functions.length} functions`} with something left, as \`npm run dp -- untouched ${version} --all\` lists them${piece.functions.length > most.length ? `, the ${most.length} with most first` : ''}:`,
    '', ...most.map(line), ...sorting, '',
    `\`npm run dp -- route ${version} <name> ${from} --goal untouched\` finds presses that reach code not played yet, or with \`--goal untouched:<address>\` one branch's way; \`npm run dp -- untouched ${version} --why <address>\` says first what a branch tests and what it held, as one that tests the character, the mode or a setting needs a recording that starts differently, and no search reaches it; \`npm run dp -- read ${game} <address>\` prints the code. Port what the recording stops on, mark with \`dp:stop\` what has to wait, and prove it.`,
    '',
    '### Done when', '',
    `\`npm run dp -- untouched ${version} --all\` no longer lists these functions, each played in recordings whose frames all match, or what's left of them is in \`games/${game}/proof/unreachable.json\` with why nothing reaches it. A piece too big for one pull request closes with what's left opened again by \`npm run dp -- tasks ${version}\`.`,
    '',
    '### Taking it', '', '- [ ] I\'m taking this task myself.',
  ].join('\n');
}

/**
 * Keeps other runs from opening `game`'s tasks while this one does, with a file in `folder` that names this process,
 * and gives what lets them again. A file left by a run that has ended is taken over.
 */
export function holdGame(game, folder = join(LOCAL, 'tasks'), pid = process.pid) {
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `${game}.lock`);
  for (let tries = 0; ; tries++) {
    try {
      const handle = openSync(file, 'wx');
      writeSync(handle, String(pid));
      closeSync(handle);
      return () => rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const holder = readFileSync(file, 'utf8').trim();
      if (tries || !holder || running(Number(holder))) {
        throw new Error(`Another run is opening ${game}'s tasks already${holder ? ` (process ${holder})` : ''}. Wait for it to end, then run this again, and it opens only what's left.`);
      }
      rmSync(file, { force: true });
    }
  }
}

function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * The open issue among `issues` titled `title`, whatever its capitals and spaces at its ends, leaving pull requests out,
 * that's `game`'s: its form's Game folder or its label names it, as two games can have a part of the same name (#837).
 */
export function taskTitled(issues, title, game) {
  const key = title.trim().toLowerCase();
  const ours = issue => field(issue.body, 'Game folder')?.replace(/`/g, '').trim() === game || (issue.labels ?? []).some(label => (label.name ?? label) === game);
  return issues.find(issue => !issue.pull_request && issue.state !== 'closed' && issue.title.trim().toLowerCase() === key && ours(issue));
}

function options(args) {
  const found = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo') {
      if (!/^[\w.-]+\/[\w.-]+$/.test(args[i + 1] ?? '')) throw new Error(`--repo needs a repository, as owner/name.\n${USAGE}`);
      found.repo = args[++i];
    } else if (arg === '--yes') found.yes = true;
    else if (arg === '--update') found.update = true;
    else if (arg.startsWith('--')) throw new Error(`tasks has no ${arg}.\n${USAGE}`);
    else found.rest.push(arg);
  }
  if (found.rest.length !== 1) throw new Error(USAGE);
  return { ...found, game: found.rest[0] };
}

/**
 * The foundations and parts that still need a task: no recording proves them, and no piece, open or closed, has their
 * name. In another language than the game's `main` one, those with no piece in that language that the version hasn't
 * proven, the names in `proven`.
 */
export function missingParts(parts, pieces, language = 'js', proven = new Set(), main = 'js') {
  const named = new Set(pieces.filter(p => pieceOf(p).language === language).map(p => nameKey(pieceOf(p).name)));
  return parts.filter(part => !named.has(nameKey(part.name)) && (language === main ? !part.recording : !proven.has(nameKey(part.name))));
}

const titled = ({ name, number }) => `${name}${number ? ` (#${number})` : ''}`;

/**
 * A foundation's or a part's Task issue, under the headings of the Task form, which is how the claims workflow reads it.
 * `before` is the part a player meets just before it, and `needs` what it needs, each { name, number }. `game` can be a
 * version, such as sonic-battle/c, whose task is written from the original, as every version is, and proven in its
 * language (#965). In a game that started in C, its version in C is the main one.
 */
export function taskText(version, part, before, needs = [], main = 'js') {
  const { game, language } = versionOf(version);
  if (language !== main) return versionTaskText(version, part, before, needs, main);
  const after = before ? `It comes right after ${titled(before)}.` : 'It\'s where a player starts.';
  const needing = needs.length ? ` It needs ${needs.map(titled).join(' and ')} first.` : '';
  const where = language === 'js' ? '' : ` It's written in \`games/${version}/\` from the original.`;
  const what = part.foundation ? `${part.name}, which other pieces of the game need.${part.what ? ` ${part.what}` : ''}` : `${part.name}, one of the game's parts. ${after}`;
  const done = part.foundation
    ? part.done ?? `A recording shows ${part.name} at work, every frame matches the original in picture and sound, and \`npm run dp -- prove ${version}\` finds no frame that differs, so the pieces that need it can start.`
    : `A recording plays *${part.name}* from its first frame to its last, every frame matches the original in picture and sound, and \`npm run dp -- prove ${version}\` shows the part as proven. Its place in \`games/${game}/proof/parts.json\` names the recording and those frames.`;
  return [
    '### Game folder', '', game, '',
    '### Kind', '', part.foundation ? 'Foundation' : 'Something else', '',
    '### What it is', '', `${what}${needing}${where}`, '',
    '### Done when', '', done, '',
    '### Taking it', '', '- [ ] I\'m taking this task myself.',
  ].join('\n');
}

// a task of a version in another language than the game's main one: the same part, written from the original, as every
// version is, which can follow the main version where it has the part already (#965)
function versionTaskText(version, part, before, needs, main = 'js') {
  const { game, language } = versionOf(version), called = LANGUAGES[language].name, from = LANGUAGES[main].name;
  const after = before ? `It comes right after ${titled(before)}.` : 'It\'s where a player starts.';
  const needing = needs.length ? ` It needs ${needs.map(titled).join(' and ')} first.` : '';
  const what = part.foundation ? `${part.name} in ${called}, which other pieces of the game's version in ${called} need.` : `${part.name} in ${called}, one of the game's parts, in its version in ${called}. ${after}`;
  return [
    '### Game folder', '', game, '',
    '### Kind', '', part.foundation ? 'Foundation' : 'Something else', '',
    '### What it is', '', `${what}${needing} ${versionWords(version, from)}`, '',
    '### Done when', '', `${versionDone(version, part, called)}`, '',
    '### Taking it', '', '- [ ] I\'m taking this task myself.',
  ].join('\n');
}

/** How a task of a version in another language is made, as its issue says it. */
export const versionWords = (version, from) => `It's written in \`games/${version}/\` from the original, as every version is, and can follow the game's ${from} where it has this part already, never waiting for it.`;

/** When a task of a version in another language is done, as its issue says it. */
export const versionDone = (version, part, called) => `A recording plays *${part.name}*${part.foundation ? ' at work' : ' from its first frame to its last'}, every frame matches the original in picture and sound, and \`npm run dp -- prove ${version}\` shows ${part.foundation ? 'no frame that differs' : `the part as proven in ${called}`}.`;

async function underItsGame(repo, number) {
  for (const until = Date.now() + WAIT_MS; Date.now() < until; await new Promise(done => setTimeout(done, EVERY_MS))) {
    if (api(`repos/${repo}/issues/${number}`)?.parent_issue_url) return true;
  }
  return false;
}
