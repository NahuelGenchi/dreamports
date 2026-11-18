// node tools/clips-check.mjs [<file>]: the pull request's check of its clips (.github/workflows/clips.yml). It reads
// the pull request's text, from <file> or PR_BODY, and every clip it links, as share publishes them: the video, and the
// measures share puts beside it. It fails when a clip has no measures, as one share didn't make, when it shows the
// Dreamport on its own (#1039), when the video isn't
// the one measured, when the recording measured isn't the pull request's, or when the measures break a rule of
// docs/STANDARD.md#clips (lib/clips.mjs). With what the pull request changes since CHANGED_FROM, it also fails one that
// changes the code or recordings of a game main has and links no clip of that game, since #1030: text with no clip
// passes only when the step changes neither, or adds a game's first entry, which nobody can play yet (#1032), or, since
// #1060, changes a game's code and no frame, and links the record of its proof in a clip's place: the record share
// published of a whole proof of the very files that would merge, whose progress.json is main's own (lib/same-proof.mjs),
// or, since #1474, only proves functions of a game made a function at a time that has no recording yet, and names each
// with its proof: every function it adds or changes a twin whose line in proofs.json is of the code that would merge,
// and nothing else of the game's code changed but declarations (lib/proven-step.mjs).
// It needs only Node and git: nothing is installed, and nothing but the clips' and records' own addresses is fetched.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { changedSince, clipLinks, clipProblems, clipsToShow, gamesToShow, reportOf, SHOW_IT } from './lib/clips.mjs';
import { changesOf, recordLinks, recordProblems, stateAt, versionIn } from './lib/same-proof.mjs';
import { recordingsAt, showsProofs, standProblems, stepProofs } from './lib/proven-step.mjs';
import { REPO } from './lib/paths.mjs';

const MOST = { mp4: 2_200_000, json: 64_000 };

/** Every problem with the clips a text links, as sentences, with `fetched(url, most)` for their bytes or null, and in
 * `games` the games whose code or recordings the pull request changes, which main has already. `stepOf(game)` says
 * what it changes of one, for a game it links no clip of: { recordings, versions: [{ version, state }] }, each version
 * whose code it changes with what would merge of it (stateAt in lib/same-proof.mjs), and `proofs()` for what its
 * functions' proofs cover of the step and how many recordings the game has, { step, recordings } (lib/proven-step.mjs),
 * or null when nothing can say. */
