// Which of a game's tasks someone takes next, as `npm run dp -- find <game> --take` says it and /dreamport does it
// (tools/commands/dreamport.md). The rules live here, in code that can be tested, so nobody reads them again on every
// request or follows them a little differently each time.

import { LANGUAGES } from '../../src/lib/languages.mjs';
import { nameKey, pieceName, pieceOf } from '../../src/lib/pieces.mjs';

// a piece's name as it's looked for: its words, without the small ones nobody means
const wordsOf = text => nameKey(text).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(word => word && !['the', 'a', 'an', 'task'].includes(word));

/**
 * The open piece someone means by `named`: its number, as in "#742" or "742", or words of its name, as in
 * "the options", in `language` first and then in any. null when none goes by it.
 */
export function pieceNamed(pieces, named, language) {
  const open = pieces.filter(piece => piece.state === 'open');
  const number = /^#?(\d+)$/.exec(String(named).trim())?.[1];
  if (number) return open.find(piece => piece.number === Number(number)) ?? null;
  const wanted = wordsOf(named);
  if (!wanted.length) return null;
  const said = wanted.join(' ');
  // its whole name first, then every word of it, each in the language asked for before any other
  const whole = piece => wordsOf(pieceOf(piece).name).join(' ') === said || wordsOf(pieceName(piece)).join(' ') === said;
  const every = piece => wanted.every(word => wordsOf(pieceName(piece)).includes(word));
  const inLanguage = piece => pieceOf(piece).language === language;
  for (const fits of [whole, every]) {
    const found = open.filter(fits);
    if (found.length) return found.find(inLanguage) ?? found[0];
  }
  return null;
}

/**
 * What someone signed in as `login` takes next of a game's `pieces`, open and closed, with `free`, `waiting` and
 * `reviewing` as src/lib/pieces.mjs has them, in `language`, which they `languageNamed` or which is the default, and
 * with the piece they `named`, if any. `has(language)` says whether the game has a version in it, and
 * `missing(language)` how many of its parts have no task there yet, which `tasks` would open.
 *
 * Returns { do, piece?, language?, notes }: 'carry-on' with a piece that's theirs already, 'take' a free one,
 * 'start-version' when the game has none in `language`, 'open-tasks' when its parts there have no tasks yet, or
 * 'stop' when nothing can be taken. `notes` are sentences on anything that didn't go as asked.
 */
export function whatToTake({ pieces, free, waiting, reviewing, login, language, languageNamed = false, named = null, has, missing }) {
  const open = pieces.filter(piece => piece.state === 'open');
  const called = piece => `#${piece.number} ${pieceName(piece)}`;
  // theirs, unless a pull request that isn't a draft has it in review, as that one is finished
  const theirs = piece => Boolean(login) && (piece.assignees ?? []).some(person => person.login?.toLowerCase() === login.toLowerCase()) && !reviewing.has(piece.number);
  const notes = [];

  // the piece they named comes first: theirs to carry on with, free to take, or waiting on something free
  if (named) {
    const piece = pieceNamed(open, named, language);
    if (!piece) notes.push(`No open task goes by "${named}".`);
    else if (theirs(piece)) return { do: 'carry-on', piece, notes };
    else if (free.includes(piece)) return { do: 'take', piece, notes };
    else {
      const held = waiting.find(wait => wait.piece === piece);
      const need = held?.on.map(on => free.find(other => other.number === on.number)).find(Boolean);
      if (need) return { do: 'take', piece: need, notes: [`${called(piece)} waits on it.`] };
      notes.push(held ? `${called(piece)} waits on ${held.on.map(on => (on.number ? `#${on.number} ${on.name}` : on.name)).join(' and ')}, and none of that is free.`
        : reviewing.has(piece.number) ? `${called(piece)} is in review in #${reviewing.get(piece.number)}.`
          : `${called(piece)} is @${(piece.assignees ?? []).map(person => person.login).join(', @') || 'someone'}'s.`);
    }
  }

  // one they have already, in the language asked for before any other
  const own = open.filter(theirs);
  if (own.length) return { do: 'carry-on', piece: own.find(piece => pieceOf(piece).language === language) ?? own[0], notes };

  // the first free one, as free comes in the order a player meets the game
  const freeIn = wanted => free.filter(piece => pieceOf(piece).language === wanted);
  if (freeIn(language).length) return { do: 'take', piece: freeIn(language)[0], notes };
  if (!has(language)) return { do: 'start-version', language, notes };
  if (missing(language) > 0) return { do: 'open-tasks', language, notes };
  // nothing in the default language, so the first in JavaScript, unless they asked for the language by name
  if (language !== 'js' && !languageNamed && freeIn('js').length) {
    return { do: 'take', piece: freeIn('js')[0], notes: [...notes, `Nothing is free in ${LANGUAGES[language].name}, so this one is in JavaScript.`] };
  }
  return { do: 'stop', notes };
}
