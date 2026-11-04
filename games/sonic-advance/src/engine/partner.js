// CPU Tails, the partner the character select's code brings along (SAT-R decompilation,
// src/game/shared/stage/player.c: sub_8045DF0, Task_8045B38, Task_804597C, Task_8045AD8, Player_Tails_804571C, and
// src/game/sa1/stage/player_controls.c: sub_804D13C). He is a second player with Tails' moves, running just after
// Sonic, whose controls are Sonic's buttons of 20 frames ago with a few of the CPU's own touches: he goes to where
// Sonic is, jumps when Sonic is well above him, and flies up to him. Thrown off the bottom of the screen, or left far
// behind, he comes back flying, straight through everything, until he's over Sonic's head with room to land.

import { stepPlayer, handleWater, createPlayer, TAILS } from './player.js';
import { clearance } from './sensors.js';
import { PHYSICS as K } from './constants.js';
import { SONG } from '../sound/songs.js';
import { SCREEN_W as W, SCREEN_H as H } from './constants.js';

const LATE = 20;   // gUnknown_030060F0[20]: how many frames behind Sonic's buttons his are
const REGION = 256;   // CAM_REGION_WIDTH: how far past the screen he can go
const NEAR = 16, HIGH = 80, ABOVE = 16, BESIDE = 32, OVER_HEAD = 48;
const NOTHING = { left: false, right: false, up: false, down: false, jump: false, attack: false };
const q8 = v => Math.round(v * 256);

/** The last frames' buttons of Sonic (gUnknown_030060F0): `push` each frame, then `late` is what the partner reads. */
export function createButtonHistory() {
  const frames = Array.from({ length: LATE + 1 }, () => NOTHING);
  return {
    push({ left, right, up, down, jump, attack }) {
      frames.pop();
      frames.unshift({ left: !!left, right: !!right, up: !!up, down: !!down, jump: !!jump, attack: !!attack });
    },
    // sub_804D13C(0), while Sonic's controls are held
    pushNothing() { frames.pop(); frames.unshift(NOTHING); },
    get late() { return frames[LATE]; },
  };
}

/** Tails as InitializePlayer makes him for gPartner, at the act's start. */
export function newPartner({ x, y }, spinDashSpeeds, stopPropeller, tailsAnim) {
  const p = createPlayer({ x, y, spinDashSpeeds, character: TAILS, stopPropeller });
  p.tailsAnim = tailsAnim();
  p.tailsShift = 0;
  p.task = 'play';
  p.lastInput = { ...NOTHING, jump: true, attack: true };
  return p;
}

// sub_8045DF0: his buttons this frame, and those pressed (`jumpPressed`, `attackPressed`)
function buttonsFor(p, sonic, history) {
  const was = p.lastInput;
  const held = { ...history.late };
  if (!((p.rotation + 0x20) & 0xC0)) {
    if (p.x + NEAR < sonic.x) {
      if (!held.down) { held.right = true; held.left = false; }
    } else if (p.x - NEAR > sonic.x) {
      if (!held.down) { held.left = true; held.right = false; }
    } else { held.left = false; held.right = false; }
    // standing still, he turns to face the way Sonic faces
    if (!held.left && !held.right && p.gsp === 0 && !p.air && p.attack === 0 && (p.state === 'walk' || p.state === 'idle')
      && !p.actClear && !p.halfPipe && !p.spinDashing && !p.forcedRoll && !p.onObject && p.facing !== sonic.facing) {
      p.facing = sonic.facing;
      p.state = 'turn';
    }
  }
  let jumpPressed = held.jump && !was.jump;
  const attackPressed = held.attack && !was.attack;
  const inv = sonic.inverted;
  const under = (a, b) => (inv ? a < b : a > b);   // a is further down the act than b
  if (!p.air) {
    if (under(p.y - (inv ? -HIGH : HIGH), sonic.y)) jumpPressed = true;
  } else if (under(p.y, sonic.y + (inv ? ABOVE : -ABOVE))) {
    if (p.midAir !== 0 || p.ysp > 0) {
      if (under(p.y, sonic.y)) jumpPressed = true;
    } else held.jump = true;
  }
  if (held.left || held.right) { held.up = false; held.down = false; }
  p.lastInput = held;
  return { ...held, jumpPressed, attackPressed, boost: false, trick: false, boostPressed: false, trickPressed: false };
}

