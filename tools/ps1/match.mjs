// What match does for a PlayStation game (../match.mjs): builds one file of C as the original was built, with GCC 2.x
// (gcc.mjs), what Sony's assembler, ASPSX, made of GCC's assembly (maspsx.mjs) and the tools' own assembler
// (assemble.mjs), fills in every address a linker would, with each name's address in the original, and compares each
// function with the bytes of the program the disc boots, a word at a time.
//
// GCC keeps a switch's table of addresses and a text in quotes apart from the function, in the file's own values, under
// names of its own such as $L9 and $LC0 that no other file can name. Where the original has each is where its own
// instructions point: match reads the address from the original's instruction at the same place, the upper and lower
// halves a lui and the instruction after it give, or a word a table holds, and then the values there have to be the
// file's own, byte for byte, with the addresses in them filled in, or the function isn't the same. A value the program
// doesn't hold, as a static variable that starts at zero, is the same when the original's is zeros too, or outside the
// program's file, where the program clears its own memory. A name the version gives an address (proof/addresses.json,
// a twin, a label) is where it says, and is compared the same way.
//
// Nothing here knows where a game's files are or how the original is read: match gives it the file, the names'
// addresses and the program, and a test gives it its own (test/ps1-match.mjs).

import { fork } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { LOCAL, REPO } from '../lib/paths.mjs';
import { hex, inBootProgram, readCodeMap } from '../lib/proof-files.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { addressIn, runIn, twinsIn } from '../gba/match.mjs';
import { GCC } from './gcc.mjs';
import { maspsx } from './maspsx.mjs';
import { assemble } from './assemble.mjs';
import { decode } from './mips.mjs';
import { exeOf, ps1Program } from './functions.mjs';
import { ps1Resolve } from './read.mjs';
import { gpOf } from './twin.mjs';

// a flag that says how the code is made, which is all a game's proof/original.json may give the compiler: none that
// names a file
const FLAG = /^-(?:[mfOW][\w=.,-]*|G\d+)$/;
// what original.json may ask of maspsx, each setting as maspsx.mjs names it, and what it is
const SETTINGS = { aspsxVersion: 'string', expandDiv: 'boolean', dontExpandLi: 'boolean', useCommSection: 'boolean', useCommForLcomm: 'boolean', maxCommAlignment: 'number' };
// the sections that start at zero, which a program's file doesn't hold
const ZEROED = new Set(['.bss', '.sbss']);
// a name that is a label and nothing else, as func_80012345 or D_800A1234
const LABEL = /^[A-Za-z][A-Za-z0-9]*_80[0-7][0-9A-Fa-f]{5}$/;

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');

function compilerOf(given, where, what) {
  if (given.name !== 'gcc') throw new Error(`${where} names the compiler "${given.name}"${what}, and on the PlayStation the tools have gcc.`);
  if (!Object.hasOwn(GCC, given.version)) throw new Error(`${where} names GCC ${given.version ?? 'with no "version"'}${what}, and the tools build ${Object.keys(GCC).join(' and ')}.`);
  if (!Array.isArray(given.flags) || !given.flags.every(flag => typeof flag === 'string' && FLAG.test(flag))) {
    throw new Error(`${where} needs the compiler's "flags"${what} as a list of those that say how the code is made, such as "-O2" and "-G0".`);
  }
  const settings = given.maspsx ?? {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTINGS[key] || typeof value !== SETTINGS[key]) throw new Error(`${where} gives maspsx "${key}"${what}, and it takes ${Object.keys(SETTINGS).join(', ')}.`);
  }
  if (settings.aspsxVersion !== undefined && !/^\d+\.\d+$/.test(settings.aspsxVersion)) throw new Error(`${where} needs maspsx's "aspsxVersion"${what} as ASPSX's version, such as "2.56".`);
  return { name: 'gcc', version: given.version, flags: given.flags, maspsx: settings };
}

