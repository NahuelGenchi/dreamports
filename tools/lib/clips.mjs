// What a clip of the original next to a Dreamport has to be before a pull request shows it (docs/STANDARD.md#clips):
// a few seconds long, both halves in the same place, and made from a recording that's committed as it was proven.
// `prove` measures each clip into its report.json, `share` refuses one that breaks a rule, and a recording's own
// "clip" is held to the length as it's read (lib/recording.mjs).

import { createHash } from 'node:crypto';

/** The shortest clip, in frames: about two seconds on every console the tools know, which run at about 60 a second. */
export const CLIP_FRAMES = 120;

/** The SHA-1 of a recording's file, which ties a clip to the recording as it was when proven. */
export const recordingHash = text => createHash('sha1').update(text).digest('hex');

/**
 * Why a clip prove made can't go in a pull request, as sentences, or none when it can. `report` is the report.json
 * prove wrote beside it, or null; `committed` is the recording's file in the commit being shared, or null when it
 * isn't there. The Dreamport's clip on its own, not `sideBySide`, has no original to be in another place from.
 * @param {any} report
 * @param {Buffer | string | null} committed
 * @param {{ sideBySide?: boolean }} [options]
 * @returns {string[]}
 */
export function clipProblems(report, committed, { sideBySide = true } = {}) {
  const clip = report?.clip;
  if (!clip || typeof clip.apart !== 'number' || !report.recordingFile || !report.recordingSha1) {
    return ['This clip comes from before prove measured its clips: prove the recording again for a new one.'];
  }
  const problems = [];
  const name = report.recording;
  if (clip.frames < CLIP_FRAMES) {
    problems.push(`The clip of ${name} is ${clip.frames} frames, ${clip.seconds.toFixed(2)} seconds, and a clip lasts at least ${CLIP_FRAMES} frames, about two seconds. `
      + `A "clip" of ${CLIP_FRAMES} frames or more in the recording makes a longer one, and a recording that proves only a few frames after its start point runs on further.`);
  }
  // a clip's halves in two different places say nothing about the Dreamport: the recording takes the original elsewhere
  if (sideBySide && clip.apart * 4 > clip.frames) {
    problems.push(`${clip.apart} of the clip's ${clip.frames} frames differ from the original's in more than half their pixels, so the original and the Dreamport are in different places. `
      + `The recording has to take both to the same place, such as with "sets" that give the original the progress the start point gives the Dreamport, or its "clip" has to be where they meet. `
      + 'A step that doesn\'t match the original yet can share the Dreamport on its own, with --clip and the dreamport.mp4 beside this clip.');
  }
  if (!committed) problems.push(`${report.recordingFile} isn't in the commit, and a clip comes from a recording that is: commit it, then prove it again.`);
  else if (recordingHash(committed) !== report.recordingSha1) problems.push(`${report.recordingFile} changed after prove made this clip: prove it again.`);
  return problems;
}