export async function checkClips(text, { fetched = download, read = path => readRecording(path), games = [], stepOf = () => null } = {}) {
  const links = [...new Set(clipLinks(text))];
  const videos = links.filter(link => link.endsWith('.mp4'));
  const records = [...new Set(recordLinks(text))];
  const problems = [];
  for (const game of games) {
    if (videos.some(link => link.includes(`/clips/${game}/`))) continue;
    // with no clip, the record of its proof stands in, for every version whose code it changes, when it changes no frame
    const step = stepOf(game);
    const cant = [];
    if (!step || step.recordings || !step.versions.length) cant.push('');
    else {
      for (const { version, state, proofs } of step.versions) {
        const link = records.find(each => versionIn(each) === version);
        const json = link ? await fetched(link, MOST.json) : null;
        let record = null;
        try {
          record = json && JSON.parse(json.toString('utf8'));
        } catch { /* not a record */ }
        const own = !link ? [`It links no record of ${version}'s proof.`] : !record ? [`${link} can't be read as a record share made.`] : recordProblems(record, version, state);
        if (!own.length) continue;
        // with no record either, a step that only proves functions shows their proofs, in a game made a function at a
        // time that has no recording yet (lib/proven-step.mjs): held to what would merge, and to the text's own lines
        const way = proofs?.() ?? null;
        const stand = way?.step.keeps || showsProofs(text) ? standProblems(version, way?.step ?? { keeps: false }, way?.recordings ?? { main: 0, now: 0 }, text) : null;
        if (stand && !stand.length) continue;
        cant.push(...(way?.step.keeps && !way.recordings.main && !way.recordings.now ? stand : [...own, ...(stand ?? [])]).map(problem => ` ${problem}`));
      }
    }
    if (cant.length) problems.push(`It changes ${game}'s code or recordings and links no clip of it: ${SHOW_IT}, and paste .dreamports/share/clips.md under Clips.${cant.join('')}`);
  }
  // a picture on its own is a clip prove didn't make, as share links each video's frame beside it, and nothing else
  for (const link of links.filter(l => !l.endsWith('.mp4'))) {
    const video = link.replace(/-still\.png$/, '.mp4');
    if (!link.endsWith('-still.png') || !videos.includes(video)) problems.push(`${link} isn't the frame of a clip the text links: a clip is a video prove made, which share publishes with its frame.`);
  }
  const measured = [];
  for (const link of videos) {
    const stamp = /-([0-9a-f]{7})\.mp4$/.exec(link)?.[1];
    const json = await fetched(link.replace(/\.mp4$/, '.json'), MOST.json);
    let measures = null;
    try {
      measures = json && JSON.parse(json.toString('utf8'));
    } catch { /* not measures */ }
    if (measures?.clip !== 'dreamports' || !measures.measures) {
      problems.push(`${link} has no measures beside it, so share didn't make it as it is now: prove the recording, share it, and paste .dreamports/share/clips.md under Clips.`);
      continue;
    }
    // the Dreamport on its own shows nothing of whether it does what the original does (#1039)
    if (measures.sideBySide !== true) problems.push(`${link} shows the Dreamport on its own, and a pull request's clip shows the original next to it, every frame matching: share the side by side clip prove made.`);
    const video = await fetched(link, MOST.mp4);
    const hash = video && createHash('sha1').update(video).digest('hex');
    if (!video) problems.push(`${link} can't be fetched.`);
    else if (hash !== measures.video || !hash.startsWith(stamp ?? '-')) problems.push(`${link} isn't the video its measures are of.`);
    for (const problem of clipProblems(reportOf(measures), read(measures.recordingFile), { sideBySide: measures.sideBySide })) problems.push(`${measures.recording}: ${problem}`);
    measured.push(measures);
  }
  // a change that's only heard has no clip beside one of a change that can be seen (#1194)
  for (const measures of clipsToShow(measured, m => m.measures.changed).heard) {
    problems.push(`${measures.recording}: only its sound changed, which a clip has no sound to show, and another clip shows what this step changed. Leave this clip out: share again and paste .dreamports/share/clips.md under Clips.`);
  }
  return problems;
}

// a recording of the pull request's, as it's checked out, or null
function readRecording(path) {
  if (typeof path !== 'string' || !/^games\/[a-z0-9-]+(?:\/[a-z0-9-]+)?\/proof\/recordings\/[a-z0-9-]+\.json$/.test(path)) return null;
  const file = join(REPO, path);
  return existsSync(file) ? readFileSync(file) : null;
}

// a clip's file from its address, up to `most` bytes, or null
async function download(url, most) {
  for (let tries = 0; tries < 3; tries++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(String(response.status));
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.length > most ? null : bytes;
    } catch {
      await new Promise(done => setTimeout(done, 3000 * (tries + 1)));
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : process.env.PR_BODY ?? '';
  // the workflow checks out the merge of the pull request into main, so what it changes is what that merge adds
  const from = process.env.CHANGED_FROM;
  const games = from ? gamesToShow(from) : [];
  const changed = from ? changedSince(from) ?? [] : [];
  // what would merge of a version, held against main as it is: the workflow's checkout is that merge
  const stepOf = game => {
    const { versions, recordings } = changesOf(changed, game);
    return {
      recordings,
      versions: versions.map(version => ({
        version,
        state: stateAt(version, 'HEAD', from),
        // read only when no record stands, from the files here, which are what would merge
        proofs: () => ({ step: stepProofs(version, from), recordings: { main: recordingsAt(version, from), now: recordingsAt(version, 'HEAD') } }),
      })),
    };
  };
  if (games === null) {
    console.log(`git can't tell what the pull request changes since ${process.env.CHANGED_FROM}, so its clips can't be checked.`);
    process.exit(1);
  }
  const problems = await checkClips(text, { games, stepOf });
  if (problems.length) {
    console.log(`The pull request's clips break the rules of docs/STANDARD.md#clips:\n${problems.map(p => `- ${p}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    const count = clipLinks(text).filter(l => l.endsWith('.mp4')).length;
    const stoodIn = games.length && !count;
    console.log(count ? `All ${count} clip${count > 1 ? 's' : ''} keep the rules.`
      : stoodIn && showsProofs(text) && !recordLinks(text).length ? 'The pull request only proves functions of a game with no recording yet, and their proofs stand in for a clip.'
        : stoodIn ? 'The pull request changes no frame, and the record of its proof stands in for a clip.' : 'The pull request links no clip.');
  }
}
