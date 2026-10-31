// npm run dp -- readme [--check]: writes the table of Dreamports in README.md from each Dreamport's entry,
// games/<game>/entry.md, with its % from its proof/ folder and its lead. `prove` writes it too, after it updates a
// game's %, so nobody types its numbers. With --check it changes nothing and fails when the table is out of date,
// or when an entry doesn't agree with its folder, which `npm run check` uses.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { REPO } from './lib/paths.mjs';
import { ENTRY, percentText, proofOf } from '../src/lib/entries.mjs';

const README = join(REPO, 'README.md');
const START = '<!-- The proof tools write this table from each Dreamport\'s entry: npm run dp -- readme. -->';
const END = '<!-- End of the table of Dreamports. -->';

export async function run(args) {
  const check = args.includes('--check');
  const { changed } = writeReadme({ check });
  if (check && changed) throw new Error('README.md\'s table of Dreamports is out of date: npm run dp -- readme writes it again.');
  console.log(check ? 'README.md\'s table of Dreamports is up to date.' : changed ? 'Written: README.md\'s table of Dreamports.' : 'README.md\'s table of Dreamports was already up to date.');
  return 0;
}

/** Writes the table in README.md, or only compares it with `check`: { changed }. */
export function writeReadme({ check = false } = {}) {
  const text = readFileSync(README, 'utf8');
  const start = text.indexOf(START), end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`README.md has lost the lines that mark its table of Dreamports:\n${START}\n${END}`);
  // blank lines around the table, so GitHub doesn't read the lines that mark it as part of it
  const next = `${text.slice(0, start + START.length)}\n\n${table(dreamports())}\n\n${text.slice(end)}`;
  if (next !== text && !check) writeFileSync(README, next);
  return { changed: next !== text };
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

function readProof(game) {
  const read = name => {
    const file = join(REPO, 'games', game, 'proof', name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  };
  const progress = read('progress.json');
  for (const name of Object.keys(progress?.recordings ?? {})) {
    if (!existsSync(join(REPO, 'games', game, 'proof', 'recordings', `${name}.json`))) {
      throw new Error(`games/${game}/proof/progress.json counts the recording ${name}, which isn't in recordings/ any more: npm run dp -- prove ${game} measures it again.`);
    }
  }
  return proofOf(game, { original: read('original.json'), map: read('code-map.json'), progress });
}

// what the site also checks as it's built (src/lib/dreamports.ts), so `npm run check` finds it first
function checkEntry(game, entry, proof) {
  const at = `games/${game}/${ENTRY}`;
  for (const key of ['title', 'summary', 'needs', 'lead', 'kit', 'added', 'ownCopy']) {
    if (!entry?.[key]) throw new Error(`${at} needs "${key}", as games/README.md explains.`);
  }
  if (!existsSync(join(REPO, 'kit', entry.kit, 'README.md'))) throw new Error(`${at} names the kit "${entry.kit}", but kit/${entry.kit}/ has no README.md.`);
  if (proof && !entry.needs.includes(proof.copy)) throw new Error(`${at} needs ${entry.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
}

// one row for each Dreamport: its name, what it is, its %, its lead and team, and where to play it
function table(list) {
  const profile = name => `[${name}](https://github.com/${name})`;
  const cell = text => String(text).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
  const rows = list.map(({ game, entry, proof }) => {
    const link = entry.ownCopy.links[0];
    const team = entry.team?.length ? `, with ${entry.team.map(profile).join(', ')}` : '';
    return `| 🌙 | **[${cell(entry.title)}](games/${game}/)** | ${cell(entry.summary)} Bring your own copy of the game. | ${percentText(proof?.percent) ?? 'Not measured yet'} | ${profile(entry.lead)}${team} | [${link.icon === 'download' ? '⬇' : '▶'}&nbsp;${cell(link.label)}](${link.href}) |`;
  });
  return ['| | Dreamport | What it is | Progress | Lead | Try it |', '| :---: | :--- | :--- | :--- | :--- | :--- |', ...rows].join('\n');
}
