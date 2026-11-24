// npm run test:nds-flow: a Nintendo DS game made the new way, a part at a time, each part a task of the functions the
// original runs in it (#1871), from its first day to a part done, through the tools as they're typed, with a program of
// the project's own (made-up-nds-parts.mjs) as the game, so it needs nobody's copy of anything. Its Dreamport in C is in
// games/ for as long as this takes: the twins of the program's two functions (nds-flow/game.c) and what calls them each
// frame (nds-flow/main.c). GitHub is a stand-in: a small program that keeps issues in a file, which the tools start in
// the GitHub CLI's place, by DREAMPORTS_GH (lib/github.mjs), so nothing is opened anywhere.
//
// What it shows, on the Nintendo DS: `proofs --start --parts` starts both files; `prove` plays the recording, with its
// two parts, in melonDS, and writes which functions the original ran in each; `tasks` opens a task for each part, with
// the functions it runs that no part before it does; `find --take` hands the first out; `ready --task "<part>"` fails
// while a function of the part has no proof, and while the part's frames don't match the original's, and passes once
// both hold; and `twin` proves the functions, in melonDS's own processor, and keeps each proof.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { firstFiles } from '../lib/new-game.mjs';
import { hex, readCodeMap } from '../lib/proof-files.mjs';
import { madeUpNdsParts } from './made-up-nds-parts.mjs';

const HERE = fileURLToPath(new URL('./nds-flow/', import.meta.url));
const NAME = 'test-nds-flow', VERSION = `${NAME}/c`, REPOSITORY = 'stand-in/dreamports', HOME = 900;
const work = join(LOCAL, 'tmp', 'nds-flow-test'), COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md'), MAPS = join(REPO, '.github', 'readme', 'progress'), MEDIA = join(REPO, 'public', 'media');
const source = join(gameFolder(VERSION), 'src');
const proofs = join(proofFolder(VERSION), 'proofs.json'), partFunctions = join(proofFolder(NAME), 'part-functions.json');
const FIRST = 'Counting the frames', SECOND = 'Holding A';

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const last = run => run.out.trim().split('\n').at(-1);
const line = (run, pattern) => run.out.split('\n').find(each => pattern.test(each))?.trim();

// GitHub, as far as the tools ask it: issues in a file, each new one put under the game's issue at once
const GH = `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.env.STAND_IN_GITHUB, state = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const path = args.find(arg => /^(repos\\/|user$)/.test(arg)), method = args.includes('-X') ? args[args.indexOf('-X') + 1] : 'GET';
const at = 'https://api.github.com/repos/${REPOSITORY}';
const shown = issue => ({ ...issue, repository_url: at, html_url: 'https://github.test/${REPOSITORY}/issues/' + issue.number, labels: [], user: { login: 'pat-lead' }, ...(issue.parent ? { parent_issue_url: at + '/issues/' + issue.parent } : {}) });
const answer = value => { process.stdout.write(args.includes('--jq') ? String(value.login) + '\\n' : JSON.stringify(value)); process.exit(0); };
state.log.push(method + ' ' + path);
const save = () => writeFileSync(file, JSON.stringify(state, null, 2));
save();
if (path === 'user') answer({ login: 'sam' });
const [, , , kind, number, under] = path.split('?')[0].split('/');
if (kind === 'pulls') answer([]);
if (kind === 'issues' && !number && method === 'GET') answer(state.issues.filter(issue => issue.state === 'open').map(shown));
if (kind === 'issues' && !number && method === 'POST') {
  const { title, body } = JSON.parse(readFileSync(0, 'utf8'));
  const issue = { number: state.next++, title, body, state: 'open', assignees: [], parent: ${HOME} };
  state.issues.push(issue);
  save();
  answer(shown(issue));
}
const issue = state.issues.find(each => each.number === Number(number));
if (!issue) { process.stderr.write('gh: Not Found (HTTP 404)\\n'); process.exit(1); }
if (under === 'sub_issues') answer(state.issues.filter(each => each.parent === issue.number).map(shown));
if (method === 'PATCH') { Object.assign(issue, JSON.parse(readFileSync(0, 'utf8'))); save(); }
answer(shown(issue));
`;

const bin = join(work, 'bin'), github = join(work, 'github.json');
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26, env: { ...process.env, DREAMPORTS_GH: join(bin, 'gh'), STAND_IN_GITHUB: github },
  });
  return { status, out: stdout + stderr };
};
const kept = () => JSON.parse(readFileSync(proofs, 'utf8')).functions;
const issues = () => JSON.parse(readFileSync(github, 'utf8'));
const tidy = () => {
  const media = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(NAME)).map(file => join(MEDIA, file)) : [];
  for (const path of [gameFolder(NAME), ...media, join(LOCAL, 'results', NAME), join(LOCAL, 'tasks', `${NAME}.lock`)]) rmSync(path, { recursive: true, force: true });
};

