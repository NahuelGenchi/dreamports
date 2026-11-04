// npm run dp -- help [words]: one section of the long documents, the ones whose headings have all these words, as
// reading a whole one costs an agent thousands of tokens on every request after it. With no words, it lists the headings.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib/paths.mjs';

const kits = () => readdirSync(join(REPO, 'kit'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `kit/${entry.name}/README.md`);
const documents = () => ['tools/README.md', 'docs/STANDARD.md', 'docs/TEAMS.md', 'docs/NOTES.md', 'docs/MAKING.md', 'docs/PREVIEWS.md', 'docs/CONSOLES.md', 'games/README.md', ...kits()].filter(file => existsSync(join(REPO, file)));

// a document's sections, each to the next heading as high as its own, leaving out what's in fenced code
function sectionsOf(file) {
  const lines = readFileSync(join(REPO, file), 'utf8').split('\n'), headings = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (line.startsWith('```')) fenced = !fenced;
    const heading = !fenced && /^(#{1,6}) (.+)$/.exec(line);
    if (heading) headings.push({ at, level: heading[1].length, title: heading[2] });
  });
  return headings.map(({ at, level, title }, i) => {
    const next = headings.slice(i + 1).find(other => other.level <= level);
    return { file, level, title, text: lines.slice(at, next?.at).join('\n').trimEnd() };
  });
}

export async function run(args) {
  const words = args.map(word => word.toLowerCase());
  const sections = documents().flatMap(sectionsOf).filter(section => section.level > 1);
  const found = sections.filter(({ title }) => words.length && words.every(word => title.toLowerCase().includes(word)));
  // a section inside another that's found already comes with it
  const shown = found.filter(section => !found.some(other => other !== section && other.file === section.file && other.text.includes(section.text)));
  for (const { file, text } of shown) console.log(`${file}:\n\n${text}\n`);
  if (shown.length) return 0;
  if (words.length) console.log(`No heading has ${words.join(' and ')}. These are the headings there are:\n`);
  let last = null;
  for (const { file, level, title } of sections) {
    if (file !== last) console.log(`${last ? '\n' : ''}${file}`);
    last = file;
    console.log(`${'  '.repeat(level - 1)}${title}`);
  }
  return words.length ? 1 : 0;
}
