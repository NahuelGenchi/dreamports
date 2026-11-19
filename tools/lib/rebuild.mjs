// The whole cartridge rebuilt, and every byte of the original accounted for (#1533): the two checks that a version
// reported as 100% code ported can't be missing a function or a piece of content of the original, which a function's
// own proof can't say, as it looks only where the code map points.
//
// rebuildOf lays every twin's bytes, as the console's compiler built them with every address filled in, over the
// player's copy at the address its comment names, and compares every byte the code map calls code: what's the same,
// what's proven another way, what differs, what no twin covers, and what lies outside the code map. `npm run dp --
// match <version> --whole` gives it the twins (../match.mjs), and the rebuild lives in memory only: it's never written
// anywhere, and what's said of it is addresses and counts.
//
// accountOf sorts every byte of the copy: proven code, code without a proof, data used in play, data never used, and
// bytes explained, with how each was told apart. `npm run dp -- proofs <version> --bytes` prints it (../proofs.mjs),
// and `proofs` puts its share, bytes accounted for, beside code ported and gameplay proven, in the tools only.
//
// Nothing here knows a console's compiler or where a game's files are: what reads the copy, the code map, the twins'
// bytes and the proofs are given, so a test gives its own made-up ones (../test/rebuild.mjs).

import { playedPercent } from '../../src/lib/entries.mjs';

/** How many bytes of one value in a row are fill, which holds nothing: a cell of the ledger's (lib/played.mjs). */
export const FILL = 32;
/** What a function's start is lined up on. Zeros after a function up to it only line up what follows. */
const LINE_UP = 4;

// a list of stretches, each { from, to }, from bytes each found in turn: one goes on while the next starts where it ends
function stretcher() {
  const list = [];
  return {
    list,
    add(address, more = {}) {
      const last = list.at(-1);
      if (last && last.to + 1 === address && Object.entries(more).every(([key, value]) => key === 'functions' || last[key] === value)) {
        last.to = address;
        if (more.functions !== undefined && last.functions.at(-1) !== more.functions) last.functions.push(more.functions);
      } else list.push({ from: address, to: address, ...more, ...(more.functions !== undefined ? { functions: [more.functions] } : {}) });
    },
  };
}

/** Stretches by size, the biggest first, then by address. */
export const biggestFirst = list => [...list].sort((a, b) => (b.to - b.from) - (a.to - a.from) || a.from - b.from);

/**
 * The cartridge rebuilt from a version's twins and compared with the copy, byte for byte, over every function of the
 * code map in the cartridge:
 *   functions   the code map's functions, each { key, address, size, bytes }; those with `bytes`, which the game
 *               makes in its work memory, and those before `cartridge`, aren't the cartridge's bytes
 *   read(address, count)  that many of the copy's bytes from there, as a Buffer
 *   laid        each twin built, { name, address, bytes, file, library, run, calls }: `bytes` as the compiler built it
 *               with every address filled in, `run` the code map's functions it's the twin of together, for a twin
 *               of a run, and `calls` the addresses its calls go to
 *   states      each function's state by key, as lib/proofs.mjs's stateOf gives it: { kind, twin, beyond }
 * A twin of a function proven by the same memory whose bytes aren't the original's isn't laid, as its proof was never
 * of bytes: code in assembly or ARM, which no compiler rebuilds. Answers { code, same, libraries, another, differs,
 * padding, none, unbuilt, start, differing, missing, outside, calls, made, complete }: the code map's bytes in the
 * cartridge, and of them how many are the same, the same from a shared library, proven another way, differing,
 * padding (zeros after a twin's end that line up the next function on four bytes) and covered by no twin, with those of
 * them whose function has a twin no build laid (`unbuilt`) and those of the cartridge's start (`start`), which the kit
 * does in a Dreamport; `differing`, each twin that differs, { name, file, from, to, bytes }; `missing`, the stretches no
 * twin covers, { from, to, functions, unbuilt, start }, the biggest first; `outside`, each twin laid where no function
 * starts, past its function's end, or over another twin, { why, name, file, from, to, bytes, other }; `calls`, each call
 * to where no function starts, { name, file, target, inside }; `made`, the functions the game makes in its work memory,
 * { functions, proven }; and whether every byte of the code is the same, proven another way or padding, with nothing
 * outside the code map.
 */
