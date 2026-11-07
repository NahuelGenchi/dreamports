// What a game's pieces need (docs/TEAMS.md). A game's proof/parts.json lists its parts and its foundations, what many
// parts build on but no player would call a part, such as its fighting, and each can say what it needs. A piece is
// the issue under the game's issue that goes by the same name, or for the game's version in another language, by the
// name with the language's after it, as in "Task: Title screen in C" (src/lib/languages.mjs). It's free when it's
// open, nobody has claimed it and everything it needs is finished: in a game with a JavaScript version, a piece in
// another language also needs the same piece in JavaScript, as it's written from the JavaScript. A game that started
// in C, with no JavaScript version, has its pieces in C alone, which wait on nothing in another language. A need whose
// task has an open pull request that isn't a draft is in review, and a piece can start on top of it (#714), so nobody
// waits for a review or a merge. The site's Make pages, find, tasks and the claims workflow all read this, so none keeps a copy.

import { LANGUAGES, OTHER_LANGUAGES, playOrder } from './languages.mjs';

/** A name as it's compared, whatever its capitals. */
export const nameKey = name => String(name ?? '').trim().toLowerCase();

/** A task's name: its issue's title without "Task:". */
export const pieceName = piece => String(piece.title).replace(/^Task:\s*/i, '').trim();

/** A task's part and language, from its title: "Task: Title screen in C" is { name: 'Title screen', language: 'c' }. */
export function pieceOf(piece) {
  const name = pieceName(piece);
  for (const language of OTHER_LANGUAGES) {
    const suffix = ` in ${LANGUAGES[language].name}`;
    if (name.toLowerCase().endsWith(suffix.toLowerCase()) && name.length > suffix.length) return { name: name.slice(0, -suffix.length).trim(), language };
  }
  return { name, language: 'js' };
}

// a field of an issue form: the text under its "### <label>" heading, or null when it's empty
const fieldOf = (body, label) => {
  const text = new RegExp(`^###\\s*${label}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^###\\s|(?![\\s\\S]))`, 'm').exec(body ?? '')?.[1].trim();
  return text && text !== '_No response_' ? text : null;
};

/**
 * A game's version in a language other than its main one keeps its tasks under an issue of its own, itself under the
 * game's issue, as GitHub holds at most 100 issues under one (#905): its title, as "Sonic Battle Dreamport in C", from
 * the game's, as "Sonic Battle Dreamport".
 */
export const languageIssueTitle = (title, language) => `${String(title).replace(/\s+in\s+\w+$/i, '')} in ${LANGUAGES[language].name}`;

/** The text of a version's issue, which names its game and its language, so the tools and the bot know it. */
export const languageIssueText = (game, language) => [
  '### Game folder', '', game, '',
  '### Language', '', LANGUAGES[language].name, '',
  `This issue holds the tasks of the game's version in ${LANGUAGES[language].name}, each under it as on the game's issue, as one issue holds at most 100. Its tasks are claimed on their own issues, and this one is nobody's (docs/TEAMS.md).`,
].join('\n');

/** The language of a version's issue, as 'c', or null for any other issue. */
export function languageOfIssue(issue) {
  if (!fieldOf(issue?.body, 'Game folder') || fieldOf(issue?.body, 'Done when')) return null;
  const named = fieldOf(issue.body, 'Language')?.split('\n')[0].trim().toLowerCase();
  return OTHER_LANGUAGES.find(language => LANGUAGES[language].name.toLowerCase() === named) ?? null;
}

/** The title of the task for a part, or a foundation, in `language`: "Task: Title screen", or "Task: Title screen in C". */
export const taskTitle = (name, language = 'js') => `Task: ${name}${language === 'js' ? '' : ` in ${LANGUAGES[language].name}`}`;

// GitHub's closing keywords, as in "Closes #12": a pull request with one closes that issue when it merges
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/gi;

/**
 * The tasks in review: Map(task's number → the number of the pull request that closes it), from a repository's open pull
 * requests as GitHub's API lists them, leaving out drafts, as a draft isn't finished. A pull request closes the issues
 * its text names after a closing keyword, as in "Closes #12", or "Closes owner/name#12" with `repository`'s name.
 * @param {{ number: number, draft?: boolean, state?: string, body?: string | null }[]} pulls
 * @param {string} [repository]
 * @returns {Map<number, number>}
 */
export function inReview(pulls, repository = '') {
  const found = new Map();
  for (const pull of [...(pulls ?? [])].sort((a, b) => a.number - b.number)) {
    if (pull.draft || (pull.state && pull.state !== 'open')) continue;
    for (const [, where, number] of String(pull.body ?? '').matchAll(CLOSING)) {
      if (where && where.toLowerCase() !== repository.toLowerCase()) continue;
      if (!found.has(Number(number))) found.set(Number(number), pull.number);
    }
  }
  return found;
}

