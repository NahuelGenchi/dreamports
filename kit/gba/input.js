// Keyboard, touch and controllers folded into one set of held buttons, the game's own, plus the press edges of
// those the game also reads as just pressed. A button is held while any of them holds it, so letting go on one
// doesn't drop it on another. The game names its buttons and says which keys and which of a controller's buttons
// press each (its layout); an extra the player turns on can bring buttons of its own, which do nothing while it is
// off. While a proof tool runs the game (proof.js), the tool's frames hold the buttons instead.

import { proof } from './proof.js';

const DPAD = { up: 12, down: 13, left: 14, right: 15 };
const DEAD_ZONE = 0.5;
const XBOX = /xbox|xinput|045e|microsoft/i;   // the names browsers give Microsoft's controllers
const SETTINGS_COMBO = [8, 9];                 // View + Menu (Select + Start) together open the settings, not the game's
const COMBO_WAIT = 4;                          // steps a controller's Start or Select waits for the other to join it

/** The Game Boy Advance's buttons, as its KEYINPUT register has them, a bit each. */
export const KEY = { A: 0x1, B: 0x2, SELECT: 0x4, START: 0x8, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80, R: 0x100, L: 0x200 };

/** The connected controllers in the browser's order. */
export const connectedPads = () => [...(navigator.getGamepads?.() ?? [])].filter(p => p?.connected);

/** Whether `pad` holds View and Menu together, which open or close the settings; the game sees neither then. */
export const holdsSettingsCombo = pad => SETTINGS_COMBO.every(i => pad.buttons[i]?.pressed);

/** Whether an Xbox controller is connected. */
export const xboxConnected = () => connectedPads().some(p => XBOX.test(p.id));

/**
 * The controllers player `player` of `count` plays with: they go to the players without keys first, the
 * third and the fourth, then to the first and the second.
 */
export function playerPads(player, count) {
  const order = [...Array.from({ length: Math.max(0, count - 2) }, (_, i) => i + 2), 0, 1];
  return () => connectedPads().filter((_, k) => order[k] === player);
}

/**
 * The buttons one player holds, as the game's `layout` names them:
 * - `buttons`: every button's name, such as 'left' or 'jump'
 * - `gba`: for those that are one of the console's own buttons, which (a name in KEY)
 * - `keys`: the keys that press them, by KeyboardEvent.code, each pressing one button or a list of them
 * - `pad`: for each button, the controller buttons that press it, by their numbers in the standard layout (0 A,
 *   1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu, 12 to 15 the d-pad's up, down, left and right); the
 *   left stick, and the d-pad of a controller the browser doesn't map to that layout, press left, right, up and down
 * - `edges`: the buttons the game also reads as just pressed, as `<button>Pressed`, which it clears once it has
 * - `extras`: by an extra's name, the buttons it brings, `buttons`, which do nothing while it is off, and `pad`,
 *   the controller buttons that press something else while it is on
 * The keys can be another set (`keys`, such as a second player's) and the controllers some of them (`pads()`,
 * all of them by default).
 */
