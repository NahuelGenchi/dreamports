// The countdown as a stage starts: the machine Sonic waits at, the numbers, and the announcer's voice. Rewritten from
// 0x08036054 and 0x08036168. What comes when it ends, START!! and running, isn't made yet.

import { createSprite, updateSprite, displaySprite, SPRITE } from '../sprite.js';
import { playerAnimations } from './player.js';

const FRAMES_PER_SECOND = 60, SKIPPED_TITLE = 3 * FRAMES_PER_SECOND, CROUCH_UNTIL = 70;
const ANIM_MACHINE = 530, ANIM_NUMBERS = 1129, NUMBER_ONE = 2, READY_ANIMATION = 30, READY_LIFTOFF = 1;
const VOICE_3 = 208, VOICE_2 = 209, VOICE_1 = 210;

export function createCountdown(stage) {
  const { c } = stage;
  const numbers = createSprite({ tiles: stage.allocTiles(4), anim: ANIM_NUMBERS, variant: 0, oamFlags: 4 << 6 });
  const machine = createSprite({ tiles: stage.allocTiles(14), anim: ANIM_MACHINE, variant: 0, oamFlags: 18 << 6, frameFlags: 0x2000 | SPRITE.X_FLIP });
  const counting = { timer: SKIPPED_TITLE };
  c.createTask(t => {
    const p = stage.player, cam = stage.camera;
    if (counting.timer === 3 * FRAMES_PER_SECOND) c.playSong(VOICE_3);
    else if (counting.timer === 2 * FRAMES_PER_SECOND) c.playSong(VOICE_2);
    else if (counting.timer === FRAMES_PER_SECOND) c.playSong(VOICE_1);
    if (counting.timer === 0) return;   // START!! and running come next, which aren't made yet
    counting.timer--;
    const x = (p.x >> 8) - cam.x, y = (p.y >> 8) - cam.y;
    machine.x = x;
    machine.y = y;
    updateSprite(c, machine);
    displaySprite(c, machine);
    if (counting.timer < SKIPPED_TITLE) {
      numbers.variant = NUMBER_ONE - Math.trunc(counting.timer / FRAMES_PER_SECOND);
      numbers.prevVariant = 0xFF;
      numbers.x = x + 24;
      numbers.y = y - 24;
      updateSprite(c, numbers);
      displaySprite(c, numbers);
    }
    if (counting.timer >= CROUCH_UNTIL && counting.timer < SKIPPED_TITLE) {
      p.animation = playerAnimations(c) + READY_ANIMATION;
      p.variant = READY_LIFTOFF;
      p.restart = true;
    }
  }, counting, 0x3000);
}
