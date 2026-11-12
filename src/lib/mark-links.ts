// The files a page names for its icons (#1161): the browser tab's, the Home Screen's, and the manifest an installed
// app is made from. Each logo a player can pick in Settings (#1144) has a set of its own under /icons/<pose>-<colour>/,
// drawn when the site is built (mark-icons.ts); the site's own, Leap in Deep, keeps the files it always had.
// Base.astro writes the links and its first script points them at the pick, as src/scripts/mark.ts does when the pick
// changes. A phone never redraws the icon of an app already on the Home Screen: the icon is the pick of the moment
// the app was added.
import type { ColourName, PoseName } from './mark';

export const ICON_LINKS = [
  { rel: 'icon', own: '/favicon.svg', file: 'favicon.svg', type: 'image/svg+xml' },
  { rel: 'apple-touch-icon', own: '/apple-touch-icon.png?v=3', file: 'apple-touch-icon.png', type: undefined },
  { rel: 'manifest', own: '/manifest.webmanifest', file: 'manifest.webmanifest', type: undefined },
] as const;

export const ICONS_AT = '/icons/';

/** The word in an address that carries a logo, as in `/?logo=sleep-lagoon`. An app on the Home Screen opens at such
 *  an address (its manifest's), since a phone keeps an app's choices apart from the browser's: the app starts with the
 *  logo its icon shows. The page's first script takes it only when the browser keeps no logo of its own. */
export const LOGO_PARAM = 'logo';

/** Where a pick's icons are, or nothing for the site's own. */
export function iconsOf(pose: PoseName, colour: ColourName) {
  return pose === 'leap' && colour === 'deep' ? null : `${ICONS_AT}${pose}-${colour}/`;
}
