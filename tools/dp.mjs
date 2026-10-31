// The proof tools, started with `npm run dp -- <tool>`. tools/README.md says what each does.

const TOOLS = {
  setup: 'Builds the reference emulator the original runs in, on this computer',
  rom: 'Checks a copy of a game, says which game and version it is, and remembers where it is',
  play: 'Opens a game in a browser with your copy, and with --record keeps what you play as a recording',
  prove: 'Plays each recording in the original and in the Dreamport, compares every frame, and updates the numbers',
  codemap: 'Makes the code map: every function in the original, with its address and size',
  portmap: 'Makes the port map: each function of the original the Dreamport\'s code names, and where',
  share: 'Publishes a preview on GitHub Pages from your fork, and with --post posts in the game\'s progress thread',
  readme: 'Writes the README\'s table of Dreamports, with each one\'s numbers and lead, from their entries',
};

const [tool, ...args] = process.argv.slice(2);
if (!TOOLS[tool]) {
  console.log('Usage: npm run dp -- <tool> [arguments]\n');
  for (const [name, what] of Object.entries(TOOLS)) console.log(`  ${name.padEnd(8)} ${what}`);
  console.log('\ntools/README.md explains each one.');
  process.exit(tool && tool !== 'help' ? 1 : 0);
}
try {
  const { run } = await import(`./${tool}.mjs`);
  process.exitCode = (await run(args)) ?? 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
