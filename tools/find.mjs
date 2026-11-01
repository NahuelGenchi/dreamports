// npm run dp -- find [<game>] [--repo <owner/name>] [--team <owner/name>]: where a game stands, so nobody does the
// same work twice: its lead, its game's issue, its two numbers, its Make page, its team build and team preview,
// and its pieces, the issues under its game's issue, with who has claimed which and the ones still free (docs/TEAMS.md). <game> is a game's folder or a few words of its name, and a name also
// finds the site's other games, such as a port made elsewhere. With no game it lists every Dreamport and every game
// claimed with a New Dreamport issue. The numbers come from games/ in this folder, and the claims and pieces from the
// repository's issues, through the GitHub CLI. --repo reads the claims of another copy of the repository, such as a
// fork that tries the claims workflow, and --team names the fork with the lead's team build when it isn't the
// lead's own, such as one of an organisation's.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { REPO } from './lib/paths.mjs';
import { UPSTREAM, pagesOf } from './lib/github.mjs';
import { readClaims, leadOf, teamBuildOf } from './lib/claims.mjs';
import { dreamports } from './readme.mjs';
import { pageOf, percentText } from '../src/lib/entries.mjs';

const USAGE = 'Usage: npm run dp -- find [<game>] [--repo <owner/name>] [--team <owner/name>]';
const SECTIONS = { external: ['external-ports', 'a port made elsewhere'], other: ['other-games', 'another fan game'] };

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
  const others = otherGames().filter(g => key(g.title).includes(words));
  if (found.length === 1) show(found[0], here.get(found[0]), claims, team);
  else if (found.length) console.log(`More than one Dreamport goes by "${rest.join(' ')}": ${found.join(', ')}. npm run dp -- find <folder> shows one.`);
  else {
    console.log(`Nobody makes a Dreamport of "${rest.join(' ')}" yet${claims ? '' : ' in this folder'}. /dreamport-claim claims it for you, as its lead, and so does the New Dreamport form: https://github.com/${repo}/issues/new?template=new-dreamport.yml`);
  }
  for (const other of others) console.log(`\n${other.title} is on the site as ${SECTIONS[other.kind][1]}: https://dreamports.net/${SECTIONS[other.kind][0]}/${other.id}/`);
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

// the open pieces of a game nobody has claimed
const freeOf = (game, claims, entry) => claims.piecesOf(game, entry).filter(p => p.state === 'open' && !p.assignees.length);
const freeText = (game, claims, entry) => {
  const count = claims && freeOf(game, claims, entry).length;
  return claims ? `${count} free piece${count === 1 ? '' : 's'}` : null;
};

// every Dreamport here and every game claimed, one line each
function list(here, claims) {
  const rows = [...here.values()].map(({ game, entry, proof }) => [
    game, entry.title, leadOf(game, claims, entry), [
      proof?.ported && `code ported ${percentText(proof.ported.percent)}`,
      proof?.gameplay && `gameplay proven ${percentText(proof.gameplay.percent)}`,
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
  const { entry, proof } = local ?? {};
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
  if (entry) row('Its page', `https://dreamports.net/dreamports/${pageOf(game)}/`);
  // a Dreamport has a page in the Make row until every part of it is proven (docs/MAKE.md)
  if (entry && proof?.gameplay?.percent !== 100) row('Make page', `https://dreamports.net/make/${game}/, with its steps and the pieces free to take`);
  const build = lead && teamBuildOf(lead, game, team);
  row('Team build', build ? `${build.url}, which npm run dp -- team ${game} join starts from` : `none yet${lead ? `: @${lead} makes it with npm run dp -- team ${game} start` : ''}`);
  const site = !entry?.preview && build ? pagesOf(build.repository)?.url : null;
  row('Team preview', entry?.preview ?? (site ? `${site}${game}/` : 'none yet'));
  if (claims) {
    const pieces = claims.piecesOf(game, entry);
    const name = t => `#${t.number} ${t.title.replace(/^Task:\s*/i, '')}`;
    const taken = pieces.filter(t => t.state === 'open' && t.assignees.length), free = freeOf(game, claims, entry);
    const done = pieces.filter(t => t.state !== 'open').length;
    row(`Claimed (${taken.length})`, taken.length ? taken.map(t => `${name(t)}: @${t.assignees.map(a => a.login).join(', @')}`) : 'nothing');
    row(`Free (${free.length})`, free.length ? free.map(name) : 'nothing: the Task form suggests a new task');
    if (done) row(`Done (${done})`, 'listed in its game\'s issue');
  }
  console.log(`${title}, in games/${game}/${local ? '' : ', not in this folder yet'}\n`);
  const width = Math.max(...rows.map(r => r[0].length)) + 2;
  for (const [label, values] of rows) values.forEach((value, i) => console.log(`  ${(i ? '' : `${label}:`).padEnd(width)}${value}`));
  if (claims) {
    console.log(`\n/claim in a comment on a free task's issue takes it, and /release gives it back. New tasks: https://github.com/${claims.repository}/issues/new?template=task.yml`);
  }
}

// the site's other games, such as ports made elsewhere: [{ id, title, kind }]
function otherGames() {
  const folder = join(REPO, 'src', 'content', 'games');
  return readdirSync(folder).filter(f => f.endsWith('.md')).map(f => {
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(folder, f), 'utf8'));
    const data = front ? parse(front[1]) : {};
    return { id: f.slice(0, -3), title: data.title ?? f, kind: data.kind };
  }).filter(g => SECTIONS[g.kind]);
}
