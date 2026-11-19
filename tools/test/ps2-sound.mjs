// npm run test:ps2-sound: the PlayStation 2's sound in the kit in C (kit/ps2/c/spu2.c, iop.c) and `prove` comparing a
// PlayStation 2 game's sound exactly, by its sound list and its samples (lib/sound.mjs). The sound program of
// made-up-ps2-iop.mjs, whose EE loads a module of its own on the IOP through the SIF, runs on the console's real
// emulator, and its Dreamport in C (made-up-ps2-sound.c) on the kit, in a folder of its own that it removes after, so
// no game's copy is needed:
//
// - every frame's draw list carries what the SIF gave the EE, in LABEL writes: what SifGetReg says of its registers,
//   the ids SifSetDma gives and what SifDmaStat says, every word of the IOP's replies to a bind and to a call of its
//   loader, which starts the Dreamport's twin of the module, and to a bind of the module's own RPC server, and the
//   server's answer to the call the EE makes every frame, so the kit's SIF answers as the emulator's does;
// - every frame's sound list is the module's, and every sample the kit's SPU2 mixes is the emulator's: both cores, the
//   tone written through the data port and the click by DMA, the envelopes, a pitch that moves every frame, a volume
//   sweep up and one down, keys let go of and keyed on again, the reverb, core 0 mixed into core 1, and what the chip
//   says of its voices' ends and its interrupt address, read back and written where it takes no notice;
// - with a recording that holds buttons and the left stick, what the module reads of the pad through the SIO2 each
//   frame, written into the sound list the same way, is what the emulator's pad says: its mode, its buttons, its sticks
//   and the pressure on each button, and a Dreamport that doesn't read the pressure is found;
// - a Dreamport whose pitch is one step out on one frame is found on that frame, by its sound list.
//
// It isn't run on every pull request, as the emulator takes minutes to build, and on Linux and macOS alone (docs/CONSOLES.md).

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL, REPO, gameFolder, proofFolder, resultFolder } from '../lib/paths.mjs';
import { startingEntry, startingFiles } from '../lib/new-game.mjs';
import { BACKGROUND, LOAD_AT, SQUARE, SQUARE_SIZE, SQUARE_Y } from './made-up-ps2.mjs';
import * as sound from './made-up-ps2-iop.mjs';

const GAME = 'test-ps2-sound';
const WORK = join(LOCAL, 'test-ps2-sound');
const COPIES = join(LOCAL, 'copies.json');
const STATUS = join(REPO, 'docs', 'STATUS.md');
const MEDIA = join(REPO, 'public', 'media');
const FRAMES = 300;
// the frame whose pitch the broken Dreamport writes a step out
const BROKEN_AT = 150;
// what the second recording holds, from each frame on: every button and each way of the left stick, at some point
const PRESSED = [[0, []], [30, ['CROSS']], [45, ['UP', 'L1']], [60, ['STICK_LEFT']], [75, ['STICK_DOWN', 'R2', 'START']], [90, ['STICK_RIGHT', 'STICK_UP', 'TRIANGLE']],
  [105, ['CIRCLE', 'SQUARE', 'DOWN', 'LEFT']], [120, ['RIGHT', 'R1', 'L2', 'SELECT']], [135, ['L3', 'R3']], [150, ['STICK_LEFT', 'STICK_RIGHT']], [165, []], [200, ['CROSS', 'CIRCLE']], [230, []]];
