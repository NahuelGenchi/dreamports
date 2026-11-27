// npm run dp -- ready <game> [--no-worse] [--task <function or task>]: everything a step has to pass before it goes out, in one go: the port map,
// the notes' check, before anything is played, every recording, `npm run check` and `npm run build`. For a version made a function at a time (lib/proofs.mjs) it
// goes by each function's proof too: every proof kept has to hold still, and with --task, a function's address or a
// task's name, each function of that task has to have its proof (`npm run dp -- proofs <version> --check`). Such a
// version with no recording yet, as a new game has while its first functions are proven, has nothing to play, which is said. With --no-worse, which `update` gives it for a merge, and for a version made a function at a time, which plays its game's recordings only as far as its proven functions go, recordings
// may differ as long as no frame that matched before does (lib/as-before.mjs). It prints what prove found and, of the rest, only what's wrong, with
// the whole of it kept in .dreamports/ready/, as their full output costs an agent thousands of tokens on every request after it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, LOCAL } from './lib/paths.mjs';
import { stepClips } from './lib/clips.mjs';
import { merging } from './lib/merge-main.mjs';
import { DIFFERS_AS_BEFORE } from './lib/as-before.mjs';
import { asksForProofs, groupNamed } from './lib/proofs.mjs';
import { tasksOf } from './lib/part-functions.mjs';
import { readCodeMap } from './lib/proof-files.mjs';
import { readProof } from './readme.mjs';
import { readRecordings } from './lib/proof-files.mjs';

const KEPT_LINES = 30;

const npm = script => (process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath, 'run', script]] : ['npm', ['run', script], { shell: process.platform === 'win32' }]);
const tool = (...args) => [process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args]];

// the report prove wrote beside each recording's clip, in .dreamports/results/<game>/<recording>/
function reportsOf(game) {
  const results = join(LOCAL, 'results', game);
  if (!existsSync(results)) return [];
  return readdirSync(results).map(recording => {
    try {
      return JSON.parse(readFileSync(join(results, recording, 'report.json'), 'utf8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function run(args) {
  const at = args.indexOf('--task'), task = at < 0 ? null : args[at + 1];
  const [game] = args.filter((arg, i) => !arg.startsWith('--') && (at < 0 || i !== at + 1));
  if (!game || (at >= 0 && !task)) throw new Error('Usage: npm run dp -- ready <game> [--no-worse] [--task <function or task>]');
  if (task && !asksForProofs(game)) throw new Error(`${game} keeps no proofs, so it has no task of functions: its tasks are its parts.`);
  const noWorse = args.includes('--no-worse');
  const folder = join(LOCAL, 'ready');
  mkdirSync(folder, { recursive: true });
  const failed = [];
  const step = (name, [program, list, options = {}]) => {
    const { status, stdout, stderr } = spawnSync(program, list, { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 28, ...options });
    const log = join(folder, `${name.replaceAll(' ', '-')}.log`);
    writeFileSync(log, `${stdout}\n${stderr}`);
    if (status === 0) return console.log(`${name}: passed.`);
    failed.push(name);
    const lines = `${stdout}\n${stderr}`.trimEnd().split('\n');
    console.log(`${name}: failed. Its last ${Math.min(lines.length, KEPT_LINES)} lines, of ${lines.length} kept in .dreamports/ready/:\n${lines.slice(-KEPT_LINES).join('\n')}`);
  };
  step('port map', tool('portmap', game));
  // a version made a function at a time: its proofs hold, and its task's functions each have one
  if (asksForProofs(game)) step('proofs', tool('proofs', game, '--check', ...(task ? ['--task', task] : [])));
  // a note the notes check refuses fails `npm run check` at the end, once every recording has played, and the proof
  // then runs a second time. It takes a second and nothing the proof writes changes what it finds, so it's said here,
  // and nothing is played until the notes are right (#2062)
  step('notes', tool('notes', '--check'));
  if (failed.includes('notes')) {
    console.log(`Not ready: ${failed.join(', ')}. Nothing was played: put the notes right and run it again.`);
    return 1;
  }
  // what the recordings found is the point, so it shows as prove says it: in full where there's news, and summed up
  // where a recording came out as when last proven. Frames that differ fail the step
  // a game made a function at a time can have functions proven before any of it plays, and then nothing to play yet
  const nothingToPlay = asksForProofs(game) && !readRecordings(game).length;
  if (nothingToPlay) console.log('recordings: the game has none yet, so nothing was played. Its functions\' proofs are what this step has.');
  const proved = nothingToPlay ? { status: 0 } : spawnSync(...tool('prove', game), { cwd: REPO, stdio: 'inherit' });
  const asBefore = (noWorse || asksForProofs(game)) && proved.status === DIFFERS_AS_BEFORE;
  if (proved.status !== 0 && !asBefore) failed.push('prove');
  // a step whose every clip of what it changed breaks a rule has nothing share would publish, which share says only
  // after the work is committed and main brought in, a whole proof later: said here, from prove's own measures (#2082)
  if (!nothingToPlay) {
    const clips = stepClips(reportsOf(game), file => (existsSync(join(REPO, file)) ? readFileSync(join(REPO, file), 'utf8') : null));
    if (clips.none) {
      failed.push('clips');
      console.log(`clips: ${clips.changed === 1 ? 'the one clip' : `none of the ${clips.changed} clips`} of what this step changed keeps the rules of a clip, so share would publish nothing. `
        + `The nearest, of ${clips.broken.length}:\n${clips.broken.slice(0, 3).map(clip => `  ${clip.recording}: ${clip.problems.join(' ')}`).join('\n')}\n`
        + 'Change a recording, or add one, until its clip keeps them: npm run dp -- prove <version> <recording>, without --quick, makes its clip and says the same.');
    } else if (clips.changed) console.log(`clips: ${clips.good} of the ${clips.changed} that show what this step changed ${clips.good === 1 ? 'keeps' : 'keep'} the rules.`);
  }
  // a task that is a part of the game is done once the part is proven by its recording too (lib/part-functions.mjs)
  const part = task && readCodeMap(game) ? groupNamed(tasksOf(game, readCodeMap(game)), task) : null;
  if (part?.part && !readProof(game)?.gameplay?.parts?.some(each => each.name === part.name && each.proven)) {
    failed.push('the part');
    console.log(`the part: ${part.name} isn't proven by its recording yet, so its task isn't done: its functions' proofs can go out as they are, in a pull request that names the task with Refs.`);
  }
  step('check', npm('check'));
  step('build', npm('build'));
  console.log(failed.length ? `Not ready: ${failed.join(', ')}.` : asBefore ? 'Ready: no frame that matched before differs.' : 'Ready.');
  // only a note, as a piece of a team build is built on that and not on main, and this may be run with no network
  const onMain = ['upstream', 'origin'].map(remote => spawnSync('git', ['rev-list', '--count', `HEAD..${remote}/main`], { cwd: REPO, encoding: 'utf8' })).find(({ status }) => status === 0);
  if (!failed.length && !merging(REPO) && Number(onMain?.stdout) > 0) console.log(`main has ${Number(onMain.stdout)} newer commits as far as this computer knows: npm run dp -- update ${game} brings them in before it goes out.`);
  return failed.length ? 1 : 0;
}
