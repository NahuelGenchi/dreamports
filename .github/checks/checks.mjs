// A pull request's checks match what it changes (#2042). Every pull request ran every part of Check, and any file in
// tools/ started the consoles' own workflows on Linux, Mac and Windows, so a change to the status table's text started
// about forty checks, and a pull request for one game waited on every console's tests.
//
// This is the one place that says which files start which tests. PARTS lists Check's parts and the commands in each, and
// WORKFLOWS the consoles' own workflows. A command's files are worked out, never listed by hand: the files its test's
// script imports, and what those import, and each proof tool the test starts by its name, with what that imports. To those it adds what the scripts read without importing, which only a person can
// say: the folders a console owns (consolesOwning), what a file reads beside the code (BUILT and SERVED), and the few folders that
// are the site's or the docs' alone. A file nothing here knows starts everything.
//
// node .github/checks/checks.mjs is the second step of Check's first job, Stack. It asks GitHub which files the pull
// request changed and gives the parts to start, each with only the commands those files can reach, as the matrix of the
// jobs that follow. The light part, npm run check, is always among them, so the last job, Check, which main requires,
// reports on every pull request. If GitHub doesn't answer, or anything here fails, every part runs in full.
//
// node .github/checks/checks.mjs --write writes each console workflow's paths from the same answers, as GitHub decides
// from them alone whether a workflow starts, and the tests (test.mjs, which npm run check runs) fail when a workflow's
// paths aren't what this would write. --say <file>... prints what a change to those files would start.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONSOLES } from '../../kit/consoles.js';

// every console with tools of its own, all but the one that was never made
export const IDS = Object.keys(CONSOLES).filter(id => id !== 'made-up');

