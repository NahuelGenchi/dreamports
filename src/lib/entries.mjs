// What a Dreamport's folder in games/ says about it, read the same way by the site, the table in docs/STATUS.md of
// Dreamports (tools/readme.mjs) and the proof tools. Each Dreamport has one entry, games/<game>/entry.md, which
// games/README.md describes, and its two numbers, code ported and gameplay proven, come only from its proof/ folder,
// which the proof tools write and docs/STANDARD.md#how-progress-is-measured explains.

import { needsProblems } from './pieces.mjs';
import { kindsOf, showsProblems } from './shows.mjs';
import { reachedAt, reachesProblem } from './reaches.mjs';

/** A Dreamport's entry, in its folder in games/. */
export const ENTRY = 'entry.md';

/** The id of a Dreamport's page, which is at /dreamports/<id>/: its folder's name, then "-dreamport". */
export const pageOf = game => `${game}-dreamport`;

/** Where a Dreamport's progress map is kept in the repository, next to the README's pictures (progress-map.mjs), and
 *  a version's in another language, such as sonic-battle-c.svg for 'sonic-battle/c' (languages.mjs). */
export const mapOf = game => `.github/readme/progress/${game.replaceAll('/', '-')}.svg`;

/** A GitHub account's name, as a lead or a member of a team writes it. */
export const GITHUB_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

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

/** The functions of the original with a stop in them: a path the Dreamport's code says it hasn't ported. */
export const stoppedFunctions = portMap => new Set((portMap?.stops ?? []).map(([address]) => address).filter(Boolean));

/**
 * The functions that count toward code ported, by their addresses in the code map: those the port map names, each a
 * twin the Dreamport's code wrote, but any with a stop in it, as it isn't all written yet. A function the original only
 * ran in matching play has no twin, so it doesn't count: that's what gameplay proven measures. Until #1452 it did, and
 * Sonic Advance Dreamport in C showed 84.98% with 31.4% of its original's code written. The two numbers and the
 * progress map (progress-map.mjs) both count these, so they can't disagree.
 */
export const portedFunctions = portMap => {
  const stopped = stoppedFunctions(portMap);
  return new Set((portMap?.functions ?? []).map(([address]) => address).filter(address => !stopped.has(address)));
};

/**
 * What a Dreamport's proof/ folder measures, from its files, each parsed, or undefined when it's missing:
 * original.json, code-map.json, progress.json, port-map.json and parts.json, and `recordings`, each recording in
 * recordings/ by its name. Returns null without an original.json, or else:
 * - copy: the copy the proof is measured on;
 * - percent, codeMap, proven: the code that ran in recorded play where every frame matched, as prove measured it
 *   (`percent` null until there's a code map and a proven recording);
 * - ported: code ported, the functions the Dreamport's code names in its port map, but those with a stop in them,
 *   over the code map, or null without a code map; with it, `named`, the functions the port map names, `played`, those
 *   that ran in matching play with no code naming them, which don't count, `stops`, the paths the code says it
 *   hasn't ported, `stopped`, the functions they're in, and `unnamed`, the functions of the code map no code names
 *   yet;
 * - gameplay: gameplay proven, or null without parts.json: where prove saw the original's instructions run
 *   (progress.json's `played`), the instructions and branch ways played in matching frames over all the code map's
 *   functions have, as `units`; or else the parts played from start to end with every frame matching, over every part
 *   parts.json lists. `proven`, `total` and `parts` are the parts either way;
 * - saves, when a recording saved: { original, same, differ }, the original's writes of its save memory in the
 *   recordings, how many the Dreamport left the same, and the names of the recordings where the two differ.
 * Throws, naming every problem, when the files don't agree, such as a % that isn't what the code map and the proven
 * functions make, or a port map that names a function the code map doesn't have.
 */
