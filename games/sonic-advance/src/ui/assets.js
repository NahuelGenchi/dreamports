// The asset viewer's parts (the kit's ui/assets-view.js): what the extractor decodes from the player's ROM, the
// ROM's facts, Sonic's animations playing with their own timing, the sprite atlas, the act with its collision and
// the zone's background. viewer.html shows them on their own page, and the settings as one of their views.

import { assetPart, scaled } from '../../../../kit/gba/ui/assets-view.js';
import { drawLayer, collisionImage } from '../engine/stage.js';
import { createTerrain } from '../engine/terrain.js';
import { levelInfo } from '../rom/levels.js';

const hex = n => '0x' + n.toString(16).toUpperCase().padStart(6, '0');
const escape = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/**
 * The viewer's parts for `assets` (extract.js), each { title, el }: the ROM's facts, the animations, the sprite
 * atlas, the act and its background. Returns { parts, stop() }; `stop` ends the animations.
 */
export function assetParts(assets, fileName) {
  let stopped = false;
  const parts = [];
  function part(title, inner = '') {
    const el = assetPart(title, inner);
    parts.push({ title, el });
    return el;
  }
  const { info, sprites, stage, physics } = assets;
  const name = (() => { try { return levelInfo(stage.level).name; } catch { return `Level ${stage.level}`; } })();
  const facts = {
    ...(fileName ? { File: fileName } : {}),
    Game: `${info.title} · ${info.code} (${info.region}) · revision ${info.revision}`,
    Version: info.version ?? 'Not on the tested list; tables found by search',
    'SHA-1': info.sha1 ?? 'Unavailable (open this page from localhost or https)',
    'Sprite tables': hex(info.offsets.spriteTables),
    'Tilemap table': hex(info.offsets.tilemaps),
    'Collision table': hex(info.offsets.collision),
    'Start positions': `${hex(info.offsets.spawns)} → level ${stage.level} starts at (${stage.spawn.x}, ${stage.spawn.y})`,
    Interactables: `${hex(info.offsets.interactables)} → ${stage.layerToggles.length} layer toggles and ${stage.interactables.filter(e => e.kind >= 8 && e.kind <= 15).length} springs in level ${stage.level}`,
    'Spin dash speeds': `${hex(info.offsets.spinDashSpeeds)} → ${physics.spinDashSpeeds.slice(0, 9).join(', ')}; overcharged: ${physics.spinDashSpeeds.slice(9).join(', ')}`,
  };
  part('ROM', `<dl class="assets-facts">${Object.entries(facts).map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`);
  previewAnimations(part('Animations', '<div class="assets-anims"></div>').querySelector('.assets-anims'), sprites, () => stopped);
  // the atlas is 2048 px wide, so at its own size; the box scrolls
  part('Sprite atlas', '<div class="assets-sheet"></div>').querySelector('.assets-sheet').append(scaled(sprites.atlas, 1));
  showMap(part(name, `
    <p class="assets-note"></p>
    <label class="switch">
      <span class="switch-text"><span class="switch-label">Show the collision</span><span class="switch-hint">Front layer red, back layer blue, jump-through lighter</span></span>
      <input type="checkbox"><span class="switch-track" aria-hidden="true"><span></span></span>
    </label>
    <div class="assets-sheet"></div>`), stage);
  part(`${name.replace(/ act \d+$/, '')} background`, '<div class="assets-sheet"></div>').querySelector('.assets-sheet').append(scaled(stage.background, 2));
  // a box that scrolls can be picked with the arrows or a controller, which then scroll it
  for (const { el } of parts) el.querySelectorAll('.assets-sheet').forEach(box => { box.tabIndex = 0; box.dataset.nav = box.dataset.scroll = ''; });
  return { parts, stop: () => { stopped = true; } };
}

// the whole act at full size: back layer, front layer, and the collision on top when asked
function showMap(el, stage) {
  const map = document.createElement('canvas');
  map.width = stage.width; map.height = stage.height;
  const g = map.getContext('2d');
  const draw = () => {
    g.clearRect(0, 0, map.width, map.height);
    drawLayer(g, stage, 'back', 0, 0, map.width, map.height);
    drawLayer(g, stage, 'front', 0, 0, map.width, map.height);
  };
  draw();
  el.querySelector('.assets-sheet').append(map);
  el.querySelector('.assets-note').textContent =
    `${stage.levelX} × ${stage.levelY} metatiles, ${stage.width} × ${stage.height} px, ${stage.collision.angles.length} collision tiles.`;
  let overlay = null;
  el.querySelector('input').addEventListener('change', e => {
    draw();
    if (!e.target.checked) return;
    if (!overlay) {
      const terrain = createTerrain(stage.collision);
      overlay = document.createElement('canvas');
      overlay.width = map.width; overlay.height = map.height;
      overlay.getContext('2d').putImageData(collisionImage(terrain, 0, 0, map.width, map.height), 0, 0);
    }
    g.drawImage(overlay, 0, 0);
  });
}

// plays every animation with its own frame delays (60 ticks per second), anchored like in the game, until the
// viewer is cleared
function previewAnimations(box, { atlas, frames, anims }, stopped) {
  const SIZE = 64, SCALE = 2;
  const players = Object.entries(anims).map(([name, anim]) => {
    const card = document.createElement('figure');
    card.className = 'assets-anim';
    const canvas = document.createElement('canvas');
    canvas.width = SIZE * SCALE; canvas.height = SIZE * SCALE;
    card.append(canvas);
    card.insertAdjacentHTML('beforeend', `<b>${escape(name)}</b><small>${anim.frames.length} frames${anim.loop === null ? ' · once' : ''}</small>`);
    box.append(card);
    return { anim, g: canvas.getContext('2d'), i: 0, left: anim.frames[0][1] };
  });
  let last = performance.now(), acc = 0;
  function tick(now) {
    if (stopped()) return;
    acc += Math.min(250, now - last); last = now;
    while (acc >= 1000 / 60) {
      acc -= 1000 / 60;
      for (const p of players) {
        if (--p.left > 0) continue;
        p.i++;
        if (p.i >= p.anim.frames.length) p.i = p.anim.loop ?? 0;   // replay one-shot animations for the preview
        p.left = Math.max(1, p.anim.frames[p.i][1]);
      }
    }
    for (const p of players) {
      p.g.clearRect(0, 0, SIZE * SCALE, SIZE * SCALE);
      const index = p.anim.frames[p.i][0];
      if (index < 0) continue;
      const [sx, sy, w, h, ax, ay] = frames[index];
      p.g.imageSmoothingEnabled = false;
      p.g.drawImage(atlas, sx, sy, w, h, (SIZE / 2 - ax) * SCALE, (SIZE - 20 - ay) * SCALE, w * SCALE, h * SCALE);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
