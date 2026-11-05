// X Zone's two endings, from Egg X's landing to the stage results (SAT-R decompilation,
// src/game/sa1/stage/enemies/boss_x3_egg_x.c): the normal one (sub_803A594 and Task_Strc10_803891C), and the way to
// the Moon Zone (sub_803A54C and Task_8038554), which the rule in unlock.js chooses.

import { SCREEN_W, SCREEN_H } from './constants.js';
import { setCamBounds, setBossCamBounds, camBounds, debris, s16 } from './xbosses.js';
import { makeSprite, animate } from './objects.js';
import { SINE } from './trig.js';

const RIGHT = { left: false, right: true, up: false, down: false, jump: false, attack: false, boost: false, jumpPressed: false, attackPressed: false, boostPressed: false };
const LEFT = { ...RIGHT, right: false, left: true };
const FADE_FROM = 3072;   // Sonic's x where the screen starts to fade to white (qWorldX > 0xBFFFF)
const MOON_RUN_TO = 3680, MOON_FLY_TO = 3872, MOON_PARTNER_STOPS = 3632;

/**
 * The task the wrecked Egg X starts once it has landed (priority 0x1FFF, before the objects'): the base comes
 * down round Sonic, debris flying up at random all over the screen every 4 frames, and behind him more and
 * more often (every 32 frames at first, 2 fewer each time, down to every 4). Two seconds on, once he is on the
 * ground, he runs off to the right by himself and the camera's right bound opens to the act's end; from
 * x 3072 the screen fades to white over 128 frames as the camera falls behind him. Then he stops and is hidden,
 * every object's task goes, and the stage results come up with his rings and time (world.stageResults, the
 * end of the act's tally, #69).
 */
export function normalEnding() {
  let interval = 32, count = 0, tick = 0, timer = 120, phase = 0;
  return {
    run(ctx) {
      const { world, player: p } = ctx;
      tick = (tick + 1) & 0xFFFF;
      if ((tick & 3) === 0) {
        const x = s16(((world.random() | 0) % SCREEN_W) + ctx.cam.x);
        const y = s16(((world.random() | 0) % SCREEN_H) + ctx.cam.y);
        debris(ctx, x, y + 16, y + 32);
      }
      count = (count + 1) & 0xFFFF;
      if (count >= interval) {
        count = 0;
        interval -= 2;
        if (interval < 4) interval = 4;
        const x = s16(Math.floor(p.x) - 48), y = s16(Math.floor(p.y));
        debris(ctx, x, y + 16, y + 32);
      }
      const display = world.display;
      switch (phase) {
        case 0:
          if (timer !== 0) timer--;
          else if (!p.air) {
            p.heldInput = RIGHT;
            setCamBounds(world.cam, { maxX: world.cam.width });
            phase++;
          }
          break;
        case 1:
          if (p.x >= FADE_FROM) {
            Object.assign(display, { winIn: 0x3F3F, win0h: SCREEN_W, win0v: SCREEN_H, bldCnt: 0xBF, bldY: 0, win0: true });
            timer = 0;
            phase++;
          }
          break;
        case 2:
          if (++timer > 128) {
            p.heldInput = null;
            p.xsp = 0; p.ysp = 0; p.gsp = 0;
            p.vanished = true;
            world.destroyTasks(0x2000, 0x2FFF);
            display.bldCnt &= ~0x10;
            // with those tasks gone, the frame's run has passed where the results' task goes, which first runs next frame
            world.stageResults(world.ringCount, world.courseTime, true);
            return false;
          }
          display.bldY = timer >> 3;
          world.cam.shiftX = -(timer >> 1);
          break;
      }
      return true;
    },
  };
}

// the lights in the sky, far to the right, drifting left and down and shrinking to half (sub_8038C20 and sub_8038D2C,
// whose task is sub_8038E34), for 600 frames
function sparkle(name, vx, vy) {
  const s = makeSprite(name, { order: 23 });
  let x = 0, y = 0, scale = 0x1000, life = 0x258;
  return {
    run(ctx) {
      x += vx; y += vy;
      scale = Math.max(scale - 1, 0x800);
      animate(s, ctx.anims);
      const size = scale >> 4;
      ctx.draw(s, 0xEF4 + (x >> 8), 0x120 + (y >> 8), { rotation: 0, scaleX: size, scaleY: size, double: false });
      return --life !== 0;
    },
  };
}

