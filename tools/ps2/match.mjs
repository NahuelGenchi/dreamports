// What match does for a PlayStation 2 game (../match.mjs): builds one file of C with Sony's own compiler and its own
// assembler for the EE (gcc.mjs), as the original was built, fills in every address a linker would, with each name's
// address in the original, and compares each function with the bytes of the program the disc boots, a word at a time.
// Nothing between the C and the bytes is the tools' own: the compiler's driver runs its preprocessor, its compiler and
// its assembler, and what comes out is the object file a game's makers got.
//
// An object keeps a file's values in sections of their own, a switch's table and a text in quotes in .rodata, a
// variable in .data, .sdata or .bss, and its code reaches each as its section and a distance into it. The linker
// put each section of the file somewhere in the program, whole, so every reference into a section has to agree on
// where: match reads the address from the original's instructions at the same places, the upper and lower halves a
// lui and the instruction after it give, or a distance from $gp, takes the section's distance off, and has one
// address for the section, or says they disagree. A table's words then say where the sections it points into are.
// Then each piece of a section the function reaches, from one place the code names to the next, has to be the file's
// own bytes, addresses filled in, or the function isn't the same. A piece that starts at zero, in .bss, is the same
// when the original's is zeros too, or past the end of the program's file, where the program clears its own memory.
//
// The game-level part, which files to build, what to say and which proofs to keep, is the PlayStation's
// (../ps1/match.mjs, matchGameOn): only the console's own is here.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, relative, sep } from 'node:path';
import { hex } from '../lib/proof-files.mjs';
import { twinsIn } from '../gba/match.mjs';
import { matchGameOn } from '../ps1/match.mjs';
import { EE_GCC, ensureEeGcc } from './gcc.mjs';
import { decode } from './ee.mjs';
import { ps2Program } from './functions.mjs';
import { ps2Resolve } from './read.mjs';
import { gpOf } from './twin.mjs';

// a flag that says how the code is made, which is all a game's proof/original.json may give the compiler: none that
// names a file
const FLAG = /^-(?:[mfOW][\w=.,-]*|G\d+)$/;
// the name the game's own headers can tell a build for match by, as on the other consoles
const DEFINE = 'MATCHING';
// a name that is a label and nothing else, as func_00123450 or D_003A1234
const LABEL = /^[A-Za-z][A-Za-z0-9]*_0[01][0-9A-Fa-f]{6}$/;
// the kinds of place a linker fills in, by their numbers in a MIPS object
const KINDS = { 2: 'word32', 4: 'jump26', 5: 'hi16', 6: 'lo16', 7: 'gprel16' };
const signed16 = word => ((word & 0xFFFF) ^ 0x8000) - 0x8000;

function compilerOf(given, where, what) {
  if (given.name !== 'ee-gcc') throw new Error(`${where} names the compiler "${given.name}"${what}, and on the PlayStation 2 the tools have ee-gcc, Sony's own.`);
  if (!Object.hasOwn(EE_GCC, given.version)) throw new Error(`${where} names EE-GCC ${given.version ?? 'with no "version"'}${what}, and the tools build ${Object.keys(EE_GCC).join(' and ')}.`);
  if (!Array.isArray(given.flags) || !given.flags.every(flag => typeof flag === 'string' && FLAG.test(flag))) {
    throw new Error(`${where} needs the compiler's "flags"${what} as a list of those that say how the code is made, such as "-O2" and "-G0".`);
  }
  return { name: 'ee-gcc', version: given.version, flags: given.flags };
}

/**
 * A PlayStation 2 game's compiler as its proof/original.json gives it, checked: { name: "ee-gcc", version:
 * "2.9-ee-991111-01", flags: [...], stretches }, `stretches` the parts of the program built another way, as Sony's
 * libraries in it are, each { from, to, ...the same }, with its first and last address as eight capital hexadecimal
 * digits.
 */
