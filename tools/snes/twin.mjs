// The function check for a Super Nintendo game (../twin.mjs): one function of the original, run in Snes9x's own 65816
// (call.cpp, original.mjs), and its twin, built as a Dreamport to WebAssembly, are called from the same memory,
// thousands of times, with the same registers, and what each leaves in the console's work memory, its save memory and
// its hardware's registers, each read and write of those registers in order, the registers its contract marks, and
// what its contract says it gives back, are compared. Most Super Nintendo games were written in the processor's own
// language, so no compiler gives their bytes back, and this is the proof a twin has (docs/CONSOLES.md).
//
// A twin is named, with what it's given and what it gives back, by its contract, a line beside it (contracts.mjs), as
// the 65816's functions take their values in registers and flags C can't name. The twins are built as the other
// consoles' are (../gba/twin.mjs, openBuild), on the console's kit in C (kit/snes/c/), which notes each read and write
// of the hardware for the check, and then every address the module reads or writes is folded by its 4 KB through a
// table (../lib/wasm-fold.mjs), as the console's wiring folds them: the work memory's mirror in the low banks onto
// $7E0000, the banks that show the same ROM onto the first that shows it, the hardware's registers onto bank $00. So a
// twin's C says $7E0010, or $000010, or makes $7F1234 from the data bank and a word it read, as the console does, and it
// all lands in one place, with the module's own values above the console's 16 MB.
//
// A call starts from the cartridge's ROM and an image of zeros, its registers drawn: A, X and Y any 16 bits, their top
// bytes 0 when the mode makes them 8 bits, as the console does; the direct page and the data bank from the values games
// give them and any; the flags any, but for the decimal flag, clear unless the contract names it; and the stack at
// $1FFF, with the address the call comes back to pushed on it, as JSR, JSL or an interrupt pushes it, whichever the
// function comes back with. A contract's `if` is asked first, and a call it refuses is drawn again. The original's own
// pushes below its stack aren't compared, as a twin keeps its own stack. As the PlayStation's check does, the check
// learns as it goes: the original says what each call read, and later calls change a few of those values, mostly to
// numbers at the edges of what a value holds. The same memory is a proof of the paths the calls took, and of no other,
// so the original also says which of its instructions ran and which way each branch went, and a function counts as
// proven only when every instruction ran and each branch went both ways.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gameFolder, REPO } from '../lib/paths.mjs';
import { readCodeMap, readOriginal } from '../lib/proof-files.mjs';
import { copyWith } from '../lib/copies.mjs';
import { readAnyCopy } from '../lib/read-copy.mjs';
import { twinsFolder } from '../lib/c.mjs';
import { versionTwins } from '../lib/twins.mjs';
import { asksForProofs, keepProofs, keptText } from '../lib/proofs.mjs';
import { readUnreachable, waysLeft } from '../lib/played.mjs';
import { foldAddresses } from '../lib/wasm-fold.mjs';
import { versionOf, writtenIn } from '../../src/lib/languages.mjs';
import { KEPT_FROM, openBuild } from '../gba/twin.mjs';
import { modeOf, narrowXY } from './65816.mjs';
import { BLOCKS, HARDWARE, mapOf, NOTHING, placeIn, readCartridge, ROM, SAVE, WORK, WRAM } from './cartridge.mjs';
import { contractsIn, NAMES } from './contracts.mjs';
import { addressOf, follow, instructionsIn } from './functions.mjs';
import { buildCaller, CAME_BACK, CPU_AT, ELSEWHERE, endText, hex, imageAfter, imageSize, inImage, named, NOWHERE, Original, OUT_OF_STEPS, PPU_AT, RAN, RTI, RTL, RTS, SRAM_AT, STOPPED, WAITS } from './original.mjs';

