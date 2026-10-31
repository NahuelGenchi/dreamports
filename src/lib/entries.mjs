// What a Dreamport's folder in games/ says about it, read the same way by the site, the README's table of
// Dreamports (tools/readme.mjs) and the proof tools. Each Dreamport has one entry, games/<game>/entry.md, which
// games/README.md describes, and its two numbers, code ported and gameplay proven, come only from its proof/ folder,
// which the proof tools write and docs/STANDARD.md#how-progress-is-measured explains.

/** A Dreamport's entry, in its folder in games/. */
export const ENTRY = 'entry.md';

/** The id of a Dreamport's page, which is at /dreamports/<id>/: its folder's name, then "-dreamport". */
export const pageOf = game => `${game}-dreamport`;

/** Where a Dreamport's progress map is kept in the repository, next to the README's pictures (progress-map.mjs). */
export const mapOf = game => `.github/readme/progress/${game}.svg`;

/** A GitHub account's name, as a lead or a member of a team writes it. */
export const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/** A progress thread: a discussion in the repository Dreamports are made in. */
export const THREAD = /^https:\/\/github\.com\/NahuelGenchi\/dreamports\/discussions\/[1-9][0-9]*$/;

/** A share in hundredths of a percent, as every % here is written. */
const share = (part, whole) => (whole ? Math.round(part / whole * 10000) / 100 : 0);

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
    percent: share(bytes, total),
    codeMap: { functions: functions.length, bytes: total },
    proven: { functions: ran.length, bytes },
  };
}

/**
 * The functions that count toward code ported, by their addresses in the code map: those the port map names and those
 * that ran in recorded play where every frame matched. The two numbers and the progress map (progress-map.mjs) both
 * count these, so they can't disagree.
 */
export const portedFunctions = (portMap, progress) => new Set([
  ...(portMap?.functions ?? []).map(([address]) => address),
  ...Object.values(progress?.recordings ?? {}).flatMap(r => r.functions ?? []),
]);

/**
 * What a Dreamport's proof/ folder measures, from its files, each parsed, or undefined when it's missing:
 * original.json, code-map.json, progress.json, port-map.json and parts.json, and `recordings`, each recording in
 * recordings/ by its name. Returns null without an original.json, or else:
 * - copy: the copy the proof is measured on;
 * - percent, codeMap, proven: the code that ran in recorded play where every frame matched, as prove measured it
 *   (`percent` null until there's a code map and a proven recording);
 * - ported: code ported, the functions the Dreamport's code names in its port map and those that ran in matching
 *   play, over the code map, or null without a code map;
 * - gameplay: gameplay proven, the parts of the game played from start to end with every frame matching, over every
 *   part parts.json lists, or null without it.
 * Throws, naming every problem, when the files don't agree, such as a % that isn't what the code map and the proven
 * functions make, or a port map that names a function the code map doesn't have.
 */
/**
 * @typedef {{ name: string, proven: boolean, recording: string | null, frames: [number, number] | null, difference: number | null, gap: number | null }} Part
 * @typedef {{ percent: number, proven: number, total: number, parts: Part[] }} Gameplay
 * @typedef {{ percent: number, functions: number, named: number, played: number, unmatched: number }} Ported
 * @typedef {{ copy: string, percent: number | null, recordings: number, codeMap: { functions: number, bytes: number } | null,
 *   proven: { functions: number, bytes: number } | null, ported: Ported | null, gameplay: Gameplay | null }} Proof
 * @returns {Proof | null}
 */
