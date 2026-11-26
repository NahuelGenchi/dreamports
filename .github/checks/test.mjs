// Tests of which checks a pull request starts (checks.mjs): what a change to the docs, to a tool, to a game and to a kit
// starts and leaves out, that nothing a test's script imports escapes that test, that every command of Check is in the
// map and every console's workflow has the paths the map gives it, and how Check's workflow reads the answer.
// npm run check runs them, against the repository as it is and against made-up ones.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { CONSOLES } from '../../kit/consoles.js';
import { BUILT, IDS, OWN_TESTS, PARTS, PATCHES, SERVED, WORKFLOWS, consolesOfGame, consolesOwning, named, partsFor, pathsOf, reached, repository, scriptOf, stalePaths, starts, targets, toolsStarted, withPaths, workflowsFor } from './checks.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const repo = repository(ROOT);
const all = targets(repo);
const scripts = JSON.parse(repo.text('package.json')).scripts;

// what a change to these files starts in Check, as "part: script script", and the commands alone
const started = (...files) => partsFor(files, repo, all).parts.map(({ part, run }) => `${part}: ${run.split('\n').map(scriptOf).join(' ')}`);
const commands = (...files) => partsFor(files, repo, all).parts.flatMap(({ run }) => run.split('\n'));
const partsOf = (...files) => partsFor(files, repo, all).parts.map(({ part }) => part);

// a made-up repository: its files and their text
const made = files => ({ files: Object.keys(files), text: file => files[file] ?? null });

test('a change to the docs alone starts only the light part', () => {
  assert.deepEqual(started('docs/STATUS.md', 'README.md', 'docs/HISTORY.md', '.github/readme/progress/sonic-advance.svg'), ['light: check']);
  assert.deepEqual(started('CONTRIBUTING.md', 'tools/README.md', 'AGENTS.md', '.github/ISSUE_TEMPLATE/task.yml'), ['light: check']);
  assert.deepEqual(started('tools/commands/dreamport.md', '.claude/skills/dreamport/SKILL.md'), ['light: check']);
  assert.deepEqual(workflowsFor(['docs/STATUS.md', 'README.md', 'tools/README.md'], repo, all), []);
});

test('the status table\'s tool and its tests start no emulator', () => {
  // what #2041 changed
  const changed = ['docs/STATUS.md', 'README.md', 'games/README.md', 'docs/HISTORY.md', 'tools/readme.mjs', 'tools/test/merge-main.test.mjs'];
  assert.deepEqual(started(...changed), ['light: check']);
  assert.deepEqual(workflowsFor(changed, repo, all), []);
  // each file that starts none of the tests it's reached by has tests of its own in npm run check
  for (const file of Object.keys(OWN_TESTS)) {
    assert.ok(repo.files.includes(file), `${file} is in OWN_TESTS and isn't a file`);
    assert.ok(scripts.check.includes(`dp.mjs ${file.slice('tools/'.length, -'.mjs'.length)} --check`), `npm run check doesn't run ${file}'s own check`);
  }
});

test('a tool the tests start is theirs, and one they never start is not',() => {
  // prove is started by the tests of the kits, and help by none
  assert.ok(partsOf('tools/prove.mjs').includes('ps1 kit') && partsOf('tools/prove.mjs').includes('part tasks'));
  assert.deepEqual(started('tools/help.mjs'), ['light: check']);
  assert.deepEqual(started('tools/commands.mjs'), ['light: check']);
  // a test of the tools alone, which npm run check runs
  assert.deepEqual(started('tools/test/summary.test.mjs'), ['light: check']);
});

test('a game starts the site and its own console\'s tests, and no other console\'s', () => {
  const gba = commands('games/sonic-advance/c/src/main.c', 'games/sonic-advance/proof/progress.json');
  assert.ok(gba.includes('npm run check') && gba.includes('npm run build'));
  for (const run of ['npm run test:twin', 'npm run test:match', 'npm run test:same-memory', 'npm run test:part-tasks -- gba']) assert.ok(gba.includes(run), run);
  assert.deepEqual(gba.filter(run => /snes|ps1|ps2|n64|gamecube|nes|gb-|real-gb/.test(run)), []);
  assert.deepEqual(partsOf('games/sonic-advance/c/src/main.c'), ['light', 'site', 'consoles', 'functions', 'tasks', 'part tasks']);

  const nes = commands('games/mega-man/c/src/main.c');
  for (const run of ['npm run build', 'npm run test:real-console', 'npm run test:nes-twin', 'npm run test:nes-libraries', 'npm run test:part-tasks -- nes']) assert.ok(nes.includes(run), run);
  assert.deepEqual(nes.filter(run => /snes|ps1|ps2|n64|gamecube|test:twin|test:match|gba|gb-|real-gb/.test(run)), []);

  assert.deepEqual(partsOf('games/the-sims/c/src/main.c'), ['light', 'site', 'ps2', 'ps2 programs']);
  // no console's workflow reads a game
  assert.deepEqual(workflowsFor(['games/sonic-advance/c/src/main.c', 'games/mega-man/entry.md', 'public/media/sonic-advance-still.webp'], repo, all), []);
});

