// What this build of the Make pages read from GitHub (src/lib/making.ts), which the next build takes when GitHub
// doesn't answer it.
import type { APIRoute } from 'astro';
import { making } from '../../lib/making';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await making()), { headers: { 'Content-Type': 'application/json' } });
