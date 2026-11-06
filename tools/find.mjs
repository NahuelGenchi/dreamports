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
import { readPartsFile } from './lib/proof-files.mjs';
import { dreamports } from './readme.mjs';
import { notesOfGame } from './notes.mjs';
import { pageOf, percentText } from '../src/lib/entries.mjs';
import { pieceName, whatCanStart } from '../src/lib/pieces.mjs';
import { LANGUAGES } from '../src/lib/languages.mjs';

const USAGE = 'Usage: npm run dp -- find [<game>] [--repo <owner/name>] [--team <owner/name>]';

export async function run(args) {
  const { rest, repo = UPSTREAM, team } = options(args);
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

// a game's open pieces nobody has claimed: those that can start now, and those waiting on something (src/lib/pieces.mjs)
const startable = (game, claims, entry, gathered) => whatCanStart(claims.piecesOf(game, entry), readPartsFile(game), gathered);
const freeText = (game, claims, entry) => {
  const count = claims && startable(game, claims, entry).free.length;
  return claims ? `${count} free piece${count === 1 ? '' : 's'}` : null;
};

// every Dreamport here and every game claimed, one line each
function list(here, claims) {
  const rows = [...here.values()].map(({ game, entry, proof, versions }) => [
    game, entry.title, leadOf(game, claims, entry), [
      proof?.ported && `code ported ${percentText(proof.ported.percent)}`,
      proof?.gameplay && `gameplay proven ${percentText(proof.gameplay.percent)}`,
      ...versions.map(v => v.proof?.ported && `in ${LANGUAGES[v.language].name} ${percentText(v.proof.ported.percent)}`),
      freeText(game, claims, entry),
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

// one game in full
function show(game, local, claims, team) {
  const { entry, proof, versions = [] } = local ?? {};
  const home = claims ? claims.gameIssueOf(game, entry) : null;
  // without the claims, the issue the entry names, in the repository Dreamports are made in
  const homeUrl = home?.html_url ?? (!claims && entry?.issue ? `https://github.com/${UPSTREAM}/issues/${entry.issue}` : null);
  const title = entry?.title ?? `${claims?.nameOf(game) ?? game} Dreamport`;
  const lead = leadOf(game, claims, entry);
  const rows = [];
  const row = (label, ...values) => rows.push([label, values.flat().filter(Boolean)]);
  row('Lead', lead ? `@${lead}` : `nobody${home ? ': /claim on its game\'s issue makes you its lead' : ''}`);
  row('Game issue', homeUrl ? `${homeUrl}, which lists its pieces, and where it's talked about` : 'none yet');
  row('Code ported', proof?.ported ? percentText(proof.ported.percent) : local ? 'not measured yet: it needs a code map' : 'not measured yet');
  row('Gameplay proven', proof?.gameplay ? `${percentText(proof.gameplay.percent)}, ${proof.gameplay.proven} of ${proof.gameplay.total} parts` : local ? 'not measured yet: it needs a list of its parts' : 'not measured yet');
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
    const { free, waiting, needing, isFoundation } = startable(game, claims, entry, gathered);
    const done = pieces.filter(t => t.state !== 'open').length;
    const foundation = t => {
      const count = needing(t);
      return isFoundation(t) ? `, a foundation${count ? `, which ${count} ${count === 1 ? 'piece needs' : 'pieces need'}` : ''}` : '';
    };
    row(`Claimed (${taken.length})`, taken.length ? taken.map(t => `${name(t)}: @${t.assignees.map(a => a.login).join(', @')}`) : 'nothing');
    row(`Free (${free.length})`, free.length ? free.map(t => `${name(t)}${foundation(t)}`)
      : waiting.length ? 'nothing until what the waiting pieces need is finished'
        : `nothing: npm run dp -- tasks ${game} opens one for each part that has none, and the Task form suggests a new one`);
    if (waiting.length) row(`Waiting (${waiting.length})`, waiting.map(({ piece, on }) => `${name(piece)}: needs ${on.map(need => (need.number ? `#${need.number} ${need.name}` : need.name)).join(' and ')}`));
    if (done) row(`Done (${done})`, 'listed in its game\'s issue');
  }
  console.log(`${title}, in games/${game}/${local ? '' : ', not in this folder yet'}\n`);
  const width = Math.max(...rows.map(r => r[0].length)) + 2;
  for (const [label, values] of rows) values.forEach((value, i) => console.log(`  ${(i ? '' : `${label}:`).padEnd(width)}${value}`));
  if (claims) {
    console.log(`\n/claim in a comment on a free task's issue takes it, and /release gives it back. New tasks: https://github.com/${claims.repository}/issues/new?template=task.yml`);
  }
}

