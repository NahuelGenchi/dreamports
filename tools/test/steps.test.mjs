// Steps in the browser's history (kit/gba/ui/steps.js): in the Home Screen app on an iPhone or iPad a slide in from the
// screen's edge goes to the page before or after, so the site and the kit add a step only through stepTo and goTo,
// which add none there (#1245, #1247). A game's own code is caught where the browser announces the move, in steps.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO } from '../lib/paths.mjs';

const STEPS = 'kit/gba/ui/steps.js';
const STEPPING = [/history\.pushState\s*\(/, /location\.assign\s*\(/, /location(\.href)?\s*=(?!=)/];

function* files(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(m?js|ts|astro|html)$/.test(entry.name)) yield path;
  }
}

test('the site and the kit add a step to the browser\'s history only through steps.js', () => {
  const found = [];
  for (const folder of ['src', 'kit']) {
    for (const path of files(join(REPO, folder))) {
      const file = relative(REPO, path);
      if (file === STEPS) continue;
      readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
        if (STEPPING.some(pattern => pattern.test(line))) found.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(found, [], 'use stepTo or goTo from kit/gba/ui/steps.js instead');
});

test('the check sees each way of adding a step', () => {
  for (const line of ["history.pushState({}, '', '/x/');", "location.assign('/x/');", "location.href = '/x/';", "location = '/x/';"]) {
    assert.ok(STEPPING.some(pattern => pattern.test(line)), line);
  }
  for (const line of ["history.replaceState(null, '', '/x/');", "location.replace('/x/');", "if (location.href === x) go();", "const to = new URL(location.href);"]) {
    assert.ok(!STEPPING.some(pattern => pattern.test(line)), line);
  }
});
