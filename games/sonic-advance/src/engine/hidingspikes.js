// The hiding spikes (SAT-R decompilation, src/game/sa1/stage/interactables/spikes.c: Task_Spikes_HidingUp, at
// 0x08020A1C in the USA ROM, and Task_Spikes_HidingDown, flipped upside down). They come and go with the stage
// clock, 128 frames a turn: hidden and not drawn for 60, rising over 4 (the spikes' variants 0 and 1, 2 frames
// each), up for 60 (variant 2), sinking over 4 (1, then 0). Only while they are up are they solid. On the
// first frame up, Sonic's body inside their box is put on top of them (on whole pixels; below them for the
// down ones) and hurt; otherwise the up ones hurt him as he lands on them, as the plain spikes do, and the
// down ones when he bumps them from below. On the frames they aren't up they drop him if he stands on them
// and stop him pushing them. The data bytes aren't read. With the gravity flipped the two kinds swap their
// tests, which this game doesn't have yet.

import { makeSprite, startAnim, animate, offCam } from './objects.js';
import { platform, overlap, LANDED, FROM_BELOW, PUSHING } from './collide.js';
import { SONG } from '../sound/songs.js';

export const HIDING_SPIKES_UP = 5, HIDING_SPIKES_DOWN = 6;
const SOX = 6;   // Sonic's spriteOffsetX
// the spikes' animation (454): rising and sinking (variants 0 and 1), and up (2)
const LOOKS = ['spikesHiding0', 'spikesHiding1', 'spikesUp'];

/** The task for a hiding spikes entity, or null when `e` is not one. */
export function createHidingSpikes(e, slot, anims) {
  if (e.kind !== HIDING_SPIKES_UP && e.kind !== HIDING_SPIKES_DOWN) return null;
  const down = e.kind === HIDING_SPIKES_DOWN;
  const o = { x: e.x, y: e.y, ...makeSprite(LOOKS[2], { flipY: down, order: 17 }) };
  let variant = -1;   // none yet: the sprite starts with no animation
  const last = [0, 0];   // movestateBuffer: what the last collision found while they were up, for each player
  const show = v => { variant = v; startAnim(o, LOOKS[v]); animate(o, anims); };
  const hurt = (world, p) => { if (world.damage(p)) world.playSound(SONG.SPIKES); };
  return {
    run(ctx) {
      if (offCam(e.x, e.y, ctx.cam)) { slot.live = null; return false; }
      const world = ctx.world, t = world.tick % 128;
      // each player's turn steps the animation, so with the CPU partner it runs twice a frame; the frame they
      // come up for Sonic is their first frame up for the partner too
      let first = false;
      for (const [i, p] of ctx.players.entries()) {
        if (t >= 64 && t < 124) {
          if (variant !== 2 || (i !== 0 && first)) {
            if (i === 0) first = true;
            show(2);
            const hb = o.boxes[0], px = Math.floor(p.x), py = Math.floor(p.y);
            if (hb && !p.dead && overlap(o.x, o.y, hb, px, py, [-SOX, -p.offsetY, SOX, p.offsetY])) {
              p.y = down ? o.y + hb[3] + p.offsetY - 1 : o.y + hb[1] - (p.offsetY - 1);
              hurt(world, p);
            } else if (!down && (platform(o, hb, p, world.terrain) & LANDED)) hurt(world, p);
          } else {
            last[i] = platform(o, o.boxes[0], p, world.terrain);
            if (last[i] & (down ? FROM_BELOW : LANDED)) hurt(world, p);
          }
        } else {
          if (p.onObject === o) { p.onObject = null; p.air = true; }
          if (last[i] & PUSHING) { p.pushing = false; last[i] = 0; }
          if (t >= 60) show(t < 62 || t >= 126 ? 0 : 1);
        }
      }
      if (t < 60) return true;
      ctx.draw(o, o.x, o.y);
      return true;
    },
  };
}
