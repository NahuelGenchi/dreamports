// @ts-check
import { defineConfig } from 'astro/config';
import games from './src/integrations/games.mjs';

export default defineConfig({
  site: 'https://dreamports.net',
  trailingSlash: 'always',
  // the games in games/, copied to /play/<game>/ as the site is built
  integrations: [games()],
});