const FIRST_PRESSED = PRESSED[1][0];

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? 'ok' : 'FAILED'}: ${what}`);
  if (!ok) failures.push(what);
};

const dp = (...args) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [join(REPO, 'tools', 'dp.mjs'), ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 2 ** 26 });
  return { status, out: stdout + stderr };
};
const inC = game => `${game}/c`;
const report = (recording = 'still') => {
  const file = join(resultFolder(inC(GAME), recording), 'report.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const hex = number => `0x${(number >>> 0).toString(16).toUpperCase()}`;
const pairs = list => `{ ${list.map(([register, value]) => `{ ${hex(register)}, ${hex(value)} }`).join(', ')} }`;

// the Dreamport in C: made-up-ps2-sound.c with the program's numbers filled in, or with its pitch a step out on one frame
function writeGame({ broken = false, early = false, noPressure = false } = {}) {
  const { R } = sound, { places } = sound.madeUpPs2Sound(), module = sound.moduleData();
  const numbers = {
    CORE1: hex(sound.CORE1), REVERB: pairs(sound.REVERB), VOICES: pairs(sound.VOICES),
    IRX_IN_IOP: hex(sound.IRX_IN_IOP), IRX_BODY: hex(sound.IRX_BODY), TONE_IN_MODULE: hex(module.tone), CLICK_IN_MODULE: hex(module.click), TONE_SIZE: sound.TONE.length, CLICK_SIZE: sound.CLICK.length,
    LOAD_AT: hex(LOAD_AT), REPLY: hex(places.reply), RECEIVED: hex(places.received), SIF_REND: hex(sound.SIF_REND),
    SERVER: hex(sound.SERVER), RPC_BUFFER_IN_MODULE: hex(module.rpcBuffer), SERVER_ARGUMENTS: hex(places.serverArguments), ANSWERED: hex(places.answered),
    SERVER_BIND_TRANSFERS: hex(places.serverBindTransfers), SERVER_CALL_TRANSFERS: hex(places.serverCallTransfers),
    INIT_TRANSFERS: hex(places.initTransfers), IRX_TRANSFERS: hex(places.irxTransfers), BIND_TRANSFERS: hex(places.bindTransfers), CALL_TRANSFERS: hex(places.callTransfers),
    PAD_READ: `{ ${sound.PAD_READ.map(hex).join(', ')} }`, PAD_ANSWER: sound.PAD_ANSWER, PAD_ASKED: noPressure ? 9 : sound.PAD_ANSWER,
    PAD_SET_UP: sound.PAD_SET_UP.map(([bytes, answered]) => `  { static const uint8_t command[] = { ${bytes.map(hex).join(', ')} }; sio2(command, sizeof command, ${answered}); }`).join('\n'),
    LABEL_ENUM: sound.LABEL_NAMES.map(name => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')).join(', '),
    ATTR: hex(R.ATTR), TSA_HI: hex(R.TSA_HI), TSA_LO: hex(R.TSA_LO), STD: hex(R.STD), IRQA_HI: hex(R.IRQA_HI), IRQA_LO: hex(R.IRQA_LO),
    KON_HI: hex(R.KON_HI), KOFF_HI: hex(R.KOFF_HI), MMIX: hex(R.MMIX), ENDX_HI: hex(R.ENDX_HI), IRQINFO: hex(R.IRQINFO),
    VOICE0_VOLR: hex(sound.voice(0, R.VOLR)), VOICE0_PITCH: hex(sound.voice(0, R.PITCH)), VOICE1_VOLL: hex(sound.voice(1, R.VOLL)),
    ATTR_SET_UP: hex(sound.ATTR_SET_UP), ATTR_PLAYING: hex(sound.ATTR_PLAYING), TONE_AT: hex(sound.TONE_AT), CLICK_AT: hex(sound.CLICK_AT), IRQ_AT: hex(sound.IRQ_AT),
    MVOLR: hex(R.MVOLR), MASTER_SWEEP_AT: sound.MASTER_SWEEP_AT, MASTER_BACK_AT: sound.MASTER_BACK_AT, MASTER_SWEEP: hex(sound.MASTER_SWEEP), MASTER_RIGHT: hex(sound.MASTER_RIGHT),
    SWEEP_UP: hex(sound.SWEEP_UP), SWEEP_DOWN: hex(sound.SWEEP_DOWN), SWEEP_AT: sound.SWEEP_AT,
    PITCH_START: hex(sound.PITCH_START), PITCH_STEP: hex(sound.PITCH_STEP), PITCH_END: hex(sound.PITCH_END),
    TONE_EVERY: sound.TONE_EVERY, TONE_OFF: sound.TONE_OFF, CLICK_EVERY: sound.CLICK_EVERY,
    BACKGROUND: hex(BACKGROUND), SQUARE: hex(SQUARE), SQUARE_Y, SQUARE_SIZE,
  };
  let code = readFileSync(join(REPO, 'tools', 'test', 'made-up-ps2-sound.c'), 'utf8').replace(/@([A-Z_0-9]+)@/g, (_, key) => {
    if (numbers[key] === undefined) throw new Error(`made-up-ps2-sound.c asks for ${key}, which the test doesn't fill in.`);
    return numbers[key];
  });
  // the module's frame BROKEN_AT is the Dreamport's, as both count from the thread's first frame, the Dreamport's 0
  if (broken) code = code.replace(/W\(([^,]+), (0x[0-9A-F]+ \+ \(frame \* [^;]+)\);/, `W($1, $2 + (frame == ${BROKEN_AT}));`);
  // or asking SifDmaStat of its call before it has waited for the IOP to answer it
  if (early) code = code.replace('  wait_for_reply(CALL_REPLY_0);\n  labels[CALL_STATUS] = sif_dma_stat(id);', '  labels[CALL_STATUS] = sif_dma_stat(id);\n  wait_for_reply(CALL_REPLY_0);');
  writeFileSync(join(gameFolder(inC(GAME)), 'src', 'main.c'), code);
}

