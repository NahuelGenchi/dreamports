// A cartridge's save memory kept in the browser: the bytes the cartridge's flash, EEPROM or SRAM would hold, in
// its storage (localStorage, as base64) under a key of the game's own. What the bytes mean is the game's: it reads
// them at power-on and writes them when the original does. Where storage is blocked or full, the game keeps its
// save in memory for as long as the page is open.

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
  return {
    read() {
      try {
        const text = storage?.getItem(key);
        return text ? Uint8Array.from(atob(text), c => c.charCodeAt(0)) : null;
      } catch {
        return null;   // storage blocked, or not what this keeps
      }
    },
    write(bytes) {
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