// Check's parts, side by side, each 15 minutes long unless it says, and the commands of each with the consoles they
// are of: the ones whose kit, tools or games they try. `site` marks what the site's own files start.
export const PARTS = [
  // what every pull request runs: the types, the tools' own checks and every test that needs no emulator
  { part: 'light', commands: [{ run: 'npm run check', always: true }] },
  // the site's build, and a new game's start in a real browser on each kind of console
  { part: 'site', commands: [{ run: 'npm run build', site: true }, { run: 'npm run test:game', of: IDS }] },
  // the Nintendo 64's kit, proven against Parallel N64, which this job builds
  { part: 'n64 kit', commands: [{ run: 'npm run test:n64-kit', of: ['n64'] }] },
  // the kits and the consoles' emulators, and the Nintendo 64's function check, here as the functions job is near
  // its time
  {
    part: 'consoles',
    commands: [
      { run: 'npm run test:c-kit', of: ['gba', 'gb', 'gbc', 'nes'] },
      { run: 'npm run test:consoles', of: [] },
      { run: 'npm run test:real-console', of: ['nes'] },
      { run: 'npm run test:ps1-memories', of: ['ps1'] },
      { run: 'npm run test:n64-twin', of: ['n64'] },
    ],
  },
  // the Super Nintendo: its processor running one function at a time, its emulator saying what ran for the code
  // map, its function check, and the first half of its kit's programs, proven against Snes9x
  {
    part: 'snes',
    commands: [
      { run: 'npm run test:snes-call', of: ['snes'] },
      { run: 'npm run test:real-snes', of: ['snes'] },
      { run: 'npm run test:snes-twin', of: ['snes'] },
      { run: 'npm run test:snes-kit -- --half 1', of: ['snes'] },
    ],
  },
  // the second half of the Super Nintendo kit's programs, beside the first (#1641)
  { part: 'snes kit', commands: [{ run: 'npm run test:snes-kit -- --half 2', of: ['snes'] }] },
  // the function check, with a small program of the project's own built into a made-up cartridge, which mGBA
  // runs; match and the NES's function check; the whole cartridge rebuilt and every byte of it accounted for,
  // with another program of the project's own laid out as a linker lays it; and test:same-memory, which builds a
  // program of the project's own as a cartridge and as a Dreamport from the same C, and has prove find every
  // frame and the whole work memory the same in mGBA and in a browser (tools/README.md); and an NES library of
  // the project's own, found in a second made-up program by its short hash and proven there; and the GBA kit's
  // clock, measured against mGBA an instruction at a time on a made-up program's power-on; and the console's
  // stack in a Dreamport, which has to leave the same words as mGBA where a later function reads them unset;
  // and the kit as the sound hardware of a game that runs the sound engine itself
  {
    part: 'functions',
    commands: [
      { run: 'npm run test:twin', of: ['gba'] },
      { run: 'npm run test:clock', of: ['gba'] },
      { run: 'npm run test:stack', of: ['gba'] },
      { run: 'npm run test:sound-console', of: ['gba'] },
      { run: 'npm run test:match', of: ['gba'] },
      { run: 'npm run test:rebuild', of: ['gba'] },
      { run: 'npm run test:nes-twin', of: ['nes'] },
      { run: 'npm run test:n64-call', of: ['n64'] },
      { run: 'npm run test:same-memory', of: ['gba'] },
      { run: 'npm run test:nes-libraries', of: ['nes'] },
    ],
  },
  // the PlayStation's function check, its compiler and match, and a PlayStation library of the project's own,
  // found in a second program by building it with GCC 2.7.2 and by its short hash; they took half of the part
  // above when they ran in it, close to the 15-minute limit (#1742)
  {
    part: 'ps1',
    commands: [
      { run: 'npm run test:ps1-call', of: ['ps1'] },
      { run: 'npm run test:ps1-twin', of: ['ps1'] },
      { run: 'npm run test:ps1-gcc', of: ['ps1'] },
      { run: 'npm run test:ps1-match', of: ['ps1'] },
      { run: 'npm run test:ps1-libraries', of: ['ps1'] },
    ],
  },
  // the PlayStation's kit in C, proven against PCSX ReARMed with programs of the project's own; it ran in the
  // consoles part until its second program took that part past its 15 minutes (#1558)
  { part: 'ps1 kit', commands: [{ run: 'npm run test:ps1-kit', of: ['ps1'] }, { run: 'npm run test:ps1-parts', of: ['ps1'] }] },
  // a game made a function at a time, with the same program: match and twin keep each proof, and its tasks go by
  // them; a big game's tasks of functions, each under its stretch's issue, and no issue past what GitHub holds
  // under one; and a shared library of the project's own, proven in two made-up games at addresses of their own;
  // and match on the Nintendo 64, with IDO built from its translation's source
  {
    part: 'tasks',
    commands: [
      { run: 'npm run test:function-tasks', of: ['gba'] },
      { run: 'npm run test:function-homes', of: ['gba'] },
      { run: 'npm run test:libraries', of: ['gba'] },
      { run: 'npm run test:n64-match', of: ['n64'] },
    ],
  },
  // a game whose parts are its tasks, from its first day to its last task done, through the tools as they're
  // typed, with a program of the project's own on the Game Boy Advance and a stand-in for GitHub: prove's list
  // of each part held to what the program is known to run, and ready --task failing until each function has
  // its proof and the part's frames are the same. In a job of its own, as ready checks and builds the site three
  // times, near 20 minutes on a busy computer
  { part: 'part tasks', minutes: 30, commands: [{ run: 'npm run test:part-tasks -- gba', of: ['gba'] }] },
  // the same on the NES, with its program's Dreamport on the NES kit and its functions proven by the function check,
  // as far as the NES's tools reach (#1958), in a part of its own beside the Game Boy Advance's
  { part: 'part tasks nes', minutes: 25, commands: [{ run: 'npm run test:part-tasks -- nes', of: ['nes'] }] },
  // the PlayStation 2, in a job of its own as it took tasks near the 15-minute limit (#1695): Sony's own
  // compiler and assemblers, built from Sony's GPL source with the runner's clang, kept only if they make the
  // original compiler's objects, the tools' tables checked against them, and match on the console against a
  // program of the project's own that Sony's compiler and linker made; and its function check, with Play!'s own
  // processors built from its makers' source and a made-up program's functions run on each of them and checked
  // against their twins
  {
    part: 'ps2',
    commands: [
      { run: 'npm run test:ps2-gcc', of: ['ps2'] },
      { run: 'npm run test:ps2-match', of: ['ps2'] },
      { run: 'npm run test:ps2-call', of: ['ps2'] },
      { run: 'npm run test:ps2-twin', of: ['ps2'] },
    ],
  },
  // the Game Boy and the Game Boy Color: their kit in C, proven against Gambatte with a program of the project's
  // own as a game of each, every frame, and then every pixel and every sample of its sound; and their function
  // check, with Gambatte's own processor built from its makers' source and another program's functions run on
  // it and checked against their twins
  { part: 'game boy', commands: [{ run: 'npm run test:real-gb', of: ['gb', 'gbc'] }, { run: 'npm run test:gb-twin', of: ['gb', 'gbc'] }] },
  // the PlayStation 2's function check on the programs a disc has beside the one it boots, an IOP module, a second
  // program for the EE and vector unit 1's programs, in a job of its own as with it the part above took 8 to 12 of
  // its 15 minutes (#1744); it builds Play!'s processors and Sony's compiler again for itself
  { part: 'ps2 programs', commands: [{ run: 'npm run test:ps2-twin-programs', of: ['ps2'] }] },
  // the GameCube, as far as it goes with no emulator, which takes most of an hour to build and has a workflow of
  // its own: a made-up disc's code map, made, named and read through the tools as they're typed (#1944)
  { part: 'gamecube', commands: [{ run: 'npm run test:gamecube-codemap', of: ['gamecube'] }] },
];

