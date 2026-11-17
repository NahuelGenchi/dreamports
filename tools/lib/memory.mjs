// What prove compares of a console's work memory, for a game that keeps it at the console's own addresses, as one
// whose every function is a twin does (docs/STANDARD.md): after every frame, every byte of the stretches the game's
// proof/original.json lists under "workMemory", in the original and in the Dreamport. Both sides hash the same bytes
// the same way as each frame ends (tools/gba/original.c, lib/in-page.js), and the bytes themselves are read only at
// the first frame whose hashes differ, to say where. They stay on this computer.
//
// "workMemory": [{ "address": "03000000", "bytes": 28672 }, ...]: each stretch's first address, as eight capital
// hexadecimal digits, and how many bytes. A game leaves out what the two can't share, such as the top of the fast work
// memory, where the console's processor keeps its stack and a Dreamport's C keeps its own elsewhere.

const hex = value => `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
// where a console's work memory is, the only memory compared: its name, first address and length
const WORK = { gba: [['the slow work memory', 0x02000000, 0x40000], ['the fast work memory', 0x03000000, 0x8000]] };

/** The stretches of work memory a game's original.json asks prove to compare, each { address, bytes }, in order, or
 *  null when it asks for none. `where` names the file, for an error that says what it needs. */
export function workMemoryOf(original, where) {
  const { workMemory } = original;
  if (workMemory === undefined) return null;
  const within = WORK[original.console];
  if (!within) throw new Error(`${where} lists "workMemory", and the tools can compare only the Game Boy Advance's so far (docs/CONSOLES.md).`);
  const shaped = Array.isArray(workMemory) && workMemory.length > 0 && workMemory.every(s => typeof s?.address === 'string' && /^[0-9A-F]{8}$/.test(s.address) && Number.isInteger(s.bytes) && s.bytes > 0);
  if (!shaped) throw new Error(`${where} needs "workMemory" as a list of { "address", "bytes" }, each address as eight capital hexadecimal digits.`);
  const stretches = workMemory.map(s => ({ address: parseInt(s.address, 16), bytes: s.bytes }));
  stretches.forEach(({ address, bytes }, i) => {
    if (!within.some(([, from, length]) => address >= from && address + bytes <= from + length)) throw new Error(`${where} lists ${bytes} bytes from ${hex(address)} under "workMemory", which aren't all in the console's work memory.`);
    if (i && address < stretches[i - 1].address + stretches[i - 1].bytes) throw new Error(`${where} needs the stretches under "workMemory" in order, none reaching into the next.`);
  });
  return stretches;
}

/** What the program that runs the original is given: the frame whose bytes to write too, or -1, then each stretch. */
export const memorySpec = (stretches, frame = -1) => new Uint8Array(Uint32Array.from([frame >>> 0, ...stretches.flatMap(({ address, bytes }) => [address, bytes])]).buffer);

/** How many bytes the stretches hold. */
export const memoryBytes = stretches => stretches.reduce((sum, { bytes }) => sum + bytes, 0);

/** Where two copies of the stretches' bytes differ: { bytes, first: { address, original, dreamport }, stretches }, with
 *  `stretches` the first few runs of differing bytes as [first address, last address], or null when they're the same. */
export function compareMemory(stretches, original, dreamport) {
  const runs = [];
  let differing = 0, first = null, at = 0;
  for (const { address, bytes } of stretches) {
    for (let i = 0; i < bytes; i++, at++) {
      if (original[at] === dreamport[at]) continue;
      differing++;
      first ??= { address: hex(address + i), original: original[at], dreamport: dreamport[at] };
      const last = runs.at(-1);
      if (last && last[1] === address + i - 1) last[1] = address + i;
      else runs.push([address + i, address + i]);
    }
  }
  if (!differing) return null;
  return { bytes: differing, first, stretches: runs.slice(0, 16).map(([a, b]) => [hex(a), hex(b)]), ...(runs.length > 16 ? { more: runs.length - 16 } : {}) };
}

/** The line prove prints about the first frame whose work memory differs. */
export function describeMemory(frame, found, total) {
  if (!found) return `Frame ${frame}'s work memory has another hash in each, though its bytes read the same: the program that runs the original and the page disagree on what to hash.`;
  const two = value => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`;
  const where = found.stretches.slice(0, 6).map(([a, b]) => (a === b ? a : `${a} to ${b}`)).join(', ');
  const others = found.stretches.length > 6 || found.more ? `, and ${found.stretches.length - 6 + (found.more ?? 0)} more stretches` : '';
  return `The work memory first differs after frame ${frame}: ${found.bytes.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} bytes, the first at ${found.first.address}, which holds ${two(found.first.original)} in the original and ${two(found.first.dreamport)} in the Dreamport. They are at ${where}${others}.`;
}
