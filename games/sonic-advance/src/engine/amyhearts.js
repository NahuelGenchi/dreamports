// The hearts Amy's hammer leaves (SAT-R decompilation, src/game/shared/stage/amy_attack_heart_effect.c): a task at
// priority 0x3001. Each pattern gives when each heart comes, in her animation's time, and where, from where she is
// then. The task ends when her move does, and takes its hearts with it.

import { makeAnimator, setAnim, tickAnim, frameOf } from './animator.js';

// sHeartOffsets: [when, x, y] for her first swing, her second, the hammer in the air and swirled down
const PATTERNS = [
  [[10, 0, -27], [12, 13, -22], [14, 23, -13], [16, 26, 0]],
  [[10, 7, -27], [12, 20, -22], [14, 30, -13], [16, 33, 0]],
  [[0, -10, -26], [4, 8, -27], [8, 22, -17], [12, 28, -1], [16, 23, 16], [20, 10, 26]],
  [[2, 0, 4], [6, 19, 6], [10, 28, 2], [14, 19, 4], [18, 0, 6], [22, -19, 2], [26, -28, 4], [30, -19, 6]],
];
const MAX_HEARTS = 4;   // AMY_ATTACK_HEART_SPRITE_COUNT
const SPEED_SCALE = 16;

/** The task for the pattern `kind`, for the player `p`; `draw` puts a sprite in the frame's list. */
export function createHearts(kind, p, playerAnims, draw) {
  const pattern = PATTERNS[kind], state = p.state, slots = new Array(MAX_HEARTS).fill(null);
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
