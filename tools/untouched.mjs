// npm run dp -- untouched <version> [--all]: what gameplay proven still leaves untouched in a version, from its
// proof/played.json (lib/played.mjs), so the next thing to port or to record comes from the original and not from
// anyone's memory (docs/STANDARD.md#how-progress-is-measured): the functions of the code map that never ran in a frame
// that matched, those that ran with branches gone only one way, each with the address of the branch and the way nobody
// has played, and the stretches of the cartridge's data never used. It prints the biggest of each; --all prints every
// one. `npm run dp -- route <version> <name> --from <recording> --goal untouched` then finds presses that reach code
// not played yet, and `npm run dp -- read <game> <address>` prints the code at an address.

import { readCodeMap, readOriginal, cartridgeOf, hex } from './lib/proof-files.mjs';
import { copyWith } from './lib/copies.mjs';
import { referenceOf } from './lib/reference.mjs';
import { readPlayed, untouchedOf } from './lib/played.mjs';

const count = n => n.toLocaleString('en');

export async function run(args) {
  const all = args.includes('--all'), [game] = args.filter(a => !a.startsWith('--'));
  if (!game) throw new Error('Usage: npm run dp -- untouched <version> [--all]');
  const original = readOriginal(game), codeMap = readCodeMap(game);
  if (!codeMap) throw new Error(`games/${game.split('/')[0]}/proof/ has no code map yet: npm run dp -- codemap ${game.split('/')[0]} makes one.`);
  if ((await referenceOf(original)).seesInstructions !== true) throw new Error("The tools don't see this console's instructions run yet, so they can't say what's untouched.");
  if (!readPlayed(game).places) throw new Error(`games/${game}/proof/played.json isn't there yet: npm run dp -- prove ${game} writes it.`);
  const copy = copyWith(original.sha1);
  if (!copy) throw new Error(`It reads ${original.name}, SHA-1 ${original.sha1}. Show the tools your copy first: npm run dp -- rom <file>.`);
  const { functions, content } = untouchedOf(game, codeMap, cartridgeOf(copy.path));
  const never = functions.filter(f => f.never), partly = functions.filter(f => !f.never);
  const most = list => (all ? list : list.slice(0, 20));
  const more = list => (!all && list.length > 20 ? [`  and ${count(list.length - 20)} more: --all prints them.`] : []);

  console.log(`Functions that never ran in a frame that matched: ${count(never.length)}, with ${count(never.reduce((sum, f) => sum + f.total, 0))} instructions and branch ways.`);
  never.sort((a, b) => b.total - a.total || a.address - b.address);
  for (const f of most(never)) console.log(`  ${f.key}, ${count(f.total)}`);
  for (const line of more(never)) console.log(line);

  console.log(`\nFunctions played in part: ${count(partly.length)}, with ${count(partly.reduce((sum, f) => sum + f.total - f.played, 0))} instructions and branch ways still to play.`);
  partly.sort((a, b) => (b.total - b.played) - (a.total - a.played) || a.address - b.address);
  for (const f of most(partly)) {
    const ways = f.ways.slice(0, all ? Infinity : 6).map(([at, way]) => `${hex(at)} ${way}`).join(', ');
    console.log(`  ${f.key}, ${count(f.total - f.played)} of ${count(f.total)} to play${f.ways.length ? `. Branches gone one way only, with the way to play: ${ways}${!all && f.ways.length > 6 ? `, and ${f.ways.length - 6} more` : ''}` : ''}`);
  }
  for (const line of more(partly)) console.log(line);

  console.log(`\nStretches of the cartridge's data never used: ${count(content.length)}, ${count(content.reduce((sum, [from, to]) => sum + to - from + 1, 0))} bytes.`);
  for (const [from, to] of most(content)) console.log(`  ${hex(from)} to ${hex(to)}, ${count(to - from + 1)} bytes`);
  for (const line of more(content)) console.log(line);
  return 0;
}
