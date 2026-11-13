// Steps in the browser's history, which the site and its games add only where the browser can use them.
//
// The Home Screen app on an iPhone or iPad goes back or forward a page when a finger slides in from the screen's edge,
// as Safari does, and no page can stop that. It does nothing when there's no page before or after this one, so there
// the site never adds a step on its own pages and replaces the address instead (#1245). They all have their own way
// back: the launcher's Back, Esc and B, and a game's way back to the launcher. Everywhere else a step stays, for the
// browser's back button.

/** Whether moving around the site adds a step to the browser's history. */
export const addsSteps = navigator.standalone !== true;

// the way into a sign-in, which leads to another site
const API = '/api/';

/** Whether `address` is one of the site's own pages, the launcher's or a game's, each with its own way back. */
export function ownPage(address) {
  const url = new URL(address, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith(API)) return false;
  const name = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  return !name.includes('.') || name.endsWith('.html');
}

/**
 * Whether `address` is one of the site's files, such as a license, which has no way back of its own: in the app it
 * opens apart from it, as a link with a modifier does, so the app gains no step.
 */
export function ownFile(address) {
  const url = new URL(address, location.href);
  return url.origin === location.origin && !url.pathname.startsWith(API) && !ownPage(url);
}

/** Puts `address` in the address bar, as a step in the browser's history where the site adds steps. */
export function stepTo(state, address) {
  if (addsSteps) history.pushState(state, '', address);
  else history.replaceState(null, '', address);
}

/** Goes to the page at `address`, as a step in the browser's history where the site adds steps. */
export function goTo(address) {
  if (addsSteps || !ownPage(address)) location.assign(address);
  else location.replace(address);
}

// What adds a step in the app anyway, as a game's own code can, gives way to the same move that replaces the address,
// caught where the browser announces it (the Navigation API, in Safari since 26.2). Every page of the site loads this,
// the launcher's through its scripts and a game's through its start screen (rom-setup.js), so no game has to change.
if (!addsSteps && 'navigation' in window) {
  navigation.addEventListener('navigate', e => {
    if (e.navigationType !== 'push' || !e.cancelable || e.formData || typeof e.downloadRequest === 'string') return;
    const to = e.destination.url;
    if (!ownPage(to)) return;
    e.preventDefault();
    // after the event, as a move started while it's announced would be part of the one it stops: the same page at
    // another address, with no state, as stepTo gives in the app, or another page or place on this one
    const pushed = e.destination.sameDocument && !e.hashChange;
    setTimeout(() => (pushed ? history.replaceState(null, '', to) : location.replace(to)));
  });
}
