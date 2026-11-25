// npm run test:part-tasks [<console>...]: a game whose parts are its tasks (lib/part-functions.mjs, #1871), from its
// first day to its last task done, through the tools as a contributor types them, on each console that has a file in
// part-tasks/, or on those named. The game is a program of the project's own, made up for the test, so it needs
// nobody's copy of anything, and it's in games/ only for as long as this takes. GitHub is a stand-in that keeps
// issues in a file and runs the claims workflow's own script (stand-in/github.mjs), so nothing is opened anywhere.
//
// The steps are the same on every console and are all here. A console gives its made-up program and its tools, in
// part-tasks/<console>.mjs, whose default export is:
//
//   id, consoleName   the console as kit/consoles.js names it, and as the New Dreamport form does
//   proof             how its functions are proven, as a line of proofs.json says it: 'bytes' or 'memory'
//   functions         the made-up program's functions, each name to its key in the game's code map
//   start             keys the code map has that neither proof reaches, which run as the console starts the program
//   recording         the one recording of the original: { about, frames, held }
//   parts             two or more, in a player's order: { name, frames, runs }, `runs` the names of the functions
//                     the program is known to run in those frames, from its own lines
//   never             the names of the functions the code map has and no part runs
//   named             null, or { name, by }: one of `never` that a function of a part only names
//   build(work)       builds the original: { copy, original, proofFiles }
//   source(options)   the version's code, by its path in the version's folder, with { twins } written, `wrong` for
//                     one twin of the first part written wrong, and `late` for the game's own step a frame late
//   wrong             { name }: which twin `wrong` changes
//   prove(version)    what to give npm run dp -- to prove every twin the version has, as ['match', version]
//   unreached         for a console where the tools can't yet give a proof of some function a part runs, and don't
//                     say so (lib/proofs.mjs, beyondProof): { names, why }, the names among `functions`. Its first
//                     part's task then can't be done, which the steps hold the tools to and say, and they end there
//
// What it shows, and fails without: `proofs --start --parts` starts both files; `tasks` opens a task for each part,
// with no group of functions by address while a part has no list; `prove` writes each part's list as the original
// plays, the Dreamport matching nothing yet, and each list is exactly what the program is known to run in the part's
// frames and the frame after; the groups by address come only once every part has its list; `find --take` hands the
// first part out with its functions; a twin written wrong gets no proof; `ready --task "<part>"` fails while a
// function has no proof, fails while the part's frames differ, and passes once both hold; a function a part only
// names is in no part's list and the part is done without it; and the last task done leaves nothing to take.

import { spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { firstFiles } from '../lib/new-game.mjs';
import { readCodeMap } from '../lib/proof-files.mjs';
import { beyondProof, groupsOf } from '../lib/proofs.mjs';
import { GH, newSite } from './stand-in/github.mjs';

const HERE = fileURLToPath(new URL('./part-tasks/', import.meta.url));
const HOME = 900, RECORDING = 'the-whole-game';
const COPIES = join(LOCAL, 'copies.json'), STATUS = join(REPO, 'docs', 'STATUS.md'), MEDIA = join(REPO, 'public', 'media'), PROGRESS = join(REPO, '.github', 'readme', 'progress');

const failures = [], limits = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
  return ok;
};
const last = run => run.out.trim().split('\n').at(-1);
const escaped = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sorted = keys => [...keys].sort();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function flow(machine) {
  // a repository of its own, as find --take keeps which session on this computer makes which task of a repository
  // (lib/taking.mjs), and another test's stand-in has the same numbers
  const GAME = `test-part-tasks-${machine.id}`, VERSION = `${GAME}/c`, REPOSITORY = `stand-in/${GAME}`, TITLE = `Test Part Tasks ${machine.id.toUpperCase()}`;
  const work = join(LOCAL, 'tmp', `part-tasks-${machine.id}`), bin = join(work, 'bin'), kept = join(work, 'github.json');
  const proofs = join(proofFolder(VERSION), 'proofs.json'), lists = join(proofFolder(GAME), 'part-functions.json'), partsFile = join(proofFolder(GAME), 'parts.json');
  const env = { ...process.env, DREAMPORTS_GH: join(bin, 'gh'), STAND_IN_GITHUB: kept, STAND_IN_LOGIN: 'sam', STAND_IN_WORK: join(work, 'claims') };
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 27, env });
    return { status, out: stdout + stderr };
  };
  // a check of what a tool said, with the end of what it said when it isn't what's expected
  const said = (run, ok, what) => {
    if (!check(ok, what)) console.log(run.out.trim().split('\n').slice(-25).map(line => `      ${line}`).join('\n'));
  };
  const site = () => JSON.parse(readFileSync(kept, 'utf8'));
  const tasks = () => site().issues.filter(issue => /^Task: /.test(issue.title));
  const taskOf = name => tasks().find(issue => issue.title === `Task: ${name} in C`);
  const keptProofs = () => JSON.parse(readFileSync(proofs, 'utf8')).functions;
  const keptLists = () => JSON.parse(readFileSync(lists, 'utf8')).parts;
  const tidy = () => {
    const media = existsSync(MEDIA) ? readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file)) : [];
    for (const path of [gameFolder(GAME), work, join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(LOCAL, 'c', 'twins', GAME), join(LOCAL, 'match', GAME), join(LOCAL, 'twin', GAME),
      join(LOCAL, 'tasks', `${GAME}.lock`), join(PROGRESS, `${GAME}.svg`), join(PROGRESS, `${GAME}-c.svg`), ...media]) rmSync(path, { recursive: true, force: true });
  };
  const write = options => {
    for (const [file, text] of Object.entries(machine.source(options))) {
      mkdirSync(join(gameFolder(VERSION), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(VERSION), file), text);
    }
  };
  const writeParts = recorded => writeFileSync(partsFile, `${JSON.stringify({
    about: 'A made-up game\'s parts, in the order a player meets them.',
    parts: machine.parts.map(({ name, frames }, at) => (at < recorded ? { name, recording: RECORDING, frames } : { name })),
  }, null, 2)}\n`);

  // what the program is known to run, as keys: each part's whole list, and what its task has of it
  const key = name => machine.functions[name];
  const expected = machine.parts.map(({ name, runs }, at) => ({ name, runs: sorted([...(at === 0 ? machine.start : []), ...runs.map(key)]) }));
  const seen = new Set(machine.start);
  const own = machine.parts.map(({ name, runs }) => {
    const mine = sorted(runs.map(key).filter(each => !seen.has(each)));
    for (const each of runs.map(key)) seen.add(each);
    return { name, names: runs.filter(each => mine.includes(key(each))), keys: mine };
  });
  const never = sorted(machine.never.map(key));
  // the functions a part runs that the console's tools can give no proof of yet, and what a proof can be given of
  const unreached = sorted((machine.unreached?.names ?? []).map(key)), reached = keys => keys.filter(each => !unreached.includes(each));
  const [first, ...later] = own, [firstPart] = machine.parts;

  const keptBefore = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
  const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
  const dirtyBefore = untouched();
  tidy();
  try {
    console.log(`\nOn the ${machine.consoleName}, a made-up game in games/ for as long as this takes:`);
    mkdirSync(bin, { recursive: true });
    const { copy, original, proofFiles } = await machine.build(join(work, 'original'));
    for (const [file, text] of Object.entries(firstFiles(GAME, original, { language: 'c', issue: HOME, lead: 'pat-lead', added: '2026-11-24' }))) {
      mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(GAME), file), text);
    }
    mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    for (const [file, text] of Object.entries(proofFiles)) writeFileSync(join(proofFolder(GAME), file), text);
    writeParts(0);
    // its first day: what the kit calls, and no twin
    write({ twins: [] });
    writeFileSync(join(bin, 'gh'), GH);
    chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(kept, JSON.stringify(newSite([{
      number: HOME, title: `Dreamport: ${TITLE}`, assignees: [{ login: 'pat-lead' }], labels: [{ name: 'new-dreamport' }, { name: GAME }], milestone: { number: 1, title: `${TITLE} Dreamport` },
      body: ['### Game', '', TITLE, '', '### Game folder', '', GAME, '', '### Console', '', machine.consoleName, '', '### Where it starts', '', 'Nowhere: it\'s made up.'].join('\n'),
    }], REPOSITORY)));
    let run = dp('rom', copy);
    said(run, run.status === 0 && run.out.includes(GAME), 'rom knows its copy');
    run = dp('codemap', GAME);
    const codeMap = run.status === 0 ? readCodeMap(GAME) : null;
    const mapped = sorted((codeMap?.functions ?? []).map(f => f.key)), known = sorted([...machine.start, ...Object.values(machine.functions)]);
    said(run, run.status === 0 && same(mapped, known), `codemap finds the program's ${Object.keys(machine.functions).length} functions${machine.start.length ? ' and its start' : ''}, and nothing else: ${mapped.join(' ')}`);
    if (!codeMap || !same(mapped, known)) return;
    check(machine.start.every(each => beyondProof(codeMap, codeMap.functions.find(f => f.key === each))) && Object.values(machine.functions).every(each => !beyondProof(codeMap, codeMap.functions.find(f => f.key === each))),
      machine.start.length ? 'a proof can be given of each of its functions, and of its start neither proof reaches' : 'the tools take each of its functions for one a proof can be given of');

    console.log('Its parts become its tasks:');
    run = dp('proofs', VERSION, '--start', '--parts');
    said(run, run.status === 0 && existsSync(proofs) && keptProofs().length === 0 && existsSync(lists) && same(keptLists(), {}), 'proofs --start --parts starts its proofs, with none, and its parts\' functions, with no part');
    run = dp('proofs', VERSION);
    said(run, run.status === 0 && machine.parts.every(({ name }) => new RegExp(`^  ${escaped(name)} +no recording of the original yet$`, 'm').test(run.out)) && !/^  Functions? [0-9A-F]{8}/m.test(run.out),
      'each part is a task with no recording of the original yet, and no group of functions by address is one');
    run = dp('tasks', VERSION, '--repo', REPOSITORY);
    said(run, run.status === 0 && machine.parts.every(({ name }) => run.out.includes(`  ${name}: a part of the game with no recording of the original yet`)) && /Nothing was opened/.test(run.out) && tasks().length === 0
      && new RegExp(`A task for each of these ${machine.parts.length} would go under `).test(run.out) && !/stretches/.test(run.out) && !/tasks of functions/.test(run.out),
    'tasks lists a task for each part, says where a part\'s task goes, and opens nothing without a yes');
    run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
    said(run, run.status === 0 && tasks().length === machine.parts.length && machine.parts.every(({ name }) => /no recording of the original yet, which is where its task starts/.test(taskOf(name)?.body ?? '')) && !/the bot hasn't put it under/.test(run.out),
      `with a yes it opens them, each saying its task starts with a recording: ${last(run)}`);
    const home = taskOf(firstPart.name)?.parent, holder = site().issues.find(issue => issue.number === home);
    check(Boolean(holder) && tasks().every(issue => issue.parent === home) && new RegExp(`under ${home === HOME ? `#${HOME}\\.` : `its issue for C, under #${HOME}\\.`}`).test(last(run)),
      `the claims workflow puts each under ${home === HOME ? 'the game\'s issue' : `"${holder?.title}"`}, which is where tasks said they would go: ${last(run)}`);
    run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
    said(run, run.status === 0 && tasks().length === machine.parts.length && new RegExp(`has ${machine.parts.length} tasks open already, under `).test(run.out) && !/tasks of functions/.test(run.out) && !/stretches/.test(run.out),
      `a second run opens nothing, and calls them tasks, not tasks of functions: ${last(run)}`);
    run = dp('find', GAME, '--take', '--repo', REPOSITORY);
    said(run, run.status === 0 && new RegExp(`Take #${taskOf(firstPart.name)?.number} ${escaped(firstPart.name)} in C`).test(run.out) && /It's a part of the game with no recording of the original yet, which is where it starts/.test(run.out),
      `find hands the first part out, and says it starts with a recording: ${run.out.trim().split('\n')[0]}`);

    console.log('A recording of the original, and what it runs in each part:');
    writeFileSync(join(proofFolder(GAME), 'recordings', `${RECORDING}.json`), `${JSON.stringify(machine.recording, null, 2)}\n`);
    writeParts(1);
    run = dp('prove', VERSION);
    said(run, [0, 3].includes(run.status) && same(Object.keys(keptLists()), [firstPart.name]) && /Written: .*part-functions\.json/.test(run.out),
      `prove plays the original and keeps the first part's functions, with a Dreamport that has no twin yet: ${Object.keys(existsSync(lists) ? keptLists() : {}).join(', ') || 'none'}`);
    check(same(keptLists()[firstPart.name], expected[0].runs), `${firstPart.name} runs what the program is known to run in frames ${firstPart.frames.join(' to ')}, ${expected[0].runs.length} functions: ${(keptLists()[firstPart.name] ?? []).join(' ')}`);
    run = dp('proofs', VERSION);
    said(run, run.status === 0 && new RegExp(`^  ${escaped(firstPart.name)} +0 of ${first.keys.length} proven$`, 'm').test(run.out) && !/^  Functions? [0-9A-F]{8}/m.test(run.out),
      `its task is its ${first.keys.length} functions a proof can be given of, and while a part has no list there is still no group by address`);
    if (machine.named) {
      run = dp('proofs', VERSION, key(machine.named.name));
      said(run, run.status === 0 && /is in no task yet, as no part's recording runs it so far, and 1 part of the game has no recording of the original yet/.test(run.out) && /Its twin can be written and proven now all the same/.test(run.out),
        `${machine.named.name}, which ${machine.named.by} only names, is in no task yet, and proofs says why`);
    }
    writeParts(machine.parts.length);
    run = dp('prove', VERSION);
    said(run, [0, 3].includes(run.status) && same(Object.keys(keptLists()), machine.parts.map(part => part.name)), 'with every part\'s frames named, prove keeps every part\'s functions');
    for (const [at, { name, frames }] of machine.parts.entries()) {
      check(same(keptLists()[name], expected[at].runs), `${name} runs what the program is known to run in frames ${frames.join(' to ')}, ${expected[at].runs.length} functions: ${(keptLists()[name] ?? []).join(' ')}`);
    }
    check(never.every(each => !Object.values(keptLists()).flat().includes(each)), `no part runs ${machine.never.join(' or ')}`);
    const leftover = groupsOf({ ...codeMap, functions: codeMap.functions.filter(f => never.includes(f.key)) });
    run = dp('proofs', VERSION);
    said(run, run.status === 0 && own.every(({ name, keys }) => new RegExp(`^  ${escaped(name)} +0 of ${keys.length} proven$`, 'm').test(run.out)) && leftover.every(group => new RegExp(`^  ${escaped(group.name)} +0 of ${group.functions.length} proven$`, 'm').test(run.out))
      && (run.out.match(/^  Functions? [0-9A-F]{8}/gm) ?? []).length === leftover.length,
    `each part's task is what it runs that no part before it does, and now that every part has its list, what none runs comes after by address: ${leftover.map(group => group.name).join(', ')}`);
    if (machine.named) {
      run = dp('proofs', VERSION, key(machine.named.name));
      said(run, run.status === 0 && new RegExp(`^${escaped(groupsOf({ ...codeMap, functions: codeMap.functions.filter(f => never.includes(f.key)) }).find(group => group.functions.some(f => f.key === key(machine.named.name))).name)} of `).test(run.out),
        `and ${machine.named.name} is in that group, as no part runs it`);
    }
    run = dp('tasks', VERSION, '--repo', REPOSITORY, '--update', '--yes');
    said(run, run.status === 0 && own.every(({ name, keys }) => keys.every(each => (taskOf(name)?.body ?? '').includes(`- \`${each}\``)) && Object.values(machine.functions).filter(each => !keys.includes(each)).every(each => !(taskOf(name)?.body ?? '').includes(`- \`${each}\``)))
      && /A function its code only names/.test(taskOf(firstPart.name)?.body ?? ''),
    'tasks --update writes each part\'s functions into its task, and what the list leaves out');
    run = dp('tasks', VERSION, '--repo', REPOSITORY, '--yes');
    said(run, run.status === 0 && leftover.every(group => taskOf(group.name)) && tasks().length === machine.parts.length + leftover.length, `and tasks opens the group no part runs: ${last(run)}`);
    run = dp('find', GAME, '--take', '--repo', REPOSITORY);
    said(run, run.status === 0 && new RegExp(`Take #${taskOf(firstPart.name)?.number} ${escaped(firstPart.name)} in C`).test(run.out)
      && new RegExp(`It's a part of the game, and ${first.keys.length} functions of the original that it runs and no part before it does, ${first.keys.length} still to prove: npm run dp -- proofs ${escaped(VERSION)} "${escaped(firstPart.name)}" lists them`).test(run.out)
      && new RegExp(`It's done when npm run dp -- ready ${escaped(VERSION)} --task "${escaped(firstPart.name)}" says each has its proof and the part is proven by its recording`).test(run.out),
    `find hands the first part out with its ${first.keys.length} functions and when it's done: ${run.out.trim().split('\n')[0]}`);

    console.log(`${firstPart.name}, a twin at a time:`);
    const ready = name => dp('ready', VERSION, '--task', name);
    const notReady = run => /^Not ready: (.*)\.$/m.exec(run.out)?.[1].split(', ') ?? [];
    const provenKeys = () => sorted(keptProofs().filter(line => line[1] === machine.proof).map(line => line[0]));
    write({ twins: first.names, wrong: true });
    run = dp(...machine.prove(VERSION));
    const butWrong = reached(first.keys).filter(each => each !== key(machine.wrong.name));
    said(run, same(provenKeys(), butWrong), `its twins are written and proven by the same ${machine.proof}, but ${machine.wrong.name}, written wrong, which gets no proof: ${provenKeys().length} of ${reached(first.keys).length}`);
    // written right, and not proven again yet: the game plays the part as the original does, and that isn't enough
    write({ twins: first.names });
    run = ready(firstPart.name);
    said(run, run.status === 1 && same(notReady(run), ['proofs']) && new RegExp(`${escaped(firstPart.name)}: ${1 + unreached.length} of its ${first.keys.length} functions ha(?:s|ve) no proof yet`).test(run.out),
      `ready --task "${firstPart.name}" fails while a function has no proof, though every frame of the part is the same: ${last(run)}`);
    run = dp(...machine.prove(VERSION));
    said(run, run.status === 0 && same(provenKeys(), reached(first.keys)), `proven again, each of its ${reached(first.keys).length} functions a proof can be given of has its proof`);
    if (unreached.length) {
      // where the console's tools end today: every twin proven, every frame of the part the same, and its task not done
      run = dp('proofs', VERSION, '--check', '--task', firstPart.name);
      said(run, run.status === 1 && new RegExp(`${unreached.length} of its ${first.keys.length} functions? ha(?:s|ve) no proof yet`).test(run.out) && unreached.every(each => new RegExp(`0x${each}\\b`, 'i').test(run.out)) && reached(first.keys).every(each => !new RegExp(`^  0x${each}\\b`, 'im').test(run.out)),
        `its task still isn't done, for ${machine.unreached.names.join(' and ')} alone: ${run.out.trim().split('\n')[0]}`);
      run = dp('prove', VERSION);
      said(run, [0, 3].includes(run.status) && new RegExp(`Proven, every frame the same: .*${escaped(firstPart.name)}, frames ${firstPart.frames.join(' to ')}`).test(run.out), 'though prove finds every frame of the part the same');
      limits.push(`On the ${machine.consoleName}, ${firstPart.name} can't be done yet: ${machine.unreached.why}`);
      console.log(`  NOT DONE: ${limits.at(-1)}`);
      return;
    }
    // and the other way round: each function proven, and the game's own step, which is no function of the original, wrong
    write({ twins: first.names, late: true });
    run = ready(firstPart.name);
    said(run, run.status === 1 && /^proofs: passed\.$/m.test(run.out) && !notReady(run).includes('proofs') && notReady(run).includes('the part') && new RegExp(`the part: ${escaped(firstPart.name)} isn't proven by its recording yet`).test(run.out),
      `and ready still fails while the part's frames differ, with the game's own step a frame late: ${last(run)}`);
    write({ twins: first.names });
    run = ready(firstPart.name);
    said(run, run.status === 0 && /^Ready/m.test(run.out) && new RegExp(`${escaped(firstPart.name)}: each of its ${first.keys.length} functions has its proof`).test(readFileSync(join(LOCAL, 'ready', 'proofs.log'), 'utf8')),
      `with each function proven and every frame of the part the same, ready --task "${firstPart.name}" passes: ${last(run)}`);
    if (machine.named) {
      const defines = text => new RegExp(`^[\\w \\*]+\\b${machine.named.name}\\([^;{]*\\{`, 'm').test(text);
      check(!provenKeys().includes(key(machine.named.name)) && !Object.values(machine.source({ twins: first.names })).some(defines) && Object.values(machine.source({ twins: Object.keys(machine.functions) })).some(defines),
        `the part is done with ${machine.named.name} named by ${machine.named.by} and not written yet`);
    }

    for (const part of later) {
      console.log(`${part.name}:`);
      const written = own.slice(0, own.indexOf(part) + 1).flatMap(each => each.names);
      run = dp('find', GAME, '--take', '--repo', REPOSITORY);
      said(run, run.status === 0 && new RegExp(`Take #${taskOf(part.name)?.number} ${escaped(part.name)} in C`).test(run.out) && new RegExp(`${part.keys.length} functions? of the original that it runs and no part before it does, ${part.keys.length} still to prove`).test(run.out),
        `find hands it out next, with the ${part.keys.length} functions it runs that no part before it does: ${run.out.trim().split('\n')[0]}`);
      run = dp('proofs', VERSION, '--check', '--task', part.name);
      said(run, run.status === 1 && new RegExp(`${part.keys.length} of its ${part.keys.length} functions? ha(?:s|ve) no proof yet`).test(run.out), 'none of them has a proof yet, so it isn\'t done');
      write({ twins: written });
      run = dp(...machine.prove(VERSION));
      said(run, run.status === 0 && part.keys.every(each => provenKeys().includes(each)), `its twins are written and each proven by the same ${machine.proof}`);
      // what ready --task asks of it, without the site's check and build a third and fourth time: each function's
      // proof, and the part proven by its recording
      run = dp('proofs', VERSION, '--check', '--task', part.name);
      said(run, run.status === 0 && new RegExp(`${escaped(part.name)}: each of its ${part.keys.length} functions? has its proof`).test(run.out), `so each of its functions has its proof: ${last(run)}`);
      run = dp('prove', VERSION);
      said(run, [0, 3].includes(run.status) && new RegExp(`Proven, every frame the same: .*${escaped(part.name)}, frames ${machine.parts.find(each => each.name === part.name).frames.join(' to ')}`).test(run.out), 'and prove finds every frame of the part the same, so it\'s done');
    }

    console.log('What no part runs:');
    run = dp('find', GAME, '--take', '--repo', REPOSITORY);
    said(run, run.status === 0 && new RegExp(`Take #${taskOf(leftover[0].name)?.number} ${escaped(leftover[0].name)} in C`).test(run.out), `with every part done, find hands out the group by address: ${run.out.trim().split('\n')[0]}`);
    write({ twins: Object.keys(machine.functions) });
    run = dp(...machine.prove(VERSION));
    said(run, run.status === 0 && same(provenKeys(), sorted(Object.values(machine.functions))), `each of the program's ${Object.keys(machine.functions).length} functions has its proof`);
    run = dp('proofs', VERSION, '--check', '--task', leftover[0].first);
    said(run, run.status === 0, `so the group is done: ${last(run)}`);
    run = dp('find', GAME, '--take', '--repo', REPOSITORY);
    said(run, run.status === 0 && /Nothing can be taken now/.test(run.out) && !/Take #/.test(run.out), `and nothing is left to take: ${run.out.trim().split('\n')[0]}`);
    const elsewhere = site().log.filter(line => / elsewhere: /.test(line) && !/\/forks(\?|$)/.test(line));
    check(!elsewhere.length, `nothing was asked of any repository but the stand-in${elsewhere.length ? `: ${elsewhere[0]}` : ''}`);
  } finally {
    tidy();
    writeFileSync(STATUS, keptBefore.status);
    if (keptBefore.copies) writeFileSync(COPIES, keptBefore.copies);
    else rmSync(COPIES, { force: true });
    check(untouched() === dirtyBefore, 'nothing is left behind');
  }
}

const all = readdirSync(HERE).filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4)).sort();
const asked = process.argv.slice(2);
const unknown = asked.filter(name => !all.includes(name));
if (unknown.length) {
  console.error(`No file in tools/test/part-tasks/ is for ${unknown.join(' or ')}: there is one for ${all.join(', ')}.`);
  process.exit(1);
}
for (const name of asked.length ? asked : all) await flow((await import(pathToFileURL(join(HERE, `${name}.mjs`)).href)).default);

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
if (limits.length) console.log(`\nNot every console gets to its last task:\n${limits.map(limit => `  ${limit}`).join('\n')}`);
console.log(`\nA game whose parts are its tasks goes through the tools ${limits.length ? 'as far as each console\'s tools reach' : 'from its first day to its last task'}.`);
process.exit(0);
