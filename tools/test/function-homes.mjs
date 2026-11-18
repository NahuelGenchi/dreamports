// npm run test:function-homes: a big game made a function at a time, whose tasks are four times what GitHub holds
// under one issue, from its first tasks to its last, through the tools as they're typed (#1473). The game is made up:
// a cartridge with a header and nothing else, a code map of 1,720 functions that makes 400 groups, and a twin for
// each with nothing in it, in games/ for as long as this takes. GitHub is a stand-in that keeps GitHub's own limits
// on issues under issues (stand-in/github.mjs), and the claims workflow's own script runs against it for every new
// task and every claim, as on GitHub. Nothing is opened anywhere, and it needs no compiler and nobody's copy of
// anything.
//
// What it shows: `tasks` opens twenty tasks at once and the next as those close, the workflow puts each under the
// issue of its stretch of the game's code, a stretch with more tasks than an issue holds gets a second issue, GitHub
// never has to refuse one, and by the last task the game's issue still has one issue under it; `find`, `find --take`
// and the count of free tasks the Make pages show see every task wherever it is; a claim is granted on a task and
// refused on a stretch's issue; `proofs --check --task`, which is how `ready --task` says a task is done, goes by the
// functions; and when the code map finds a function more, an open task keeps its home and takes its new name.
//
// No tool proves anything here, as the twins are empty: the test keeps each proof with the library's own keepProofs,
// as `match` does after it has found a twin the same, so that tasks close and the next open.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { firstFiles } from '../lib/new-game.mjs';
import { formatCodeMap, readCodeMap } from '../lib/proof-files.mjs';
import { groupNamed, groupsOf, keepProofs } from '../lib/proofs.mjs';
import { functionsOfTask, holdsTasks, languageOfIssue, piecesUnder, stretchOf, stretchOfIssue, whatCanStart } from '../../src/lib/pieces.mjs';
import { madeUpGame } from './made-up-game.mjs';
import { BOT, GH, MOST_UNDER, github, newSite } from './stand-in/github.mjs';

const NAME = 'test-function-homes', VERSION = `${NAME}/c`, REPOSITORY = 'stand-in/dreamports', HOME = 900;
const work = join(LOCAL, 'tmp', 'function-homes-test'), COPIES = join(LOCAL, 'copies.json');
const bin = join(work, 'bin'), kept = join(work, 'github.json');
const CARTRIDGE = 0x08000000;

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const env = login => ({ ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, STAND_IN_GITHUB: kept, STAND_IN_LOGIN: login, STAND_IN_WORK: join(work, 'claims') });
const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26, env: env('sam') });
  return { status, out: stdout + stderr };
};
// a call to the stand-in as someone signed in to the GitHub CLI would make it
const gh = (login, method, path, body) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(bin, 'gh'), 'api', '-X', method, `repos/${REPOSITORY}${path}`, ...(body ? ['--input', '-'] : [])], { encoding: 'utf8', input: body && JSON.stringify(body), env: env(login) });
  if (status !== 0) throw new Error(stderr);
  return JSON.parse(stdout);
};
const site = () => JSON.parse(readFileSync(kept, 'utf8'));
const change = edit => { const now = site(); edit(now); writeFileSync(kept, JSON.stringify(now)); };
const first = run => run.out.trim().split('\n')[0], last = run => run.out.trim().split('\n').at(-1);
const tidy = () => { for (const path of [gameFolder(NAME), join(LOCAL, 'tasks', `${NAME}.lock`)]) rmSync(path, { recursive: true, force: true }); };

