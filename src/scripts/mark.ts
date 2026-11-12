// The mark a player picked in Settings (#1144): its pose and its colour, kept in the browser. The colour is CSS alone,
// set on the root by the page's first script (Base.astro) and here, and so are the page's icons (#1161). A pose other
// than Leap is drawn in from mark-poses.ts, fetched only then, and until it is a mark stays unseen (global.css), so
// Leap never flashes first. Leap itself is what every page already draws, so nothing here holds a copy of it: a mark's
// own drawing is put aside before another pose goes over it, and put back for Leap.
import { COLOURS, POSES, type ColourName, type PoseName } from '../lib/mark';
import { ICON_LINKS, iconsOf } from '../lib/mark-links';

export const LOGO_KEYS = { pose: 'logo-pose', colour: 'logo-colour' } as const;

const root = document.documentElement;
const LAND = ['--land-x', '--land-y', '--land-r'];
// each mark as the page drew it
const drawn = new WeakMap<SVGSVGElement, { viewBox: string; svg: string }>();

function kept(key: string) {
  try {
    return localStorage.getItem('dreamports:' + key);
  } catch {
    return null;
  }
}

/** What the browser has kept, with anything it doesn't know read as the default. */
export function logoKept(): { pose: PoseName; colour: ColourName } {
  const pose = kept(LOGO_KEYS.pose) as PoseName;
  const colour = kept(LOGO_KEYS.colour) as ColourName;
  return { pose: POSES.includes(pose) ? pose : 'leap', colour: COLOURS.includes(colour) ? colour : 'deep' };
}

let asked = 0;

/** Shows the mark in a pose and a colour, everywhere the page has it. */
export async function showLogo(pose: PoseName, colour: ColourName) {
  if (colour === 'deep') delete root.dataset.logoColour;
  else root.dataset.logoColour = colour;
  if (pose === 'leap') delete root.dataset.logoPose;
  else root.dataset.logoPose = pose;
  // its icons too: the browser tab's, and the ones a phone takes when the site is added to the Home Screen (#1161)
  const icons = iconsOf(pose, colour);
  for (const { rel, own, file } of ICON_LINKS) {
    document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)?.setAttribute('href', icons ? icons + file : own);
  }
  const turn = ++asked;
  let art = null;
  if (pose !== 'leap') {
    try {
      art = (await import('../lib/mark-poses')).POSE_ART[pose];
    } catch {
      // the other poses couldn't be fetched: Leap, which every page has, shows again
      if (turn === asked) delete root.dataset.logoPose;
      return;
    }
    // a pick made since wins
    if (turn !== asked) return;
  }
  for (const svg of document.querySelectorAll<SVGSVGElement>('svg.mark[data-mark]')) {
    if ((svg.dataset.pose ?? 'leap') === pose) continue;
    if (!drawn.has(svg)) drawn.set(svg, { viewBox: svg.getAttribute('viewBox') ?? '', svg: svg.innerHTML });
    const one = art ? (svg.dataset.mark === 'alone' ? art.alone : art.whole) : drawn.get(svg)!;
    svg.setAttribute('viewBox', one.viewBox);
    svg.innerHTML = art ? one.svg.replaceAll('ID-', `${svg.dataset.id}-`) : one.svg;
    svg.dataset.pose = pose;
    // the mark a launching game drops into says where it lands; Leap's place is the style sheet's own
    const target = svg.closest<HTMLElement>('.t-mark');
    if (target) LAND.forEach((name, i) => (art ? target.style.setProperty(name, `${art.land[i]}%`) : target.style.removeProperty(name)));
  }
}

/** Draws a mark the page left empty, as a copy of another one on it with ids of its own: the one in Settings, which
 *  the page then doesn't have to carry twice. */
export function copyMark(to: SVGSVGElement, from: SVGSVGElement) {
  if (to.childElementCount) return;
  const own = (svg: string) => svg.replaceAll(`${from.dataset.id}-`, `${to.dataset.id}-`);
  to.setAttribute('viewBox', from.getAttribute('viewBox') ?? '');
  to.innerHTML = own(from.innerHTML);
  if (from.dataset.pose) to.dataset.pose = from.dataset.pose;
  const first = drawn.get(from);
  if (first) drawn.set(to, { viewBox: first.viewBox, svg: own(first.svg) });
}

/** Shows what the browser has kept. A page with nothing kept is left as it was drawn. */
export function showLogoKept() {
  const { pose, colour } = logoKept();
  if (pose !== 'leap' || colour !== 'deep') void showLogo(pose, colour);
}