/**
 * A PlayStation game's compiler as its proof/original.json gives it, checked: { name: "gcc", version: "2.7.2", flags:
 * [...], maspsx: { aspsxVersion: "2.56", ... }, stretches }, `maspsx` being what maspsx is asked, as its command line
 * would, and `stretches` the parts of the program built another way, each { from, to, ...the same }, with its first and
 * last address as eight capital hexadecimal digits.
 */
export function readCompiler(original, where) {
  const { compiler } = original;
  if (!compiler) throw new Error(`${where} doesn't say how the original was built: it needs "compiler": { "name": "gcc", "version": "2.7.2", "flags": [...], "maspsx": { "aspsxVersion": "..." } } (tools/README.md, Matching the original's bytes).`);
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
  const { name, version, flags, maspsx: settings } = compiler.stretches?.find(each => address >= each.from && address <= each.to) ?? compiler;
  return { name, version, flags, maspsx: settings };
}

/** What a compiler's way is called, to tell two apart. */
export const wayText = way => `GCC ${way.version} ${way.flags.join(' ')}${way.maspsx.aspsxVersion ? `, ASPSX ${way.maspsx.aspsxVersion}` : ''}`;

/** The -G a compiler's flags give GCC, which maspsx is given too: how big a value it reaches through $gp. */
const smallDataOf = flags => Number(flags.filter(flag => /^-G\d+$/.test(flag)).at(-1)?.slice(2) ?? 0);

// The process clang's preprocessor and GCC run in (compile-child.mjs), kept running from the first file to the last,
// and what each of its answers is waited for by
const CHILD = new URL('./compile-child.mjs', import.meta.url);
let child = null, asked = 0;
const waiting = new Map();

function compilerProcess() {
  if (child) return child;
  const started = fork(CHILD, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  started.on('message', message => {
    const wait = waiting.get(message.id);
    if (!wait) return;
    if (message.log !== undefined) wait.log(message.log);
    else {
      waiting.delete(message.id);
      wait.resolve(message);
    }
  });
  // one that stops, as one that crashed does, leaves what it was asked unanswered: it's asked again of the next
  started.on('exit', (code, signal) => {
    if (child === started) child = null;
    for (const [id, wait] of waiting) {
      waiting.delete(id);
      wait.resolve({ stopped: signal ?? `exit code ${code}` });
    }
  });
  // match ends while it's still there, as it isn't waited for
  started.unref();
  started.channel?.unref();
  child = started;
  return child;
}

/** Preprocesses `file` and compiles it with GCC in the compiler's own process, asked once more in a new one when the
 *  first stopped before it answered: { preprocessed, assembly }, or { error, stage }. */
async function compileApart(request, log) {
  let stopped;
  for (let attempt = 0; attempt < 2; attempt++) {
    const id = ++asked, running = compilerProcess();
    // held while it's asked, so match waits for its answer, or for its end when it stops first
    const answer = await new Promise(resolve => {
      waiting.set(id, { resolve, log });
      running.ref();
      running.channel?.ref();
      running.send({ id, ...request });
    });
    if (!waiting.size) {
      running.unref();
      running.channel?.unref();
    }
    if (!answer.stopped) return answer.error ? answer : { preprocessed: Buffer.from(answer.preprocessed, 'base64'), assembly: answer.assembly };
    stopped = answer.stopped;
  }
  return { error: `The compiler's process stopped twice (${stopped}) before it built the file.`, stage: 'process' };
}

/** Stops the compiler's process, if one is running. */
export function stopCompiler() {
  child?.kill();
  child = null;
}

/** The compiler's process's number, or null when none is running. */
export const compilerPid = () => child?.pid ?? null;

/**
 * Builds `file` as match does, in `work` (<work>.i, GCC's <work>.s and maspsx's <work>.aspsx.s), and assembles it:
 * { made, assembly }, `made` as the tools' assembler gives it, or { error }, what went wrong.
 */
export async function compileFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, log = () => {} }) {
  mkdirSync(dirname(work), { recursive: true });
  const built = await compileApart({ file, root, includes, version: compiler.version, flags: compiler.flags }, log);
  if (built.error) return { error: built.stage === 'gcc' ? built.error.replaceAll('the C:', `${basename(file)}:`) : built.error };
  writeFileSync(`${work}.i`, built.preprocessed);
  writeFileSync(`${work}.s`, built.assembly);
  try {
    const { assembly } = maspsx(built.assembly, { ...compiler.maspsx, sdataLimit: smallDataOf(compiler.flags) });
    writeFileSync(`${work}.aspsx.s`, assembly);
    return { made: assemble(assembly), assembly };
  } catch (error) {
    return { error: error.message };
  }
}

