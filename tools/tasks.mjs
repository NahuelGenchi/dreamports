// npm run dp -- tasks <game> [--repo <owner/name>] [--yes]: opens a Task issue for each of a game's foundations and
// parts that has no piece yet: its foundations first, then its parts in the order parts.json lists them, the order a
// player meets them (docs/TEAMS.md). Each waits for the claims workflow to put it under the game's issue before the next,
// which keeps them in that order. A part that names its recording, or whose name a piece has already, is left out, so
// running it again opens only what's new. It only lists them, unless --yes says the person has said yes. --repo reads
// and opens them in another copy of the repository, such as a fork that tries the claims workflow. With a version's
// name, such as sonic-battle/c, it opens the tasks of the game's version in that language, "Task: Title screen in C",
// one for every foundation and part the version hasn't proven, as a version proves each part again (src/lib/pieces.mjs).
// In a game that started in C, with no JavaScript version, its version in C is its main one, whose tasks are opened as a
// JavaScript version's are, written from the original and waiting on nothing in another language. One run opens a game's
// tasks at a time on this computer, as a run takes minutes and a second one started meanwhile would open each again, and
// a task already open under its title is used as it is (#679). With a game's name alone, it opens the tasks of every
// version the game has, C's first, as it's the default language, so no part gets a task in one language and not the
// other (#757).

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { readPartsFile } from './lib/proof-files.mjs';
import { LOCAL } from './lib/paths.mjs';
import { nameKey, pieceOf, planOf, taskTitle } from '../src/lib/pieces.mjs';
import { LANGUAGES, playOrder, versionName, versionOf } from '../src/lib/languages.mjs';
import { UPSTREAM, api } from './lib/github.mjs';
import { field, readClaims } from './lib/claims.mjs';
import { dreamports } from './readme.mjs';

const USAGE = 'Usage: npm run dp -- tasks <game>[/c] [--repo <owner/name>] [--yes]';
const WAIT_MS = 90_000, EVERY_MS = 5_000;

export async function run(args) {
  const { game: name, repo = UPSTREAM, yes = false } = options(args);
  if (name.includes('/')) return openTasks(name, repo, yes);
  // a game alone: each of its versions, C's first (src/lib/languages.mjs)
  const { game } = versionOf(name);
  const dreamport = dreamports().find(d => d.game === game);
  const languages = dreamport ? playOrder([dreamport.language ?? 'js', ...dreamport.versions.map(v => v.language)]) : ['js'];
  for (const [index, language] of languages.entries()) {
    if (index) console.log('');
    await openTasks(versionName(game, language), repo, yes);
  }
  return 0;
}

// the tasks of one version, as the start of this file says
async function openTasks(version, repo, yes) {
  const { game, language } = versionOf(version);
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
  const proven = new Set((inVersion?.proof?.gameplay?.parts ?? []).filter(p => p.proven).map(p => nameKey(p.name)));
  const wanted = missingParts(planOf(file), pieces, language, proven, main);
  if (!wanted.length) {
    console.log(`Every foundation and part of ${version} has its task already, under #${home.number}.`);
    return 0;
  }
  if (!yes) {
    console.log(`A task for each of these ${wanted.length} would go under #${home.number} in ${repo}, public and in your name:\n${wanted.map(p => `  ${p.name}`).join('\n')}`);
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
      console.log(`#${issue.number} ${part.name}${await underItsGame(repo, issue.number) ? '' : `: the bot hasn't put it under #${home.number} yet, and will`}`);
    }
  } finally {
    release();
  }
  console.log(`\nOpened ${opened} task${opened === 1 ? '' : 's'} under #${home.number}.`);
  return 0;
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
 * version, such as sonic-battle/c, whose task is written from the game's `main` version, its JavaScript, and proven again
 * in its language. In a game that started in C, its version in C is the main one, written from the original.
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

// a task of a version in another language: the same part, written from the game's main version, its JavaScript, which it
// needs first
function versionTaskText(version, part, before, needs, main = 'js') {
  const { game, language } = versionOf(version), called = LANGUAGES[language].name, from = LANGUAGES[main].name;
  const after = before ? `It comes right after ${titled(before)}.` : 'It\'s where a player starts.';
  const needing = needs.length ? ` It needs ${needs.map(titled).join(' and ')} first.` : '';
  const what = part.foundation ? `${part.name} in ${called}, which other pieces of the game's version in ${called} need.` : `${part.name} in ${called}, one of the game's parts, in its version in ${called}. ${after}`;
  return [
    '### Game folder', '', game, '',
    '### Kind', '', part.foundation ? 'Foundation' : 'Something else', '',
    '### What it is', '', `${what}${needing} It's written in \`games/${version}/\` from the game's ${from}, which is finished for it first.`, '',
    '### Done when', '', `The recordings that prove ${part.name} in ${from} play the same in ${called}, every frame matching the original in picture and sound, and \`npm run dp -- prove ${version}\` shows ${part.foundation ? 'no frame that differs' : 'the part as proven'}.`, '',
    '### Taking it', '', '- [ ] I\'m taking this task myself.',
  ].join('\n');
}

async function underItsGame(repo, number) {
  for (const until = Date.now() + WAIT_MS; Date.now() < until; await new Promise(done => setTimeout(done, EVERY_MS))) {
    if (api(`repos/${repo}/issues/${number}`)?.parent_issue_url) return true;
  }
  return false;
}
