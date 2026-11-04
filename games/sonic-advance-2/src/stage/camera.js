// The camera, written from how the original behaves (0x0801C394, UpdateCamera, which 0x0801E0A8 runs each frame). It keeps
// the character near the middle of the screen: it looks ahead the way they're going, lets them drift off its target by a
// few pixels before it moves, catches up at a limited speed that grows, and never shows past the stage's edges.

const W = 240, H = 160;
const DRIFT_X = 8, MAX_DRIFT_Y = 24, DRIFT_Y_STEP = 4, CATCH_UP_Y = 12, CATCH_UP_GROWS = 0x20, CATCH_UP_TOP = 0x1000;
const FEET_STEP = 5, IN_AIR = 0x2;

const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const towards = (from, to, step) => (from < to ? Math.min(from + step, to) : Math.max(from - step, to));

// nothing while `to` is within `drift` of `from`, and then up to `step` pixels nearer, stopping at that drift
function follow(from, to, drift, step) {
  const gap = to - from;
  if (Math.abs(gap) <= drift) return from;
  return from + Math.sign(gap) * Math.min(step, Math.abs(gap) - drift);
}

/** What the camera keeps from frame to frame, other than where it is. */
export const cameraMemory = leader => ({ lookAhead: 0, feetOffset: leader.halfHeight - 4, driftY: 0, catchUpX: CATCH_UP_TOP });

/** A frame of the camera: where it goes, then the layers it shows there (stage.js). */
export function updateCamera(stage) {
  const cam = stage.camera, leader = stage.player;
  cam.lookAhead = (((leader.velX << 16) >> 16) + cam.lookAhead * 15) >> 4;   // an average of its speed across the last frames
  cam.feetOffset = towards(cam.feetOffset, leader.halfHeight - 4, FEET_STEP);
  cam.driftY = towards(cam.driftY, leader.flags & IN_AIR ? MAX_DRIFT_Y : 0, DRIFT_Y_STEP);

  const targetX = (leader.x >> 8) - W / 2 + (cam.lookAhead >> 5);
  const targetY = (leader.y >> 8) - H / 2 + cam.feetOffset;
  // it works from a pixel inside the far edges, so it can come back from them
  const fromX = clamp(cam.x, cam.minX, cam.maxX - W - 1), fromY = clamp(cam.y, cam.minY, cam.maxY - H - 1);
  cam.x = clamp(follow(fromX, targetX, DRIFT_X, cam.catchUpX >> 8), cam.minX, cam.maxX - W);
  if (cam.catchUpX < CATCH_UP_TOP) cam.catchUpX += CATCH_UP_GROWS;
  cam.y = clamp(follow(fromY, targetY, cam.driftY, CATCH_UP_Y), cam.minY, cam.maxY - H);
}
