// The asset viewer on its own page (viewer.html): the Sonic Advance ROM kept in this browser, or else one chosen
// here, shown as the game page shows it from its settings (the kit's ui/assets-view.js, with the parts of
// ui/assets.js). Its way back goes to the game.

import { createAssetsView } from '../../../kit/gba/ui/assets-view.js';
import { roms, SA1_ROM } from './ui/roms.js';
import { assetParts } from './ui/assets.js';
import { extractAssets } from './rom/extract.js';

// the level shown, as on the game page: viewer.html?level=8 is Angel Island Zone act 1
const level = Number(new URLSearchParams(location.search).get('level') ?? 0) | 0;
const host = document.getElementById('assets');
const view = createAssetsView(host, {
  back: { href: 'index.html', label: 'Back to the game' },
  brand: 'Sonic Advance Dreamport',
  rom: 'Sonic Advance',
  parts: assetParts,
});

async function open(buffer, name, progress = () => {}) {
  view.show(await extractAssets(buffer, progress, { level }), name);
}

const saved = await roms.load(SA1_ROM);
try {
  if (!saved) throw null;
  await open(saved.buffer, saved.name);
} catch {
  view.ask(saved ? 'The ROM kept in this browser could not be read. Choose it again.' : 'Your Sonic Advance ROM isn’t kept in this browser. Choose it, or drop it here, to see what’s decoded from it.', open);
}
