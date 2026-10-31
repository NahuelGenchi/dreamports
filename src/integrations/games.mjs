// Puts the games in this repository on the site (#74), and the kits they start from (#76). After
// `astro build`, each folder in games/ is copied as it is to dist/play/<game>/, and each in kit/ to
// dist/kit/<console>/, which Cloudflare serves at /play/<game>/ and /kit/<console>/ as plain files. The
// build stops and names every problem if a folder breaks one of the rules in games/README.md, or if the
// site grows past what Cloudflare's free plan takes.
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// a game's folder name is its address: lowercase letters and numbers, with single dashes between them
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LICENSES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt'];
// what Cloudflare's free plan serves in one version of the site: this many files, none bigger than this
const MOST_FILES = 20_000;
const MOST_BYTES = 25 * 1024 * 1024;
// the two kinds of folders: games, each with a page of its own, and the kits they share, one for each console
const GAMES = { folder: 'games', address: 'play', what: 'game', example: 'sonic-advance', page: true };
const KITS = { folder: 'kit', address: 'kit', what: 'kit', example: 'gba', page: false };

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
        for (const { kind, folder, names } of found) {
          for (const name of names) await copy(join(folder, name), join(site, kind.address, name));
          logger.info(names.length ? `Copied to /${kind.address}/: ${names.join(', ')}` : `No ${kind.what}s in ${kind.folder}/`);
        }

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

// copies a game's or a kit's files, leaving out names starting with a dot
async function copy(from, to) {
  for (const file of (await walk(from, false)).files) {
    const target = join(to, relative(from, file.path));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.path, target);
  }
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
