// npm run test:function-tasks: a game made a function at a time, from its first day to a task done, through the tools
// as they're typed, with a program of the project's own (twin/program.c) as the game, so it needs nobody's copy of
// anything. The console's compiler builds the program into a made-up cartridge, and the same C is the game's version
// in C, in games/ for as long as this takes. GitHub is a stand-in: a small program named gh that keeps issues in a
// file, so nothing is opened anywhere.
//
// What it shows: `match` and `twin` keep nothing for a version made a part at a time, as every game on main is;
// after `proofs --start` each keeps what it proves, and nothing else is taken for a proof; a proof goes stale once
// its twin's code or a header changes; a twin with a stop is never kept as proven; `tasks` opens the game's tasks
// from its code map, `find --take` hands one out and stops handing it out once its functions are proven; and
// `proofs --check --task`, which is how `ready` says a task is done, passes only then.

import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { withBuildTools } from '../gba/build.mjs';
import { buildCompilers, isCompilerBuilt } from '../gba/agbcc.mjs';
import { addressFinder, matchFile } from '../gba/match.mjs';
import { ensureCaller } from '../gba/twin.mjs';
import { firstFiles } from '../lib/new-game.mjs';
import { formatCodeMap, hex } from '../lib/proof-files.mjs';
import { proofLines, recordingsAt, standProblems, stepProofs } from '../lib/proven-step.mjs';
import { cartridge, compiler, FUNCTIONS, NAMED, VIA } from './twin/cartridge.mjs';

const HERE = fileURLToPath(new URL('./twin/', import.meta.url));
const NAME = 'test-function-tasks', VERSION = `${NAME}/c`, REPOSITORY = 'stand-in/dreamports', HOME = 900;
const work = join(LOCAL, 'tmp', 'function-tasks-test'), COPIES = join(LOCAL, 'copies.json');
const source = join(gameFolder(VERSION), 'src', 'program.c'), header = join(gameFolder(VERSION), 'src', 'program.h');
const proofs = join(proofFolder(VERSION), 'proofs.json');

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};
const last = run => run.out.trim().split('\n').at(-1);

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
    cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 24, env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, STAND_IN_GITHUB: github },
  });
  return { status, out: stdout + stderr };
};
const kept = () => JSON.parse(readFileSync(proofs, 'utf8')).functions;
const issues = () => JSON.parse(readFileSync(github, 'utf8'));
const tidy = () => { for (const path of [gameFolder(NAME), join(LOCAL, 'match', NAME), join(LOCAL, 'tasks', `${NAME}.lock`)]) rmSync(path, { recursive: true, force: true }); };
// the program's own text, with one thing replaced, written as the game's
const program = readFileSync(join(HERE, 'program.c'), 'utf8');
const write = (...replaced) => {
  let text = program;
  for (const [from, to] of replaced) {
    if (!text.includes(from)) throw new Error(`The program has no "${from}" for the test to change.`);
    text = text.replace(from, to);
  }
  writeFileSync(source, text);
};

