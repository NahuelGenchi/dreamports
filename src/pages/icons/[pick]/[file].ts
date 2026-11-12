// The icons of each logo a player can pick (#1161), at /icons/<pose>-<colour>/: the Home Screen's and the app's
// tiles, the browser tab's, and the manifest naming them, all drawn by src/lib/mark-icons.ts when the site is built.
// The page links to the ones of the pick (src/lib/mark-links.ts).
import type { APIRoute } from 'astro';
import { PICKS, TILES, favicon, manifestFile, tile, type TileName } from '../../../lib/mark-icons';
import { ICON_LINKS } from '../../../lib/mark-links';

const [tab, , app] = ICON_LINKS;
const isTile = (file: string): file is TileName => file in TILES;

export function getStaticPaths() {
  return PICKS.flatMap((pick) =>
    [...Object.keys(TILES), tab.file, app.file].map((file) => ({ params: { pick: `${pick.pose}-${pick.colour}`, file }, props: { pick } })),
  );
}

export const GET: APIRoute<{ pick: (typeof PICKS)[number] }> = async ({ params, props: { pick } }) => {
  const file = params.file ?? '';
  if (isTile(file)) {
    const png = await tile(pick.pose, pick.colour, file);
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
  }
  if (file === tab.file) return new Response(favicon(pick.pose, pick.colour), { headers: { 'Content-Type': tab.type } });
  return new Response(manifestFile(pick), { headers: { 'Content-Type': 'application/manifest+json' } });
};
