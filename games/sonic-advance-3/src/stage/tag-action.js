// The tag action, the move the two characters make together, written from how the original's player code behaves, as
// read in its decompilation. Holding the trick button (R) for half a second starts it charging, with its ring round the
// character and its sound, and a second more would make the move. So far: the wait before it starts, charging, and
// letting go of the button before it's done.
// Comments name the original's functions by the decompilation's labels, which proof/names.json moves to the USA copy's addresses.

import { createSprite, updateSprite, displaySprite, SPRITE } from '../sprite.js';
import { KEY } from '../core.js';
import { FLAG, POSE, SONIC, TAILS, startStanding, startFalling, tailsStands, throwing, stopBoost, startChargedAir, startChargedOnGround } from './player.js';
import { SINE } from './trig.js';

const SE_FLYING = 0x78, SE_281 = 0x119, BUSY = 0x20000000;
const TAG_ACTION_DELAY = 30, TAG_ACTION_CHARGING_TIME = 60, SE_TAG_ACTION_CHARGED = 0x21B, SE_TAG_ACTION_CHARGING = 0x21C;
const ANIM_TAG_ACTION_CHARGE = 1340, TAG_TILES = 0x10000 + 0x4580, TAG_ORDER = 15 << 6;
const ANIM_FINISHED = 0x4000, ANIM_PARTNER_RING = 0x53D, KNUCKLES = 3, AMY = 4;
const PARTNER_JOINS_AT = 30, PARTNER_ANIMATIONS = 0xE2E788, GRAVITY_SWITCHED = 0x10000, PX = 256;
const pixel = v => v >> 8;
const otherOf = p => p.stage.players[1 - p.id];

// sub_8014BC4: whether the trick button has the character in the middle of the move, which the other things it could do wait for
export function tagAction(p) {
  const { stage } = p, { c } = stage;
  if (stage.level === 1 || stage.level === 11) return false;
  if (p.held & KEY.R) {
    if (p.flags & FLAG.TAG_ACTION_CHARGED) return true;
    if (p.tagActionDelay < TAG_ACTION_DELAY) p.tagActionDelay++;
    else {
      if (!(p.flags & FLAG.TAG_ACTION_CHARGING)) playSong(p, SE_TAG_ACTION_CHARGING);
      p.flags |= FLAG.TAG_ACTION_CHARGING;
      if (p.tagActionCharge === TAG_ACTION_CHARGING_TIME) {
        startCharged(p);
        return true;
      }
    }
  } else {
    p.tagActionDelay = 0;
    if (p.flags & FLAG.TAG_ACTION_CHARGED) {
      const partner = otherOf(p);
      releaseMove(p, partner);
      partner.flags &= ~(FLAG.TAG_ACTION_CHARGED | FLAG.TAG_ACTION_PARTNER_JOINED);
      p.flags &= ~(FLAG.TAG_ACTION_CHARGED | FLAG.TAG_ACTION_PARTNER_JOINED);
      destroyTagAction(p);
      c.stopSong(SE_TAG_ACTION_CHARGING);
    } else {
      if (p.tagActionCharge !== 0) c.stopSong(SE_TAG_ACTION_CHARGING);
      endCharge(p);
      p.flags &= ~FLAG.TAG_ACTION_CHARGING;
    }
    p.tagActionCharge = 0;
  }
  return false;
}

// the moment the charge is full: it stops where it is, in the pose of the move, and keeps it for as long as the button is held
function startCharged(p) {
  stopBoost(p);
  endCharge(p);
  const inAir = (p.flags & (FLAG.ON_OBJECT | FLAG.IN_AIR)) === FLAG.IN_AIR;
  p.behave = inAir ? startChargedAir : startChargedOnGround;
  p.stage.c.stopSong(SE_TAG_ACTION_CHARGING);
  playSong(p, SE_TAG_ACTION_CHARGED);
  p.flags = (p.flags & ~(FLAG.TAG_ACTION_CHARGING | FLAG.NO_AIR_STEERING | FLAG.CURLED)) | FLAG.TAG_ACTION_CHARGED;
  p.tagActionCharge = 0;
}

const playSong = (p, song) => { if (p.id === p.stage.playerIndex) p.stage.c.playSong(song); };

/** sub_80193A4 (AdvanceVariant): its ring plays out and goes. */
function endCharge(p) {
  if (p.tagActionTask) {
    p.tagActionTask.data.sprite.variant = 1;
    p.tagActionTask.main = endingRing;
  }
}