export function readCompiler(original, where) {
  const { compiler } = original;
  if (!compiler) throw new Error(`${where} doesn't say how the original was built: it needs "compiler": { "name": "ee-gcc", "version": "2.9-ee-991111-01", "flags": [...] } (tools/README.md, Matching the original's bytes).`);
  if (!Array.isArray(compiler.stretches ?? [])) throw new Error(`${where} needs the compiler's "stretches" as a list.`);
  const stretches = (compiler.stretches ?? []).map(stretch => {
    const address = /^[0-9A-F]{8}$/;
    if (!address.test(stretch?.from) || !address.test(stretch?.to) || parseInt(stretch.from, 16) > parseInt(stretch.to, 16)) {
      throw new Error(`${where} needs each of the compiler's "stretches" with its first and last address, "from" and "to", as eight capital hexadecimal digits.`);
    }
    return { from: parseInt(stretch.from, 16), to: parseInt(stretch.to, 16), ...compilerOf({ name: compiler.name, version: compiler.version, ...stretch }, where, ` for ${stretch.from} to ${stretch.to}`) };
  }).sort((a, b) => a.from - b.from);
  for (let i = 1; i < stretches.length; i++) if (stretches[i].from <= stretches[i - 1].to) throw new Error(`${where} has two of the compiler's "stretches" that overlap.`);
  return { ...compilerOf(compiler, where, ''), stretches };
}

/** The way the original's code at `address` was built: a stretch's, or the game's own. */
export function wayAt(compiler, address) {
  const { name, version, flags } = compiler.stretches?.find(each => address >= each.from && address <= each.to) ?? compiler;
  return { name, version, flags };
}

/** What a compiler's way is called, to tell two apart. */
export const wayText = way => `EE-GCC ${way.version} ${way.flags.join(' ')}`;

/**
 * An object file as match takes it: { sections, functions, names }. `sections` is a Map of each loaded section's name
 * to { bytes, zeroed, relocations }, `zeroed` for one a program's file doesn't hold, as .bss, and each relocation
 * { at, kind, section, symbol, addend }: a place a linker fills in, `kind` 'hi16', 'lo16', 'gprel16', 'jump26' or
 * 'word32', with where it points, `section` and `addend`, a distance into a section of this file, or `symbol` and
 * `addend`, past a name another file defines. The addend an object keeps in the place itself is taken out of the bytes.
 * `functions` are the code's, { name, at, size }, and `names` each section's named values, { name, at, size }.
 */