const WORKER = fileURLToPath(new URL('./twin-worker.mjs', import.meta.url));
// what openBuild names the function a call through a pointer meets when nothing built is the twin of its address
const NO_CODE = '__twin_no_code';
// the module: its own values from 16 MB, past every address of the console, its memory 32 MB, and a function's
// address below $8000 the module's own, as the console's code is in its ROM, above, or its work memory
const LAYOUT = { base: 0x01000000, memory: 0x02000000, code: address => address, own: 0x8000 };
// where the fold's table goes, a pair of words for each 4 KB of the module's 32 MB, and where an address the console
// has nothing at lands, out of the twin's way
const TABLE = 0x01FC0000, ENTRIES = 0x2000, NOWHERE_AT = 0x01FB0000;

/** What the check does unless it's told otherwise. */
export const DEFAULTS = {
  calls: 2000,       // how many calls of each function are compared
  seed: 1,           // what the made-up registers and values come from, so a run can be had again
  seconds: 2,        // how long a twin may take over one call
  limit: 1000000,    // how many instructions the original may run in one call
};
// how many calls may be made for each one that has to be compared, and how many draws a contract's `if` may refuse
const TRIES = 4, REFUSED = 64;
// where a call's stack starts, and how far below it the original's own pushes may go
const STACK = 0x1FFF, PUSHES = 0x200;
// the direct pages and data banks games give their functions most
const PAGES = [0x0000, 0x0000, 0x0100, 0x0200, 0x1E00, 0x4300], BANKS = [0x00, 0x7E, 0x7F, 0x80];
// the numbers that sit at the edges of what a value can hold
const EDGES = [0, 1, 2, 3, 4, 7, 8, 0xF, 0x10, 0x7F, 0x80, 0xFF, 0x100, 0x7FFF, 0x8000, 0xFFFF];

const count = n => n.toLocaleString('en-US');
const inRepo = path => relative(REPO, path).split(sep).join('/');

/** What makes up registers and values, the same from the same seed. */
export function chooser(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const below = n => next() % n;
  // a number at an edge, a small one, or any, of 16 bits
  const number = () => [() => EDGES[below(EDGES.length)], () => below(256), () => next() & 0xFFFF][below(3)]();
  return { next, below, number, sized: bytes => (bytes === 1 ? number() & 0xFF : number()) };
}

/**
 * The fold's table for a cartridge's map: for each 4 KB of the module's memory a mask and where it lands, the console's
 * memories each where one of its addresses is, as the top of this file says, and the module's own past them where they
 * are. Answers { table, regions, rom }: `regions` each memory of the image, { at, address, bytes }, where the module has
 * it, and `rom` each 4 KB of the ROM, { address, bytes }, where the module has it, to lay there once.
 */
export function foldOf(cart, map) {
  const table = new Uint32Array(ENTRIES * 2), firstSave = new Map(), rom = [];
  for (let block = 0; block < ENTRIES; block++) {
    let mask = 0xFFF, start = block << 12;
    if (block < BLOCKS) {
      const { what, at } = placeIn(map, block << 12);
      if (what === WORK) start = 0x7E0000 + at;
      else if (what === HARDWARE) start = (block << 12) & 0xFFFF;
      else if (what === ROM && at < cart.rom.length) start = addressOf(at, cart);
      else if (what === SAVE) {
        if (!firstSave.has(at)) firstSave.set(at, block << 12);
        start = firstSave.get(at);
        mask = Math.min(0xFFF, cart.sram - 1);
      } else start = NOWHERE_AT;
    }
    table[block * 2] = mask;
    table[block * 2 + 1] = start >>> 0;
  }
  // the ROM, 4 KB at a time, where the fold sends it
  const placed = new Set();
  for (let at = 0; at < cart.rom.length; at += 0x1000) {
    const address = addressOf(at, cart);
    if (placed.has(address)) continue;
    placed.add(address);
    rom.push({ address, bytes: cart.rom.subarray(at, Math.min(at + 0x1000, cart.rom.length)) });
  }
  const regions = [
    { at: 0, address: 0x7E0000, bytes: WRAM, name: 'the work memory' },
    { at: PPU_AT, address: 0x2100, bytes: 0x100, name: 'the registers at $2100' },
    { at: CPU_AT, address: 0x4000, bytes: 0x400, name: 'the registers at $4000' },
  ];
  for (const [at, address] of firstSave) regions.push({ at: SRAM_AT + at, address, bytes: Math.min(0x1000, cart.sram), name: 'the save memory' });
  return { table, regions, rom };
}

