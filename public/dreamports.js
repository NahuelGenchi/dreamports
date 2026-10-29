// Dreamports accounts, for the games played on dreamports.net. A game's page under /play/<game>/ loads
// this script with <script src="/dreamports.js"></script> and calls dreamports.unlock(id) each time the
// player earns an achievement. The page is on the same site as the player's profile, so it shares
// their session. docs/ACCOUNTS.md has the details.
(() => {
  // the game, from the page's address: /play/sonic-advance/ is sonic-advance
  const game = /^\/play\/([a-z0-9-]+)\//.exec(location.pathname)?.[1] ?? null;

  // where each game keeps what this device earned, as an id → time map (src/lib/players.ts)
  const DEVICE = { 'sonic-advance': 'onsoku.achievements' };

  // the site notes the player's name while someone is signed in on this browser
  const PLAYER = 'dreamports:player';
  const signedIn = () => {
    try {
      return !!localStorage.getItem(PLAYER);
    } catch {
      return false;
    }
  };

  async function send(earned) {
    if (!game || !signedIn()) return false;
    try {
      const response = await fetch('/api/achievements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game, earned }),
        keepalive: true,
      });
      // the session ended, here or on another device
      if (response.status === 401) {
        try {
          localStorage.removeItem(PLAYER);
        } catch {}
      }
      return response.ok;
    } catch {
      return false;
    }
  }

  // Saves the achievement `id` to the signed-in player's profile. Without anyone signed in it does
  // nothing. Resolves to true once it is saved, and never rejects.
  function unlock(id) {
    if (typeof id !== 'string' || !id) return Promise.resolve(false);
    return send({ [id]: Date.now() });
  }

  // Once the page has loaded, anything this device earned that the profile missed, such as an
  // unlock that couldn't reach the site, goes to the profile too.
  if (game && DEVICE[game] && signedIn()) {
    let kept = null;
    try {
      kept = JSON.parse(localStorage.getItem(DEVICE[game]) ?? 'null');
    } catch {}
    if (kept && typeof kept === 'object' && Object.keys(kept).length) send(kept);
  }

  globalThis.dreamports = Object.freeze({ unlock });
})();
