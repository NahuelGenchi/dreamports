// What can be said of a word of the cartridge that holds an address in the middle of a function (#1760): the tools
// count such a word as a way into the function, since something may jump where it says. For a person deciding whether
// one is only data that happens to look so, this gathers what the cartridge itself says of it: where it is, as the
// code map has it, what the words around it are, whether anything in the cartridge points to it or to the stretch it
// sits in, and whether it reads as a Thumb address. It reads the copy as the tool runs and keeps nothing of it.

import { instructionsOf } from './played.mjs';

const CARTRIDGE = 0x08000000;

/**
 * The words of `rom` that hold an address inside `functions`' code past its start, as { at, value, into }: `at` where
 * the word is, `value` what it holds and `into` the function (from the code map).
 */
export function wordsIntoFunctions(rom, functions) {
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length - rom.length % 4);
  const inRom = functions.filter(f => f.address >= CARTRIDGE && f.address + f.size <= CARTRIDGE + rom.length).sort((a, b) => a.address - b.address);
  const found = [];
  for (let i = 0; i + 4 <= view.byteLength; i += 4) {
    const value = view.getUint32(i, true), target = (value & ~1) >>> 0;
    if (target < CARTRIDGE || target >= CARTRIDGE + rom.length) continue;
    const f = functionAt(inRom, target);
    if (f && target !== f.address) found.push({ at: CARTRIDGE + i, value, into: f });
  }
  return found;
}

// the function of a sorted list `at` is inside, or null
function functionAt(sorted, at) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, f = sorted[mid];
    if (at < f.address) hi = mid - 1;
    else if (at >= f.address + f.size) lo = mid + 1;
    else return f;
  }
  return null;
}

/**
 * What the cartridge says of the word at `at`: { at, value, odd, inFunction, before, after, around, pointers,
 * nearest }. `inFunction` is the code map's function it sits in, or null, and `before` and `after` the code map's
 * nearest functions on each side; `around` counts the 32 words on each side by what they look like; `pointers` are the
 * words anywhere in the cartridge that hold its own address, with or without the Thumb bit; and `nearest` the nearest
 * address at or below it, within `reach` bytes, that a word of the cartridge holds, with where those words are, as the
 * start of a table or a block of data something points to would be.
 */
export function wordEvidence(rom, functions, at, reach = 0x10000) {
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length - rom.length % 4);
  const word = a => view.getUint32(a - CARTRIDGE, true);
  const sorted = functions.filter(f => f.address >= CARTRIDGE && f.address + f.size <= CARTRIDGE + rom.length).sort((a, b) => a.address - b.address);
  const value = word(at);
  const inFunction = functionAt(sorted, at);
  const before = sorted.filter(f => f.address + f.size <= at).at(-1) ?? null, after = sorted.find(f => f.address > at) ?? null;
  // the words around it, by what they look like
  const around = { addressesInCartridge: 0, addressesInWorkMemory: 0, small: 0, other: 0, same: 0 };
  for (let k = -32; k <= 32; k++) {
    const a = at + 4 * k;
    if (!k || a < CARTRIDGE || a + 4 > CARTRIDGE + view.byteLength) continue;
    const w = word(a);
    if (w === value) around.same++;
    if (w >= CARTRIDGE && w < CARTRIDGE + rom.length) around.addressesInCartridge++;
    else if ((w >= 0x02000000 && w < 0x02040000) || (w >= 0x03000000 && w < 0x03008000)) around.addressesInWorkMemory++;
    else if (w < 0x10000) around.small++;
    else around.other++;
  }
  // every word of the cartridge that holds an address at or below this one, within reach, and where it is
  const pointers = [], below = new Map();
  for (let i = 0; i + 4 <= view.byteLength; i += 4) {
    const v = view.getUint32(i, true), target = (v & ~1) >>> 0;
    if (target === at) pointers.push({ from: CARTRIDGE + i, inFunction: functionAt(sorted, CARTRIDGE + i) });
    if (target <= at && at - target < reach) {
      if (!below.has(target)) below.set(target, []);
      below.get(target).push(CARTRIDGE + i);
    }
  }
  // and each address the code works out from where it is, `add rN, pc, #n`, as a table beside a function is reached
  for (const f of sorted) {
    if (f.address > at || at - f.address > reach + 0x400) continue;
    const bytes = rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
    for (const pc of instructionsOf(bytes).instructions) {
      const op = bytes[pc] | bytes[pc + 1] << 8;
      if ((op & 0xF800) !== 0xA000) continue;
      const target = ((f.address + pc + 4) & ~3) + (op & 0xFF) * 4;
      if (target === at) pointers.push({ from: f.address + pc, inFunction: f, code: true });
      if (target <= at && at - target < reach) {
        if (!below.has(target)) below.set(target, []);
        below.get(target).push(f.address + pc);
      }
    }
  }
  const start = below.size ? Math.max(...below.keys()) : null;
  const nearest = start === null ? null : { address: start, from: below.get(start).map(from => ({ from, inFunction: functionAt(sorted, from) })) };
  return { at, value, odd: (value & 1) === 1, inFunction, before, after, around, pointers, nearest };
}

