// A cartridge's save memory kept in the browser: the bytes the cartridge's flash, EEPROM or SRAM would hold, in
// its storage (localStorage, as base64) under a key of the game's own. What the bytes mean is the game's: it reads
// them at power-on and writes them when the original does. Where storage is blocked or full, the game keeps its
// save in memory for as long as the page is open.

import { noteStartSave } from './session.js';

/** The browser's storage, or null where it is blocked. */
export function browserStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
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
