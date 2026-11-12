// Draws the icons of each logo a player can pick (#1161), when the site is built: the Home Screen's and the app's as
// PNG tiles, the browser tab's as an SVG, and the manifest that names them. The drawings are the page's own (mark.ts,
// mark-poses.ts) and so are the colours and the lines' rules, read from global.css, so nothing is kept twice and an
// icon can't drift from the logo on the page. Only pages under src/pages/ use this: no browser loads it.
import sharp from 'sharp';
import css from '../styles/global.css?raw';
import openingMark from '../../kit/gba/ui/opening-mark.js?raw';
import { COLOURS, DOLPHIN, MARK, POSES, type Art, type ColourName, type PoseName } from './mark';
import { ICONS_AT, LOGO_PARAM, OPENING_MARKS, iconsOf } from './mark-links';
import { POSE_ART } from './mark-poses';

/** Every pick with icons of its own: all but the site's own, Leap in Deep. */
export const PICKS = POSES.flatMap((pose) =>
  COLOURS.flatMap((colour) => {
    const at = iconsOf(pose, colour);
    return at ? [{ pose, colour, at }] : [];
  }),
);

/** The `--mk-` values the style sheet's first rule with this selector sets. */
function values(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`global.css has no "${selector}" rule for the logo's icons to read`);
  const rule = css.slice(at, css.indexOf('}', at));
  return Object.fromEntries([...rule.matchAll(/--(mk-[a-z0-9]+):\s*([^;]+);/g)].map((found) => [found[1], found[2].trim()]));
}

/** A colour's values as the page works them out: the site's own, the dark theme's over them, the pick's over both. */
function palette(colour: ColourName, dark = false) {
  return {
    ...values(':root'),
    ...(dark ? values(":root[data-theme='dark']") : {}),
    ...(colour === 'deep' ? {} : values(`:root[data-logo-colour='${colour}']`)),
  };
}

// the mark's own rules in the style sheet, in its order
const RULES = ['b1', 'b2', 'b3', 'w1', 'w2', 's1', 's2', 's3', 'eye', 'lid', 'line', 'soft']
  .map((name) => {
    const rule = new RegExp(`^\\.mk-${name} \\{[^}]*\\}`, 'm').exec(css);
    if (!rule) throw new Error(`global.css has no ".mk-${name}" rule for the logo's icons to read`);
    return rule[0].replace(/\s+/g, ' ');
  })
  .join('');

/** The mark's rules with a colour's values written in, as a picture on its own has no page to read them from. */
function rules(colours: Record<string, string>) {
  return RULES.replace(/var\(--(mk-[a-z0-9]+)\)/g, (_, name: string) => {
    if (!colours[name]) throw new Error(`global.css sets no --${name} for the logo's icons to read`);
    return colours[name];
  });
}

const artOf = (pose: PoseName) => (pose === 'leap' ? { whole: MARK, alone: DOLPHIN } : POSE_ART[pose]);
// a picture on its own holds one drawing, so its ids need nothing in front
const drawn = (art: Art) => art.svg.replaceAll('ID-', '');

// The mark's box is its drawing and a margin of 3.5% on each side
const BOX = 1.07;

/** The tiles: how wide each is, and how much of it the drawing takes. A maskable one keeps the drawing inside the
 *  circle a phone may cut it to. */
export const TILES = {
  'apple-touch-icon.png': { size: 180, share: 0.6, purpose: undefined },
  'icon-192.png': { size: 192, share: 0.6, purpose: undefined },
  'icon-512.png': { size: 512, share: 0.6, purpose: undefined },
  'icon-maskable.png': { size: 512, share: 0.54, purpose: 'maskable' },
} as const;
export type TileName = keyof typeof TILES;

/** The whole mark on a white tile, as a PNG. */
export function tile(pose: PoseName, colour: ColourName, name: TileName) {
  const { size, share } = TILES[name];
  const { whole } = artOf(pose);
  const side = size * share * BOX;
  const at = (size - side) / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><style>${rules(palette(colour))}</style>` +
    `<rect width="${size}" height="${size}" fill="#fff"/>` +
    `<svg x="${at}" y="${at}" width="${side}" height="${side}" viewBox="${whole.viewBox}">${drawn(whole)}</svg></svg>`;
  return sharp(new TextEncoder().encode(svg)).png().toBuffer();
}

/** The dolphin alone, for the browser's tab, in the dark theme's colours where the browser is dark. */
export function favicon(pose: PoseName, colour: ColourName) {
  const { alone } = artOf(pose);
  const light = rules(palette(colour));
  const dark = rules(palette(colour, true));
  const night = dark === light ? '' : `@media (prefers-color-scheme:dark){${dark}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${alone.viewBox}"><style>${light}${night}</style>${drawn(alone)}</svg>\n`;
}

/** The whole mark as a picture with nothing behind it, in the light theme's colours or the dark's: a game's Opening
 *  screen (#1185). */
export function opening(pose: PoseName, colour: ColourName, dark: boolean) {
  const { whole } = artOf(pose);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${whole.viewBox}"><style>${rules(palette(colour, dark))}</style>${drawn(whole)}</svg>\n`;
}

// A game's page is plain files, so the script in its head names the picks and these pictures itself. It has to name
// the same ones, in the same order, or a pick would open a game with no logo
const list = (names: readonly string[]) => `[${names.map((name) => `'${name}'`).join(', ')}]`;
for (const needed of [`POSES = ${list(POSES)};`, `COLOURS = ${list(COLOURS)};`, `\`${ICONS_AT}\${pose}-\${colour}/\``, ...Object.values(OPENING_MARKS)]) {
  if (!openingMark.includes(needed)) throw new Error(`kit/gba/ui/opening-mark.js doesn't have "${needed}", as src/lib/mark.ts and mark-links.ts do`);
}

/** The manifest an installed app is made from: the site's own, or a pick's, with its icons and a start that carries
 *  the pick into the app (LOGO_PARAM). Every one is the same app to a browser, by its `id`. */
export function manifest(pick?: (typeof PICKS)[number]) {
  return {
    id: '/',
    name: 'Dreamports',
    short_name: 'Dreamports',
    description: 'Enhanced fan ports of classic games',
    lang: 'en',
    start_url: pick ? `/?${LOGO_PARAM}=${pick.pose}-${pick.colour}` : '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: Object.entries(TILES)
      .filter(([name]) => name !== 'apple-touch-icon.png')
      .map(([name, { size, purpose }]) => ({
        src: (pick?.at ?? '/') + name,
        sizes: `${size}x${size}`,
        type: 'image/png',
        ...(purpose ? { purpose } : {}),
      })),
  };
}

/** A manifest as the file a browser reads. */
export const manifestFile = (pick?: (typeof PICKS)[number]) => JSON.stringify(manifest(pick), null, 2) + '\n';
