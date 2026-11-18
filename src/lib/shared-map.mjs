// The map of a console's shared code (#1508), drawn as an SVG picture the way AnyPS5's progress map shows its system
// libraries: the console's number and how many games take its libraries at the top, then each shared library in the
// kit as a block, sized by how many functions it has, and each function as a small cell coloured by where it stands:
// proven by the same bytes, proven by the same memory, written and not proven yet, or not written yet. The proof tools
// draw it from each library's library.json and the versions' proofs (tools/libraries.mjs, sharedCode), into
// .github/readme/progress/ with the games' maps, and docs/STATUS.md shows it (tools/readme.mjs). It holds the
// libraries' names and their functions' names, which come from public sources, and nothing of any game.

import { COLOURS, FONT, squarify } from './progress-map.mjs';

const WIDTH = 640;
const GAP = 10;
// the heading's two lines, the key under them, and the room a block's name takes above its cells
const HEAD = 46, KEY = 22, NAME = 16;
// the most a cell's side can be, so a small library isn't drawn as a few big squares, and the least the map is drawn
// with, as it's made as short as it can be while every cell is at least that
const LARGEST = 12, SMALLEST = 8;

/** Each state's colour and words, best first, as tools/libraries.mjs names them (STATES). */
export const STATES = {
  bytes: { colour: COLOURS.done, words: 'proven, same bytes' },
  memory: { colour: '#58a6ff', words: 'proven, same memory' },
  written: { colour: '#d29922', words: 'written' },
  unwritten: { colour: COLOURS.todo, words: 'not written' },
};

const n = value => +value.toFixed(2);
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = number => number.toLocaleString('en');
const plural = (number, word, words = `${word}s`) => `${count(number)} ${number === 1 ? word : words}`;
const textWidth = (text, size) => text.length * size * 0.62;
// a share, cut and never rounded up, as the Dreamports' two numbers are (docs/STANDARD.md)
export const shareText = (part, whole) => `${whole ? Math.floor((part / whole) * 10000) / 100 : 0}%`;

/** What a console's map says in words: its number, what it's of, and how many games take its libraries. */
export function sharedText(console) {
  return `${console.name}: ${shareText(console.provenBytes, console.bytes)} of its known shared code proven, ${count(console.provenBytes)} of ${count(console.bytes)} bytes and ${count(console.proven)} of ${plural(console.functions, 'function')}, in ${plural(console.libraries.length, 'library', 'libraries')}, taken by ${plural(console.games, 'game')}`;
}

// the side of the cells that fit `count` of them in a `w` by `h` box, in rows, as large as fits and no larger than LARGEST
function cellSide(w, h, many) {
  let side = Math.min(LARGEST, Math.sqrt((w * h) / many));
  while (side > 0.5 && Math.floor(w / side) * Math.floor(h / side) < many) side *= 0.97;
  return side;
}

/**
 * A console's map, from what sharedCode gives of it: { id, name, libraries, functions, bytes, proven, provenBytes,
 * games }, each library { id, functions, proven, bytes, provenBytes, cells }, each cell { name, size, state }. Returns
 * { svg, alt }, where `alt` says what it shows in words.
 */