// The thread that runs the twins of one module, started again when a twin doesn't come back in time.
class Runner {
  constructor(module, seconds, fold) {
    this.module = module;
    this.seconds = seconds;
    this.fold = fold;
    this.image = null;
  }

  async start() {
    this.worker = new Worker(WORKER, { workerData: { module: this.module, noCode: NO_CODE, table: this.fold.table, tableAt: TABLE, regions: this.fold.regions, rom: this.fold.rom } });
    this.waiting = null;
    this.worker.on('message', message => this.waiting?.(message));
    this.worker.on('error', error => this.waiting?.({ stopped: String(error.message ?? error) }));
    await this.next();
    if (this.image) await this.ask({ set: this.image });
  }

  next() {
    return new Promise(resolve => { this.waiting = resolve; });
  }

  ask(message) {
    const answer = this.next();
    this.worker.postMessage(message);
    return answer;
  }

  async set(image) {
    this.image = image;
    if (!this.worker) await this.start();
    else await this.ask({ set: image });
  }

  /** What a twin's call answers, as twin-worker.mjs says it, or { never: true } when it was still going after its seconds. */
  async call(message) {
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve({ never: true }), this.seconds * 1000); });
    const answer = await Promise.race([this.ask(message), late]);
    clearTimeout(timer);
    if (answer.never) {
      await this.worker.terminate();
      await this.start();
    }
    return answer;
  }

  close() {
    return this.worker?.terminate();
  }
}

/** The registers as the contract's C names them, from the original's: A and the rest, and each flag of P. */
const flagsOf = ({ a, x, y, s, d, db, p }) => ({ A: a & 0xFFFF, X: x & 0xFFFF, Y: y & 0xFFFF, S: s & 0xFFFF, D: d & 0xFFFF, DB: db & 0xFF, N: p >> 7 & 1, V: p >> 6 & 1, Z: p >> 1 & 1, C: p & 1, I: p >> 2 & 1, BCD: p >> 3 & 1 });

/** How a function comes back, by the return its code reaches first: RTL, RTI, or RTS. */
function wayOf(code) {
  const ops = [...code.values()].map(i => i.op);
  return ops.includes(0x6B) ? RTL : ops.includes(0x40) ? RTI : RTS;
}

/**
 * Calls one function of the original and its twin until `options.calls` calls were compared. `f` is { label, address,
 * offset, size, mode, leaves, way, call, contract }. Answers { compared, aside, ran, result }, `result` null while every
 * call compared was the same, or what wasn't.
 */
