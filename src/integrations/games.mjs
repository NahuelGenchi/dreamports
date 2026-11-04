// Puts the games in this repository on the site (#74), and the kits they start from (#76). After
// `astro build`, each folder in games/ is copied as it is to dist/play/<game>/, and each in kit/ to
// dist/kit/<console>/, which Cloudflare serves at /play/<game>/ and /kit/<console>/ as plain files, all but
// their notes, which are for the people making them (docs/NOTES.md). Then each script a game's page starts from
// is bundled and minified where it is, so a player's browser fetches a few files rather than hundreds (#89). The
// build stops and names every problem if a folder breaks one of the rules in games/README.md, if a note breaks the
// rules for notes, if a bundle wouldn't find what it loads, or if the site grows past what Cloudflare's free plan
// takes.
import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ENTRY } from '../lib/entries.mjs';
import { checkNotes, kitOf } from '../lib/notes.mjs';
import { commit } from './live-site.mjs';

// a game's folder name is its address: lowercase letters and numbers, with single dashes between them
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LICENSES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt'];
// what Cloudflare's free plan serves in one version of the site: this many files, none bigger than this
const MOST_FILES = 20_000;
const MOST_BYTES = 25 * 1024 * 1024;
// the two kinds of folders: games, each with a page of its own, and the kits they share, one for each console
const GAMES = { folder: 'games', address: 'play', what: 'game', example: 'sonic-advance', page: true };
const KITS = { folder: 'kit', address: 'kit', what: 'kit', example: 'gba', page: false };
const SOURCE = 'https://github.com/NahuelGenchi/dreamports';

/** @returns {import('astro').AstroIntegration} */
export default function games() {
  let root = '';
  return {
    name: 'dreamports-games',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:build:done': async ({ dir, logger }) => {
        const site = fileURLToPath(dir);
        const found = [];
        for (const kind of [GAMES, KITS]) {
          const folder = join(root, kind.folder);
          const names = await folders(folder);
          const problems = [];
          for (const name of names) problems.push(...(await problemsWith(kind, folder, name, site)));
          stopIf(`The ${kind.what}s in ${kind.folder}/ can’t go on the site`, problems);
          found.push({ kind, folder, names });
        }
        stopIf('These notes break the rules for notes (docs/NOTES.md)', checkNotes(root).map(({ path, why }) => `${path}: ${why}`));
        for (const { kind, folder, names } of found) {
          for (const name of names) await copy(join(folder, name), join(site, kind.address, name));
          logger.info(names.length ? `Copied to /${kind.address}/: ${names.join(', ')}` : `No ${kind.what}s in ${kind.folder}/`);
        }
        const { names } = found[0];
        for (const name of names) await bundle(site, root, name);
        logger.info(`Bundled the scripts of: ${names.join(', ')}`);

        const { files } = await walk(site, true);
        const largest = files.reduce((most, file) => Math.max(most, file.size), 0);
        stopIf('The site is too big for Cloudflare’s free plan', [
          ...(files.length > MOST_FILES ? [`It has ${count(files.length)} files, and the plan takes ${count(MOST_FILES)}.`] : []),
          ...files
            .filter((file) => file.size > MOST_BYTES)
            .map((file) => `${relative(site, file.path)} is ${mib(file.size)}, and the plan takes files up to ${mib(MOST_BYTES)}.`),
        ]);
        logger.info(
          `The site has ${count(files.length)} files, the largest ${mib(largest)}: Cloudflare’s free plan takes ${count(MOST_FILES)}, of up to ${mib(MOST_BYTES)} each`,
        );
      },
    },
  };
}

// every game's or kit's folder name: whatever is in games/ or kit/ besides plain files, such as its
// README, and names starting with a dot
async function folders(folder) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => !entry.isFile() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// what keeps games/<name>/ or kit/<name>/ off the site, in words for whoever made it: nothing, when it's ready
async function problemsWith(kind, folder, name, site) {
  const { what } = kind;
  const at = `${kind.folder}/${name}/`;
  const problems = [];
  if (!NAME.test(name)) {
    problems.push(`${at}: The folder’s name is the ${what}’s address, so it has only lowercase letters, numbers and single dashes, such as ${kind.example}.`);
  }
  if (!(await lstat(join(folder, name))).isDirectory()) {
    return [...problems, `${at}: A ${what} is a folder of its own, not a link to one somewhere else.`];
  }
  const { files, others } = await walk(join(folder, name), false);
  const paths = new Set(files.map((file) => relative(join(folder, name), file.path)));
  if (kind.page && !paths.has('index.html')) problems.push(`${at}: It needs an index.html, the page the game starts from.`);
  if (kind.page && !paths.has(ENTRY)) problems.push(`${at}: It needs its entry, ${ENTRY}, which says everything about it and makes its page on the site.`);
  if (!LICENSES.some((license) => paths.has(license))) {
    problems.push(`${at}: It needs a license for its code, in a file named LICENSE or COPYING.`);
  }
  for (const other of others) {
    problems.push(`${at}${relative(join(folder, name), other)}: Every file has to be a plain file in the ${what}’s folder, not a link.`);
  }
  if (await exists(join(site, kind.address, name))) {
    problems.push(`${at}: The site already has its own /${kind.address}/${name}/, from public/ or src/pages/.`);
  }
  return problems;
}