/**
 * @typedef {{ name: string, proven: boolean, recording: string | null, frames: [number, number] | null, difference: number | null, gap: number | null, unreached: string | null, fromStart: boolean }} Part
 * @typedef {{ percent: number, proven: number, total: number, parts: Part[], units?: { total: number, played: number }, code?: number, content?: { total: number, read: number, percent: number } }} Gameplay
 * @typedef {{ percent: number, functions: number, named: number, played: number, unmatched: number, stops: number, stopped: number, unnamed: number }} Ported
 * @typedef {{ copy: string, percent: number | null, recordings: number, codeMap: { functions: number, bytes: number } | null,
 *   proven: { functions: number, bytes: number } | null, ported: Ported | null, gameplay: Gameplay | null }} Proof
 * @returns {Proof | null}
 */
export function proofOf(game, { original, map, progress, portMap, parts, recordings: recorded = {} }) {
  // a version in another language, such as sonic-battle/c, keeps its own progress.json and port-map.json, and shares
  // the rest with the game (src/lib/languages.mjs)
  const at = `games/${game}/proof/`, shared = `games/${game.split('/')[0]}/proof/`;
  if (!original) {
    if (map || progress || portMap || parts) throw new Error(`${shared}: it has proof files but no original.json, which names the copy they're measured on.`);
    return null;
  }
  const problems = [];
  if (map && map.original !== original.sha1) problems.push(`${shared}code-map.json is for another copy than original.json names.`);
  if (progress && progress.original !== original.sha1) problems.push(`${at}progress.json is for another copy than original.json names.`);
  if (portMap && portMap.original !== original.sha1) problems.push(`${at}port-map.json is for another copy than original.json names.`);
  const recordings = Object.entries(progress?.recordings ?? {});
  // a game's own word that no player could ever see these frames, which no match with the original makes up for
  for (const [name, { neverInPlay = [] }] of recordings) {
    for (const { from, to, why } of neverInPlay) {
      problems.push(`${shared}recordings/${name}.json plays what no player could ever see at frames ${from} to ${to}: ${why}. A start point only skips the way there (tools/README.md, Start points), so change the recording and prove it again.`);
    }
  }
  // a recording named for a character, or anything else original.json lists under `shows`, has to show it, as the
  // original's own memory said when it was proven (src/lib/shows.mjs)
  try {
    const kinds = kindsOf(original, `${shared}original.json`);
    for (const [name, { shows }] of recordings) {
      for (const problem of showsProblems(name, shows, kinds)) problems.push(`${at}progress.json: ${problem}`);
    }
  } catch (error) {
    problems.push(/** @type {Error} */ (error).message);
  }
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
    const stopped = stoppedFunctions(portMap);
    missing(stopped, 'port-map.json');
    const ported = measure(functions, portedFunctions(portMap));
    result.ported = {
      percent: ported.percent,
      functions: ported.proven.functions,
      named: named.size,
      // ran in matching play, but the code doesn't name them, so they have no twin and don't count
      played: [...played].filter(address => !named.has(address) && known.has(address)).length,
      unmatched: portMap?.unmatched?.length ?? 0,
      stops: portMap?.stops?.length ?? 0,
      stopped: stopped.size,
      unnamed: functions.filter(f => !named.has(f.address)).length,
    };
  } else if (progress?.percent !== undefined || portMap) {
    problems.push(`${at}${portMap ? 'port-map.json' : 'progress.json'} needs a ${shared}code-map.json to be measured against.`);
  }
  if (parts) result.gameplay = gameplayOf(shared, parts, progress?.recordings ?? {}, recorded, problems, at !== shared);
  // where the tools see the original's instructions run, gameplay proven is the share of its code played in matching
  // frames, every instruction and each way of every branch, and the parts are what a player would call them
  if (result.gameplay && progress?.played) {
    const { total, played, percent } = progress.played;
    if (!Number.isInteger(total) || !Number.isInteger(played) || played > total || percent !== playedPercent(played, total)) {
      problems.push(`${at}progress.json's "played" doesn't add up. It only comes from npm run dp -- prove.`);
    }
    Object.assign(result.gameplay, { percent, units: { total, played } });
    // and of its data used in matching frames, in cells of the cartridge: the lower of the two is the number, so
    // neither the code nor the content can pass for the other
    if (progress.content) {
      const { total: cells, read, percent: ofContent } = progress.content;
      if (!Number.isInteger(cells) || !Number.isInteger(read) || read > cells || ofContent !== playedPercent(read, cells)) {
        problems.push(`${at}progress.json's "content" doesn't add up. It only comes from npm run dp -- prove.`);
      }
      Object.assign(result.gameplay, { percent: Math.min(percent, ofContent), code: percent, content: { total: cells, read, percent: ofContent } });
    }
  }
  // what the recordings saved next to the original: the original's writes of its save memory, how many the Dreamport
  // left the same, and the recordings where they differ, or where the Dreamport wrote one the original didn't
  const saving = recordings.filter(([, r]) => r.saves);
  if (saving.length) {
    result.saves = {
      original: saving.reduce((sum, [, r]) => sum + r.saves.original, 0),
      same: saving.reduce((sum, [, r]) => sum + r.saves.same, 0),
      differ: saving.filter(([, r]) => r.saves.same < Math.max(r.saves.original, r.saves.dreamport)).map(([name]) => name),
    };
  }
  if (problems.length) throw new Error(`${game}'s proof doesn't add up:\n${problems.map(p => `- ${p}`).join('\n')}`);
  return result;
}