// Player_Tails_804571C: on the way back, along the screen's edges at the furthest, 2 px a frame across and 1 down or up
// to 48 px over Sonic's head, until he's within 32 px of there with ground not in his way. He takes Sonic's layer
// (and the original, for each frame he's on a rail, swaps Sonic's)
function comeBack(p, sonic, world) {
  const cam = world.camera, inv = sonic.inverted;
  p.layer = sonic.layer;
  if (sonic.grinding) sonic.layer ^= 1;
  p.state = p.water ? 'swim' : 'fly';
  const cx = Math.floor(cam.x), cy = Math.floor(cam.y);
  if (Math.floor(p.x) < cx - REGION) p.x = cx - REGION;
  if (Math.floor(p.x) > cx + W + REGION) p.x = cx + W + REGION;
  if (Math.floor(p.y) < cy - REGION) p.y = cy - REGION;
  if (Math.floor(p.y) > cy + H + REGION) p.y = cy + H + REGION;
  const px = Math.floor(p.x), py = Math.floor(p.y), sx = Math.floor(sonic.x), sy = Math.floor(sonic.y);
  const target = inv ? sy + OVER_HEAD : sy - OVER_HEAD;
  if (px - BESIDE < sx && px + BESIDE > sx && py - BESIDE < target && py + BESIDE > target && clearance(p, world.terrain, 0) >= 0) {
    p.pushing = false; p.onObject = null; p.spinDashing = false; p.halfPipe = false; p.forcedRoll = false; p.actClear = false;
    p.jumped = false; p.airLock = false;
    p.midAir = 0; p.attack = 0; p.attackNext = 0; p.curled = false; p.invisible = false; p.dead = false; p.ignoreInput = false; p.carried = false;
    p.gsp = 0; p.xsp = 0; p.ysp = 0;
    p.stopPropeller();
    p.state = 'flyLand';
    p.task = 'play';
    return;
  }
  if (px + 1 < sx) { p.x += 2; p.facing = 1; }
  else if (sx < px - 1) { p.x -= 2; p.facing = -1; }
  if (py < target) p.y += 1;
  else if (target < py) p.y -= 1;
}

// the frame he has gone off-screen or fallen out of it: flying from then on, with the drowning count started over
function startFlying(p) {
  p.state = p.water ? 'swim' : 'fly';
  p.pushing = false;
  p.drownFrames = 60; p.drownSeconds = K.drownSeconds;
  p.task = 'returning';
}

/**
 * Task_8045B38 and the two tasks it hands over to: his frame's movement, returning the buttons his animation goes by.
 * `world` is what he sees of the game (game.js), `sonic` the player, `history` Sonic's buttons.
 */
export function stepPartner(p, sonic, history, world, held) {
  const cam = world.camera;
  switch (p.task) {
    case 'play': {
      if (p.dead) {
        // the frame he's found dead: he stops moving sideways, shields and timers gone, in front of the front layer
        p.task = 'fallen';
        p.state = 'dead';
        p.xsp = 0; p.invulnerable = 2; p.shield = null; p.invincible = 0; p.speedUp = 0;
        p.pushing = false; p.onObject = null; p.front = true; p.scale = 0x100;
        world.stopSound(SONG.TAILS_FLYING);
        world.playSound(p.drownSeconds < 0 ? SONG.DROWNED : SONG.LIFE_LOST);
        return p.lastInput;
      }
      const buttons = held ?? (p.ignoreInput ? p.heldInput ?? { ...NOTHING } : buttonsFor(p, sonic, history));
      const x = Math.floor(p.x), y = Math.floor(p.y), cx = Math.floor(cam.x), cy = Math.floor(cam.y);
      if (x < cx - REGION || x > cx + W + REGION || y < cy - REGION || y > cy + H + REGION) {
        handleWater(p, world);
        startFlying(p);
        p.dead = true;
        return buttons;
      }
      stepPlayer(p, buttons, world);
      return buttons;
    }
    case 'fallen': {
      // Task_804597C: he falls through everything until he's a screen's width below the camera's top
      const y = q8(p.y), top = Math.floor(cam.y);
      const gone = sonic.inverted ? y <= (top - 80) * 256 : y >= (top + W) * 256 - 1;
      if (gone) {
        p.x = Math.floor(cam.x) - REGION; p.y = top - REGION;
        p.front = false; p.prio = 2; p.dead = false;
        startFlying(p);
        return p.lastInput;
      }
      p.x += p.xsp;
      p.y += sonic.inverted ? -p.ysp : p.ysp;
      p.ysp += (p.water ? 12 : 42) / 256;
      return p.lastInput;
    }
    default:
      // Task_8045AD8
      handleWater(p, world);
      comeBack(p, sonic, world);
      return p.lastInput;
  }
}
