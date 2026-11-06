// What a game's pieces need (docs/TEAMS.md). A game's proof/parts.json lists its parts and its foundations, what many
// parts build on but no player would call a part, such as its fighting, and each can say what it needs. A piece is
// the issue under the game's issue that goes by the same name, or for the game's version in another language, by the
// name with the language's after it, as in "Task: Title screen in C" (src/lib/languages.mjs). It's free when it's
// open, nobody has claimed it and everything it needs is finished: in a game with a JavaScript version, a piece in
// another language also needs the same piece in JavaScript, as it's written from the JavaScript. A game that started
// in C, with no JavaScript version, has its pieces in C alone, which wait on nothing in another language. The site's Make pages, find and tasks read this, and the claims workflow has its
// own short copy of it, as it runs nothing from the repository.

import { LANGUAGES, OTHER_LANGUAGES } from './languages.mjs';

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

/** The title of the task for a part, or a foundation, in `language`: "Task: Title screen", or "Task: Title screen in C". */
export const taskTitle = (name, language = 'js') => `Task: ${name}${language === 'js' ? '' : ` in ${LANGUAGES[language].name}`}`;

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
 * Which of a game's pieces nobody has claimed can start now, from its pieces, open and closed, and its parts.json. What a
 * piece needs is finished when its issue is closed, or its number is in `gathered`, as a piece in the team build's is. A
 * part with no issue is finished, in the game's `main` language (languages.mjs), once parts.json names its recording. A
 * piece in another language needs what it needs in that language, and the same piece in the main language, finished as
 * above; a need with no issue in a language other than the main one isn't. `free` has foundations first, then the pieces in
 * their order. `waiting` has each of the others, with what it's waiting `on`, each { name, number }, with no number
 * while it has no issue yet.
 * @template {{ number: number, title: string, state: string, assignees?: unknown[] }} Piece
 * @param {Piece[]} pieces
 * @param {unknown} file
 * @param {Set<number>} [gathered]
 * @param {{ main?: keyof typeof LANGUAGES }} [options]
 * @returns {{ free: Piece[], waiting: { piece: Piece, on: { name: string, number?: number }[] }[], needing: (piece: Piece) => number, isFoundation: (piece: Piece) => boolean }}
 */
export function whatCanStart(pieces, file, gathered = new Set(), { main = 'js' } = {}) {
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
  const open = pieces.filter(p => p.state === 'open' && !p.assignees?.length && !gathered.has(p.number));
  const waiting = open.flatMap(piece => {
    const { name, language } = pieceOf(piece);
    const needs = [...(language === main ? [] : [[name, main]]), ...(planned.get(nameKey(name))?.needs ?? []).map(need => [need, language])];
    const on = needs.filter(([need, lang]) => !finished(need, lang)).map(([need, lang]) => {
      const found = byName.get(keyOf(need, lang));
      return found ? { name: pieceName(found), number: found.number } : { name: lang === 'js' ? need : `${need} in ${LANGUAGES[lang].name}` };
    });
    return on.length ? [{ piece, on }] : [];
  });
  const held = new Set(waiting.map(w => w.piece));
  const free = open.filter(p => !held.has(p));
  return {
    free: [...free.filter(isFoundation), ...free.filter(p => !isFoundation(p))],
    waiting,
    /** How many of the pieces not yet finished need this one. */
    needing: piece => {
      const { name, language } = pieceOf(piece);
      return plan.filter(p => p.needs.some(need => nameKey(need) === nameKey(name)) && !finished(p.name, language)).length;
    },
    isFoundation,
  };
}
