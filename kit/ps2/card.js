// A PlayStation 2's memory cards as one run of bytes, the same on both sides of a proof: the program that plays the
// original writes the emulator's cards so (tools/libretro/held.h), a Dreamport's page hands its own over so, and `prove`
// compares the two file by file, byte by byte (tools/lib/saves.mjs).
//
// Each entry of the cards, port 0's card then port 1's, a folder's entries in the order of their names' bytes, each
// followed by what's in it when it's a folder: a letter, F for a file or D for a folder, its path as a 16-bit length and
// its bytes, "mc0/" or "mc1/" first and its folders after, separated by "/", then for a file its length in 32 bits and its
// bytes. A name is sorted as the emulator keeps it, with ":" and "\" written as %3A and %5C. The cards' times aren't in
// it: a game reads them, so they're in its memory, which is compared too.
//
// A kit in C hands its cards to the page as these bytes (kit/c/game.js): dp_memory_cards_changes() says how many times
// the game has changed them, and dp_memory_cards() and dp_memory_cards_size() where the bytes are and how many.

const ENCODED = name => name.replace(/[:\\]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const latin1 = text => Uint8Array.from(text, c => c.charCodeAt(0) & 0xFF);

/**
 * The cards as bytes, from their entries: each { path, bytes }, `path` as "mc0/BASLUS-00000/DATA", `bytes` a file's
 * Uint8Array, or none for a folder. Folders a file is in that aren't listed are written too.
 */
export function cardBytes(entries) {
  const tree = { folders: new Map() };
  for (const { path, bytes } of entries) {
    const parts = path.split('/');
    if (!/^mc[01]$/.test(parts[0]) || parts.length < 2 || parts.some(part => !part)) throw new Error(`A memory card's entry is "mc0/..." or "mc1/...", and "${path}" isn't one.`);
    let at = tree;
    for (const [i, part] of parts.entries()) {
      if (!at.folders.has(part)) at.folders.set(part, { folders: new Map() });
      at = at.folders.get(part);
      if (i === parts.length - 1 && bytes) at.bytes = bytes;
    }
  }
  const out = [];
  const walk = (node, path) => {
    for (const name of [...node.folders.keys()].sort((a, b) => (ENCODED(a) < ENCODED(b) ? -1 : ENCODED(a) > ENCODED(b) ? 1 : 0))) {
      const child = node.folders.get(name), own = path ? `${path}/${name}` : name, named = latin1(own), head = new Uint8Array(3);
      head[0] = (child.bytes ? 'F' : 'D').charCodeAt(0);
      head[1] = named.length & 0xFF;
      head[2] = named.length >> 8;
      out.push(head, named);
      if (child.bytes) {
        out.push(Uint8Array.of(child.bytes.length & 0xFF, child.bytes.length >> 8 & 0xFF, child.bytes.length >> 16 & 0xFF, child.bytes.length >>> 24), child.bytes);
      } else {
        walk(child, own);
      }
    }
  };
  for (const port of ['mc0', 'mc1']) if (tree.folders.has(port)) walk(tree.folders.get(port), port);
  const all = new Uint8Array(out.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of out) { all.set(part, at); at += part.length; }
  return all;
}

/** The cards' entries, from their bytes: each { path, folder, bytes }, `bytes` a file's, in the order they're written. */
export function cardEntries(bytes) {
  const entries = [];
  for (let at = 0; at < bytes.length;) {
    if (at + 3 > bytes.length) throw new Error('The memory cards\' bytes end partway through an entry.');
    const kind = String.fromCharCode(bytes[at]), length = bytes[at + 1] | bytes[at + 2] << 8;
    const path = String.fromCharCode(...bytes.subarray(at + 3, at + 3 + length));
    at += 3 + length;
    if (kind === 'D') { entries.push({ path, folder: true, bytes: null }); continue; }
    if (kind !== 'F' || at + 4 > bytes.length) throw new Error(`The memory cards' bytes have an entry of a kind they can't: ${kind} for ${path}.`);
    const size = (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;
    entries.push({ path, folder: false, bytes: bytes.subarray(at + 4, at + 4 + size) });
    at += 4 + size;
  }
  return entries;
}
