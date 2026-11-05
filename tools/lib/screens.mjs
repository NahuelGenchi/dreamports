// What a game on a console other than the Game Boy Advance says of its screen, as `"screen"` in its proof/original.json:
// [256, 224], or a list of sizes when it changes partway, the first being the one it starts at (docs/CONSOLES.md). With
// none, it's the console's size in kit/consoles.js.

const size = ([width, height]) => `${width} by ${height}`;
const isSize = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isInteger(n) && n > 0);

/** The sizes in an original.json's `screen`, or null when it has none. */
export function sizesIn(screen) {
  if (screen === undefined) return null;
  const list = isSize(screen) ? [screen] : screen;
  if (!Array.isArray(list) || !list.length || !list.every(isSize)) throw new Error(`"screen" in original.json is a width and a height, such as [256, 224], or a list of them, such as [[320, 224], [256, 224]]: it says ${JSON.stringify(screen)}.`);
  return list;
}

/** The console as this game has it: `screens`, the sizes it shows, and `screen`, room for any of them, where the tools keep its pictures. */
export function forGame(machine, original) {
  const said = sizesIn(original.screen);
  if (said && !machine.core) throw new Error(`A ${machine.name} game's screen is always ${size(machine.screen)}, so its original.json has no "screen".`);
  const screens = said ?? [machine.screen];
  return { ...machine, screens, said: !!said, screen: [Math.max(...screens.map(s => s[0])), Math.max(...screens.map(s => s[1]))] };
}

/** The size at `frame` in a list of changes, [frame, width, height] each, as the tools note them, or null before the first. */
export function sizeAt(changes, frame) {
  const change = changes.findLast(([from]) => from <= frame);
  return change ? change.slice(1) : null;
}

/** Stops when the original shows a size the game doesn't say it has at any of `frames`, from the list of changes `outside.sizes` holds, and says what to write. */
export function checkSizes(changes, machine, frames, frameName = frame => frame) {
  if (!changes) return;   // mGBA's screen never changes, and it doesn't say
  const seen = new Map();
  frames.forEach((frame, i) => {
    const shown = sizeAt(changes, frame);
    if (shown && !seen.has(`${shown}`)) seen.set(`${shown}`, { shown, at: frameName(frame, i) });
  });
  const unsaid = [...seen.values()].filter(({ shown }) => !machine.screens.some(s => `${s}` === `${shown}`));
  if (!unsaid.length) return;
  const whatItSays = machine.said ? `its original.json says ${machine.screens.map(size).join(', ')}` : `kit/consoles.js says ${size(machine.screen)} for the ${machine.name}`;
  const shows = [...seen.values()].map(({ shown }) => shown);
  throw new Error(`The original's picture is ${size(unsaid[0].shown)} at frame ${unsaid[0].at}, and ${whatItSays}. A game that chooses its own size lists what it shows in proof/original.json, the size it starts at first, and the Dreamport draws at those sizes (docs/CONSOLES.md). What was played here shows "screen": ${JSON.stringify(shows.length === 1 ? shows[0] : shows)}. If the game doesn't choose it, its emulator's settings in tools/consoles.mjs may be cropping it.`);
}

/** The first of `frames` frames where the two lists of changes give different sizes, as { frame, original, dreamport }, or null. `originalOf` is which of the original's frames each is. */
export function firstOtherSize(theirs, ours, frames, originalOf) {
  for (let frame = 0; frame < frames; frame++) {
    const original = sizeAt(theirs, originalOf(frame)), dreamport = sizeAt(ours, frame);
    if (original && dreamport && `${original}` !== `${dreamport}`) return { frame, original, dreamport };
  }
  return null;
}
