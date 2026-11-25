// The consoles Dreamports knows, as the kits' games and the proof tools both read them (docs/CONSOLES.md). Each has its
// name, the screen a game shows unless its original.json says another (`screen`, width and height), how long a frame lasts (`frame`, that many ticks of a
// clock of that many a second), how many sound samples it mixes a second (`sound`, as the tools' reference for it does),
// the files a copy of one of its games comes in (`files`), how large one can be in bytes (`largest`), and its buttons.
// `disc` says its games come on discs, which the page reads a few sectors at a time (kit/copy/) and gives a game in C
// through kit/c/disc.h. `provenBy` is how its games are proven when their original.json doesn't say: by their draw lists, on a console whose
// games are mostly in three dimensions (docs/STANDARD.md), and by their pictures everywhere else.
// A console with more screens than one, as the Nintendo DS has two, lists them in `screens`, each as where it is in the
// picture and its size (left, top, width, height), and `screen` is the whole picture, one screen above the other with
// nothing between them, as its frames are compared. `touch` is which of them is touched, counted from 0. A recording
// keeps a touch beside the buttons, as "TOUCH@x,y", the pixel of that screen. The Nintendo DS's microphone and its lid
// aren't here yet: a game hears nothing and its lid stays open. Its `sound` isn't a whole number, as its mixer makes a
// pair of samples every 1,024 ticks of its clock.

const MB = 1024 * 1024;
const PAD = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const STICK = ['STICK_LEFT', 'STICK_RIGHT', 'STICK_UP', 'STICK_DOWN'];

export const CONSOLES = {
  gba: { name: 'Game Boy Advance', screen: [240, 160], frame: [280896, 16777216], sound: 65536, files: ['.gba', '.agb', '.bin'], largest: 32 * MB, buttons: ['A', 'B', 'L', 'R', 'SELECT', 'START', ...PAD] },
  nes: { name: 'NES', screen: [256, 240], frame: [89342, 5369318], sound: 48000, files: ['.nes'], largest: 8 * MB, buttons: ['A', 'B', 'SELECT', 'START', ...PAD] },
  snes: { name: 'Super Nintendo', screen: [256, 224], frame: [357366, 21477272], sound: 32040, files: ['.sfc', '.smc'], largest: 12 * MB, buttons: ['A', 'B', 'X', 'Y', 'L', 'R', 'SELECT', 'START', ...PAD] },
  gb: { name: 'Game Boy', screen: [160, 144], frame: [70224, 4194304], sound: 32768, files: ['.gb'], largest: 8 * MB, buttons: ['A', 'B', 'SELECT', 'START', ...PAD] },
  gbc: { name: 'Game Boy Color', screen: [160, 144], frame: [70224, 4194304], sound: 32768, files: ['.gbc'], largest: 8 * MB, buttons: ['A', 'B', 'SELECT', 'START', ...PAD] },
  md: { name: 'Mega Drive', screen: [320, 224], frame: [128006, 7670454], sound: 44100, files: ['.md', '.gen', '.smd', '.bin'], largest: 8 * MB, buttons: ['A', 'B', 'C', 'X', 'Y', 'Z', 'MODE', 'START', ...PAD] },
  n64: { name: 'Nintendo 64', screen: [640, 240], frame: [811125, 48681812], sound: 44100, files: ['.z64', '.n64', '.v64'], largest: 64 * MB, buttons: ['A', 'B', 'Z', 'L', 'R', 'START', 'C_UP', 'C_DOWN', 'C_LEFT', 'C_RIGHT', ...PAD, ...STICK] },
  ps1: { name: 'PlayStation', screen: [320, 240], frame: [263 * 3413, 53693175], sound: 44100, disc: true, files: ['.cue', '.bin', '.iso', '.chd', '.pbp', '.exe'], largest: 800 * MB, buttons: ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'SELECT', 'START', ...PAD, ...STICK] },
  ps2: { name: 'PlayStation 2', screen: [640, 448], frame: [1, 60], sound: 48000, provenBy: 'draw lists', soundBy: 'sound lists', disc: true, files: ['.iso', '.chd', '.cso', '.zso', '.bin', '.cue', '.elf'], largest: 9000 * MB, buttons: ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'SELECT', 'START', ...PAD, ...STICK] },
  // the console shows a field at a time, 240 of a picture's 480 lines, as the Nintendo 64 does; its two triggers are each a button with a way to press it partway: L and R are a trigger pressed all the way, to its click, and L_ANALOG and R_ANALOG one pressed short of it
  gamecube: { name: 'Nintendo GameCube', screen: [640, 240], frame: [1001, 60000], sound: 48000, disc: true, files: ['.iso', '.gcm', '.dol', '.elf'], largest: 1400 * MB, buttons: ['A', 'B', 'X', 'Y', 'Z', 'L', 'R', 'L_ANALOG', 'R_ANALOG', 'START', ...PAD, ...STICK, 'C_UP', 'C_DOWN', 'C_LEFT', 'C_RIGHT'] },
  nds: { name: 'Nintendo DS', screen: [256, 384], screens: [[0, 0, 256, 192], [0, 192, 256, 192]], touch: 1, frame: [560190, 33513982], sound: 33513982 / 1024, files: ['.nds', '.srl'], largest: 512 * MB, buttons: ['A', 'B', 'X', 'Y', 'L', 'R', 'SELECT', 'START', ...PAD] },
  psp: { name: 'PlayStation Portable', screen: [480, 272], frame: [1001, 59940], sound: 44100, soundBy: 'sound lists', disc: true, files: ['.iso', '.cso', '.zso', '.chd', '.pbp', '.elf'], largest: 1800 * MB, buttons: ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L', 'R', 'SELECT', 'START', ...PAD, ...STICK] },
  // a console that was never made, whose emulator is tools/test/made-up-core.c: the tools' own test of everything here, on any computer
  'made-up': { name: 'Made-up console', screen: [64, 48], frame: [1, 50], sound: 44100, files: ['.mu'], largest: MB, buttons: ['A', 'B', 'START', ...PAD] },
};

// the keys and a controller's buttons a console's buttons have, in the standard layout's numbers, for input.js
const FACE = ['KeyZ', 'KeyX', 'KeyA', 'KeyS', 'KeyC', 'KeyD', 'KeyQ', 'KeyW', 'KeyE', 'KeyR'];
const OWN = { UP: ['ArrowUp', [12]], DOWN: ['ArrowDown', [13]], LEFT: ['ArrowLeft', [14]], RIGHT: ['ArrowRight', [15]], START: ['Enter', [9]], SELECT: ['Backspace', [8]], MODE: ['Backspace', [8]], L: [null, [4]], R: [null, [5]], L1: [null, [4]], R1: [null, [5]], L2: [null, [6]], R2: [null, [7]], L3: [null, [10]], R3: [null, [11]] };

/** The buttons of a console for createInput (input.js): every button, the console's name for each, its keys and its controller's. */
export function layoutOf(id) {
  const buttons = CONSOLES[id].buttons.map(name => name.toLowerCase());
  const layout = { buttons, console: {}, keys: {}, pad: {} };
  let face = 0, padFace = 0;
  for (const name of CONSOLES[id].buttons) {
    const button = name.toLowerCase(), [key, pad] = OWN[name] ?? [null, null];
    layout.console[button] = name;
    if (name.startsWith('STICK') || name.startsWith('C_')) continue;
    layout.keys[key ?? FACE[face++]] = button;
    layout.pad[button] = pad ?? [padFace++];
  }
  return layout;
}
