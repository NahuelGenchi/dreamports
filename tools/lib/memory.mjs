// What prove compares of a console's work memory, for a game that keeps it at the console's own addresses, as one
// whose every function is a twin does (docs/STANDARD.md): after every frame, every byte of the stretches the game's
// proof/original.json lists under "workMemory", in the original and in the Dreamport. Both sides hash the same bytes
// the same way as each frame ends (tools/gba/original.c, lib/in-page.js), and the bytes themselves are read only at
// the first frame whose hashes differ, to say where. They stay on this computer.
//
// "workMemory": [{ "address": "03000000", "bytes": 28672 }, ...]: each stretch's first address, as eight capital
// hexadecimal digits, and how many bytes. A game leaves out what the two can't share, such as the top of the fast work
// memory, where the console's processor keeps its stack and a Dreamport's C keeps its own elsewhere.
//
// A PlayStation 2 has three memories, each with addresses of its own, and a stretch says which with "memory": "ee",
// the EE's, which it is without one, where main memory is from 0, the scratchpad at 70000000, vector unit 0's code and
// data at 11000000 and 11004000 and vector unit 1's at 11008000 and 1100C000; "iop", the IOP's, its memory from 0 and
// its scratchpad at 1F800000; and "spu2", the SPU2's sound memory from 0. Each is the console's size, though the
// emulator keeps more of some (libretro/held.h, play.patch).

const hex = value => `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
// where a console's work memory is, the only memory compared: its name, first address and length, and on a console with
// more than one memory, which, by its number for the program that runs the original and its name in original.json
const WORK = {
  gba: [['the slow work memory', 0x02000000, 0x40000], ['the fast work memory', 0x03000000, 0x8000]],
  ps2: [
    ['main memory', 0, 0x02000000, 0, 'ee'], ['the scratchpad', 0x70000000, 0x4000, 0, 'ee'],
    ["vector unit 0's code", 0x11000000, 0x1000, 0, 'ee'], ["vector unit 0's data", 0x11004000, 0x1000, 0, 'ee'],
    ["vector unit 1's code", 0x11008000, 0x4000, 0, 'ee'], ["vector unit 1's data", 0x1100C000, 0x4000, 0, 'ee'],
    ["the IOP's memory", 0, 0x200000, 1, 'iop'], ["the IOP's scratchpad", 0x1F800000, 0x400, 1, 'iop'],
    ["the SPU2's memory", 0, 0x200000, 2, 'spu2'],
  ],
};
const MEMORIES = { ee: 0, iop: 1, spu2: 2 };

// the part of a console's memory an address of a stretch is in, by name, on a console with several memories, or null
const partOf = (console, { memory = 0 }, address) => (console === 'ps2' ? (WORK[console].find(([, from, length, which]) => which === memory && address >= from && address < from + length)?.[0] ?? null) : null);

/** Where an address is, in words: the address and the part of the console's memory it's in, as `prove` says it. */
export function placeText(console, stretch, address) {
  const part = partOf(console, stretch, address);
  return part ? `${hex(address)}, in ${part}` : hex(address);
}

/** The stretches of work memory a game's original.json asks prove to compare, each { address, bytes }, in order, or
 *  null when it asks for none. `where` names the file, for an error that says what it needs. */
export function workMemoryOf(original, where) {
  const { workMemory } = original;
  if (workMemory === undefined) return null;
  const within = WORK[original.console];
  if (!within) throw new Error(`${where} lists "workMemory", and the tools can compare only the Game Boy Advance's so far (docs/CONSOLES.md).`);
  const named = original.console === 'ps2';
  const shaped = Array.isArray(workMemory) && workMemory.length > 0 && workMemory.every(s => typeof s?.address === 'string' && /^[0-9A-F]{8}$/.test(s.address) && Number.isInteger(s.bytes) && s.bytes > 0
    && (s.memory === undefined || (named && s.memory in MEMORIES)));
  if (!shaped) throw new Error(`${where} needs "workMemory" as a list of { "address", "bytes"${named ? ', "memory"' : ''} }, each address as eight capital hexadecimal digits${named ? ', and the memory "ee", "iop" or "spu2", the EE\'s without one' : ''}.`);
  const stretches = workMemory.map(s => ({ address: parseInt(s.address, 16), bytes: s.bytes, ...(named ? { memory: MEMORIES[s.memory ?? 'ee'] } : {}) }));
  stretches.forEach(({ address, bytes, memory = 0 }, i) => {
    if (!within.some(([, from, length, which = 0]) => which === memory && address >= from && address + bytes <= from + length)) throw new Error(`${where} lists ${bytes} bytes from ${hex(address)}${named ? ` of the ${Object.keys(MEMORIES)[memory]}'s memory` : ''} under "workMemory", which aren't all in the console's ${named ? 'memory' : 'work memory'}.`);
    const before = stretches[i - 1];
    if (before && (before.memory ?? 0) > memory) throw new Error(`${where} needs the stretches under "workMemory" with the EE's first, then the IOP's, then the SPU2's.`);
    if (before && (before.memory ?? 0) === memory && address < before.address + before.bytes) throw new Error(`${where} needs the stretches under "workMemory" in order, none reaching into the next.`);
  });
  return stretches;
}

