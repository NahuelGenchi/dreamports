// The contributor's copies of the original games: where each is on this computer, remembered by `rom` in
// .dreamports/copies.json. The tools read a copy where it is and never copy it, change it or send it anywhere.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL } from './paths.mjs';

const FILE = join(LOCAL, 'copies.json');

/** Every copy remembered, by the SHA-1 of the whole file: { path, game, name, proof }. */
export function rememberedCopies() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Remembers where a copy is. */
export function remember(sha1, copy) {
  const copies = rememberedCopies();
  copies[sha1] = copy;
  mkdirSync(LOCAL, { recursive: true });
  writeFileSync(FILE, JSON.stringify(copies, null, 2) + '\n');
}

/** The remembered copy with this SHA-1 that is still where it was, or null. */
export function copyWith(sha1) {
  const copy = rememberedCopies()[sha1];
  return copy && existsSync(copy.path) ? copy : null;
}

/** A remembered copy of a game, any version, the one its proof uses first; or null. */
export function copyOf(game, sha1) {
  const exact = copyWith(sha1);
  if (exact) return { sha1, ...exact };
  const other = Object.entries(rememberedCopies()).find(([, c]) => c.game === game && existsSync(c.path));
  return other ? { sha1: other[0], ...other[1] } : null;
}