/** The rest of the player's frame (0x080045EC, once its callback has run): charging goes on, or nothing is going on. */
export function tagActionFrame(p) {
  if (p.stage.state !== 3 || p.flags & FLAG.DEAD) return;
  const partner = otherOf(p);
  if (p.flags & FLAG.TAG_ACTION_CHARGING) {
    initializeTagAction(p);
    if (++p.tagActionCharge === PARTNER_JOINS_AT && (!(partner.flags & FLAG.DEAD) || !partner.isLeader)) {
      partner.joinFrames = 0;
      partner.flags = (partner.flags & ~(FLAG.ON_OBJECT | FLAG.DEAD | 0x10000000)) | FLAG.TAG_ACTION_PARTNER_JOINED;
      partner.standingOn = null;
      startJoining(partner, p);
    }
  } else if (p.flags & FLAG.TAG_ACTION_CHARGED) {
    endCharge(p);
    p.tagActionCharge = 0;
  } else if (p.flags & FLAG.TAG_ACTION_PARTNER_JOINED) {
    stopCharging(p);   // sub_8016F28
    initializeSilhouette(p);   // sub_801816C
    p.flags &= ~FLAG.ON_OBJECT;
    p.standingOn = null;
    p.tagActionCharge = 0;
  } else {
    destroyTagAction(p);   // sub_80193CC
    p.tagActionCharge = 0;
  }
}

// sub_8016F28: the move it was charging is over
function stopCharging(p) {
  endCharge(p);
  if (p.id === p.stage.playerIndex) p.stage.c.stopSong(SE_TAG_ACTION_CHARGING);
  if (p.flags & FLAG.TAG_ACTION_CHARGING) {
    p.tagActionCharge = 0;
    p.flags &= ~FLAG.TAG_ACTION_CHARGING;
  }
}

// Player_8007930: the other character leaves what it was doing, curled up, and goes to the one charging, over the way from where it is,
// or from beside it if it's out of the screen
function startJoining(p, leader) {
  p.flags &= ~(0x2000000 | FLAG.DEAD);
  if (leader.flags & FLAG.TAG_ACTION_PARTNER_JOINED) {
    p.flags &= ~FLAG.TAG_ACTION_PARTNER_JOINED;
    p.behave = startStanding;
    return;
  }
  p.flags = (p.flags & ~FLAG.AT_WALL) | FLAG.TAG_ACTION_PARTNER_JOINED;
  p.pose = POSE.ROLL;
  p.groundSpeed = p.velX = p.velY = 0;
  p.tagActionCharge = 0;
  p.joinFrames = 0;
  p.camOffsetY = 0;
  p.layer = leader.layer;
  p.flags = (p.flags & ~(FLAG.FACING_LEFT | GRAVITY_SWITCHED)) | (leader.flags & (FLAG.FACING_LEFT | GRAVITY_SWITCHED));
  stopCharging(p);
  const { camera } = p.stage, seen = p.isLeader ? leader : p;
  const x = pixel(seen.x) - camera.x, y = pixel(seen.y) - camera.y;
  p.joinX = leader.x;
  p.joinY = leader.y;
  if (x >= -32 && x <= 240 + 64 && y >= -32 && y <= 160 + 32) {
    p.joinFromY = p.y;
    p.behave = jumpToLeader;
    jumpToLeader(p);
  } else {
    p.behave = comeFromOutside;
    comeFromOutside(p);
  }
}

// Player_8007B00: over to the one charging in an arc, rising to 32 pixels above the higher of the two places, and falling to it
function jumpToLeader(p) {
  const leader = otherOf(p);
  p.layer = leader.layer;
  p.flags = (p.flags & ~(FLAG.FACING_LEFT | GRAVITY_SWITCHED)) | (leader.flags & (FLAG.FACING_LEFT | GRAVITY_SWITCHED));
  if (!(leader.flags & FLAG.TAG_ACTION_PARTNER_JOINED)) {
    p.joinX = leader.x;
    p.joinY = leader.y;
  }
  if (++p.joinFrames <= 30) {
    const top = Math.min(p.joinFromY, p.joinY) - 32 * PX, sine = SINE[p.joinFrames * 16];
    if (p.joinFrames > 15) p.y = p.joinY + ((sine * (top - p.joinY)) >> 14);
    else p.y = p.joinFromY + ((sine * (top - p.joinFromY)) >> 14);
    p.x += leader.velX;
    if (p.joinFrames < 30) p.x += Math.trunc((p.joinX - p.x) / (30 - p.joinFrames));
  } else {
    p.x = leader.x;
    p.y = leader.y;
    arrived(p, leader);
  }
}