// the consoles' own workflows, on Linux, Mac and Windows, and the consoles each is of. The commands of each are read
// from its file. 'also' is shared code a workflow was started by before the map, by name, which it keeps.
export const WORKFLOWS = {
  'gba.yml': { of: ['gba'] },
  'gb.yml': { of: ['gb', 'gbc'], also: ['tools/lib/part-functions.mjs', 'tools/lib/played.mjs'] },
  'nes.yml': { of: ['nes'] },
  'snes-n64.yml': { of: ['snes', 'n64'] },
  'nds.yml': { of: ['nds'] },
  'ps1.yml': { of: ['ps1'] },
  'mac.yml': { of: ['ps2'], also: ['tools/lib/sound.mjs'] },
  'psp.yml': { of: ['psp'], also: ['tools/lib/part-functions.mjs', 'tools/lib/proofs.mjs', 'tools/lib/wasm-fold.mjs', 'tools/ps2/twin.mjs'] },
  'gamecube.yml': { of: ['gamecube'], also: ['kit/copy/', 'tools/lib/jobs.mjs', 'tools/lib/run-reference.mjs'] },
};

// Shared code that counts on every system, for a console's workflow: what every tool finds its files and its consoles
// by, how a program is built on Windows, and any file that asks which system it runs on, as one that builds a program
// or starts a browser does.
const EVERY_SYSTEM = ['kit/consoles.js', 'tools/lib/paths.mjs', 'tools/gba/windows.mjs'];
const asksSystem = text => /\bprocess\.platform\b|\bwin32\b|\bdarwin\b/.test(text);

// A file that tests reach but that starts none of them, with why. Keep this short: each one is a risk taken on purpose.
export const OWN_TESTS = {
  // prove, proofs and ready take from it only how a game's numbers are read, and new the table's row; the table itself,
  // and what a merge does to it, are tried by .github/readme/test.mjs, tools/test/merge-main.test.mjs and
  // readme --check, all in npm run check, and the consoles' workflows run in full every week
  'tools/readme.mjs': 'the status table, tried by npm run check',
};

