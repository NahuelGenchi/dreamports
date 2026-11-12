// The logo a player picked in dreamports.net's Settings, on the Opening screen a game's page starts on (kit.css) and
// on the browser's tab. The page loads this in its head, as a plain script, so the pick is there on the first frame
// and the site's own logo, the one the style sheet draws, never shows first. The pictures are dreamports.net's,
// drawn when the site is built, one set per pick under /icons/<pose>-<colour>/ (src/lib/mark-icons.ts there, which
// stops the build if these names stop matching its own). A player with no pick loads nothing more.
(() => {
  const POSES = ['leap', 'jump', 'dive', 'rise', 'sleep'];
  const COLOURS = ['deep', 'soft', 'lagoon'];
  const kept = (key) => {
    try {
      return localStorage.getItem('dreamports:' + key);
    } catch {
      return null; // storage blocked: the site's own logo
    }
  };
  // anything the site doesn't know reads as its own, the first of each
  const own = (names, name) => (names.includes(name) ? name : names[0]);
  const pose = own(POSES, kept('logo-pose'));
  const colour = own(COLOURS, kept('logo-colour'));
  if (pose === POSES[0] && colour === COLOURS[0]) return;
  const at = `/icons/${pose}-${colour}/`;
  const root = document.documentElement;
  root.dataset.logo = `${pose}-${colour}`;
  root.style.setProperty('--opening-mark', `url("${at}mark.svg")`);
  root.style.setProperty('--opening-mark-dark', `url("${at}mark-dark.svg")`);
  document.querySelector('link[rel="icon"]')?.setAttribute('href', at + 'favicon.svg');
})();