// Player_8007C28: out of the screen it comes in from the side, rising and sinking as it nears
function comeFromOutside(p) {
  const leader = otherOf(p), { camera } = p.stage;
  p.layer = leader.layer;
  p.flags = (p.flags & ~(FLAG.FACING_LEFT | GRAVITY_SWITCHED)) | (leader.flags & (FLAG.FACING_LEFT | GRAVITY_SWITCHED));
  if (!(leader.flags & FLAG.TAG_ACTION_PARTNER_JOINED)) {
    p.joinX = leader.x;
    p.joinY = leader.y;
  }
  const fromLeft = p.x < p.joinX;
  p.x = p.joinX;
  p.y = p.joinY;
  if (++p.joinFrames <= 30) {
    p.y -= SINE[p.joinFrames * 16] >> 1;
    p.x += (fromLeft ? -1 : 1) * (30 - p.joinFrames) * 5 * PX;
    p.x = Math.max(0, Math.min(camera.maxX * PX - 1, p.x));
    p.y = Math.max(0, Math.min(camera.maxY * PX - 1, p.y));
  } else arrived(p, leader);
}

function arrived(p, leader) {
  if (leader.flags & FLAG.TAG_ACTION_CHARGING) return;
  p.behave = leader.flags & FLAG.TAG_ACTION_CHARGED ? followCharged : startStanding;
  p.behave(p);
}

// Player_8007DF4: beside the charged one, to the side it's facing away from, until the move is made or let go
function followCharged(p) {
  const leader = otherOf(p);
  p.layer = leader.layer;
  p.flags = (p.flags & ~(FLAG.FACING_LEFT | GRAVITY_SWITCHED)) | (leader.flags & (FLAG.FACING_LEFT | GRAVITY_SWITCHED));
  p.x = leader.x + (leader.flags & FLAG.FACING_LEFT ? -10 : 10) * PX;
  p.y = leader.y;
  p.joinFrames++;
  if (leader.flags & FLAG.TEAM_MOVE) {
    releaseMove(leader, p);
    p.flags &= ~(FLAG.TAG_ACTION_PARTNER_JOINED | FLAG.TAG_ACTION_CHARGED);
    p.stage.c.stopSong(SE_TAG_ACTION_CHARGING);
  } else if (!(leader.flags & FLAG.TAG_ACTION_CHARGED)) {
    p.x = leader.x;
    p.y = leader.y;
    p.behave = startStanding;
  }
}

// sub_800BF78: the move the two make together, which the kind of the other character decides, from the ground or the air.
// Made so far: with Tails beside the character, from the ground
export function releaseMove(p, partner) {
  partner.layer = p.layer;
  partner.flags = (partner.flags & ~GRAVITY_SWITCHED) | (p.flags & GRAVITY_SWITCHED);
  if (!(p.flags & FLAG.IN_AIR) && partner.character === TAILS) throwWithTails(p, partner);
  else if (p.flags & FLAG.IN_AIR) p.behave = startFalling;
  else p.behave = startStanding;
}

// sub_800EF50: Tails stays where it is and the one charged throws itself up from there
function throwWithTails(p, partner) {
  stopFlying(p);
  partner.flags = (partner.flags & ~FLAG.FACING_LEFT) | (p.flags & FLAG.FACING_LEFT);
  tailsWaits(partner, p);
  startThrow(p);
  partner.x = p.x;
  partner.y = p.y;
}
const moveFlags = () => FLAG.TAG_ACTION_CHARGED | FLAG.TAG_ACTION_PARTNER_JOINED | FLAG.TEAM_MOVE | BUSY | 0x200000 | 0x80000 | FLAG.FLYING |
  FLAG.GRINDING | 0x8000 | 0x4000 | 0x2000 | 0x1000 | 0x400 | FLAG.AT_WALL | FLAG.SPIN_DASHING | FLAG.NO_AIR_STEERING | FLAG.CURLED;
// sub_800CCB0: Tails stands where it is, in the pose it waits in, and then it's on its feet
function tailsWaits(p, leader) {
  stopRollingSound(p);
  p.flags = (((p.flags & ~moveFlags()) | BUSY) & ~FLAG.FACING_LEFT) | (leader.flags & FLAG.FACING_LEFT);
  p.camOffsetY = 0;
  p.pose = 0xDE;
  p.waitFrames = 0;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.groundSpeed = 0;
  p.behave = tailsStands;
  tailsStands(p);
}
// sub_800CB5C and sub_800CBE8: the one charged crouches down for a moment and throws itself up and back
function startThrow(p) {
  stopRollingSound(p);
  p.flags = (p.flags & ~moveFlags()) | BUSY | FLAG.TEAM_MOVE;
  p.camOffsetY = 0;
  p.pose = 91;
  p.sprite.frameFlags &= ~ANIM_FINISHED;
  p.groundSpeed = 0;
  p.behave = throwing;
  throwing(p);
}
const stopFlying = p => { if (p.id === p.stage.playerIndex) p.stage.c.stopSong(SE_FLYING); };
const stopRollingSound = p => { if (p.id === p.stage.playerIndex) p.stage.c.stopSong(SE_281); };

