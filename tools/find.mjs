// npm run dp -- find [<game>] [--repo <owner/name>] [--team <owner/name>]: where a game stands, so nobody does the
// same work twice: its lead, its game's issue, its two numbers and its versions' in other languages, its Make page, its team build and team preview,
// and its pieces, the issues under its game's issue, with who has claimed which, the ones free to start and what the
// others wait on (docs/TEAMS.md), and how many notes people have left on it (docs/NOTES.md). <game> is a game's folder or a few words of its name.
// With no game it lists every Dreamport and every game
// claimed with a New Dreamport issue. The numbers come from games/ in this folder, and the claims and pieces from the
// repository's issues, through the GitHub CLI. --repo reads the claims of another copy of the repository, such as a
// fork that tries the claims workflow, and --team names the fork with the lead's team build when it isn't the
// lead's own, such as one of an organisation's.

import { UPSTREAM, pagesOf } from './lib/github.mjs';
import { readClaims, leadOf, teamBuildOf, gatheredIn } from './lib/claims.mjs';
import { readOriginal, readPartsFile } from './lib/proof-files.mjs';
import { dreamports } from './readme.mjs';
import { notesOfGame } from './notes.mjs';
import { pageOf, percentText } from '../src/lib/entries.mjs';
import { pieceName, pieceOf, whatCanStart } from '../src/lib/pieces.mjs';
import { LANGUAGES, OTHER_LANGUAGES, mainLanguage, playOrder, versionOf } from '../src/lib/languages.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib/paths.mjs';

const USAGE = 'Usage: npm run dp -- find [<game>] [--repo <owner/name>] [--team <owner/name>]';

export async function run(args) {
  const { rest: words0, repo = UPSTREAM, team } = options(args);
  // a version in another language is found as its game, as in sonic-battle/c
  const rest = words0.map(word => (word.includes('/') ? (() => { try { return versionOf(word).game; } catch { return word; } })() : word));
  const here = new Map(dreamports().map(d => [d.game, d]));
  let claims = null;
  try {
    claims = readClaims(repo);
  } catch (error) {
    console.log(`The claims and tasks need ${repo}'s issues, which couldn't be read: ${error.message}\n`);
  }
  const key = text => (text ?? '').toLowerCase().replace(/\bdreamport\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = key(rest.join(' '));
  if (!words) return list(here, claims);

  const claimed = claims ? [...claims.leads.keys()] : [];
  const folder = rest.join('-').toLowerCase();
  const found = here.has(folder) || claimed.includes(folder) ? [folder] : [...new Set([
    ...[...here.values()].filter(d => key(d.entry.title).includes(words) || key(d.game).includes(words)).map(d => d.game),
    ...claimed.filter(g => key(claims.nameOf(g)).includes(words) || key(g).includes(words)),
  ])];
  if (found.length === 1) show(found[0], here.get(found[0]), claims, team);
  else if (found.length) console.log(`More than one Dreamport goes by "${rest.join(' ')}": ${found.join(', ')}. npm run dp -- find <folder> shows one.`);
  else {
    console.log(`Nobody makes a Dreamport of "${rest.join(' ')}" yet${claims ? '' : ' in this folder'}. /dreamport starts it for you, as its lead, and so does the New Dreamport form: https://github.com/${repo}/issues/new?template=new-dreamport.yml`);
  }
  return 0;
}

function options(args) {
  const found = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--repo' || arg === '--team') {
      if (!/^[\w.-]+\/[\w.-]+$/.test(args[i + 1] ?? '')) throw new Error(`${arg} needs a repository, as owner/name.\n${USAGE}`);
      found[arg.slice(2)] = args[++i];
    } else if (arg.startsWith('--')) throw new Error(`find has no ${arg}.\n${USAGE}`);
    else found.rest.push(arg);
  }
  return found;
}

// the console a game here is on, or null
function consoleOf(game) {
  try {
    return readOriginal(game).console;
  } catch {
    return null;
  }
}

// the language of a game's main version (src/lib/languages.mjs): the one here, or for a game not in this folder, JavaScript
// when it has a piece in it, or else the language its pieces are in, as a game that started in C has them in C alone
function mainOf(local, pieces) {
  if (local) return local.language ?? 'js';
  const languages = [...new Set(pieces.map(t => pieceOf(t).language))];
  return languages.length ? mainLanguage(languages) : 'js';
}