test('a game\'s console is its entry\'s platform, and a game whose console nobody knows starts every console\'s tests', () => {
  assert.deepEqual(consolesOfGame('sonic-advance', repo), ['gba']);
  assert.deepEqual(consolesOfGame('mega-man', repo), ['nes']);
  assert.deepEqual(consolesOfGame('the-sims', repo), ['ps2']);
  // every game here names a console the map knows
  for (const game of readdirSync(`${ROOT}games`, { withFileTypes: true }).filter(each => each.isDirectory())) assert.ok(consolesOfGame(game.name, repo), `${game.name}'s platform isn't a console's name`);
  const entry = platform => made({ 'games/new-game/entry.md': `---\ntitle: New\nplatform: ${platform}\nkit: c\n---\n` });
  assert.deepEqual(consolesOfGame('new-game', entry('Game Boy')), ['gb']);
  assert.deepEqual(consolesOfGame('new-game', entry('"Nintendo 64"')), ['n64']);
  assert.equal(consolesOfGame('new-game', entry('A console never made')), null);
  assert.equal(consolesOfGame('gone', entry('NES')), null);
  // a folder with no entry, as when a game is taken away
  const every = all.commands.filter(command => !command.always && !command.site);
  for (const command of every) assert.ok(starts('games/a-game-with-no-entry/src/main.c', command, repo), command.run);
});

test('what every kit in C is built on starts each test that builds a game in C, and a console\'s kit only its own', () => {
  const base = commands('kit/c/kit.c');
  // each console's kit and function check, and the site
  for (const run of ['npm run build', 'npm run test:c-kit', 'npm run test:n64-kit', 'npm run test:ps1-kit', 'npm run test:snes-kit -- --half 2', 'npm run test:real-gb', 'npm run test:twin', 'npm run test:part-tasks -- nes']) assert.ok(base.includes(run), run);
  // and not the compilers' own tests, which build no game on the kit
  for (const run of ['npm run test:ps1-gcc', 'npm run test:ps1-call']) assert.ok(!base.includes(run), run);
  assert.deepEqual(workflowsFor(['kit/c/kit.c'], repo, all).sort(), Object.keys(WORKFLOWS).sort());

  assert.deepEqual(partsOf('kit/snes/c/ppu.c'), ['light', 'site', 'snes', 'snes kit']);
  assert.deepEqual(workflowsFor(['kit/snes/c/ppu.c'], repo, all), ['snes-n64.yml']);
  assert.deepEqual(workflowsFor(['kit/gbc/README.md'], repo, all), ['gb.yml']);
  assert.deepEqual(partsOf('tools/libretro/snes9x.patch'), ['light', 'site', 'snes', 'snes kit']);
  assert.deepEqual(workflowsFor(['tools/libretro/pcsx.patch'], repo, all), ['ps1.yml']);
  // a kit for a console the map doesn't know yet
  assert.equal(partsOf('kit/a-new-console/c/kit.c').length, PARTS.length);
});

test('the site\'s own files start its build and no emulator', () => {
  assert.deepEqual(started('src/pages/index.astro', 'src/styles/site.css', 'public/media/sonic-advance.av1.mp4', 'worker/index.ts'), ['light: check', 'site: build']);
  assert.deepEqual(workflowsFor(['src/pages/index.astro', 'src/lib/systems.ts'], repo, all), []);
});

