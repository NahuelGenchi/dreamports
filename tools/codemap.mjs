// npm run dp -- codemap <game> [--from <list>]: makes games/<game>/proof/code-map.json, every function in the
// original with its address and its size, and nothing of its code. It's what code ported is measured against.
// Without --from, it finds the functions in the contributor's copy itself (gba/functions.mjs). With --from, it takes
// them from a list: a decompilation's symbols, as `nm -S` prints them from its ELF file, or a CSV with an address
// and a size on each line, as a disassembler such as Ghidra exports its list of functions.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { readOriginal, writeCodeMap } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { readCopy } from './gba/header.mjs';
import { findFunctions } from './gba/functions.mjs';

// where code runs on the Game Boy Advance: the cartridge and the two work RAMs
const CODE = [[0x08000000, 0x0A000000], [0x03000000, 0x03008000], [0x02000000, 0x02040000]];
const isCode = address => CODE.some(([from, to]) => address >= from && address < to);

export async function run(args) {
  const game = args.find(a => !a.startsWith('--'));
  const fromAt = args.indexOf('--from');
  const list = fromAt >= 0 ? args[fromAt + 1] : null;
  if (!game || (fromAt >= 0 && !list)) throw new Error('Usage: npm run dp -- codemap <game> [--from <list of functions>]');
  const original = readOriginal(game);
  let functions, from;
  if (list) {
    functions = readList(readFileSync(list, 'utf8'));
    from = `The functions in ${basename(list)}`;
  } else {
    const copy = copyWith(original.sha1);
    if (!copy) throw new Error(`The code map is of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
    const read = await readCopy(copy.path);
    if (read?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
    functions = findFunctions(readFileSync(copy.path));
    from = 'Found in the copy by the proof tools (tools/gba/functions.mjs)';
  }
  if (!functions.length) throw new Error('No functions found.');
  writeCodeMap(game, { original: original.sha1, from, functions });
  const bytes = functions.reduce((sum, f) => sum + f.size, 0);
  console.log(`games/${game}/proof/code-map.json: ${functions.length} functions, ${bytes.toLocaleString('en')} bytes of code.`);
  return 0;
}

/** The functions in a list: `nm -S` lines, or a CSV with a header naming its address and size columns. */
export function readList(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  // an address is hexadecimal, with or without 0x or a memory's name before it (ram:08000204); a size is decimal
  // unless it starts with 0x
  const clean = value => String(value ?? '').trim().replace(/^.*:/, '');
  const address = value => (/^(0x)?[0-9a-f]+$/i.test(clean(value)) ? parseInt(clean(value).replace(/^0x/i, ''), 16) : NaN);
  const size = value => (/^0x[0-9a-f]+$/i.test(clean(value)) ? parseInt(clean(value), 16) : /^\d+$/.test(clean(value)) ? Number(clean(value)) : NaN);
  const out = [];
  const nm = /^([0-9a-f]{8})\s+([0-9a-f]{8})\s+([tTwW])\s+(\S+)/i;
  if (lines.some(l => nm.test(l))) {
    for (const line of lines) {
      const m = line.match(nm);
      if (m) out.push({ address: parseInt(m[1], 16) & ~1, size: parseInt(m[2], 16), name: m[4] });
    }
  } else {
    const split = line => line.match(/("[^"]*"|[^,\t]+)/g)?.map(c => c.replace(/^"|"$/g, '').trim()) ?? [];
    const head = split(lines[0]).map(c => c.toLowerCase());
    const column = (...patterns) => head.findIndex(h => patterns.some(p => p.test(h)));
    const at = column(/^(address|location|entry ?point|start)$/, /address|location|entry/);
    const length = column(/^(size|length|function size)$/, /size|length/);
    const label = column(/^(name|label|function name|symbol)$/);
    if (at < 0 || length < 0) throw new Error('The list needs columns for the address and the size, named in its first line, or nm -S lines.');
    for (const line of lines.slice(1)) {
      const cells = split(line);
      const start = address(cells[at]), bytes = size(cells[length]);
      if (Number.isFinite(start)) out.push({ address: start & ~1, size: Number.isFinite(bytes) ? bytes : 0, name: label >= 0 ? cells[label] : undefined });
    }
  }
  // only code, each function once, and those listed without a size as long as the gap to the next
  const byAddress = new Map();
  for (const f of out) if (isCode(f.address) && !byAddress.has(f.address)) byAddress.set(f.address, f);
  const sorted = [...byAddress.values()].sort((a, b) => a.address - b.address);
  return sorted.map((f, i) => {
    const next = sorted[i + 1]?.address;
    const size = f.size || (next && next - f.address < 0x10000 ? next - f.address : 0);
    return { address: f.address, size, ...(f.name ? { name: f.name } : {}) };
  }).filter(f => f.size > 0);
}
