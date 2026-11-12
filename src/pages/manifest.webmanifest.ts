// The manifest an installed app is made from, with the site's own logo on its icons. A logo a player picked has a
// manifest of its own (icons/[pick]/[file].ts), written from the same place (src/lib/mark-icons.ts).
import type { APIRoute } from 'astro';
import { manifestFile } from '../lib/mark-icons';

export const GET: APIRoute = () => new Response(manifestFile(), { headers: { 'Content-Type': 'application/manifest+json' } });