function tidy() {
  const kept = readdirSync(MEDIA).filter(file => file.startsWith(GAME)).map(file => join(MEDIA, file));
  const made = [gameFolder(GAME), join(LOCAL, 'results', GAME), join(LOCAL, 'captures', GAME), join(REPO, '.github', 'readme', 'progress', `${GAME}.svg`)];
  for (const path of [...made, WORK, ...kept]) rmSync(path, { recursive: true, force: true });
}

// the program as a game of its own: its copy known to `rom`, a code map of its one function, what `new` writes, in
// JavaScript and in C, a recording that holds nothing and one that holds buttons. Its buttons are read after the
// V-blank, as every PlayStation 2 game's are in the emulator, which gives the pad a frame's buttons as the frame starts
function setUp({ elf, sha1 }) {
  const copy = join(WORK, `${GAME}.elf`);
  writeFileSync(copy, elf);
  const original = { console: 'ps2', name: `${GAME} (World)`, title: GAME, code: '', sha1, provenBy: 'draw lists', keysAfterVBlank: true };
  mkdirSync(join(proofFolder(GAME), 'recordings'), { recursive: true });
  writeFileSync(join(proofFolder(GAME), 'original.json'), `${JSON.stringify(original, null, 2)}\n`);
  let run = dp('rom', copy);
  check(run.status === 0 && run.out.includes(GAME), `rom knows the program's copy: ${run.out.trim().split('\n')[1]?.trim()}`);
  const list = join(WORK, `${GAME}.csv`);
  writeFileSync(list, `Address,Size\n${LOAD_AT.toString(16)},${elf.length - 0x80}\n`);
  run = dp('codemap', GAME, '--from', list);
  check(run.status === 0, `codemap takes its one function from a list: ${run.out.trim().split('\n').at(-1)}`);
  const files = { ...startingFiles(GAME, original), 'entry.md': startingEntry(GAME, original, { issue: 1, lead: 'nobody', added: '2026-01-01' }) };
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(gameFolder(GAME), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(GAME), file), text);
  }
  for (const [file, text] of Object.entries(startingFiles(GAME, original, { language: 'c' }))) {
    mkdirSync(join(gameFolder(inC(GAME)), file, '..'), { recursive: true });
    writeFileSync(join(gameFolder(inC(GAME)), file), text);
  }
  writeFileSync(join(proofFolder(GAME), 'recordings', 'still.json'), `${JSON.stringify({ about: 'Nothing held.', frames: FRAMES, held: [[0, []]] }, null, 2)}\n`);
  writeFileSync(join(proofFolder(GAME), 'recordings', 'pressed.json'), `${JSON.stringify({ about: 'Buttons and the left stick held, a few at a time.', frames: FRAMES, held: PRESSED }, null, 2)}\n`);
}