// sub_801816C: a sprite of the other character's, its colours, which shows for as long as it has joined
function initializeSilhouette(p) {
  if (p.silhouetteTask) return;
  const { c } = p.stage, { rom } = c;
  const sprite = createSprite({
    tiles: 0, frameFlags: 0x80000, anim: rom.u16(PARTNER_ANIMATIONS + p.character * 4), x: 0, y: 0, oamFlags: 0, prevAnim: 0xFFFF,
    variant: rom.u16(PARTNER_ANIMATIONS + p.character * 4 + 2), prevVariant: 0xFF, palId: p.id,
  });
  p.silhouetteTask = c.createTask(silhouette, { p, sprite }, 0x3100);
}
// Task_8019628
function silhouette(t) {
  const { p, sprite } = t.data, { c } = p.stage;
  if (p.flags & FLAG.DEAD) endCharge(p);
  else if (!(p.flags & FLAG.TAG_ACTION_PARTNER_JOINED)) {
    c.destroyTask(t);
    p.silhouetteTask = null;
  } else {
    updateSprite(c, sprite);
    displaySprite(c, sprite);
  }
}

function destroyTagAction(p) {
  if (!p.tagActionTask) return;
  p.stage.c.destroyTask(p.tagActionTask);
  p.tagActionTask = null;
}

/** Player_InitializeTagAction: its ring, which stays with the character while it charges. */
function initializeTagAction(p) {
  if (p.tagActionTask) return;
  const { stage } = p, { c } = stage;
  const sprite = createSprite({
    tiles: TAG_TILES, frameFlags: 0x1000, anim: ANIM_TAG_ACTION_CHARGE, x: 0, y: 0, oamFlags: TAG_ORDER, palId: 0, variant: 0, prevAnim: 0xFFFF, prevVariant: 0xFF,
  });
  p.tagActionTask = c.createTask(chargingRing, { p, sprite }, 0x3100);
}

// Task_TagActionInit: the ring round the character, turned the way it faces, until its animation has played, and then, with
// the other character's kind of ring, round the other character
function chargingRing(t) {
  const { p, sprite } = t.data, { stage } = p;
  if (p.flags & FLAG.DEAD) {
    endCharge(p);
    return;
  }
  if (sprite.frameFlags & ANIM_FINISHED) {
    t.main = ringOfPartner;
    const partner = stage.players[1 - p.id];
    Object.assign(sprite, {
      tiles: TAG_TILES, frameFlags: 0x1000, x: 0, y: 0, oamFlags: 0x600, qAnimDelay: 0, prevAnim: 0xFFFF, prevVariant: 0xFF, animSpeed: 0x10, palId: 0,
      anim: ANIM_PARTNER_RING, variant: [SONIC, KNUCKLES, AMY].includes(partner.character) ? 0 : 1,
    });
    return;
  }
  faceTheWay(p, sprite);
  showRing(p, sprite, p);
}

// sub_80190C8
function ringOfPartner(t) {
  const { p, sprite } = t.data, partner = p.stage.players[1 - p.id];
  if (p.flags & FLAG.DEAD) endCharge(p);
  else showRing(p, sprite, partner);
}

const faceTheWay = (p, sprite) => {
  sprite.frameFlags = (p.flags & FLAG.FACING_LEFT) ? sprite.frameFlags & ~SPRITE.X_FLIP : sprite.frameFlags | SPRITE.X_FLIP;
};

// sub_8019150: the ring plays out, and goes
function endingRing(t) {
  const { p, sprite } = t.data;
  if (sprite.frameFlags & ANIM_FINISHED) {
    destroyTagAction(p);
    return;
  }
  faceTheWay(p, sprite);
  showRing(p, sprite, p);
}

function showRing(p, sprite, at) {
  const { stage } = p, { c } = stage;
  sprite.x = pixel(at.x) - stage.camera.x;
  sprite.y = pixel(at.y) - stage.camera.y;
  updateSprite(c, sprite);
  displaySprite(c, sprite);
}
