// Keeps each game's progress map at the top of its game's issue (docs/TEAMS.md#how-the-bot-works), from
// .github/workflows/issue-maps.yml: the map of the version Dreamports are made in first, its version in C, open, and each
// of its versions in other languages under it, folded in a section that names the language and its two numbers
// (src/lib/languages.mjs). The proof tools draw the maps, which the workflow has them do from main's proof files just
// before this runs, so nothing here draws anything: it keeps those pictures under a ref of their own and puts them in
// the issues. main's own copies wait for the Readme workflow, which runs a few times a day, and an issue that showed
// those was hours behind every merge (#1102). An issue shows a game's map only when the game's entry names that issue,
// and an issue's text is only read as data. The picture's address holds the commit that last changed the map under
// that ref, so a new map is a new address, which GitHub's image cache can't answer with the old picture.
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { field, isNewDreamport } from '../../tools/lib/claims.mjs';
import { LANGUAGES, playOrder, versionName, versionOf } from '../../src/lib/languages.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const START = '<!-- dreamports-map -->', END = '<!-- /dreamports-map -->';
const BLOCK = /<!-- dreamports-map -->[\s\S]*?<!-- \/dreamports-map -->\s*/g;

/**
 * Where the pictures the issues show are kept: a ref that is no branch and no tag, so keeping a map there puts no
 * commit on main, starts no build of the site at Cloudflare, which builds every branch, and comes with nobody's copy
 * of the repository.
 */
export const REF = 'refs/dreamports/issue-maps';

/** A game's map, or with a version's name, such as sonic-battle/c, that version's (src/lib/entries.mjs). */
export const mapOf = game => `.github/readme/progress/${game.replaceAll('/', '-')}.svg`;

/**
 * Keeps the maps in `folder` under REF, where main keeps its own, as one more commit on top of the ones before when
 * any map changed, and gives the newest commit there. `head` is the commit of main they were drawn from.
 */
export async function keep({ folder, head, api }) {
  const maps = dirname(mapOf('game'));
  const tree = readdirSync(join(folder, maps)).filter(name => name.endsWith('.svg')).sort()
    .map(name => ({ path: `${maps}/${name}`, mode: '100644', type: 'blob', content: readFileSync(join(folder, maps, name), 'utf8') }));
  const name = REF.replace(/^refs\//, '');
  const kept = (await api(`/git/ref/${name}`))?.object.sha ?? null;
  const { sha: drawn } = await api('/git/trees', 'POST', { tree });
  if (kept && (await api(`/git/commits/${kept}`)).tree.sha === drawn) return kept;
  const { sha } = await api('/git/commits', 'POST', { message: `The progress maps of ${head}`, tree: drawn, parents: kept ? [kept] : [] });
  if (kept) await api(`/git/refs/${name}`, 'PATCH', { sha });
  else await api('/git/refs', 'POST', { ref: REF, sha });
  return sha;
}

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
async function pictureOf(game, { folder, repository, kept, api }) {
  const [{ sha }] = await api(`/commits?sha=${kept}&path=${encodeURIComponent(mapOf(game))}&per_page=1`);
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

/**
 * Brings every game's issue up to date from the maps in `folder`, drawn from the commit `head` of main, editing only
 * what changed, and gives the numbers of the issues it edited.
 */
export async function update({ folder, repository, head, api }) {
  const games = [];
  for (let page = 1, full = true; full; page++) {
    // nothing comes back from a copy of the repository with its issues turned off
    const issues = (await api(`/issues?labels=new-dreamport&state=all&per_page=100&page=${page}`)) ?? [];
    full = issues.length === 100;
    for (const issue of issues) {
      if (issue.pull_request || !isNewDreamport(issue)) continue;
      const game = field(issue.body, 'Game folder').replace(/`/g, '').trim();
      games.push({ issue, versions: NAME.test(game) && issueNamedBy(folder, game) === issue.number ? versionsOf(folder, game) : [] });
    }
  }
  // nothing is kept for a copy of the repository whose issues show no map
  const kept = games.some(({ versions }) => versions.length) ? await keep({ folder, head, api }) : null;
  const edited = [];
  for (const { issue, versions } of games) {
    const pictures = [];
    for (const [i, version] of versions.entries()) {
      const map = await pictureOf(version, { folder, repository, kept, api });
      pictures.push(i ? folded(version, map) : map.picture);
    }
    const body = versions.length ? withMap(issue.body, pictures.join('\n\n')) : withoutMap(issue.body);
    if (body === issue.body) continue;
    await api(`/issues/${issue.number}`, 'PATCH', { body });
    edited.push(issue.number);
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