rmSync(work, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });
if (!isCompilerBuilt(compiler.name)) withBuildTools(console.log, tools => buildCompilers([compiler.name], console.log, tools));
ensureCaller(console.log);
const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
tidy();
try {
  console.log('A game of the project\'s own, in games/ for as long as this takes:');
  const addressOf = addressFinder({ named: NAMED });
  const built = await matchFile({
    file: join(HERE, 'program.c'), compiler, work: join(work, 'built', 'program'), addressOf: name => addressOf(name) ?? VIA[name] ?? null,
    sizeOf: () => null, original: (address, bytes) => ({ bytes: Buffer.alloc(bytes) }),
  });
  check(!built.error, `the program builds with ${compiler.name}${built.error ? `: ${built.error}` : ''}`);
  if (built.error) process.exit(1);
  const copy = join(work, 'cartridge.gba'), rom = cartridge(readFileSync(join(work, 'built', 'program.s'), 'utf8'));
  writeFileSync(copy, rom);
  const original = { console: 'gba', name: 'Test Function Tasks (World)', title: 'MADE UP GAME', code: 'MADE', sha1: createHash('sha1').update(rom).digest('hex'), compiler };
  const files = firstFiles(NAME, original, { language: 'c', issue: HOME, lead: 'pat-lead', added: '2026-11-17' });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(NAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(NAME), file), text);
  }
  rmSync(join(gameFolder(VERSION), 'src', 'main.c'));
  mkdirSync(proofFolder(NAME), { recursive: true });
  writeFileSync(join(proofFolder(NAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  writeFileSync(join(proofFolder(NAME), 'code-map.json'), formatCodeMap({
    original: original.sha1, from: 'The test\'s own program',
    functions: built.functions.filter(f => FUNCTIONS[f.name]).map(f => ({ address: FUNCTIONS[f.name], size: f.length })).sort((a, b) => a.address - b.address),
  }));
  writeFileSync(join(proofFolder(NAME), 'addresses.json'), `${JSON.stringify({ about: 'The test\'s own names.', addresses: Object.fromEntries([...NAMED, ...Object.entries(VIA)].map(([name, address]) => [name, hex(address)])) }, null, 2)}\n`);
  cpSync(join(HERE, 'program.h'), header);
  write();
  writeFileSync(join(bin, 'gh'), GH);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(github, JSON.stringify({
    next: HOME + 1, log: [],
    issues: [{ number: HOME, title: 'Dreamport: Test Function Tasks', state: 'open', assignees: [{ login: 'pat-lead' }], body: ['### Game', '', 'Test Function Tasks', '', '### Game folder', '', NAME, '', '### Console', '', 'Game Boy Advance', '', '### Where it starts', '', 'A ball falling.'].join('\n') }],
  }));
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(NAME), 'rom knows its copy');
  run = dp('portmap', VERSION);
  check(run.status === 0 && /8 functions named/.test(run.out), `its code names all eight functions of its code map: ${last(run)}`);

  console.log('Made a part at a time, as every game was until now:');
  run = dp('match', VERSION);
  check(run.status === 0 && /8 of 8 functions the same/.test(run.out) && !/kept as proven/.test(run.out) && !existsSync(proofs), `match says what's the same and keeps nothing: ${last(run)}`);
  run = dp('proofs', VERSION);
  check(run.status === 1 && /keeps no proofs: it's made a part at a time/.test(run.out), 'proofs says it keeps none');
  run = dp('ready', VERSION, '--task', '08000200');
  check(run.status === 1 && /keeps no proofs, so it has no task of functions/.test(run.out), 'and ready has no task of functions to go by');

  console.log('Made a function at a time, from proofs --start on:');
  run = dp('proofs', VERSION, '--start');
  check(run.status === 0 && existsSync(proofs) && kept().length === 0, `its proofs start with none: ${last(run).slice(0, 90)}…`);
  run = dp('proofs', VERSION);
  check(run.status === 0 && /0 of 8 functions proven/.test(run.out) && /Functions 08000200 to 08000380 +0 of 8 proven/.test(run.out), 'its eight functions are one task, none proven');
  run = dp('proofs', VERSION, '--check', '--task', '0x08000244');
  check(run.status === 1 && /8 of its 8 functions have no proof yet/.test(run.out) && /isn't done until each of its functions has its proof/.test(run.out), 'a task with nothing proven isn\'t done, named by any address in it');
  run = dp('match', VERSION, '--addresses', join(proofFolder(NAME), 'addresses.json'));
  check(run.status === 0 && /Nothing was kept as proven: --addresses is for trying a file out/.test(run.out) && kept().length === 0, 'a try with names from another file keeps nothing');
  run = dp('match', VERSION);
  check(run.status === 0 && /8 functions kept as proven by the same bytes/.test(run.out) && kept().length === 8 && kept().every(line => line[1] === 'bytes' && line.length === 4), `match keeps each function it finds the same: ${last(run)}`);
  const asMatchLeft = readFileSync(proofs, 'utf8');
  run = dp('proofs', VERSION, '--check', '--task', 'Functions 08000200 to 08000380');
  check(run.status === 0 && /each of its 8 functions has its proof/.test(run.out), `and the task is done: ${last(run)}`);
  run = dp('proofs', VERSION, '08000300');
  check(run.status === 0 && /0x08000300 +\d+ bytes  Step, src\/program\.c:\d+: proven by the same bytes/.test(run.out), 'each function says its twin, where it is and its proof');
  run = dp('match', VERSION);
  check(run.status === 0 && readFileSync(proofs, 'utf8') === asMatchLeft, 'proving it all again writes the same file');

  console.log('A proof goes stale:');
  write(['counted each time it gets there. */', 'counted each time it gets to it. */']);
  run = dp('proofs', VERSION, '--check');
  check(run.status === 0, 'not when a twin\'s comment changes');
  write(['if (y > FLOOR)', 'if (y >= FLOOR)']);
  run = dp('proofs', VERSION, '--check');
  check(run.status === 1 && /08000200, Fall in src\/program\.c, is kept as proven and its twin, or a header or another line of its file, changed since/.test(run.out) && !/Scale/.test(run.out), `when a twin's code changes, its own proof and no other's: ${run.out.trim().split('\n')[0]}`);
  run = dp('proofs', VERSION, '08000200');
  check(/Fall, src\/program\.c:\d+: not proven: its twin changed since its proof/.test(run.out) && /7 proven/.test(run.out), 'and it counts as not proven meanwhile');
  writeFileSync(proofs, asMatchLeft.replace(/\["08000200", "bytes", "[0-9a-f]{16}"/, '["08000200", "bytes", "0123456789abcdef"'));
  run = dp('proofs', VERSION, '--check');
  check(run.status === 1 && /08000200/.test(run.out), 'a line written by hand doesn\'t pass for a proof');
  run = dp('match', VERSION);
  check(run.status === 0 && /7 of 8 functions the same/.test(run.out) && kept().length === 7 && !kept().some(line => line[0] === '08000200'), `match finds the changed twin differs, and its line goes: ${last(run)}`);
  run = dp('proofs', VERSION, '--check', '--task', '08000200');
  check(run.status === 1 && /1 of its 8 functions has no proof yet/.test(run.out), 'so its task isn\'t done any more');
  write();
  writeFileSync(header, readFileSync(join(HERE, 'program.h'), 'utf8').replace('#define FLOOR 152', '#define FLOOR 150'));
  run = dp('proofs', VERSION, '--check');
  check(run.status === 1 && (run.out.match(/changed since/g) ?? []).length === 7, 'a header of the file changed makes every proof of the file stale');
  cpSync(join(HERE, 'program.h'), header);
  check(dp('proofs', VERSION, '--check').status === 0, 'and they hold again with the header as it was');

  console.log('The same memory, and a path left out:');
  run = dp('twin', VERSION, '--calls', '300', '--frames', '2');
  check(run.status === 0 && /Nothing was kept as proven: a proof by the same memory is over 1,000 calls or more/.test(run.out) && kept().length === 7, 'a few calls are no proof');
  run = dp('twin', VERSION, 'Fall', '--frames', '2', '--calls', '1000');
  check(run.status === 0 && /1 function kept as proven by the same memory/.test(run.out) && JSON.stringify(kept().find(line => line[0] === '08000200')?.slice(0, 2)) === '["08000200","memory"]' && kept().find(line => line[0] === '08000200')[4] === 1000,
    `twin keeps a function whose calls took every path of the original's: ${last(run)}`);
  run = dp('twin', VERSION, '--frames', '2', '--calls', '1000');
  check(run.status === 0 && /7 functions already proven by the same bytes, the stronger proof, which stays/.test(run.out) && kept().filter(line => line[1] === 'bytes').length === 7, `and leaves the same bytes where a function has them: ${last(run)}`);
  run = dp('proofs', VERSION);
  check(/8 of 8 functions proven, 7 by the same bytes and 1 by the same memory/.test(run.out), 'the version says how many functions have each proof');
  // a twin with its floor's path left out, and marked as the standard asks
  write(['  if (y > FLOOR) {\n    y = FLOOR;\n    gBall.hits++;\n  }', '  // dp:stop 0x08000210']);
  run = dp('twin', VERSION, 'Fall', '--frames', '2', '--calls', '1000');
  check(run.status === 3 && /Differs/.test(run.out) && !kept().some(line => line[0] === '08000200'), 'a twin with a path left out differs once a call takes it, and loses its proof');
  write(['gBall.y = y;', 'gBall.y = y; // dp:stop 0x08000210']);
  run = dp('match', VERSION);
  check(run.status === 0 && /8 of 8 functions the same/.test(run.out) && /1 function not kept as proven: 08000200 has a stop in its twin/.test(run.out) && kept().length === 7, `and a twin with a stop is never kept as proven, even one that matches: ${last(run)}`);
  run = dp('proofs', VERSION, '08000200');
  check(/Fall, src\/program\.c:\d+: not proven: its twin has a stop, a path marked as left out/.test(run.out), 'which its task says');

  console.log('Its tasks, against a stand-in for GitHub:');
  run = dp('tasks', VERSION, '--repo', REPOSITORY);
  check(run.status === 0 && /Functions 08000200 to 08000380: 1 of 8 to prove/.test(run.out) && /Nothing was opened/.test(run.out) && issues().issues.length === 1, 'tasks lists the group with something to prove, and opens nothing without a yes');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  const opened = issues().issues.find(issue => issue.number === HOME + 1);
  check(run.status === 0 && opened?.title === 'Task: Functions 08000200 to 08000380 in C' && /- `08000200`, \d+ bytes: `Fall` in `src\/program\.c`, not proven: its twin has a stop/.test(opened.body) && /- `08000300`, \d+ bytes: `Step` in `src\/program\.c`, proven by the same bytes/.test(opened.body),
    `with a yes it opens the task, which says where each function stands: ${last(run)}`);
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
  check(run.status === 0 && issues().issues.length === 2 && /1 task of functions open already/.test(run.out), 'and doesn\'t open it twice');
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  check(run.status === 0 && new RegExp(`Take #${HOME + 1} Functions 08000200 to 08000380 in C`).test(run.out) && /It's 8 functions of the original, 1 still to prove: npm run dp -- proofs test-function-tasks\/c 08000200 lists them/.test(run.out) && /done when npm run dp -- ready test-function-tasks\/c --task 08000200/.test(run.out),
    `find hands the task out, with what it's made of and when it's done: ${run.out.trim().split('\n')[0]}`);
  run = dp('find', NAME, '--repo', REPOSITORY);
  check(run.status === 0 && /Functions proven in C: +7 of 8, 7 by the same bytes and 0 by the same memory/.test(run.out), 'and says how many of the game\'s functions have each proof');
  write();
  run = dp('match', VERSION);
  check(run.status === 0 && kept().length === 8, 'with the path written, match keeps the function again');
  // a step that only proves functions, in a game with no recording, shows its proofs in a clip's place
  // (lib/proven-step.mjs): held to the files as they are, against a main that doesn't have them
  const shown = () => stepProofs(VERSION, 'HEAD');
  let step = shown();
  check(step.keeps && !step.problems.length && step.functions.length === 8 && step.functions.every(f => f.kind === 'bytes') && !standProblems(VERSION, step, { main: recordingsAt(VERSION, 'HEAD'), now: 0 }, proofLines('Test Function Tasks in C', step.functions)).length,
    `its eight proven twins stand in for a clip, each named with its proof${step.problems.length ? `: ${step.problems[0]}` : ''}`);
  check(/- `Fall`, 0x08000200: the same bytes/.test(proofLines('Test Function Tasks in C', step.functions)), 'and the pull request\'s line names each function, its address and its kind of proof');
  write(['#include "program.h"', '#include "program.h"\n#define FLOOR 150']);
  step = shown();
  check(dp('proofs', VERSION, '--check').status === 1 && step.problems.length === 8 && step.problems.every(problem => /is of other code/.test(problem)), 'a line of the file outside its functions changed after the proofs makes each stale, and they stand in no more');
  write(['if (y > FLOOR)', 'if (y >= FLOOR)']);
  step = shown();
  check(step.problems.length === 1 && /^Fall, in src\/program\.c, has a line in proofs\.json that is of other code: it changed after its proof/.test(step.problems[0]) && step.functions.length === 7, 'and neither does a twin changed after its proof');
  write(['gBall.y = y;', 'gBall.y = y; // dp:stop 0x08000210']);
  step = shown();
  check(step.problems.length === 1 && /^Fall, in src\/program\.c, has a stop in it/.test(step.problems[0]), 'nor a twin with a stop');
  write();
  const glue = join(gameFolder(VERSION), 'src', 'main.c');
  writeFileSync(glue, '#include "program.h"\nvoid game_step(void) { Fall(); }\n');
  step = shown();
  check(step.problems.some(problem => /^game_step, in src\/main\.c, isn't a twin, so no proof is of it/.test(problem)), 'nor a step that also writes code that is no twin, such as the game\'s main.c');
  rmSync(glue);
  writeFileSync(proofs, readFileSync(proofs, 'utf8').replace(/\["08000300","bytes","[0-9a-f]{16}"/, '["08000300","bytes","0123456789abcdef"'));
  step = shown();
  check(step.problems.length === 1 && /^Step, in src\/program\.c, has a line in proofs\.json that is of other code/.test(step.problems[0]), 'nor a line written by hand');
  run = dp('match', VERSION);
  check(run.status === 0 && kept().length === 8 && !shown().problems.length, 'and proven again by match, they stand in again');
  run = dp('tasks', VERSION, '--repo', REPOSITORY, '--update', '--yes');
  check(run.status === 0 && /- `08000200`, \d+ bytes: `Fall` in `src\/program\.c`, proven by the same bytes/.test(issues().issues.find(issue => issue.number === HOME + 1).body), 'tasks --update writes the open task again from where its functions stand');
  run = dp('find', NAME, '--take', '--repo', REPOSITORY);
  check(run.status === 0 && /Nothing can be taken now/.test(run.out) && !/Take #/.test(run.out), `a task whose functions are all proven isn't handed out: ${run.out.trim().split('\n')[0]}`);
  // find looks for the lead's team build among the repository's forks, which the stand-in answers too, with none
  const elsewhere = issues().log.filter(line => !/^(GET|POST|PATCH) (repos\/stand-in\/dreamports\/|user$)|^GET repos\/[\w.-]+\/[\w.-]+\/forks\?/.test(line));
  check(!elsewhere.length && issues().log.filter(line => /^(POST|PATCH)/.test(line)).length === 2, `one task was opened and written again, in the stand-in and nowhere else${elsewhere.length ? `: ${elsewhere[0]}` : ''}`);
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
console.log('\nA game made a function at a time keeps each proof it\'s given, and its tasks go by them.');
