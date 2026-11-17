// A cartridge's save memory kept in the browser: the bytes the cartridge's flash, EEPROM or SRAM would hold, in
// its storage (localStorage, as base64) under a key of the game's own. What the bytes mean is the game's: it reads
// them at power-on and writes them when the original does. Where storage is blocked or full, the game keeps its
// save in memory for as long as the page is open.

import { noteStartSave } from './session.js';

/**
 * The browser's storage, or null where it is blocked. Under a proof tool that gave the game saves to start from, it's
 * those, kept in memory (proofStorage), so a game that opens its save from the browser's storage starts from them.
 */
export function browserStorage() {
  try { return proofStorage() ?? globalThis.localStorage ?? null; } catch { return null; }
}

// what a proof tool gave the game to start from, once made
let givenSaves;

/**
 * The storage a proof tool gave the game to start from (tools/lib/dreamport.mjs, as `dreamportsProofSaves`): the saves
 * a player's report began from (docs/REPORTS.md), by key, as base64, kept in memory for the run, so what the game
 * writes it reads back as it would from the browser. Null when the tool gave none, which is every recording but a
 * player's report: the game then starts as one that has never saved. A game that hands cartridgeSave no storage under
 * the proof tools, as Sonic Battle Dreamport in JavaScript does, starts with nothing saved either way.
 */
export function proofStorage() {
  if (givenSaves !== undefined) return givenSaves;
  const given = globalThis.dreamportsProofSaves;
  if (!given || typeof given !== 'object') return (givenSaves = null);
  const kept = new Map(Object.entries(given));
  return (givenSaves = { getItem: key => kept.get(key) ?? null, setItem(key, text) { kept.set(key, String(text)); }, removeItem(key) { kept.delete(key); } });
}

/**
 * The save memory kept under `key` in `storage` (the browser's localStorage by default; null keeps nothing):
 * { read(), write(bytes), erase() }. `read` gives the bytes last written, or null when there are none; `write`
 * keeps `bytes` and returns whether they were kept; `erase` forgets them.
 */
export function cartridgeSave(key, storage = browserStorage()) {
  // what a visit began from, before the game writes over it: a player's report carries it (session.js)
  if (storage) {
    try { noteStartSave(key, storage.getItem(key)); } catch { /* storage blocked */ }
  }
  return {
    read() {
      try {
        const text = storage?.getItem(key);
        if (!text) return null;
        return Uint8Array.from(atob(text), c => c.charCodeAt(0));
      } catch {
        return null;   // storage blocked, or not what this keeps
      }
    },
    write(bytes) {
      // the proof tools compare what's saved with what the original's cartridge holds (kit/gba/proof.js)
      if (globalThis.dreamportsProof) globalThis.dreamportsProof.saved = bytes.slice();
      if (!storage) return false;
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try {
        storage.setItem(key, btoa(text));
        return true;
      } catch {
        return false;   // storage blocked or full: kept for this visit
      }
    },
    erase() {
      try { storage?.removeItem(key); } catch { /* storage blocked */ }
    },
  };
}