// a game's open pieces nobody has claimed: those that can start now, some on top of a pull request in review, and those
// waiting on something (src/lib/pieces.mjs)
const startable = (game, claims, entry, gathered, local) => {
  const pieces = claims.piecesOf(game, entry);
  return whatCanStart(pieces, readPartsFile(game), gathered, { main: mainOf(local, pieces), reviewing: claims.reviewing() });
};
const freeText = (game, claims, entry, local) => {
  const count = claims && startable(game, claims, entry, new Set(), local).free.length;
  return claims ? `${count} free piece${count === 1 ? '' : 's'}` : null;
};

// every Dreamport here and every game claimed, one line each
function list(here, claims) {
  const rows = [...here.values()].map(local => [
    local.game, local.entry.title, leadOf(local.game, claims, local.entry), [
      local.proof?.ported && `code ported${inName(local.language)} ${percentText(local.proof.ported.percent)}`,
      local.proof?.gameplay && `gameplay proven${inName(local.language)} ${percentText(local.proof.gameplay.percent)}`,
      ...local.versions.map(v => v.proof?.ported && `in ${LANGUAGES[v.language].name} ${percentText(v.proof.ported.percent)}`),
      freeText(local.game, claims, local.entry, local),
    ].filter(Boolean).join(', '),
  ]);
  for (const [game, issue] of claims?.leads ?? []) {
    if (!here.has(game)) rows.push([game, `${claims.nameOf(game)} Dreamport`, leadOf(game, claims), `claimed in #${issue.number}, ${freeText(game, claims)}`]);
  }
  if (!rows.length) console.log('No Dreamports yet.');
  const width = column => Math.max(...rows.map(r => (r[column] ?? '').length));
  for (const [game, title, lead, more] of rows) {
    console.log(`${game.padEnd(width(0))}  ${title.padEnd(width(1))}  ${(lead ? `@${lead}` : 'no lead').padEnd(width(2) + 1)}  ${more}`);
  }
  console.log('\nnpm run dp -- find <game> shows one in full: its claims, its free tasks and its team build.');
  return 0;
}

// " in C" after a number of a version in another language than JavaScript, and nothing after JavaScript's
const inName = language => (!language || language === 'js' ? '' : ` in ${LANGUAGES[language].name}`);

