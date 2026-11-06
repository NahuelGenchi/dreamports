// The languages a Dreamport can be written in, and its versions in them. Every Dreamport has its JavaScript version
// in its folder, games/<game>/, as it always had. A version in another language is a page of its own in a folder named
// after the language, such as games/<game>/c/, played at /play/<game>/c/. It shares the game's proof/ (the copy, the
// code map, the parts and the recordings, which are the original's and the same in every language), and keeps only
// its own numbers, in its own proof/ (progress.json and port-map.json). The tools name a version by its folder, as in
// `npm run dp -- prove sonic-battle/c`, and a task for it ends with the language's name, as in "Task: Title screen in
// C" (pieces.mjs). games/README.md explains it for people.

/** Each language by its key: its name as people read it, and the folder its version is in ('' for the game's own). */
export const LANGUAGES = {
  js: { name: 'JavaScript', folder: '' },
  c: { name: 'C', folder: 'c' },
};

/** The languages a version can be in besides JavaScript, whose folders are versions of a game's. */
export const OTHER_LANGUAGES = Object.keys(LANGUAGES).filter(key => LANGUAGES[key].folder);

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
