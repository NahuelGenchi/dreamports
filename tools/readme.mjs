// npm run dp -- readme [--check]: writes the table of Dreamports in docs/STATUS.md from each Dreamport's entry,
// games/<game>/entry.md, with its code ported and gameplay proven from its proof/ folder, and its lead, and each
// Dreamport's progress map, in .github/readme/progress/<game>.svg, which the table links, and a row and a map for each
// of its versions in other languages, such as <game>-c.svg (src/lib/languages.mjs), and below the table the shared code
// of each console with a library in the kit, as a map in .github/readme/progress/shared.<console>.svg (#1508), whose
// name has a dot, which no game's has. .github/workflows/readme.yml
// runs it on main, so pull requests leave them alone and can't conflict over them. With --check it changes nothing and
// fails when an entry doesn't agree with its folder, which `npm run check` uses.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { REPO } from './lib/paths.mjs';
import { versionsOf } from './lib/proof-files.mjs';
import { versionOf, versionTitle } from '../src/lib/languages.mjs';
import { ENTRY, gameplayText, mapOf, percentText, proofOf } from '../src/lib/entries.mjs';
import { progressMap } from '../src/lib/progress-map.mjs';
import { sharedMap } from '../src/lib/shared-map.mjs';
import { sharedCode } from './libraries.mjs';

export const STATUS = 'docs/STATUS.md';
const STATUS_FILE = join(REPO, STATUS);
const START = '<!-- The proof tools write this table from each Dreamport\'s entry: npm run dp -- readme. -->';
const END = '<!-- End of the table of Dreamports. -->';
const SUMMARY_MOST = 80;
// the maps of shared code, after the table of Dreamports
const SHARED = '## Shared code';
const SHARED_START = '<!-- The proof tools draw these maps from the kit\'s shared libraries: npm run dp -- readme. -->';
const SHARED_END = '<!-- End of the maps of shared code. -->';
const SHARED_ABOUT = 'Some code is in many games of a console without any of them having written it: the console maker\'s libraries, sound drivers and the helpers its compiler adds. It\'s written once in the kit, and each Dreamport that has it takes it from there and proves it on its own copy ([Shared libraries](../tools/README.md#shared-libraries)). Each console\'s map shows its libraries as blocks and their functions as cells: green once proven by the same bytes, blue once proven by the same memory, amber while written and not proven yet, and grey while nobody has written it.';
/** Where a console's map of shared code is kept. */
export const sharedMapOf = id => `.github/readme/progress/shared.${id}.svg`;

export async function run(args) {
  if (args.includes('--check')) {
    // only main's have to be up to date, so this asks only that they can be written
    writeReadme({ check: true });
    console.log('Every Dreamport\'s entry agrees with its folder.');
    return 0;
  }
  const { changed, files } = writeReadme();
  console.log(changed ? `Updated: ${files.join(', ')}.` : `${STATUS}'s table of Dreamports and the progress maps were already up to date.`);
  return 0;
}

/** docs/STATUS.md in three: what's before the table, the table with the lines that mark it, and what's after. Null when it has lost them. */
export function splitTable(text) {
  const start = text.indexOf(START), end = text.indexOf(END);
  return start < 0 || end < start ? null : { before: text.slice(0, start), table: text.slice(start, end + END.length), after: text.slice(end + END.length) };
}

/**
 * docs/STATUS.md as `before` has it, with only the row of `version`, such as pixel-trail/c, from `fresh`, the same file
 * just written whole: after the row it follows there, or before the first row when it leads the table. The table is
 * main's own, written after each merge by the Readme workflow (#566), so it can be a few hours behind the games'
 * folders, and a new game's first files add its row to it as it is: written whole, they would carry other games' new
 * numbers along, which nothing that reads them could tell from words of someone's own. Null when there's no such row
 * to add, or `before` has it already.
 */
export function withRowOf(before, fresh, version) {
  const link = line => /\(\.\.\/games\/([^)]+)\/\)/.exec(line)?.[1];
  const written = fresh.split('\n'), lines = before.split('\n');
  const at = written.findIndex(line => link(line) === version);
  if (at < 0 || lines.some(line => link(line) === version)) return null;
  const follows = link(written[at - 1] ?? '');
  const after = follows ? lines.findIndex(line => link(line) === follows) : lines.findIndex(line => link(line)) - 1;
  if (after < 0) return null;
  lines.splice(after + 1, 0, written[at]);
  return lines.join('\n');
}