// a relocation's place filled in with `target`: false when it can't hold it
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
    if (((place + 4) & 0xF0000000) !== (target & 0xF0000000)) return false;
    made = (word & 0xFC000000) | ((target >>> 2) & 0x3FFFFFF);
  } else made = target;
  buffer.writeUInt32LE(made >>> 0, at);
  return true;
}

/**
 * Builds `file` and compares each function it defines with the original's.
 *   root, includes: the folder the file's C is in, and the folders it includes from
 *   compiler: as readCompiler gives it, or one of its stretches
 *   work: the folder for what's built
 *   addressOf(name): the address in the original of a name the version gives one, or null
 *   sizeOf(address): how long the code map says the function there is, or null when none starts there
 *   runOf(address, through): for a twin of a run, the code map's functions it's the twin of, as runIn gives them
 *   program: the program the disc boots, { load, text }, as exeOf gives it, and `gp`, where it points $gp
 *   shifts, given: as twinsIn takes them
 * Answers { functions: [{ name, address, line, same, bytes, words, differing, first, longer, missing, data, ours,
 * theirs, made, calls }], unknown }, where `missing` is the names in a function with no address, `data` each of the
 * file's own values it reaches, { name, address, bytes, same, why }, and `unknown` every name with none; or { error }
 * when the file didn't build.
 */