/**
 * What a parts.json plans: its foundations, then its parts, each with its `needs`.
 * @returns {{ name: string, needs: string[], foundation: boolean, recording?: string, what?: string, done?: string }[]}
 */
export function planOf(file) {
  const list = (items, foundation) => (Array.isArray(items) ? items : []).map(item => ({ ...item, needs: Array.isArray(item?.needs) ? item.needs : [], foundation }));
  return [...list(file?.foundations, true), ...list(file?.parts, false)];
}

/** What's wrong with a parts.json's foundations and needs, as sentences: `at` is where the file is. */
export function needsProblems(file, at = '') {
  const problems = [];
  const where = `${at}parts.json`;
  if (file?.foundations !== undefined && !Array.isArray(file.foundations)) problems.push(`${where}'s "foundations" is a list, each with its "name".`);
  const plan = planOf(file);
  const known = new Map();
  for (const piece of plan) {
    if (typeof piece.name !== 'string' || !piece.name.trim()) {
      if (piece.foundation) problems.push(`${where} has a foundation with no "name".`);
      continue;
    }
    if (known.has(nameKey(piece.name)) && (piece.foundation || known.get(nameKey(piece.name)).foundation)) problems.push(`${where} lists ${piece.name} twice, and a foundation goes by a name of its own.`);
    if (!known.has(nameKey(piece.name))) known.set(nameKey(piece.name), piece);
  }
  for (const raw of [file?.foundations, file?.parts].flatMap(items => (Array.isArray(items) ? items : []))) {
    if (raw?.needs !== undefined && !(Array.isArray(raw.needs) && raw.needs.every(n => typeof n === 'string'))) problems.push(`${where}'s ${raw.name} has "needs" that aren't a list of names.`);
  }
  for (const piece of plan) {
    for (const need of piece.needs) {
      if (typeof need !== 'string') continue;
      if (nameKey(need) === nameKey(piece.name)) problems.push(`${where}'s ${piece.name} needs itself.`);
      else if (!known.has(nameKey(need))) problems.push(`${where}'s ${piece.name} needs ${need}, which isn't one of its foundations or parts.`);
    }
  }
  // what can never start: a piece that needs something that, one step or more on, needs it
  const state = new Map();
  const visit = (name, path) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'on the way') {
      problems.push(`${where}'s needs go round in a circle: ${[...path.slice(path.indexOf(name)), name].map(n => known.get(n).name).join(', then ')}.`);
      return;
    }
    state.set(name, 'on the way');
    for (const need of known.get(name)?.needs ?? []) if (known.has(nameKey(need))) visit(nameKey(need), [...path, name]);
    state.set(name, 'done');
  };
  for (const name of known.keys()) visit(name, []);
  return problems;
}

/**
 * Pieces in the order work should go in: the default language's first, C, then the others (playOrder in languages.mjs),
 * and in each language in the order a player meets the game's parts, as parts.json lists them. A foundation comes just
 * before the first part that needs it, directly or through other foundations, and after the foundations it needs. A foundation no part needs, and a piece parts.json doesn't list, come after the parts, in the
 * order they came in. So the next part a player would meet, and what it needs, comes first, in every language.
 * @template {{ title: string }} Piece
 * @param {Piece[]} pieces
 * @param {ReturnType<typeof planOf>} plan
 * @returns {Piece[]}
 */
export function freeOrder(pieces, plan) {
  const planned = new Map(plan.map((p, index) => [nameKey(p.name), { ...p, index }]));
  const languages = playOrder(Object.keys(LANGUAGES));
  // where each piece of the plan comes in the player's order: a part where it is, a foundation where the first part that
  // needs it is, and how many foundations deep it sits under what needs it
  const at = new Map(), depth = new Map();
  plan.filter(p => !p.foundation).forEach((part, index) => at.set(nameKey(part.name), index));
  const placing = new Set();
  const place = key => {
    const piece = planned.get(key);
    if (!piece?.foundation) return;
    if (at.has(key) || placing.has(key)) return;
    placing.add(key);
    const users = plan.filter(p => p.needs.some(need => nameKey(need) === key));
    users.forEach(user => place(nameKey(user.name)));
    const first = Math.min(...users.map(user => at.get(nameKey(user.name)) ?? Infinity));
    at.set(key, first);
    depth.set(key, Math.max(0, ...users.filter(user => user.foundation && at.get(nameKey(user.name)) === first).map(user => (depth.get(nameKey(user.name)) ?? 0) + 1)));
    placing.delete(key);
  };
  plan.forEach(p => place(nameKey(p.name)));
  const keyOf = (piece, order) => {
    const { name, language } = pieceOf(piece);
    const key = nameKey(name), known = planned.get(key);
    return [Math.max(0, languages.indexOf(language)), at.get(key) ?? Infinity, known?.foundation ? 0 : 1, -(depth.get(key) ?? 0), known?.index ?? Infinity, order];
  };
  const keys = new Map(pieces.map((piece, order) => [piece, keyOf(piece, order)]));
  const compare = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  };
  return [...pieces].sort((a, b) => compare(keys.get(a), keys.get(b)));
}

