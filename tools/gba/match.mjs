// What match does for a Game Boy Advance game (../match.mjs): builds one file of C with the console's compiler
// (agbcc.mjs), turns what comes out into bytes (thumb.mjs), fills in every address a linker would, with each name's
// address in the original, and compares each function with the original's bytes. Nothing here knows where a game's
// files are or how the original is read: match gives it the file, the names' addresses and what reads the original, and
// a test gives it its own (test/match.mjs).

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { BASES, NAME } from '../portmap.mjs';
import { assemble } from './thumb.mjs';
import { compilerPath, COMPILERS } from './agbcc.mjs';

// the word a file can ask about, to tell this build from a Dreamport's: #ifdef MATCHING
const DEFINE = 'MATCHING';
// a flag that says how the code is made, which is all a game's proof/original.json may give the compiler: none that
// names a file
const FLAG = /^-[mfOW][\w=-]*$/;
const CARTRIDGE = 0x08000000;

// a compiler's name and flags, checked
function compilerOf(given, where, what) {
  if (!Object.hasOwn(COMPILERS, given.name)) throw new Error(`${where} names the compiler "${given.name}"${what}, and the tools have ${Object.keys(COMPILERS).join(' and ')}.`);
  if (!Array.isArray(given.flags) || !given.flags.every(flag => typeof flag === 'string' && FLAG.test(flag))) {
    throw new Error(`${where} needs the compiler's "flags"${what} as a list of those that say how the code is made, such as "-O2" and "-mthumb-interwork".`);
  }
  return { name: given.name, flags: given.flags };
}

/**
 * A game's compiler as its proof/original.json gives it, { name, flags, stretches }, checked, or an error that says
 * what it needs. `stretches` are the parts of the cartridge built another way, as a library the game was given
 * already built was, each { from, to, name, flags }, with its first and last address: `"stretches": [{ "from":
 * "08096AA0", "to": "0809B376", "name": "old_agbcc", "flags": [...] }]` in the compiler's own object.
 */
export function readCompiler(original, where) {
  const { compiler } = original;
  if (!compiler) throw new Error(`${where} doesn't say which compiler built the original: it needs "compiler": { "name": "agbcc" or "old_agbcc", "flags": [...] } (tools/README.md, Matching the original's bytes).`);
  const stretches = (compiler.stretches ?? []).map(stretch => {
    const address = /^[0-9A-F]{8}$/;
    if (!address.test(stretch?.from) || !address.test(stretch?.to) || parseInt(stretch.from, 16) > parseInt(stretch.to, 16)) {
      throw new Error(`${where} needs each of the compiler's "stretches" as { "from", "to", "name", "flags" }, its first and last address as eight capital hexadecimal digits.`);
    }
    return { from: parseInt(stretch.from, 16), to: parseInt(stretch.to, 16), ...compilerOf(stretch, where, ` for ${stretch.from} to ${stretch.to}`) };
  }).sort((a, b) => a.from - b.from);
  if (!Array.isArray(compiler.stretches ?? [])) throw new Error(`${where} needs the compiler's "stretches" as a list.`);
  for (let i = 1; i < stretches.length; i++) {
    if (stretches[i].from <= stretches[i - 1].to) throw new Error(`${where} has two of the compiler's "stretches" that overlap.`);
  }
  return { ...compilerOf(compiler, where, ''), stretches };
}

/** The compiler that built the original's code at `address`, { name, flags }: a stretch's, or the game's own. */
export function compilerAt(compiler, address) {
  const stretch = compiler.stretches?.find(each => address >= each.from && address <= each.to);
  return stretch ? { name: stretch.name, flags: stretch.flags } : { name: compiler.name, flags: compiler.flags };
}

/** The address the first name in `text` means, as portmap reads names, or null: a number is an address in the copy, and
 *  a label one in the release the game's labels come from, moved by the game's `shifts` (portmap.mjs). */