/**
 * Whether a recording reaches a frame through a start point (tools/README.md): the Dreamport's address opens it there, or
 * the original was given values in its memory on the way. It's compared as any other frame, but it might not be how a
 * player gets there, so a part proven this way is proven again from power-on once the game reaches it.
 */
export const fromStartPoint = (recording, frame) => Boolean(recording.start) || (recording.sets ?? []).some(s => s.frame <= frame)
  || (recording.onlyInOriginal ?? []).some(g => g.sets?.length && g.at <= frame);

// gameplay proven: each part parts.json lists, proven when a measured recording plays it, from the first frame of
// it to the last, with no frame that differs and none the original has and the Dreamport lacks
// A part that names what it reaches also needs the original to get there within those frames (reaches.mjs)
/** @returns {Gameplay | null} */
function gameplayOf(at, file, measured, recorded, problems, version = false) {
  const { parts } = file;
  if (!Array.isArray(parts) || !parts.length) {
    problems.push(`${at}parts.json needs "parts": the game's parts, each with its "name".`);
    return null;
  }
  problems.push(...needsProblems(file, at));
  const names = new Set();
  const list = parts.map((part, i) => {
    const where = `${at}parts.json's part ${i + 1}`;
    if (typeof part?.name !== 'string' || !part.name.trim()) problems.push(`${where} needs a "name".`);
    else if (names.has(part.name)) problems.push(`${where}, ${part.name}, is listed twice.`);
    names.add(part?.name);
    /** @type {Part} */
    const view = { name: part?.name, proven: false, recording: null, frames: null, difference: null, gap: null, unreached: null, fromStart: false };
    if (part?.recording === undefined && part?.frames === undefined) {
      // a part nothing plays yet can already say what it will have to reach
      const problem = part?.reaches === undefined ? null : reachesProblem(part.reaches, null, '', where);
      if (problem) problems.push(problem);
      return view;
    }
    const result = measured[part.recording], recording = recorded[part.recording];
    const [from, to] = Array.isArray(part.frames) ? part.frames : [];
    // a version in another language starts with none of the game's recordings measured, each a part not proven yet
    if (version && recording && !result) return view;
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
    // what the part says it reaches, which the original has to get to within these frames
    let unreached = null;
    if (part.reaches !== undefined) {
      const problem = reachesProblem(part.reaches, result, part.recording, where);
      if (problem) problems.push(problem);
      else if (reachedAt(result.reached[part.reaches], [from, to]) === null) unreached = part.reaches;
    }
    return {
      ...view,
      recording: part.recording,
      frames: [from, to],
      difference: difference ? Math.max(difference[0], from) : null,
      gap: gap ? gap.at : null,
      unreached,
      proven: !difference && !gap && !unreached,
      fromStart: fromStartPoint(recording, from),
    };
  });
  const proven = list.filter(p => p.proven).length;
  return { percent: share(proven, list.length), proven, total: list.length, parts: list };
}

