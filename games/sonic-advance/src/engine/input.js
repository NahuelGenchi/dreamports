// The player's buttons as the game names them, on the kit's input (kit/gba/input.js): the d-pad, A to jump and B
// to attack, plus the optional Sonic Rush boost and the optional Sonic Advance 2 tricks (R), extras whose buttons do
// nothing while they are off. Start, Select, L and R are for the screens before the act, and Start also pauses it
// (pause.js).

import { createInput as createGbaInput } from '../../../../kit/gba/input.js';

export { connectedPads, holdsSettingsCombo, xboxConnected, playerPads } from '../../../../kit/gba/input.js';

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down', Space: 'jump', KeyZ: 'jump', KeyJ: 'jump', KeyX: 'attack', KeyK: 'attack',
  KeyL: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost',   // only with the Rush boost on
  KeyE: ['trick', 'r'], KeyI: 'trick',                       // the trick only with the SA2 tricks on
  KeyQ: 'l', Enter: 'start', Backspace: 'select',
};

// the standard gamepad layout (an Xbox controller's): A jumps, B or X attacks, the d-pad or the left stick
// moves, Menu is Start, View is Select, and LB and RB are L and R. With the Rush boost on, X boosts instead, as in
// Sonic Rush; with the SA2 tricks on, RB is the trick too.
const LAYOUT = {
  buttons: ['left', 'right', 'up', 'down', 'jump', 'attack', 'boost', 'trick', 'start', 'select', 'l', 'r'],
  gba: { left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', jump: 'A', attack: 'B', start: 'START', select: 'SELECT', l: 'L', r: 'R' },
  keys: KEYS,
  pad: { jump: [0], attack: [1, 2], up: [12], down: [13], left: [14], right: [15], boost: [], trick: [], start: [9], select: [8], l: [4], r: [5] },
  edges: ['jump', 'attack', 'boost', 'trick'],
  extras: {
    rush: { buttons: ['boost'], pad: { attack: [1], boost: [2] } },
    tricks: { buttons: ['trick'], pad: { trick: [5] } },
  },
};

// the multiplayer modes' two players on one keyboard: the first on WASD with F to jump and G to attack, the
// second on the arrows with . to jump and / to attack; the players after them play with controllers
export const PLAYER_KEYS = [
  { KeyA: 'left', KeyD: 'right', KeyW: 'up', KeyS: 'down', KeyF: 'jump', KeyG: 'attack' },
  { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Period: 'jump', Slash: 'attack' },
  {}, {},
];

const SWAPPED = { jump: 'attack', attack: 'jump', jumpPressed: 'attackPressed', attackPressed: 'jumpPressed' };

/**
 * SetPlayerControls: the jump and attack buttons as the game reads them, from `input` (A jumps and B attacks), or
 * with A and B swapped when the save's button setting is REVERSE (btnConfig 1). The swapped buttons are a view of
 * `input`: what is pressed or cleared on one is on the other.
 */
export function playerControls(input, btnConfig) {
  if (btnConfig !== 1) return input;
  return new Proxy(input, {
    get: (target, key) => target[SWAPPED[key] ?? key],
    set: (target, key, value) => { target[SWAPPED[key] ?? key] = value; return true; },
  });
}

/**
 * The buttons one player holds: from `keys` (the single-player keys by default) and the controllers `pads()`
 * gives (all of them by default).
 */
export function createInput(options) {
  const input = createGbaInput(LAYOUT, options);
  /** Turns the Rush boost's buttons on or off; turned off, a held boost button lets go. */
  input.setRush = on => input.setExtra('rush', on);
  /** Turns the SA2 tricks' buttons on or off; turned off, a held trick button lets go. */
  input.setTricks = on => input.setExtra('tricks', on);
  return input;
}
