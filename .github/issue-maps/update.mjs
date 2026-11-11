// Keeps each game's progress map at the top of its game's issue (docs/TEAMS.md#how-the-bot-works), from
// .github/workflows/issue-maps.yml: the map of the version Dreamports are made in first, its version in C, open, and each
// of its versions in other languages under it, folded in a section that names the language and its two numbers
// (src/lib/languages.mjs). The proof tools draw the map and npm run check holds it to the game's proof/ folder,
// so nothing here draws anything: it only puts that picture in the issue. An issue shows a game's map only when the
// game's entry names that issue, and an issue's text is only read as data. The picture's address holds the commit that
// last changed the map, so a new map is a new address, which GitHub's image cache can't answer with the old picture.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { field, isNewDreamport } from '../../tools/lib/claims.mjs';
import { LANGUAGES, playOrder, versionName, versionOf } from '../../src/lib/languages.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const START = '<!-- dreamports-map -->', END = '<!-- /dreamports-map -->';
const BLOCK = /<!-- dreamports-map -->[\s\S]*?<!-- \/dreamports-map -->\s*/g;

/** A game's map, or with a version's name, such as sonic-battle/c, that version's (src/lib/entries.mjs). */
export const mapOf = game => `.github/readme/progress/${game.replaceAll('/', '-')}.svg`;

// each of a game's versions with a page and a map, as the maps are named, in the order they're played in: its version
// in C first, and its JavaScript one last. A game that started in C, with no JavaScript version, has only its version
// in C's
const versionsOf = (folder, game) => playOrder(Object.keys(LANGUAGES)).map(language => versionName(game, language))
  .filter(version => (version === game || existsSync(join(folder, 'games', version, 'index.html'))) && existsSync(join(folder, mapOf(version))));

/** An issue's text with no map in it. */
export const withoutMap = body => body.replace(BLOCK, '');

/** An issue's text with this picture at the top, above the headings the claims workflow and the tools read. */
export const withMap = (body, picture) => `${START}\n\n${picture}\n\n${END}\n\n${withoutMap(body)}`;

/** The issue a game's entry names, or null when it has no entry yet. */
function issueNamedBy(folder, game) {
  const entry = join(folder, 'games', game, 'entry.md');
  return existsSync(entry) ? Number(/^issue:\s*(\d+)\s*$/m.exec(readFileSync(entry, 'utf8'))?.[1]) || null : null;
}

/** The map as a picture, with the numbers its title says for anyone who can't see it, and that title. */
async function pictureOf(game, { folder, repository, head, api }) {
  const [{ sha }] = await api(`/commits?sha=${head}&path=${encodeURIComponent(mapOf(game))}&per_page=1`);
  const title = /<title>([^<]*)<\/title>/.exec(readFileSync(join(folder, mapOf(game)), 'utf8'))[1];
  return { title, picture: `![${title.replace(/[\\[\]]/g, '\\$&')}](https://raw.githubusercontent.com/${repository}/${sha}/${mapOf(game)})` };
}

/**
 * A version's map folded away, under a line that names its language and its two numbers as the map's title has them,
 * which opens with a click. The blank lines are what make GitHub read the picture inside it.
 */
function folded(version, { title, picture }) {
  const numbers = [['code ported', /Code ported: (\d+(?:\.\d+)?%)/], ['gameplay proven', /Gameplay proven: (\d+(?:\.\d+)?%)/]]
    .map(([name, find]) => [name, find.exec(title)?.[1]]).filter(([, percent]) => percent).map(number => number.join(' '));
  const summary = [`${LANGUAGES[versionOf(version).language].name} version`, numbers.join(', ')].filter(Boolean).join(': ');
  return `<details>\n<summary>${summary}</summary>\n\n${picture}\n\n</details>`;
}

/** Brings every game's issue up to date, editing only what changed, and gives the numbers of the issues it edited. */
export async function update({ folder, repository, head, api }) {
  const edited = [];
  for (let page = 1, full = true; full; page++) {
    // nothing comes back from a copy of the repository with its issues turned off
    const issues = (await api(`/issues?labels=new-dreamport&state=all&per_page=100&page=${page}`)) ?? [];
    full = issues.length === 100;
    for (const issue of issues) {
      if (issue.pull_request || !isNewDreamport(issue)) continue;
      const game = field(issue.body, 'Game folder').replace(/`/g, '').trim();
      const versions = NAME.test(game) && issueNamedBy(folder, game) === issue.number ? versionsOf(folder, game) : [];
      const shows = versions.length > 0;
      const pictures = [];
      for (const [i, version] of versions.entries()) {
        const map = await pictureOf(version, { folder, repository, head, api });
        pictures.push(i ? folded(version, map) : map.picture);
      }
      const body = shows ? withMap(issue.body, pictures.join('\n\n')) : withoutMap(issue.body);
      if (body === issue.body) continue;
      await api(`/issues/${issue.number}`, 'PATCH', { body });
      edited.push(issue.number);
    }
  }
  return edited;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repository = process.env.GITHUB_REPOSITORY;
  const api = async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
      method, signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (method === 'GET' && (response.status === 404 || response.status === 410)) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  };
  const edited = await update({ folder: resolve(import.meta.dirname, '../..'), repository, head: process.env.GITHUB_SHA, api });
  const said = edited.length ? `Brought up to date: ${edited.map(number => `#${number}`).join(', ')}.` : 'Every game\'s issue was already up to date.';
  console.log(said);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${said}\n`);
}