async function checkFunction({ f, map, original, runner, options, choose }) {
  const pool = new Map(), ran = new Map(), aside = {};
  const narrow = narrowXY(f.mode), emulation = f.mode === 'e';
  const p8 = (f.mode === 'e' || f.mode.startsWith('a8') ? 0x20 : 0) | (narrow ? 0x10 : 0);
  const bcd = /\bBCD\b/.test(`${f.contract.call} ${f.contract.given ?? ''}`);
  const back = f.way === RTS ? f.address & 0xFF0000 : 0x7E0000;
  let compared = 0, number = 0;
  while (compared < options.calls && number < options.calls * TRIES) {
    number++;
    let registers = null, changes = [];
    for (let draw = 0; draw < REFUSED && !registers; draw++) {
      const flags = choose.next();
      const drawn = {
        A: choose.number(), X: choose.number(), Y: choose.number(), S: emulation ? 0x1FF : STACK,
        D: choose.below(4) ? PAGES[choose.below(PAGES.length)] : choose.number(), DB: choose.below(4) ? (choose.below(5) ? BANKS[choose.below(BANKS.length)] : f.address >> 16) : choose.next() & 0xFF,
        N: flags & 1, V: flags >> 1 & 1, Z: flags >> 2 & 1, C: flags >> 3 & 1, I: flags >> 4 & 1, BCD: bcd ? flags >> 5 & 1 : 0,
      };
      if (narrow) drawn.X &= 0xFF, drawn.Y &= 0xFF;
      const made = [];
      if (pool.size && choose.below(2)) {
        const places = [...pool];
        for (let k = 1 + choose.below(3); k; k--) {
          const [address, bytes] = places[choose.below(places.length)];
          const value = choose.sized(bytes);
          for (let i = 0; i < bytes; i++) made.push([address + i, 1, (value >> (8 * i)) & 0xFF]);
        }
      }
      const placed = made.map(([address, , value]) => [inImage(map, address), value]).filter(([at]) => at >= 0);
      const asked = await runner.call({ given: f.call, registers: drawn, changes: placed });
      if (asked.never || asked.stopped) return { compared, aside, ran, result: asked.never ? { kind: 'never', number, registers: drawn, changes: made } : { kind: 'stopped', why: asked.stopped, number, registers: drawn, changes: made } };
      if (asked.given) [registers, changes] = [drawn, made];
    }
    if (!registers) {
      aside.refused = (aside.refused ?? 0) + 1;
      continue;
    }
    // the original's own pushes below its stack, in the work memory, which a twin keeps in its own
    const skip = [[Math.max(0, registers.S - PUSHES + 1), registers.S + 1]];
    const p = p8 | registers.N << 7 | registers.V << 6 | registers.Z << 1 | registers.C | registers.I << 2 | registers.BCD << 3;
    const answer = await original.call({ address: f.address, span: f.size, limit: options.limit, way: f.way, back, registers: { a: registers.A, x: registers.X, y: registers.Y, s: registers.S, d: registers.D, db: registers.DB, p, e: emulation ? 1 : 0 }, changes });
    for (const { address } of answer.reads) {
      // a byte of the cartridge's ROM isn't in the image, and the stack's is the call's own
      const at = inImage(map, address);
      if (at < 0 || (at >= skip[0][0] && at < skip[0][1])) continue;
      pool.set(address, 1);
    }
    const reason = answer.end === CAME_BACK ? null : { [OUT_OF_STEPS]: 'steps', [WAITS]: 'waits', [STOPPED]: 'stopped', [ELSEWHERE]: 'elsewhere', [NOWHERE]: 'nowhere' }[answer.end] ?? 'other';
    if (reason) {
      aside[reason] = (aside[reason] ?? 0) + 1;
      aside[`${reason}Text`] ??= endText(answer);
      continue;
    }
    const call = { number, registers, changes };
    const left = modeOf(answer.registers.p, answer.registers.e);
    if (left !== (f.leaves ?? f.mode)) return { compared, aside, ran, result: { kind: 'mode', left, ...call } };
    const theirs = flagsOf(answer.registers);
    const placed = changes.map(([address, , value]) => [inImage(map, address), value]).filter(([at]) => at >= 0);
    const twin = await runner.call({ call: f.call, registers, changes: placed, chunks: answer.chunks, skip, theirs, hardware: answer.hardware, changed: f.contract.changed });
    if (twin.never) return { compared, aside, ran, result: { kind: 'never', ...call } };
    if (twin.stopped === 'unbuilt') {
      aside.unbuilt = (aside.unbuilt ?? 0) + 1;
      aside.unbuiltText ??= twin.unbuilt;
      continue;
    }
    if (twin.stopped) return { compared, aside, ran, result: { kind: 'stopped', why: twin.stopped, ...call } };
    if (f.contract.back && twin.gave !== twin.back) return { compared, aside, ran, result: { kind: 'differs', gave: { ours: twin.gave, theirs: twin.back }, ...call } };
    if (twin.register) return { compared, aside, ran, result: { kind: 'differs', register: twin.register, ...call } };
    if (twin.hardware) return { compared, aside, ran, result: { kind: 'differs', hardware: twin.hardware, ...call } };
    if (twin.differs) return { compared, aside, ran, result: { kind: 'differs', memory: twin.differs, ...call } };
    compared++;
    answer.ran.forEach((ways, i) => { if (ways & 7) ran.set(f.offset + i, (ran.get(f.offset + i) ?? 0) | (ways & 7)); });
  }
  return { compared, aside, ran, result: null };
}

