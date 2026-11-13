// What a clip of the original next to a Dreamport has to be before a pull request shows it (docs/STANDARD.md#clips):
// five seconds or more of what the step changed, every frame matching the original's, a picture that moves, and made
// from a recording that's committed as it was proven. `prove` measures each clip into its report.json, `share` refuses one
// that breaks a rule and publishes the measures beside it, and the pull request's check reads them again
// (tools/clips-check.mjs). A recording's own "clip" is held to the length as it's read (lib/recording.mjs).

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { REPO } from './paths.mjs';

/** The shortest clip, in frames: five seconds on every console the tools know, which run at about 60 a second. */
export const CLIP_FRAMES = 300;

/** How far before the first frame a step changed its clip starts by itself, so it shows where that comes from. */
export const CLIP_LEAD = 60;

/** How many of a clip's frames at least show what the step changed: half of the shortest. */
export const NEW_FRAMES = CLIP_FRAMES / 2;

/** The SHA-1 of a recording's file, which ties a clip to the recording as it was when proven. */
export const recordingHash = text => createHash('sha1').update(text).digest('hex');

const git = args => {
  const run = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 28 });
  return run.status === 0 ? run.stdout : null;
};

/** The commit this branch started from on main, upstream's when there's a fork, or null when this folder has none. */
export function mainBase() {
  const remotes = (git(['remote']) ?? '').split('\n').filter(Boolean);
  const ref = ['upstream', 'origin'].filter(r => remotes.includes(r)).map(r => `refs/remotes/${r}/main`).find(r => git(['rev-parse', '-q', '--verify', r]) !== null)
    ?? (git(['rev-parse', '-q', '--verify', 'refs/heads/main']) !== null ? 'refs/heads/main' : null);
  return (ref && git(['merge-base', 'HEAD', ref])?.trim()) || null;
}

/**
 * The commit this branch started from on main, and what main's proof of the game's version held there: { base,
 * recordings, proven, parts, files }, with `recordings` null when main has no proof of it yet, or null when this folder
 * has no main to read. `proven` is every function main's proof counts, as the code map writes their addresses, `parts`
 * the game's parts as main's parts.json lists them (every version shares it), and `files` reads a recording's file as
 * main has it. Nothing is fetched: it's the main the branch was made from.
 * @param {string} game such as sonic-advance or sonic-battle/c
 */
export function mainProof(game) {
  const base = mainBase();
  if (!base) return null;
  const file = path => git(['show', `${base}:${path}`]);
  let progress = null;
  try {
    progress = JSON.parse(file(`games/${game}/proof/progress.json`) ?? 'null');
  } catch { /* main's is broken, so it proves nothing */ }
  const recordings = progress?.recordings ?? null;
  let parts = [];
  try {
    parts = JSON.parse(file(`games/${game.split('/')[0]}/proof/parts.json`) ?? '{}').parts ?? [];
  } catch { /* main's is broken, so it names no part */ }
  return { base, recordings, proven: new Set(Object.values(recordings ?? {}).flatMap(r => r.functions ?? [])), parts, files: file };
}

/**
 * Whether main proved `part`, of the recording `name`: its parts.json named that recording and those frames for it,
 * and main's proof of the recording ran past them with none of them differing.
 */
function mainProved(main, name, { name: part, frames: [a, b] }) {
  const named = (main.parts ?? []).some(p => p.name === part && p.recording === name && p.frames?.[0] === a && p.frames?.[1] === b);
  const was = main.recordings?.[name];
  return named && !!was && was.frames > b && !(was.differs ?? []).some(([x, y]) => x <= b && y >= a);
}

/** Where a step's change starts in a recording, as prove prints it. */
export function changedText(changed) {
  if (!changed) return 'nothing main didn\'t prove';
  return `from frame ${changed.frame}, ${changed.why}${changed.heard ? ', a change that\'s only heard, which a clip has no sound to show' : ''}`;
}

/**
 * The first frame of a recording that this step changed, or null when it changed nothing main's proof of it shows.
 * When main proved the same recording, that's the first frame that matches now and didn't on main, or the other way
 * round, and whose change can be seen: a frame where only the sound differed, on main or now, comes first only when
 * no frame's picture changed, and is then marked `heard`, as a clip has no sound to show it (#1194). A recording main
 * didn't prove as it is now starts being new where its original first runs code main's proof doesn't count, or at its
 * first frame when no code map says which code runs or none of it is new. `main` is mainProof's, `text` the
 * recording's file as it is now, at `file` in the repository, `ran(frame)` the addresses of the functions the original
 * ran in each of its frames, or null with no code map, and `differs` the stretches that differ now, or null when they
 * aren't known yet, which takes what main differed in as the guess. `sound` is the stretches whose sound differs now
 * and `picture` those whose picture does. `parts` are the game's parts that name this recording now, as parts.json
 * lists them: one main didn't prove is what the step is about from its first frame, whatever code ran before or in it,
 * as a part's code can be counted already by other recordings (#1258).
 * @returns {{ frame: number, why: string, heard?: true } | null}
 */