test('what decides the tests, and a file nothing knows, start everything', () => {
  for (const file of ['package.json', 'package-lock.json', '.github/workflows/check.yml', '.github/checks/checks.mjs', '.github/stack/stack.mjs', '.node-version', 'a-new-file-at-the-top', 'tools/test/a-new-program.c', 'tools/a-new-folder/data.bin']) {
    const { parts } = partsFor([file], repo, all);
    assert.deepEqual(parts.map(({ part }) => part), PARTS.map(({ part }) => part), file);
    assert.deepEqual(parts.map(({ run }) => run), PARTS.map(part => part.commands.map(({ run }) => run).join('\n')), file);
  }
  // and so does a pull request whose files nobody knows
  assert.equal(partsFor(null, repo, all).parts.length, PARTS.length);
  // a workflow starts on its own file, and not on another's
  assert.deepEqual(workflowsFor(['.github/workflows/nes.yml'], repo, all), ['nes.yml']);
  assert.deepEqual(workflowsFor(['package-lock.json'], repo, all).sort(), Object.keys(WORKFLOWS).sort());
});

test('the light part is in every answer, so Check always has a job to wait for', () => {
  for (const changed of [[], ['docs/STATUS.md'], ['kit/c/kit.c'], null]) assert.deepEqual(partsFor(changed, repo, all).parts[0], { part: 'light', run: 'npm run check' });
  assert.deepEqual(partsFor(['kit/gba/c/clock.c'], repo, all).parts.find(({ part }) => part === 'part tasks'), { part: 'part tasks', minutes: 30, run: 'npm run test:part-tasks -- gba' });
});

test('nothing a test\'s script reaches escapes that test', () => {
  for (const target of [...all.commands, ...all.workflows]) {
    const name = target.run ?? target.workflow;
    for (const file of target.reaches) assert.ok(starts(file, target, repo), `${name} reaches ${file}, and a change to it doesn't start it`);
  }
  // the scripts are read as they import: a test of the function check reaches its console's check and the tools it starts
  const twin = all.commands.find(({ run }) => run === 'npm run test:nes-twin').reaches;
  for (const file of ['tools/test/nes-twin.mjs', 'tools/test/made-up-nes.mjs', 'tools/nes/twin.mjs', 'tools/dp.mjs', 'tools/twin.mjs', 'tools/lib/taking.mjs', 'kit/consoles.js']) assert.ok(twin.has(file), file);
  assert.ok(!twin.has('tools/readme.mjs') && !twin.has('tools/help.mjs'));
});

test('a script reaches what it imports, the scripts it names as text, and the tools it starts by name', () => {
  const files = {
    'tools/dp.mjs': 'const TOOLS = {\n  prove: \'Plays\',\n  help: \'Prints\',\n  ready: \'Everything\',\n};\nconst { run } = await import(`./${tool}.mjs`);\nimport(\'./lib/taking.mjs\');',
    'tools/prove.mjs': 'import { a } from \'./lib/a.mjs\';\nconst CHECKS = { gba: \'./gba/twin.mjs\' };',
    'tools/ready.mjs': 'spawn(node, [join(REPO, \'tools\', \'dp.mjs\'), \'help\']);',
    'tools/help.mjs': '',
    'tools/lib/a.mjs': 'export { b } from "../lib/b.mjs";\nnew Worker(new URL(\'./worker.mjs\', import.meta.url));',
    'tools/lib/b.mjs': '',
    'tools/lib/taking.mjs': '',
    'tools/lib/worker.mjs': '',
    'tools/gba/twin.mjs': '',
    'tools/test/one.mjs': 'import \'./made-up.mjs\';\nconst dp = (...args) => spawnSync(node, [join(REPO, \'tools\', \'dp.mjs\'), ...args]);\ndp(\'prove\', game);',
    'tools/test/made-up.mjs': 'await import(`./parts/${id}.mjs`);',
    'tools/test/parts/gba.mjs': '',
    'tools/test/parts/nes.mjs': '',
    'tools/test/parts/notes.txt': '',
    'tools/test/two.mjs': 'import \'../lib/b.mjs\';\nimport \'../lib/gone.mjs\';',
  };
  const repository = made(files);
  assert.deepEqual([...named('tools/lib/a.mjs', files['tools/lib/a.mjs'], repository.files)].sort(), ['tools/lib/b.mjs', 'tools/lib/worker.mjs']);
  assert.deepEqual([...named('tools/test/made-up.mjs', files['tools/test/made-up.mjs'], repository.files)].sort(), ['tools/test/parts/gba.mjs', 'tools/test/parts/nes.mjs']);
  // the tool asked for, and never every tool there is
  assert.deepEqual([...named('tools/dp.mjs', files['tools/dp.mjs'], repository.files)], ['tools/lib/taking.mjs']);
  assert.deepEqual(toolsStarted(new Set(['tools/test/one.mjs', 'tools/dp.mjs']), repository), ['tools/prove.mjs']);
  // prove, and nothing of ready, which the test never starts
  assert.deepEqual([...reached(['tools/test/one.mjs'], repository)].sort(), ['tools/dp.mjs', 'tools/gba/twin.mjs', 'tools/lib/a.mjs', 'tools/lib/b.mjs', 'tools/lib/taking.mjs', 'tools/lib/worker.mjs', 'tools/prove.mjs', 'tools/test/made-up.mjs', 'tools/test/one.mjs', 'tools/test/parts/gba.mjs', 'tools/test/parts/nes.mjs']);
  // a tool that starts the tools starts the ones it names
  assert.deepEqual([...reached(['tools/ready.mjs'], repository)].sort(), ['tools/dp.mjs', 'tools/help.mjs', 'tools/lib/taking.mjs', 'tools/ready.mjs']);
  // a file that is imported and isn't there stays, so taking it away starts the test
  assert.ok(reached(['tools/test/two.mjs'], repository).has('tools/lib/gone.mjs'));
});

