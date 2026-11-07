// Who or what a recording shows, as the original's own memory says, so a recording can't be named for one character
// and play another. A game's proof/original.json lists, under `shows`, what its recordings can be named for, each kind
// with where the original keeps it and the name of each value, checked once against the original's pictures:
//
//   "shows": { "fighter": { "address": "03001634", "bytes": 1, "names": { "0": "Sonic", "3": "Shadow" } } }
//
// `prove` reads each kind from the original's work RAM at a recording's last frame and keeps the name in
// progress.json, and a recording whose name names one of a kind's names has to show it: `shadow-moving` must play
// Shadow. `prove`, `npm run check` and the build all stop on one that doesn't (tools/README.md, What a recording shows).

/** How a name is written in a recording's name: its words in small letters, joined by hyphens, as "Neo Green Hill" is
 *  neo-green-hill. */
export const slugOf = name => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The kinds a game's original.json lists under `shows`, each { kind, address, bytes, names }, with `address` a number
 * and `names` a Map from each value to its name. Throws, naming every problem, when the list isn't written as it must be.
 * @param {{ shows?: unknown }} original
 * @param {string} where the file, for the messages
 * @returns {{ kind: string, address: number, bytes: number, names: Map<number, string> }[]}
 */
export function kindsOf(original, where = 'original.json') {
  const shows = original.shows;
  if (shows === undefined) return [];
  if (!shows || typeof shows !== 'object' || Array.isArray(shows)) throw new Error(`${where}: "shows" lists kinds, such as { "fighter": { "address": "03001634", "bytes": 1, "names": { "0": "Sonic" } } }.`);
  const problems = [], kinds = [];
  for (const [kind, entry] of Object.entries(shows)) {
    const { address, bytes, names } = /** @type {any} */ (entry ?? {});
    if (!/^[a-z][a-z ]*$/.test(kind)) problems.push(`"${kind}" is a kind, written in small letters, such as "fighter".`);
    if (typeof address !== 'string' || !/^[0-9A-Fa-f]{1,8}$/.test(address)) problems.push(`${kind}'s "address" is the work RAM's, in hexadecimal, such as "03001634".`);
    if (![1, 2, 4].includes(bytes)) problems.push(`${kind}'s "bytes" is 1, 2 or 4.`);
    if (!names || typeof names !== 'object' || Array.isArray(names) || !Object.keys(names).length) {
      problems.push(`${kind}'s "names" gives each value its name, such as { "0": "Sonic" }.`);
      continue;
    }
    const map = new Map(), slugs = new Map();
    for (const [value, name] of Object.entries(names)) {
      if (!/^\d+$/.test(value) || typeof name !== 'string' || !slugOf(name)) {
        problems.push(`${kind}'s names are values with a name each, such as "0": "Sonic", and "${value}" isn't.`);
        continue;
      }
      const slug = slugOf(name);
      if (slugs.has(slug)) problems.push(`${kind} names ${slugs.get(slug)} and ${value} both ${name}, so a recording's name couldn't tell them apart.`);
      slugs.set(slug, value);
      map.set(Number(value), name);
    }
    kinds.push({ kind, address: parseInt(address, 16), bytes, names: map });
  }
  if (problems.length) throw new Error(`${where}: ${problems.join(' ')}`);
  return kinds;
}

/** The names of a kind that a recording's name names, as whole words: `amy-x-zone` names Amy, and `dreamy` doesn't. */
export function namedIn(recording, kind) {
  const words = `-${recording.toLowerCase()}-`;
  return [...kind.names.values()].filter(name => words.includes(`-${slugOf(name)}-`));
}

/** What a recording shows of each kind, from the values the original held, as progress.json keeps it: the name, or
 *  the number when original.json gives that value no name. */
export const shownOf = (kinds, values) => Object.fromEntries(kinds.map((kind, i) => [kind.kind, kind.names.get(values[i]) ?? values[i]]));

/**
 * What's wrong with what a recording shows, as sentences: for each kind its name names, whether the original showed
 * one of those, from `shown` as progress.json keeps it, or undefined when it hasn't been proven since the game listed
 * the kind.
 * @param {string} recording
 * @param {Record<string, string | number> | undefined} shown
 * @param {ReturnType<typeof kindsOf>} kinds
 */
export function showsProblems(recording, shown, kinds) {
  const problems = [];
  for (const kind of kinds) {
    const named = namedIn(recording, kind);
    if (!named.length) continue;
    const said = named.join(' or ');
    if (shown?.[kind.kind] === undefined) {
      problems.push(`${recording} is named for ${said}, and hasn't been proven since original.json listed the ${kind.kind}, so nothing has checked it shows ${named.length > 1 ? 'one of them' : said}: prove it again.`);
    } else if (!named.includes(/** @type {string} */ (shown[kind.kind]))) {
      const value = shown[kind.kind];
      problems.push(`${recording} is named for ${said}, but the original's ${kind.kind} is ${typeof value === 'number' ? `${value}, which original.json gives no name` : value} as it ends. Give it the start point and presses that pick ${said}, or a name for what it shows.`);
    }
  }
  return problems;
}