// where a console's kit and tools are, when not in a folder of its own name, and how its tests' files start
const FOLDER = { gb: 'gbc' };
const TEST_NAME = { gbc: 'gb' };
const folderOf = id => FOLDER[id] ?? id;
// each emulator's patch in tools/libretro/, and the consoles whose emulator it changes
export const PATCHES = { fceumm: ['nes'], snes9x: ['snes'], gambatte: ['gb', 'gbc'], pcsx: ['ps1'], 'parallel-n64': ['n64'], play: ['ps2'], dolphin: ['gamecube'], melonds: ['nds'], ppsspp: ['psp'] };

// What a file reads beside the code it imports. A command that reaches the file on the left is started by a change under
// any of the folders on its right. BUILT is what the computer that runs a test compiles, C sources and headers, which
// can go wrong on one system alone, so it counts for the consoles' workflows too.
export const BUILT = {
  // every game in C is built on kit/c/, whatever its console
  'tools/lib/c.mjs': ['kit/c/'],
  // the Game Boy Advance's emulator and its checks in C, which other consoles' tools build on
  'tools/gba/build.mjs': ['kit/c/', 'tools/gba/', 'tools/lib/explore.h'],
  'tools/gba/windows.mjs': ['tools/gba/on-windows.h'],
  // the consoles' emulators: the host they share, its headers, and a new game's first files
  'tools/libretro/build.mjs': ['tools/libretro/', 'tools/lib/explore.h'],
  'tools/lib/new-game.mjs': ['tools/gba/new-game/', 'tools/libretro/new-game/'],
};
// SERVED is what a test's page is given in a browser, the same on every system, which Check tries on Linux.
export const SERVED = {
  'tools/lib/server.mjs': ['kit/c/', 'public/'],
  'tools/lib/preview.mjs': ['tools/preview/'],
  'tools/capture.mjs': ['tools/capture/'],
};

const INSTALLED = ['package.json', 'package-lock.json', '.node-version', '.npmrc'];
const EVERYTHING = [...INSTALLED, '.github/workflows/check.yml', '.github/checks/', '.github/stack/'];
// what only the light part reads: the docs, the commands for coding agents, and GitHub's own files
const LIGHT = ['docs/', 'tools/commands/', '.claude/', '.agents/', '.gemini/', '.github/', '.gitignore', '.gitattributes', 'LICENSE'];
// the site's own files, which its build reads
const SITE = ['src/', 'public/', 'worker/', 'astro.config.mjs', 'tsconfig.json', 'wrangler.jsonc'];

const under = (file, paths) => paths.some(path => (path.endsWith('/') ? file.startsWith(path) : file === path));
const isCode = file => /\.(?:mjs|js)$/.test(file);

// the script a command runs, as package.json names it
export const scriptOf = run => /^npm run ([\w:-]+)/.exec(run)?.[1] ?? null;

/**
 * The repository as these answers read it: its tracked files and the text of each. A test gives its own.
 * @param {string} [root] where the repository is
 */
export function repository(root = process.cwd()) {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 26 }).split('\0').filter(Boolean);
  const kept = new Map();
  return {
    files,
    text(file) {
      if (!kept.has(file)) {
        try {
          kept.set(file, readFileSync(posix.join(root.replaceAll('\\', '/'), file), 'utf8'));
        } catch {
          kept.set(file, null);
        }
      }
      return kept.get(file);
    },
  };
}