/** Gameplay proven from what was played: never 100% until every instruction and every way of every branch is. */
export const playedPercent = (played, total) => (total ? Math.floor(played / total * 10000) / 100 : 0);

/**
 * Gameplay proven in words, after its %: the share of the original's code played in matching frames with the parts
 * played through, or, where the tools don't see instructions run, the parts alone.
 * @param {Gameplay} gameplay
 */
export const gameplayText = gameplay => (gameplay.units
  ? `${percentText(gameplay.percent)}, ${gameplay.content ? `the lower of its code, ${percentText(gameplay.code)}, ` : ''}${gameplay.units.played.toLocaleString('en')} of ${gameplay.units.total.toLocaleString('en')} instructions and branch ways played, ${gameplay.content ? `and its content, ${percentText(gameplay.content.percent)}, ${gameplay.content.read.toLocaleString('en')} of ${gameplay.content.total.toLocaleString('en')} cells of data used, with` : 'and'} ${gameplay.proven} of ${gameplay.total} parts played through`
  : `${percentText(gameplay.percent)}, ${gameplay.proven} of ${gameplay.total} parts`);

/** A % as the site and the README write it, such as 11.19%, or null when there's none. */
export const percentText = percent => (percent === null || percent === undefined ? null : `${percent.toLocaleString('en', { maximumFractionDigits: 2 })}%`);

/**
 * A % as short as a card shows it: whole, such as 38%, but never 0% or 100% unless it's exactly that, so a little
 * progress still shows and nearly done isn't done. The README and the proof files keep it to two decimals.
 * @param {number | null | undefined} percent
 */
export function shortPercent(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent > 0 && percent < 1) return '<1%';
  if (percent > 99 && percent < 100) return '99%';
  return `${Math.round(percent)}%`;
}

/**
 * A Dreamport's two numbers as text, such as "Code ported 38% · Gameplay proven 3%", for its place in the Make row.
 * @param {Proof | null | undefined} proof
 */
export const numbersText = proof => [
  `Code ported ${shortPercent(proof?.ported?.percent) ?? 'not measured yet'}`,
  `Gameplay proven ${shortPercent(proof?.gameplay?.percent) ?? 'not measured yet'}`,
].join(' · ');

/**
 * Whether a Dreamport has code of the original's, and so its place in the Dreamports row and its own page: what
 * `npm run dp -- new` writes names none and only shows a blue screen.
 * @param {Proof | null | undefined} proof
 */
export const hasCode = proof => (proof?.ported?.percent ?? 0) > 0;

/**
 * What still keeps a Dreamport from done, as a list of plain sentences, none when it's done: it's the same game as its
 * original only once all its code is ported and all of it proven, with no stop left, every function named and every
 * save as the original's (docs/STANDARD.md#done).
 * @param {Proof | null | undefined} proof
 * @returns {string[]}
 */
export function leftToDo(proof) {
  const left = [], plural = (n, word) => `${n.toLocaleString('en')} ${word}${n === 1 ? '' : 's'}`;
  if (proof?.ported?.percent !== 100) left.push(`code ported is ${percentText(proof?.ported?.percent) ?? 'not measured yet'}`);
  if (proof?.gameplay?.percent !== 100) left.push(`gameplay proven is ${percentText(proof?.gameplay?.percent) ?? 'not measured yet'}`);
  if (proof?.ported?.stops) left.push(`${plural(proof.ported.stops, 'stop')} in its code`);
  if (proof?.ported?.unnamed) left.push(`${plural(proof.ported.unnamed, 'function')} of the original no code names`);
  if (proof?.saves?.differ.length) left.push(`its saves differ from the original's in ${plural(proof.saves.differ.length, 'recording')}`);
  return left;
}

/**
 * Whether a Dreamport has a place in the Make row: once its entry has a real capture for its card, until it's done,
 * with nothing left to do (leftToDo). Until 16 November 2026 that was every part proven, which Sonic Advance Dreamport
 * in C reached with paths of its original never played (#1345).
 * @param {{ screen?: unknown }} entry
 * @param {Proof | null | undefined} proof
 */
export const isBeingMade = (entry, proof) => !!entry.screen && leftToDo(proof).length > 0;
