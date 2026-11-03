// npm run dp -- tasks <game> [--repo <owner/name>] [--yes]: opens a Task issue for each of a game's parts that has no
// piece yet, in the order parts.json lists them, the order a player meets them (docs/TEAMS.md). Each waits for the
// claims workflow to put it under the game's issue before the next, which keeps them in that order. A part that names
// its recording, or whose name a piece has already, is left out, so running it again opens only what's new. It only
// lists them, unless --yes says the person has said yes. --repo reads and opens them in another copy of the repository,
// such as a fork that tries the claims workflow.

import { readParts } from './lib/proof-files.mjs';
import { UPSTREAM, api } from './lib/github.mjs';
import { readClaims } from './lib/claims.mjs';
import { dreamports } from './readme.mjs';

const USAGE = 'Usage: npm run dp -- tasks <game> [--repo <owner/name>] [--yes]';
const WAIT_MS = 90_000, EVERY_MS = 5_000;

export async function run(args) {
  const { game, repo = UPSTREAM, yes = false } = options(args);
  const parts = readParts(game);
  if (!parts.length) throw new Error(`games/${game}/proof/parts.json lists no parts yet, and each task is one of them.`);
  const claims = readClaims(repo);
  const entry = dreamports().find(d => d.game === game)?.entry;
  const home = claims.gameIssueOf(game, entry);
  if (!home) throw new Error(`Nobody has claimed ${game} with a New Dreamport issue in ${repo} yet, and its tasks go under that issue.`);

  const pieces = claims.piecesOf(game, entry);
  const wanted = missingParts(parts, pieces);
  if (!wanted.length) {
    console.log(`Every part of ${game} has its task already, under #${home.number}.`);
    return 0;
  }
  if (!yes) {
    console.log(`A task for each of these ${wanted.length} parts would go under #${home.number} in ${repo}, public and in your name:\n${wanted.map(p => `  ${p.name}`).join('\n')}`);
    console.log('\nNothing was opened: --yes opens them, once you have said yes.');
    return 0;
  }
  const numbers = new Map(pieces.map(p => [pieceName(p), p.number]));
  for (const part of wanted) {
    const before = parts[parts.indexOf(part) - 1];
    const number = before && numbers.get(before.name.toLowerCase());
    const issue = api(`repos/${repo}/issues`, { method: 'POST', body: { title: `Task: ${part.name}`, body: taskText(game, part, before && { name: before.name, number }) } });
    numbers.set(part.name.toLowerCase(), issue.number);
    console.log(`#${issue.number} ${part.name}${await underItsGame(repo, issue.number) ? '' : `: the bot hasn't put it under #${home.number} yet, and will`}`);
  }
  console.log(`\nOpened ${wanted.length} task${wanted.length === 1 ? '' : 's'} under #${home.number}.`);
  return 0;
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

const pieceName = piece => piece.title.replace(/^Task:\s*/i, '').trim().toLowerCase();

/** The parts that still need a task: no recording proves them, and no piece, open or closed, has their name. */
export function missingParts(parts, pieces) {
  const named = new Set(pieces.map(pieceName));
  return parts.filter(part => !part.recording && !named.has(part.name.trim().toLowerCase()));
}

/** A part's Task issue, under the headings of the Task form, which is how the claims workflow reads it. */
export function taskText(game, part, before) {
  const after = before ? `It comes right after ${before.name}${before.number ? ` (#${before.number})` : ''}.` : 'It\'s where a player starts.';
  return [
    '### Game folder', '', game, '',
    '### Kind', '', 'Something else', '',
    '### What it is', '', `${part.name}, one of the game's parts. ${after}`, '',
    '### Done when', '',
    `A recording plays *${part.name}* from its first frame to its last, every frame matches the original in picture and sound, and \`npm run dp -- prove ${game}\` shows the part as proven. Its place in \`games/${game}/proof/parts.json\` names the recording and those frames.`, '',
    '### Taking it', '', '- [ ] I\'m taking this task myself.',
  ].join('\n');
}

async function underItsGame(repo, number) {
  for (const until = Date.now() + WAIT_MS; Date.now() < until; await new Promise(done => setTimeout(done, EVERY_MS))) {
    if (api(`repos/${repo}/issues/${number}`)?.parent_issue_url) return true;
  }
  return false;
}