const byte = value => `$${hex(value, 2)}`;
const word = value => `$${hex(value, 4)}`;
const registerText = registers => `A=${word(registers.A)} X=${word(registers.X)} Y=${word(registers.Y)} D=${word(registers.D)} DB=${byte(registers.DB)}`;
// a place in the image, as the console's code names it
const placeText = at => (at < PPU_AT ? named(0x7E0000 + at) : at < CPU_AT ? `$${hex(0x2100 + at - PPU_AT, 4)}` : at < SRAM_AT ? `$${hex(0x4000 + at - CPU_AT, 4)}` : `byte ${at - SRAM_AT} of the save memory`);
const accessText = access => (access ? `${access.write ? 'wrote' : 'read'} ${byte(access.value)} ${access.write ? 'to' : 'from'} $${hex(access.register, 4)}` : 'nothing');

/** A call as a line says it: its number, the registers it was given, and what was changed for it. */
export function callText(label, { number, registers, changes }) {
  const set = changes.length ? `, after ${changes.map(([address, , value]) => `${named(address)} was set to ${byte(value)}`).join(' and ')}` : '';
  return `call ${count(number)}, ${label} with ${registerText(registers)}${set}`;
}

/** What a function's check came to, as { kind, line }: `kind` is 'same', 'differs', 'never', 'stopped', 'few' or
 *  'unchecked', and `line` what to say after its address and name. */
export function outcome(f, { compared, aside, result }, { calls, seconds }) {
  if (result?.kind === 'mode') return { kind: 'differs', line: `${callText(f.label, result)}: the original came back with ${result.left}, where its contract says ${f.leaves ?? f.mode}.` };
  if (result?.kind === 'differs') {
    const said = result.gave ? `the twin gave back ${word(result.gave.ours)}, where the contract makes ${word(result.gave.theirs)} of the original's registers`
      : result.register ? `the twin left ${result.register.name} ${word(result.register.ours)} and the original ${word(result.register.theirs)}`
        : result.hardware ? `at the hardware's read or write number ${count(result.hardware.at + 1)} the twin ${accessText(result.hardware.ours)} and the original ${accessText(result.hardware.theirs)}`
          : `at ${placeText(result.memory.at)} the twin left ${byte(result.memory.ours)} and the original ${byte(result.memory.theirs)}`;
    return { kind: 'differs', line: `${callText(f.label, result)}: ${said}.` };
  }
  if (result?.kind === 'never') return { kind: 'never', line: `${callText(f.label, result)}: the original came back and the twin was still going after ${seconds} second${seconds === 1 ? '' : 's'}.` };
  if (result?.kind === 'stopped') return { kind: 'stopped', line: `${callText(f.label, result)}: the twin stopped (${result.why}).` };
  if (compared >= calls) return { kind: 'same', line: `${count(compared)} calls` };
  const why = Object.entries({
    steps: `the original didn't come back within ${count(DEFAULTS.limit)} instructions`,
    waits: 'the original waited for an interrupt, which a call never has',
    stopped: 'the original stopped the processor',
    elsewhere: `the original ${aside.elsewhereText}`,
    nowhere: `the original ${aside.nowhereText}`,
    refused: `the contract's if refused ${REFUSED} draws in a row`,
    unbuilt: `the twin calls ${aside.unbuiltText}, which nothing built is the twin of`,
  }).filter(([key]) => aside[key]).sort(([a], [b]) => aside[b] - aside[a]).map(([key, text]) => `${text} (${count(aside[key])} calls)`).join(', and ');
  if (!compared) return { kind: 'unchecked', line: `no call could be compared: ${why}.` };
  return { kind: 'few', line: `only ${count(compared)} of ${count(calls)} calls could be compared, all the same: ${why}.` };
}

