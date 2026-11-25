// npm run test:ps1-parts: a PlayStation game whose tasks are its parts, each made a function at a time, through the
// steps every console's test of it goes through (parts-flow.mjs), with a program of the project's own
// (ps1-parts/program.c) and its game in C on the console's kit (ps1-parts/main.c), so it needs nobody's copy of any
// game. The program is built by the console's compiler, GCC 2.7.2, and laid out here as a PS-X EXE, so each of its
// functions is what that compiler makes of its twin. The original plays in PCSX ReARMed, built with the tools' change
// to it, which says where its processor is about to run, and so which functions ran in each frame; one twin is
// proven by the same bytes, by `match`, and one by the same memory, by `twin`, against the emulator's own
// interpreter; and every frame of the game is compared with the original's, picture and sound.
//
// The program's start sets the screen and then, for ever, waits for the V-blank, moves a square with one function
// and draws it, and from frame 60 of its own count turns it with another. So the test knows what each of its two
// parts runs: the first the start, which runs once, and the move, and the second the move and the turn, of which only
// the turn is its own. The second part starts while the square still goes the first way, and the frame after the
// first part's last is one of those, so the first part has no turn.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { compileFile, stopCompiler } from '../ps1/match.mjs';
import { partsFlow } from './parts-flow.mjs';

const HERE = fileURLToPath(new URL('./ps1-parts/', import.meta.url));
const NAME = 'test-ps1-parts', VERSION = `${NAME}/c`;
const work = join(LOCAL, 'tmp', 'ps1-parts-test');
// how PlayStation games of the time were built: GCC 2.7.2 at -O2, and Sony's assembler of version 2.56
const COMPILER = { name: 'gcc', version: '2.7.2', flags: ['-O2', '-G0'], maspsx: { aspsxVersion: '2.56' } };
const LOAD = 0x80010000, STACK = 0x801FFF00;
const PROGRAM = readFileSync(join(HERE, 'program.c'), 'utf8'), GAME = readFileSync(join(HERE, 'main.c'), 'utf8');
const hex = address => address.toString(16).toUpperCase().padStart(8, '0');

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// The program as the console boots it: the file's code as the compiler made it, at LOAD, each call filled in with
// where its function is, in a PS-X EXE that starts at Start. Nothing else of the file needs a place: it has no values.
writeFileSync(join(work, 'program.c'), PROGRAM);
const built = await compileFile({ file: join(work, 'program.c'), compiler: COMPILER, work: join(work, 'built', 'program') });
stopCompiler();
if (built.error) throw new Error(`The program didn't build with GCC ${COMPILER.version}: ${built.error}`);
const code = built.made.sections.get('.text'), text = Buffer.alloc(2048);
Buffer.from(code.bytes).copy(text);
const where = Object.fromEntries(built.made.functions.map(f => [f.name, LOAD + f.at]));
// a call, or a jump to a place of the same function, as the compiler writes a loop's
for (const { at, kind, symbol, addend } of code.relocations) {
  const named = built.made.symbols.get(symbol);
  if (kind !== 'jump26' || named?.section !== '.text') throw new Error(`The program has a place to fill in the test doesn't lay out: ${kind} of ${symbol}.`);
  text.writeUInt32LE(((text.readUInt32LE(at) & 0xFC000000) | (((LOAD + named.at + addend) >>> 2) & 0x3FFFFFF)) >>> 0, at);
}
if ([...built.made.sections].some(([name, section]) => name !== '.text' && section.bytes.length)) throw new Error('The program has values of its own, which the test doesn\'t lay out.');
const header = Buffer.alloc(2048);
header.write('PS-X EXE', 0, 'latin1');
header.writeUInt32LE(where.Start, 0x10);
header.writeUInt32LE(LOAD, 0x18);
header.writeUInt32LE(text.length, 0x1C);
header.writeUInt32LE(STACK, 0x30);
header.write('A made-up program of the Dreamports tools', 0x4C, 'latin1');
const exe = Buffer.concat([header, text]), copy = join(work, 'made-up-parts.exe');
writeFileSync(copy, exe);

// the game's C at a stage, with each function's address filled in
function write(stage) {
  let program = PROGRAM.replace(/@([A-Z]+)@/g, (_, name) => `0x${hex(where[name[0] + name.slice(1).toLowerCase()])}`), game = GAME;
  const change = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`The test's C has no "${from}" for it to change.`);
    return text.replace(from, to);
  };
  // the game not calling its twins yet: the square stays where it starts
  if (stage === 'twins') game = change(change(game, '  x = Move(x);\n', ''), '(frame >= TURNS_AT ? Turn(x) : x)', 'x');
  if (stage === 'changed') program = change(program, 'return (x + 2) & 0xFF;', 'return (2 + x) & 0xFF;');
  writeFileSync(join(gameFolder(VERSION), 'src', 'program.c'), program);
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), game);
}

const key = name => hex(where[name]);
const RIGHT = 'The square going right', TURNED = 'The square turned';
const failed = await partsFlow({
  name: NAME, title: 'Test PlayStation Parts', consoleName: 'PlayStation',
  original: { console: 'ps1', name: 'Test PlayStation Parts (World)', title: NAME, code: '', sha1: createHash('sha1').update(exe).digest('hex'), compiler: COMPILER },
  copy, frames: 120,
  parts: [{ name: RIGHT, frames: [0, 49] }, { name: TURNED, frames: [50, 119] }],
  ran: { [RIGHT]: [key('Move'), key('Start')].sort(), [TURNED]: [key('Move'), key('Turn')].sort() },
  own: { [RIGHT]: ['Move', 'Start'].sort((a, b) => where[a] - where[b]).map(name => ({ key: key(name), twin: name })), [TURNED]: [{ key: key('Turn'), twin: 'Turn' }] },
  write,
  // the start never comes back, so only the same bytes prove it, and the move is proven so too; the turn by the same memory
  proves: (version, twin) => (twin === 'Turn' ? ['twin', version, twin, '--calls', '1000'] : ['match', version, twin]),
});

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log('\nA PlayStation game\'s parts are its tasks, each done when its functions are proven and its frames are the original\'s.');