// the game's code: 1,440 small functions close together from 0x08000100, which make 120 groups of twelve in one
// stretch, more than an issue holds, and 280 apart from 0x08010000, each a group of its own, 32 to a stretch
const SMALL = Array.from({ length: 1440 }, (_, index) => ({ address: CARTRIDGE + 0x100 + index * 8, size: 4 }));
const APART = Array.from({ length: 280 }, (_, index) => ({ address: CARTRIDGE + 0x10000 + index * 0x800, size: 0x100 }));
// the function the code map finds later, in the room after the fourth function of the sixth group
const FOUND = { address: SMALL[63].address + 4, size: 4 };
const hex8 = address => address.toString(16).toUpperCase().padStart(8, '0');
const writeCodeMap = (sha1, functions) => writeFileSync(join(proofFolder(NAME), 'code-map.json'), formatCodeMap({ original: sha1, from: 'The test\'s own made-up functions', functions: [...functions].sort((a, b) => a.address - b.address) }));
const writeTwins = functions => writeFileSync(join(gameFolder(VERSION), 'src', 'twins.c'), `// Made-up twins, each of the function its name says, with nothing in them.\n${functions.map(f => `void sub_${hex8(f.address)}(void) {\n}\n`).join('')}`);

// what a pull request merging does for a task: its functions are kept as proven, and its issue closes
const groups = () => groupsOf(readCodeMap(VERSION));
const openTasks = () => site().issues.filter(issue => issue.state === 'open' && functionsOfTask(issue));
function finish(tasks) {
  const all = groups(), keys = tasks.flatMap(task => groupNamed(all, task.title).functions.map(f => ({ key: f.key })));
  keepProofs(VERSION, { kind: 'bytes', proven: keys });
  change(now => { for (const task of tasks) now.issues.find(issue => issue.number === task.number).state = 'closed'; });
}

