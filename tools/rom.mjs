// npm run dp -- rom <file or folder>…: checks copies of games, says which game and which version each is, and
// remembers where it is on this computer, for the other tools. It only reads the files: it never copies them,
// changes them or sends them anywhere. Without a file, it lists the copies it remembers.

import { readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { readCopy } from './gba/header.mjs';
import { proofGames, readOriginal } from './lib/proof-files.mjs';
import { remember, rememberedCopies } from './lib/copies.mjs';

const EXTENSIONS = ['.gba', '.bin', '.agb'];

export async function run(args) {
  if (!args.length) {
    const copies = Object.entries(rememberedCopies());
    if (!copies.length) console.log('No copies remembered yet: npm run dp -- rom <file> checks one.');
    for (const [sha1, copy] of copies) console.log(`${copy.name}${copy.game ? ` (games/${copy.game})` : ''}: ${copy.path}\n  SHA-1 ${sha1}`);
    return 0;
  }
  const originals = proofGames().map(game => ({ game, ...readOriginal(game) }));
  let found = 0;
  for (const arg of args) {
    const path = resolve(arg);
    let files;
    try {
      files = statSync(path).isDirectory()
        ? readdirSync(path).filter(f => EXTENSIONS.includes(extname(f).toLowerCase())).map(f => join(path, f))
        : [path];
    } catch {
      console.log(`${arg}: not found.`);
      continue;
    }
    for (const file of files) found += await check(file, originals) ? 1 : 0;
  }
  return found ? 0 : 1;
}

async function check(file, originals) {
  const copy = await readCopy(file);
  if (!copy) {
    console.log(`${file}\n  Not a Game Boy Advance game.`);
    return false;
  }
  const header = `its header says "${copy.title}", ${copy.code}${copy.region ? `, made for ${copy.region}` : ''}`;
  const exact = originals.find(o => o.sha1 === copy.sha1);
  const same = originals.find(o => o.title === copy.title && o.code.slice(0, 3) === copy.code.slice(0, 3));
  if (exact) {
    remember(copy.sha1, { path: file, game: exact.game, name: exact.name, proof: true });
    console.log(`${file}\n  ${exact.name}, the copy games/${exact.game}'s proof uses. Remembered.`);
  } else if (same) {
    remember(copy.sha1, { path: file, game: same.game, name: `${same.name.replace(/ \(.*\)$/, '')} (${copy.region ?? copy.code}, revision ${copy.revision})`, proof: false });
    console.log(`${file}\n  The game in games/${same.game}, but not the copy its proof uses (${same.name}): ${header}, SHA-1 ${copy.sha1}.`);
    console.log('  Remembered: play opens the game with it, and prove needs the other copy.');
  } else {
    console.log(`${file}\n  A Game Boy Advance game none of the Dreamports here measures against: ${header}, SHA-1 ${copy.sha1}.`);
    return false;
  }
  return true;
}