export function firstChanged({ main, name, file, text, frames, ran = null, differs = null, sound = null, picture = null, parts = [] }) {
  if (!main) return { frame: 0, why: 'as this folder has no main to compare with' };
  if (!main.recordings) return { frame: 0, why: 'as main has no proof of this version yet' };
  const changed = changedOnly({ main, name, file, text, frames, ran, differs, sound, picture });
  // the first part this step proves that main didn't: the clip shows it, unless something that can be seen changed sooner.
  // Once the Dreamport has played, a part counts only when its frames match now
  const matches = ([a, b]) => !differs || !differs.some(([x, y]) => x <= b && y >= a);
  const fresh = parts.filter(part => Array.isArray(part.frames) && part.frames[0] < frames && matches(part.frames) && !mainProved(main, name, part))
    .sort((x, y) => x.frames[0] - y.frames[0])[0];
  if (fresh && (!changed || changed.heard || fresh.frames[0] < changed.frame)) {
    return { frame: fresh.frames[0], why: `where ${fresh.name} starts, a part main didn't prove` };
  }
  return changed;
}

// firstChanged, by what the frames and the code say alone
function changedOnly({ main, name, file, text, frames, ran, differs, sound, picture }) {
  const was = main.recordings[name];
  // the frames main proved are these frames only when main's recording is this one
  if (was && main.files(file) === String(text)) {
    const before = inStretches(was.differs, frames);
    // main's proof keeps the frames whose sound differed and not whether their picture did too, so such a frame counts
    // as only heard. A change that can be seen comes in stretches, whose other frames say so
    const heardBefore = inStretches(was.soundDiffers, frames);
    if (!differs) {
      const seen = before.findIndex((differed, frame) => differed && !heardBefore[frame]);
      const first = seen >= 0 ? seen : before.indexOf(true);
      return first >= 0 ? { frame: first, why: 'the first that differed on main', ...(seen < 0 ? { heard: true } : {}) } : null;
    }
    const now = inStretches(differs, frames), heardNow = inStretches(sound, frames), seenNow = picture ? inStretches(picture, frames) : null;
    let heard = null;
    for (let frame = 0; frame < frames; frame++) {
      if (before[frame] === now[frame]) continue;
      const onlyHeard = before[frame] ? heardBefore[frame] : heardNow[frame] && !seenNow?.[frame];
      if (!onlyHeard) return { frame, why: before[frame] ? 'the first that differed on main and matches now' : 'the first that matched on main and differs now' };
      heard ??= { frame, why: before[frame] ? 'the first whose sound differed on main and matches now' : 'the first whose sound matched on main and differs now', heard: true };
    }
    return heard;
  }
  if (ran) {
    for (let frame = 0; frame < frames; frame++) {
      const fresh = (ran(frame) ?? []).find(address => !main.proven.has(address));
      if (fresh) return { frame, why: `where the original first runs code main's proof doesn't count, at ${fresh}` };
    }
    return { frame: 0, why: 'as main didn\'t prove this recording as it is, though it proves all the code it runs' };
  }
  return { frame: 0, why: 'as main didn\'t prove this recording as it is, and no code map says which of its code is new' };
}

/**
 * Of a step's clips, those a pull request shows: every one, but those of a change that's only heard when another shows
 * a change that can be seen, as a clip has no sound and the other is what the step is about (#1194). A step that
 * changes sound only keeps its clips. `changedOf(clip)` is what prove measured as changed. { shown, heard }
 */
export function clipsToShow(clips, changedOf) {
  const heard = clips.filter(clip => changedOf(clip)?.heard === true);
  return heard.length < clips.length ? { shown: clips.filter(clip => !heard.includes(clip)), heard } : { shown: clips, heard: [] };
}

// which frames a list of stretches, [[first, last], …], holds, as true or false for each of a recording's
function inStretches(stretches, frames) {
  const out = new Array(frames).fill(false);
  for (const [a, b] of stretches ?? []) for (let f = Math.max(0, a); f <= Math.min(b, frames - 1); f++) out[f] = true;
  return out;
}

