// A Dreamport's progress map, drawn as an SVG picture from its proof/ folder, like the status pages of decompilation
// projects. Its two numbers come first, as badges. Then a panel for code ported, with one rectangle for each function
// in the original's code map, sized by its bytes and grouped by where it sits in the program, green when it counts
// toward code ported and grey when it doesn't. Then a smaller panel for gameplay proven, with one equal block for each
// of the game's parts, green once it's proven. It's measured by the same code as the two numbers (entries.mjs), so it
// can't disagree with them. It's for the people making the game, so it's only shown on GitHub, never on the site: the
// proof tools keep it in the repository with the README's table (tools/readme.mjs), which links it. It holds addresses
// and sizes only, as the code map does, and nothing of the game.

import { measure, percentText, portedFunctions, proofOf } from './entries.mjs';

const WIDTH = 480;
const BADGES = 20; // the badges' height
const GAP = 10;
const BAR = 26; // a panel's title bar
const CODE = 264; // the code panel's map
const PART = 24; // the height of a part's block

const COLOURS = {
  panel: '#050a24',
  block: '#0f1847',
  text: '#eef4ff',
  dim: '#a9b8e6',
  done: '#3fb950',
  todo: '#454c63',
  label: '#1f2d63',
};

// a badge's colour for its %, light enough to read white on
const badgeColour = percent => (percent === null ? COLOURS.label : percent >= 100 ? '#2b7a37' : percent >= 50 ? '#6a7a0b' : '#b54708');

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, \'DejaVu Sans Mono\', \'Liberation Mono\', monospace';
// how wide a line of monospace text is, at its size
const textWidth = (text, size) => text.length * size * 0.62;
const n = value => +value.toFixed(1);
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const count = number => number.toLocaleString('en');

/**
 * A Dreamport's progress map, from its proof files as proofOf takes them, or null without a code map. `title` is the
 * Dreamport's name. Returns { svg, alt }, where `alt` says what it shows in words.
 */
export function progressMap(game, files, title) {
  const proof = proofOf(game, files);
  if (!proof?.ported || !files.map) return null;
  const functions = files.map.functions.map(([address, size]) => ({ address, at: parseInt(address, 16), size }));
  const counted = portedFunctions(files.portMap, files.progress);
  const code = measure(functions, counted);
  // the same count as the two numbers, so this never fires unless the two drift apart
  if (code.percent !== proof.ported.percent) throw new Error(`${game}'s progress map makes code ported ${code.percent}%, but its numbers say ${proof.ported.percent}%.`);
  const { gameplay } = proof;
  const portedText = `${percentText(code.percent)} (${count(code.proven.bytes)}/${count(code.codeMap.bytes)} bytes)`;
  const gameplayText = gameplay ? `${percentText(gameplay.percent)} (${gameplay.proven}/${gameplay.total} parts)` : 'no list of parts yet';

  const out = [];
  let y = 0;
  // the badges
  let x = 0;
  for (const [label, percent] of [['Code ported', code.percent], ['Gameplay proven', gameplay?.percent ?? null]]) {
    const value = percentText(percent) ?? 'not yet';
    const left = textWidth(label, 11) + 12, right = textWidth(value, 11) + 12;
    out.push(
      `<rect x="${n(x)}" width="${n(left)}" height="${BADGES}" fill="${COLOURS.label}"/>`,
      `<rect x="${n(x + left)}" width="${n(right)}" height="${BADGES}" fill="${badgeColour(percent)}"/>`,
      `<text x="${n(x + 6)}" y="14" font-size="11" fill="${COLOURS.text}">${escape(label)}</text>`,
      `<text x="${n(x + left + 6)}" y="14" font-size="11" font-weight="700" fill="#ffffff">${escape(value)}</text>`,
    );
    x += left + right + 6;
  }
  y += BADGES + GAP;

  // code ported: the code map's functions, in blocks
  out.push(...panel(y, CODE, `Code ported: ${portedText}`));
  const cells = { done: [], todo: [] };
  for (const { item: block, ...box } of squarify(blocksOf(functions), { x: 4, y: y + BAR, w: WIDTH - 8, h: CODE }, { inOrder: true })) {
    const inner = inset(box, 1.5);
    const labelled = inner.h >= 40 && inner.w >= textWidth(block.name, 10) + 8;
    const ported = block.functions.filter(f => counted.has(f.address));
    const share = Math.round(ported.reduce((sum, f) => sum + f.size, 0) / block.size * 100);
    out.push(
      `<g><title>${block.name} to ${block.last}: ${count(block.functions.length)} functions, ${count(block.size)} bytes, ${share}% ported</title>`,
      `<rect x="${n(inner.x)}" y="${n(inner.y)}" width="${n(inner.w)}" height="${n(inner.h)}" fill="${COLOURS.block}"/>`,
      ...(labelled ? [`<text x="${n(inner.x + 4)}" y="${n(inner.y + 11)}" font-size="10" fill="${COLOURS.dim}">${block.name}</text>`] : []),
      '</g>',
    );
    const area = labelled ? { x: inner.x + 2, y: inner.y + 15, w: inner.w - 4, h: inner.h - 17 } : inset(inner, 2);
    for (const { item: f, ...cell } of squarify(block.functions, area)) {
      const shown = inset(cell, Math.min(0.35, cell.w / 4, cell.h / 4));
      if (shown.w < 0.1 || shown.h < 0.1) continue;
      cells[counted.has(f.address) ? 'done' : 'todo'].push(`M${n(shown.x)} ${n(shown.y)}h${n(shown.w)}v${n(shown.h)}h${n(-shown.w)}z`);
    }
  }
  out.push(`<path fill="${COLOURS.todo}" d="${cells.todo.join('')}"/>`, `<path fill="${COLOURS.done}" d="${cells.done.join('')}"/>`);
  y += BAR + CODE + 4 + GAP;

  // gameplay proven: each part, in the order a player meets them
  const parts = gameplay?.parts ?? [];
  // as few rows as fit, shared out evenly
  const rows = Math.max(1, Math.ceil(parts.length / Math.floor((WIDTH - 8) / PART)));
  const columns = Math.max(1, Math.ceil(parts.length / rows));
  const height = rows * PART;
  out.push(...panel(y, height, `Gameplay proven: ${gameplayText}`));
  if (!parts.length) {
    out.push(`<text x="10" y="${y + BAR + 16}" font-size="11" fill="${COLOURS.dim}">Its lead lists its parts in proof/parts.json.</text>`);
  }
  const side = (WIDTH - 8) / columns;
  parts.forEach((part, i) => {
    const box = inset({ x: 4 + (i % columns) * side, y: y + BAR + Math.floor(i / columns) * PART, w: side, h: PART }, 1.5);
    out.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.w)}" height="${n(box.h)}" fill="${part.proven ? COLOURS.done : COLOURS.todo}"><title>${escape(part.name)}${part.proven ? ', proven' : ''}</title></rect>`);
  });
  y += BAR + height + 4;

  const alt = `${title}’s progress. Code ported: ${portedText}. Gameplay proven: ${gameplayText}.`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${y}" viewBox="0 0 ${WIDTH} ${y}">`,
    `<title>${escape(alt)}</title>`,
    `<style>text{font-family:${FONT}}</style>`,
    ...out,
    '</svg>',
  ].join('\n');
  return { svg: `${svg}\n`, alt };
}