export function rebuildOf({ functions, read, laid, states = new Map(), cartridge = 0x08000000 }) {
  const code = functions.filter(f => !f.bytes && f.address >= cartridge).sort((a, b) => a.address - b.address);
  const madeHere = functions.filter(f => f.bytes || f.address < cartridge);
  const made = { functions: madeHere.length, proven: madeHere.filter(f => states.get(f.key)?.kind).length };
  const starts = new Map(code.map((f, i) => [f.address, i]));
  const twins = laid.filter(t => t.address !== null && t.address >= cartridge && t.bytes?.length);
  const ends = [...code.map(f => f.address + f.size), ...twins.map(t => t.address + t.bytes.length)];
  const lo = Math.min(cartridge, ...twins.map(t => t.address)), hi = Math.max(lo, ...ends), n = hi - lo;
  const original = read(lo, n);
  // which function of the code map each byte is in, or -1 outside every function
  const within = new Int32Array(n).fill(-1);
  code.forEach((f, i) => within.fill(i, f.address - lo, f.address + f.size - lo));
  // the twin laid first on each byte, its byte there, and how many were laid on it
  const owner = new Int32Array(n).fill(-1), ours = new Uint8Array(n), layers = new Uint8Array(n);
  const outside = [], calls = [], overlaps = new Map(), another = new Set();

  twins.forEach((twin, index) => {
    const at = twin.address - lo, state = states.get(code[starts.get(twin.address)]?.key);
    const sameBytes = at + twin.bytes.length <= original.length && original.subarray(at, at + twin.bytes.length).equals(twin.bytes);
    // a proof by the same memory isn't one of bytes: its twin isn't laid unless it comes out the original's anyway
    if (!sameBytes && state?.kind === 'memory') {
      for (const f of twin.run ?? [code[starts.get(twin.address)]]) another.add(f.key);
      return;
    }
    // where the twin's own functions end: its function's, or its run's last one's, or nowhere for no function
    const end = starts.has(twin.address) ? (twin.run ? twin.run.at(-1).address + twin.run.at(-1).size : code[starts.get(twin.address)].address + code[starts.get(twin.address)].size) - lo : at;
    if (!starts.has(twin.address)) outside.push({ why: 'no function', name: twin.name, file: twin.file, from: twin.address, to: twin.address + twin.bytes.length - 1, bytes: twin.bytes.length });
    else if (at + twin.bytes.length > end) outside.push({ why: 'past its end', name: twin.name, file: twin.file, from: end + lo, to: twin.address + twin.bytes.length - 1, bytes: at + twin.bytes.length - end });
    for (let i = 0; i < twin.bytes.length; i++) {
      const place = at + i;
      if (layers[place]++) {
        const key = `${owner[place]}:${index}`;
        if (!overlaps.has(key)) overlaps.set(key, { why: 'over another', name: twin.name, file: twin.file, other: twins[owner[place]].name, from: place + lo, to: place + lo, bytes: 0 });
        overlaps.get(key).to = place + lo;
        overlaps.get(key).bytes++;
        continue;
      }
      owner[place] = index;
      ours[place] = twin.bytes[i];
    }
    for (const target of twin.calls ?? []) {
      const to = target & ~1;
      if (starts.has(to)) continue;
      const inside = to >= lo && to < hi ? within[to - lo] : -1;
      calls.push({ name: twin.name, file: twin.file, target: to, ...(inside >= 0 ? { inside: code[inside].address } : {}) });
    }
  });
  outside.push(...overlaps.values());

  // where padding starts in each function: after the last byte a twin laid in it, when what's left is fewer than four
  // zeros up to the function's end on a four-byte boundary
  const paddingFrom = new Int32Array(code.length).fill(-1);
  code.forEach((f, i) => {
    const from = f.address - lo, to = from + f.size;
    if (owner[from] < 0 || (f.address + f.size) % LINE_UP) return;
    let last = to - 1;
    while (last >= from && owner[last] < 0) last--;
    if (to - last - 1 > 0 && to - last - 1 < LINE_UP && original.subarray(last + 1, to).every(byte => byte === 0)) paddingFrom[i] = last + 1;
  });

  const result = { code: 0, same: 0, libraries: 0, another: 0, differs: 0, padding: 0, none: 0, unbuilt: 0, start: 0 };
  const differing = new Map(), missing = stretcher();
  for (let place = 0; place < n; place++) {
    const i = within[place];
    if (i < 0) continue;
    const f = code[i], state = states.get(f.key);
    result.code++;
    if (owner[place] >= 0) {
      const twin = twins[owner[place]];
      if (ours[place] === original[place]) {
        result.same++;
        if (twin.library) result.libraries++;
      } else {
        result.differs++;
        if (!differing.has(owner[place])) differing.set(owner[place], { name: twin.name, file: twin.file, from: place + lo, to: place + lo, bytes: 0 });
        differing.get(owner[place]).to = place + lo;
        differing.get(owner[place]).bytes++;
      }
    } else if (another.has(f.key) || state?.kind === 'memory') result.another++;
    else if (paddingFrom[i] >= 0 && place >= paddingFrom[i]) result.padding++;
    else {
      result.none++;
      const unbuilt = Boolean(state?.twin), start = state?.beyond === 'start';
      if (unbuilt) result.unbuilt++;
      if (start) result.start++;
      missing.add(place + lo, { unbuilt, start, functions: f.address });
    }
  }
  const complete = result.code > 0 && !result.differs && !result.none && !outside.length && !calls.length;
  return {
    ...result, differing: [...differing.values()].sort((a, b) => a.from - b.from), missing: biggestFirst(missing.list),
    outside: outside.sort((a, b) => a.from - b.from), calls: calls.sort((a, b) => a.target - b.target), made, complete,
  };
}

