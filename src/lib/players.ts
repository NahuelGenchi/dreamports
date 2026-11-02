// What accounts know about the games played on dreamports.net, shared by the site and its Worker
// (worker/). docs/ACCOUNTS.md explains how a game uses them.

// The name in a game's address, /play/<name>/.
export const GAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// A game keeps achievements on players' profiles by having this file, its own list of them, an ES module exporting
// ACHIEVEMENTS: [{ id, title, description }]. Nothing else has to name the game: the site and the Worker look for it.
export const achievementsListOf = (game: string) => `/play/${game}/src/achievements/list.js`;

// Where a game keeps, in localStorage, what this device earned before anyone signed in: an id → time map. The kit's
// achievements/store.js and public/dreamports.js say the same. Sonic Advance Dreamport's came first, and players have
// it on their devices.
export const deviceKeyOf = (game: string) => (game === 'sonic-advance' ? 'onsoku.achievements' : `${game}.achievements`);

// A player's name: 3 to 20 letters, numbers, dashes and underscores. Two names that differ only in
// capitals are the same name.
export const NAME_PATTERN = /^[A-Za-z0-9_-]{3,20}$/;

// An achievement's id, as a game names it.
export const ACHIEVEMENT_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Players must be at least this old to make an account (to confirm in #16).
export const MINIMUM_AGE = 13;

// The accounts a player can sign in with, in the order the profile offers them. A profile keeps only
// each account's id there, never its email or password.
export const WAYS = {
  google: 'Google',
  discord: 'Discord',
  steam: 'Steam',
  github: 'GitHub',
} as const;
export type Way = keyof typeof WAYS;
export const isWay = (text: unknown): text is Way => typeof text === 'string' && Object.hasOwn(WAYS, text);