// the flash as he turns into Super Sonic, on him for 15 frames (sub_8038B38 and sub_8038BC8)
function transformFlash() {
  const s = makeSprite('superFlash', { order: 17 });
  let life = 0xF;
  return {
    run(ctx) {
      animate(s, ctx.anims);
      ctx.draw(s, Math.floor(ctx.player.x), Math.floor(ctx.player.y));
      return --life !== 0;
    },
  };
}

/**
 * The way to the Moon Zone, the task Egg X starts as it lands if the Moon has opened (Task_8038554, priority 0x1FFF).
 * 420 frames on, once he is on the ground, Sonic runs right by himself, past where the normal ending fades; at x 3680
 * he brakes for 12 frames as the first light comes up, and stops looking up. A minute on the results come up over
 * him and run by themselves, and once they are over he turns into Super Sonic, rises and hangs there with a flash on
 * the 34th frame; on the 154th he flies off to the right, his speed growing, hidden past x 3872. 120 frames on the
 * second light comes up, 180 frames later the screen fades to white over 128 frames, and the Moon Zone starts. The
 * CPU partner stops short of him, from x 3632, and stands watching once he turns.
 */
export function moonEnding() {
  let phase = 0, timer = 0x1A4, speed = 0, angle = 0, height = 0, partnerStep = 0;
  // the partner's part of the task, after Sonic's
  function partnerWatches(partner) {
    if (phase > 4) { partner.state = 'moonWatch'; return; }
    if (partnerStep === 0 && partner.x >= MOON_PARTNER_STOPS) { partner.ignoreInput = true; partner.heldInput = LEFT; partnerStep = 1; }
    else if (partnerStep === 1 && partner.gsp <= 0.5) { partner.heldInput = null; partnerStep = 2; }
    else if (partnerStep === 2 && partner.state === 'idle') { partner.override = true; partnerStep = 3; }
  }
  return {
    run(ctx) {
      const { world, player: p } = ctx, display = world.display;
      switch (phase) {
        case 0:
          if (timer !== 0) timer--;
          else if (!p.air) {
            p.heldInput = RIGHT;
            setCamBounds(world.cam, { maxX: world.cam.width });
            phase++;
          }
          break;
        case 1:
          if (p.x >= MOON_RUN_TO) {
            p.heldInput = LEFT;
            timer = 12;
            ctx.add(sparkle('moonSparkleA', -8, 4), 0x2100);
            const { minY, maxY, maxX } = camBounds(world.cam);
            const pan = setBossCamBounds(world.cam, minY, maxY, Math.floor(p.x) - 96, maxX);
            ctx.add(pan, pan.priority);
            phase++;
          }
          break;
        case 2:
          if (--timer === 0) {
            p.heldInput = null;
            p.state = 'moonGaze';
            p.override = true;
            timer = 60;
            phase++;
          }
          break;
        case 3:
          if (--timer === 0) {
            timer = world.stageResults(world.ringCount, world.courseTime);
            phase++;
          }
          break;
        case 4:
          if (--timer === 0) {
            p.state = 'moonTransform';
            p.override = true;
            p.y -= 16;
            angle = 0; speed = 0; timer = 0;
            phase++;
          }
          break;
        case 5:
          if (++timer === 0x22) ctx.add(transformFlash(), 0x2100);
          if (timer > 0x99) {
            p.state = 'moonFly';
            speed = 256;
            timer = 120;
            phase++;
          } else if (timer > 33) {
            angle = (angle + 0x10) & 0x3FF;
            p.y = height + (SINE[angle] >> 11);
          } else if (timer > 0x1F) {
            speed += 0x400;
            p.y += speed / 256;
            height = Math.floor(p.y);
          } else if (timer > 0x19) {
            speed -= 0x180;
            p.y += speed / 256;
          }
          break;
        case 6:
          if (p.x <= MOON_FLY_TO) {
            speed += 0x80;
            p.x += speed / 256;
          } else p.vanished = true;
          if (--timer === 0) {
            ctx.add(sparkle('moonSparkleB', -12, 6), 0x2100);
            timer = 0xB4;
            phase++;
          }
          break;
        case 7:
          if (--timer === 0) {
            Object.assign(display, { winIn: 0x3F3F, win0h: SCREEN_W, win0v: SCREEN_H, bldCnt: 0xBF, bldY: 0, win0: true });
            timer = 0;
            phase++;
          }
          break;
        case 8:
          if (++timer > 0x80) {
            world.destroyTasks(0x2000, 0x2FFF);
            world.toTheMoon();
            return false;
          }
          display.bldY = timer >> 3;
          break;
      }
      if (ctx.players[1]) partnerWatches(ctx.players[1]);
      return true;
    },
  };
}