// copies a game's or a kit's files, leaving out names starting with a dot and its notes
async function copy(from, to) {
  for (const file of (await walk(from, false)).files) {
    if (relative(from, file.path).split(sep)[0] === 'notes') continue;
    const target = join(to, relative(from, file.path));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.path, target);
  }
}

// Replaces each script a game's pages load with one minified file of everything it imports, source map beside it,
// and puts the audio thread's bundle in src/, where the page's bundle now looks for it: the game's own audio thread,
// or else its kit's. It bundles the copies in dist/, whose imports reach the kit as they do on the site, so the maps
// name files by their addresses and nothing of this computer. The other files stay at their addresses, as a game's
// achievements list is loaded from its own (src/lib/players.ts).
async function bundle(site, root, game) {
  const folder = join(site, GAMES.address, game);
  const pages = (await readdir(folder)).filter((file) => file.endsWith('.html'));
  const scripts = (await Promise.all(pages.map((page) => readFile(join(folder, page), 'utf8'))))
    .flatMap((html) => [...html.matchAll(/<script type="module" src="([^"]+)\.js"/g)].map((script) => script[1]));
  const kit = kitOf(root, game);
  const audio = ['src/sound/worklet.js', ...(kit ? [`../../${KITS.address}/${kit}/sound/worklet.js`] : [])];
  const worklet = (await Promise.all(audio.map((path) => exists(join(folder, path))))).indexOf(true);
  const entryPoints = [...new Set(scripts)].map((script) => ({ in: `${script}.js`, out: script }));
  if (worklet >= 0) entryPoints.push({ in: audio[worklet], out: 'src/worklet' });

  const { metafile } = await build({
    absWorkingDir: folder,
    entryPoints,
    outdir: '.',
    allowOverwrite: true,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    sourcemap: true,
    metafile: true,
    logLevel: 'error',
    banner: { js: `// GPL-3.0-or-later. Source: ${SOURCE}/tree/${commit(root) ?? 'main'}/${GAMES.folder}/${game}` },
  });

  const at = `${GAMES.folder}/${game}/`;
  const problems = Object.keys(metafile.inputs)
    .filter((input) => !resolve(folder, input).startsWith(site))
    .map((input) => `${at}: It imports ${input}, which the site doesn’t serve.`);
  for (const output of Object.keys(metafile.outputs).filter((path) => path.endsWith('.js'))) {
    const code = await readFile(join(folder, output), 'utf8');
    const loads = [...code.matchAll(/new URL\("([^"]+)",import\.meta\.url\)/g)];
    if (loads.length !== code.split('import.meta.url').length - 1) problems.push(`${at}${output}: It uses import.meta.url for something other than a file’s address, which a bundle moves.`);
    for (const [, path] of loads) {
      if (!(await exists(join(folder, dirname(output), path)))) problems.push(`${at}${output}: It loads ${path}, which isn’t beside it.`);
    }
  }
  stopIf('These games’ bundles wouldn’t work', problems);
}

// every file in a folder and the folders inside it, with its size, and anything else found there, such
// as a link; `hidden` says whether names starting with a dot count
async function walk(folder, hidden, found = { files: [], others: [] }) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!hidden && entry.name.startsWith('.')) continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await walk(path, hidden, found);
    else if (entry.isFile()) found.files.push({ path, size: (await lstat(path)).size });
    else found.others.push(path);
  }
  return found;
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function stopIf(heading, problems) {
  if (problems.length) throw new Error(`${heading}:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
}

const count = (number) => number.toLocaleString('en');
const mib = (bytes) => `${Number((bytes / 1024 / 1024).toFixed(1))} MiB`;