export function proofOf(game, { original, map, progress, portMap, parts, recordings: recorded = {} }) {
  const at = `games/${game}/proof/`;
  if (!original) {
    if (map || progress || portMap || parts) throw new Error(`${at}: it has proof files but no original.json, which names the copy they're measured on.`);
    return null;
  }
  const problems = [];
  if (map && map.original !== original.sha1) problems.push(`${at}code-map.json is for another copy than original.json names.`);
  if (progress && progress.original !== original.sha1) problems.push(`${at}progress.json is for another copy than original.json names.`);
  if (portMap && portMap.original !== original.sha1) problems.push(`${at}port-map.json is for another copy than original.json names.`);
  const recordings = Object.entries(progress?.recordings ?? {});
  /** @type {Proof} */
  const result = { copy: original.name, percent: null, recordings: recordings.length, codeMap: null, proven: null, ported: null, gameplay: null };
  const played = new Set(recordings.flatMap(([, r]) => r.functions ?? []));
  if (map) {
    const functions = map.functions.map(([address, size]) => ({ address, size }));
    const known = new Set(functions.map(f => f.address));
    const missing = (list, file) => {
      const unknown = [...list].filter(address => !known.has(address));
      if (unknown.length) problems.push(`${at}${file} counts ${unknown.length} function${unknown.length === 1 ? '' : 's'} the code map doesn't have, such as ${unknown[0]}.`);
    };
    if (progress) {
      missing(played, 'progress.json');
      const measured = measure(functions, played);
      if (progress.percent !== measured.percent
        || progress.codeMap?.functions !== measured.codeMap.functions || progress.codeMap?.bytes !== measured.codeMap.bytes
        || progress.proven?.functions !== measured.proven.functions || progress.proven?.bytes !== measured.proven.bytes) {
        problems.push(`${at}progress.json says ${progress.percent === undefined ? 'there\'s no %' : `${progress.percent}%`}, but its code map and the functions it counts make ${measured.percent}%. The % only comes from npm run dp -- prove.`);
      }
      Object.assign(result, measured);
    }
    const named = new Set((portMap?.functions ?? []).map(([address]) => address));
    missing(named, 'port-map.json');
    const ported = measure(functions, portedFunctions(portMap, progress));
    result.ported = {
      percent: ported.percent,
      functions: ported.proven.functions,
      named: named.size,
      // ran in matching play, but the code doesn't name them
      played: [...played].filter(address => !named.has(address) && known.has(address)).length,
      unmatched: portMap?.unmatched?.length ?? 0,
    };
  } else if (progress?.percent !== undefined || portMap) {
    problems.push(`${at}${portMap ? 'port-map.json' : 'progress.json'} needs a code-map.json to be measured against.`);
  }
  if (parts) result.gameplay = gameplayOf(at, parts, progress?.recordings ?? {}, recorded, problems);
  if (problems.length) throw new Error(`${game}'s proof doesn't add up:\n${problems.map(p => `- ${p}`).join('\n')}`);
  return result;
}

// gameplay proven: each part parts.json lists, proven when a measured recording plays it, from the first frame of
// it to the last, with no frame that differs and none the original has and the Dreamport lacks
/** @returns {Gameplay | null} */
function gameplayOf(at, { parts }, measured, recorded, problems) {
  if (!Array.isArray(parts) || !parts.length) {
    problems.push(`${at}parts.json needs "parts": the game's parts, each with its "name".`);
    return null;
  }
  const names = new Set();
  const list = parts.map((part, i) => {
    const where = `${at}parts.json's part ${i + 1}`;
    if (typeof part?.name !== 'string' || !part.name.trim()) problems.push(`${where} needs a "name".`);
    else if (names.has(part.name)) problems.push(`${where}, ${part.name}, is listed twice.`);
    names.add(part?.name);
    /** @type {Part} */
    const view = { name: part?.name, proven: false, recording: null, frames: null, difference: null, gap: null };
    if (part?.recording === undefined && part?.frames === undefined) return view;
    const result = measured[part.recording], recording = recorded[part.recording];
    const [from, to] = Array.isArray(part.frames) ? part.frames : [];
    if (!result || !recording) {
      problems.push(`${where} is proven by the recording ${part.recording}, which ${recording ? 'npm run dp -- prove hasn\'t measured yet' : 'isn\'t in recordings/'}.`);
      return view;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > to || to >= result.frames) {
      problems.push(`${where} needs "frames": [first, last], two frames of ${part.recording}, from 0 to ${result.frames - 1}.`);
      return view;
    }
    const difference = (result.differs ?? []).find(([a, b]) => b >= from && a <= to);
    const gap = (recording.onlyInOriginal ?? []).find(g => g.at > from && g.at <= to);
    return {
      ...view,
      recording: part.recording,
      frames: [from, to],
      difference: difference ? Math.max(difference[0], from) : null,
      gap: gap ? gap.at : null,
      proven: !difference && !gap,
    };
  });
  const proven = list.filter(p => p.proven).length;
  return { percent: share(proven, list.length), proven, total: list.length, parts: list };
}

/** A % as the site and the README write it, such as 11.19%, or null when there's none. */
export const percentText = percent => (percent === null || percent === undefined ? null : `${percent.toLocaleString('en', { maximumFractionDigits: 2 })}%`);
