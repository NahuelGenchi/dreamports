// How a game comes up over the menu and goes back to it (#1446). Pixels is the site's own; a player picks another in
// Settings, where the choice is drawn from this list, and the launcher plays it (src/scripts/launch-transitions.ts).
export const TRANSITIONS = ['pixels', 'power', 'dive'] as const;
export type TransitionName = (typeof TRANSITIONS)[number];

/** The key the pick is kept under in the browser, after `dreamports:`. */
export const TRANSITION_KEY = 'transition';