// a dark panel with its title bar, `height` tall under it
function panel(y, height, heading) {
  return [
    `<rect y="${y}" width="${WIDTH}" height="${BAR + height + 4}" fill="${COLOURS.panel}"/>`,
    `<text x="10" y="${y + 17}" font-size="13" fill="${COLOURS.text}">${escape(heading)}</text>`,
  ];
}

const inset = ({ x, y, w, h }, by) => ({ x: x + by, y: y + by, w: w - by * 2, h: h - by * 2 });
const hex = at => at.toString(16).toUpperCase().padStart(8, '0');

// The code map's functions in blocks, by where they sit in the program: stretches of 64 KiB, or of 128 KiB, 256 KiB and
// so on when that would make more than 16, each named by the address it starts at. A code map only has every
// function's address and size, and a compiler lays out each of the game's source files in one piece, so functions
// close together are usually part of the same thing.
function blocksOf(functions) {
  let span = 0x10000;
  while (new Set(functions.map(f => Math.floor(f.at / span))).size > 16) span *= 2;
  const blocks = new Map();
  for (const f of functions) {
    const start = Math.floor(f.at / span) * span;
    if (!blocks.has(start)) blocks.set(start, { name: hex(start), last: hex(start + span - 1), size: 0, functions: [] });
    const block = blocks.get(start);
    block.size += f.size;
    block.functions.push(f);
  }
  return [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
}

// Lays out `items`, each with its `size`, in the rectangle `box`, biggest first, or in their order with `inOrder`, each
// as near to a square as it can be: the squarified treemap of Bruls, Huizing and van Wijk. Returns [{ item, x, y, w, h }].
function squarify(items, box, { inOrder = false } = {}) {
  const sorted = inOrder ? items : [...items].sort((a, b) => b.size - a.size || a.at - b.at);
  const total = sorted.reduce((sum, item) => sum + item.size, 0);
  const out = [];
  let { x, y, w, h } = box;
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  // the longest of a row's rectangles over its shortest, at its worst, laid along a side
  const worst = (sum, min, max, side) => Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  for (let i = 0; i < sorted.length;) {
    const side = Math.min(w, h);
    let sum = sorted[i].size * scale, min = sum, max = sum, j = i + 1;
    for (; j < sorted.length; j++) {
      const area = sorted[j].size * scale;
      if (worst(sum + area, Math.min(min, area), Math.max(max, area), side) > worst(sum, min, max, side)) break;
      sum += area;
      min = Math.min(min, area);
      max = Math.max(max, area);
    }
    if (w >= h) {
      // a column down the left
      const across = sum / h;
      for (let k = i, at = y; k < j; k++) {
        const along = (sorted[k].size * scale) / across;
        out.push({ item: sorted[k], x, y: at, w: across, h: along });
        at += along;
      }
      x += across;
      w -= across;
    } else {
      // a row along the top
      const across = sum / w;
      for (let k = i, at = x; k < j; k++) {
        const along = (sorted[k].size * scale) / across;
        out.push({ item: sorted[k], x: at, y, w: along, h: across });
        at += along;
      }
      y += across;
      h -= across;
    }
    i = j;
  }
  return out;
}
