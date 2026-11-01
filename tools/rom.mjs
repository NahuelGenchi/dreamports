// npm run dp -- rom <file or folder>… [--game "<name>"]: checks copies of games, says which game and which version
// each is, and remembers where it is on this computer, for the other tools. It only reads the files: it never copies
// them, changes them or sends them anywhere. In a folder it names only the copies a Dreamport here measures against,
// and those of the game --game names, by its header or its file's name, and sums up the rest in one line. Without a
// file, it lists the copies it remembers.

import { readdirSync, statSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { readCopy } from './gba/header.mjs';
import { proofGames, readOriginal } from './lib/proof-files.mjs';
import { remember, rememberedCopies } from './lib/copies.mjs';

const EXTENSIONS = ['.gba', '.bin', '.agb'];
const USAGE = 'Usage: npm run dp -- rom [<file or folder>…] [--game "<name>"]';

export async function run(args) {
  const { paths, game } = options(args);
  if (!paths.length) {
    if (game) throw new Error(`--game picks out a game's copies in a file or folder you give.\n${USAGE}`);
    const copies = Object.entries(rememberedCopies());
    if (!copies.length) console.log('No copies remembered yet: npm run dp -- rom <file> checks one.');
    for (const [sha1, copy] of copies) console.log(`${copy.name}${copy.game ? ` (games/${copy.game})` : ''}: ${copy.path}\n  SHA-1 ${sha1}`);
    return 0;
  }
  const originals = proofGames().map(game => ({ game, ...readOriginal(game) }));
  const named = game && namedBy(game);
  let found = 0;
  for (const arg of paths) {
    const path = resolve(arg);
    let folder, files;
    try {
      folder = statSync(path).isDirectory();
      files = folder
        ? readdirSync(path).filter(f => EXTENSIONS.includes(extname(f).toLowerCase())).sort().map(f => join(path, f))
        : [path];
    } catch {
      console.log(`${arg}: not found.`);
      continue;
    }
    const kinds = { measured: 0, named: 0, other: 0, none: 0 };
    for (const file of files) kinds[await check(file, originals, named, folder)]++;
    found += kinds.measured + kinds.named;
    if (folder) summary(arg, files.length, kinds, game);
  }
  return found ? 0 : 1;
}

function options(args) {
  const found = { paths: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--game') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--game needs the game's name, such as --game "Sonic Battle".\n${USAGE}`);
      found.game = args[++i];
    } else if (args[i].startsWith('--')) throw new Error(`rom has no ${args[i]}.\n${USAGE}`);
    else found.paths.push(args[i]);
  }
  return found;
}

// Checks one copy and says what it is, unless it's in a folder and nothing here measures against it. Returns what it
// found: a copy a Dreamport measures against, the game --game names, another game, or no game at all.
async function check(file, originals, named, inFolder) {
  const copy = await readCopy(file);
  if (!copy) {
    if (!inFolder) console.log(`${file}\n  Not a Game Boy Advance game.`);
    return 'none';
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
  } else if (named?.(copy, file)) {
    console.log(`${file}\n  "${named.game}" by its ${named.how}, a game no Dreamport here measures against yet: ${header}, SHA-1 ${copy.sha1}.`);
    return 'named';
  } else {
    if (!inFolder) console.log(`${file}\n  A Game Boy Advance game none of the Dreamports here measures against: ${header}, SHA-1 ${copy.sha1}.`);
    return 'other';
  }
  return 'measured';
}

// One line for what a folder holds besides the copies named above.
function summary(folder, count, kinds, game) {
  if (!count) return console.log(`${folder}: no .gba, .agb or .bin files.`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const rest = [
    kinds.other && plural(kinds.other, 'Game Boy Advance game', 'Game Boy Advance games') + `${kinds.other === 1 ? ' that' : ''} no Dreamport here measures against`,
    kinds.none && plural(kinds.none, "file that isn't a Game Boy Advance game", "files that aren't Game Boy Advance games"),
  ].filter(Boolean);
  if (!rest.length) return;
  const others = kinds.measured + kinds.named ? 'also ' : '';
  const hint = !kinds.other ? '' : game
    ? kinds.named ? '' : ` None of them is "${game}" by its header or its file's name.`
    : ' --game "<its name>" names a game\'s copies among them.';
  console.log(`${kinds.measured + kinds.named ? '\n' : ''}${folder}: ${others}${rest.join(', and ')}.${hint}`);
}

// A game's name, or a file's, as words of lowercase letters and digits, without accents, what's in brackets, "the",
// "and" or "Dreamport", so "The Legend of Zelda (USA).gba" and "Legend of Zelda" give the same words.
const SKIP = new Set(['the', 'and', 'dreamport']);
const wordsOf = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[([].*$/, '').split(/[^a-z0-9]+/).filter(word => word && !SKIP.has(word));
// a number or a Roman numeral right after the name, as in Sonic Advance 2: another game of the series
const SEQUEL = /^(\d+|[ivx]+)$/;

// Whether a copy is the game a name names, as /dreamport knows it, such as "Sonic Battle (Game Boy Advance)": its
// header gives the same letters, or the first twelve of them when the name is too long for a header, or its file's
// name has the name's words in a row, not followed by a number.
function namedBy(game) {
  const words = wordsOf(game);
  if (!words.length) throw new Error(`--game needs the game's name, such as --game "Sonic Battle".\n${USAGE}`);
  const letters = words.join('');
  const named = (copy, file) => {
    const title = wordsOf(copy.title).join('');
    if (title === letters || (copy.title.length === 12 && title.length >= 8 && letters.startsWith(title))) {
      named.how = 'header';
      return true;
    }
    const name = wordsOf(basename(file, extname(file)));
    for (let i = 0; i + words.length <= name.length; i++) {
      if (words.every((word, j) => name[i + j] === word) && !SEQUEL.test(name[i + words.length] ?? '')) {
        named.how = "file's name";
        return true;
      }
    }
    return false;
  };
  named.game = game.replace(/\s*[([].*$/, '').replace(/\s+dreamport$/i, '').trim();
  return named;
}