export function addressIn(text, shifts = []) {
  for (const [, label, digits] of text.matchAll(NAME)) {
    const address = parseInt(digits, 16) & ~1;
    if (BASES.has(address)) continue;
    return label ? address - (shifts.find(s => address >= s.from && address <= s.to)?.by ?? 0) : address;
  }
  return null;
}

/** The last function of a run a twin's comment names, as in `0x08001AA4 to 0x0800258E`, or null: a twin of one
 *  routine the code map holds as several functions, each running on into the next, is a twin of each of them, from the
 *  first address to the second, and its bytes are compared with all of theirs together. */
export function throughIn(text, shifts = []) {
  const found = [...text.matchAll(NAME)];
  for (let i = 0; i + 1 < found.length; i++) {
    const [first, second] = [found[i], found[i + 1]];
    if (!/^\s+to\s+$/.test(text.slice(first.index + first[0].length, second.index))) continue;
    const from = addressIn(first[0], shifts), to = addressIn(second[0], shifts);
    return from !== null && to !== null && to > from ? to : null;
  }
  return null;
}

/** The functions of a code map from `from` through the one at `through`, each { address, size, key }, when each starts
 *  where the one before ends, as one routine's do; or null when they don't, or no function starts at either end. */
export function runIn(functions, from, through) {
  const run = functions.filter(f => !f.bytes && f.address >= from && f.address <= through).sort((a, b) => a.address - b.address);
  if (!run.length || run[0].address !== from || run.at(-1).address !== through) return null;
  for (let i = 1; i < run.length; i++) if (run[i].address !== run[i - 1].address + run[i - 1].size) return null;
  return run;
}

// a name that is a label and nothing else
const LABEL = /^[A-Za-z][A-Za-z0-9]*_0?[238][0-9A-Fa-f]{6}$/;

/** What finds the address of a name a file uses and doesn't define, as its code keeps it, or null. `named` is a Map of
 *  the names a game gives addresses (its proof/addresses.json), which come first; `twins` a Map of each twin's name in
 *  the version's other files to the Set of addresses it's given, used when it's one; and a name that is a label says
 *  its own. A twin is Thumb code, whose address is kept odd, and so is a label where `startsFunction` says a function
 *  of the cartridge starts. */
export function addressFinder({ named = new Map(), twins = new Map(), shifts = [], startsFunction = () => false }) {
  return name => {
    if (named.has(name)) return named.get(name);
    if (twins.get(name)?.size === 1) return [...twins.get(name)][0] | 1;
    const label = LABEL.test(name) ? addressIn(name, shifts) : null;
    return label === null ? null : label | (label >= CARTRIDGE && startsFunction(label) ? 1 : 0);
  };
}

// A file of C read three ways: `code`, with every comment and every text in quotes blanked, so nothing in them reads
// as code, `kept`, with only its comments blanked, and the `comments`, each { from, to, text }
function lex(text) {
  let code = '', kept = '';
  const comments = [];
  for (let i = 0; i < text.length;) {
    const two = text.slice(i, i + 2);
    let end = i + 1;
    if (two === '//') end = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (two === '/*') end = text.indexOf('*/', i + 2) < 0 ? text.length : text.indexOf('*/', i + 2) + 2;
    else if (text[i] === '"' || text[i] === '\'') {
      for (end = i + 1; end < text.length && text[end] !== text[i] && text[end] !== '\n'; end++) if (text[end] === '\\') end++;
      end++;
    } else {
      kept += text[i];
      code += text[i++];
      continue;
    }
    const comment = two === '//' || two === '/*';
    if (comment) comments.push({ from: i, to: end, text: text.slice(i, end) });
    code += text.slice(i, end).replace(/[^\n]/g, ' ');
    kept += comment ? text.slice(i, end).replace(/[^\n]/g, ' ') : text.slice(i, end);
    i = end;
  }
  return { code, kept, comments };
}

/** A file of C as what it's built from: without its comments, and with each run of spaces as one. */
export const codeOf = text => lex(text).kept.replace(/\s+/g, ' ').trim();