function main() {
  tidy();
  mkdirSync(WORK, { recursive: true });

  console.log('A program whose own IOP module plays sound on both of the SPU2\'s cores, and its Dreamport in C');
  setUp(sound.madeUpPs2Sound());
  writeGame();
  let run = dp('prove', inC(GAME), 'still');
  let found = report();
  check(run.status === 0 && found.matched === FRAMES && !found.sound?.differs?.length,
    `the EE gets from the SIF what the emulator gives it, the Dreamport gives the sound chip what the module does, and the kit mixes every sample as the emulator does, every frame: ${found.matched} of ${found.frames}, ${JSON.stringify(found.firstDifference)}, sound ${JSON.stringify(found.sound?.firstDifference ?? null)}`);
  check(found.sound?.heard === true, 'and the Dreamport is heard');
  if (run.status) console.log(run.out);

  run = dp('prove', inC(GAME), 'pressed');
  found = report('pressed');
  check(run.status === 0 && found.matched === FRAMES && !found.sound?.differs?.length,
    `with buttons and the left stick held, the module reads from the pad what the emulator's gives it, its mode, its buttons, its sticks and the pressure on each button, every frame: ${found.matched} of ${found.frames}, sound ${JSON.stringify(found.sound?.firstDifference ?? null)}`);
  if (run.status) console.log(run.out);
  writeGame({ noPressure: true });
  run = dp('prove', inC(GAME), 'pressed');
  found = report('pressed');
  check(run.status !== 0 && found.sound?.firstDifference?.frame === FIRST_PRESSED && found.sound.firstDifference.by === 'list',
    `a Dreamport that doesn't read the pressure is found on the first frame a button is held: ${JSON.stringify(found.sound?.firstDifference)}`);

  writeGame({ broken: true });
  run = dp('prove', inC(GAME), 'still');
  found = report();
  const first = found.sound?.firstDifference;
  check(run.status !== 0 && first?.frame === BROKEN_AT && first?.by === 'list', `one write a step out is found on its frame, by the sound list: ${JSON.stringify(first)}`);
  check(run.out.includes(`The first is frame ${BROKEN_AT}: what it gave the sound chip differs`), 'and prove says so');

  writeGame({ early: true });
  run = dp('prove', inC(GAME), 'still');
  found = report();
  const apart = found.drawListApart ?? {};
  check(run.status !== 0 && found.firstDifference?.frame === 0 && /^LABEL = /.test(apart.original ?? ''),
    `a Dreamport that asks SifDmaStat before the IOP has answered is found at once, by the LABEL write that carries it: ${apart.original} in the original, ${apart.dreamport} in the Dreamport`);
}

const kept = { status: readFileSync(STATUS), copies: existsSync(COPIES) ? readFileSync(COPIES) : null };
const untouched = () => execFileSync('git', ['status', '--porcelain', '--', 'docs/STATUS.md', '.github/readme/progress', 'public/media', 'games'], { cwd: REPO, encoding: 'utf8' });
const dirtyBefore = untouched();
try {
  main();
} finally {
  tidy();
  writeFileSync(STATUS, kept.status);
  if (kept.copies) writeFileSync(COPIES, kept.copies);
  else rmSync(COPIES, { force: true });
}
check(untouched() === dirtyBefore, 'nothing is left behind');

if (failures.length) {
  console.log(`\n${failures.length} failed.`);
  process.exit(1);
}
console.log('\nAll passed.');
process.exit(0);
