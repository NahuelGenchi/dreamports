// The way back to dreamports.net, from a game's start screen (rom-setup.js) and its settings (quit-view.js).

import { addsSteps, goTo } from './steps.js';
import { hosted, leaveToHost } from './host.js';

let home = '/';

/** Says where `leave()` goes when the player didn't come from the menu: the game's own page on dreamports.net. */
export function setHome(address) { home = address; }

// whether the page before this one is the dreamports.net menu: a page of the same site outside the games, which
// are under /play/
function cameFromMenu() {
  if (history.length < 2 || !location.pathname.startsWith('/play/')) return false;
  try {
    const from = new URL(document.referrer);
    return from.origin === location.origin && !from.pathname.startsWith('/play/');
  } catch {
    return false;
  }
}

/**
 * Back to dreamports.net: to the launcher that opened the game inside its own page (host.js), which shows its menu
 * again; else, from its menu, back in the browser's history, so the menu comes back as it was left. The
 * Home Screen app on an iPhone or iPad keeps no history (steps.js), and goes to the game's page on the site it was
 * added from, a preview's included, as another site would open over the app.
 */
export function leave() {
  if (hosted) leaveToHost();
  else if (cameFromMenu()) history.back();
  else goTo(addsSteps ? home : location.origin + new URL(home, location.href).pathname);
}