/** The kinds a byte of the copy is accounted as, by what accountOf calls them, with how the tools say them. */
export const KINDS = {
  proven: 'proven code',
  unproven: 'code without a proof',
  used: 'data used in play',
  never: 'data never used',
  header: 'the cartridge\'s header, which the console reads as it starts',
  padding: 'zeros after a function up to a four-byte boundary, which line up what follows',
  fill: `runs of one value, ${FILL} bytes or longer, which hold nothing`,
  unreachable: 'stretches the game\'s unreachable.json lists, each with why nothing reaches it',
};
/** The kinds that are accounted for: all but code without a proof and data never used. */
export const ACCOUNTED = ['proven', 'used', 'header', 'padding', 'fill', 'unreachable'];
const ORDER = Object.keys(KINDS);

/**
 * Every byte of a copy sorted into one of KINDS:
 *   rom        the whole copy, a Buffer, its first byte at `cartridge`
 *   functions  the code map's functions; those the game makes in its work memory aren't the copy's bytes, and the data
 *              they're made from is counted as data
 *   proven     the keys of the functions whose twin's proof holds, by the same bytes or the same memory
 *   used(cell) whether the game used something of a cell of `cell` bytes, numbered from the copy's start, in a frame
 *              that matched (lib/played.mjs)
 *   unreachable the stretches of content the game's unreachable.json lists, as [first, last] addresses
 *   header     the cartridge's header, as [first, last] addresses, or null
 * Answers { total, counts, accounted, percent, unexplained }: `counts` the bytes of each kind, `accounted` those of
 * ACCOUNTED, `percent` their share, floored to hundredths, and `unexplained` the stretches of code without a proof and
 * of data never used, each { kind, from, to, functions }, the biggest first.
 */
export function accountOf({ rom, functions, proven = new Set(), used = () => false, unreachable = [], header = null, cartridge = 0x08000000, cell = 32 }) {
  const n = rom.length, kinds = new Uint8Array(n), NONE = 0;
  const kind = name => ORDER.indexOf(name) + 1;
  const code = functions.filter(f => !f.bytes && f.address >= cartridge && f.address < cartridge + n).sort((a, b) => a.address - b.address);
  // which function of the code map each byte of code is in, for the stretches
  const within = new Int32Array(n).fill(-1);
  code.forEach((f, i) => {
    kinds.fill(kind(proven.has(f.key) ? 'proven' : 'unproven'), f.address - cartridge, Math.min(n, f.address + f.size - cartridge));
    within.fill(i, f.address - cartridge, Math.min(n, f.address + f.size - cartridge));
  });
  if (header) for (let at = Math.max(0, header[0] - cartridge); at <= Math.min(n - 1, header[1] - cartridge); at++) if (kinds[at] === NONE) kinds[at] = kind('header');
  // fewer than four zeros after a function, up to a four-byte boundary
  for (const f of code) {
    const from = f.address + f.size - cartridge;
    let to = from;
    while (to < n && (to + cartridge) % LINE_UP && kinds[to] === NONE && rom[to] === 0) to++;
    if (to > from && (to + cartridge) % LINE_UP === 0) kinds.fill(kind('padding'), from, to);
  }
  // a run of one value, outside the code and the header
  for (let at = 0; at < n;) {
    if (kinds[at] !== NONE) {
      at++;
      continue;
    }
    let end = at + 1;
    while (end < n && kinds[end] === NONE && rom[end] === rom[at]) end++;
    if (end - at >= FILL) kinds.fill(kind('fill'), at, end);
    at = end;
  }
  // the rest is data: used in play, or listed as what nothing reaches, or never used
  const listed = at => unreachable.some(([from, to]) => at + cartridge >= from && at + cartridge <= to);
  for (let at = 0; at < n; at++) {
    if (kinds[at] !== NONE) continue;
    kinds[at] = kind(used(Math.floor(at / cell)) ? 'used' : listed(at) ? 'unreachable' : 'never');
  }
  const counts = Object.fromEntries(ORDER.map(name => [name, 0]));
  const stretches = stretcher();
  for (let at = 0; at < n; at++) {
    const name = ORDER[kinds[at] - 1];
    counts[name]++;
    if (name === 'unproven') stretches.add(at + cartridge, { kind: name, functions: code[within[at]].address });
    else if (name === 'never') stretches.add(at + cartridge, { kind: name });
  }
  const accounted = ACCOUNTED.reduce((sum, name) => sum + counts[name], 0);
  return { total: n, counts, accounted, percent: playedPercent(accounted, n), unexplained: biggestFirst(stretches.list) };
}