test('each console owns its kit, its tools, its tests and its emulator\'s patch', () => {
  assert.deepEqual(consolesOwning('kit/gba/c/clock.c'), ['gba']);
  assert.deepEqual(consolesOwning('kit/gbc/c/kit.c'), ['gb', 'gbc']);
  assert.deepEqual(consolesOwning('tools/gbc/sm83.mjs'), ['gb', 'gbc']);
  assert.deepEqual(consolesOwning('tools/test/gb-twin/twins.c'), ['gb', 'gbc']);
  assert.deepEqual(consolesOwning('tools/test/gba-same.mjs'), ['gba']);
  assert.deepEqual(consolesOwning('tools/test/made-up-gb.c'), ['gb', 'gbc']);
  assert.deepEqual(consolesOwning('tools/test/made-up-gamecube-rel.mjs'), ['gamecube']);
  assert.deepEqual(consolesOwning('tools/test/made-up-game.mjs'), []);
  assert.deepEqual(consolesOwning('tools/test/ps1-kit/program.c'), ['ps1']);
  assert.deepEqual(consolesOwning('tools/test/ps2-frames.c'), ['ps2']);
  assert.deepEqual(consolesOwning('tools/test/real-ps2.mjs'), ['ps2']);
  assert.deepEqual(consolesOwning('tools/test/real-console.mjs'), []);
  assert.deepEqual(consolesOwning('tools/test/part-tasks/n64.mjs'), ['n64']);
  assert.deepEqual(consolesOwning('tools/test/part-tasks/n64/twins.c'), ['n64']);
  assert.deepEqual(consolesOwning('tools/test/part-tasks/nes.mjs'), ['nes']);
  assert.deepEqual(consolesOwning('tools/libretro/parallel-n64.patch'), ['n64']);
  assert.deepEqual(consolesOwning('public/systems/nds.svg'), ['nds']);
  assert.deepEqual(consolesOwning('tools/lib/c.mjs'), []);
  // every patch there is has its console, and every console named is one
  const patches = repo.files.map(file => /^tools\/libretro\/([^/]+)\.patch$/.exec(file)?.[1]).filter(Boolean);
  assert.deepEqual(patches.sort(), Object.keys(PATCHES).sort());
  for (const id of [...Object.values(PATCHES).flat(), ...Object.values(WORKFLOWS).flatMap(({ of }) => of), ...PARTS.flatMap(part => part.commands.flatMap(command => command.of ?? []))]) assert.ok(IDS.includes(id) && CONSOLES[id], id);
  // and every file that reads beside its imports is a file
  for (const reader of [...Object.keys(BUILT), ...Object.keys(SERVED)]) assert.ok(repo.files.includes(reader), reader);
});

test('every command of Check is a script, once, and every test script runs somewhere', () => {
  const runs = PARTS.flatMap(part => part.commands.map(({ run }) => run));
  assert.equal(new Set(runs).size, runs.length);
  assert.equal(new Set(PARTS.map(({ part }) => part)).size, PARTS.length);
  for (const run of runs) assert.ok(scripts[scriptOf(run)], `${run} isn't a script of package.json`);
  // a test nobody starts proves nothing: each is in Check or in a workflow
  const workflows = readdirSync(`${ROOT}.github/workflows`).map(name => readFileSync(`${ROOT}.github/workflows/${name}`, 'utf8')).join('\n');
  const nowhere = Object.keys(scripts).filter(script => script.startsWith('test:') && !runs.some(run => scriptOf(run) === script) && !workflows.includes(`npm run ${script}`));
  // npm run test:big-copy needs a browser of each kind, and is run by hand (tools/README.md)
  assert.deepEqual(nowhere, ['test:big-copy']);
});

