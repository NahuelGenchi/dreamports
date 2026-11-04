// The hearts Amy's hammer leaves (SAT-R decompilation, src/game/shared/stage/amy_attack_heart_effect.c): a task at
// priority 0x3001. Each pattern, read from the player's copy (sHeartOffsets, rom/extract.js), gives when each heart
// comes, in her animation's time, and where, from where she is then. The task ends when her move does, and takes
// its hearts with it.

import { makeAnimator, setAnim, tickAnim, frameOf } from './animator.js';

const MAX_HEARTS = 4;   // AMY_ATTACK_HEART_SPRITE_COUNT
const SPEED_SCALE = 16;

/** The task for `pattern`, [when, x, y] for each heart, for the player `p`; `draw` puts a sprite in the frame's list. */
export function createHearts(pattern, p, playerAnims, draw) {
  const state = p.state, slots = new Array(MAX_HEARTS).fill(null);
  let time = 0, next = 0;
  return {
    run() {
      if (p.state !== state) return false;
      slots.forEach((h, i) => { if (h?.done) slots[i] = null; });
      // the time passes by her animation's speed, and a heart comes once it has reached this one's, in the first
      // slot that's free, which decides which of two hearts is in front
      const was = time;
      if (next < pattern.length) {
        time += p.anim.speed;
        if (was >= pattern[next][0] * SPEED_SCALE) {
          const free = slots.indexOf(null);
          if (free >= 0) {
            const [, x, y] = pattern[next], a = makeAnimator();
            setAnim(a, 'heart');
            a.speed = p.anim.speed;
            slots[free] = { a, x: Math.floor(p.x) + (p.facing < 0 ? -x : x), y: Math.floor(p.y) + y, done: false };
          }
          next = (next + 1) & 7;
          if (next === 0) time = 0;
        }
      }
      // an animation that ends still shows on that frame, and the heart goes on the next
      for (const h of slots) {
        if (!h) continue;
        h.done = tickAnim(h.a, playerAnims);
        draw({ frame: frameOf(h.a, playerAnims), flipX: false, flipY: false, order: 16, prio: 2 }, h.x, h.y);
      }
      return true;
    },
  };
}
