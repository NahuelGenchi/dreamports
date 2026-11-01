// The game's controls, for the settings' Controls (the kit's ui/controls-view.js): every key the game takes, and
// a controller's binding for each.

import { SETTINGS_CONTROLS } from '../../../../kit/gba/ui/controls-view.js';

// {jump}, {attack}, {pick} and {back} in a row are the keys or the buttons for those, for the input shown
export const TOKENS = {
  keys: { jump: ['Z', 'Space'], attack: ['X'], pick: ['Z'], back: ['X'] },
  pad: { jump: ['A'], attack: ['B', 'X'], pick: ['A'], back: ['B'] },
};
// Each row's keys, its controller's buttons (the same as the keys when left out, or null when a controller has it
// only in the settings) and what it does. Every key the game takes is here, and a controller's binding for each.
export const CONTROLS = [
  { name: 'Moving', rows: [
    { keys: ['←', '→'], pad: ['D-pad', 'L stick'], what: 'Run' },
    { keys: ['{jump}'], what: 'Jump · again in the air: insta-shield' },
    { keys: ['←←', '→→'], what: 'In a jump: mid-air dash' },
    { keys: ['{attack}'], what: 'Spin attack · again: kick, then {attack} slide or {jump} backflip' },
    { keys: ['↓'], what: 'Crouch · roll while moving' },
    { keys: ['↓', '+', '{jump}'], what: 'Spin dash' },
    { keys: ['↑'], what: 'Look up' },
  ] },
  { name: 'Tails and Knuckles', rows: [
    { group: 'Tails' },
    { keys: ['{jump}'], what: 'Again in a jump: fly, or swim under water, each press lifting him' },
    { keys: ['{attack}'], what: 'Tail swipe' },
    { group: 'Knuckles' },
    { keys: ['{jump}'], what: 'Hold it again in a jump: glide, or swim under water' },
    { keys: ['↑', '↓'], what: 'Into a wall: climb · {jump} leaps off' },
    { keys: ['{attack}'], what: 'Punch, three times for the uppercut' },
    { keys: ['↓'], what: 'Sink from floating on the water' },
  ] },
  { name: 'Menus and pause', rows: [
    { keys: ['Enter'], pad: ['Menu'], what: 'Start: skips the intro, opens the menu on the title screen, jumps to END in the name input, and pauses the act and the special stage, then goes on again' },
    { keys: ['{pick}', '{back}'], pad: ['A', 'B'], what: 'Skip the intro, as Start does' },
    { keys: ['Backspace'], pad: ['View'], what: 'Select' },
    { keys: ['Q', 'E'], pad: ['LB', 'RB'], what: 'L and R · in the name input, move along the name' },
    { keys: ['↑', '↓'], what: 'In the menu, choose · {pick} picks' },
    { keys: ['←', '→'], what: 'In Options, change the setting picked · {back} goes back' },
    { keys: ['↑', '↓'], what: 'On the language screen, choose · {pick} keeps the language (the first time, Start too) · {back} goes back to Options' },
    { keys: ['{pick}', '/', '{attack}'], what: 'Continue screen: continue / skip to the next number' },
  ] },
  SETTINGS_CONTROLS,
  { name: 'Extras', rows: [
    { keys: ['V'], pad: null, what: 'Widescreen: more of the game around the original screen' },
    { keys: ['R'], pad: null, what: "Rush boost: Sonic Rush's boost, on top of the original game (with your Sonic Rush ROM)" },
    { keys: ['L', 'Shift'], pad: ['X'], what: 'With the Rush boost on: boost (press on the ground, hold to keep it)' },
    { keys: ['B'], pad: null, what: "Boost Mode: Sonic Advance 2's Boost Mode and its afterimages (with your Sonic Advance 2 ROM). Keep running at top speed to enter it" },
    { keys: ['T'], pad: null, what: "SA2 tricks: Sonic Advance 2's mid-air tricks (with your Sonic Advance 2 ROM)" },
    { keys: ['E', 'I'], pad: ['RB'], what: 'With the SA2 tricks on, once in the air: trick · with ↑ Hop Jump, ↓ Bound, forward Humming Top, alone or back Back Star' },
    { keys: ['C'], pad: null, what: 'Show the collision' },
    { keys: ['M'], pad: null, what: 'Sound on or off' },
  ] },
  { name: 'Multiplayer', rows: [
    { group: 'Player 1' },
    { keys: ['W', 'A', 'S', 'D'], what: 'Move' },
    { keys: ['F'], what: 'Jump' },
    { keys: ['G'], what: 'Attack' },
    { group: 'Player 2' },
    { keys: ['←', '↑', '↓', '→'], what: 'Move' },
    { keys: ['.'], what: 'Jump' },
    { keys: ['/'], what: 'Attack' },
    { group: 'Players 3 and 4' },
    { keys: [], pad: ['D-pad', 'A', 'B', 'X'], what: 'A controller each: they go to players 3 and 4 first, then 1 and 2' },
    { keys: ['F', '.'], pad: ['A'], what: 'On the results screen, go on' },
  ] },
];
export const NOTE = 'With BUTTON CONFIG. on REVERSE in Options, jump and attack swap places in the act, the special stage and Chao Hunt.';

