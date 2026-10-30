// Dreamports accounts, for the games played on dreamports.net. A game's page under /play/<game>/ loads
// this script with <script src="/dreamports.js"></script>, calls dreamports.unlock(id) each time the
// player earns an achievement, and shows what dreamports.earned() gives as earned too. The page is on
// the same site as the player's profile, so it shares their session. docs/ACCOUNTS.md has the details.
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

  // Sends achievements to the profile. Resolves to everything the profile has for the game, as an
  // id → time map, or to null when nobody is signed in or the site couldn't be reached.
  async function send(earned) {
    if (!game || !signedIn()) return null;
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
      if (!response.ok) return null;
      const { earned: all } = await response.json();
      return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
      return null;
    }
  }

  // Saves the achievement `id` to the signed-in player's profile. Without anyone signed in it does
  // nothing. Resolves to true once it is saved, and never rejects.
  async function unlock(id) {
    if (typeof id !== 'string' || !id) return false;
    return (await send({ [id]: Date.now() })) !== null;
  }

  // As the page loads, anything this device earned that the profile missed, such as an unlock that
  // couldn't reach the site, goes to the profile too, and the answer is what the profile has.
  const keeps = !!game && Object.hasOwn(DEVICE, game);
  let kept = null;
  try {
    if (keeps) kept = JSON.parse(localStorage.getItem(DEVICE[game]) ?? 'null');
  } catch {}
  const onProfile = keeps
    ? send(kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}).then((all) => all ?? {})
    : Promise.resolve({});

  // The signed-in player's achievements for this game when the page loaded, from every device, as an
  // id → time map: {} with nobody signed in or the site out of reach. Never rejects. They belong to
  // the profile, so a game shows them but keeps them apart from what the device earned: another
  // player signing in on this device would claim the device's.
  const earned = () => onProfile.then((all) => ({ ...all }));

  globalThis.dreamports = Object.freeze({ unlock, earned });
})();
