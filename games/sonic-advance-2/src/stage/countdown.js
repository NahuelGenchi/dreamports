// The countdown as a stage starts: the machine Sonic waits at, the numbers, the announcer's voice, and as it ends, his setting
// off and START!!. Rewritten from 0x08036054, 0x08036168, 0x08036398 and Task_RaceStartMessageMain.

import { createSprite, updateSprite, displaySprite, transformSprite, SPRITE } from '../sprite.js';
import { KEY } from '../core.js';
import { FLAG, STATE, playerAnimations } from './player.js';
import { SINE } from './trig.js';

const FRAMES_PER_SECOND = 60, SKIPPED_TITLE = 3 * FRAMES_PER_SECOND, CROUCH_UNTIL = 70;
const ANIM_MACHINE = 530, ANIM_NUMBERS = 1129, ANIM_START = 1130, NUMBER_ONE = 2, READY_ANIMATION = 30, READY_LIFTOFF = 1;
const VOICE_3 = 208, VOICE_2 = 209, VOICE_1 = 210, VOICE_GO = 211;
const SETS_OFF = 4 * 256, SETS_OFF_FAST = 9 * 256, FAST_WITHIN = 5;
const START_FRAMES = 60, SHRINKS_UNDER = 16, START_X = 120, START_Y = 40, ROOM_AROUND = 256;

export function createCountdown(stage) {
  const { c } = stage;
  const numbers = createSprite({ tiles: stage.allocTiles(4), anim: ANIM_NUMBERS, variant: 0, oamFlags: 4 << 6 });
  const machine = createSprite({ tiles: stage.allocTiles(14), anim: ANIM_MACHINE, variant: 0, oamFlags: 18 << 6, frameFlags: 0x2000 | SPRITE.X_FLIP });
  const counting = { timer: SKIPPED_TITLE, fast: false, tooSoon: false };
  c.createTask(t => {
    const p = stage.player, cam = stage.camera;
    if (counting.timer === 3 * FRAMES_PER_SECOND) c.playSong(VOICE_3);
    else if (counting.timer === 2 * FRAMES_PER_SECOND) c.playSong(VOICE_2);
    else if (counting.timer === FRAMES_PER_SECOND) c.playSong(VOICE_1);
    counting.timer--;
    if (counting.timer === 0) {
      p.flags &= ~FLAG.BUTTONS_OFF;
      stage.timeRuns = true;
      p.state = STATE.RUNNING;
      p.groundSpeed = counting.fast ? SETS_OFF_FAST : SETS_OFF;
      createStartMessage(stage);
      c.playSong(VOICE_GO);
      leaveMachine(stage, t, machine, p.x >> 8, p.y >> 8);
    } else if (c.pressed & KEY.RIGHT) {
      // pressed in the last moment and no sooner, it sets off at full speed
      if (counting.timer >= FAST_WITHIN) counting.tooSoon = true;
      else if (!counting.tooSoon) counting.fast = true;
    }
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

// 0x08036398: from then on the machine stays where it was, until it's far off the screen
function leaveMachine(stage, t, machine, worldX, worldY) {
  const { c } = stage;
  t.main = task => {
    machine.x = worldX - stage.camera.x;
    machine.y = worldY - stage.camera.y;
    if (machine.x < -ROOM_AROUND || machine.x > 240 + ROOM_AROUND || machine.y < -ROOM_AROUND / 2 || machine.y > 160 + ROOM_AROUND / 2) {
      c.destroyTask(task);
      return;
    }
    updateSprite(c, machine);
    displaySprite(c, machine);
  };
}

// CreateRaceStartMessage and Task_RaceStartMessageMain: START!!, in two halves, which flattens out as it goes
function createStartMessage(stage) {
  const { c } = stage;
  const half = variant => ({
    sprite: createSprite({ tiles: stage.allocTiles(64), anim: ANIM_START, variant, oamFlags: 4 << 6, x: START_X, y: START_Y }),
    turn: { rotation: 0, scaleX: 256, scaleY: 256, x: START_X, y: START_Y },
  });
  const halves = [half(0), half(1)];
  let timer = START_FRAMES;
  c.createTask(t => {
    timer--;
    if (timer === 0) {
      c.destroyTask(t);
      return;
    }
    for (const { sprite, turn } of halves) {
      sprite.x = START_X;
      sprite.y = START_Y;
      sprite.frameFlags = stage.oamMatrix++ | SPRITE.ROT_SCALE_ENABLE | SPRITE.DOUBLE_SIZE;
      turn.scaleX = timer < SHRINKS_UNDER ? 2 * 256 - timer * 16 : 256;
      turn.scaleY = timer < SHRINKS_UNDER ? (timer + 1) * 16 : 256;
      updateSprite(c, sprite);
      transformSprite(c, sprite, turn, SINE);
      displaySprite(c, sprite);
    }
  }, null, 0x3000);
}