/** How many of a clip's frames come at or after the first frame a step changed. */
export const newFramesIn = (clipFrames, changed) => (changed ? clipFrames.filter(f => f >= changed.frame).length : 0);

/**
 * The frames prove's clip shows by itself when the recording names none: five seconds from a second before the first
 * frame the step changed, ending before the first frame that differs, as every frame of a clip matches (#1039), or
 * around the first that differs when that comes before what the step changed, or else the last five seconds.
 * [first, last], inside the recording.
 */
export function clipWindow({ frames, changed, firstDifference }) {
  if (changed && !(firstDifference >= 0 && firstDifference < changed.frame)) {
    let first = Math.max(0, changed.frame - CLIP_LEAD);
    if (firstDifference >= 0) first = Math.min(first, firstDifference - CLIP_FRAMES);
    // a recording that ends sooner than that still shows five seconds, and the rule says what it's missing
    first = Math.max(0, Math.min(first, frames - CLIP_FRAMES));
    return [first, Math.min(frames - 1, first + CLIP_FRAMES - 1)];
  }
  if (firstDifference >= 0) return [Math.max(0, firstDifference - (CLIP_FRAMES - CLIP_LEAD)), Math.min(frames - 1, firstDifference + CLIP_LEAD - 1)];
  return [Math.max(0, frames - CLIP_FRAMES), frames - 1];
}

/**
 * Why a clip prove made can't go in a pull request, as sentences, or none when it can. `report` is the report.json
 * prove wrote beside it, or null; `committed` is the recording's file in the commit being shared, or null when it
 * isn't there. The Dreamport's clip on its own, not `sideBySide`, has no original to be in another place from.
 * `base`, when given, is the commit the branch starts from on main now, which prove's has to be.
 * @param {any} report
 * @param {Buffer | string | null} committed
 * @param {{ sideBySide?: boolean, base?: string | null }} [options]
 * @returns {string[]}
 */
export function clipProblems(report, committed, { sideBySide = true, base } = {}) {
  const stale = staleness(report, committed, { base });
  if (stale) return [stale];
  const clip = report.clip, name = report.recording;
  const problems = [];
  if (clip.changed === null) {
    problems.push(`${name} shows nothing this step changed: main played every frame of it the same, and its original runs no code main's proof doesn't count. `
      + 'Its clip would show what main already does, so share the clip of a recording that shows the change, or make one that does.');
  } else {
    if (clip.frames < CLIP_FRAMES) {
      problems.push(`The clip of ${name} is ${clip.frames} frames, ${clip.seconds.toFixed(2)} seconds, and a clip lasts at least ${CLIP_FRAMES} frames, five seconds. `
        + `The recording runs on, in the place it proves, until frame ${clip.changed.frame + NEW_FRAMES} at least.`);
    }
    // the way there, such as a menu before the act a step is about, says nothing about the step: at least half the clip
    // shows what it changed
    const shown = clip.newFrames ?? 0;
    if (clip.frames >= CLIP_FRAMES && shown * 2 < clip.frames) {
      problems.push(`Only ${shown} of the clip's ${clip.frames} frames come from frame ${clip.changed.frame} on, ${clip.changed.why}, so the clip shows mostly the way there, not what this step changed. `
        + `The recording runs on, in the place it proves, until frame ${clip.changed.frame + Math.ceil(clip.frames / 2)} at least, and its "clip", if it has one, starts no earlier than frame ${Math.max(0, clip.changed.frame - Math.floor(clip.frames / 2))}.`);
    }
  }
  // a picture with nothing on it, or one that never moves, says nothing about the Dreamport either
  if (clip.oneColour * 4 > clip.frames) {
    problems.push(`The Dreamport's picture is one colour in ${clip.oneColour} of the clip's ${clip.frames} frames, as between screens. A clip shows the game in the place it proves.`);
  }
  if (clip.same * 10 > clip.frames * 9) {
    problems.push(`The Dreamport's picture is the same as the frame before in ${clip.same} of the clip's ${clip.frames} frames, so it's a still picture. A clip shows something happening: presses, or the game moving by itself.`);
  }
  // a frame that differs from the original's, in picture or sound, shows a step that isn't done, whichever video it's
  // in: the Dreamport's on its own hides it, and doesn't change it (#1039)
  if (clip.changed !== null && clip.differing > 0) {
    problems.push(`${clip.differing} of the clip's ${clip.frames} frames differ from the original's, in picture or sound, so it shows the Dreamport not doing what the original does, and the step isn't done. `
      + 'Every frame of a clip matches: port what those frames need until the recording matches, and prove it again. Never run a recording on, or move its "clip", into frames that differ.');
  }
  // a clip's halves in two different places say nothing about the Dreamport: the recording takes the original elsewhere
  if (sideBySide && clip.apart * 4 > clip.frames) {
    problems.push(`${clip.apart} of the clip's ${clip.frames} frames differ from the original's in more than half their pixels, so the original and the Dreamport are in different places. `
      + 'The recording has to take both to the same place, such as with "sets" that give the original the progress the start point gives the Dreamport.');
  }
  return problems;
}

