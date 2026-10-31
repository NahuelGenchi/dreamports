// A Dreamport's progress map, next to its page, at /dreamports/<game>-dreamport/progress.svg, drawn from its proof
// files as the site is built (src/lib/progress-map.mjs), so it changes whenever they do. The README, issues and
// progress posts can show it. public/_headers keeps GitHub's image cache from holding an old one.
import type { APIRoute, GetStaticPaths } from 'astro';
import { progressMapOf } from '../../../lib/dreamports';
import { getGames, sectionFor } from '../../../lib/site';

export const getStaticPaths = (async () => {
  const games = await getGames();
  return games.flatMap((game) =>
    game.data.kind === 'dreamport'
      ? [{ params: { section: sectionFor('dreamport').path, slug: game.id }, props: { svg: progressMapOf(game.data).svg } }]
      : [],
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(props.svg, { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } });
