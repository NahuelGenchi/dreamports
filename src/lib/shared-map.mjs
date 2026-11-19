// The map of a console's shared code (#1508), drawn as an SVG picture the way AnyPS5's progress map shows its system
// libraries: the console's number first and largest, then each shared library in the kit as a block, biggest first,
// with its name, how many of its functions are written, and a thin bar of how much of it is proven, and each function
// as a small cell coloured by where it stands: proven by the same bytes, proven by the same memory, written and not
// proven yet, or not written yet. The blocks sit in rows that wrap, and every cell of the map is on one grid. It
// follows the reader's light or dark theme, with each colour at least 3:1 against what it's drawn on. The proof tools
// draw it from each library's library.json and the versions' proofs (tools/libraries.mjs, sharedCode), into
// .github/readme/progress/ with the games' maps, and docs/STATUS.md shows it (tools/readme.mjs). It holds the
// libraries' names and counts, which come from public sources, and nothing of any game.

import { FONT } from './progress-map.mjs';

const WIDTH = 480;
// the grid: a cell is CELL pixels square, one every UNIT, and blocks start on whole units, with PAD pixels round their
// cells and GAP between them, so every cell of the map lines up with every other, across and down
const UNIT = 10, CELL = 8, PAD = 7, GAP = 8;
// where a block's cells start below its top, with its name and count on one line or on two, and the bar above them
const CELLS_AT = { 1: 31, 2: 41 };

/** Each state's words and its colour on a dark and on a light background, best first, as tools/libraries.mjs names them (STATES). */
export const STATES = {
  bytes: { words: 'proven, same bytes', dark: '#3fb950', light: '#1a7f37' },
  memory: { words: 'proven, same memory', dark: '#58a6ff', light: '#0969da' },
  written: { words: 'written', dark: '#d29922', light: '#9a6700' },
  unwritten: { words: 'not written', dark: '#68728f', light: '#737f9d' },
};
// the rest of the map's colours, on each theme: its background, a block's, text, quieter text, and a bar's empty part
const THEMES = {
  dark: { page: '#050a24', block: '#0f1847', text: '#eef4ff', dim: '#a9b8e6', track: '#26346e' },
  light: { page: '#eef2fa', block: '#dde4f3', text: '#0b1533', dim: '#3f4d73', track: '#c3cde6' },
};

const n = value => +value.toFixed(2);
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = number => number.toLocaleString('en');
const plural = (number, word, words = `${word}s`) => `${count(number)} ${number === 1 ? word : words}`;
// how wide a line of monospace text is, at its size, a little generously so nothing is ever cut
const textWidth = (text, size) => text.length * size * 0.62 + 2;
// a share, cut and never rounded up, as the Dreamports' two numbers are (docs/STANDARD.md)
export const shareText = (part, whole) => `${whole ? Math.floor((part / whole) * 10000) / 100 : 0}%`;

/** What a console's map says in words: its number, what it's of, and how many games take its libraries. */
export function sharedText(console) {
  return `${console.name}: ${shareText(console.provenBytes, console.bytes)} of its known shared code proven, ${count(console.provenBytes)} of ${count(console.bytes)} bytes and ${count(console.proven)} of ${plural(console.functions, 'function')}, in ${plural(console.libraries.length, 'library', 'libraries')}, taken by ${plural(console.games, 'game')}`;
}

// the style that colours the map by class, dark unless the reader's theme is light
function style() {
  const rules = theme => [
    ...Object.entries(THEMES[theme]).map(([name, colour]) => `.${name}{fill:${colour}}`),
    ...Object.entries(STATES).map(([state, colours]) => `.${state}{fill:${colours[theme]}}`),
  ].join('');
  return `<style>text{font-family:${FONT}}${rules('dark')}@media (prefers-color-scheme:light){${rules('light')}}</style>`;
}

// A library's block, before it's placed: its name without the console's, its count, and the fewest columns its cells
// can take, so its name and count always fit, one above the other if need be.
function blockOf(library, most) {
  const name = library.id.split('/').pop();
  const written = library.cells.filter(cell => cell.state !== 'unwritten').length;
  const tally = `${count(written)}/${count(library.functions)} written`;
  const least = Math.min(most, Math.ceil((Math.max(textWidth(name, 11), textWidth(tally, 10)) + 2) / UNIT));
  return { library, name, tally, least, cells: Math.max(1, library.cells.length) };
}

// The columns each of `blocks` gets in a row `units` wide, by how many cells it has, so they're all about as tall, or
// null when one of them would be narrower than its name and count. A block is its columns and a unit more, and one
// unit is between each two.
function columnsIn(blocks, units) {
  const room = units - blocks.length * 2 + 1, cells = blocks.reduce((sum, block) => sum + block.cells, 0);
  const columns = blocks.map(block => Math.floor((room * block.cells) / cells));
  // what rounding left over, to the biggest first
  for (let i = 0, left = room - columns.reduce((sum, each) => sum + each, 0); left > 0; i = (i + 1) % blocks.length, left--) columns[i]++;
  return columns.every((each, i) => each >= blocks[i].least) ? columns : null;
}

// The blocks in rows, biggest first, as many to a row as can each keep their name and count whole, each row shared
// out by cells so its blocks come out about as tall: each block { x, columns, rows }, x in units, each row { blocks,
// rows, oneLine }, with its labels on one line when every one of them fits on one.
function rowsOf(blocks, units) {
  const rows = [];
  let row = [];
  for (const block of [...blocks].sort((a, b) => b.cells - a.cells)) {
    if (row.length && !columnsIn([...row, block], units)) {
      rows.push(row);
      row = [];
    }
    row.push(block);
  }
  if (row.length) rows.push(row);
  return rows.map(each => {
    const columns = columnsIn(each, units) ?? each.map(() => units - 1);
    let x = 0;
    each.forEach((block, i) => {
      Object.assign(block, { x, columns: columns[i], rows: Math.ceil(block.cells / columns[i]) });
      block.oneLine = textWidth(block.name, 11) + textWidth(block.tally, 10) + 8 <= block.columns * UNIT - 2;
      x += block.columns + 2;
    });
    return { blocks: each, rows: Math.max(...each.map(block => block.rows)), oneLine: each.every(block => block.oneLine) };
  });
}

/**
 * A console's map, from what sharedCode gives of it: { id, name, libraries, functions, bytes, proven, provenBytes,
 * games }, each library { id, functions, proven, bytes, provenBytes, cells }, each cell { name, size, state }, at
 * `width` pixels, 480 unless asked. Returns { svg, alt }, where `alt` says what it shows in words.
 */
export function sharedMap(console, { width = WIDTH } = {}) {
  const units = Math.floor((width - 2 * UNIT) / UNIT), left = Math.floor((width - units * UNIT - 2) / 2);
  const out = [];
  // the number, first and largest, then what it's of
  const headline = `${shareText(console.provenBytes, console.bytes)} proven`;
  out.push(
    `<text class="dim" x="${left}" y="18" font-size="11">${escape(`${console.name}'s shared code`)}</text>`,
    `<text class="text" x="${left}" y="42" font-size="22" font-weight="700">${escape(headline)}</text>`,
    `<text class="dim" x="${left}" y="60" font-size="11">${escape(`${count(console.provenBytes)} of ${count(console.bytes)} bytes, ${count(console.proven)} of ${plural(console.functions, 'function')}`)}</text>`,
    `<text class="dim" x="${left}" y="74" font-size="11">${escape(`${plural(console.libraries.length, 'library', 'libraries')}, taken by ${plural(console.games, 'game')}`)}</text>`,
  );
  // the key: each state's colour, with how many functions are in it, in as many columns as fit, four, two or one
  const all = console.libraries.flatMap(library => library.cells);
  const keys = Object.keys(STATES).map(state => ({ state, label: `${STATES[state].words} (${count(all.filter(cell => cell.state === state).length)})` }));
  keys.forEach(key => { key.room = 13 + textWidth(key.label, 10); });
  const across = [4, 2, 1].find(columns => {
    const widest = [...Array(columns)].map((_, c) => Math.max(...keys.filter((_, i) => i % columns === c).map(key => key.room)));
    return widest.reduce((sum, each) => sum + each + 18, -18) <= width - 2 * left;
  });
  const columnAt = [...Array(across)].map((_, c) => left + [...Array(c)].reduce((sum, _, before) => sum + Math.max(...keys.filter((_, i) => i % across === before).map(key => key.room)) + 18, 0));
  let y = 92;
  keys.forEach((key, i) => {
    const x = columnAt[i % across], at = y + Math.floor(i / across) * 16;
    out.push(`<rect class="${key.state}" x="${n(x)}" y="${at - 9}" width="${CELL}" height="${CELL}"/>`, `<text class="dim" x="${n(x + 13)}" y="${at - 1}" font-size="10">${escape(key.label)}</text>`);
  });
  y += (Math.ceil(keys.length / across) - 1) * 16;
  // the libraries, in rows of blocks on the grid
  const rows = rowsOf(console.libraries.map(library => blockOf(library, units - 1)), units);
  const paths = Object.fromEntries(Object.keys(STATES).map(state => [state, []]));
  let top = Math.ceil((y + 12) / UNIT) * UNIT;
  for (const row of rows) {
    // every block of a row as tall as the row's tallest, and each row a whole number of units below the last
    const cellsAt = CELLS_AT[row.oneLine ? 1 : 2], height = Math.ceil((cellsAt + row.rows * UNIT - 2 + PAD + GAP) / UNIT) * UNIT - GAP;
    for (const block of row.blocks) {
      const bx = left + block.x * UNIT, bw = (block.columns + 1) * UNIT + 2, { library } = block;
      const proven = { bytes: 0, memory: 0 };
      for (const cell of library.cells) if (cell.state in proven) proven[cell.state] += cell.size;
      const bar = { x: bx + PAD, y: top + cellsAt - 10, w: bw - 2 * PAD };
      out.push(
        `<g><title>${escape(`${library.id}: ${count(library.proven)} of ${plural(library.functions, 'function')} proven, ${count(library.provenBytes)} of ${count(library.bytes)} bytes, ${block.tally}, taken by ${plural(library.versions.length, 'version')}`)}</title>`,
        `<rect class="block" x="${bx}" y="${top}" width="${bw}" height="${height}" rx="3"/>`,
        `<text class="text" x="${bx + PAD}" y="${top + 15}" font-size="11" font-weight="700">${escape(block.name)}</text>`,
        row.oneLine
          ? `<text class="dim" x="${bx + bw - PAD}" y="${top + 15}" font-size="10" text-anchor="end">${escape(block.tally)}</text>`
          : `<text class="dim" x="${bx + PAD}" y="${top + 27}" font-size="10">${escape(block.tally)}</text>`,
        `<rect class="track" x="${bar.x}" y="${bar.y}" width="${bar.w}" height="3" rx="1.5"/>`,
        ...(library.bytes ? [['bytes', 0], ['memory', proven.bytes]].filter(([state]) => proven[state]).map(([state, before]) => `<rect class="${state}" x="${n(bar.x + (bar.w * before) / library.bytes)}" y="${bar.y}" width="${n((bar.w * proven[state]) / library.bytes)}" height="3"/>`) : []),
        '</g>',
      );
      library.cells.forEach((cell, i) => {
        paths[cell.state].push(`M${bx + PAD + (i % block.columns) * UNIT} ${top + cellsAt + Math.floor(i / block.columns) * UNIT}h${CELL}v${CELL}h-${CELL}z`);
      });
    }
    top += height + GAP;
  }
  for (const state of Object.keys(STATES)) if (paths[state].length) out.push(`<path class="${state}" d="${paths[state].join('')}"/>`);
  const total = top + UNIT - GAP;
  const alt = `${sharedText(console)}.`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${total}" viewBox="0 0 ${width} ${total}">`,
    `<title>${escape(alt)}</title>`,
    style(),
    `<rect class="page" width="${width}" height="${total}" rx="6"/>`,
    ...out,
    '</svg>',
  ].join('\n');
  return { svg: `${svg}\n`, alt };
}
