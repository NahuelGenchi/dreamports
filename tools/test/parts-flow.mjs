// A game whose tasks are its parts, each made a function at a time (lib/part-functions.mjs, #1871), from its first day
// to a part done, through the tools as they're typed: the steps every console's test of it goes through, with a
// made-up program of that console as the game, in games/ for as long as the test takes, so it needs nobody's copy of
// anything. GitHub is a stand-in: a small program that keeps issues in a file, which the tools start in the GitHub
// CLI's place (lib/github.mjs, DREAMPORTS_GH), so nothing is opened anywhere.
//
// What it shows, on the console the test names: `proofs --start --parts` starts both files; `prove` plays the
// original and writes the functions it runs in each part's frames and the frame after, which the test knows of its
// own program; `tasks` opens a task for each part, with the functions it runs that no part before it does; `find
// --take` hands the first out; and `ready --task "<part>"` fails while a function of the part has no proof, fails
// still while its frames don't match the original's, and passes once both do. A later part whose frames match isn't
// done either until its own functions are proven, and a twin changed after its proof is found.

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder } from '../lib/paths.mjs';
import { firstFiles } from '../lib/new-game.mjs';

const HOME = 900;
const COPIES = join(LOCAL, 'copies.json');

// GitHub, as far as the tools ask it: issues in a file, each new one put under the game's issue at once
const standIn = REPOSITORY => `#!/usr/bin/env node
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

const quoted = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Goes through the steps, printing each check, and answers how many failed. `setup` is the console's side:
 *   name        the game's folder in games/, and `title`, its name for people, as "Test Super Nintendo Parts"
 *   consoleName the console's name as the New Dreamport form has it
 *   original    its proof/original.json, and `copy`, the made-up copy's file
 *   frames      how long its one recording is, with nothing held, and `parts`, each { name, frames: [first, last] },
 *               two of them, the second running one function or more that the first doesn't
 *   ran         what `prove` has to find the original runs in each part, by its name, as keys of the code map, and
 *               `own`, each part's task: [{ key, twin }], the functions it runs that no part before it does and a
 *               proof reaches, with each one's twin's name
 *   write       writes the game's C at a stage: 'twins', every twin written and the game not calling them yet, so
 *               no frame of it is the original's, 'whole', the game as it should be, and 'changed', the whole game
 *               with one line of the first part's first twin written another way
 *   proves      what proves one twin by its name, as ['twin', version, name, '--calls', '1000']
 */
export async function partsFlow({ name, title, consoleName, original, copy, frames, parts, ran, own, write, proves }) {
  const version = `${name}/c`, work = join(LOCAL, 'tmp', `${name}-flow`);
  // a repository of the test's own name, as a session's note of the task it took is kept for the whole computer by its
  // repository and number (lib/taking.mjs), and another test's stand-in at the same time would have the same numbers
  const REPOSITORY = `stand-in/${name}`;
  const proofs = join(proofFolder(version), 'proofs.json'), lists = join(proofFolder(name), 'part-functions.json');
  const bin = join(work, 'bin'), github = join(work, 'github.json');
  const failures = [];
  // what the tool run last said, shown under a check that failed, so a failure on another computer can be read
  let said = '';
  const check = (ok, what) => {
    console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
    if (ok) return;
    failures.push(what);
    if (said) console.log(said.trim().split('\n').slice(-25).map(line => `      ${line}`).join('\n'));
    said = '';
  };
  const dp = (...args) => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], {
      cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26, env: { ...process.env, DREAMPORTS_GH: join(bin, 'gh'), STAND_IN_GITHUB: github },
    });
    said = stdout + stderr;
    return { status, out: said };
  };
  const last = run => run.out.trim().split('\n').at(-1);
  const kept = () => JSON.parse(readFileSync(proofs, 'utf8')).functions;
  const issues = () => JSON.parse(readFileSync(github, 'utf8'));
  const tidy = () => {
    for (const path of [gameFolder(name), join(LOCAL, 'results', name), join(LOCAL, 'captures', name), join(LOCAL, 'tasks', `${name}.lock`), join(REPO, '.github', 'readme', 'progress', `${name}.svg`), join(REPO, '.github', 'readme', 'progress', `${name}-c.svg`)]) rmSync(path, { recursive: true, force: true });
  };
  const [first, second] = parts;
  const count = (n, word = 'function') => `${n} ${word}${n === 1 ? '' : 's'}`;
  const stand = part => own[part.name].length;

  rmSync(work, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  const copies = existsSync(COPIES) ? readFileSync(COPIES) : null;
  tidy();
  try {
    console.log('A game of the project\'s own, in games/ for as long as this takes:');
    for (const [file, text] of Object.entries(firstFiles(name, original, { language: 'c', issue: HOME, lead: 'pat-lead', added: '2026-11-24' }))) {
      mkdirSync(join(gameFolder(name), file, '..'), { recursive: true });
      writeFileSync(join(gameFolder(name), file), text);
    }
    mkdirSync(join(proofFolder(name), 'recordings'), { recursive: true });
    writeFileSync(join(proofFolder(name), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
    writeFileSync(join(bin, 'gh'), standIn(REPOSITORY));
    chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(github, JSON.stringify({
      next: HOME + 1, log: [],
      issues: [{ number: HOME, title: `Dreamport: ${title}`, state: 'open', assignees: [{ login: 'pat-lead' }], body: ['### Game', '', title, '', '### Game folder', '', name, '', '### Console', '', consoleName, '', '### Where it starts', '', 'A screen of one colour.'].join('\n') }],
    }));
    let run = dp('rom', copy);
    check(run.status === 0 && run.out.includes(name), 'rom knows its copy');
    run = dp('codemap', name);
    check(run.status === 0, `its code map is found in the copy: ${last(run)}`);
    writeFileSync(join(proofFolder(name), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames, held: [[0, []]] }, null, 2)}\n`);
    writeFileSync(join(proofFolder(name), 'parts.json'), `${JSON.stringify({ about: 'The parts of the test\'s own program.', parts: parts.map(part => ({ name: part.name, recording: 'still', frames: part.frames })) }, null, 2)}\n`);

    console.log('Its parts for tasks, from proofs --start --parts on:');
    run = dp('proofs', version, '--start', '--parts');
    check(run.status === 0 && existsSync(proofs) && kept().length === 0 && existsSync(lists) && Object.keys(JSON.parse(readFileSync(lists, 'utf8')).parts).length === 0, 'its proofs start with none, and no part has its functions yet');
    run = dp('proofs', version, first.name);
    check(/is a part of the game with no recording of the original yet/.test(run.out), `a part says it's waiting for the original to be played: ${last(run).slice(0, 100)}…`);
    run = dp('prove', version);
    const found = JSON.parse(readFileSync(lists, 'utf8'));
    check(run.status !== 0 && /part-functions\.json, the functions the original runs in each part/.test(run.out), 'prove plays the original, finds no frame of what new wrote the same, and writes what each part runs');
    for (const part of parts) {
      check(JSON.stringify(found.parts[part.name]) === JSON.stringify(ran[part.name]), `${part.name}, frames ${part.frames.join(' to ')}, runs the ${count(ran[part.name].length)} the test knows it does, and those of the frame after: ${JSON.stringify(found.parts[part.name])}`);
    }
    check(found.original === original.sha1 && Object.keys(found.parts).length === parts.length, 'and the file is of this copy, with nothing else in it');
    run = dp('proofs', version);
    check(run.status === 0 && new RegExp(`${quoted(first.name)} +0 of ${stand(first)} proven`).test(run.out) && new RegExp(`${quoted(second.name)} +0 of ${stand(second)} proven`).test(run.out),
      `each part is a task, of the functions it runs that no part before it does: ${stand(first)} and ${stand(second)}`);

    console.log('Its tasks, against a stand-in for GitHub:');
    run = dp('tasks', version, '--repo', REPOSITORY);
    check(run.status === 0 && run.out.includes(`${first.name}: ${stand(first)} of ${stand(first)} to prove, a part of the game`) && /Nothing was opened/.test(run.out) && issues().issues.length === 1, 'tasks lists the parts, and opens nothing without a yes');
    run = dp('tasks', version, '--repo', REPOSITORY, '--yes');
    const opened = issues().issues.filter(issue => issue.number > HOME);
    check(run.status === 0 && opened.length === 2 && opened[0].title === `Task: ${first.name} in C` && opened[1].title === `Task: ${second.name} in C` && own[first.name].every(f => opened[0].body.includes(`\`${f.key}\``)) && own[second.name].every(f => opened[1].body.includes(`\`${f.key}\``) && !opened[0].body.includes(`\`${f.key}\``)),
      `with a yes it opens a task for each part, which lists its functions: ${last(run)}`);
    run = dp('find', name, '--take', '--repo', REPOSITORY);
    check(run.status === 0 && run.out.includes(`Take #${HOME + 1} ${first.name} in C`) && run.out.includes(`It's a part of the game, and ${count(stand(first))} of the original that it runs and no part before it does, ${stand(first)} still to prove`) && run.out.includes(`ready ${version} --task`),
      `find hands the first part out, with what it's made of and when it's done: ${run.out.trim().split('\n')[0]}`);

    console.log('ready --task, for the first part:');
    run = dp('ready', version, '--task', first.name);
    check(run.status === 1 && /proofs: failed/.test(run.out) && run.out.includes(`${stand(first)} of its ${count(stand(first))} ${stand(first) === 1 ? 'has' : 'have'} no proof yet`) && run.out.includes(`the part: ${first.name} isn't proven by its recording yet`),
      `with nothing written it isn't done: no function has its proof, and no frame is the original's: ${last(run)}`);
    write('twins');
    for (const f of own[first.name]) {
      run = dp(...proves(version, f.twin));
      check(run.status === 0 && /1 function kept as proven/.test(run.out), `${f.twin} is proven, and its proof kept: ${last(run)}`);
    }
    check(kept().length === stand(first) && own[first.name].every(f => kept().some(line => line[0] === f.key)), 'each by its key in the code map');
    run = dp('ready', version, '--task', first.name);
    check(run.status === 1 && /proofs: passed/.test(run.out) && run.out.includes(`the part: ${first.name} isn't proven by its recording yet`),
      `with each function proven and the game not calling them yet, it still isn't done, as its frames aren't the original's: ${last(run)}`);
    write('whole');
    run = dp('ready', version, '--task', first.name);
    if (run.status !== 0) console.log(run.out.split('\n').slice(-40).join('\n'));
    check(run.status === 0 && /proofs: passed/.test(run.out) && !/the part:/.test(run.out) && /^Ready/m.test(run.out), `with each function proven and every frame of the part the same, it's done: ${last(run)}`);

    console.log('The second part, whose frames match already:');
    run = dp('proofs', version, '--check', '--task', second.name);
    check(run.status === 1 && run.out.includes(`${stand(second)} of its ${count(stand(second))} ${stand(second) === 1 ? 'has' : 'have'} no proof yet`), 'it isn\'t done while a function of its own has no proof, which is how ready says so');
    run = dp('find', name, '--take', '--repo', REPOSITORY);
    check(run.status === 0 && run.out.includes(`Take #${HOME + 2} ${second.name} in C`), `find hands it out next, as the first is done: ${run.out.trim().split('\n')[0]}`);
    for (const f of own[second.name]) {
      run = dp(...proves(version, f.twin));
      check(run.status === 0 && /1 function kept as proven/.test(run.out), `${f.twin} is proven, and its proof kept: ${last(run)}`);
    }
    run = dp('ready', version, '--task', second.name);
    if (run.status !== 0) console.log(run.out.split('\n').slice(-40).join('\n'));
    check(run.status === 0 && /^Ready/m.test(run.out), `and then it's done too: ${last(run)}`);
    run = dp('find', name, '--take', '--repo', REPOSITORY);
    check(run.status === 0 && !/Take #/.test(run.out), `with both parts done, find hands neither out: ${run.out.trim().split('\n')[0]}`);

    console.log('A twin changed after its proof:');
    write('changed');
    run = dp('proofs', version, '--check', '--task', first.name);
    check(run.status === 1 && run.out.includes(own[first.name][0].key) && /changed since/.test(run.out), 'its proof no longer holds, so its part isn\'t done any more');
    write('whole');
    check(dp('proofs', version, '--check', '--task', first.name).status === 0, 'and it holds again with the twin as it was');
    const asked = line => line.startsWith(`GET repos/${REPOSITORY}/`) || line.startsWith(`POST repos/${REPOSITORY}/`) || line.startsWith(`PATCH repos/${REPOSITORY}/`) || /^(GET|POST|PATCH) user$/.test(line) || /^GET repos\/[\w.-]+\/[\w.-]+\/forks\?/.test(line);
    const elsewhere = issues().log.filter(line => !asked(line));
    check(!elsewhere.length && issues().log.filter(line => /^POST/.test(line)).length === 2, `two tasks were opened, in the stand-in and nowhere else${elsewhere.length ? `: ${elsewhere[0]}` : ''}`);
  } finally {
    tidy();
    if (copies) writeFileSync(COPIES, copies);
    else rmSync(COPIES, { force: true });
  }
  check(!existsSync(gameFolder(name)), 'nothing is left behind');
  rmSync(work, { recursive: true, force: true });
  return failures.length;
}
