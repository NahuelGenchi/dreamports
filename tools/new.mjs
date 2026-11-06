// npm run dp -- new <game>[/<language>] [--commit] [--repo <owner/name>]: writes the first files of a Dreamport someone has claimed,
// which is mapped already: its page, its code on the console's kit with the controller, touch screen, settings and start
// screen wired in, its license and its entry, so that it builds at once, ready for its capture, with nothing of the game
// in it yet. The claim's issue gives its lead and its number. --commit commits them with the game's map, in the words its
// first entry needs (docs/TEAMS.md#a-games-first-entry). --repo reads the claims of another copy of the repository, such
// as a fork that tries the claims workflow. With a language's folder, as in sonic-battle/c, it starts the game's
// version in that language (src/lib/languages.mjs), in games/<game>/c/: its page and its code. A game that has started
// already has its entry and license, which the version shares, and a game that hasn't gets them too, and starts in that
// language alone, as a new game starts in C, with no JavaScript version until someone adds one with new <game>.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { REPO, gameFolder } from './lib/paths.mjs';
import { LANGUAGES, versionOf } from '../src/lib/languages.mjs';
import { readCodeMap, readOriginal } from './lib/proof-files.mjs';
import { UPSTREAM } from './lib/github.mjs';
import { readClaims } from './lib/claims.mjs';
import { firstFiles, firstFilesMessage, namesOf, startingFiles } from './lib/new-game.mjs';
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
  // a game that has started has its entry and license, which a version in another language shares; one that hasn't
  // starts with its first version, in JavaScript or, as new games do, in C
  const started = existsSync(join(gameFolder(base), 'entry.md'));
  const files = started && language !== 'js' ? startingFiles(base, original, { language })
    : firstFiles(base, original, { language, issue: issue.number, lead, added: new Date().toISOString().slice(0, 10) });
  const folder = gameFolder(started ? game : base);
  const there = Object.keys(files).filter(file => existsSync(join(folder, file)));
  if (there.length) throw new Error(`${relative(REPO, folder)}/ already has ${there.join(', ')}. new only starts a game, and writes over nothing.`);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, file)), { recursive: true });
    writeFileSync(join(folder, file), text);
  }
  await portmap([game]);
  // a first entry brings its own row and map, as nothing else has them until it's on main
  writeReadme();
  if (args.includes('--commit')) {
    const paths = [started ? `games/${game}` : `games/${base}`, STATUS, `.github/readme/progress/${game.replaceAll('/', '-')}.svg`];
    // a game's first files are its own, in whichever language it starts, and a version's are the game's in that language
    const name = !started || language === 'js' ? namesOf(original).name : `${namesOf(original).name} in ${LANGUAGES[language].name}`;
    execFileSync('git', ['add', '--', ...paths], { cwd: REPO, stdio: 'pipe' });
    execFileSync('git', ['commit', '--quiet', '-m', firstFilesMessage(name, issue.number), '--', ...paths], { cwd: REPO, stdio: 'pipe' });
  }
  console.log(started && language !== 'js'
    ? `Written: games/${game}/ with ${Object.keys(files).join(', ')}, for ${lead}, under issue ${issue.number}. It plays at /play/${game}/, and its numbers start from nothing.`
    : `Written: ${relative(REPO, folder)}/ with ${Object.keys(files).join(', ')}, for ${lead}, under issue ${issue.number}. Its card waits for a real moment of the game, which a person plays and chooses: npm run dp -- capture ${base}.`);
  return 0;
}