test('every console workflow has the paths the map gives it', () => {
  const stale = stalePaths(repo, all).map(({ file }) => file);
  assert.deepEqual(stale, [], `node .github/checks/checks.mjs --write writes them: ${stale.join(', ')}`);
  for (const workflow of all.workflows) {
    const text = repo.text(`.github/workflows/${workflow.workflow}`);
    const on = parse(text).on;
    const paths = pathsOf(workflow, repo);
    // on a pull request and on main alike, and nothing that leaves a path out again
    assert.deepEqual(on.pull_request.paths, paths, workflow.workflow);
    assert.deepEqual(on.push.paths, paths, workflow.workflow);
    assert.ok(paths.includes(`.github/workflows/${workflow.workflow}`) && paths.includes('package.json'));
    assert.ok(paths.every(path => !path.startsWith('!') && !path.startsWith('games/') && !path.endsWith('.test.mjs')), workflow.workflow);
    assert.ok(!paths.includes('tools/**') && !paths.includes('tools/lib/**') && !paths.includes('tools/readme.mjs'), workflow.workflow);
    // every file that starts it is under one of them
    const covered = file => paths.some(path => (path.endsWith('/**') ? file.startsWith(path.slice(0, -2)) : file === path));
    for (const file of repo.files) assert.equal(covered(file), starts(file, workflow, repo), `${workflow.workflow}: ${file}`);
  }
  // every workflow that tests on Mac or Windows is in the map
  const heavy = readdirSync(`${ROOT}.github/workflows`).filter(name => /runs-on: .*(macos|windows|matrix)/.test(readFileSync(`${ROOT}.github/workflows/${name}`, 'utf8')));
  assert.deepEqual(heavy.filter(name => !WORKFLOWS[name]), []);
});

test('a workflow\'s paths are written where they were, on a pull request and on main', () => {
  const text = 'on:\n  pull_request:\n    paths:\n      - \'tools/**\'\n      - \'!tools/**/*.md\'\n  push:\n    branches: [main]\n    paths:\n      - \'tools/**\'\n  schedule:\n    - cron: \'1 2 * * 3\'\njobs:\n  one:\n    steps:\n      - run: echo\n';
  const fresh = withPaths(text, ['kit/gba/**', 'tools/twin.mjs']);
  assert.deepEqual(parse(fresh).on.pull_request.paths, ['kit/gba/**', 'tools/twin.mjs']);
  assert.deepEqual(parse(fresh).on.push, { branches: ['main'], paths: ['kit/gba/**', 'tools/twin.mjs'] });
  assert.deepEqual(parse(fresh).jobs, parse(text).jobs);
  assert.equal(withPaths(fresh, ['kit/gba/**', 'tools/twin.mjs']), fresh);
});

test('Check takes its parts from the map, after Stack, and its last job waits for them', () => {
  const workflow = parse(repo.text('.github/workflows/check.yml'));
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.equal(workflow.on.pull_request, null, 'Check starts on every pull request, as main requires its last job');
  const { parts, tests, check } = workflow.jobs;
  // only once Stack lets the pull request through, with the whole repository to read and a token that can only read
  assert.equal(parts.needs, 'stack');
  assert.deepEqual(parts.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(parts.steps[0].with['sparse-checkout'], undefined);
  assert.equal(parts.steps[0].with['persist-credentials'], false);
  assert.deepEqual(parts.steps.slice(1).map(step => step.run), ['node .github/checks/checks.mjs']);
  assert.equal(parts.steps[1].id, 'parts');
  assert.equal(parts.outputs.parts, '${{ steps.parts.outputs.parts }}');
  assert.deepEqual(tests.needs, ['stack', 'parts']);
  assert.equal(tests.strategy.matrix.include, '${{ fromJSON(needs.parts.outputs.parts) }}');
  assert.equal(tests.strategy['fail-fast'], false);
  assert.ok(tests.steps.some(step => step.run === '${{ matrix.run }}'));
  // the required job is never skipped, and fails when the parts couldn't be chosen or any that started failed
  assert.deepEqual(check.needs, ['stack', 'parts', 'tests', 'credit']);
  assert.equal(check.if, 'always()');
  assert.equal(check.name, 'Check');
  const last = check.steps.at(-1);
  assert.equal(last.env.PARTS, '${{ needs.parts.result }}');
  assert.ok(last.run.includes('test "$STACK" = success && test "$PARTS" = success && test "$RESULT" = success && test "$CREDIT" = success'));
});