rmSync(work, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
try {
  console.log('A made-up game of 1,720 functions, in games/ for as long as this takes:');
  const { rom, sha1 } = madeUpGame({ title: 'MADE UP BIG', code: 'MBIG', size: 0xA0000 });
  const copy = join(work, 'cartridge.gba');
  writeFileSync(copy, rom);
  const original = { console: 'gba', name: 'Test Function Homes (World)', title: 'MADE UP BIG', code: 'MBIG', sha1 };
  for (const [file, text] of Object.entries(firstFiles(NAME, original, { language: 'c', issue: HOME, lead: 'pat-lead', added: '2026-11-17' }))) {
    mkdirSync(join(gameFolder(NAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(NAME), file), text);
  }
  mkdirSync(proofFolder(NAME), { recursive: true });
  writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  writeCodeMap(sha1, [...SMALL, ...APART]);
  writeTwins([...SMALL, ...APART]);
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(kept, JSON.stringify(newSite([{
    number: HOME, title: 'Dreamport: Test Function Homes', assignees: [{ login: 'pat-lead' }], labels: [{ name: 'new-dreamport' }, { name: NAME }], milestone: { number: 1, title: 'Test Function Homes Dreamport' },
    body: ['### Game', '', 'Test Function Homes', '', '### Game folder', '', NAME, '', '### Console', '', 'Game Boy Advance', '', '### Where it starts', '', 'Nowhere: it\'s made up.'].join('\n'),
  }], REPOSITORY)));
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(NAME), 'rom knows its copy');
  run = dp('proofs', VERSION, '--start');
  check(run.status === 0, 'its proofs start, so it\'s made a function at a time');
  check(groups().length === 400, `its code map makes ${groups().length} groups of functions, four times what GitHub holds under one issue`);

  console.log('Its first tasks:');
  run = dp('tasks', VERSION, '--repo', REPOSITORY);
  check(run.status === 0 && /A task for each of these 20 would go under the issues of its code's stretches, in its issue for C, under #900/.test(run.out) && /Functions 08000100 to 08000158: 12 of 12 to prove, in code 08000000 to 0800FFFF/.test(run.out) && /380 more groups of its functions come after, 20 open at once/.test(run.out) && site().issues.length === 1,
    'tasks lists the first twenty with where each would go, and opens nothing without a yes');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  let now = site();
  const inC = now.issues.find(issue => languageOfIssue(issue) === 'c'), stretch = now.issues.find(issue => stretchOfIssue(issue));
  check(run.status === 0 && /Opened 20 tasks/.test(run.out) && !/the bot hasn't put it under/.test(run.out) && openTasks().length === 20, `with a yes it opens them, each put under its home at once: ${last(run)}`);
  check(inC?.parent === HOME && inC.title === 'Test Function Homes Dreamport in C' && stretch?.parent === inC.number && stretch.title === 'Test Function Homes Dreamport in C, code 08000000 to 0800FFFF' && openTasks().every(task => task.parent === stretch.number),
    `the workflow opened the version's issue under the game's, and "${stretch?.title}" under it, with the twenty tasks`);
  check(inC.user.login === BOT && stretch.user.login === BOT && now.issues.filter(issue => issue.parent === HOME).length === 1, 'so the game\'s issue has one issue under it');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  check(run.status === 0 && /20 tasks of functions open already, under the issues of its code's stretches/.test(run.out) && site().issues.length === 23, 'a second run opens nothing while twenty are open');

  console.log('Finding, taking and claiming one:');
  run = dp('find', NAME, '--repo', REPOSITORY);
  check(run.status === 0 && /Free in C \(20\):/.test(run.out) && /#\d+ Functions 08000100 to 08000158 in C/.test(run.out) && /Functions proven in C: +0 of 1720/.test(run.out), 'find lists the twenty as free, wherever they are under the game\'s issue');
  run = dp('find', '--repo', REPOSITORY);
  check(run.status === 0 && new RegExp(`${NAME} .*20 free pieces`).test(run.out), 'and counts them in its list of every game');
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  const taken = Number(/Take #(\d+) Functions 08000100 to 08000158 in C/.exec(run.out)?.[1]);
  check(run.status === 0 && taken && /It's 12 functions of the original, 12 still to prove/.test(run.out), `find --take hands out the first: ${first(run)}`);
  gh('sam', 'POST', `/issues/${taken}/comments`, { body: '/claim' });
  now = site();
  check(now.issues.find(issue => issue.number === taken).assignees.some(a => a.login === 'sam') && /this task is yours/.test(now.issues.find(issue => issue.number === taken).comments.at(-1).body), 'the workflow grants a claim on it');
  gh('sam', 'POST', `/issues/${stretch.number}/comments`, { body: '/claim' });
  now = site();
  check(!now.issues.find(issue => issue.number === stretch.number).assignees.length && /holds the tasks of a stretch of a game's code/.test(now.issues.find(issue => issue.number === stretch.number).comments.at(-1).body), 'and refuses one on the stretch\'s issue, which is nobody\'s');
  run = dp('find', NAME, '--repo', REPOSITORY);
  check(/Claimed \(1\): +#\d+ Functions 08000100 to 08000158 in C: @sam/.test(run.out) && /Free in C \(19\):/.test(run.out), 'find shows it claimed, and nineteen free');
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  check(new RegExp(`Carry on with #${taken} `).test(run.out), `and find --take says to carry on with it: ${first(run)}`);
  // what the Make pages count, as src/lib/making.ts reads it: every issue under the game's, however deep
  const freeNow = async () => {
    const { request } = github(site());
    const pieces = await piecesUnder({ number: HOME }, issue => request('GET', `/issues/${issue.number}/sub_issues?per_page=100`).body);
    return { pieces, free: whatCanStart(pieces, {}, new Set(), { main: 'c' }).free.length };
  };
  check((await freeNow()).free === 19, 'the Make pages\' count of free tasks is nineteen too');
  run = dp('proofs', VERSION, '--check', '--task', '0x08000100');
  check(run.status === 1 && /12 of its 12 functions have no proof yet/.test(run.out), 'its task isn\'t done, as ready --task finds it');
  finish([site().issues.find(issue => issue.number === taken)]);
  run = dp('proofs', VERSION, '--check', '--task', '0x08000100');
  check(run.status === 0 && /each of its 12 functions has its proof/.test(run.out), 'and is, once each of its functions has its proof');

  console.log('The code map finds a function more:');
  const before = Object.fromEntries(openTasks().map(task => [task.number, { title: task.title, parent: task.parent }]));
  writeCodeMap(sha1, [...SMALL, ...APART, FOUND]);
  writeTwins([...SMALL, ...APART, FOUND]);
  check(groups().length === 401 && groups()[5].name === 'Functions 080002E0 to 08000330' && groups()[6].name === 'Functions 08000338 to 08000390', 'its group and each after it end one function sooner, so their names change');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  check(run.status === 0 && openTasks().length === 20 && /Opened 1 task/.test(run.out), `an open task is still its group's, by its first function, so only the one that closed is replaced: ${last(run)}`);
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--update', '--yes');
  const renamed = openTasks().filter(task => before[task.number] && before[task.number].title !== task.title);
  check(run.status === 0 && renamed.length === 15 && renamed.every(task => task.parent === before[task.number].parent) && openTasks().every(task => groupNamed(groups(), task.title).name === task.title.replace(/^Task: | in C$/g, '')),
    `tasks --update gives the ${renamed.length} whose groups moved their new names, each under the issue it was`);
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  check(/Take #\d+ Functions 08000160 to 080001B8 in C/.test(run.out), `and find goes on handing them out: ${first(run)}`);

  console.log('To its last task, twenty at a time:');
  let rounds = 0, refusedByTool = 0;
  for (; openTasks().length && rounds < 40; rounds++) {
    finish(openTasks());
    run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
    if (run.status !== 0 || /the bot hasn't put it under/.test(run.out)) refusedByTool++;
  }
  now = site();
  const tasks = now.issues.filter(issue => functionsOfTask(issue)), holders = now.issues.filter(holdsTasks), stretches = holders.filter(stretchOfIssue);
  const underOf = issue => now.issues.filter(each => each.parent === issue.number);
  check(!refusedByTool && !openTasks().length, `every run of tasks went through, ${rounds} of them`);
  check(tasks.length === 401 && tasks.every(task => task.state === 'closed'), `${tasks.length} tasks were opened and closed in all, one for each of its 401 groups`);
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  check(run.status === 0 && /Every function of test-function-homes\/c in the cartridge has its proof, so it needs no task/.test(run.out) && site().issues.length === now.issues.length, `and nothing is left to open: ${last(run)}`);
  const home = task => now.issues.find(issue => issue.number === task.parent);
  check(tasks.every(task => stretchOfIssue(home(task))?.from === stretchOf(functionsOfTask(task).first).from), 'each task is under the issue of the stretch its first function is in');
  check(Math.max(...now.issues.map(issue => underOf(issue).length)) === MOST_UNDER && !now.refused.length, `no issue has more than ${MOST_UNDER} under it, and GitHub never had to refuse one`);
  const full = stretches.filter(issue => stretchOfIssue(issue).from === CARTRIDGE);
  check(full.length === 2 && underOf(full[0]).length === MOST_UNDER && underOf(full[1]).length === 21 && full[1].title.endsWith('code 08000000 to 0800FFFF, 2'), `the stretch with 121 tasks has two issues, of ${full.map(issue => underOf(issue).length).join(' and ')}: "${full[1]?.title}"`);
  check(stretches.length === 11 && underOf(inC).length === 11 && underOf({ number: HOME }).length === 1, `${stretches.length} issues of stretches are under the version's issue, and that one alone under the game's`);
  const { pieces, free } = await freeNow();
  check(pieces.length === 401 && free === 0, 'the tools, the workflow and the Make pages read all of them from the game\'s issue down, with none free');
  run = dp('find', NAME, '--repo', REPOSITORY);
  check(run.status === 0 && /Done \(401\)/.test(run.out) && /Functions proven in C: +1721 of 1721/.test(run.out), 'find counts them all as done, and every function as proven');
  const elsewhere = now.log.filter(line => / elsewhere: /.test(line) && !/^GET elsewhere: repos\/[\w.-]+\/[\w.-]+\/forks\?/.test(line));
  check(!elsewhere.length, `nothing was asked of any repository but the stand-in${elsewhere.length ? `: ${elsewhere[0]}` : ''}`);
} finally {
  tidy();
  if (copies) writeFileSync(COPIES, copies);
  else rmSync(COPIES, { force: true });
}
check(!existsSync(gameFolder(NAME)), 'nothing is left behind');

rmSync(work, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nA big game\'s tasks of functions each have a home, and no issue holds more than GitHub lets it.');
