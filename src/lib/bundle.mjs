// What players get of a game (#89): each script its pages load, as one minified file of everything it imports. The
// site's build does this to its copy of each game, and prove and test:game to a copy of their own (tools/lib/built.mjs),
// so what they play is what players get.
import { access, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';

const SOURCE = 'https://github.com/NahuelGenchi/dreamports';
const exists = (path) => access(path).then(() => true, () => false);

/**
 * Replaces each script a game's pages load with one minified file of everything it imports, source map beside it,
 * and puts the audio thread's bundle in src/, where the page's bundle now looks for it: the game's own audio thread,
 * or else its kit's. `folder` is a copy of the game, in `site` beside a copy of its kit, whose imports reach the kit as
 * they do on the site, so the maps name files by their addresses and nothing of this computer. The other files stay
 * at their addresses, as a game's achievements list is loaded from its own (src/lib/players.ts). Stops, naming every
 * problem, if a bundle wouldn't find what it loads.
 */
export async function bundleGame(folder, site, kit, commit) {
  const game = basename(folder);
  const pages = (await readdir(folder)).filter((file) => file.endsWith('.html'));
  const scripts = (await Promise.all(pages.map((page) => readFile(join(folder, page), 'utf8'))))
    .flatMap((html) => [...html.matchAll(/<script type="module" src="([^"]+)\.js"/g)].map((script) => script[1]));
  const audio = ['src/sound/worklet.js', ...(kit ? [`../../kit/${kit}/sound/worklet.js`] : [])];
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
    banner: { js: `// GPL-3.0-or-later. Source: ${SOURCE}/tree/${commit ?? 'main'}/games/${game}` },
  });

  const at = `games/${game}/`;
  const problems = Object.keys(metafile.inputs)
    .filter((input) => relative(site, resolve(folder, input)).startsWith('..'))
    .map((input) => `${at}: It imports ${input}, which the site doesn’t serve.`);
  for (const output of Object.keys(metafile.outputs).filter((path) => path.endsWith('.js'))) {
    const code = await readFile(join(folder, output), 'utf8');
    const loads = [...code.matchAll(/new URL\("([^"]+)",import\.meta\.url\)/g)];
    if (loads.length !== code.split('import.meta.url').length - 1) problems.push(`${at}${output}: It uses import.meta.url for something other than a file’s address, which a bundle moves.`);
    for (const [, path] of loads) {
      if (!(await exists(join(folder, dirname(output), path)))) problems.push(`${at}${output}: It loads ${path}, which isn’t beside it.`);
    }
  }
  if (problems.length) throw new Error(`These games’ bundles wouldn’t work:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
}