// one game in full
function show(game, local, claims, team) {
  const { entry, proof, versions = [] } = local ?? {};
  const named = inName(local?.language);
  const home = claims ? claims.gameIssueOf(game, entry) : null;
  // without the claims, the issue the entry names, in the repository Dreamports are made in
  const homeUrl = home?.html_url ?? (!claims && entry?.issue ? `https://github.com/${UPSTREAM}/issues/${entry.issue}` : null);
  const title = entry?.title ?? `${claims?.nameOf(game) ?? game} Dreamport`;
  const lead = leadOf(game, claims, entry);
  const rows = [];
  const row = (label, ...values) => rows.push([label, values.flat().filter(Boolean)]);
  let stacked = false;
  row('Lead', lead ? `@${lead}` : `nobody${home ? ': /claim on its game\'s issue makes you its lead' : ''}`);
  row('Game issue', homeUrl ? `${homeUrl}, which lists its pieces, and where it's talked about` : 'none yet');
  row(`Code ported${named}`, proof?.ported ? percentText(proof.ported.percent) : local ? 'not measured yet: it needs a code map' : 'not measured yet');
  row(`Gameplay proven${named}`, proof?.gameplay ? `${percentText(proof.gameplay.percent)}, ${proof.gameplay.proven} of ${proof.gameplay.total} parts` : local ? 'not measured yet: it needs a list of its parts' : 'not measured yet');
  for (const { name, language, proof: theirs } of versions) {
    const called = LANGUAGES[language].name;
    row(`Code ported in ${called}`, theirs?.ported ? `${percentText(theirs.ported.percent)}, in games/${name}/` : 'not measured yet');
    row(`Gameplay proven in ${called}`, theirs?.gameplay ? `${percentText(theirs.gameplay.percent)}, ${theirs.gameplay.proven} of ${theirs.gameplay.total} parts` : 'not measured yet');
  }
  const fromStart = (proof?.gameplay?.parts ?? []).filter(part => part.proven && part.fromStart);
  if (fromStart.length) row('From a start point', fromStart.map(part => part.name), 'each proven again from power-on once the game reaches it');
  if (entry) row('Its page', `https://dreamports.net/dreamports/${pageOf(game)}/`);
  // a Dreamport has a page in the Make row from its capture until every part of it is proven (docs/MAKE.md)
  if (entry?.screen && proof?.gameplay?.percent !== 100) row('Make page', `https://dreamports.net/make/${game}/, with its steps and the pieces free to take`);
  if (entry) {
    const notes = notesOfGame(game).length;
    row('Notes', notes ? `${notes} on what people found making it: npm run dp -- notes ${game} lists them` : 'none yet');
  }
  const build = lead && teamBuildOf(lead, game, team);
  row('Team build', build ? `${build.url}, which npm run dp -- team ${game} join starts from` : `none yet${lead ? `: @${lead} makes it with npm run dp -- team ${game} start` : ''}`);
  const site = !entry?.preview && build ? pagesOf(build.repository)?.url : null;
  row('Team preview', entry?.preview ?? (site ? `${site}${game}/` : 'none yet'));
  if (claims) {
    const pieces = claims.piecesOf(game, entry);
    const name = t => `#${t.number} ${pieceName(t)}`;
    const taken = pieces.filter(t => t.state === 'open' && t.assignees.length);
    const gathered = build ? gatheredIn(build) : new Set();
    const { free, waiting, buildsOn, needing, isFoundation } = startable(game, claims, entry, gathered, local);
    const reviewing = claims.reviewing();
    // a free piece on top of pull requests in review, which its branch starts from
    const onTop = t => (buildsOn(t).length ? `, on top of ${buildsOn(t).map(b => `#${b.pull}, which has #${b.number} ${b.name} in review`).join(' and ')}` : '');
    const done = pieces.filter(t => t.state !== 'open').length;
    const foundation = t => {
      const count = needing(t);
      return isFoundation(t) ? `, a foundation${count ? `, which ${count} ${count === 1 ? 'piece needs' : 'pieces need'}` : ''}` : '';
    };
    row(`Claimed (${taken.length})`, taken.length ? taken.map(t => `${name(t)}: @${t.assignees.map(a => a.login).join(', @')}${reviewing.has(t.number) ? `, in review in #${reviewing.get(t.number)}` : ''}`) : 'nothing');
    // the free pieces in each language, the default's first (src/lib/languages.mjs): a game whose console has a kit in
    // another language lists them apart, even with none, so it shows where a version in that language stands. A game
    // that started in C has no JavaScript version, and lists JavaScript only once it has a piece in it
    const main = mainOf(local, pieces);
    const inOthers = OTHER_LANGUAGES.filter(language => language === main || versions.some(v => v.language === language)
      || pieces.some(t => pieceOf(t).language === language) || existsSync(join(REPO, 'kit', consoleOf(game) ?? '-', LANGUAGES[language].folder)));
    const languages = playOrder([...(main === 'js' || pieces.some(t => pieceOf(t).language === 'js') ? ['js'] : []), ...inOthers]);
    const apart = languages.length > 1 || languages[0] !== 'js';
    for (const language of languages) {
      const theirs = free.filter(t => pieceOf(t).language === language);
      const version = language === 'js' ? game : `${game}/${LANGUAGES[language].folder}`;
      const has = language === main || versions.some(v => v.language === language);
      row(`Free${apart ? ` in ${LANGUAGES[language].name}` : ''} (${theirs.length})`, theirs.length ? theirs.map(t => `${name(t)}${foundation(t)}${onTop(t)}`)
        : !has ? `nothing: it has no version in ${LANGUAGES[language].name} yet, which npm run dp -- new ${version} starts, and npm run dp -- tasks ${version} then opens its tasks`
          : waiting.some(w => pieceOf(w.piece).language === language) ? 'nothing until what the waiting pieces need is finished'
            : `nothing: npm run dp -- tasks ${version} opens one for each part that has none, and the Task form suggests a new one`);
    }
    if (waiting.length) row(`Waiting (${waiting.length})`, waiting.map(({ piece, on }) => `${name(piece)}: needs ${on.map(need => `${need.number ? `#${need.number} ${need.name}` : need.name}${need.pull ? ` (in review in #${need.pull})` : ''}`).join(' and ')}`));
    stacked = free.some(t => buildsOn(t).length);
    if (done) row(`Done (${done})`, 'listed in its game\'s issue');
  }
  console.log(`${title}, in games/${local?.name ?? game}/${local ? '' : ', not in this folder yet'}\n`);
  const width = Math.max(...rows.map(r => r[0].length)) + 2;
  for (const [label, values] of rows) values.forEach((value, i) => console.log(`  ${(i ? '' : `${label}:`).padEnd(width)}${value}`));
  if (claims) {
    console.log(`\n/claim in a comment on a free task's issue takes it, and /release gives it back. New tasks: https://github.com/${claims.repository}/issues/new?template=task.yml`);
    if (stacked) console.log('A piece on top of a pull request starts from the latest main with that pull request merged in, and its own pull request merges after it (docs/TEAMS.md, Building on a piece in review).');
  }
}

