// What find and team read of the claims (docs/TEAMS.md), through the GitHub CLI: the repository's open issues, where
// a New Dreamport issue claims a game for its lead and a game's tasks carry its label, each one claimed by whoever
// it's assigned to; and the lead's team build, a branch of their fork that gathers the team's finished pieces.

import { UPSTREAM, api } from './github.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The branch of the lead's fork that holds a game's team build. */
export const teamBranch = game => `team/${game}`;

/** A field of an issue form: the text under its "### <label>" heading, or null when it's empty. */
export function field(body, label) {
  const found = new RegExp(`^###\\s*${label}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^###\\s|(?![\\s\\S]))`, 'm').exec(body ?? '');
  const text = found?.[1].trim();
  return text && text !== '_No response_' ? text : null;
}

const folderIn = issue => field(issue.body, 'Game folder')?.replace(/`/g, '').trim() ?? null;
/** Whether an issue is a New Dreamport issue, which claims its game for its lead. */
export const isNewDreamport = issue => folderIn(issue) !== null && field(issue.body, 'Where it starts') !== null;

/**
 * The repository's open issues as claims: for each game claimed with a New Dreamport issue, the first one, and a
 * game's tasks, the open issues with its label. Throws when the GitHub CLI can't read them.
 */
export function readClaims(repository = UPSTREAM) {
  const issues = [];
  for (let page = 1; ; page++) {
    const batch = api(`repos/${repository}/issues?state=open&per_page=100&page=${page}`);
    if (!batch) throw new Error(`${repository} isn't on GitHub, or its issues are switched off.`);
    issues.push(...batch.filter(i => !i.pull_request));
    if (batch.length < 100) break;
  }
  issues.sort((a, b) => a.number - b.number);
  const leads = new Map();
  for (const issue of issues.filter(isNewDreamport)) {
    const game = folderIn(issue);
    if (NAME.test(game) && !leads.has(game)) leads.set(game, issue);
  }
  return {
    repository,
    /** The New Dreamport issue of each game claimed with one: Map(game → issue). */
    leads,
    /** A game's open tasks: its issues other than its New Dreamport one. */
    tasksOf: game => issues.filter(i => !isNewDreamport(i) && (i.labels.some(l => l.name === game) || folderIn(i) === game)),
    /** The game's name in its New Dreamport issue, such as Sonic Battle, or null. */
    nameOf: game => field(leads.get(game)?.body, 'Game')?.replace(/\s+Dreamport$/i, '') ?? null,
  };
}

/** A game's lead: whoever its New Dreamport issue is assigned to, or its entry's lead. null while nobody leads it. */
export function leadOf(game, claims, entry) {
  const issue = claims?.leads.get(game);
  if (issue) return issue.assignees[0]?.login ?? null;
  return entry?.lead ?? null;
}

/**
 * Where the lead's team build of a game is: { repository, branch, url }, or null while there's none. It's looked
 * for in the lead's forks of the repository, or in the one named.
 */
export function teamBuildOf(lead, game, named) {
  const branch = teamBranch(game);
  for (const repository of named ? [named] : forksOf(lead)) {
    if (api(`repos/${repository}/branches/${encodeURIComponent(branch)}`)) return { repository, branch, url: `https://github.com/${repository}/tree/${branch}` };
  }
  return null;
}

// the repositories of the network an account can hold a team build in: its forks, and the repository itself if it's theirs
function forksOf(owner) {
  const found = UPSTREAM.split('/')[0].toLowerCase() === owner.toLowerCase() ? [UPSTREAM] : [];
  for (let page = 1; ; page++) {
    const batch = api(`repos/${UPSTREAM}/forks?per_page=100&page=${page}`) ?? [];
    found.push(...batch.filter(f => f.owner.login.toLowerCase() === owner.toLowerCase()).map(f => f.full_name));
    if (batch.length < 100) return found;
  }
}
