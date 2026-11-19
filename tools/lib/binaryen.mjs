// Binaryen, the WebAssembly toolkit (github.com/WebAssembly/binaryen, under the Apache License 2.0), as its JavaScript
// build on npm, binaryen: the build runs one of its passes, Asyncify, over a game whose C waits for the screen from
// inside a function (lib/c.mjs, kit/c/pause.c). It's a download of 23 MB and few games need it, so it isn't among what
// `npm ci` installs: the first build that needs it gets it from npm's registry, checks it's the one this names, and
// keeps the one file the pass needs, 15 MB, in .dreamports/binaryen/, which never goes in a commit. `npm run dp -- setup` gets it beforehand.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { LOCAL } from './paths.mjs';

/** Binaryen's version, the same on every computer so the same C comes out as the same WebAssembly everywhere. */
export const BINARYEN_VERSION = '132.0.0';
const PACKAGE = `https://registry.npmjs.org/binaryen/-/binaryen-${BINARYEN_VERSION}.tgz`;
// the package's own hash, as npm's registry gives it
const SHA512 = '4Usg7yEvwO3FMso3Oov6qkOOHSod1IEv+boKkh77kTljM+eNBouqCTbqWswGzbG+vDNO/b/v2C4gfEh1WgB9Lg==';
// what of the package is kept: the library, what makes it a module, and its licence
const KEPT = ['index.js', 'package.json', 'LICENSE'];

const FOLDER = join(LOCAL, 'binaryen', BINARYEN_VERSION);

/** Whether Binaryen is on this computer. */
export const hasBinaryen = () => KEPT.every(name => existsSync(join(FOLDER, name)));

// the files of a .tar by name: each has a block of 512 bytes that names it and gives its length, then its bytes
export function filesIn(tar) {
  const files = new Map();
  for (let at = 0; at + 512 <= tar.length && tar[at];) {
    const text = (from, length) => tar.toString('latin1', at + from, at + from + length).replace(/\0.*$/s, '');
    const size = parseInt(text(124, 12).trim() || '0', 8), kind = text(156, 1);
    if (kind === '0' || kind === '') files.set([text(345, 155), text(0, 100)].filter(Boolean).join('/'), tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Gets Binaryen if it isn't here, saying so. */
export async function ensureBinaryen(log = console.log) {
  if (hasBinaryen()) return;
  log(`Getting Binaryen ${BINARYEN_VERSION}, which lets a game's C wait from inside a function, from npm's registry, 23 MB…`);
  let packed;
  try {
    const response = await fetch(PACKAGE);
    if (!response.ok) throw new Error(`the registry answered ${response.status}`);
    packed = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new Error(`Binaryen couldn't be got from ${PACKAGE}: ${error.cause?.message ?? error.message}. The build needs it for a game that calls kit_wait_frame, and gets it once.`);
  }
  if (createHash('sha512').update(packed).digest('base64') !== SHA512) throw new Error(`What ${PACKAGE} gave isn't Binaryen ${BINARYEN_VERSION} as the tools know it, so it isn't used.`);
  const files = filesIn(gunzipSync(packed));
  // written beside, then moved, so a build stopped halfway leaves nothing that looks whole
  const making = `${FOLDER}.making-${process.pid}`;
  rmSync(making, { recursive: true, force: true });
  mkdirSync(making, { recursive: true });
  for (const name of KEPT) {
    const bytes = files.get(`package/${name}`);
    if (!bytes) throw new Error(`Binaryen's package has no ${name}.`);
    writeFileSync(join(making, name), bytes);
  }
  rmSync(FOLDER, { recursive: true, force: true });
  try {
    renameSync(making, FOLDER);
  } catch (error) {
    // another build got it at the same moment
    rmSync(making, { recursive: true, force: true });
    if (!hasBinaryen()) throw error;
  }
}

let loaded = null;
/** Binaryen itself, got first if it isn't here. */
export async function binaryen(log) {
  await ensureBinaryen(log);
  loaded ??= (await import(pathToFileURL(join(FOLDER, 'index.js')).href)).default;
  return loaded;
}

/** Binaryen's licence, as its package has it, or null before it's got. */
export const binaryenLicence = () => (hasBinaryen() ? readFileSync(join(FOLDER, 'LICENSE'), 'utf8') : null);
