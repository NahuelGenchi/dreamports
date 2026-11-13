// Steps in the browser's history, which the site and its games add only where the browser can use them.
//
// The Home Screen app on an iPhone or iPad goes back or forward a page when a finger slides in from the screen's edge,
// as Safari does, and no page can stop that. It does nothing when there's no page before or after this one, so there
// the site never adds a step and replaces the address instead (#1245). Its own Back, Esc and B go back without the
// browser's history. Everywhere else a step stays, for the browser's back button.

/** Whether moving around the site adds a step to the browser's history. */
export const addsSteps = navigator.standalone !== true;

/** Puts `address` in the address bar, as a step in the browser's history where the site adds steps. */
export function stepTo(state, address) {
  if (addsSteps) history.pushState(state, '', address);
  else history.replaceState(null, '', address);
}

/** Goes to the page at `address`, as a step in the browser's history where the site adds steps. */
export function goTo(address) {
  if (addsSteps) location.assign(address);
  else location.replace(address);
}
