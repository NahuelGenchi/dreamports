// node tools/clips-check.mjs [<file>]: the pull request's check of its clips (.github/workflows/clips.yml). It reads
// the pull request's text, from <file> or PR_BODY, and every clip it links, as share publishes them: the video, and the
// measures share puts beside it. It fails when a clip has no measures, as one share didn't make, when the video isn't
// the one measured, when the recording measured isn't the pull request's, or when the measures break a rule of
// docs/STANDARD.md#clips (lib/clips.mjs). With what the pull request changes since CHANGED_FROM, it also fails one that
// changes the code or recordings of a game main has and links no clip of that game, since #1030: text with no clip
// passes only when the step changes neither, or adds a game's first entry, which nobody can play yet (#1032). It needs
// only Node and git: nothing is installed, and nothing but the clips' own addresses is fetched.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipLinks, clipProblems, gamesToShow, reportOf, SHOW_IT } from './lib/clips.mjs';
import { REPO } from './lib/paths.mjs';

const MOST = { mp4: 2_200_000, json: 64_000 };

/** Every problem with the clips a text links, as sentences, with `fetched(url, most)` for their bytes or null, and in
 * `games` the games whose code or recordings the pull request changes, which main has already. */
export async function checkClips(text, { fetched = download, read = path => readRecording(path), games = [] } = {}) {
  const links = [...new Set(clipLinks(text))];
  const videos = links.filter(link => link.endsWith('.mp4'));
  const problems = [];
  for (const game of games) {
    if (!videos.some(link => link.includes(`/clips/${game}/`))) problems.push(`It changes ${game}'s code or recordings and links no clip of it: ${SHOW_IT}, and paste .dreamports/share/clips.md under Clips.`);
  }
  // a picture on its own is a clip prove didn't make, as share links each video's frame beside it, and nothing else
  for (const link of links.filter(l => !l.endsWith('.mp4'))) {
    const video = link.replace(/-still\.png$/, '.mp4');
    if (!link.endsWith('-still.png') || !videos.includes(video)) problems.push(`${link} isn't the frame of a clip the text links: a clip is a video prove made, which share publishes with its frame.`);
  }
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
    const video = await fetched(link, MOST.mp4);
    const hash = video && createHash('sha1').update(video).digest('hex');
    if (!video) problems.push(`${link} can't be fetched.`);
    else if (hash !== measures.video || !hash.startsWith(stamp ?? '-')) problems.push(`${link} isn't the video its measures are of.`);
    for (const problem of clipProblems(reportOf(measures), read(measures.recordingFile), { sideBySide: measures.sideBySide })) problems.push(`${measures.recording}: ${problem}`);
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
  const games = process.env.CHANGED_FROM ? gamesToShow(process.env.CHANGED_FROM) : [];
  if (games === null) {
    console.log(`git can't tell what the pull request changes since ${process.env.CHANGED_FROM}, so its clips can't be checked.`);
    process.exit(1);
  }
  const problems = await checkClips(text, { games });
  if (problems.length) {
    console.log(`The pull request's clips break the rules of docs/STANDARD.md#clips:\n${problems.map(p => `- ${p}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    const count = clipLinks(text).filter(l => l.endsWith('.mp4')).length;
    console.log(count ? `All ${count} clip${count > 1 ? 's' : ''} keep the rules.` : 'The pull request links no clip.');
  }
}
