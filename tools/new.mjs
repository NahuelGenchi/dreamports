// npm run dp -- new <game> [--commit] [--repo <owner/name>]: writes the first files of a Dreamport someone has claimed,
// which is mapped already: its page, its code on the console's kit with the controller, touch screen, settings and start
// screen wired in, its license and its entry, so that it builds at once, ready for its capture, with nothing of the game
// in it yet. The claim's issue gives its lead and its number. --commit commits them with the game's map, in the words its
// first entry needs (docs/TEAMS.md#a-games-first-entry). --repo reads the claims of another copy of the repository, such
// as a fork that tries the claims workflow.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO, gameFolder } from './lib/paths.mjs';
import { readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { UPSTREAM } from './lib/github.mjs';
import { readClaims } from './lib/claims.mjs';
import { firstFilesMessage, namesOf, startingEntry, startingFiles } from './lib/new-game.mjs';
import { run as portmap } from './portmap.mjs';

const USAGE = 'Usage: npm run dp -- new <game> [--commit] [--repo <owner/name>]';

export async function run(args) {
  const at = args.indexOf('--repo');
  const repository = at >= 0 ? args[at + 1] : UPSTREAM;
  const game = args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
  if (!game || !repository) throw new Error(USAGE);
  const original = readOriginal(game);
  if (!readCodeMap(game)) throw new Error(`games/${game}/ has no code map yet, and the whole game is mapped first: npm run dp -- codemap ${game}.`);
  if (original.console !== 'gba') throw new Error(`Only the Game Boy Advance has a kit so far, and ${game} is for ${original.console}.`);
  const issue = readClaims(repository).gameIssueOf(game);
  if (!issue) throw new Error(`Nobody has claimed ${game} with a New Dreamport issue in ${repository} yet, which comes first: /dreamport does it, and so does the New Dreamport form.`);
  const lead = issue.assignees[0]?.login ?? issue.user.login;

  const files = { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: issue.number, lead, added: new Date().toISOString().slice(0, 10) }) };
  const folder = gameFolder(game);
  const there = Object.keys(files).filter(file => existsSync(join(folder, file)));
  if (there.length) throw new Error(`games/${game}/ already has ${there.join(', ')}. new only starts a game, and writes over nothing.`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), text);
  }
  await portmap([game]);
  if (args.includes('--commit')) {
    const paths = [`games/${game}`, 'README.md', `.github/readme/progress/${game}.svg`];
    execFileSync('git', ['add', '--', ...paths], { cwd: REPO, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', firstFilesMessage(namesOf(original).name, issue.number), '--', ...paths], { cwd: REPO, stdio: 'pipe' });
  }
  console.log(`Written: games/${game}/ with ${Object.keys(files).join(', ')}, for ${lead}, under issue ${issue.number}. Its card waits for a real moment of the game, which a person plays and chooses: npm run dp -- capture ${game}.`);
  return 0;
}