rmSync(work, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
const tracked = spawnSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' }).stdout;
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null, status = readFileSync(STATUS);
// npm run dp -- readme writes every game's progress map, the test's own and its version's among them, from what this
// computer has: each is put back as it was, and those it made go
const maps = new Map(readdirSync(MAPS).map(name => [name, readFileSync(join(MAPS, name))]));
const mapsBack = () => {
  for (const name of readdirSync(MAPS)) if (!maps.has(name)) rmSync(join(MAPS, name));
  for (const [name, bytes] of maps) writeFileSync(join(MAPS, name), bytes);
};
tidy();
try {
  console.log('A Nintendo DS game of the project\'s own, in games/ for as long as this takes:');
  const { rom, sha1, tick, bump } = madeUpNdsParts();
  const keyOf = address => hex(address);
  const copy = join(work, 'cartridge.nds');
  writeFileSync(copy, rom);
  const original = { console: 'nds', name: 'Test Nintendo DS Flow (World)', title: 'MADE UP PART', code: 'MDPE', sha1 };
  const files = firstFiles(NAME, original, { language: 'c', issue: HOME, lead: 'pat-lead', added: '2026-11-24' });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(NAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(NAME), file), text);
  }
  mkdirSync(join(proofFolder(NAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  // its Dreamport: the twins, with where each function is, and what calls them; `shown` is the upper screen's colour
  const twins = readFileSync(join(HERE, 'game.c'), 'utf8').replace('@TICK@', `0x${keyOf(tick)}`).replace('@BUMP@', `0x${keyOf(bump)}`);
  const writeMain = (shown = 'state.colour') => writeFileSync(join(source, 'main.c'), readFileSync(join(HERE, 'main.c'), 'utf8').replace('@SHOWN@', shown));
  writeFileSync(join(source, 'game.c'), twins);
  writeFileSync(join(source, 'game.h'), readFileSync(join(HERE, 'game.h'), 'utf8'));
  writeMain();
  // one recording that plays both parts: no button for the first, then A held. The frame after the first part's last,
  // which its functions include (#1899), still has no press
  writeFileSync(join(proofFolder(NAME), 'recordings', 'play.json'), `${JSON.stringify({ about: 'The frames counted, then A held.', frames: 120, held: [[0, []], [58, ['A']]] }, null, 2)}\n`);
  writeFileSync(join(proofFolder(NAME), 'parts.json'), `${JSON.stringify({
    about: 'The made-up program\'s two parts.',
    parts: [{ name: FIRST, recording: 'play', frames: [2, 54] }, { name: SECOND, recording: 'play', frames: [60, 110] }],
  }, null, 2)}\n`);
  writeFileSync(join(bin, 'gh'), GH);
  writeFileSync(github, JSON.stringify({
    next: HOME + 1, log: [],
    issues: [{ number: HOME, title: 'Dreamport: Test Nintendo DS Flow', state: 'open', assignees: [{ login: 'pat-lead' }], body: ['### Game', '', 'Test Nintendo DS Flow', '', '### Game folder', '', NAME, '', '### Console', '', 'Nintendo DS', '', '### Where it starts', '', 'A count of frames.'].join('\n') }],
  }));

  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(NAME), 'rom knows its copy');
  run = dp('codemap', NAME);
  const mapped = readCodeMap(NAME)?.functions ?? [];
  check(run.status === 0 && mapped.some(f => f.address === tick && f.mode === 'thumb') && mapped.some(f => f.address === bump) && mapped.some(f => f.program === 'ARM7'), `codemap finds both functions, in Thumb code, and the ARM7's program: ${last(run)}`);
  run = dp('portmap', VERSION);
  check(run.status === 0 && /2 functions named/.test(run.out), `its code names its two functions: ${last(run)}`);

  console.log('A new game, its parts for tasks:');
  run = dp('proofs', VERSION, '--start', '--parts');
  check(run.status === 0 && existsSync(proofs) && existsSync(partFunctions) && kept().length === 0, `proofs --start --parts starts both files, with nothing in them: ${last(run).slice(0, 120)}`);
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  const before = issues().issues.filter(issue => issue.number > HOME);
  check(run.status === 0 && before.length === 2 && before.every(issue => /has no recording of the original yet, which is where its task starts/.test(issue.body)),
    `tasks opens a task for each part, which starts with the original's recording, as nothing says yet which functions it runs: ${before.map(issue => `#${issue.number} ${issue.title}`).join(', ')}`);
  run = dp('prove', VERSION);
  const lists = JSON.parse(readFileSync(partFunctions, 'utf8')).parts;
  check(run.status === 0, `prove plays the recording, both parts, every frame the same as the original's: ${line(run, /frames the same|matches/) ?? last(run)}`);
  if (run.status) console.log(run.out);
  check(JSON.stringify(lists[FIRST]) === JSON.stringify([keyOf(tick)]) && JSON.stringify(lists[SECOND]) === JSON.stringify([keyOf(tick), keyOf(bump)].sort()),
    `and writes which functions the original runs in each part: ${JSON.stringify(lists)}`);

  console.log('Its tasks, against a stand-in for GitHub:');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--update', '--yes');
  const opened = issues().issues.filter(issue => issue.number > HOME);
  const first = opened.find(issue => issue.title.includes(FIRST)), second = opened.find(issue => issue.title.includes(SECOND));
  check(run.status === 0 && first?.number === HOME + 1 && second?.number === HOME + 2 && first.body.includes(keyOf(tick)) && !first.body.includes(keyOf(bump)) && second.body.includes(keyOf(bump)) && !second.body.includes(keyOf(tick)),
    `tasks --update writes each part's task again with the functions it runs that no part before it does: ${keyOf(tick)} for the first, ${keyOf(bump)} for the second`);
  // the code no part runs, each program's start, comes after the parts, in groups that sit together in the code map,
  // which tasks opens, where --update only writes those open again
  check(opened.length === 2, 'tasks --update opens nothing new');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  const rest = issues().issues.filter(issue => issue.number > HOME + 2);
  check(rest.length === 2 && rest.some(issue => issue.title.includes('@ARM7')) && rest.every(issue => /^Task: Functions /.test(issue.title)),
    `and opens the code no part runs as tasks of functions, the ARM9's and the ARM7's: ${rest.map(issue => issue.title).join(', ')}`);
  if (run.status || !first || !second) console.log(run.out, opened.map(issue => issue.body).join('\n---\n'));
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  check(run.status === 0 && new RegExp(`Take #${first?.number} ${FIRST}`).test(run.out) && /ready test-nds-flow\/c --task/.test(run.out), `find hands out the first part's task, with when it's done: ${run.out.trim().split('\n')[0]}`);
  if (run.status) console.log(run.out);

  console.log('Its first part, done when its function is proven and its frames match:');
  // the table of Dreamports has the game in it, as it would on its first day, for npm run check, which ready runs
  dp('readme');
  run = dp('ready', VERSION, '--task', FIRST);
  check(run.status !== 0 && /proofs: failed/.test(run.out) && /1 of its 1 function has no proof yet|has no proof yet/.test(run.out), `ready --task fails while the part's function has no proof: ${line(run, /^Not ready/) ?? last(run)}`);
  if (!/proofs: failed/.test(run.out)) console.log(run.out);
  run = dp('twin', VERSION);
  check(run.status === 0 && /2 functions kept as proven by the same memory/.test(run.out) && kept().map(each => each[0]).join() === [keyOf(tick), keyOf(bump)].join(), `twin proves both functions in melonDS's processor, and keeps each proof: ${last(run)}`);
  if (run.status) console.log(run.out);
  writeMain('state.colour ^ 1');
  run = dp('ready', VERSION, '--task', FIRST);
  check(run.status !== 0 && /proofs: passed/.test(run.out) && /Not ready:.*the part/.test(run.out) && /isn't proven by its recording yet/.test(run.out), `and while the part's frames don't match the original's, with every proof held: ${line(run, /^Not ready/) ?? last(run)}`);
  writeMain();
  run = dp('ready', VERSION, '--task', FIRST);
  check(run.status === 0 && /^Ready\./m.test(run.out), `and passes once both hold: ${last(run)}`);
  if (run.status) console.log(run.out);
  run = dp('proofs', VERSION, '--check', '--task', SECOND);
  check(run.status === 0, `the second part's function has its proof too: ${last(run)}`);
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  check(run.status === 0 && !new RegExp(`Take #(${first?.number}|${second?.number}) `).test(run.out) && /Take #\d+ Functions /.test(run.out), `and find hands out neither part any more, both done, but the code no part runs: ${run.out.trim().split('\n')[0]}`);
  const elsewhere = issues().log.filter(each => !/^(GET|POST|PATCH) (repos\/stand-in\/dreamports\/|user$)|^GET repos\/[\w.-]+\/[\w.-]+\/forks\?/.test(each));
  check(!elsewhere.length, `the tools asked the stand-in and nothing else${elsewhere.length ? `: ${elsewhere[0]}` : ''}`);
} finally {
  tidy();
  writeFileSync(STATUS, status);
  mapsBack();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}
const changed = spawnSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' }).stdout;
check(!existsSync(gameFolder(NAME)) && changed === tracked, `nothing is left behind${changed === tracked ? '' : `: ${changed}`}`);

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nA Nintendo DS game made a part at a time goes from its first day to a part done.');