/**
 * Why a clip prove made no longer tells what it showed, or null when it still does: one from before prove measured
 * clips, one whose recording isn't committed or changed since, or one made against another main than the branch starts
 * from now, as a merge of main moves what the step changed. Such a clip is proven again, not fixed.
 * @returns {string | null}
 */
export function staleness(report, committed, { base } = {}) {
  const clip = report?.clip;
  if (!clip || typeof clip.apart !== 'number' || typeof clip.differing !== 'number' || typeof clip.oneColour !== 'number' || typeof clip.same !== 'number'
    || clip.changed === undefined || !report.recordingFile || !report.recordingSha1) {
    return 'This clip comes from before prove measured what a clip shows: prove the recording again for a new one.';
  }
  if (!committed) return `${report.recordingFile} isn't in the commit, and a clip comes from a recording that is: commit it, then prove it again.`;
  if (recordingHash(committed) !== report.recordingSha1) return `${report.recordingFile} changed after prove made this clip: prove it again.`;
  if (base !== undefined && (clip.base ?? null) !== base) {
    return `The clip of ${report.recording} was made against main at ${String(clip.base ?? 'none').slice(0, 7)}, and this branch starts from ${String(base ?? 'none').slice(0, 7)} now: prove it again.`;
  }
  return null;
}

/** The addresses of clips, their frames and their measures in a text, as share's lines link them: …/clips/<game>/….
 *  The record of a proof that stands in for a clip lives beside them, and isn't one (lib/same-proof.mjs). */
export function clipLinks(text) {
  return [...String(text).matchAll(/https:\/\/[^\s()<>"'[\]]+\/clips\/[^\s()<>"'[\]]+\.(?:mp4|png|json)/g)].map(m => m[0]).filter(link => !link.endsWith('-same-proof.json'));
}

/** A game's code or recordings, as a path in the repository, with the game's folder: a step that changes either shows it in a clip. */
export const GAME_CHANGE = /^games\/([a-z0-9-]+)\/(?:[a-z0-9-]+\/)?(?:src|proof\/recordings)\//;

/** The games whose code or recordings these paths change. */
export const gamesChanged = paths => [...new Set((paths ?? []).map(path => GAME_CHANGE.exec(path)?.[1]).filter(Boolean))];

/** The paths a commit adds or changes since `base`, leaving out those it deletes, or null when git can't tell. */
export function changedSince(base, commit = 'HEAD') {
  const out = base ? git(['diff', '--name-only', '--no-renames', '--diff-filter=d', base, commit]) : null;
  return out === null ? null : out.split('\n').filter(Boolean);
}

/** Whether the commit `base` has a game, as its entry says. */
export const gameAt = (base, game) => git(['cat-file', '-e', `${base}:games/${game}/entry.md`]) !== null;

/** Of the games these paths change the code or recordings of, those `has(game)` says main has already, which a step shows
 * in a clip. A game's first entry adds one main doesn't have, whose first files nobody can play yet (#1032). */
export const gamesShownIn = (paths, has) => gamesChanged(paths).filter(game => has(game));

/** The games a commit changes the code or recordings of since `base`, which `base` has, or null when git can't tell. */
export function gamesToShow(base, commit = 'HEAD') {
  const changed = changedSince(base, commit);
  return changed === null ? null : gamesShownIn(changed, game => gameAt(base, game));
}

/** What a step that changes a game and shows it in no clip does, as share, its check and the review say it. */
export const SHOW_IT = 'a step that changes a game\'s code or recordings shows it in a clip: prove the recordings it changed, '
  + 'and if none shows the new code, add a recording that plays it, or run one on until it does (npm run dp -- help recording), '
  + 'then prove it and share again. A step that changes no frame shows its proof instead: prove the game with every '
  + 'recording, commit, and share';

/** A clip's published measures, as share writes them beside it, read the way clipProblems reads prove's report. */
export const reportOf = m => ({ recording: m.recording, recordingFile: m.recordingFile, recordingSha1: m.recordingSha1, clip: m.measures });
