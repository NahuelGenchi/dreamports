// npm run dp -- readme [--check]: writes the table of Dreamports in README.md from each Dreamport's entry,
// games/<game>/entry.md, with its code ported and gameplay proven from its proof/ folder, and its lead, and each
// Dreamport's progress map, in .github/readme/progress/<game>.svg, which the table links. `prove` and `portmap` write
// them too, after they change a game's numbers, so nobody types them. With --check it changes nothing and fails when
// the table or a map is out of date, or when an entry doesn't agree with its folder, which `npm run check` uses.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse } from 'yaml';
import { REPO } from './lib/paths.mjs';
import { ENTRY, mapOf, percentText, proofOf } from '../src/lib/entries.mjs';
import { progressMap } from '../src/lib/progress-map.mjs';

const README = join(REPO, 'README.md');
const START = '<!-- The proof tools write this table from each Dreamport\'s entry: npm run dp -- readme. -->';
const END = '<!-- End of the table of Dreamports. -->';

export async function run(args) {
  const check = args.includes('--check');
  const { changed, files } = writeReadme({ check });
  if (check && changed) throw new Error(`Out of date: ${files.join(', ')}. npm run dp -- readme writes them again.`);
  console.log(check ? 'README.md\'s table of Dreamports and the progress maps are up to date.'
    : changed ? `Updated: ${files.join(', ')}.` : 'README.md\'s table of Dreamports and the progress maps were already up to date.');
  return 0;
}

/**
 * Writes the table in README.md and each Dreamport's progress map, and removes the map of a game that's gone, or only
 * compares them with `check`: { changed, files }, with the files that changed, or would.
 */
export function writeReadme({ check = false } = {}) {
  const list = dreamports();
  const text = readFileSync(README, 'utf8');
  const start = text.indexOf(START), end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README.md has lost the lines that mark its table of Dreamports:\n${START}\n${END}`);
  // blank lines around the table, so GitHub doesn't read the lines that mark it as part of it
  const files = new Map([[README, `${text.slice(0, start + START.length)}\n\n${table(list)}\n\n${text.slice(end)}`]]);
  for (const { game, entry } of list) files.set(join(REPO, mapOf(game)), progressMap(game, readProofFiles(game), entry.title).svg);
  const changed = [];
  for (const [file, next] of files) {
    if (existsSync(file) && readFileSync(file, 'utf8') === next) continue;
    changed.push(file);
    if (!check) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, next);
    }
  }
  const maps = dirname(join(REPO, mapOf('game')));
  for (const name of existsSync(maps) ? readdirSync(maps) : []) {
    const file = join(maps, name);
    if (files.has(file)) continue;
    changed.push(file);
    if (!check) rmSync(file);
  }
  return { changed: changed.length > 0, files: changed.map(file => relative(REPO, file)) };
}

/** Every Dreamport's entry and what its proof measures, newest first, as the site lists them. */
export function dreamports() {
  const games = join(REPO, 'games');
  const found = readdirSync(games, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(games, d.name, ENTRY)))
    .map(d => d.name);
  return found.map(game => ({ game, entry: readEntry(game), proof: readProof(game) }))
    .map(({ game, entry, proof }) => (checkEntry(game, entry, proof), { game, entry, proof }))
    .sort((a, b) => new Date(b.entry.added) - new Date(a.entry.added));
}

function readEntry(game) {
  const text = readFileSync(join(REPO, 'games', game, ENTRY), 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) throw new Error(`games/${game}/${ENTRY} has no fields between two --- lines at its top.`);
  return parse(front[1]);
}

/** What a game's proof folder measures (proofOf), from its files. */
export const readProof = game => proofOf(game, readProofFiles(game));

/** A game's proof files, as proofOf takes them. */
function readProofFiles(game) {
  const folder = join(REPO, 'games', game, 'proof');
  const read = name => {
    const file = join(folder, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  };
  const progress = read('progress.json');
  for (const name of Object.keys(progress?.recordings ?? {})) {
    if (!existsSync(join(folder, 'recordings', `${name}.json`))) {
      throw new Error(`games/${game}/proof/progress.json counts the recording ${name}, which isn't in recordings/ any more: npm run dp -- prove ${game} measures it again.`);
    }
  }
  const recordings = existsSync(join(folder, 'recordings'))
    ? Object.fromEntries(readdirSync(join(folder, 'recordings')).filter(f => f.endsWith('.json')).map(f => [f.slice(0, -5), read(`recordings/${f}`)]))
    : {};
  return {
    original: read('original.json'), map: read('code-map.json'), progress, portMap: read('port-map.json'), parts: read('parts.json'), recordings,
  };
}

// what the site also checks as it's built (src/lib/dreamports.ts), so `npm run check` finds it first
function checkEntry(game, entry, proof) {
  const at = `games/${game}/${ENTRY}`;
  for (const key of ['title', 'summary', 'needs', 'lead', 'kit', 'added', 'ownCopy']) {
    if (!entry?.[key]) throw new Error(`${at} needs "${key}", as games/README.md explains.`);
  }
  if (!existsSync(join(REPO, 'kit', entry.kit, 'README.md'))) throw new Error(`${at} names the kit "${entry.kit}", but kit/${entry.kit}/ has no README.md.`);
  if (proof && !entry.needs.includes(proof.copy)) throw new Error(`${at} needs ${entry.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
  if (!proof?.ported) {
    throw new Error(`games/${game}/proof/ has no code map yet. A Dreamport maps every function of the original first, with npm run dp -- codemap ${game}, `
      + 'so its progress map shows the whole game from the start (docs/STANDARD.md#how-progress-is-measured).');
  }
}

// one row for each Dreamport: its name, what it is, its two numbers, each a link to its progress map, its lead and
// team, and where to play it
function table(list) {
  const profile = name => `[${name}](https://github.com/${name})`;
  const cell = text => String(text).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
  const rows = list.map(({ game, entry, proof }) => {
    const link = entry.ownCopy.links[0];
    const team = entry.team?.length ? `, with ${entry.team.map(profile).join(', ')}` : '';
    const map = text => `[${text}](${mapOf(game)})`;
    const ported = map(percentText(proof.ported.percent));
    const { gameplay } = proof;
    const proven = gameplay ? map(`${percentText(gameplay.percent)}, ${gameplay.proven} of ${gameplay.total} parts`) : 'No parts listed yet';
    return `| 🌙 | **[${cell(entry.title)}](games/${game}/)** | ${cell(entry.summary)} Bring your own copy of the game. | ${ported} | ${proven} | ${profile(entry.lead)}${team} | [${link.icon === 'download' ? '⬇' : '▶'}&nbsp;${cell(link.label)}](${link.href}) |`;
  });
  return [
    '| | Dreamport | What it is | Code ported | Gameplay proven | Lead | Try it |',
    '| :---: | :--- | :--- | :--- | :--- | :--- | :--- |',
    ...rows,
  ].join('\n');
}
