// What a part reaches, as the original's own memory says, so a recording that stops short of what its part names can't
// prove it, however its frames compare. A part in a game's proof/parts.json can name one of the goals the game lists in
// its proof/route.json, such as an act's end:
//
//   { "name": "Neo Green Hill Zone act 2", "recording": "neo-green-hill-act-2", "frames": [0, 8411], "reaches": "act-end" }
//
// `prove` reads the goal's values in the original at every frame of the recording, and keeps in progress.json the
// stretches of frames over which the goal held: "reached": { "act-end": [[8102, 8380]] }. The part is proven only when
// the goal comes true within its frames, which is a stretch that starts there. One that held already before the part's
// first frame says nothing of the part. `prove`, the two numbers, `npm run check` and the build all count it this way
// (tools/README.md, What a part reaches).

/** A goal's name, as route.json and a part write it: small letters and numbers, with single dashes. */
export const GOAL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The frame within a part's frames at which its goal came true, or null when it didn't: the first frame of a stretch
 * over which the goal held, as progress.json keeps them.
 * @param {[number, number][] | undefined} stretches
 * @param {[number, number]} frames the part's first and last
 */
export const reachedAt = (stretches, [from, to]) => (stretches ?? []).find(([first]) => first >= from && first <= to)?.[0] ?? null;

/**
 * Why a part's goal doesn't count as reached within its frames, as words that follow "as": what the stretches over
 * which it held say, the one after the part first, as that's the one a longer part would take in.
 * @param {string} goal
 * @param {[number, number][]} stretches
 * @param {[number, number]} frames the part's first and last
 */
export function whyUnreached(goal, stretches, [from, to]) {
  const later = stretches.find(([first]) => first > to);
  if (later) return `the original only reaches ${goal} at frame ${later[0]}, past the part's last frame, ${to}`;
  const earlier = [...stretches].reverse().find(([first]) => first < from);
  if (earlier) return `the original had already reached ${goal} at frame ${earlier[0]}, before the part's first frame, ${from}, and doesn't again within it`;
  return `the original never reaches ${goal} in this recording`;
}

/**
 * What's wrong with what a part says it reaches, as a sentence, or null: `reaches` as the part has it, and `row`, its
 * recording's row of progress.json, or null for a part no recording plays yet, with `where` naming the part for the
 * message.
 * @param {unknown} reaches
 * @param {{ reached?: Record<string, [number, number][]> } | null} row
 * @param {string} recording
 * @param {string} where
 */
export function reachesProblem(reaches, row, recording, where) {
  if (typeof reaches !== 'string' || !GOAL.test(reaches)) return `${where}'s "reaches" names one of the goals in the game's route.json, such as "act-end".`;
  if (row && !Array.isArray(row.reached?.[reaches])) return `${where} says it reaches ${reaches}, and ${recording} hasn't been proven since, so nothing has checked the original gets there: npm run dp -- prove it again.`;
  return null;
}
