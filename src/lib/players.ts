// What accounts know about the games played on dreamports.net, shared by the site and its Worker
// (worker/). docs/ACCOUNTS.md explains how a game uses them.

export interface Playable {
  // the game's file in src/content/games, whose title and page the profile shows
  entry: string;
  // the game's own list of achievements, an ES module exporting ACHIEVEMENTS: [{ id, title, description }]
  list: string;
  // where the game keeps, in localStorage, what this device earned before anyone signed in: an id → time map
  device: string;
}

// By the name in the game's address, /play/<name>/. public/dreamports.js keeps its own copy of the
// `device` keys.
export const PLAYABLE: Record<string, Playable> = {
  'sonic-advance': {
    entry: 'sonic-advance-dreamport',
    list: '/play/sonic-advance/src/achievements/list.js',
    device: 'onsoku.achievements',
  },
};

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