/** The functions a file of C defines, each { name, address, line, own, code }: `address` is the function of the original it's
 *  the twin of, which the comment just above it names, or else its own name when that's a label, or null, `own`
 *  whether it's the file's own, a static function no other file can name, and `code` what it's written as, from its
 *  first word to its last brace, without its comments and with each run of spaces as one, which is what a proof of
 *  it is a proof of (../lib/proofs.mjs). A file of a shared library names no address: `given`, a Map of its twins'
 *  names to where the version's copy has each (../lib/libraries.mjs), says them instead. */
export const twinsIn = (text, shifts = [], given = null) => piecesIn(text, shifts, given).functions;

/** A file of C in pieces: the `functions` it defines, as twinsIn gives them, and the `rest`, everything it holds
 *  outside them, in order, each { text, pre }: a line for the preprocessor, with `pre`, or a declaration up to its ;,
 *  without its comments and with each run of spaces as one. It's what every function of the file is built with
 *  beside its own code, so a proof is of it too (../lib/proofs.mjs), and a step that changes it changes more than
 *  the functions it names (../lib/proven-step.mjs). */
export function piecesIn(text, shifts = [], given = null) {
  const { code, kept, comments } = lex(text);
  const twins = [], rest = [];
  // where what's outside every function, and not yet kept, starts
  let from = 0;
  const piece = (a, b, pre = false) => {
    const found = kept.slice(a, b).replace(/\s+/g, ' ').trim();
    if (found) rest.push({ text: found, pre });
  };
  // the function whose body is being read, and where its first word is
  let open = null;
  // where the statement being read started: after the last ; or } outside every { }, or the last line for the preprocessor
  let depth = 0, start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '#' && /^[ \t]*$/.test(code.slice(code.lastIndexOf('\n', i) + 1, i))) {
      // a line for the preprocessor, with the lines it carries on to
      const line = i;
      while (i < code.length && !(code[i] === '\n' && code[i - 1] !== '\\')) i++;
      if (!depth) {
        piece(from, line);
        piece(line, i, true);
        from = i;
        start = i;
      }
    } else if (c === '}') {
      depth--;
      if (!depth) {
        if (open) {
          open.twin.code = kept.slice(open.from, i + 1).replace(/\s+/g, ' ');
          from = i + 1;
        }
        open = null;
        start = i + 1;
      }
    } else if (c === ';' && !depth) {
      piece(from, i + 1);
      from = i + 1;
      start = i + 1;
    } else if (c === '{' && !depth++) {
      // a function's body: before it, a name and what it's given in ( )
      const m = /([A-Za-z_]\w*)\s*\(([^()]|\([^()]*\))*\)\s*$/.exec(code.slice(start, i));
      if (!m || ['if', 'while', 'for', 'switch'].includes(m[1])) continue;
      const first = start + code.slice(start, i).search(/\S/);
      // the comment that ends on the line above where it starts, and the // lines right above that one
      const above = [];
      for (let at = first, k = comments.length - 1; k >= 0; k--) {
        const comment = comments[k];
        if (comment.to > at || comment.from < start) continue;
        if (!/^[ \t]*\n?[ \t]*$/.test(text.slice(comment.to, at))) break;
        above.unshift(comment.text);
        if (!comment.text.startsWith('//')) break;
        at = comment.from;
      }
      const name = m[1], through = given ? null : throughIn(above.join('\n'), shifts);
      const address = given ? given.get(name) ?? null : addressIn(above.join('\n'), shifts) ?? addressIn(name, shifts);
      twins.push({ name, address, ...(through === null ? {} : { through }), line: text.slice(0, start + m.index).split('\n').length, own: /\bstatic\b/.test(code.slice(start, start + m.index)), code: '' });
      open = { twin: twins.at(-1), from: first };
      piece(from, first);
      from = first;
    }
  }
  if (!open) piece(from, code.length);
  return { functions: twins, rest };
}

// a folder's C, as the folders of names and bytes the preprocessor is given
function filesIn(folder) {
  const files = {};
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'proof') files[entry.name] = filesIn(join(folder, entry.name));
    } else if (/\.(c|h|inc)$/.test(entry.name)) files[entry.name] = readFileSync(join(folder, entry.name));
  }
  return files;
}