export function sharedMap(console) {
  const out = [];
  const headline = `${console.name}: ${shareText(console.provenBytes, console.bytes)} of its known shared code proven`;
  const detail = `${count(console.provenBytes)} of ${count(console.bytes)} bytes, ${count(console.proven)} of ${plural(console.functions, 'function')}, ${plural(console.libraries.length, 'library', 'libraries')}, taken by ${plural(console.games, 'game')}`;
  out.push(
    `<text x="8" y="20" font-size="15" font-weight="700" fill="${COLOURS.text}">${escape(headline)}</text>`,
    `<text x="8" y="38" font-size="11" fill="${COLOURS.dim}">${escape(detail)}</text>`,
  );
  // the key: each state's colour, with how many functions are in it
  const all = console.libraries.flatMap(library => library.cells);
  let x = 8;
  for (const [state, { colour, words }] of Object.entries(STATES)) {
    const label = `${words} (${count(all.filter(cell => cell.state === state).length)})`;
    out.push(`<rect x="${x}" y="${HEAD + 4}" width="10" height="10" fill="${colour}"/>`, `<text x="${x + 14}" y="${HEAD + 13}" font-size="10" fill="${COLOURS.dim}">${escape(label)}</text>`);
    x += 14 + textWidth(label, 10) + 12;
  }
  // the libraries, each a block with room for its name, laid out as short as every cell can still be SMALLEST
  const top = HEAD + KEY;
  const blocks = console.libraries.map(library => ({ ...library, size: library.functions + 12 }));
  const layout = height => squarify(blocks, { x: 4, y: top + 4, w: WIDTH - 8, h: height }).map(({ item: library, ...box }) => {
    const inner = { x: box.x + 1.5, y: box.y + 1.5, w: box.w - 3, h: box.h - 3 };
    const named = inner.h >= NAME + 6 && inner.w >= 24;
    const area = named ? { x: inner.x + 3, y: inner.y + NAME, w: inner.w - 6, h: inner.h - NAME - 3 } : { x: inner.x + 2, y: inner.y + 2, w: inner.w - 4, h: inner.h - 4 };
    const side = area.w > 0 && area.h > 0 && library.cells.length ? cellSide(area.w, area.h, library.cells.length) : LARGEST;
    return { library, inner, named, area, side };
  });
  let height = 40;
  while (height < 2000 && layout(height).some(block => block.side < SMALLEST)) height += 4;
  out.push(`<rect y="${top}" width="${WIDTH}" height="${height + 8}" fill="${COLOURS.panel}"/>`);
  const paths = Object.fromEntries(Object.keys(STATES).map(state => [state, []]));
  for (const { library, inner, named, area, side } of layout(height)) {
    const name = `${library.id} ${library.proven}/${library.functions}`;
    out.push(
      `<g><title>${escape(`${library.id}: ${count(library.proven)} of ${plural(library.functions, 'function')} proven, ${count(library.provenBytes)} of ${count(library.bytes)} bytes, taken by ${plural(library.versions.length, 'version')}`)}</title>`,
      `<rect x="${n(inner.x)}" y="${n(inner.y)}" width="${n(inner.w)}" height="${n(inner.h)}" fill="${COLOURS.block}"/>`,
      ...(named ? [`<text x="${n(inner.x + 4)}" y="${n(inner.y + 11)}" font-size="10" fill="${COLOURS.text}">${escape(textWidth(name, 10) + 8 <= inner.w ? name : library.id.split('/')[1].slice(0, Math.max(1, Math.floor((inner.w - 8) / 6.2))))}</text>`] : []),
      '</g>',
    );
    if (area.w <= 0 || area.h <= 0 || !library.cells.length) continue;
    const columns = Math.max(1, Math.floor(area.w / side));
    const shown = Math.max(0.4, side - Math.min(1, side / 5));
    library.cells.forEach((cell, i) => {
      paths[cell.state].push(`M${n(area.x + (i % columns) * side)} ${n(area.y + Math.floor(i / columns) * side)}h${n(shown)}v${n(shown)}h${n(-shown)}z`);
    });
  }
  for (const [state, { colour }] of Object.entries(STATES)) if (paths[state].length) out.push(`<path fill="${colour}" d="${paths[state].join('')}"/>`);
  const total = top + height + 8 + GAP / 2;
  const alt = `${sharedText(console)}.`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${total}" viewBox="0 0 ${WIDTH} ${total}">`,
    `<title>${escape(alt)}</title>`,
    `<style>text{font-family:${FONT}}</style>`,
    `<rect width="${WIDTH}" height="${total}" fill="${COLOURS.panel}"/>`,
    ...out,
    '</svg>',
  ].join('\n');
  return { svg: `${svg}\n`, alt };
}
