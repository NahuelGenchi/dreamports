// What a Dreamport's folder in games/ says about it, read the same way by the site, the README's table of
// Dreamports (tools/readme.mjs) and the proof tools. Each Dreamport has one entry, games/<game>/entry.md, which
// games/README.md describes, and its % comes only from its proof/ folder, which `npm run dp -- prove` writes.

/** A Dreamport's entry, in its folder in games/. */
export const ENTRY = 'entry.md';

/** The id of a Dreamport's page, which is at /dreamports/<id>/: its folder's name, then "-dreamport". */
export const pageOf = game => `${game}-dreamport`;

/** A GitHub account's name, as a lead or a member of a team writes it. */
export const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** A progress thread: a discussion in the repository Dreamports are made in. */
export const THREAD = /^https:\/\/github\.com\/NahuelGenchi\/dreamports\/discussions\/[1-9][0-9]*$/;

/**
 * The % a code map makes with the functions proven in recorded play: the size of the functions proven over the
 * size of every function, in hundredths of a percent. `functions` is [{ address, size }], with each address as
 * the code map writes it, and `proven` a Set of those addresses.
 */
export function measure(functions, proven) {
  const total = functions.reduce((sum, f) => sum + f.size, 0);
  const ran = functions.filter(f => proven.has(f.address));
  const bytes = ran.reduce((sum, f) => sum + f.size, 0);
  return {
    percent: total ? Math.round(bytes / total * 10000) / 100 : 0,
    codeMap: { functions: functions.length, bytes: total },
    proven: { functions: ran.length, bytes },
  };
}

/**
 * What a Dreamport's proof/ folder measures, from its original.json, code-map.json and progress.json, each
 * parsed, or undefined when it's missing: { copy, percent, recordings, codeMap, proven }, with `percent` null
 * until there's a code map and a proven recording; or null without an original.json. Throws, naming every
 * problem, when the files don't agree, such as a % that isn't what the code map and the proven functions make.
 */
export function proofOf(game, { original, map, progress }) {
  const at = `games/${game}/proof/`;
  if (!original) {
    if (map || progress) throw new Error(`${at}: it has a code map or a % but no original.json, which names the copy they're measured on.`);
    return null;
  }
  const problems = [];
  if (map && map.original !== original.sha1) problems.push(`${at}code-map.json is for another copy than original.json names.`);
  if (progress && progress.original !== original.sha1) problems.push(`${at}progress.json is for another copy than original.json names.`);
  const recordings = Object.entries(progress?.recordings ?? {});
  const result = { copy: original.name, percent: null, recordings: recordings.length, codeMap: null, proven: null };
  if (map && progress) {
    const functions = map.functions.map(([address, size]) => ({ address, size }));
    const known = new Set(functions.map(f => f.address));
    const proven = new Set(recordings.flatMap(([, r]) => r.functions ?? []));
    const unknown = [...proven].filter(address => !known.has(address));
    if (unknown.length) problems.push(`${at}progress.json counts ${unknown.length} function${unknown.length === 1 ? '' : 's'} the code map doesn't have, such as ${unknown[0]}.`);
    const measured = measure(functions, proven);
    if (progress.percent !== measured.percent
      || progress.codeMap?.functions !== measured.codeMap.functions || progress.codeMap?.bytes !== measured.codeMap.bytes
      || progress.proven?.functions !== measured.proven.functions || progress.proven?.bytes !== measured.proven.bytes) {
      problems.push(`${at}progress.json says ${progress.percent === undefined ? 'there\'s no %' : `${progress.percent}%`}, but its code map and the functions it counts make ${measured.percent}%. The % only comes from npm run dp -- prove.`);
    }
    Object.assign(result, measured);
  } else if (progress?.percent !== undefined) {
    problems.push(`${at}progress.json has a % but there's no code-map.json to measure it against.`);
  }
  if (problems.length) throw new Error(`${game}'s proof doesn't add up:\n${problems.map(p => `- ${p}`).join('\n')}`);
  return result;
}

/** A % as the site and the README write it, such as 11.19%, or null when there's none. */
export const percentText = percent => (percent === null || percent === undefined ? null : `${percent.toLocaleString('en', { maximumFractionDigits: 2 })}%`);