const DP = 'tools/dp.mjs';
const startsTools = text => /['"`]dp\.mjs['"`]/.test(text);

// The files a file's code names: each import, and each path to a script it writes as text, as a worker's or a table of
// one for each console. A path with a part filled in when it runs stands for every script in its folder, but in
// tools/dp.mjs, whose tool is the one it's asked for (toolsStarted). A file that starts the proof tools names tools/dp.mjs.
export function named(file, text, files) {
  const found = new Set();
  const folder = posix.dirname(file);
  for (const [, path] of text.matchAll(/['"`](\.{1,2}\/[^'"`\s]*?\.m?js)['"`]/g)) {
    const filled = path.indexOf('${');
    if (filled >= 0 && file === DP) continue;
    if (filled < 0) {
      found.add(posix.normalize(posix.join(folder, path)));
      continue;
    }
    const inside = `${posix.normalize(posix.join(folder, path.slice(0, path.lastIndexOf('/', filled) + 1))).replace(/\/+$/, '')}/`;
    for (const each of files) if (each.startsWith(inside) && !each.slice(inside.length).includes('/') && isCode(each)) found.add(each);
  }
  if (startsTools(text)) found.add(DP);
  return found;
}

// the proof tools, as tools/dp.mjs lists them
export const toolsOf = repo => [...(repo.text(DP) ?? '').matchAll(/^ {2}(\w+): '/gm)].map(([, tool]) => tool);

// The tools a set of files can start: each one that a test among them, or a file that starts the tools, writes the name
// of as a word of its own in quotes, alone or first in a line of words, as the tools are started by their name. A name
// that is also a common word, such as new or read, counts whenever it's written so, which starts a test too often and
// never too seldom.
export function toolsStarted(seen, repo) {
  const texts = [...seen].filter(file => file !== DP).map(file => [file, repo.text(file) ?? '']).filter(([file, text]) => file.startsWith('tools/test/') || startsTools(text));
  return toolsOf(repo).filter(tool => texts.some(([, text]) => new RegExp(`['"\`]${tool}(?:['"\`]|\\s)`).test(text))).map(tool => `tools/${tool}.mjs`);
}

// every file a script reaches: itself, what it names, and what those name. A file that is named and isn't there stays,
// so taking one away starts the tests that named it.
export function reached(entries, repo) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const text = repo.text(file);
      if (text !== null) queue.push(...named(file, text, repo.files));
    }
    // the tools it starts, which may start others
    if (seen.has(DP)) queue.push(...toolsStarted(seen, repo).filter(file => !seen.has(file)));
  }
  for (const own of Object.keys(OWN_TESTS)) seen.delete(own);
  return seen;
}

// What a console's workflow reaches: its tests' scripts and the tests' files those reach, what each of them names
// itself, and each tool they start by name, but not what those go on to import, which Check tries on every pull request,
// unless it counts on every system.
export function near(entries, repo, of = []) {
  const all = reached(entries, repo);
  // another console's own code counts only when a test names it
  const anothers = file => consolesOwning(file).length > 0 && !consolesOwning(file).some(id => of.includes(id));
  const tests = [...entries, ...[...all].filter(file => file.startsWith('tools/test/'))];
  const found = new Set(tests);
  for (const file of all) if (EVERY_SYSTEM.includes(file) || (asksSystem(repo.text(file) ?? '') && !anothers(file))) found.add(file);
  for (const file of tests) for (const each of named(file, repo.text(file) ?? '', repo.files)) found.add(each);
  if (found.has(DP)) for (const tool of toolsStarted(new Set(tests), repo)) found.add(tool);
  for (const own of Object.keys(OWN_TESTS)) found.delete(own);
  return found;
}

// the files a script of package.json starts with
export function entriesOf(script, scripts) {
  return [...String(scripts[script] ?? '').matchAll(/\bnode (tools\/[\w./-]+\.mjs)/g)].map(([, file]) => file);
}

// the commands a workflow's file runs: its tests, the scripts it starts by their path, and the proof tools
export function workflowEntries(text, scripts) {
  const entries = new Set();
  for (const [, script] of text.matchAll(/\bnpm run (test:[\w-]+)/g)) for (const entry of entriesOf(script, scripts)) entries.add(entry);
  for (const [, file] of text.matchAll(/\bnode (tools\/[\w./-]+\.mjs)/g)) entries.add(file);
  for (const [, tool] of text.matchAll(/\bnpm run dp -- (\w+)/g)) entries.add(DP).add(`tools/${tool}.mjs`);
  return [...entries];
}

/**
 * Everything that can be started, each with the files it reaches: Check's commands, and each console's workflow.
 * A command of Check reaches every file its script does, however far. A console's workflow runs the same kind of tests
 * again on Mac and Windows, where what can go wrong alone is what those systems build and the console's own code, so it
 * reaches only what its tests name themselves and the shared code that counts on every system (near).
 * @param {{ files: string[], text: (file: string) => string | null }} repo
 */
export function targets(repo) {
  const scripts = JSON.parse(repo.text('package.json')).scripts;
  const commands = PARTS.flatMap(({ part, commands: list }) => list.map(command => {
    const script = scriptOf(command.run);
    // a test reaches what its script does; the light part and the build are started by rules of their own
    const entries = script?.startsWith('test:') ? entriesOf(script, scripts) : [];
    return { ...command, part, of: command.of ?? [], reaches: reached(entries, repo), served: true, everything: EVERYTHING, games: true };
  }));
  const workflows = Object.entries(WORKFLOWS).map(([name, { of, also = [] }]) => {
    const file = `.github/workflows/${name}`;
    const entries = workflowEntries(repo.text(file) ?? '', scripts);
    return { workflow: name, of, reaches: near(entries, repo, of), served: false, everything: [...INSTALLED, file, ...also], games: false };
  });
  return { commands, workflows };
}

// the consoles that own a file: their kit's and tools' folders, their tests, their emulator's patch and their picture
export function consolesOwning(file) {
  const patch = /^tools\/libretro\/([^/]+)\.patch$/.exec(file)?.[1];
  if (patch) return PATCHES[patch] ?? [];
  const folder = /^(?:kit|tools)\/([^/]+)\//.exec(file)?.[1];
  const picture = /^public\/systems\/([^/]+)\.svg$/.exec(file)?.[1];
  const test = /^tools\/test\/(part-tasks\/)?([^/]+)/.exec(file);
  return IDS.filter(id => {
    if (folder === folderOf(id) || picture === id) return true;
    if (!test) return false;
    const name = TEST_NAME[id] ?? id;
    const starts = test[1] ? [name] : [`${name}-`, `made-up-${name}`, `real-${name}`];
    return starts.some(start => test[2].startsWith(start) && /^(?:[.-]|$)/.test(test[2].slice(start.length - (start.endsWith('-') ? 1 : 0))));
  });
}

/**
 * The console a game in games/ is for, as its entry's platform names it, or null when nothing says.
 * @param {string} game
 * @param {{ text: (file: string) => string | null }} repo
 */
export function consolesOfGame(game, repo) {
  const platform = /^platform:\s*["']?(.+?)["']?\s*$/m.exec(repo.text(`games/${game}/entry.md`) ?? '')?.[1];
  const ids = IDS.filter(id => CONSOLES[id].name === platform);
  return ids.length ? ids : null;
}

/**
 * Whether a change to a file starts a target, one of targets()'s.
 * @returns {boolean}
 */
export function starts(file, target, repo) {
  if (under(file, target.everything)) return true;
  if (file in OWN_TESTS) return false;
  const shares = ids => ids.some(id => target.of.includes(id));
  // what reads the folder the file is in, beside what imports it
  const reads = table => Object.entries(table).some(([reader, paths]) => target.reaches.has(reader) && under(file, paths));
  const read = reads(BUILT) || (target.served && reads(SERVED));
  if (target.reaches.has(file)) return true;

  const game = /^games\/([^/]+)\//.exec(file)?.[1];
  if (game) {
    // a game is on the site, and counts for its console's tests alone; the consoles' workflows read no game
    if (target.site) return true;
    if (!target.games) return false;
    const ids = consolesOfGame(game, repo);
    return ids ? shares(ids) : true;
  }
  if (file.startsWith('kit/')) {
    if (target.site) return true;
    // reached by its imports, as the code it is, or by nothing
    if (file === 'kit/consoles.js' || file.startsWith('kit/copy/')) return false;
    const owners = consolesOwning(file);
    if (owners.length) return shares(owners);
    // what every console's kit in C is built on starts the tests that build a game in C or serve one, and a kit for a
    // console nothing here knows starts everything
    if (!file.startsWith('kit/c/')) return true;
    return read && !file.endsWith('.md') && !file.endsWith('/LICENSE');
  }
  if (file.startsWith('tools/')) {
    // the docs, and the tests npm run check runs by itself, which no other test imports
    if (under(file, LIGHT) || file.endsWith('.md') || file.endsWith('.test.mjs')) return false;
    const owners = consolesOwning(file);
    if (/^tools\/libretro\/[^/]+\.patch$/.test(file)) return shares(owners);
    if (shares(owners) || read) return true;
    // beside a test, the files of its name: tools/test/twin/ and tools/test/made-up-game.c go with their .mjs
    const beside = /^tools\/test\/([^/.]+)[/.]/.exec(file)?.[1];
    if (beside && repo.files.includes(`tools/test/${beside}.mjs`)) return target.reaches.has(`tools/test/${beside}.mjs`);
    // or the files a test names in its text, as tools/test/stand-in/ and tools/test/made-up-core.c are
    if (beside) {
      const naming = repo.files.filter(each => /^tools\/test\/[^/]+\.mjs$/.test(each) && (repo.text(each) ?? '').includes(beside));
      if (naming.length) return naming.some(each => target.reaches.has(each));
    }
    // code is reached by its imports, or by nothing; anything else that no rule above knows starts everything
    const known = owners.length || [BUILT, SERVED].some(table => Object.values(table).some(paths => under(file, paths)));
    return !known && !(isCode(file) && !/^tools\/test\/[^/]+\//.test(file));
  }
  if (under(file, SITE)) {
    if (target.site) return true;
    if (file.startsWith('public/systems/')) return shares(consolesOwning(file));
    // the games' recordings are the site's alone; the rest of public/ is served to a page that plays a game
    return read && !file.startsWith('public/media/');
  }
  if (under(file, LIGHT) || file.endsWith('.md')) return false;
  return true;
}

/**
 * What a pull request that changed these files starts in Check: each part with the commands to run in it, and why.
 * @param {string[] | null} changed the files, or null when nobody knows them, which starts everything
 */
export function partsFor(changed, repo, { commands } = targets(repo)) {
  const parts = [], why = [];
  for (const { part, minutes } of PARTS) {
    const runs = [];
    for (const command of commands.filter(each => each.part === part)) {
      const first = command.always ? 'every pull request' : changed === null ? 'the changed files aren\'t known' : changed.find(file => starts(file, command, repo));
      if (first === undefined) continue;
      runs.push(command.run);
      why.push({ part, run: command.run, first });
    }
    if (runs.length) parts.push({ part, ...(minutes ? { minutes } : {}), run: runs.join('\n') });
  }
  return { parts, why };
}

/** The console workflows a change to these files starts, by their file's name. */
export function workflowsFor(changed, repo, { workflows } = targets(repo)) {
  return workflows.filter(workflow => changed.some(file => starts(file, workflow, repo))).map(({ workflow }) => workflow);
}

// The paths that start a workflow, for GitHub to read: every tracked file that starts it, with a folder standing for its
// files when all of them do, so a new file in it starts the workflow too.
export function pathsOf(workflow, repo) {
  const set = new Set(repo.files.filter(file => starts(file, workflow, repo)));
  // a file a script names that isn't there yet, or any more
  for (const file of workflow.reaches) if (!repo.files.includes(file) && starts(file, workflow, repo)) set.add(file);
  const tree = new Map();
  for (const file of repo.files) {
    for (let folder = posix.dirname(file); folder !== '.'; folder = posix.dirname(folder)) {
      const counted = tree.get(folder) ?? { all: 0, started: 0 };
      counted.all++;
      if (set.has(file)) counted.started++;
      tree.set(folder, counted);
    }
  }
  const whole = folder => tree.get(folder)?.all === tree.get(folder)?.started;
  const paths = new Set();
  for (const file of set) {
    let top = null;
    for (let folder = posix.dirname(file); folder !== '.'; folder = posix.dirname(folder)) if (whole(folder)) top = folder;
    paths.add(top ? `${top}/**` : file);
  }
  return [...paths].sort();
}

const PATHS = /^( {4}paths:\n)(?: {6}- .*\n)+/gm;

// a workflow's text with these paths as what starts it, on a pull request and on main
export function withPaths(text, paths) {
  return text.replace(PATHS, (_, head) => head + paths.map(path => `      - '${path}'\n`).join(''));
}

/** Each console workflow whose paths aren't what the map gives, with what they should be. */
export function stalePaths(repo, { workflows } = targets(repo)) {
  const stale = [];
  for (const workflow of workflows) {
    const file = `.github/workflows/${workflow.workflow}`;
    const text = repo.text(file);
    const fresh = withPaths(text, pathsOf(workflow, repo));
    if (fresh !== text) stale.push({ file, fresh });
  }
  return stale;
}

// what GitHub's API answers, as .github/stack/stack.mjs asks it
async function changedFiles({ repository: name, token, number }) {
  const { github } = await import('../stack/stack.mjs');
  const files = await github({ repository: name, token }).list(`/pulls/${number}/files`);
  // GitHub lists 3,000 files of a pull request and no more
  if (files.length >= 3000) return null;
  return files.flatMap(file => [file.filename, file.previous_filename]).filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [option, ...rest] = process.argv.slice(2);
  const repo = repository();
  if (option === '--write') {
    const stale = stalePaths(repo);
    for (const { file, fresh } of stale) writeFileSync(file, fresh);
    console.log(stale.length ? `Wrote the paths of ${stale.map(({ file }) => file).join(', ')}.` : 'Every console workflow\'s paths are as the map gives them.');
  } else if (option === '--say') {
    const all = targets(repo);
    const { parts } = partsFor(rest, repo, all);
    for (const { part, run } of parts) console.log(`Check (${part}): ${run.split('\n').map(each => each.replace('npm run ', '')).join(', ')}`);
    const others = workflowsFor(rest, repo, all);
    console.log(others.length ? `Workflows: ${others.join(', ')}` : 'No console workflow.');
  } else {
    let said;
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
      const number = event.pull_request?.number;
      const changed = number ? await changedFiles({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN, number }) : null;
      said = partsFor(changed, repo);
      console.log(changed ? `The pull request changes ${changed.length} files.` : 'Nobody knows which files changed, so every part runs.');
    } catch (error) {
      console.log(`::warning title=Checks::What the pull request changes couldn't be worked out, so every part runs. ${String(error.message).replace(/\s+/g, ' ').slice(0, 300)}`);
      said = partsFor(null, repo, { commands: PARTS.flatMap(({ part, commands }) => commands.map(command => ({ ...command, part }))) });
    }
    const lines = said.why.map(({ part, run, first }) => `Check (${part}) runs ${run.replace('npm run ', '')}: ${first}`);
    const left = PARTS.filter(({ part }) => !said.parts.some(each => each.part === part)).map(({ part }) => part);
    if (left.length) lines.push(`Left out, as nothing the pull request changes reaches them: ${left.join(', ')}.`);
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.map(line => `- ${line}`).join('\n')}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `parts=${JSON.stringify(said.parts)}\n`);
  }
}