export function objectOf(object) {
  if (object.length < 52 || object.readUInt32BE(0) !== 0x7F454C46 || object.readUInt16LE(16) !== 1) throw new Error('The compiler didn\'t make an object file.');
  const count = object.readUInt16LE(48), table = object.readUInt32LE(32), strings = object.readUInt32LE(table + object.readUInt16LE(50) * 40 + 16);
  const text = (from, at) => object.toString('latin1', from + at, object.indexOf(0, from + at));
  const headers = Array.from({ length: count }, (_, i) => {
    const o = table + i * 40;
    return { name: text(strings, object.readUInt32LE(o)), type: object.readUInt32LE(o + 4), flags: object.readUInt32LE(o + 8), offset: object.readUInt32LE(o + 16), size: object.readUInt32LE(o + 20), link: object.readUInt32LE(o + 24), info: object.readUInt32LE(o + 28) };
  });
  const sections = new Map();
  for (const h of headers) {
    if (!(h.flags & 2) || (h.type !== 1 && h.type !== 8)) continue;
    sections.set(h.name, { bytes: h.type === 8 ? Buffer.alloc(h.size) : Buffer.from(object.subarray(h.offset, h.offset + h.size)), zeroed: h.type === 8, relocations: [] });
  }
  const symtab = headers.find(h => h.type === 2);
  const symbols = [];
  if (symtab) {
    const names = headers[symtab.link].offset;
    for (let o = symtab.offset; o + 16 <= symtab.offset + symtab.size; o += 16) {
      const index = object.readUInt16LE(o + 14);
      symbols.push({ name: text(names, object.readUInt32LE(o)), value: object.readUInt32LE(o + 4), size: object.readUInt32LE(o + 8), type: object[o + 12] & 15, section: index && index < count ? headers[index].name : null, common: index === 0xFFF2 });
    }
  }
  // what $gp is taken to be inside the object, which a distance from it to one of the file's own values counts from
  const reginfo = headers.find(h => h.name === '.reginfo');
  const gp0 = reginfo && reginfo.size >= 24 ? object.readUInt32LE(reginfo.offset + 20) : 0;
  for (const h of headers) {
    if (h.type !== 9) continue;
    const section = sections.get(headers[h.info].name);
    if (!section) continue;
    const entries = [];
    for (let o = h.offset; o + 8 <= h.offset + h.size; o += 8) {
      const info = object.readUInt32LE(o + 4), kind = KINDS[info & 0xFF];
      if (!kind) throw new Error(`The object has a kind of place to fill in that match doesn't know, ${info & 0xFF}, in ${headers[h.info].name}.`);
      entries.push({ at: object.readUInt32LE(o), kind, symbol: symbols[info >>> 8], index: info >>> 8 });
    }
    // each place's addend, kept in the place itself: an upper half's with the lower half of the next lo16 of the same
    // symbol, and a lower half's near the last upper half's, as the two make one address
    const word = at => section.bytes.readUInt32LE(at);
    const last = new Map();
    entries.forEach((entry, i) => {
      const held = word(entry.at);
      if (entry.kind === 'word32') entry.addend = held;
      else if (entry.kind === 'jump26') entry.addend = (held & 0x3FFFFFF) << 2;
      else if (entry.kind === 'gprel16') entry.addend = signed16(held) + (entry.symbol.type === 3 ? gp0 : 0);
      else if (entry.kind === 'hi16') {
        const partner = entries.slice(i + 1).find(next => next.kind === 'lo16' && next.index === entry.index);
        entry.addend = ((held & 0xFFFF) << 16) + (partner ? signed16(word(partner.at)) : 0);
        last.set(entry.index, entry.addend);
      } else {
        const near = last.get(entry.index) ?? 0, low = signed16(held);
        entry.addend = near + (((low - near + 0x8000) & 0xFFFF) - 0x8000);
      }
    });
    for (const entry of entries) {
      // the addend out of the place, so filling it in is the same for every kind
      const held = word(entry.at);
      section.bytes.writeUInt32LE((entry.kind === 'word32' ? 0 : entry.kind === 'jump26' ? held & 0xFC000000 : held & 0xFFFF0000) >>> 0, entry.at);
      const { symbol } = entry;
      if (symbol.section && sections.has(symbol.section)) section.relocations.push({ at: entry.at, kind: entry.kind, section: symbol.section, addend: (symbol.type === 3 ? 0 : symbol.value) + entry.addend });
      else if (symbol.common) throw new Error(`${symbol.name} is a value with no start, which the linker places among every file's: give it one, as = 0, or build with -fno-common.`);
      else section.relocations.push({ at: entry.at, kind: entry.kind, symbol: symbol.name, addend: entry.addend });
    }
    section.relocations.sort((a, b) => a.at - b.at);
  }
  const code = symbols.filter(s => s.type === 2 && s.section === '.text').sort((a, b) => a.value - b.value);
  const functions = code.map((s, i) => ({ name: s.name, at: s.value, size: s.size || (code[i + 1]?.value ?? sections.get('.text').bytes.length) - s.value }));
  const names = new Map([...sections.keys()].map(name => [name, symbols.filter(s => s.section === name && s.name && (s.type === 1 || s.type === 0) && !/^(gcc2_compiled\.|__gnu_compiled_c(plusplus)?)$/.test(s.name)).map(s => ({ name: s.name, at: s.value, size: s.size }))]));
  return { sections, functions, names };
}

/**
 * Builds `file` as match does, with Sony's driver: <work>.o, and <work>.s, the compiler's assembly, to read. Gives
 * { object }, the object's bytes, or { error }, what the compiler said.
 */
