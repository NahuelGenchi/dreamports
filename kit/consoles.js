// The consoles Dreamports knows, as the kits' games and the proof tools both read them (docs/CONSOLES.md). Each has its
// name, the screen a game shows (`screen`, width and height), how long a frame lasts (`frame`, that many ticks of a
// clock of that many a second), how many sound samples it mixes a second (`sound`, as the tools' reference for it does),
// the files a copy of one of its games comes in (`files`), how large one can be in bytes (`largest`), and its buttons.

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
  ps1: { name: 'PlayStation', screen: [320, 240], frame: [1, 60], sound: 44100, files: ['.cue', '.bin', '.iso', '.chd', '.pbp', '.exe'], largest: 800 * MB, buttons: ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'SELECT', 'START', ...PAD, ...STICK] },
  ps2: { name: 'PlayStation 2', screen: [640, 448], frame: [1001, 59940], sound: 48000, files: ['.iso', '.chd', '.cso', '.bin', '.cue'], largest: 9000 * MB, buttons: ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'SELECT', 'START', ...PAD, ...STICK] },
  psp: { name: 'PlayStation Portable', screen: [480, 272], frame: [1001, 59940], sound: 44100, files: ['.iso', '.cso', '.chd', '.pbp', '.elf'], largest: 1800 * MB, buttons: ['CROSS', 'CIRCLE', 'SQUARE', 'TRIANGLE', 'L', 'R', 'SELECT', 'START', ...PAD, ...STICK] },
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