export async function matchFile({ file, root = dirname(file), includes = [dirname(file)], compiler, work, addressOf, sizeOf, runOf = () => null, program, gp = 0, shifts = [], given = null, log = () => {} }) {
  const built = await compileFile({ file, root, includes, compiler, work, log });
  if (built.error) return built;
  const { made } = built;
  const code = Buffer.from(made.sections.get('.text')?.bytes ?? []);
  const textRelocations = [...(made.sections.get('.text')?.relocations ?? [])].sort((a, b) => a.at - b.at);
  const twins = new Map(twinsIn(readFileSync(file, 'utf8'), shifts, given, 'ps1').map(twin => [twin.name, twin]));
  const inProgram = (address, bytes) => address >= program.load && address + bytes <= program.load + program.text.length;
  const wordAt = address => program.text.readUInt32LE(address - program.load);

  // the functions the file defines, in the order they sit in its code
  const functions = made.functions.filter(f => f.section === '.text').sort((a, b) => a.at - b.at).map(f => ({
    name: f.name, at: f.at, length: f.size, address: twins.get(f.name)?.address ?? null, through: twins.get(f.name)?.through ?? null,
    line: twins.get(f.name)?.line ?? null, missing: new Set(), calls: [], reaches: new Set(),
  }));
  const owner = at => functions.find(f => at >= f.at && at < f.at + f.length);

  // the file's own values, each name outside the code with where it is in its section and how long
  const data = new Map([...made.symbols].filter(([, symbol]) => symbol.section !== '.text'));
  const containing = (section, at) => {
    let found = null;
    for (const [name, symbol] of data) if (symbol.section === section && symbol.at <= at && (!found || symbol.at >= data.get(found).at)) found = name;
    return found;
  };
  // each value's address: the one the version gives, or else where the original's instructions point
  const placed = new Map(), proposed = new Map();
  for (const name of data.keys()) {
    const address = addressOf(name);
    if (address !== null) placed.set(name, address >>> 0);
  }
  const propose = (name, address) => {
    if (placed.has(name)) return;
    if (!proposed.has(name)) proposed.set(name, new Set());
    proposed.get(name).add(address >>> 0);
  };
  const dataAt = name => placed.get(name) ?? (proposed.get(name)?.size === 1 ? [...proposed.get(name)][0] : null);
  for (const f of functions) {
    if (f.address === null || !inProgram(f.address, f.length)) continue;
    const halves = new Map();
    for (const r of textRelocations) {
      if (r.at < f.at || r.at >= f.at + f.length || !data.has(r.symbol)) continue;
      const theirs = wordAt(f.address + r.at - f.at), low = ((theirs & 0xFFFF) ^ 0x8000) - 0x8000, key = `${r.symbol}+${r.addend}`;
      if (r.kind === 'hi16') halves.set(key, (theirs & 0xFFFF) << 16);
      else if (r.kind === 'lo16' && halves.has(key)) propose(r.symbol, halves.get(key) + low - r.addend);
      else if (r.kind === 'gprel16' && gp) propose(r.symbol, gp + low - r.addend);
    }
  }
  // and the values a table of the file's points to, where the original's table points, until no more are found
  for (let more = true; more;) {
    more = false;
    for (const [section, { relocations }] of made.sections) {
      if (section === '.text') continue;
      for (const r of relocations) {
        if (r.kind !== 'word32' || !data.has(r.symbol) || dataAt(r.symbol) !== null || proposed.has(r.symbol)) continue;
        const table = containing(section, r.at), at = table === null ? null : dataAt(table);
        if (at === null || !inProgram(at + r.at - data.get(table).at, 4)) continue;
        propose(r.symbol, wordAt(at + r.at - data.get(table).at) - r.addend);
        more = true;
      }
    }
  }

  // where a name the file uses is: a place in its own code, one of its own values, or a name the version gives
  const targetOf = (name, addend) => {
    const symbol = made.symbols.get(name);
    if (symbol?.section === '.text') {
      const of = owner(symbol.at);
      return of && of.address !== null ? of.address + symbol.at - of.at + addend : null;
    }
    if (symbol) {
      const at = dataAt(name);
      return at === null ? null : at + addend;
    }
    const address = addressOf(name);
    return address === null ? null : address + addend;
  };

  // the file's values with every address filled in, and what each one's table reaches
  const values = new Map([...made.sections].filter(([section]) => section !== '.text').map(([section, { bytes }]) => [section, Buffer.from(bytes)]));
  const valueMissing = new Map(), valueReaches = new Map();
  for (const [section, { relocations }] of made.sections) {
    if (section === '.text') continue;
    for (const r of relocations) {
      const holder = containing(section, r.at);
      if (holder === null) continue;
      if (data.has(r.symbol)) valueReaches.set(holder, new Set([...(valueReaches.get(holder) ?? []), r.symbol]));
      const at = dataAt(holder), target = targetOf(r.symbol, r.addend);
      if (target === null || at === null || !fill(values.get(section), r.at, r.kind, target, { place: at + r.at - data.get(holder).at, gp })) {
        valueMissing.set(holder, new Set([...(valueMissing.get(holder) ?? []), r.symbol]));
      }
    }
  }

  // each place in the code a linker would fill in
  const unknown = new Set();
  for (const r of textRelocations) {
    const f = owner(r.at);
    if (!f || f.address === null) continue;
    if (data.has(r.symbol)) f.reaches.add(r.symbol);
    const target = targetOf(r.symbol, r.addend);
    if (target === null || !fill(code, r.at, r.kind, target, { place: f.address + r.at - f.at, gp })) {
      // a name of the file's own values that isn't placed is said where its function is: unknown is the version's names
      if (!data.has(r.symbol)) unknown.add(r.symbol);
      f.missing.add(r.symbol);
    } else if (r.kind === 'jump26') f.calls.push(target);
  }

  // a value compared with the original's: its bytes as built, with every address filled in, beside what's at its address
  const compared = new Map();
  const compareValue = name => {
    if (compared.has(name)) return compared.get(name);
    const symbol = data.get(name), address = dataAt(name);
    const result = { name, address, bytes: symbol.size, same: false, why: '' };
    compared.set(name, result);
    const ours = values.get(symbol.section).subarray(symbol.at, symbol.at + symbol.size);
    if (address === null) result.why = proposed.get(name)?.size > 1 ? 'the original\'s instructions point to it at more than one address' : 'the original\'s instructions don\'t point to it';
    else if (valueMissing.has(name)) result.why = `no address for ${[...valueMissing.get(name)].join(', ')}`;
    else if (inProgram(address, symbol.size)) {
      const theirs = program.text.subarray(address - program.load, address - program.load + symbol.size);
      result.same = Buffer.compare(ours, theirs) === 0;
      if (!result.same) result.why = `differs from the original's at 0x${hex(address)}`;
    } else if (ZEROED.has(symbol.section) && address >= program.load + program.text.length) result.same = true;
    else result.why = `0x${hex(address)} isn't in the program's file`;
    return result;
  };
  const reached = f => {
    const all = new Set(), queue = [...f.reaches];
    while (queue.length) {
      const name = queue.shift();
      if (all.has(name)) continue;
      all.add(name);
      queue.push(...(valueReaches.get(name) ?? []));
    }
    return [...all].map(compareValue);
  };

  for (const f of functions) {
    f.made = Buffer.from(code.subarray(f.at, f.at + f.length));
    f.data = f.address === null ? [] : reached(f);
    f.missing = [...f.missing];
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
      const mine = i * 4 < f.length ? code.readUInt32LE(f.at + i * 4) : null;
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

// what match needs to know of the PlayStation: how its games say they were built, how a file is built and compared,
// where the program a disc boots is and where it points $gp, and how its code names an address
const PLAYSTATION = {
  console: 'ps1', place: 'the PlayStation', compiler: 'GCC', label: LABEL, labelExample: 'D_800D8408', readCompiler, wayAt, wayText, matchFile,
  programOf: async (path, sha1) => {
    const exe = await ps1Program(path, sha1);
    return { program: exeOf(exe), gp: gpOf(exe) };
  },
  resolve: (game, codeMap, what) => ps1Resolve(game, codeMap, what).address,
};

/** match on a PlayStation game: as ../match.mjs does on the Game Boy Advance, with `log` for what it says. */
export const matchGame = options => matchGameOn(PLAYSTATION, options);

/**
 * match on a game of a console whose programs come off a disc, as the PlayStation and the PlayStation 2
 * (../ps2/match.mjs): `on` is what match needs to know of the console, as PLAYSTATION above has it.
 */
export async function matchGameOn(on, { game, what = null, more = null, whole = false, original, log = console.log }) {
  if (whole) throw new Error(`--whole rebuilds a Game Boy Advance cartridge: on ${on.place}, match compares a function at a time for now.`);
  const { game: base, language } = versionOf(game);
  if (writtenIn(language) !== 'c') throw new Error(`match builds C: name a game's version in C, such as ${base}/c.`);
  const compiler = on.readCompiler(original, `games/${base}/proof/original.json`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`match compares with ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  if ((await readAnyCopy(copy.path, original.console))?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const { program, gp } = await on.programOf(copy.path, original.sha1);

  const sizes = new Map(codeMap.functions.filter(inBootProgram).map(f => [f.address, f.size]));
  const { folder, shifts, files, twinsOf, twins, named, libraries, givenOf } = versionTwins(game, more ? resolvePath(more) : null);
  // the shared library each of the version's files from the kit is of (../lib/libraries.mjs)
  const libraryOf = new Map(libraries.flatMap(library => library.files.map(file => [file, library.library])));
  // a name the version gives an address: its own, a twin's in another file, or a label's
  const addressOf = name => named.get(name) ?? (twins.get(name)?.size === 1 ? [...twins.get(name)][0] : null) ?? (on.label.test(name) ? addressIn(name, shifts, on.console) : null);

  let chosen = files, only = null;
  if (what) {
    const file = [resolvePath(what), join(folder, what)].find(path => path.endsWith('.c') && existsSync(path));
    if (file) chosen = [file];
    else {
      const address = twins.get(what)?.size === 1 ? [...twins.get(what)][0] : on.resolve(game, codeMap, what);
      chosen = files.filter(path => twinsOf.get(path).some(twin => twin.address === address));
      if (!chosen.length) throw new Error(`No function in games/${game}/ says it's the twin of ${what}: the comment above it names the address, as in /** 0x${hex(address)}: what it does */.`);
      only = address;
    }
  }
  if (!chosen.length) {
    log(`games/${game}/ has no C yet.`);
    return 0;
  }

  let same = 0, all = 0, sameBytes = 0, bytes = 0, kept = null;
  const failed = [], unknown = new Set(), proven = [], differing = [];
  for (const file of chosen) {
    const library = libraryOf.get(file) ?? null;
    const inside = library !== null || (!relative(folder, file).startsWith('..') && !isAbsolute(relative(folder, file)));
    const where = inside ? inRepo(file) : file;
    // a shared library's file is built as its library.json says it was, whichever game it's in, from its folder alone
    let built = null;
    if (library) {
      const given = library.compilers[on.console];
      if (!given) {
        log(`${where}\n  Not compared: ${library.id}'s library.json names no compiler for ${on.place}, which match needs to build it.`);
        continue;
      }
      built = on.wayAt(on.readCompiler({ compiler: given }, inRepo(join(library.folder, 'library.json'))), -1);
    }
    // a file is built the way the original's code its twins are of was built: the game's, or a stretch's
    const ways = new Map(library ? [] : twinsOf.get(file).filter(twin => twin.address !== null).map(twin => on.wayAt(compiler, twin.address)).map(way => [on.wayText(way), way]));
    if (ways.size > 1) {
      log(`${where}\n  Not compared: its twins are of code the original built two ways, ${[...ways.keys()].join(' and ')}, as original.json's compiler says, and a file is built one way. Put each way's twins in a file of its own.`);
      failed.push(`${where}: its twins are of code built two ways`);
      continue;
    }
    const result = await on.matchFile({
      file, compiler: built ?? (ways.size === 1 ? [...ways.values()][0] : on.wayAt(compiler, -1)), shifts, addressOf, program, gp, given: givenOf(file),
      root: library ? library.folder : inside ? folder : dirname(file),
      includes: library ? [library.folder] : [dirname(file), ...(inside && existsSync(join(folder, 'src')) ? [join(folder, 'src')] : [])],
      work: join(LOCAL, 'match', game, library ? join('lib', ...library.id.split('/'), basename(file, '.c')) : inside ? relative(folder, file).replace(/\.c$/, '') : join('elsewhere', basename(file, '.c'))),
      sizeOf: address => sizes.get(address) ?? null,
      runOf: (address, through) => runIn(codeMap.functions.filter(inBootProgram), address, through),
      log,
    });
    if (result.error) {
      const said = result.error.split('\n');
      if (chosen.length === 1) log(`${where}\n  Didn't build with ${on.compiler}: ${said.join('\n  ')}`);
      failed.push(`${where}: ${said.find(line => /error/.test(line)) ?? said[0]}`);
      continue;
    }
    const shown = result.functions.filter(f => only === null || f.address === only);
    if (!shown.length) continue;
    log(where);
    for (const f of shown) {
      const at = f.address === null ? null : `0x${hex(f.address)}`;
      if (at === null) {
        if (library) log(`  No address  ${f.name}${f.line ? `, line ${f.line}` : ''}: games/${game}/proof/libraries.json gives ${library.id} none for it`);
        else log(`  No address  ${f.name}${f.line ? `, line ${f.line}` : ''}: the comment above it names the function of the original it's the twin of`);
        continue;
      }
      if (f.elsewhere) {
        log(`  Not compared  ${at} ${f.name}: match compares the program the disc boots, and this is code the game loads as it runs`);
        continue;
      }
      if (f.through !== null && !f.run) {
        log(`  Not compared  ${at} ${f.name}: its comment names a run to 0x${hex(f.through)}, and the code map's functions from ${at} to 0x${hex(f.through)} aren't one run, each starting where the one before ends`);
        continue;
      }
      all++;
      bytes += f.bytes;
      const unmapped = f.mapped ? '' : ', where the code map has no function starting';
      if (inside && f.mapped) for (const address of f.run ? f.run.map(each => each.address) : [f.address]) (f.same ? proven : differing).push({ key: hex(address) });
      const run = f.run ? `, the ${count(f.run.length)} functions to 0x${hex(f.through)} together` : '';
      const values = f.data.length ? `, with its ${count(f.data.length)} value${f.data.length === 1 ? '' : 's'} of the file's own` : '';
      if (f.same) {
        same++;
        sameBytes += f.bytes;
        log(`  The same  ${at} ${f.name}, ${count(f.bytes)} bytes${run}${values}${unmapped}`);
      } else {
        const length = f.longer > 0 ? `${f.longer} bytes longer` : f.longer < 0 ? `${-f.longer} bytes shorter` : 'the same length';
        const first = f.first < 0 ? '' : `, first at 0x${hex(f.address + f.first)}`;
        const missing = f.missing.filter(name => result.unknown.includes(name));
        const named = missing.length ? `, with no address for ${missing.join(', ')}` : '';
        const wrong = f.data.filter(value => !value.same).map(value => `${value.name} ${value.why}`);
        log(`  Differs   ${at} ${f.name}${run}: ${count(f.differing)} of ${count(f.words)} words, ${length}${first}${named}${wrong.length ? `; its value ${wrong.join('; ')}` : ''}${unmapped}`);
      }
      for (const name of f.missing.filter(name => result.unknown.includes(name))) unknown.add(name);
      if (only !== null) kept = listing(game, f, original.name);
    }
  }
  if (unknown.size) log(`No address for ${[...unknown].join(', ')}: give each in games/${base}/proof/addresses.json, or name it by its label, as ${on.labelExample} (tools/README.md, Matching the original's bytes).`);
  if (failed.length && chosen.length > 1) {
    log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build with the original's compiler, which builds only C written for it. The first is ${failed[0]}. Name a file to see all the compiler said of it.`);
  }
  log(`${count(same)} of ${count(all)} function${all === 1 ? '' : 's'} the same, ${count(sameBytes)} of ${count(bytes)} bytes.`);
  if (!asksForProofs(game)) {
    // a version made a part at a time keeps no proofs, and nothing is said of them
  } else if (more) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else for (const line of keptText(game, keepProofs(game, { kind: 'bytes', proven, failed: differing.map(f => f.key) }), 'bytes')) log(line);
  if (kept) log(`Each of the original's instructions is beside the twin's in ${kept}. It comes from your copy of the game: never put it in a commit, an issue or a pull request. A coding agent that reads it sends it to the company that runs the agent's model.`);
  return 0;
}

// one function, the original's instructions beside the twin's, kept where commits never reach
function listing(game, f, name) {
  const cell = value => (value === null ? '        ' : hex(value));
  const rows = f.ours.map((ours, i) => {
    const theirs = f.theirs[i];
    return `${ours.value === theirs.value ? ' ' : '!'} ${hex(f.address + i * 4)}  ${cell(theirs.value)} ${cell(ours.value)}  ${theirs.text.padEnd(34)} | ${ours.text}`;
  });
  const values = f.data.map(value => `  ${value.name}${value.address === null ? '' : ` at 0x${hex(value.address)}`}, ${count(value.bytes)} bytes: ${value.same ? 'the same' : value.why}`);
  const text = [
    `${f.name}, the twin of 0x${hex(f.address)} in ${name}: ${f.same ? 'the same bytes' : `${f.differing} of ${f.words} words differ`}.`,
    'Each line is an address, the original\'s word there and the twin\'s, and each as the tools\' decoder reads it. A line that differs starts with !.',
    '', ...rows, '', ...(values.length ? ['The file\'s own values it reaches:', ...values, ''] : []),
  ].join('\n');
  const file = join(LOCAL, 'match', game, `${hex(f.address)}.txt`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return inRepo(file);
}