const LABELS = { same: 'The same memory', differs: 'Differs', never: 'Never came back', stopped: 'Stopped', few: 'Too few calls', unchecked: 'Not checked' };

/** The line of C that calls a contract from the check: one function that runs the twin's call, says what its `->`
 *  makes of the original's registers, or whether its `if` holds, by `what`, 0, 1 or 2, with the registers in a place
 *  of its own, whose address 3 gives (twin-worker.mjs). */
export function wrapOf({ call, contract, file }) {
  const at = `#line ${contract.line} ${JSON.stringify(file)}`;
  const declared = 'uint16_t A, X, Y, S, D; uint8_t DB; int N, V, Z, C, I, BCD;';
  const load = NAMES.map((name, i) => `${name} = dp_from[${i}];`).join(' ');
  const store = NAMES.map((name, i) => `dp[${12 + i}] = (uint32_t)${name};`).join(' ');
  return `${NAMES.map(name => `#undef ${name}`).join('\n')}
static uint32_t ${call}_place[37];
unsigned ${call}(unsigned what) {
  uint32_t *dp = ${call}_place;
  if (what == 3) return (unsigned)(uintptr_t)dp;
  const uint32_t *dp_from = dp + (what == 1 ? 24 : 0);
  ${declared}
  ${load}
  ${NAMES.map(name => `(void)${name};`).join(' ')}
  if (what == 2) {
${at}
    return !!(${contract.given ?? '1'});
  }
  if (what == 1) {
${at}
    return (unsigned)(long)(${contract.back ?? '0'});
  }
${at}
  ${contract.back ? `dp[36] = (uint32_t)(long)(${contract.call});` : `${contract.call};`}
  ${store}
  return 0;
}`;
}

/** The function check of a Super Nintendo game's version in C, as the tool runs it: 0, or 3 when a twin isn't the same. */
export async function twin(asked, options = {}, log = console.log) {
  const all = { ...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  const game = writtenIn(versionOf(asked).language) !== 'c' && existsSync(gameFolder(`${versionOf(asked).game}/c`)) ? `${versionOf(asked).game}/c` : asked;
  if (all.memories) throw new Error('--memories isn\'t there yet on the Super Nintendo: every call starts from an image of zeros and the cartridge\'s ROM.');
  if (all.frames !== undefined) throw new Error('--frames is for a Game Boy Advance game: on the Super Nintendo every call starts from an image of zeros.');
  const { game: base, language } = versionOf(game);
  const original = readOriginal(game);
  if (writtenIn(language) !== 'c') throw new Error(`twin builds C: name a game's version in C, such as ${base}/c.`);
  const codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${base}/proof/ has no code map yet: npm run dp -- codemap ${base} makes one.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`twin calls the functions of ${original.name}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const read = await readAnyCopy(copy.path, original.console);
  if (read?.sha1 !== original.sha1) throw new Error(`${copy.path} isn't ${original.name} any more: npm run dp -- rom checks it again.`);
  const { exit, functions } = await checkVersion({ game, codeMap, copyPath: copy.path, options: all, log });
  // a proof is found with the game's own names, and over enough calls to be worth the name, as on the other consoles
  if (!asksForProofs(game)) return exit;
  const proven = functions.filter(f => f.whole).map(f => ({ key: f.key, calls: f.compared }));
  const differing = functions.filter(f => ['differs', 'never', 'stopped'].includes(f.kind)).map(f => f.key);
  if (all.addresses) log('Nothing was kept as proven: --addresses is for trying a file out, and a proof is found with the game\'s own names.');
  else if (all.calls < KEPT_FROM) log(`Nothing was kept as proven: a proof by the same memory is over ${count(KEPT_FROM)} calls or more.`);
  else for (const line of keptText(game, keepProofs(game, { kind: 'memory', proven, failed: differing }), 'memory')) log(line);
  return exit;
}