/**
 * The words pointing into a function's middle that may be set aside as not a way in (#1760), as a Map from the address
 * they point to to the words, each { at, value }, holding only the addresses every word pointing to is such a word.
 * A word may be set aside only when the cartridge gives no sign it's a pointer: it's outside the code map's functions;
 * it's odd, as a Thumb address is, so it points where it says; neither word beside it holds an address in the
 * cartridge, so it isn't in a table of addresses, whose start it would be; and no word of the cartridge holds its own
 * address, with or without the Thumb bit, and no `add rN, pc` of the code map's functions works it out. If anything
 * refers to it, it stays a way in.
 */
export function wordsSetAside(rom, functions) {
  const view = new DataView(rom.buffer, rom.byteOffset, rom.length - rom.length % 4);
  const inCartridge = v => v >= CARTRIDGE && v < CARTRIDGE + rom.length;
  const sorted = functions.filter(f => f.address >= CARTRIDGE && f.address + f.size <= CARTRIDGE + rom.length).sort((a, b) => a.address - b.address);
  const pointed = new Set();
  for (let i = 0; i + 4 <= view.byteLength; i += 4) {
    const v = view.getUint32(i, true);
    if (inCartridge(v)) pointed.add((v & ~1) >>> 0);
  }
  for (const f of sorted) {
    const bytes = rom.subarray(f.address - CARTRIDGE, f.address - CARTRIDGE + f.size);
    for (const pc of instructionsOf(bytes).instructions) {
      const op = bytes[pc] | bytes[pc + 1] << 8;
      if ((op & 0xF800) === 0xA000) pointed.add(((f.address + pc + 4) & ~3) + (op & 0xFF) * 4);
    }
  }
  const word = a => (a >= CARTRIDGE && a + 4 <= CARTRIDGE + view.byteLength ? view.getUint32(a - CARTRIDGE, true) : 0);
  const byTarget = new Map(), refused = new Set();
  for (const w of wordsIntoFunctions(rom, functions)) {
    const target = (w.value & ~1) >>> 0;
    const ok = !functionAt(sorted, w.at) && (w.value & 1) === 1 && !inCartridge(word(w.at - 4)) && !inCartridge(word(w.at + 4)) && !pointed.has(w.at);
    if (!ok) refused.add(target);
    else {
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push({ at: w.at, value: w.value });
    }
  }
  for (const target of refused) byTarget.delete(target);
  return byTarget;
}

/** A word set aside in words, from what wordEvidence finds of it. */
export function asideWhy(evidence) {
  const hex = n => n.toString(16).toUpperCase().padStart(8, '0');
  const { at, value, around, nearest } = evidence;
  const addresses = around.addressesInCartridge + around.addressesInWorkMemory;
  return `the word at ${hex(at)} holds ${hex(value)}, odd, so a Thumb address, outside the code map's functions, with ${addresses ? `${addresses} of the 64 words around it an address and neither beside it` : 'none of the 64 words around it an address'}, and no word of the cartridge holds its address nor does any code work it out${nearest ? `; the nearest place below it anything points to is ${hex(nearest.address)}, ${at - nearest.address} bytes before it` : ''}`;
}