export function createInput(layout, { keys = layout.keys, pads = connectedPads } = {}) {
  const { buttons, edges = [], extras = {} } = layout;
  const input = { enabled: false, layout };
  for (const b of buttons) input[b] = false;
  for (const b of edges) input[`${b}Pressed`] = false;
  const on = {};                        // the extras turned on
  const extraOf = {};                   // the extra each of their buttons belongs to
  for (const [name, extra] of Object.entries(extras)) for (const b of extra.buttons ?? []) extraOf[b] = name;
  // the buttons of an extra that is off do nothing
  const off = button => button in extraOf && !on[extraOf[button]];
  // the controller's buttons for each of the game's, with those of the extras turned on
  let padMap = null;
  const padButtons = () => (padMap ??= Object.assign({}, layout.pad, ...Object.keys(on).filter(n => on[n]).map(n => extras[n].pad ?? {})));
  // a controller's Start and Select: its View and Menu, which open the settings when held together
  const comboButtons = buttons.filter(b => (layout.pad[b] ?? []).some(i => SETTINGS_COMBO.includes(i)));
  const held = { keys: {}, pad: {}, touch: {} };   // what each source holds; the pad's is read once a step by poll()
  const touched = new Set();            // the on-screen controller's buttons a finger is on, by their standard numbers
  let padFresh = true;                  // after a release, what the pad still holds comes back without a press
  const spent = new Set();              // Start and Select held for the settings: the game doesn't see them until let go
  const waiting = {};                   // Start or Select just pressed alone: the steps left before the game sees it
  // a proof tool runs the game on this player's buttons (proof.js): in play mode its frames hold them, and in record
  // mode what the game read at each frame is kept, after any frames it gave to replay first, which hold them too
  const proofs = () => proof?.input === input;
  const played = () => proofs() && (proof.mode === 'play' || !!proof.frame);
  let replayed = false;                 // a proof tool's frame held the buttons at the last step

  function set(button, quiet) {
    const down = !!(held.keys[button] || held.pad[button] || held.touch[button]);
    if (!quiet && down && !input[button] && edges.includes(button)) input[`${button}Pressed`] = true;
    input[button] = down;
  }

  input.press = (button, down) => {
    if (off(button)) return;
    held.keys[button] = down; set(button);
  };
  input.release = () => {
    held.keys = {}; held.pad = {}; held.touch = {}; touched.clear(); padFresh = true;
    for (const b of buttons) input[b] = false;
    for (const b of edges) input[`${b}Pressed`] = false;
  };

  /** Turns the extra `name`'s buttons on or off; turned off, a held one lets go. */
  input.setExtra = (name, turnOn) => {
    on[name] = turnOn;
    padMap = null;
    if (turnOn) return;
    for (const b of extras[name].buttons ?? []) {
      held.keys[b] = held.pad[b] = held.touch[b] = false;
      set(b, true);
      if (edges.includes(b)) input[`${b}Pressed`] = false;
    }
  };

  /** The console's buttons held, a bit each as KEY has them, for those the layout says are one: set while held,
   *  as the game's own code reads them once it has flipped the hardware's KEYINPUT, which clears them. */
  input.gbaKeys = () => {
    let bits = 0;
    for (const b of buttons) if (input[b] && layout.gba?.[b]) bits |= KEY[layout.gba[b]];
    return bits;
  };

  // the game's buttons a controller holds, `on(i)` telling whether its button i (standard layout) is down
  function padHolds(isDown, now = {}) {
    const map = padButtons();
    for (const b of buttons) if (map[b]?.some(isDown)) now[b] = true;
    return now;
  }
  // what the game reads at this frame, as a proof tool's frame: the buttons held and those just pressed
  const seen = () => ({ held: buttons.filter(b => input[b]), pressed: edges.filter(b => input[`${b}Pressed`]) });
  // a proof tool's frame: its buttons held, and those just pressed as it says, or else those held now and not before
  function play({ held: holding = [], pressed } = {}) {
    const now = new Set(holding.filter(b => !off(b)));
    for (const b of buttons) {
      const down = now.has(b);
      if (edges.includes(b)) input[`${b}Pressed`] = pressed ? pressed.includes(b) : input[`${b}Pressed`] || (down && !input[b]);
      input[b] = down;
    }
  }
  // the on-screen controller, read like a real one; again each step, for an extra turned on or off under a finger
  function touchSync() {
    if (played()) return;
    const now = padHolds(i => touched.has(i));
    for (const b of buttons) {
      if (!!held.touch[b] === !!now[b]) continue;
      held.touch[b] = !!now[b];
      set(b);
    }
  }

  /** Reads the connected gamepads; the game calls it at the start of each step, as the original reads its keys.
   *  A controller plugged in mid-game is read from then on; one unplugged lets go of its buttons. */
  input.poll = () => {
    if (played()) {
      play(proof.frame ?? undefined);
      replayed = true;
    } else {
      // the tool's frames are over and the player takes over, with the buttons they hold now
      if (replayed) for (const b of buttons) set(b);
      replayed = false;
      read();
    }
    if (proofs()) proof.record(seen());
  };
  function read() {
    if (!input.enabled) return;
    touchSync();
    const now = {};
    let combo = false;
    for (const pad of pads()) {
      combo ||= holdsSettingsCombo(pad);
      padHolds(i => pad.buttons[i]?.pressed, now);
      // the left stick, and the d-pad of a pad the browser doesn't map to the standard layout (axes 6 and 7)
      for (const [x, y] of pad.mapping === 'standard' ? [[0, 1]] : [[0, 1], [6, 7]]) {
        const ax = pad.axes[x] ?? 0, ay = pad.axes[y] ?? 0;
        if (ax < -DEAD_ZONE) now.left = true;
        if (ax > DEAD_ZONE) now.right = true;
        if (ay < -DEAD_ZONE) now.up = true;
        if (ay > DEAD_ZONE) now.down = true;
      }
    }
    const quiet = padFresh;
    padFresh = false;
    // View + Menu are the settings' (sheet.js), so a pad's Start or Select reaches the game a few steps late,
    // in case the other is on its way; held together, neither reaches it until let go
    for (const b of comboButtons) {
      if (combo) { spent.add(b); delete waiting[b]; }
      if (!now[b]) spent.delete(b);
      if (spent.has(b)) { now[b] = false; continue; }
      if (now[b] && !held.pad[b] && !quiet) waiting[b] ??= COMBO_WAIT;
      if (!(b in waiting)) continue;
      if (now[b] && waiting[b] > 0) { waiting[b]--; now[b] = false; }
      else { delete waiting[b]; now[b] = true; }   // waited long enough, or let go first: the game gets its press
    }
    for (const b of buttons) {
      if (!!held.pad[b] === !!now[b]) continue;
      held.pad[b] = !!now[b];
      set(b, quiet);
    }
  }

  // the buttons a key holds, but those of an extra that is off; none while a proof tool plays the game
  const buttonsOf = code => (played() ? [] : [].concat(keys[code] ?? []).filter(b => !off(b)));
  addEventListener('keydown', e => {
    const pressing = buttonsOf(e.code);
    if (!input.enabled || !pressing.length || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    if (!e.repeat) for (const b of pressing) input.press(b, true);
  });
  addEventListener('keyup', e => {
    const pressing = buttonsOf(e.code);
    if (!pressing.length) return;
    if (input.enabled) e.preventDefault();
    for (const b of pressing) input.press(b, false);
  });
  addEventListener('blur', () => { if (!played()) input.release(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !played()) input.release(); });

  /**
   * The on-screen controller: any element with data-pad-button set to an Xbox controller's button by its number in
   * the standard layout (0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu), marked `held` while a finger is
   * on it, and a d-pad (data-pad) whose directions follow the finger as it slides. They do what the controller's
   * buttons do.
   */
  input.bindTouch = root => {
    for (const el of root.querySelectorAll('[data-pad-button]')) {
      const button = Number(el.dataset.padButton);
      const hold = down => {
        el.classList.toggle('held', down);
        if (down) touched.add(button); else touched.delete(button);
        touchSync();
      };
      el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); hold(true); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(type, () => hold(false));
      el.addEventListener('contextmenu', e => e.preventDefault());
    }
    for (const pad of root.querySelectorAll('[data-pad]')) bindPad(pad);
    // iOS brings up its magnifier on a finger held down unless the touch itself is cancelled
    root.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  };

  // the d-pad: the direction from its middle to the finger, two at once on a diagonal, as a real one presses two.
  // The straight ways are 60° wide and the diagonals 30°, so running doesn't roll or look up by a slip of the
  // finger; the very middle holds nothing. It marks the ways held in data-held.
  function bindPad(pad) {
    let finger = null;
    const hold = ways => {
      for (const [way, i] of Object.entries(DPAD)) if (ways.includes(way)) touched.add(i); else touched.delete(i);
      pad.dataset.held = ways.join(' ');
      touchSync();
    };
    const follow = e => {
      const r = pad.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(x, y) < r.width * 0.1) return hold([]);
      const a = Math.atan2(y, x) * 180 / Math.PI;   // 0 is right, 90 down
      const ways = [];
      if (Math.abs(a) < 60) ways.push('right');
      if (Math.abs(a) > 120) ways.push('left');
      if (a > 30 && a < 150) ways.push('down');
      if (a < -30 && a > -150) ways.push('up');
      hold(ways);
    };
    pad.addEventListener('pointerdown', e => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      finger = e.pointerId;
      follow(e);
    });
    pad.addEventListener('pointermove', e => { if (e.pointerId === finger) follow(e); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      pad.addEventListener(type, e => { if (e.pointerId === finger) { finger = null; hold([]); } });
    }
    pad.addEventListener('contextmenu', e => e.preventDefault());
  }
  return input;
}