/**
 * Checks a version's twins against the cartridge at `copyPath`: `codeMap` its functions, keyed by their places in the
 * ROM, with their modes. Answers { exit, functions }: `exit` 0, or 3 when a twin differed, stopped or never came back,
 * or a contract couldn't be read, and `functions` each { key, label, name, kind, line, compared, whole, left }, `key`
 * the function's in the code map.
 */
export async function checkVersion({ game, codeMap, copyPath, options: asked = {}, log = console.log }) {
  const options = { ...DEFAULTS, ...Object.fromEntries(Object.entries(asked).filter(([, value]) => value !== undefined)) };
  const results = [];
  const cart = readCartridge(readFileSync(copyPath)), map = mapOf(cart);
  const { folder, shifts, files, twinsOf, named: given, givenOf } = versionTwins(game, options.addresses ?? null);
  const functions = new Map(codeMap.functions.filter(f => !f.bytes).map(f => [f.address, f]));
  const offsetOf = address => {
    const { what, at } = placeIn(map, address);
    return what === ROM ? at : null;
  };
  // a value is the game's, at the address its proof/addresses.json gives, or the one in its label, as RAM_7E0010
  const addressOf = name => given.get(name) ?? (/^[A-Za-z][A-Za-z0-9]*_([0-9A-Fa-f]{6})$/.exec(name) ? parseInt(name.slice(-6), 16) : null);
  let chosen = files.filter(file => twinsOf.get(file).length), only = null;
  if (options.function) {
    const label = /^[A-Za-z][A-Za-z0-9]*_([0-9A-Fa-f]{6})$/.exec(options.function);
    const wanted = label ? parseInt(label[1], 16) : null;
    only = wanted ?? [...twinsOf.values()].flat().find(t => t.name === options.function)?.address ?? null;
    if (only === null) throw new Error(`"${options.function}" names no twin: name it as its contract does, as sub_808123, or by its twin's name.`);
    chosen = files.filter(file => twinsOf.get(file).some(t => t.address === only));
    if (!chosen.length) throw new Error(`No contract in games/${game}/ names ${options.function}: a line // dp:twin ${options.function} ... beside its twin does.`);
  }
  if (!chosen.length) {
    log(`games/${game}/ has no twins yet.`);
    return { exit: 0, functions: results };
  }
  const errors = files.flatMap(file => contractsIn(readFileSync(file, 'utf8')).errors.map(error => `${inRepo(file)}:${error.line}: ${error.error}`));
  for (const error of errors) log(error);
  const header = await twinsFolder(folder);
  const build = openBuild({
    root: folder, files, shifts, givenOf, console: 'snes', layout: LAYOUT,
    includes: [...(existsSync(join(folder, 'src')) ? [join(folder, 'src')] : []), ...(header ? [header.folder] : [])],
    signature: () => ({ params: [{ bits: 32, signed: false }], returns: { bits: 32, signed: false } }), wrap: wrapOf, kitNames: ['snes_check_list'],
  });
  const fold = foldOf(cart, map);
  const instructions = instructionsIn([...functions.values()], readFileSync(copyPath));
  const { ways: ruledOut } = readUnreachable(game);
  const totals = { same: 0, differs: 0, never: 0, stopped: 0, few: 0, unchecked: 0 }, failed = [];
  let proven = 0;
  const caller = new Original(buildCaller(log));
  try {
    await caller.cartridge(cart, map);
    const image = new Uint8Array(imageSize(cart.sram));
    await caller.image(image);
    for (const file of chosen) {
      const where = inRepo(file);
      const linked = await build.link({ file, only, addressOf });
      if (linked.error) {
        const said = linked.error.split('\n');
        results.push({ file: where, kind: 'unbuilt', line: linked.error });
        if (chosen.length === 1) log(`${where}\n  Didn't build: ${said.join('\n  ')}`);
        failed.push(`${where}: ${said.find(line => /error/.test(line)) ?? said[0]}`);
        continue;
      }
      if (linked.missing.length) {
        log(`${where}\n  Not checked: no address for ${linked.missing.join(', ')}`);
        continue;
      }
      log(where);
      const runner = new Runner(foldAddresses(linked.module, { table: TABLE, shift: 12, entries: ENTRIES }), options.seconds, fold);
      try {
        await runner.set(image);
        const choose = chooser(options.seed);
        for (const call of linked.calls) {
          if (only !== null && call.address !== only) continue;
          const offset = offsetOf(call.address), mapped = offset === null ? null : functions.get(offset);
          const unchecked = line => {
            totals.unchecked++;
            results.push({ label: call.contract.label, name: call.name, kind: 'unchecked', line });
            log(`  ${LABELS.unchecked}  ${call.contract.label} ${call.name}: ${line}`);
          };
          if (!mapped) {
            unchecked('no function of the code map starts there');
            continue;
          }
          const mode = call.contract.mode ?? mapped.mode;
          if (!mode) {
            unchecked('neither its contract nor the code map says the mode it starts in, as a16i16 after its name does');
            continue;
          }
          const { code } = follow({ rom: cart.rom, map }, [{ address: call.address, mode, call: true }]);
          const f = { label: call.contract.label, address: call.address, offset, size: mapped.size, mode, leaves: call.contract.leaves, way: wayOf(code), call: call.call, contract: call.contract };
          const checked = await checkFunction({ f, map, original: caller, runner, options, choose });
          const { kind, line } = outcome(f, checked, options);
          const { total, left } = waysLeft(instructions(mapped), offset, checked.ran, ruledOut);
          totals[kind]++;
          const whole = kind === 'same' && !left.length;
          if (whole) proven++;
          results.push({ key: mapped.key, label: f.label, name: call.name, kind, line, compared: checked.compared, whole, left, total });
          log(`  ${LABELS[kind]}  ${f.label} ${call.name}${kind === 'same' ? ', ' : ': '}${line}`);
          if (kind === 'same' && left.length) log(`    Its calls left out ${count(left.length)} of its ${count(total)} instructions and branch ways, such as ${left.slice(0, 3).map(([at, how]) => `${hex(at, 6)} ${how}`).join(', ')}: it isn't proven until calls take those too.`);
        }
      } finally {
        await runner.close();
      }
    }
  } finally {
    caller.close();
  }
  if (failed.length && chosen.length > 1) log(`${count(failed.length)} file${failed.length === 1 ? '' : 's'} didn't build as twins. The first is ${failed[0]}. Name a function of a file to see all the compiler said of it.`);
  const checked = Object.values(totals).reduce((sum, n) => sum + n, 0);
  log(`${count(totals.same)} of ${count(checked)} function${checked === 1 ? '' : 's'} left the same memory and registers as the original's, over ${count(options.calls)} calls each (seed ${options.seed}).`);
  if (totals.same) log(`${count(proven)} of those ${count(totals.same)} took every path of the original's function in their calls, which is what makes the same memory a proof.`);
  return { exit: totals.differs || totals.never || totals.stopped || errors.length ? 3 : 0, functions: results };
}
