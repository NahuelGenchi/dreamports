// @ts-check
import { defineConfig } from 'astro/config';
import games from './src/integrations/games.mjs';
import liveSite from './src/integrations/live-site.mjs';

export default defineConfig({
  site: 'https://dreamports.net',
  trailingSlash: 'always',
  // the games in games/, copied to /play/<game>/ as the site is built, and what lets the site be compared with main
  integrations: [games(), liveSite()],
});
