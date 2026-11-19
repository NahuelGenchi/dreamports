// The proof tools, started with `npm run dp -- <tool>`. tools/README.md says what each does.

const TOOLS = {
  setup: 'Builds the reference emulator the original runs in, and the Game Boy Advance\'s compiler, on this computer',
  rom: 'Checks a copy of a game, says which game and version it is, and remembers where it is',
  play: 'Opens a game in a browser with your copy, and with --record keeps what you play as a recording (--from: after another\'s presses; --start: at a start point)',
  route: 'Finds the presses that take the original from where a recording leaves it to a goal, such as an act\'s end, and writes them as a recording (--from: after another\'s presses; --minutes: how long it may search)',
  prove: 'Plays each recording in the original and in the Dreamport, compares every frame, and updates the numbers (--stills: pictures of frames; --state: what the console holds at them)',
  capture: 'Lets you play the original in a window and keep a real moment of it for the game\'s card (--open: in the background; --pick: takes the best of what was played; --from: of a list of presses)',
  draws: 'Counts what a PlayStation 2 game gives its graphics chip, from your copy: its shapes, textures and the rest, which is what its kit has to draw (--frames, --from: a list of presses, --between: only these frames)',
  untouched: 'Lists what gameplay proven leaves untouched in a version: functions never played, branches gone one way only, and data never used',
  reports: 'Fetches the reports players sent from a Dreamport\'s settings, with the owner\'s key, and plays each next to the original to say where they part ways',
  codemap: 'Makes the code map: every function in the original, with its address and size',
  new: 'Writes a claimed game\'s first files: its page, its code on the kit with everything wired in, its license and its entry',
  portmap: 'Makes the port map: each function of the original the Dreamport\'s code names, and where',
  read: 'Prints one of the original\'s functions, its ARM or Thumb instructions, from your copy, for code its decompilation lacks',
  match: 'Builds a Game Boy Advance game\'s C with the compiler the original was built with, and says which functions come out as the original\'s bytes',
  twin: 'Calls a function of the original and its twin from the same memory, thousands of times, and says whether both leave the same memory',
  proofs: 'Lists where each function of a version stands: its twin, and its proof, by the same bytes or the same memory (--start: makes the version one made a function at a time; --check: every proof kept still holds)',
  libraries: 'Says how much of each console\'s shared code, the libraries its games share, is proven, and with a version where each function it takes from them stands (--check: every library and every version that takes one keeps their rules)',
  share: 'Publishes a preview on GitHub Pages from your fork, with the clips of what the step changed for its pull request',
  find: 'Shows where a game stands: its lead, its numbers, its team build, who has claimed what, its free tasks and what the others wait on',
  tasks: 'Opens a Task issue for each of a game\'s foundations and parts that has none yet, foundations first, or for each group of functions in a version made a function at a time',
  notes: 'Shows what people found while making a game or its console\'s kit, so nobody has to find it again',
  team: 'The team build, the lead\'s branch with the team\'s finished pieces: start, join, send and add a piece',
  readme: 'Writes the table of Dreamports in docs/STATUS.md, with each one\'s numbers and lead, from their entries',
  commands: 'Writes the /dreamport command, from tools/commands/, in the form each coding agent reads',
  ready: 'Everything a step has to pass before it goes out, in one go, printing only what\'s wrong',
  update: 'Brings a branch up to date with main: merges it, settles conflicts in files the tools write, runs ready and commits',
  help: 'Prints one section of the long documents, the ones whose headings have these words, or lists them',
};

const [tool, ...args] = process.argv.slice(2);
if (!TOOLS[tool]) {
  console.log('Usage: npm run dp -- <tool> [arguments]\n');
  for (const [name, what] of Object.entries(TOOLS)) console.log(`  ${name.padEnd(8)} ${what}`);
  console.log('\nnpm run dp -- help <words> prints what tools/README.md says about them.');
  process.exit(tool ? 1 : 0);
}
try {
  const { run } = await import(`./${tool}.mjs`);
  process.exitCode = (await run(args)) ?? 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
// done, once what it printed has gone: a connection fetch keeps open for a while would otherwise hold it here for seconds
await Promise.all([process.stdout, process.stderr].map(stream => new Promise(resolve => stream.write('', resolve))));
process.exit();