let clang;
// The file as the compiler reads it, with every #include and #define done. The console's compiler has no preprocessor
// of its own, and the one a computer has isn't the same everywhere, so this is the one `npm ci` brings, clang's, told
// to define nothing of its own.
export async function preprocess(file, root, includes) {
  if (!clang) {
    try {
      clang = await import('@yowasp/clang');
    } catch {
      throw new Error('The C preprocessor isn\'t here: run npm ci in the repository\'s folder first.');
    }
    await clang.runLLVM(null, {}, { fetchProgress: () => {} });
  }
  const inRoot = path => relative(root, path).split(sep).join('/') || '.';
  let said = '';
  const stderr = bytes => { if (bytes) said += Buffer.from(bytes).toString('utf8'); };
  const args = ['clang', '-E', '-P', '-undef', '-nostdinc', '-w', `-D${DEFINE}`, ...includes.flatMap(folder => ['-I', inRoot(folder)]), '-o', 'out.i', inRoot(file)];
  let made;
  try {
    made = await clang.runClang(args, filesIn(root), { stdout: stderr, stderr });
  } catch (error) {
    throw new Error(said.trim() || String(error.message ?? error).trim());
  }
  if (!made?.['out.i']) throw new Error(said.trim() || 'the preprocessor wrote nothing.');
  return Buffer.from(made['out.i']);
}

/**
 * Builds `file` and compares each function it defines with the original's.
 *   root, includes: the folder the file's C is in, and the folders it includes from
 *   compiler: { name, flags }, as readCompiler gives it
 *   work: the folder for what's built, <work>.i and <work>.s
 *   addressOf(name): the address in the original of a name the file doesn't define, as its code keeps it (odd for a
 *     Thumb function), or null
 *   sizeOf(address): how long the code map says the function there is, or null when none starts there
 *   runOf(address, through): for a twin of a run (throughIn), the code map's functions it's the twin of, as runIn
 *     gives them, or null
 *   original(address, bytes): that many of the original's bytes from there, as a Buffer, and with `lines` what the
 *     reader says of each halfword
 *   shifts: how far the labels' release is from the copy (portmap.mjs)
 *   given: for a file of a shared library, where the copy has each of its twins, as twinsIn takes it
 * Answers { functions: [{ name, address, line, same, bytes, differing, first, longer, missing, ours, theirs }], unknown },
 * where `missing` is the names in a function with no address and `unknown` every such name; or { error } when the file
 * didn't build, with what the compiler said.
 */
