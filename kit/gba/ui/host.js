// The dreamports.net launcher, when it opened this game's page inside its own (#1443): Play there fades the screen
// to black, loads this page behind it, and shows it once it says it's ready. The page stays the launcher's, so the
// press on Play counts for the game's sound, which a press on a page left behind doesn't in every browser.
//
// The launcher leaves `dreamportsHost` on its window: { opening, takeSound(), shown(), leave() }. A page opened by
// its address has none, and starts on its own screen.

const launcher = (() => {
  try {
    return parent !== window ? parent.dreamportsHost ?? null : null;
  } catch {
    return null;   // inside another site's page
  }
})();

/** Whether the launcher opened this page, with its own way back. */
export const hosted = !!launcher;

/**
 * Whether the press on Play in the launcher is still waiting for its game: true once, for the page it opened, and not
 * for the same page loaded again inside it.
 */
export function opening() {
  return !!launcher?.opening;
}

/** Tells the launcher the page has drawn what the player came for, the game or the screen that asks for its ROMs. */
export function shown() {
  launcher?.shown();
}

/** Back to the launcher's menu, as it was left. */
export function leaveToHost() {
  launcher.leave();
}

/**
 * An AudioContext for the game's sound and the AudioWorkletNode made for it: the one the launcher made as Play was
 * pressed, which plays without another press, or the page's own. `rate` is the sample rate asked of the page's own,
 * where the browser has it; the launcher's has the browser's rate.
 */
export function soundContext(rate = 0) {
  const lent = launcher?.takeSound();
  if (lent) return lent;
  if (rate) {
    try {
      return { context: new AudioContext({ latencyHint: 'interactive', sampleRate: rate }), Node: AudioWorkletNode };
    } catch { /* a rate this browser won't play: its own, and the worklet keeps up */ }
  }
  return { context: new AudioContext({ latencyHint: 'interactive' }), Node: AudioWorkletNode };
}
