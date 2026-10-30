// Puts the games in this repository on the site (#74). After `astro build`, each folder in games/ is
// copied as it is to dist/play/<game>/, where the site's Worker serves it at /play/<game>/. The build
// stops and names every problem if a folder breaks one of the rules in games/README.md, or if the site
// grows past what Cloudflare's free plan takes.
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// a game's folder name is its address: lowercase letters and numbers, with single dashes between them
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LICENSES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md', 'COPYING.txt'];
// what Cloudflare's free plan serves in one version of the site: this many files, none bigger than this
const MOST_FILES = 20_000;
const MOST_BYTES = 25 * 1024 * 1024;

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
        const folder = join(root, 'games');
        const names = await gameFolders(folder);
        const problems = [];
        for (const name of names) problems.push(...(await problemsWith(folder, name, site)));
        stopIf('The games in games/ can’t go on the site', problems);
        for (const name of names) await copy(join(folder, name), join(site, 'play', name));
        logger.info(names.length ? `Copied to /play/: ${names.join(', ')}` : 'No games in games/');

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

// every game's folder name: whatever is in games/ besides plain files, such as its README, and names
// starting with a dot
async function gameFolders(folder) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => !entry.isFile() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

// what keeps games/<name>/ off the site, in words for whoever made it: nothing, when it's ready
async function problemsWith(folder, name, site) {
  const at = `games/${name}/`;
  const problems = [];
  if (!NAME.test(name)) {
    problems.push(`${at}: The folder’s name is the game’s address, so it has only lowercase letters, numbers and single dashes, such as sonic-advance.`);
  }
  if (!(await lstat(join(folder, name))).isDirectory()) {
    return [...problems, `${at}: A game is a folder of its own, not a link to one somewhere else.`];
  }
  const { files, others } = await walk(join(folder, name), false);
  const paths = new Set(files.map((file) => relative(join(folder, name), file.path)));
  if (!paths.has('index.html')) problems.push(`${at}: It needs an index.html, the page the game starts from.`);
  if (!LICENSES.some((license) => paths.has(license))) {
    problems.push(`${at}: It needs a license for its code, in a file named LICENSE or COPYING.`);
  }
  for (const other of others) {
    problems.push(`${at}${relative(join(folder, name), other)}: Every file has to be a plain file in the game’s folder, not a link.`);
  }
  if (await exists(join(site, 'play', name))) {
    problems.push(`${at}: The site already has its own /play/${name}/, from public/ or src/pages/.`);
  }
  return problems;
}

// copies a game's files, leaving out names starting with a dot
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
