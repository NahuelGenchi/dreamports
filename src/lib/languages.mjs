// The languages a Dreamport can be written in, and its versions in them. A game's JavaScript version is in its folder,
// games/<game>/, as it always was, and a version in another language is a page of its own in a folder named after the
// language, such as games/<game>/c/, played at /play/<game>/c/. A new game starts in C, with no JavaScript version,
// and one can be added later. It shares the game's proof/ (the copy, the
// code map, the parts and the recordings, which are the original's and the same in every language), and keeps only
// its own numbers, in its own proof/ (progress.json and port-map.json). The tools name a version by its folder, as in
// `npm run dp -- prove sonic-battle/c`, and a task for it ends with the language's name, as in "Task: Title screen in
// C" (pieces.mjs). games/README.md explains it for people.

/** Each language by its key: its name as people read it, and the folder its version is in ('' for the game's own). */
export const LANGUAGES = {
  js: { name: 'JavaScript', folder: '' },
  c: { name: 'C', folder: 'c' },
};

/**
 * The language a Dreamport is played and made in wherever it has a version in it: C. A game's card plays its C version
 * first, and the player can choose another, which it keeps; a game with no C version plays its JavaScript one.
 */
export const DEFAULT_LANGUAGE = 'c';

/** The languages a version can be in besides JavaScript, whose folders are versions of a game's. */
export const OTHER_LANGUAGES = Object.keys(LANGUAGES).filter(key => LANGUAGES[key].folder);

/**
 * A game's main version, from the languages it has a version in: its JavaScript one, when it has one, which is the
 * game's own and was there first, or else its first in another language, as a game that started in C has. A game with
 * no version yet, such as one whose first files are still in a pull request, counts as one in the default language, C,
 * as that's what a new game starts in (#1095). Its numbers are the game's first, and the others' come under them. Every
 * version is written from the original, so no task waits on the same part in another language (pieces.mjs, #965).
 * @param {(keyof typeof LANGUAGES)[]} languages
 * @returns {keyof typeof LANGUAGES}
 */
export const mainLanguage = languages => (languages.includes('js') ? 'js' : OTHER_LANGUAGES.find(key => languages.includes(key)) ?? DEFAULT_LANGUAGE);

/** A version as the tools name it, such as 'sonic-battle/c', as { game, language }; a game alone is its JavaScript one. */
export function versionOf(name) {
  const [game, folder, ...rest] = String(name).split('/');
  const language = folder === undefined ? 'js' : OTHER_LANGUAGES.find(key => LANGUAGES[key].folder === folder);
  if (!game || rest.length || !language) {
    throw new Error(`"${name}" isn't a game or a version of one: a game is named by its folder in games/, and its version in another language by the folder in it, such as sonic-battle/c.`);
  }
  return { game, language };
}

/** The name the tools give a game's version in `language`: 'sonic-battle' for JavaScript, 'sonic-battle/c' for C. */
export const versionName = (game, language) => (LANGUAGES[language].folder ? `${game}/${LANGUAGES[language].folder}` : game);

/** A version's name as people read it: 'Sonic Battle Dreamport' for JavaScript, 'Sonic Battle Dreamport in C'. */
export const versionTitle = (title, language) => (language === 'js' ? title : `${title} in ${LANGUAGES[language].name}`);

/**
 * The languages a game is played in, from those it has a version in (as ['js', 'c']), the default first and
 * JavaScript last.
 * @param {(keyof typeof LANGUAGES)[]} languages
 * @returns {(keyof typeof LANGUAGES)[]}
 */
export const playOrder = languages => [...new Set(languages.length ? languages : ['js'])].sort((a, b) => (b === DEFAULT_LANGUAGE) - (a === DEFAULT_LANGUAGE) || (a === 'js') - (b === 'js'));

/**
 * Where a version plays, from the game's play link: https://dreamports.net/play/sonic-advance/c/ for C.
 * @param {string} href
 * @param {keyof typeof LANGUAGES} language
 */
export const playHref = (href, language) => (LANGUAGES[language].folder ? new URL(`${LANGUAGES[language].folder}/`, href).href : href);

/**
 * What a play button says for a version: its own words for the one the game plays first, and with the language for
 * another, as in 'Play in JavaScript', so a choice made further down the game's page shows on the button it acts on.
 * @param {string} label
 * @param {keyof typeof LANGUAGES} language
 * @param {keyof typeof LANGUAGES} first
 */
export const playLabel = (label, language, first) => (language === first ? label : `${label} in ${LANGUAGES[language].name}`);