/**
 * Which of a game's pieces nobody has claimed can start now, from its pieces, open and closed, and its parts.json. What a
 * piece needs is finished when its issue is closed, or its number is in `gathered`, as a piece in the team build's is. A
 * part with no issue is finished, in the game's `main` language (languages.mjs), once parts.json names its recording. A
 * piece in another language needs what it needs in that language, and the same piece in the main language, finished as
 * above; a need with no issue in a language other than the main one isn't. A need whose task is in `reviewing`
 * (`inReview`) isn't finished, but a piece can build on it: one whose unfinished needs are all in review is free, and
 * `buildsOn` says which pull requests its branch starts from. `free` is in the order work should go in
 * (`playOrder`): the default language's first, C, and in each language in the order a player meets the parts, each
 * foundation just before the first part that needs it (`freeOrder`). `waiting` has each of the others, with what it's waiting `on`, each { name, number }, with no number
 * while it has no issue yet, and the `pull` that has it in review when one does.
 * @template {{ number: number, title: string, state: string, assignees?: unknown[] }} Piece
 * @param {Piece[]} pieces
 * @param {unknown} file
 * @param {Set<number>} [gathered]
 * @param {{ main?: keyof typeof LANGUAGES, reviewing?: Map<number, number> }} [options]
 * @returns {{ free: Piece[], waiting: { piece: Piece, on: { name: string, number?: number, pull?: number }[] }[], buildsOn: (piece: Piece) => { name: string, number: number, pull: number }[], needing: (piece: Piece) => number, isFoundation: (piece: Piece) => boolean }}
 */
export function whatCanStart(pieces, file, gathered = new Set(), { main = 'js', reviewing = new Map() } = {}) {
  const plan = planOf(file);
  const planned = new Map(plan.map(p => [nameKey(p.name), p]));
  // each piece by its part's name and its language
  const keyOf = (name, language) => `${language}:${nameKey(name)}`;
  const byName = new Map(pieces.map(p => [keyOf(pieceOf(p).name, pieceOf(p).language), p]));
  const finished = (need, language = main) => {
    const piece = byName.get(keyOf(need, language));
    if (piece) return piece.state !== 'open' || gathered.has(piece.number);
    return language === main && Boolean(planned.get(nameKey(need))?.recording);
  };
  const isFoundation = piece => planned.get(nameKey(pieceOf(piece).name))?.foundation === true;
  // a task in review is done, waiting for its review, whoever it's assigned to
  const open = pieces.filter(p => p.state === 'open' && !p.assignees?.length && !gathered.has(p.number) && !reviewing.has(p.number));
  // the task of an unfinished need that's in review, which a piece can start on top of
  const reviewed = (need, language) => {
    const piece = byName.get(keyOf(need, language));
    return piece && reviewing.has(piece.number) ? { name: pieceName(piece), number: piece.number, pull: reviewing.get(piece.number) } : null;
  };
  const stacked = new Map();
  const waiting = open.flatMap(piece => {
    const { name, language } = pieceOf(piece);
    const needs = [...(language === main ? [] : [[name, main]]), ...(planned.get(nameKey(name))?.needs ?? []).map(need => [need, language])];
    const unfinished = needs.filter(([need, lang]) => !finished(need, lang));
    const under = unfinished.map(([need, lang]) => reviewed(need, lang));
    if (unfinished.length && under.every(Boolean)) {
      stacked.set(piece, under);
      return [];
    }
    const on = unfinished.map(([need, lang], index) => {
      const found = byName.get(keyOf(need, lang));
      return under[index] ?? (found ? { name: pieceName(found), number: found.number } : { name: lang === 'js' ? need : `${need} in ${LANGUAGES[lang].name}` });
    });
    return on.length ? [{ piece, on }] : [];
  });
  const held = new Set(waiting.map(w => w.piece));
  const free = open.filter(p => !held.has(p));
  return {
    free: freeOrder(free, plan),
    waiting,
    /** The pull requests in review a free piece starts on top of, each with the task it closes: [] for one that needs none. */
    buildsOn: piece => stacked.get(piece) ?? [],
    /** How many of the pieces not yet finished need this one. */
    needing: piece => {
      const { name, language } = pieceOf(piece);
      return plan.filter(p => p.needs.some(need => nameKey(need) === nameKey(name)) && !finished(p.name, language)).length;
    },
    isFoundation,
  };
}