/**
 * Writes the table in docs/STATUS.md and each Dreamport's progress map, and removes the map of a game that's gone, or only
 * compares them with `check`: { changed, files }, with the files that changed, or would.
 */
export function writeReadme({ check = false } = {}) {
  const list = dreamports();
  const text = readFileSync(STATUS_FILE, 'utf8');
  const start = text.indexOf(START), end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${STATUS} has lost the lines that mark its table of Dreamports:\n${START}\n${END}`);
  // blank lines around the table, so GitHub doesn't read the lines that mark it as part of it
  const consoles = sharedCode();
  const files = new Map([[STATUS_FILE, `${text.slice(0, start + START.length)}\n\n${table(list)}\n\n${END}${withShared(text.slice(end + END.length), sharedSection(consoles))}`]]);
  for (const each of consoles) files.set(join(REPO, sharedMapOf(each.id)), sharedMap(each).svg);
  for (const { name: main, entry, versions } of list) {
    files.set(join(REPO, mapOf(main)), progressMap(main, readProofFiles(main), entry.title).svg);
    for (const { name } of versions) files.set(join(REPO, mapOf(name)), progressMap(name, readProofFiles(name), entry.title).svg);
  }
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
  // as the repository writes them, with / on Windows too
  return { changed: changed.length > 0, files: changed.map(file => relative(REPO, file).split(sep).join('/')) };
}

// the maps of shared code, with their heading and the lines that mark them
function sharedSection(consoles) {
  const maps = consoles.length ? consoles.map(each => `![${sharedMap(each).alt}](../${sharedMapOf(each.id)})`).join('\n\n') : 'No console has a shared library in the kit yet, so there\'s no map yet.';
  return [SHARED, '', SHARED_ABOUT, '', SHARED_START, '', maps, '', SHARED_END].join('\n');
}

/** What docs/STATUS.md has after its table of Dreamports, as it has it or as `main` does: the maps of shared code, from
 *  their heading to the line that ends them, or null when it has none yet. */
export function sharedPart(after) {
  const from = after.indexOf(SHARED), to = after.indexOf(SHARED_END);
  return from >= 0 && to > from ? after.slice(from, to + SHARED_END.length) : null;
}

// what docs/STATUS.md has after its table of Dreamports, `tail`, with the maps of shared code as `shared` says them
export function withShared(tail, shared) {
  const now = sharedPart(tail);
  if (now !== null) return tail.replace(now, () => shared);
  return `\n\n${shared}${tail.startsWith('\n') ? '' : '\n'}${tail}`;
}

/** Every Dreamport's entry and what its proof measures, newest first, as the site lists them: `name`, `language` and
 *  `proof` are its main version's (src/lib/languages.mjs), its JavaScript one, or its version in C in a game that
 *  started in C, and `versions` each of its others as { name, language, proof }. */
export function dreamports() {
  const games = join(REPO, 'games');
  const found = readdirSync(games, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(games, d.name, ENTRY)))
    .map(d => d.name);
  return found.map(game => {
    const [main, ...others] = versionsOf(game);
    return {
      game, entry: readEntry(game), name: main, language: versionOf(main).language, proof: readProof(main),
      versions: others.map(name => ({ name, language: versionOf(name).language, proof: readProof(name) })),
    };
  })
    .map(dreamport => (checkEntry(dreamport.game, dreamport.entry, dreamport.proof), dreamport))
    .sort((a, b) => new Date(b.entry.added) - new Date(a.entry.added));
}

function readEntry(game) {
  const text = readFileSync(join(REPO, 'games', game, ENTRY), 'utf8');
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!front) throw new Error(`games/${game}/${ENTRY} has no fields between two --- lines at its top.`);
  return parse(front[1]);
}

/** What a game's proof folder measures (proofOf), from its files: the game's own, or with a version's name, such
 *  as 'sonic-battle/c', that version's (src/lib/languages.mjs). */
export const readProof = game => proofOf(game, readProofFiles(game));

/** A game's or a version's proof files, as proofOf takes them: the version's own progress and port map, and the rest
 *  the game's. */
function readProofFiles(game) {
  const folder = join(REPO, 'games', versionOf(game).game, 'proof'), own = join(REPO, 'games', game, 'proof');
  const readFrom = (place, name) => {
    const file = join(place, name);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
  };
  const read = name => readFrom(folder, name);
  const progress = readFrom(own, 'progress.json');
  for (const name of Object.keys(progress?.recordings ?? {})) {
    if (!existsSync(join(folder, 'recordings', `${name}.json`))) {
      throw new Error(`games/${game}/proof/progress.json counts the recording ${name}, which isn't in games/${versionOf(game).game}/proof/recordings/ any more: npm run dp -- prove ${game} measures it again.`);
    }
  }
  const recordings = existsSync(join(folder, 'recordings'))
    ? Object.fromEntries(readdirSync(join(folder, 'recordings')).filter(f => f.endsWith('.json')).map(f => [f.slice(0, -5), read(`recordings/${f}`)]))
    : {};
  return {
    original: read('original.json'), map: read('code-map.json'), progress, portMap: readFrom(own, 'port-map.json'), parts: read('parts.json'), proofs: readFrom(own, 'proofs.json'), recordings,
  };
}

