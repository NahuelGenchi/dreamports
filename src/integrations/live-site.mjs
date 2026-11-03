// Lets the site be compared with the repository (docs/LIVE-SITE.md). After `astro build`, it writes which commit the
// build was made from to dist/build.json, which .github/live-site/watch.mjs reads on dreamports.net, and it stops the
// build if a Dreamport's card doesn't show the numbers its proof/ folder makes, so such a build never goes live.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { problemsWith } from '../lib/cards.mjs';
import { dreamports } from '../../tools/readme.mjs';

// what was checked out, which a Deploy Hook's build only has in its clone; Cloudflare's own word for it comes second
function commit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.env.WORKERS_CI_COMMIT_SHA || null;
  }
}

/** @returns {import('astro').AstroIntegration} */
export default function liveSite() {
  let root = '';
  return {
    name: 'dreamports-live-site',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:build:done': async ({ dir, logger }) => {
        const site = fileURLToPath(dir);
        const problems = await problemsWith(dreamports(), path => readFile(join(site, path, 'index.html'), 'utf8').catch(() => null));
        if (problems.length) throw new Error(`These cards don't show what their games' proof makes (docs/LIVE-SITE.md):\n${problems.map((p) => `- ${p}`).join('\n')}`);
        const from = commit(root);
        await writeFile(join(site, 'build.json'), `${JSON.stringify({ commit: from })}\n`);
        logger.info(`Every Dreamport's cards show its proof's numbers, in a build of ${from ?? 'no commit'}`);
      },
    },
  };
}