export async function compileFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, log = () => {} }) {
  const { gcc } = await ensureEeGcc(compiler.version, log);
  mkdirSync(dirname(work), { recursive: true });
  const temporary = `${work}.tmp`;
  mkdirSync(temporary, { recursive: true });
  try {
    const inRoot = path => relative(root, path).split(sep).join('/') || '.';
    const common = [...compiler.flags, '-nostdinc', `-D${DEFINE}`, ...includes.flatMap(folder => ['-I', inRoot(folder)]), inRoot(file)];
    const run = more => spawnSync(gcc, [...common, ...more], { cwd: root, env: { ...process.env, LC_ALL: 'C', TMPDIR: temporary }, encoding: 'utf8' });
    for (const output of [`${work}.o`, `${work}.s`]) rmSync(output, { force: true });
    const built = run(['-c', '-o', `${work}.o`]);
    if (built.error || built.status !== 0) return { error: `${built.stdout ?? ''}${built.stderr ?? ''}`.trim() || built.error?.message || `the compiler ended with ${built.status}` };
    run(['-S', '-o', `${work}.s`]);
    return { object: readFileSync(`${work}.o`) };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

// a place filled in with `target`: false when it can't hold it
function fill(buffer, at, kind, target, { place, gp }) {
  const word = buffer.readUInt32LE(at);
  let made;
  if (kind === 'hi16') made = (word & 0xFFFF0000) | (((target + 0x8000) >>> 16) & 0xFFFF);
  else if (kind === 'lo16') made = (word & 0xFFFF0000) | (target & 0xFFFF);
  else if (kind === 'gprel16') {
    const distance = (target - gp) | 0;
    if (!gp || distance < -0x8000 || distance > 0x7FFF) return false;
    made = (word & 0xFFFF0000) | (distance & 0xFFFF);
  } else if (kind === 'jump26') {
    // a jump stays in the 256 MB the instruction after it is in
    if (((place + 4) & 0xF0000000) !== (target & 0xF0000000) || target % 4) return false;
    made = (word & 0xFC000000) | ((target >>> 2) & 0x3FFFFFF);
  } else made = target;
  buffer.writeUInt32LE(made >>> 0, at);
  return true;
}

/**
 * Compares each function of an object, as objectOf gives it, with the original's.
 *   twins: a Map of each function's name to { address, through, line }, as twinsIn finds them in the file
 *   addressOf(name): the address in the original of a name the version gives one, or null
 *   sizeOf(address): how long the code map says the function there is, or null when none starts there
 *   runOf(address, through): for a twin of a run, the code map's functions it's the twin of, as runIn gives them
 *   program: the program the disc boots as it's loaded, { load, text }, and `gp`, where it points $gp
 * Answers { functions: [{ name, address, line, same, bytes, words, differing, first, longer, missing, data, ours,
 * theirs, made, calls }], unknown }, as the PlayStation's matchFile does: `missing` is the names in a function with
 * no address, `data` each piece of the file's own values it reaches, { name, address, bytes, same, why }, and
 * `unknown` every name with none.
 */
export function matchObject(made, { twins, addressOf, sizeOf, runOf = () => null, program, gp = 0 }) {
  const code = made.sections.get('.text') ?? { bytes: Buffer.alloc(0), relocations: [] };
  const inProgram = (address, bytes) => address >= program.load && address + bytes <= program.load + program.text.length;
  const wordAt = address => program.text.readUInt32LE(address - program.load);
  const functions = made.functions.map(f => ({
    name: f.name, at: f.at, length: f.size, address: twins.get(f.name)?.address ?? null, through: twins.get(f.name)?.through ?? null,
    line: twins.get(f.name)?.line ?? null, missing: new Set(), calls: [], reaches: new Set(),
  }));
  const owner = at => functions.find(f => at >= f.at && at < f.at + f.length);
  const values = [...made.sections].filter(([name]) => name !== '.text');

  // where the linker put each section of values: every reference into it says, and they have to agree
  const proposed = new Map(values.map(([name]) => [name, new Set()]));
  const baseOf = name => (proposed.get(name)?.size === 1 ? [...proposed.get(name)][0] : null);
  for (const f of functions) {
    if (f.address === null || !inProgram(f.address, f.length)) continue;
    const halves = new Map();
    for (const r of code.relocations) {
      if (r.at < f.at || r.at >= f.at + f.length || !proposed.has(r.section)) continue;
      const theirs = wordAt(f.address + r.at - f.at), key = `${r.section}+${r.addend}`;
      if (r.kind === 'hi16') halves.set(key, (theirs & 0xFFFF) << 16);
      else if (r.kind === 'lo16' && halves.has(key)) proposed.get(r.section).add((halves.get(key) + signed16(theirs) - r.addend) >>> 0);
      else if (r.kind === 'gprel16' && gp) proposed.get(r.section).add((gp + signed16(theirs) - r.addend) >>> 0);
    }
  }
  // and a table's words say where the sections it points into are, until no more are found
  for (let more = true; more;) {
    more = false;
    for (const [name, { relocations }] of values) {
      const base = baseOf(name);
      if (base === null) continue;
      for (const r of relocations) {
        if (r.kind !== 'word32' || !proposed.has(r.section) || proposed.get(r.section).size || !inProgram(base + r.at, 4)) continue;
        proposed.get(r.section).add((wordAt(base + r.at) - r.addend) >>> 0);
        more = true;
      }
    }
  }

  // where a place points: into the file's code, into one of its sections of values, or at a name the version gives
  const targetOf = r => {
    if (r.section === '.text') {
      const of = owner(r.addend);
      return of && of.address !== null ? of.address + r.addend - of.at : null;
    }
    if (r.section) return baseOf(r.section) === null ? null : baseOf(r.section) + r.addend;
    const address = addressOf(r.symbol);
    return address === null ? null : address + r.addend;
  };

  // each section of values cut into pieces, from one place something points at or names to the next
  const pieces = new Map();
  for (const [name, section] of values) {
    const cuts = new Set([0, section.bytes.length]);
    for (const [, each] of made.sections) for (const r of each.relocations) if (r.section === name && r.addend > 0 && r.addend < section.bytes.length) cuts.add(r.addend);
    for (const named of made.names.get(name) ?? []) if (named.at < section.bytes.length) cuts.add(named.at);
    const sorted = [...cuts].sort((a, b) => a - b);
    pieces.set(name, sorted.slice(0, -1).map((at, i) => ({
      section: name, at, size: sorted[i + 1] - at, name: (made.names.get(name) ?? []).find(named => named.at === at)?.name ?? `${name}+0x${at.toString(16).toUpperCase()}`,
      missing: new Set(), reaches: new Set(),
    })));
  }
  const pieceAt = (name, at) => pieces.get(name)?.findLast(piece => piece.at <= at) ?? null;

  // the values with every address filled in
  const unknown = new Set();
  for (const [name, section] of values) {
    for (const r of section.relocations) {
      const holder = pieceAt(name, r.at), base = baseOf(name), target = targetOf(r);
      if (r.section && r.section !== '.text') holder.reaches.add(pieceAt(r.section, r.addend));
      if (target === null || base === null || !fill(section.bytes, r.at, r.kind, target, { place: base + r.at, gp })) {
        holder.missing.add(r.section ?? r.symbol);
        if (!r.section) unknown.add(r.symbol);
      }
    }
  }
  // and the code
  for (const r of code.relocations) {
    const f = owner(r.at);
    if (!f || f.address === null) continue;
    if (r.section && r.section !== '.text') f.reaches.add(pieceAt(r.section, r.addend));
    const target = targetOf(r);
    if (target === null || !fill(code.bytes, r.at, r.kind, target, { place: f.address + r.at - f.at, gp })) {
      // a section of the file's own that isn't placed is said where its piece is: unknown is the version's names
      if (!r.section) unknown.add(r.symbol);
      f.missing.add(r.section ?? r.symbol);
    } else if (r.kind === 'jump26') f.calls.push(target);
  }

  // a piece compared with the original's: its bytes as built, every address filled in, beside what's at its address
  const compared = new Map();
  const compare = piece => {
    if (compared.has(piece)) return compared.get(piece);
    const base = baseOf(piece.section), address = base === null ? null : base + piece.at, section = made.sections.get(piece.section);
    const result = { name: piece.name, address, bytes: piece.size, same: false, why: '' };
    compared.set(piece, result);
    if (address === null) result.why = proposed.get(piece.section).size > 1 ? `the original's instructions put ${piece.section} at more than one address, ${[...proposed.get(piece.section)].map(at => `0x${hex(at)}`).join(' and ')}` : `the original's instructions don't say where ${piece.section} is`;
    else if (piece.missing.size) result.why = `no address for ${[...piece.missing].join(', ')}`;
    else if (inProgram(address, piece.size)) {
      const ours = section.bytes.subarray(piece.at, piece.at + piece.size), theirs = program.text.subarray(address - program.load, address - program.load + piece.size);
      result.same = Buffer.compare(ours, theirs) === 0;
      if (!result.same) result.why = `differs from the original's at 0x${hex(address)}`;
    } else if (section.zeroed && address >= program.load + program.text.length) result.same = true;
    else result.why = `0x${hex(address)} isn't in the program's file`;
    return result;
  };
  const reached = f => {
    const all = new Set(), queue = [...f.reaches];
    while (queue.length) {
      const piece = queue.shift();
      if (!piece || all.has(piece)) continue;
      all.add(piece);
      queue.push(...piece.reaches);
    }
    return [...all].map(compare);
  };

  for (const f of functions) {
    f.made = Buffer.from(code.bytes.subarray(f.at, f.at + f.length));
    f.data = f.address === null ? [] : reached(f);
    f.missing = [...f.missing].filter(name => !made.sections.has(name));
    if (f.address === null) continue;
    if (!inProgram(f.address, 4)) {
      // code the game loads as it runs, which the program the disc boots doesn't hold
      f.elsewhere = true;
      continue;
    }
    f.run = f.through === null ? null : runOf(f.address, f.through);
    const mapped = f.run ? f.run.reduce((sum, each) => sum + each.size, 0) : f.through === null ? sizeOf(f.address) : null;
    f.mapped = mapped !== null;
    const length = mapped ?? f.length;
    f.bytes = length;
    f.longer = f.length - length;
    f.words = Math.max(f.length, length) / 4;
    f.differing = 0;
    f.first = -1;
    f.ours = [];
    f.theirs = [];
    for (let i = 0; i < f.words; i++) {
      const address = f.address + i * 4;
      const mine = i * 4 < f.length ? code.bytes.readUInt32LE(f.at + i * 4) : null;
      const its = i * 4 < length && inProgram(address, 4) ? wordAt(address) : null;
      f.ours.push({ value: mine, text: mine === null ? '' : decode(mine, address)?.text ?? '' });
      f.theirs.push({ value: its, text: its === null ? '' : decode(its, address)?.text ?? '' });
      if (mine !== its) {
        f.differing++;
        if (f.first < 0) f.first = i * 4;
      }
    }
    f.same = f.differing === 0 && !f.missing.length && f.data.every(value => value.same);
  }
  for (const f of functions) delete f.reaches;
  return { functions, unknown: [...unknown] };
}

/**
 * Builds `file` and compares each function it defines with the original's, as the PlayStation's matchFile does, with
 * the same arguments and the same answer, or { error } when the file didn't build.
 */
export async function matchFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, addressOf, sizeOf, runOf = () => null, program, gp = 0, shifts = [], given = null, log = () => {} }) {
  const built = await compileFile({ file, root, includes, compiler, work, log });
  if (built.error) return { error: built.error.replaceAll(`${relative(root, file).split(sep).join('/')}:`, `${basename(file)}:`) };
  let made;
  try {
    made = objectOf(built.object);
  } catch (error) {
    return { error: error.message };
  }
  const twins = new Map(twinsIn(readFileSync(file, 'utf8'), shifts, given, 'ps2').map(twin => [twin.name, twin]));
  return matchObject(made, { twins, addressOf, sizeOf, runOf, program, gp });
}

