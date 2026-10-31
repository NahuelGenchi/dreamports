// Keeps the player's ROMs in this browser's IndexedDB so they don't have to be chosen every visit: in a database
// of the game's own, each under a key of the game's, such as its own ROM's and those of other games its extras
// read. Nothing is sent anywhere; clearing site data or "Forget" removes them.

const STORE = 'rom';

/**
 * The ROMs kept in the database named `name`: { load(key), remember(name, buffer, key), forget(key) }. `load`
 * resolves to the ROM kept under `key`, { name, buffer }, or null; `remember` keeps one and resolves to whether
 * it could; `forget` lets it go.
 */
export function createRomStore(name) {
  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(mode, action) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const request = action(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  return {
    /** @returns {Promise<{name: string, buffer: ArrayBuffer} | null>} */
    async load(key) {
      try { return (await run('readonly', s => s.get(key))) ?? null; }
      catch { return null; }   // private mode or storage disabled: just ask again
    },
    async remember(fileName, buffer, key) {
      try { await run('readwrite', s => s.put({ name: fileName, buffer }, key)); return true; }
      catch { return false; }
    },
    async forget(key) {
      try { await run('readwrite', s => s.delete(key)); } catch { /* nothing stored */ }
    },
  };
}
