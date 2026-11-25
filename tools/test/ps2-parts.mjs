// npm run test:ps2-parts: a PlayStation 2 game whose tasks are its parts, each made a function at a time, through the
// steps every console's test of it goes through (parts-flow.mjs), with a program of the project's own
// (ps2-parts/program.c) and its game in C on the console's kit (ps2-parts/main.c), so it needs nobody's copy of any
// game. The program is built by SN Systems' build of GCC 2.95.2, which runs on Linux, a Mac and Windows alike, and
// laid out here as an ELF, so each of its functions is what that compiler makes of its twin. The original plays in
// Play!, built with the tools' change to it, which says which functions ran in each frame; three twins are proven by
// the same bytes, by `match`, and one by the same memory, by `twin`, against Play!'s own processors; and every frame
// of the game is compared with the original's, by what each gives the GS, and its sound.
//
// The program's boot sets a stack and calls its start, which sets the screen and then, for ever, waits for the
// V-blank, moves a square with one function and sends the GS a packet with it, and from frame 60 of its own count
// turns it with another. So the test knows what each of its two parts runs: the first the boot, the start, which run
// once, and the move, and the second the move and the turn, of which only the turn is its own. The second part starts
// while the square still goes the first way, and the frame after the first part's last is one of those, so the first
// part has no turn.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL, gameFolder } from '../lib/paths.mjs';
import { compileFile, objectOf } from '../ps2/match.mjs';
import { elfWith } from './made-up-ps2-disc.mjs';
import { partsFlow } from './parts-flow.mjs';

const HERE = fileURLToPath(new URL('./ps2-parts/', import.meta.url));
const NAME = 'test-ps2-parts', VERSION = `${NAME}/c`;
const work = join(LOCAL, 'tmp', 'ps2-parts-test');
// SN Systems' GCC, as many studios built their games with ProDG, and the one of the tools' that runs everywhere
const COMPILER = { name: 'sn-gcc', version: '2.95.2-273a', flags: ['-O2', '-G0'] };
const LOAD = 0x00100000;
const FILES = ['program.c', 'program.h', 'main.c'], TEXT = Object.fromEntries(FILES.map(file => [file, readFileSync(join(HERE, file), 'utf8')]));
const hex = address => address.toString(16).toUpperCase().padStart(8, '0');

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// The program as the console boots it: the file's code as the compiler made it, at LOAD, and its values after it,
// each place the compiler left filled in with where it points, in an ELF that starts at Boot.
for (const file of ['program.c', 'program.h']) writeFileSync(join(work, file), TEXT[file]);
const built = await compileFile({ file: join(work, 'program.c'), compiler: COMPILER, work: join(work, 'built', 'program'), log: console.log });
if (built.error) throw new Error(`The program didn't build with SN Systems' GCC ${COMPILER.version}: ${built.error}`);
const made = objectOf(built.object);
const round = n => (n + 15) & ~15;
const text = Buffer.from(made.sections.get('.text').bytes), base = new Map([['.text', LOAD]]);
const data = [];
let next = LOAD + round(text.length);
for (const [name, section] of made.sections) {
  if (name === '.text') continue;
  base.set(name, next);
  data.push({ name, bytes: Buffer.from(section.bytes) });
  next += round(section.bytes.length);
}
const placed = new Map([['.text', text], ...data.map(({ name, bytes }) => [name, bytes])]);
for (const [name, section] of made.sections) {
  const bytes = placed.get(name);
  for (const { at, kind, section: into, symbol, addend } of section.relocations) {
    if (!into) throw new Error(`The program names ${symbol}, which it doesn't define, and the test lays out nothing else.`);
    const target = base.get(into) + addend, word = bytes.readUInt32LE(at);
    const filled = { hi16: (word & 0xFFFF0000) | (((target + 0x8000) >>> 16) & 0xFFFF), lo16: (word & 0xFFFF0000) | (target & 0xFFFF), jump26: (word & 0xFC000000) | ((target >>> 2) & 0x3FFFFFF), word32: target }[kind];
    if (filled === undefined) throw new Error(`The program has a place to fill in the test doesn't lay out: ${kind} in ${name}.`);
    bytes.writeUInt32LE(filled >>> 0, at);
  }
}
const where = Object.fromEntries(made.functions.map(f => [f.name, LOAD + f.at]));
// the values in one stretch after the code, as the ELF's one segment holds them
const values = Buffer.alloc(next - LOAD - round(text.length));
for (const { name, bytes } of data) bytes.copy(values, base.get(name) - LOAD - round(text.length));
const elf = elfWith({ entry: where.Boot, sections: [{ name: '.text', type: 1, flags: 6, address: LOAD, bytes: Buffer.concat([text, Buffer.alloc(round(text.length) - text.length)]) }, ...(values.length ? [{ name: '.data', type: 1, flags: 3, address: LOAD + round(text.length), bytes: values }] : [])] });
const copy = join(work, 'made-up-parts.elf');
writeFileSync(copy, elf);

// the game's C at a stage, with each function's address filled in
function write(stage) {
  let program = TEXT['program.c'].replace(/@([A-Z]+)@/g, (_, name) => `0x${hex(where[name[0] + name.slice(1).toLowerCase()])}`), game = TEXT['main.c'];
  const change = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`The test's C has no "${from}" for it to change.`);
    return text.replace(from, to);
  };
  // the game not calling its twins yet: the square stays where it starts
  if (stage === 'twins') game = change(change(game, '  x = Move(x);\n', ''), 'frame >= TURNS_AT ? Turn(x) : x', 'x');
  if (stage === 'changed') program = change(program, 'return (x + 2) & 0xFF;', 'return (2 + x) & 0xFF;');
  writeFileSync(join(gameFolder(VERSION), 'src', 'program.c'), program);
  writeFileSync(join(gameFolder(VERSION), 'src', 'program.h'), TEXT['program.h']);
  writeFileSync(join(gameFolder(VERSION), 'src', 'main.c'), game);
}

const key = name => hex(where[name]);
const byAddress = names => names.sort((a, b) => where[a] - where[b]);
const RIGHT = 'The square going right', TURNED = 'The square turned';
const failed = await partsFlow({
  name: NAME, title: 'Test PlayStation 2 Parts', consoleName: 'PlayStation 2',
  original: { console: 'ps2', name: 'Test PlayStation 2 Parts (World)', title: NAME, code: '', sha1: createHash('sha1').update(elf).digest('hex'), provenBy: 'draw lists', compiler: COMPILER },
  copy, frames: 120,
  parts: [{ name: RIGHT, frames: [0, 49] }, { name: TURNED, frames: [50, 119] }],
  ran: { [RIGHT]: ['Boot', 'Move', 'Start'].map(key).sort(), [TURNED]: ['Move', 'Turn'].map(key).sort() },
  own: { [RIGHT]: byAddress(['Boot', 'Move', 'Start']).map(name => ({ key: key(name), twin: name })), [TURNED]: [{ key: key('Turn'), twin: 'Turn' }] },
  write,
  // the boot and the start never come back, so only the same bytes prove them, and the move is proven so too; the
  // turn by the same memory
  proves: (version, twin) => (twin === 'Turn' ? ['twin', version, twin, '--calls', '1000'] : ['match', version, twin]),
});

rmSync(work, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed.`);
  process.exit(1);
}
console.log('\nA PlayStation 2 game\'s parts are its tasks, each done when its functions are proven and its frames are the original\'s.');