/** A program for the EE as it's loaded: { load, text }, its first address and the bytes its file holds from there. */
export function loadedOf(elf) {
  if (elf.readUInt32BE(0) !== 0x7F454C46) throw new Error('This isn\'t a program for the PlayStation 2\'s processor: it has no ELF header.');
  const segments = [];
  for (let i = 0; i < elf.readUInt16LE(44); i++) {
    const o = elf.readUInt32LE(28) + i * 32;
    if (elf.readUInt32LE(o) === 1 && elf.readUInt32LE(o + 16)) segments.push({ address: elf.readUInt32LE(o + 8), offset: elf.readUInt32LE(o + 4), size: elf.readUInt32LE(o + 16) });
  }
  if (!segments.length) throw new Error('The program has nothing its file loads.');
  const load = Math.min(...segments.map(s => s.address)), end = Math.max(...segments.map(s => s.address + s.size));
  if (segments.length === 1) return { load, text: elf.subarray(segments[0].offset, segments[0].offset + segments[0].size) };
  const text = Buffer.alloc(end - load);
  for (const s of segments) elf.copy(text, s.address - load, s.offset, s.offset + s.size);
  return { load, text };
}

// what match needs to know of the PlayStation 2, as the PlayStation's has it (../ps1/match.mjs)
const PLAYSTATION_2 = {
  console: 'ps2', place: 'the PlayStation 2', compiler: 'Sony\'s EE-GCC', label: LABEL, labelExample: 'D_003A1234', readCompiler, wayAt, wayText, matchFile,
  programOf: async path => {
    const elf = await ps2Program(path);
    return { program: loadedOf(elf), gp: gpOf(elf) ?? 0 };
  },
  resolve: (game, codeMap, what) => {
    const found = ps2Resolve(game, codeMap, what);
    if (found.program || found.vu) throw new Error(`match compares the program the disc boots, and ${what} is ${found.vu ? 'a vector unit\'s program' : `in ${found.program}`}.`);
    return found.address;
  },
};

/** match on a PlayStation 2 game: as ../match.mjs does on the Game Boy Advance, with `log` for what it says. */
export const matchGame = options => matchGameOn(PLAYSTATION_2, options);

