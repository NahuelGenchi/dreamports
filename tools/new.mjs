// npm run dp -- new <game>[/<language>] [--commit] [--repo <owner/name>]: writes the first files of a Dreamport someone has claimed,
// which is mapped already: its page, its code on the console's kit with the controller, touch screen, settings and start
// screen wired in, its license and its entry, so that it builds at once, ready for its capture, with nothing of the game
// in it yet. The claim's issue gives its lead and its number. --commit commits them with the game's map, in the words its
// first entry needs (docs/TEAMS.md#a-games-first-entry). --repo reads the claims of another copy of the repository, such
// as a fork that tries the claims workflow. With a language's folder, as in sonic-battle/c, it starts the game's
// version in that language instead (src/lib/languages.mjs), in games/<game>/c/: its page and its code, with no entry or
// license, which are the game's.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO, gameFolder } from './lib/paths.mjs';
import { LANGUAGES, versionOf } from '../src/lib/languages.mjs';
import { readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { UPSTREAM } from './lib/github.mjs';
import { readClaims } from './lib/claims.mjs';
import { firstFilesMessage, namesOf, startingEntry, startingFiles } from './lib/new-game.mjs';
import { run as portmap } from './portmap.mjs';
import { STATUS, writeReadme } from './readme.mjs';
import { consoleOf } from './consoles.mjs';
import { forGame } from './lib/screens.mjs';

const USAGE = 'Usage: npm run dp -- new <game>[/c] [--commit] [--repo <owner/name>]';

export async function run(args) {
  const at = args.indexOf('--repo');
  const repository = at >= 0 ? args[at + 1] : UPSTREAM;
  const game = args.find((a, i) => !a.startsWith('--') && (at < 0 || i !== at + 1));
  if (!game || !repository) throw new Error(USAGE);
  const { game: base, language } = versionOf(game);
  // a version has no original of its own until its page is there, which this writes
  const original = readOriginal(base);
  if (!readCodeMap(base)) throw new Error(`games/${base}/ has no code map yet, and the whole game is mapped first: npm run dp -- codemap ${base}.`);
  forGame(consoleOf(original.console), original);
  const issue = readClaims(repository).gameIssueOf(base);
  if (!issue) throw new Error(`Nobody has claimed ${base} with a New Dreamport issue in ${repository} yet, which comes first: /dreamport does it, and so does the New Dreamport form.`);
  const lead = issue.assignees[0]?.login ?? issue.user.login;
  // a version in another language belongs to a game that's started, whose entry and license it shares
  if (language !== 'js' && !existsSync(join(gameFolder(base), 'entry.md'))) throw new Error(`games/${base}/ hasn't started yet, and a game starts in JavaScript: npm run dp -- new ${base}.`);

  const files = language !== 'js' ? startingFiles(base, original, { language })
    : { ...startingFiles(game, original), 'entry.md': startingEntry(game, original, { issue: issue.number, lead, added: new Date().toISOString().slice(0, 10) }) };
  const folder = gameFolder(game);
  const there = Object.keys(files).filter(file => existsSync(join(folder, file)));
  if (there.length) throw new Error(`games/${game}/ already has ${there.join(', ')}. new only starts a game, and writes over nothing.`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), text);
  }
  await portmap([game]);
  // a first entry brings its own row and map, as nothing else has them until it's on main
  writeReadme();
  if (args.includes('--commit')) {
    const paths = [`games/${game}`, STATUS, `.github/readme/progress/${game.replaceAll('/', '-')}.svg`];
    const name = language === 'js' ? namesOf(original).name : `${namesOf(original).name} in ${LANGUAGES[language].name}`;
    execFileSync('git', ['add', '--', ...paths], { cwd: REPO, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', firstFilesMessage(name, issue.number), '--', ...paths], { cwd: REPO, stdio: 'pipe' });
  }
  console.log(language !== 'js'
    ? `Written: games/${game}/ with ${Object.keys(files).join(', ')}, for ${lead}, under issue ${issue.number}. It plays at /play/${game}/, and its numbers start from nothing.`
    : `Written: games/${game}/ with ${Object.keys(files).join(', ')}, for ${lead}, under issue ${issue.number}. Its card waits for a real moment of the game, which a person plays and chooses: npm run dp -- capture ${game}.`);
  return 0;
}