/** Why a Dreamport's summary won't do, or null: a shared page shows it right under the game's name, so it says something new, in few words. */
export function summaryProblem(title, summary) {
  const name = String(title).replace(/\s+Dreamport$/i, '').toLowerCase();
  if (String(summary).toLowerCase().includes(name)) return `repeats the game's name, which is shown right above it`;
  if (String(summary).length > SUMMARY_MOST) return `is longer than ${SUMMARY_MOST} characters`;
  return null;
}

// what the site also checks as it's built (src/lib/dreamports.ts), so `npm run check` finds it first
function checkEntry(game, entry, proof) {
  const at = `games/${game}/${ENTRY}`;
  for (const key of ['title', 'summary', 'needs', 'issue', 'lead', 'kit', 'added', 'ownCopy']) {
    if (!entry?.[key]) throw new Error(`${at} needs "${key}", as games/README.md explains.`);
  }
  const problem = summaryProblem(entry.title, entry.summary);
  if (problem) throw new Error(`${at}'s summary ${problem}.`);
  if (!Number.isInteger(entry.issue) || entry.issue < 1) throw new Error(`${at} names its game's issue by its number, such as "issue: 123", not "${entry.issue}".`);
  if (!existsSync(join(REPO, 'kit', entry.kit, 'README.md'))) throw new Error(`${at} names the kit "${entry.kit}", but kit/${entry.kit}/ has no README.md.`);
  if (proof && !entry.needs.includes(proof.copy)) throw new Error(`${at} needs ${entry.needs}, but its proof uses ${proof.copy}: "needs" names the same copy.`);
  if (!proof?.ported) {
    throw new Error(`games/${game}/proof/ has no code map yet. A Dreamport maps every function of the original first, with npm run dp -- codemap ${game}, `
      + 'so its progress map shows the whole game from the start (docs/STANDARD.md#how-progress-is-measured).');
  }
}

// one row for each Dreamport: its name, its two numbers, each a link to its progress map, its lead and
// team, and where to play it
function table(list) {
  const profile = name => `[${name}](https://github.com/${name})`;
  const cell = text => String(text).replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
  const numbers = (name, proof) => {
    const map = text => `[${text}](../${mapOf(name)})`;
    const { gameplay } = proof;
    return [map(percentText(proof.ported.percent)), gameplay ? map(gameplayText(gameplay)) : 'No parts listed yet'];
  };
  // a version in another language has a row of its own under the game's, with no way to play it from here yet
  const rows = list.flatMap(({ entry, name: main, language: mainIn, proof, versions }) => {
    const link = entry.ownCopy.links[0];
    const team = entry.team?.length ? `, with ${entry.team.map(profile).join(', ')}` : '';
    return [
      `| **[${cell(versionTitle(entry.title, mainIn))}](../games/${main}/)** | ${numbers(main, proof).join(' | ')} | ${profile(entry.lead)}${team} | [${link.icon === 'download' ? '⬇' : '▶'}&nbsp;${cell(link.label)}](${link.href}) |`,
      ...versions.map(({ name, language, proof: theirs }) => `| [${cell(versionTitle(entry.title, language))}](../games/${name}/) | ${numbers(name, theirs).join(' | ')} | ${profile(entry.lead)}${team} | Not yet |`),
    ];
  });
  return [
    '| Dreamport | Code ported | Gameplay proven | Lead | Try it |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...rows,
  ].join('\n');
}