/** What the program that runs the original is given: the frame whose bytes to write too, or -1, then each stretch, as
 *  its address and bytes, or on a console with several memories, which, its address and bytes (libretro/held.h). */
export const memorySpec = (stretches, frame = -1) => new Uint8Array(Uint32Array.from([frame >>> 0, ...stretches.flatMap(({ address, bytes, memory }) => (memory === undefined ? [address, bytes] : [memory, address, bytes]))]).buffer);

/** How many bytes the stretches hold. */
export const memoryBytes = stretches => stretches.reduce((sum, { bytes }) => sum + bytes, 0);

/** Where two copies of the stretches' bytes differ: { bytes, first: { address, original, dreamport }, stretches }, with
 *  `stretches` the first few runs of differing bytes as [first address, last address], or null when they're the same. */
export function compareMemory(stretches, original, dreamport, console = 'gba') {
  const runs = [];
  let differing = 0, first = null, at = 0;
  for (const stretch of stretches) {
    const { address, bytes } = stretch;
    for (let i = 0; i < bytes; i++, at++) {
      if (original[at] === dreamport[at]) continue;
      differing++;
      first ??= { address: placeText(console, stretch, address + i), original: original[at], dreamport: dreamport[at] };
      const last = runs.at(-1);
      if (last && last[2] === stretch && last[1] === address + i - 1) last[1] = address + i;
      else runs.push([address + i, address + i, stretch]);
    }
  }
  if (!differing) return null;
  return { bytes: differing, first, stretches: runs.slice(0, 16).map(([a, b, stretch]) => [hex(a), hex(b), ...(partOf(console, stretch, a) ? [partOf(console, stretch, a)] : [])]), ...(runs.length > 16 ? { more: runs.length - 16 } : {}) };
}

/** The line prove prints about the first frame whose work memory differs. */
export function describeMemory(frame, found, total, console = 'gba') {
  if (!found) return `Frame ${frame}'s memory has another hash in each, though its bytes read the same: the program that runs the original and the page disagree on what to hash.`;
  const two = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const where = found.stretches.slice(0, 6).map(([a, b, part]) => `${a === b ? a : `${a} to ${b}`}${part ? ` in ${part}` : ''}`).join(', ');
  const others = found.stretches.length > 6 || found.more ? `, and ${found.stretches.length - 6 + (found.more ?? 0)} more stretches` : '';
  return `The ${console === 'ps2' ? "console's memory" : 'work memory'} first differs after frame ${frame}: ${found.bytes.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} bytes, the first at ${found.first.address}, which holds ${two(found.first.original)} in the original and ${two(found.first.dreamport)} in the Dreamport. They are at ${where}${others}.`;
}