export async function matchFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, addressOf, sizeOf, runOf = () => null, original, shifts = [], given = null }) {
  mkdirSync(dirname(work), { recursive: true });
  let preprocessed;
  try {
    preprocessed = await preprocess(file, root, includes);
  } catch (error) {
    return { error: error.message };
  }
  writeFileSync(`${work}.i`, preprocessed);
  // -fhex-asm: numbers in the assembly as the reader writes them
  const cc = spawnSync(compilerPath(compiler.name), [...compiler.flags, '-fhex-asm', '-o', `${work}.s`, `${work}.i`], { encoding: 'utf8' });
  if (cc.error) return { error: `${compiler.name} didn't run: ${cc.error.message}` };
  if (cc.status !== 0) {
    // the compiler names each function as it goes, and the file it was given, which is the built one: what it says is
    // wrong is on the lines with a line number
    const said = (cc.stderr || cc.stdout).split('\n').map(line => line.trim()).filter(Boolean);
    const wrong = said.filter(line => /:\d+:/.test(line));
    return { error: (wrong.length ? wrong : said).join('\n').replaceAll(`${work}.i`, basename(file)) };
  }
  const assembly = readFileSync(`${work}.s`, 'utf8');
  let made;
  try {
    made = assemble(assembly);
  } catch (error) {
    return { error: error.message };
  }
  const code = made.sections['.text'].bytes, madeBy = made.sections['.text'].lines, lines = assembly.split('\n');
  const twins = new Map(twinsIn(readFileSync(file, 'utf8'), shifts, given).map(twin => [twin.name, twin]));

  // the functions the file defines, in the order they sit in its code, each up to the next
  const functions = [...made.symbols].filter(([, symbol]) => symbol.section === '.text' && symbol.function)
    .map(([name, symbol]) => ({ name, at: symbol.at, address: twins.get(name)?.address ?? null, through: twins.get(name)?.through ?? null, line: twins.get(name)?.line ?? null, missing: new Set() }))
    .sort((a, b) => a.at - b.at);
  functions.forEach((f, i) => {
    f.until = functions[i + 1]?.at ?? code.length;
    f.length = made.sizes.get(f.name) ?? f.until - f.at;
  });
  const owner = at => functions.find(f => at >= f.at && at < f.until);

  // each place a linker would fill in, with the name's address in the original
  const unknown = new Set();
  for (const { section, at, kind, name, addend } of made.relocations) {
    if (section !== '.text') continue;
    const inside = owner(at);
    if (!inside || inside.address === null) continue;
    const symbol = name && made.symbols.get(name);
    let target = null;
    if (symbol?.section === '.text') {
      // a place in this file's own code is where the original has the function it's in
      const place = symbol.function ? symbol.at : symbol.at + addend, of = owner(place);
      if (of && of.address !== null) target = of.address + (place - of.at) + (symbol.function ? addend + (kind === 'word' ? 1 : 0) : 0);
    } else if (name) {
      const address = addressOf(name);
      if (address !== null) target = address + addend;
    }
    if (target === null) {
      unknown.add(name);
      inside.missing.add(name);
    } else if (kind === 'word') code.writeUInt32LE(target >>> 0, at);
    else {
      // a call: how far it is from the instruction after next, in the two halves of the instruction
      const offset = (target & ~1) - (inside.address + (at - inside.at) + 4);
      if (offset < -0x400000 || offset >= 0x400000) inside.missing.add(name);
      code.writeUInt16LE(0xF000 | ((offset >> 12) & 0x7FF), at);
      code.writeUInt16LE(0xF800 | ((offset >> 1) & 0x7FF), at + 2);
    }
  }

  for (const f of functions) {
    f.missing = [...f.missing];
    if (f.address === null) continue;
    if (f.address < CARTRIDGE) {
      f.elsewhere = true;
      continue;
    }
    // a twin of a run is compared with all of the run's functions together, as long as they are
    f.run = f.through === null ? null : runOf(f.address, f.through);
    const mapped = f.run ? f.run.reduce((sum, each) => sum + each.size, 0) : f.through === null ? sizeOf(f.address) : null;
    f.mapped = mapped !== null;
    const theirs = original(f.address, Math.max(f.length, mapped ?? 0));
    // how long the original's is: as the code map has it, less the zeros that line up the function after it
    let length = mapped ?? f.length;
    if (length > f.length && theirs.bytes.subarray(f.length, length).every(byte => byte === 0)) length = f.length;
    f.bytes = mapped ?? f.length;
    f.longer = f.length - length;
    f.differing = 0;
    f.first = -1;
    f.halfwords = Math.max(f.length, length) / 2;
    f.ours = [];
    f.theirs = [];
    for (let i = 0; i < f.halfwords; i++) {
      const mine = i * 2 < f.length ? code.readUInt16LE(f.at + i * 2) : null;
      const its = i * 2 + 1 < theirs.bytes.length ? theirs.bytes.readUInt16LE(i * 2) : null;
      f.ours.push({ value: mine, text: mine === null ? '' : (lines[madeBy[f.at + i * 2] - 1] ?? '').trim().replace(/\s+/g, ' ') });
      f.theirs.push({ value: its, text: theirs.lines?.[i] ?? '' });
      if (mine !== its) {
        f.differing++;
        if (f.first < 0) f.first = i * 2;
      }
    }
    f.same = f.differing === 0 && !f.missing.length;
  }
  return { functions, unknown: [...unknown] };
}
